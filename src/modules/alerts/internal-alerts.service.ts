import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import {
  ActiveMonitoringAmbiguousException,
  ActiveMonitoringNotFoundException,
  CameraNotFoundException,
  CameraNotOperationalException,
  EvidenceTooLargeException,
  InvalidRiskEventException,
  UnsupportedEvidenceTypeException,
} from '../../common/errors/problem-details.exception.js';
import type { CreateInternalAlertDto } from './dto/create-internal-alert.dto.js';
import type { InternalAlertResponseDto } from './dto/internal-alert-response.dto.js';

@Injectable()
export class InternalAlertsService {
  private readonly logger = new Logger(InternalAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Processa e persiste atomicamente um evento de alerta interno (N8N -> API).
   *
   * Regras e Invariantes (Fatia 9B - Task 9B.2):
   * 1. Idempotência por `chave_evento`: se o evento já existe, recupera o mesmo alerta,
   *    mesmo que a sessão de monitoramento tenha sido pausada posteriormente.
   * 2. Localiza a câmera pelo código de integração (`cameraCode`).
   * 3. Localiza exatamente um monitoramento `ATIVO` que contenha a câmera.
   * 4. Bloqueio pessimista coordenado (`FOR UPDATE`) para evitar corridas com pausa/encerramento.
   * 5. Criação atômica do alerta e de evidência opcional (validando MIME e limite de 5 MiB).
   * 6. Registro dos destinatários históricos a partir dos acessos ativos à câmera (`acesso_camera.ativo = true`).
   * 7. Criação de notificação por destinatário e entregas PENDENTES para cada dispositivo elegível.
   * 8. Destinatário sem dispositivo elegível gera notificação `SEM_DISPOSITIVO` sem entregas fictícias.
   * 9. Câmera sem destinatários ativos preserva o alerta para auditoria e gera log operacional de erro.
   * 10. Toda a persistência é executada em uma única `Prisma.$transaction`.
   */
  async processAlertEvent(
    dto: CreateInternalAlertDto,
    requestId: string,
  ): Promise<InternalAlertResponseDto> {
    const prisma = this.prisma.getClient();
    const eventKeyTrimmed = dto.eventKey.trim();

    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();

          // 1. Verificação de Idempotência: Alerta com essa chave já foi aceito anteriormente?
          const existingAlert = await tx.alert.findUnique({
            where: { eventKey: eventKeyTrimmed },
            include: {
              recipients: {
                include: {
                  notification: {
                    include: {
                      deliveries: true,
                    },
                  },
                },
              },
            },
          });

          if (existingAlert) {
            this.logger.log(
              `Evento repetido detectado para chave ${eventKeyTrimmed}. Retornando alerta existente ${existingAlert.id.toString()}.`,
            );

            const recipientsCount = existingAlert.recipients.length;
            const notificationsCount = existingAlert.recipients.filter(
              (r) => r.notification != null,
            ).length;
            const deliveriesCount = existingAlert.recipients.reduce(
              (acc, r) => acc + (r.notification?.deliveries.length ?? 0),
              0,
            );

            return {
              eventKey: existingAlert.eventKey,
              accepted: true,
              duplicate: true,
              alertId: existingAlert.id.toString(),
              acceptedAt: existingAlert.createdAt.toISOString(),
              summary: {
                recipientsCount,
                notificationsCount,
                deliveriesCount,
              },
            };
          }

          // 2. Localizar câmera pelo código de integração
          const camera = await tx.camera.findUnique({
            where: { integrationCode: dto.cameraCode },
          });

          if (!camera) {
            this.logger.warn(
              `Câmera não encontrada para cameraCode: ${dto.cameraCode} [req: ${requestId}]`,
            );
            throw new CameraNotFoundException(
              `Câmera com código de integração "${dto.cameraCode}" não encontrada no sistema.`,
            );
          }

          if (camera.administrativeStatus !== 'ATIVA') {
            this.logger.warn(
              `Câmera ${camera.integrationCode} não está com status administrativo ATIVA.`,
            );
            throw new CameraNotOperationalException(
              `A câmera "${camera.name}" não está ativa administrativamente e não pode receber alertas.`,
            );
          }

          // 3. Localizar monitoramento ATIVO associado a esta câmera
          const activeMonitoringLinks = await tx.monitoringCamera.findMany({
            where: {
              cameraId: camera.id,
              monitoring: {
                status: 'ATIVO',
              },
            },
            include: {
              monitoring: true,
            },
          });

          if (activeMonitoringLinks.length === 0) {
            await tx.systemLog.create({
              data: {
                level: 'AVISO',
                category: 'ALERTA',
                description: `Evento de alerta rejeitado: nenhum monitoramento ativo contendo a câmera ${camera.integrationCode}.`,
                cameraId: camera.id,
                data: {
                  eventKey: eventKeyTrimmed,
                  cameraCode: dto.cameraCode,
                  reason: 'NO_ACTIVE_MONITORING',
                },
                occurredAt: now,
              },
            });

            throw new ActiveMonitoringNotFoundException(
              `Nenhum monitoramento ativo encontrado para a câmera "${dto.cameraCode}".`,
            );
          }

          if (activeMonitoringLinks.length > 1) {
            await tx.systemLog.create({
              data: {
                level: 'ERRO',
                category: 'ALERTA',
                description: `Ambiguidade detectada: múltiplas sessões ativas contendo a câmera ${camera.integrationCode}.`,
                cameraId: camera.id,
                data: {
                  eventKey: eventKeyTrimmed,
                  cameraCode: dto.cameraCode,
                  candidateMonitoringIds: activeMonitoringLinks.map((l) =>
                    l.monitoringId.toString(),
                  ),
                  reason: 'AMBIGUOUS_ACTIVE_MONITORINGS',
                },
                occurredAt: now,
              },
            });

            throw new ActiveMonitoringAmbiguousException(
              `Ambiguidade: múltiplos monitoramentos ativos contêm a câmera "${dto.cameraCode}".`,
            );
          }

          const targetMonitoringId = activeMonitoringLinks[0].monitoringId;

          // 4. Bloqueio pessimista coordenado (FOR UPDATE)
          // Bloqueia a linha de monitoramento na mesma ordem de pauseMonitoring/endMonitoring
          await tx.$queryRaw`
            SELECT id FROM monitoramento 
            WHERE id = ${targetMonitoringId} 
            FOR UPDATE
          `;

          // Bloqueia a câmera
          await tx.$queryRaw`
            SELECT id FROM camera 
            WHERE id = ${camera.id} 
            FOR UPDATE
          `;

          // Revalida o estado sob o bloqueio exclusivo
          const lockedMonitoring = await tx.monitoring.findUnique({
            where: { id: targetMonitoringId },
          });

          if (!lockedMonitoring || lockedMonitoring.status !== 'ATIVO') {
            throw new ActiveMonitoringNotFoundException(
              'A sessão de monitoramento associada à câmera não está mais ativa.',
            );
          }

          const linkStillExists = await tx.monitoringCamera.findUnique({
            where: {
              monitoringId_cameraId: {
                monitoringId: targetMonitoringId,
                cameraId: camera.id,
              },
            },
          });

          if (!linkStillExists) {
            throw new ActiveMonitoringNotFoundException(
              'A câmera não pertence mais à sessão de monitoramento ativa.',
            );
          }

          // Verificação dupla de idempotência sob o bloqueio
          const lockedAlert = await tx.alert.findUnique({
            where: { eventKey: eventKeyTrimmed },
            include: {
              recipients: {
                include: {
                  notification: {
                    include: {
                      deliveries: true,
                    },
                  },
                },
              },
            },
          });

          if (lockedAlert) {
            const recipientsCount = lockedAlert.recipients.length;
            const notificationsCount = lockedAlert.recipients.filter(
              (r) => r.notification != null,
            ).length;
            const deliveriesCount = lockedAlert.recipients.reduce(
              (acc, r) => acc + (r.notification?.deliveries.length ?? 0),
              0,
            );

            return {
              eventKey: lockedAlert.eventKey,
              accepted: true,
              duplicate: true,
              alertId: lockedAlert.id.toString(),
              acceptedAt: lockedAlert.createdAt.toISOString(),
              summary: {
                recipientsCount,
                notificationsCount,
                deliveriesCount,
              },
            };
          }

          // 5. Validar e preparar evidência opcional
          let evidenceBuffer: Buffer | null = null;
          let evidenceMimeType: string | null = null;
          let evidenceSizeBytes: bigint | null = null;
          let evidenceHashSha256: string | null = null;
          let evidenceExpiresAt: Date | null = null;

          if (dto.evidence) {
            const { mimeType, base64 } = dto.evidence;
            if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
              throw new UnsupportedEvidenceTypeException(
                'Tipo MIME de evidência não suportado. Utilize image/jpeg ou image/png.',
              );
            }

            const buf = Buffer.from(base64, 'base64');
            if (buf.length === 0) {
              throw new InvalidRiskEventException(
                'O conteúdo da evidência Base64 não pode ser vazio.',
              );
            }

            if (buf.length > 5 * 1024 * 1024) {
              throw new EvidenceTooLargeException(
                'A evidência excede o tamanho máximo de 5 MiB.',
              );
            }

            evidenceBuffer = buf;
            evidenceMimeType = mimeType;
            evidenceSizeBytes = BigInt(buf.length);
            evidenceHashSha256 = createHash('sha256').update(buf).digest('hex');
            evidenceExpiresAt = new Date(
              now.getTime() + 30 * 24 * 60 * 60 * 1000,
            );
          }

          // 6. Criar o alerta e a evidência
          const detectedAt = new Date(dto.detectedAt);
          if (isNaN(detectedAt.getTime())) {
            throw new InvalidRiskEventException(
              'O campo detectedAt deve ser um instante de data UTC válido.',
            );
          }

          const alert = await tx.alert.create({
            data: {
              eventKey: eventKeyTrimmed,
              monitoringId: targetMonitoringId,
              cameraId: camera.id,
              type: dto.type ?? 'POSSIVEL_RISCO',
              severity: dto.severity,
              detectedAt,
              confidence:
                dto.confidence !== undefined && dto.confidence !== null
                  ? new Prisma.Decimal(dto.confidence)
                  : null,
              modelVersion: dto.modelVersion ?? null,
              technicalData:
                (dto.technicalData as Prisma.InputJsonValue) ?? Prisma.DbNull,
              createdAt: now,
            },
          });

          if (
            evidenceBuffer &&
            evidenceMimeType &&
            evidenceSizeBytes &&
            evidenceHashSha256 &&
            evidenceExpiresAt
          ) {
            await tx.alertEvidence.create({
              data: {
                alertId: alert.id,
                mimeType: evidenceMimeType,
                content: Uint8Array.from(evidenceBuffer),
                sizeBytes: evidenceSizeBytes,
                hashSha256: evidenceHashSha256,
                expiresAt: evidenceExpiresAt,
                createdAt: now,
              },
            });
          }

          // 7. Obter acessos ativos da câmera (destinatários históricos)
          const activeAccesses = await tx.cameraAccess.findMany({
            where: {
              cameraId: camera.id,
              active: true,
              revokedAt: null,
            },
            select: {
              userId: true,
            },
          });

          // Tratar caso excepcional de câmera sem acessos ativos
          if (activeAccesses.length === 0) {
            await tx.systemLog.create({
              data: {
                level: 'ERRO',
                category: 'ALERTA',
                description: `Inconsistência operacional: câmera ${camera.integrationCode} não possui acessos ativos no momento do alerta.`,
                alertId: alert.id,
                monitoringId: targetMonitoringId,
                cameraId: camera.id,
                data: {
                  eventKey: eventKeyTrimmed,
                  reason: 'NO_ACTIVE_RECIPIENTS',
                },
                occurredAt: now,
              },
            });

            return {
              eventKey: alert.eventKey,
              accepted: true,
              duplicate: false,
              alertId: alert.id.toString(),
              acceptedAt: alert.createdAt.toISOString(),
              summary: {
                recipientsCount: 0,
                notificationsCount: 0,
                deliveriesCount: 0,
              },
            };
          }

          // 8. Inserir destinatários históricos congelados
          await tx.alertRecipient.createMany({
            data: activeAccesses.map((acc) => ({
              alertId: alert.id,
              userId: acc.userId,
              assignedAt: now,
            })),
          });

          // 9. Criar Notificações e Entregas PENDENTES
          const snapshotTitle =
            dto.title?.trim() || 'Possível situação de risco';
          const snapshotMessage =
            dto.message?.trim() || 'Abra o PoolSafe para verificar o alerta.';

          let totalDeliveries = 0;
          let totalNotifications = 0;

          for (const acc of activeAccesses) {
            totalNotifications++;

            // Localizar dispositivos ativos e com token válido (elegíveis para push)
            const userDevices = await tx.device.findMany({
              where: {
                userId: acc.userId,
                active: true,
                fcmToken: { not: null },
              },
            });

            const eligibleDevices = userDevices.filter(
              (d) =>
                typeof d.fcmToken === 'string' && d.fcmToken.trim().length > 0,
            );

            if (eligibleDevices.length > 0) {
              const notification = await tx.notification.create({
                data: {
                  alertId: alert.id,
                  userId: acc.userId,
                  title: snapshotTitle,
                  message: snapshotMessage,
                  status: 'PENDENTE',
                  createdAt: now,
                  processedAt: null,
                },
              });

              await tx.notificationDelivery.createMany({
                data: eligibleDevices.map((device) => ({
                  notificationId: notification.id,
                  deviceId: device.id,
                  status: 'PENDENTE',
                  attempts: 0,
                  createdAt: now,
                })),
              });

              totalDeliveries += eligibleDevices.length;
            } else {
              // Sem dispositivo elegível: notificação SEM_DISPOSITIVO sem criar entregas
              await tx.notification.create({
                data: {
                  alertId: alert.id,
                  userId: acc.userId,
                  title: snapshotTitle,
                  message: snapshotMessage,
                  status: 'SEM_DISPOSITIVO',
                  createdAt: now,
                  processedAt: now,
                },
              });
            }
          }

          return {
            eventKey: alert.eventKey,
            accepted: true,
            duplicate: false,
            alertId: alert.id.toString(),
            acceptedAt: alert.createdAt.toISOString(),
            summary: {
              recipientsCount: activeAccesses.length,
              notificationsCount: totalNotifications,
              deliveriesCount: totalDeliveries,
            },
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (error) {
      // Concorrência estrita: se uma transação paralela inseriu a mesma chave_evento
      // e causou conflito único P2002, recuperar o alerta gerado pela outra chamada
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.log(
          `Colisão simultânea de chave ${eventKeyTrimmed} capturada (P2002). Recuperando registro inserido paralelamente.`,
        );

        const concurrentAlert = await prisma.alert.findUnique({
          where: { eventKey: eventKeyTrimmed },
          include: {
            recipients: {
              include: {
                notification: {
                  include: {
                    deliveries: true,
                  },
                },
              },
            },
          },
        });

        if (concurrentAlert) {
          const recipientsCount = concurrentAlert.recipients.length;
          const notificationsCount = concurrentAlert.recipients.filter(
            (r) => r.notification != null,
          ).length;
          const deliveriesCount = concurrentAlert.recipients.reduce(
            (acc, r) => acc + (r.notification?.deliveries.length ?? 0),
            0,
          );

          return {
            eventKey: concurrentAlert.eventKey,
            accepted: true,
            duplicate: true,
            alertId: concurrentAlert.id.toString(),
            acceptedAt: concurrentAlert.createdAt.toISOString(),
            summary: {
              recipientsCount,
              notificationsCount,
              deliveriesCount,
            },
          };
        }
      }

      throw error;
    }
  }
}
