import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service.js';
import {
  ResourceNotFoundException,
  ProblemDetailsException,
  EvidenceNotFoundException,
  EvidenceUnavailableException,
} from '../../common/errors/problem-details.exception.js';
import {
  generateAlertCursor,
  parseAndValidateAlertCursor,
} from './alerts-cursor.util.js';
import type { GetAlertsQueryDto } from './dto/get-alerts-query.dto.js';
import type {
  AlertsListResponse,
  AlertSummaryItem,
  AlertDetailResponse,
  AlertEvidenceInfo,
  AlertNotificationInfo,
  AlertSeverity,
} from './dto/alerts-response.dto.js';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private getCursorSecret(): string {
    return (
      this.configService.get<string>('ALERT_CURSOR_SECRET') ||
      'poolsafe-alerts-cursor-secret-default'
    );
  }

  /**
   * Consulta histórico paginado por cursor opaco dos alertas destinados ao usuário.
   * Conforme docs/api-contract.md Seção 17.2 e domain-model.md Seção 11.
   *
   * Regras:
   * - Apenas alertas dos quais o usuário é destinatário histórico (alerta_destinatario).
   * - A revogação posterior do acesso à câmera não remove o alerta do histórico.
   * - Ordenação fixa: detectedAt DESC, id DESC.
   * - Cursor opaco com integridade e assinatura HMAC-SHA256.
   * - Suporta filtros: cameraId, severity, from e to.
   */
  async getAlerts(
    userIdStr: string,
    query: GetAlertsQueryDto,
    requestId: string,
  ): Promise<AlertsListResponse> {
    const prisma = this.prisma.getClient();
    const userBigInt = BigInt(userIdStr);
    const now = new Date();
    const secret = this.getCursorSecret();

    const limit = query.limit ?? 20;

    // Validação de intervalo de datas (to posterior a from)
    if (query.from && query.to) {
      const fromDate = new Date(query.from);
      const toDate = new Date(query.to);
      if (toDate.getTime() <= fromDate.getTime()) {
        throw new ProblemDetailsException({
          status: 422,
          code: 'VALIDATION_ERROR',
          title: 'Dados inválidos',
          detail: 'O parâmetro to deve ser estritamente posterior a from.',
        });
      }
    }

    // Decodificação e validação do cursor se fornecido
    let cursorDate: Date | null = null;
    let cursorIdBigInt: bigint | null = null;

    if (query.cursor) {
      const cursorPayload = parseAndValidateAlertCursor(query.cursor, secret);
      cursorDate = new Date(cursorPayload.detectedAt);
      cursorIdBigInt = BigInt(cursorPayload.id);
    }

    // Montagem do filtro Where
    const whereClause: Prisma.AlertWhereInput = {
      recipients: {
        some: {
          userId: userBigInt,
        },
      },
    };

    if (query.cameraId) {
      whereClause.cameraId = BigInt(query.cameraId);
    }

    if (query.severity) {
      whereClause.severity = query.severity;
    }

    if (query.from || query.to) {
      whereClause.detectedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      };
    }

    if (cursorDate && cursorIdBigInt !== null) {
      whereClause.AND = [
        {
          OR: [
            { detectedAt: { lt: cursorDate } },
            {
              detectedAt: cursorDate,
              id: { lt: cursorIdBigInt },
            },
          ],
        },
      ];
    }

    // Busca limit + 1 para determinar hasMore
    const records = await prisma.alert.findMany({
      where: whereClause,
      orderBy: [
        { detectedAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
      include: {
        camera: true,
        evidence: {
          select: {
            expiresAt: true,
            removedAt: true,
          },
        },
      },
    });

    const hasMore = records.length > limit;
    const pageRecords = hasMore ? records.slice(0, limit) : records;

    let nextCursor: string | null = null;
    if (hasMore && pageRecords.length > 0) {
      const lastItem = pageRecords[pageRecords.length - 1]!;
      nextCursor = generateAlertCursor(
        lastItem.detectedAt,
        lastItem.id.toString(),
        secret,
      );
    }

    const data: AlertSummaryItem[] = pageRecords.map((alert) => {
      const isEvidenceAvailable = Boolean(
        alert.evidence &&
        alert.evidence.removedAt === null &&
        alert.evidence.expiresAt > now,
      );

      return {
        id: alert.id.toString(),
        type: alert.type,
        severity: alert.severity as AlertSeverity,
        detectedAt: alert.detectedAt.toISOString(),
        camera: {
          id: alert.camera.id.toString(),
          name: alert.camera.name,
          location: alert.camera.location ?? null,
        },
        evidenceAvailable: isEvidenceAvailable,
      };
    });

    return {
      data,
      pagination: {
        nextCursor,
        hasMore,
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Consulta os detalhes de um alerta do qual o usuário foi destinatário histórico.
   * Conforme docs/api-contract.md Seção 17.3.
   *
   * Regras:
   * - Retorna 404 indistinguível se o alerta não existir ou o usuário não for destinatário.
   * - Não expõe confiança, modelo, bounding boxes ou dados técnicos internos.
   * - Informa metadados da evidência e motivo de indisponibilidade se aplicável.
   */
  async getAlertDetails(
    alertIdStr: string,
    userIdStr: string,
    requestId: string,
  ): Promise<AlertDetailResponse> {
    if (!/^\d+$/.test(alertIdStr)) {
      throw new ResourceNotFoundException('Alerta não encontrado.');
    }

    const prisma = this.prisma.getClient();
    const alertBigInt = BigInt(alertIdStr);
    const userBigInt = BigInt(userIdStr);
    const now = new Date();

    const alert = await prisma.alert.findFirst({
      where: {
        id: alertBigInt,
        recipients: {
          some: {
            userId: userBigInt,
          },
        },
      },
      include: {
        camera: true,
        evidence: {
          select: {
            mimeType: true,
            expiresAt: true,
            removedAt: true,
          },
        },
        recipients: {
          where: {
            userId: userBigInt,
          },
          include: {
            notification: true,
          },
        },
      },
    });

    if (!alert) {
      throw new ResourceNotFoundException('Alerta não encontrado.');
    }

    // Avaliação do estado da evidência
    let evidenceInfo: AlertEvidenceInfo;
    if (!alert.evidence) {
      evidenceInfo = {
        available: false,
        mimeType: null,
        expiresAt: null,
        unavailableReason: 'NOT_CAPTURED',
      };
    } else if (alert.evidence.removedAt !== null) {
      evidenceInfo = {
        available: false,
        mimeType: alert.evidence.mimeType,
        expiresAt: alert.evidence.expiresAt.toISOString(),
        unavailableReason: 'REMOVED',
      };
    } else if (alert.evidence.expiresAt <= now) {
      evidenceInfo = {
        available: false,
        mimeType: alert.evidence.mimeType,
        expiresAt: alert.evidence.expiresAt.toISOString(),
        unavailableReason: 'EXPIRED',
      };
    } else {
      evidenceInfo = {
        available: true,
        mimeType: alert.evidence.mimeType,
        expiresAt: alert.evidence.expiresAt.toISOString(),
        unavailableReason: null,
      };
    }

    // Notificação associada ao destinatário
    let notificationInfo: AlertNotificationInfo | null = null;
    const recipientRecord = alert.recipients[0];
    if (recipientRecord?.notification) {
      notificationInfo = {
        status: recipientRecord.notification.status,
        processedAt: recipientRecord.notification.processedAt
          ? recipientRecord.notification.processedAt.toISOString()
          : null,
      };
    }

    return {
      data: {
        id: alert.id.toString(),
        type: alert.type,
        severity: alert.severity as AlertSeverity,
        detectedAt: alert.detectedAt.toISOString(),
        camera: {
          id: alert.camera.id.toString(),
          name: alert.camera.name,
          location: alert.camera.location ?? null,
        },
        monitoringId: alert.monitoringId.toString(),
        evidence: evidenceInfo,
        notification: notificationInfo,
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Obtém os bytes binários da evidência autorizada.
   * Conforme docs/api-contract.md Seção 17.4.
   *
   * Regras:
   * - Exige que o usuário seja destinatário histórico do alerta.
   * - Retorna 404 se alerta inexistente ou não autorizado.
   * - Retorna 404 EVIDENCE_NOT_FOUND se nunca foi capturada evidência.
   * - Retorna 410 EVIDENCE_UNAVAILABLE com reason 'REMOVED' ou 'EXPIRED'.
   * - Não expõe o conteúdo se expiresAt já foi alcançado, mesmo com bytes ainda presentes.
   */
  async getAlertEvidence(
    alertIdStr: string,
    userIdStr: string,
  ): Promise<{ buffer: Buffer; mimeType: string; alertId: string }> {
    if (!/^\d+$/.test(alertIdStr)) {
      throw new ResourceNotFoundException('Alerta não encontrado.');
    }

    const prisma = this.prisma.getClient();
    const alertBigInt = BigInt(alertIdStr);
    const userBigInt = BigInt(userIdStr);
    const now = new Date();

    const recipient = await prisma.alertRecipient.findFirst({
      where: {
        alertId: alertBigInt,
        userId: userBigInt,
      },
      include: {
        alert: {
          include: {
            evidence: true,
          },
        },
      },
    });

    if (!recipient) {
      throw new ResourceNotFoundException('Alerta não encontrado.');
    }

    const evidence = recipient.alert.evidence;

    // 1. Evidência nunca capturada
    if (!evidence) {
      throw new EvidenceNotFoundException(
        'Evidência não encontrada para este alerta.',
      );
    }

    // 2. Evidência removida
    if (evidence.removedAt !== null || evidence.content === null) {
      throw new EvidenceUnavailableException(
        'Evidência removida do sistema.',
        'REMOVED',
      );
    }

    // 3. Evidência expirada pelo tempo de retenção
    if (evidence.expiresAt <= now) {
      throw new EvidenceUnavailableException(
        'Evidência expirada conforme período de retenção.',
        'EXPIRED',
      );
    }

    return {
      buffer: Buffer.from(evidence.content),
      mimeType: evidence.mimeType,
      alertId: alertBigInt.toString(),
    };
  }
}
