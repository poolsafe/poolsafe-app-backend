import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import {
  ActiveMonitoringAmbiguousException,
  ActiveMonitoringNotFoundException,
  CameraNotFoundException,
  CameraNotOperationalException,
  InvalidRiskEventException,
} from '../../common/errors/problem-details.exception.js';
import type { CreateInternalAlertDto } from './dto/create-internal-alert.dto.js';
import type { InternalAlertResponseDto } from './dto/internal-alert-response.dto.js';
import type { PurgeEvidenceResponseDto } from './dto/purge-evidence.dto.js';

export interface ValidatedEvidence {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  sizeBytes: bigint;
  hashSha256: string;
  expiresAt: Date;
}

export type EvidenceValidationResult =
  | { status: 'VALID'; evidence: ValidatedEvidence }
  | { status: 'DISCARDED'; reason: string; detail: string }
  | { status: 'ABSENT' };

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

          // 5. Validar evidência opcional com política resiliente (não aborta o evento se inválida)
          const evidenceResult = this.validateAndExtractEvidence(dto.evidence, now);

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

          if (evidenceResult.status === 'VALID') {
            await tx.alertEvidence.create({
              data: {
                alertId: alert.id,
                mimeType: evidenceResult.evidence.mimeType,
                content: Uint8Array.from(evidenceResult.evidence.buffer),
                sizeBytes: evidenceResult.evidence.sizeBytes,
                hashSha256: evidenceResult.evidence.hashSha256,
                expiresAt: evidenceResult.evidence.expiresAt,
                createdAt: now,
              },
            });
          } else if (evidenceResult.status === 'DISCARDED') {
            // Auditoria em log_sistema: registra motivo específico e sanitizado sem Base64 ou dados binários
            await tx.systemLog.create({
              data: {
                level: 'AVISO',
                category: 'ALERTA',
                description: `Evidência descartada: ${evidenceResult.detail}`,
                alertId: alert.id,
                monitoringId: targetMonitoringId,
                cameraId: camera.id,
                data: {
                  eventKey: eventKeyTrimmed,
                  reason: evidenceResult.reason,
                  detail: evidenceResult.detail,
                  declaredMimeType:
                    typeof (dto.evidence as Record<string, unknown>)?.['mimeType'] === 'string'
                      ? ((dto.evidence as Record<string, unknown>)['mimeType'] as string)
                      : null,
                },
                occurredAt: now,
              },
            });

            this.logger.warn(
              `Evidência descartada para alerta ${alert.id.toString()} [chave: ${eventKeyTrimmed}]: ${evidenceResult.reason} - ${evidenceResult.detail}`,
            );
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

  /**
   * Valida sintaxe, formato, tipos, tamanho e assinatura binária (magic bytes) da evidência.
   * Não lança exceção impeditiva: se a evidência estiver ausente, retorna ABSENT;
   * se estiver inconsistente, retorna DISCARDED com motivo e detalhe sanitizados.
   */
  private validateAndExtractEvidence(
    evidenceInput: unknown,
    now: Date,
  ): EvidenceValidationResult {
    if (evidenceInput === undefined || evidenceInput === null) {
      return { status: 'ABSENT' };
    }

    if (typeof evidenceInput !== 'object' || Array.isArray(evidenceInput)) {
      return {
        status: 'DISCARDED',
        reason: 'INVALID_STRUCTURE',
        detail: 'O campo evidence deve ser um objeto JSON.',
      };
    }

    const raw = evidenceInput as Record<string, unknown>;
    const mimeType = raw['mimeType'];
    const base64 = raw['base64'];

    if (typeof mimeType !== 'string' || typeof base64 !== 'string') {
      return {
        status: 'DISCARDED',
        reason: 'INVALID_FIELD_TYPES',
        detail: 'Os campos mimeType e base64 são obrigatórios e devem ser strings.',
      };
    }

    const normalizedMime = mimeType.trim().toLowerCase();
    if (normalizedMime !== 'image/jpeg' && normalizedMime !== 'image/png') {
      return {
        status: 'DISCARDED',
        reason: 'UNSUPPORTED_MIME_TYPE',
        detail: `Tipo MIME "${mimeType}" não suportado. Utilize image/jpeg ou image/png.`,
      };
    }

    const trimmedBase64 = base64.trim();
    if (trimmedBase64.length === 0) {
      return {
        status: 'DISCARDED',
        reason: 'EMPTY_BASE64',
        detail: 'A cadeia Base64 da evidência está vazia.',
      };
    }

    const sanitizedBase64 = trimmedBase64.replace(/\s+/g, '');
    if (
      sanitizedBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(sanitizedBase64)
    ) {
      return {
        status: 'DISCARDED',
        reason: 'INVALID_BASE64_SYNTAX',
        detail: 'A cadeia Base64 contém caracteres inválidos ou padding incorreto.',
      };
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(sanitizedBase64, 'base64');
    } catch {
      return {
        status: 'DISCARDED',
        reason: 'BASE64_DECODE_FAILED',
        detail: 'Falha ao decodificar a cadeia Base64.',
      };
    }

    if (buf.length === 0) {
      return {
        status: 'DISCARDED',
        reason: 'EMPTY_DECODED_BUFFER',
        detail: 'O conteúdo binário decodificado resultou em zero bytes.',
      };
    }

    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB
    if (buf.length > MAX_SIZE_BYTES) {
      return {
        status: 'DISCARDED',
        reason: 'EVIDENCE_TOO_LARGE',
        detail: `A evidência decodificada possui ${buf.length} bytes, excedendo o teto máximo de 5 MiB.`,
      };
    }

    // Validação de assinatura binária (magic bytes)
    if (normalizedMime === 'image/jpeg') {
      const isJpeg =
        buf.length >= 3 &&
        buf[0] === 0xff &&
        buf[1] === 0xd8 &&
        buf[2] === 0xff;

      if (!isJpeg) {
        return {
          status: 'DISCARDED',
          reason: 'BINARY_SIGNATURE_MISMATCH',
          detail: 'Os bytes binários decodificados não contêm a assinatura de cabeçalho JPEG válida (FF D8 FF).',
        };
      }
    } else if (normalizedMime === 'image/png') {
      const isPng =
        buf.length >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a;

      if (!isPng) {
        return {
          status: 'DISCARDED',
          reason: 'BINARY_SIGNATURE_MISMATCH',
          detail: 'Os bytes binários decodificados não contêm a assinatura completa de 8 bytes do PNG (89 50 4E 47 0D 0A 1A 0A).',
        };
      }
    }

    const hashSha256 = createHash('sha256').update(buf).digest('hex');
    const sizeBytes = BigInt(buf.length);
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      status: 'VALID',
      evidence: {
        buffer: buf,
        mimeType: normalizedMime as 'image/jpeg' | 'image/png',
        sizeBytes,
        hashSha256,
        expiresAt,
      },
    };
  }

  /**
   * Executa a rotina de expurgo periódico de evidências vencidas em lote atômico.
   *
   * Regras:
   * 1. Seleciona até `limit` registros com `expiresAt <= now`, `removedAt == null` e `content != null`.
   * 2. Ordenação estável por `expiresAt ASC`, `id ASC`.
   * 3. Projeta apenas IDs (não carrega LONGBLOBs na memória do processo).
   * 4. Atualiza atomicamente `content = null` e `removedAt = now` revalidando a elegibilidade.
   * 5. Retorna a contagem processada e sinaliza se há pendências adicionais (`hasMore`).
   * 6. Registra resumo operacional em `SystemLog` para auditoria.
   */
  async purgeExpiredEvidences(
    limit = 100,
    requestId = '',
  ): Promise<PurgeEvidenceResponseDto> {
    const prisma = this.prisma.getClient();
    const now = new Date();
    const safeLimit = Math.min(Math.max(limit, 1), 500);

    // 1. Localizar lote de evidências elegíveis sem carregar o binário LONGBLOB
    const expiredCandidates = await prisma.alertEvidence.findMany({
      where: {
        expiresAt: { lte: now },
        removedAt: null,
        content: { not: null },
      },
      select: {
        id: true,
        alertId: true,
      },
      orderBy: [
        { expiresAt: 'asc' },
        { id: 'asc' },
      ],
      take: safeLimit,
    });

    if (expiredCandidates.length === 0) {
      return {
        success: true,
        purgedCount: 0,
        hasMore: false,
        remainingCount: 0,
        executedAt: now.toISOString(),
      };
    }

    const idsToPurge = expiredCandidates.map((e) => e.id);

    // 2. Atualização atômica: limpa o LONGBLOB e preenche removida_em
    const updateResult = await prisma.alertEvidence.updateMany({
      where: {
        id: { in: idsToPurge },
        expiresAt: { lte: now },
        removedAt: null,
        content: { not: null },
      },
      data: {
        content: null,
        removedAt: now,
      },
    });

    // 3. Contar pendências restantes após o lote atual
    const remainingCount = await prisma.alertEvidence.count({
      where: {
        expiresAt: { lte: now },
        removedAt: null,
        content: { not: null },
      },
    });

    const hasMore = remainingCount > 0;

    // 4. Auditoria operacional em log_sistema
    await prisma.systemLog.create({
      data: {
        level: 'AVISO',
        category: 'SISTEMA',
        description: `Rotina de expurgo de evidências executada: ${updateResult.count} evidências limpas neste lote. Restantes: ${remainingCount}.`,
        data: {
          purgedCount: updateResult.count,
          remainingCount,
          hasMore,
          batchLimit: safeLimit,
          executedAt: now.toISOString(),
          requestId,
        },
        occurredAt: now,
      },
    });

    this.logger.log(
      `Expurgo de evidências concluído [req: ${requestId}]: ${updateResult.count} limpas, ${remainingCount} pendentes.`,
    );

    return {
      success: true,
      purgedCount: updateResult.count,
      hasMore,
      remainingCount,
      executedAt: now.toISOString(),
    };
  }
}
