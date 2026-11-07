import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AlertNotFoundException,
  DeliveryNotFoundException,
  ProblemDetailsException,
} from '../../common/errors/problem-details.exception.js';
import type { InternalDeliveriesListResponseDto } from './dto/internal-deliveries-list.dto.js';
import type {
  FcmAlertPayloadDataDto,
  FcmMessageHttpV1Dto,
  PrepareAttemptResponseDto,
} from './dto/prepare-attempt-response.dto.js';
import type { RecordDeliveryResultDto } from './dto/record-delivery-result.dto.js';
import type { RecordDeliveryResultResponseDto } from './dto/record-delivery-result-response.dto.js';

export const MAX_DELIVERY_ATTEMPTS = 3;
export const IN_FLIGHT_WINDOW_MS = 20_000; // 20 segundos de proteção para tentativa em voo

/**
 * Faz parse do header Retry-After suportando tanto segundos inteiros (ex: "120")
 * quanto data HTTP no formato IMF-fixdate / RFC 7231 (ex: "Wed, 21 Oct 2026 07:28:00 GMT").
 */
export function parseRetryAfterHeader(
  val: string | number | undefined | null,
  now = new Date(),
): number | null {
  if (val === undefined || val === null) return null;

  if (typeof val === 'number') {
    return val > 0 ? Math.round(val * 1000) : null;
  }

  const trimmed = val.trim();
  if (trimmed.length === 0) return null;

  // Valor numérico em segundos (ex.: "60")
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return seconds > 0 ? seconds * 1000 : null;
  }

  // Data HTTP (ex.: "Wed, 21 Oct 2026 07:28:00 GMT")
  const parsedDate = new Date(trimmed);
  if (!isNaN(parsedDate.getTime())) {
    const diffMs = parsedDate.getTime() - now.getTime();
    return diffMs > 0 ? diffMs : null;
  }

  return null;
}

/**
 * Calcula o atraso de retry para falhas retryable:
 * - Se fornecido Retry-After (segundos ou data HTTP): respeita estritamente o header;
 * - Se status/código for 429 sem Retry-After: utiliza 60 segundos fixos;
 * - Para as demais falhas retryable: backoff exponencial com jitter e intervalo mínimo de 10s.
 */
export function calculateRetryDelayMs(
  attempts: number,
  errorCode?: string | null,
  retryAfterHeader?: string | number | null,
  now = new Date(),
): number {
  // 1. Header Retry-After explícito
  const fromHeader = parseRetryAfterHeader(retryAfterHeader, now);
  if (fromHeader !== null && fromHeader > 0) {
    return fromHeader;
  }

  const code = (errorCode || '').toUpperCase();

  // 2. HTTP 429 ou Quota/Rate Exceeded sem header Retry-After -> 60 segundos
  if (
    code === '429' ||
    code === 'QUOTA_EXCEEDED' ||
    code === 'RESOURCE_EXHAUSTED' ||
    code === 'RATE_LIMITED'
  ) {
    return 60_000;
  }

  // 3. Demais falhas retryable: base de 10s com backoff exponencial e jitter
  const baseSeconds = 10;
  const multiplier = Math.pow(2, Math.max(0, attempts - 1));
  const delaySeconds = baseSeconds * multiplier;
  const maxJitter = Math.min(5, delaySeconds * 0.2);
  const jitterSeconds = Math.random() * maxJitter;

  return Math.round((delaySeconds + jitterSeconds) * 1000);
}

/**
 * Distingue se uma rejeição do FCM v1 é específica de token utilizando os
 * detalhes estruturados do FCM e evidência inequívoca de rejeição do token,
 * NUNCA classificando INVALID_ARGUMENT por simples substring de texto livre.
 */
export function isTokenSpecificRejection(
  errorCode?: string | null,
  errorDetail?: string | null,
  providerResponse?: Record<string, unknown> | null,
): boolean {
  const code = (errorCode || '').toUpperCase();

  // 1. Código explícito UNREGISTERED (código oficial de rejeição de token no FCM v1)
  if (code === 'UNREGISTERED') {
    return true;
  }

  // 2. Inspecionar estrutura formal de resposta do FCM / Google APIs (RPC BadRequest e FcmError)
  if (providerResponse && typeof providerResponse === 'object') {
    const errorObj =
      (providerResponse['error'] as Record<string, unknown>) || providerResponse;

    const details = (errorObj['details'] || providerResponse['details']) as
      | Array<Record<string, unknown>>
      | undefined;

    if (Array.isArray(details)) {
      for (const item of details) {
        // Objeto FcmError estruturado
        if (item['errorCode'] === 'UNREGISTERED') {
          return true;
        }

        // ErrorInfo com motivo canônico de token
        if (
          item['reason'] === 'BAD_REGISTRATION_TOKEN' ||
          item['reason'] === 'REGISTRATION_TOKEN_NOT_REGISTERED'
        ) {
          return true;
        }

        // BadRequest fieldViolations apontando especificamente para o campo token
        const fieldViolations = item['fieldViolations'] as
          | Array<Record<string, unknown>>
          | undefined;

        if (Array.isArray(fieldViolations)) {
          const hasTokenViolation = fieldViolations.some((v) => {
            const field = String(v['field'] || '');
            return (
              field === 'message.token' ||
              field === 'token' ||
              field === 'registration_token'
            );
          });
          if (hasTokenViolation) {
            return true;
          }
        }
      }
    }
  }

  // Se for INVALID_ARGUMENT sem violação estruturada no campo token, NÃO é erro de token!
  return false;
}

/**
 * Identifica se a falha decorre de erro irrecuperável de payload ou credencial de serviço
 * (ex: Google Service Account não autorizada ou formato de payload violado),
 * onde o FCM Token é inocente e deve ser estritamente preservado.
 */
export function isPayloadOrCredentialError(
  errorCode?: string | null,
  errorDetail?: string | null,
  isTokenRejection = false,
): boolean {
  if (isTokenRejection) return false;
  const code = (errorCode || '').toUpperCase();

  if (
    code === 'UNAUTHENTICATED' ||
    code === 'PERMISSION_DENIED' ||
    code === 'CREDENTIAL_ERROR' ||
    code === 'AUTH_ERROR'
  ) {
    return true;
  }

  if (
    code === 'INVALID_ARGUMENT' ||
    code === 'PAYLOAD_ERROR' ||
    code === 'BAD_REQUEST'
  ) {
    return true;
  }

  return false;
}

export interface DeliveryErrorMetadata {
  attemptNumber?: number;
  retryAfterMs?: number;
  recordedAt?: number;
  rotated?: boolean;
}

export function parseDeliveryMetadata(rawDetail?: string | null): {
  meta: DeliveryErrorMetadata;
  cleanDetail: string | null;
} {
  if (!rawDetail) {
    return { meta: {}, cleanDetail: null };
  }

  // Formato técnico padronizado: [meta:key1=val1;key2=val2] <human_text>
  const metaMatch = rawDetail.match(/^\[meta:([^\]]+)\]\s*(.*)$/s);
  if (metaMatch) {
    const rawPairs = metaMatch[1];
    const textRest = metaMatch[2].trim();
    const meta: DeliveryErrorMetadata = {};

    for (const pair of rawPairs.split(';')) {
      const [k, v] = pair.split('=');
      if (k === 'attempt') meta.attemptNumber = Number(v);
      if (k === 'retry_after_ms') meta.retryAfterMs = Number(v);
      if (k === 'recorded_at') meta.recordedAt = Number(v);
      if (k === 'rotated') meta.rotated = v === 'true' || v === '1';
    }

    return {
      meta,
      cleanDetail: textRest.length > 0 ? textRest : null,
    };
  }

  // Compatibilidade com formato anterior: [retry_after_ms:xxx;recorded_at:yyy]
  const legacyMatch = rawDetail.match(
    /^\[retry_after_ms:(\d+)(?:;recorded_at:(\d+))?\]\s*(.*)$/s,
  );
  if (legacyMatch) {
    const meta: DeliveryErrorMetadata = {
      retryAfterMs: Number(legacyMatch[1]),
      recordedAt: legacyMatch[2] ? Number(legacyMatch[2]) : undefined,
    };
    const textRest = legacyMatch[3].trim();
    return {
      meta,
      cleanDetail: textRest.length > 0 ? textRest : null,
    };
  }

  return {
    meta: {},
    cleanDetail: rawDetail.trim().length > 0 ? rawDetail.trim() : null,
  };
}

export function formatDeliveryErrorDetail(
  meta: DeliveryErrorMetadata,
  humanText?: string | null,
): string | null {
  const parts: string[] = [];
  if (meta.attemptNumber !== undefined && !isNaN(meta.attemptNumber)) {
    parts.push(`attempt=${meta.attemptNumber}`);
  }
  if (meta.retryAfterMs !== undefined && !isNaN(meta.retryAfterMs)) {
    parts.push(`retry_after_ms=${Math.round(meta.retryAfterMs)}`);
  }
  if (meta.recordedAt !== undefined && !isNaN(meta.recordedAt)) {
    parts.push(`recorded_at=${Math.round(meta.recordedAt)}`);
  }
  if (meta.rotated) {
    parts.push(`rotated=true`);
  }

  const clean = humanText ? humanText.trim() : '';

  if (parts.length === 0) {
    return clean.length > 0 ? clean.slice(0, 500) : null;
  }

  const prefix = `[meta:${parts.join(';')}]`;
  if (clean.length > 0) {
    return `${prefix} ${clean}`.slice(0, 500);
  }
  return prefix.slice(0, 500);
}

export function cleanErrorDetail(detail?: string | null): string | null {
  return parseDeliveryMetadata(detail).cleanDetail;
}

function calculatePendingBackoff(
  delivery: {
    attempts: number;
    lastAttemptAt: Date | null;
    errorCode: string | null;
    errorDetail: string | null;
  },
  nowMs: number = Date.now(),
): { retryAfterMs?: number; nextAttemptAllowedAt: string | null } {
  if (!delivery.lastAttemptAt || delivery.attempts <= 0) {
    return { nextAttemptAllowedAt: null };
  }

  let requiredIntervalMs = 0;
  let referenceTimeMs = delivery.lastAttemptAt.getTime();

  const { meta } = parseDeliveryMetadata(delivery.errorDetail);

  if (meta.retryAfterMs !== undefined && meta.retryAfterMs > 0) {
    requiredIntervalMs = meta.retryAfterMs;
    if (meta.recordedAt !== undefined && meta.recordedAt > 0) {
      referenceTimeMs = meta.recordedAt;
    }
  } else {
    const is429 =
      delivery.errorCode === '429' ||
      delivery.errorCode === 'QUOTA_EXCEEDED' ||
      delivery.errorCode === 'RESOURCE_EXHAUSTED';

    requiredIntervalMs = is429
      ? 60_000
      : 10_000 * Math.pow(2, Math.max(0, delivery.attempts - 1));
  }

  const elapsed = nowMs - referenceTimeMs;
  if (elapsed < requiredIntervalMs) {
    const retryAfterMs = requiredIntervalMs - elapsed;
    const nextAttemptAllowedAt = new Date(
      referenceTimeMs + requiredIntervalMs,
    ).toISOString();
    return { retryAfterMs, nextAttemptAllowedAt };
  }

  return { nextAttemptAllowedAt: null };
}

@Injectable()
export class InternalDeliveriesService {
  private readonly logger = new Logger(InternalDeliveriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private parseBigInt(val: string, fieldName: string): bigint {
    try {
      return BigInt(val.trim());
    } catch {
      throw new DeliveryNotFoundException(
        `Identificador ${fieldName} inválido: ${val}`,
      );
    }
  }

  /**
   * 1. Obter as entregas de um alerta aceito (com filtro opcional por status).
   */
  async getDeliveriesByAlertId(
    alertIdStr: string,
    statusFilter?: string,
  ): Promise<InternalDeliveriesListResponseDto> {
    const alertId = this.parseBigInt(alertIdStr, 'alertId');
    const prisma = this.prisma.getClient();

    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      select: { id: true },
    });

    if (!alert) {
      throw new AlertNotFoundException(
        `Alerta ${alertIdStr} não encontrado no sistema.`,
      );
    }

    const deliveries = await prisma.notificationDelivery.findMany({
      where: {
        notification: { alertId },
        ...(statusFilter && statusFilter.trim().length > 0
          ? { status: statusFilter.trim() }
          : {}),
      },
      include: {
        notification: {
          select: { id: true, userId: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    return {
      alertId: alert.id.toString(),
      totalDeliveries: deliveries.length,
      deliveries: deliveries.map((d) => ({
        id: d.id.toString(),
        notificationId: d.notificationId.toString(),
        deviceId: d.deviceId.toString(),
        userId: d.notification.userId.toString(),
        status: d.status,
        attempts: d.attempts,
        fcmMessageId: d.fcmMessageId,
        errorCode: d.errorCode,
        errorDetail: cleanErrorDetail(d.errorDetail),
        lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null,
        sentAt: d.sentAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Consulta uma entrega específica pelo ID e calcula o próximo instante permitido.
   */
  async getDeliveryById(
    deliveryIdStr: string,
  ): Promise<PrepareAttemptResponseDto> {
    const deliveryId = this.parseBigInt(deliveryIdStr, 'deliveryId');
    const prisma = this.prisma.getClient();

    const delivery = await prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: true,
        device: true,
      },
    });

    if (!delivery) {
      throw new DeliveryNotFoundException(
        `Entrega ${deliveryIdStr} não encontrada.`,
      );
    }

    const { retryAfterMs, nextAttemptAllowedAt } = calculatePendingBackoff(
      delivery,
      Date.now(),
    );

    return {
      ready: delivery.status === 'PENDENTE' && (retryAfterMs === undefined || retryAfterMs <= 0),
      deliveryId: delivery.id.toString(),
      notificationId: delivery.notificationId.toString(),
      alertId: delivery.notification.alertId.toString(),
      deviceId: delivery.deviceId.toString(),
      userId: delivery.notification.userId.toString(),
      status: delivery.status,
      attempts: delivery.attempts,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
      reason: delivery.status,
      retryAfterMs,
      nextAttemptAllowedAt,
    };
  }

  /**
   * 2. Preparar e registrar cada tentativa antes da chamada externa,
   * fornecendo o token atual elegível e os dados do payload.
   *
   * Regras aplicadas:
   * - Bloqueio pessimista exclusivo para serializar preparações da mesma entrega;
   * - Não reenviar entregas já ENVIADAS;
   * - Revalidar a elegibilidade e o vínculo do dispositivo ao destinatário;
   * - Impedir preparação simultânea da mesma tentativa em voo (in-flight);
   * - Incrementar tentativas uma única vez por tentativa preparada;
   * - Bloquear preparação antecipada antes de decorrido o backoff mínimo;
   * - Aplicar limite cumulativo de tentativas (máx 3);
   * - Finaliza e comita a transação antes da chamada externa (sem transação aberta).
   */
  async prepareAttempt(
    deliveryIdStr: string,
  ): Promise<PrepareAttemptResponseDto> {
    const deliveryId = this.parseBigInt(deliveryIdStr, 'deliveryId');
    const prisma = this.prisma.getClient();

    return prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // 1. Bloqueio pessimista exclusivo na linha da entrega
        await tx.$queryRaw`
          SELECT id FROM entrega_notificacao
          WHERE id = ${deliveryId}
          FOR UPDATE
        `;

        const delivery = await tx.notificationDelivery.findUnique({
          where: { id: deliveryId },
          include: {
            notification: {
              include: {
                alertRecipient: {
                  include: {
                    alert: true,
                  },
                },
              },
            },
            device: true,
          },
        });

        if (!delivery) {
          throw new DeliveryNotFoundException(
            `Entrega ${deliveryIdStr} não encontrada.`,
          );
        }

        // 2. Não reenviar entregas já ENVIADAS
        if (delivery.status === 'ENVIADA') {
          return {
            ready: false,
            deliveryId: delivery.id.toString(),
            reason: 'ALREADY_SENT',
            status: 'ENVIADA',
            attempts: delivery.attempts,
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
            notificationId: delivery.notificationId.toString(),
            alertId: delivery.notification.alertId.toString(),
            deviceId: delivery.deviceId.toString(),
            userId: delivery.notification.userId.toString(),
          };
        }

        // 3. Entrega em falha terminal consolidada ou token inválido
        if (delivery.status === 'FALHA' || delivery.status === 'TOKEN_INVALIDO') {
          return {
            ready: false,
            deliveryId: delivery.id.toString(),
            reason: 'TERMINAL_FAILURE',
            status: delivery.status,
            attempts: delivery.attempts,
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
            notificationId: delivery.notificationId.toString(),
            alertId: delivery.notification.alertId.toString(),
            deviceId: delivery.deviceId.toString(),
            userId: delivery.notification.userId.toString(),
          };
        }

        // 4. Revalidar a elegibilidade e o vínculo do dispositivo ao destinatário
        const device = delivery.device;
        const isDeviceLinked =
          device != null && device.userId === delivery.notification.userId;
        const isDeviceActive = device != null && device.active === true;
        const hasValidToken =
          device != null &&
          typeof device.fcmToken === 'string' &&
          device.fcmToken.trim().length > 0;

        if (!isDeviceLinked || !isDeviceActive || !hasValidToken) {
          this.logger.warn(
            `Dispositivo ${delivery.deviceId.toString()} não é elegível para entrega ${delivery.id.toString()} (ativo: ${isDeviceActive}, vinculado: ${isDeviceLinked}, tokenPresente: ${hasValidToken}). Marcando entrega como FALHA.`,
          );

          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'FALHA',
              errorCode: 'DEVICE_INELIGIBLE',
              errorDetail:
                'Dispositivo inativo, desvinculado do usuário ou sem FCM token válido.',
            },
          });

          await this.consolidateNotificationStatus(tx, delivery.notificationId);

          return {
            ready: false,
            deliveryId: delivery.id.toString(),
            reason: 'DEVICE_INELIGIBLE',
            status: 'FALHA',
            attempts: delivery.attempts,
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
            notificationId: delivery.notificationId.toString(),
            alertId: delivery.notification.alertId.toString(),
            deviceId: delivery.deviceId.toString(),
            userId: delivery.notification.userId.toString(),
          };
        }

        // 5. Aplicar limite cumulativo de tentativas
        if (delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
          this.logger.warn(
            `Entrega ${delivery.id.toString()} excedeu o limite cumulativo de tentativas (${delivery.attempts}/${MAX_DELIVERY_ATTEMPTS}).`,
          );

          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'FALHA',
              errorCode: delivery.errorCode || 'MAX_ATTEMPTS_EXCEEDED',
              errorDetail:
                delivery.errorDetail ||
                'Limite cumulativo de tentativas esgotado sem sucesso.',
            },
          });

          await this.consolidateNotificationStatus(tx, delivery.notificationId);

          return {
            ready: false,
            deliveryId: delivery.id.toString(),
            reason: 'MAX_ATTEMPTS_EXCEEDED',
            status: 'FALHA',
            attempts: delivery.attempts,
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
            notificationId: delivery.notificationId.toString(),
            alertId: delivery.notification.alertId.toString(),
            deviceId: delivery.deviceId.toString(),
            userId: delivery.notification.userId.toString(),
          };
        }

        // 6. Impedir preparação simultânea da mesma tentativa em voo (in-flight attempt)
        // Uma tentativa está em voo enquanto já foi iniciada (lastAttemptAt != null) e ainda
        // não possui resultado registrado (errorCode === null).
        const isAttemptInFlight =
          delivery.lastAttemptAt != null && delivery.errorCode === null;

        if (isAttemptInFlight) {
          const elapsedMs = now.getTime() - delivery.lastAttemptAt!.getTime();
          if (elapsedMs < IN_FLIGHT_WINDOW_MS) {
            const retryAfterMs = IN_FLIGHT_WINDOW_MS - elapsedMs;
            const nextAttemptAllowedAt = new Date(
              delivery.lastAttemptAt!.getTime() + IN_FLIGHT_WINDOW_MS,
            ).toISOString();

            this.logger.log(
              `Entrega ${delivery.id.toString()} possui tentativa recente em andamento (${elapsedMs}ms atrás). Rejeitando preparação concorrente.`,
            );

            return {
              ready: false,
              deliveryId: delivery.id.toString(),
              reason: 'ATTEMPT_IN_PROGRESS',
              status: delivery.status,
              attempts: delivery.attempts,
              maxAttempts: MAX_DELIVERY_ATTEMPTS,
              notificationId: delivery.notificationId.toString(),
              alertId: delivery.notification.alertId.toString(),
              deviceId: delivery.deviceId.toString(),
              userId: delivery.notification.userId.toString(),
              retryAfterMs,
              nextAttemptAllowedAt,
            };
          }
        }

        // 7. Bloquear preparação antecipada antes de decorrido o prazo obrigatório de backoff
        if (delivery.attempts > 0 && delivery.lastAttemptAt) {
          const { retryAfterMs, nextAttemptAllowedAt } =
            calculatePendingBackoff(delivery, now.getTime());

          if (retryAfterMs !== undefined && retryAfterMs > 0) {
            return {
              ready: false,
              deliveryId: delivery.id.toString(),
              reason: 'BACKOFF_REQUIRED',
              status: delivery.status,
              attempts: delivery.attempts,
              maxAttempts: MAX_DELIVERY_ATTEMPTS,
              notificationId: delivery.notificationId.toString(),
              alertId: delivery.notification.alertId.toString(),
              deviceId: delivery.deviceId.toString(),
              userId: delivery.notification.userId.toString(),
              retryAfterMs,
              nextAttemptAllowedAt,
            };
          }
        }

        // 8. Preparação autorizada: incrementar tentativas exatamente UMA vez
        const nextAttempt = delivery.attempts + 1;

        // Preserva o marcador de rotação caso já tenha sido concedido na entrega
        const { meta: currentMeta } = parseDeliveryMetadata(delivery.errorDetail);
        const preservedMeta: DeliveryErrorMetadata = {};
        if (currentMeta.rotated) {
          preservedMeta.rotated = true;
        }
        const nextErrorDetail = formatDeliveryErrorDetail(preservedMeta, null);

        await tx.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts: nextAttempt,
            lastAttemptAt: now,
            errorCode: null,
            errorDetail: nextErrorDetail,
          },
        });

        // 9. Montagem do payload definido (data-only, Android HIGH, todas as propriedades como string)
        const targetToken = device.fcmToken!;
        const originalDetectedAt =
          delivery.notification.alertRecipient?.alert?.detectedAt?.toISOString() ||
          delivery.notification.createdAt.toISOString();

        const alertSeverity =
          delivery.notification.alertRecipient?.alert?.severity === 'ATENCAO'
            ? 'ATENCAO'
            : 'CRITICA';

        const payloadData: FcmAlertPayloadDataDto = {
          schemaVersion: '1',
          type: 'ALERT',
          alertId: delivery.notification.alertId.toString(),
          deliveryId: delivery.id.toString(),
          severity: alertSeverity,
          title: delivery.notification.title,
          message: delivery.notification.message,
          channelId:
            alertSeverity === 'CRITICA'
              ? 'poolsafe_alertas_criticos_v2'
              : 'poolsafe_delayed_alerts_v1',
          detectedAt: originalDetectedAt,
        };

        const fcmMessage: FcmMessageHttpV1Dto = {
          token: targetToken,
          data: payloadData,
          android: {
            priority: 'HIGH',
            ttl: '300s',
          },
        };

        this.logger.log(
          `Tentativa ${nextAttempt} preparada para entrega ${delivery.id.toString()} (alerta: ${delivery.notification.alertId.toString()}, destinatário: ${delivery.notification.userId.toString()}).`,
        );

        return {
          ready: true,
          deliveryId: delivery.id.toString(),
          reason: 'READY',
          status: 'PENDENTE',
          attempts: nextAttempt,
          maxAttempts: MAX_DELIVERY_ATTEMPTS,
          attemptNumber: nextAttempt,
          notificationId: delivery.notificationId.toString(),
          alertId: delivery.notification.alertId.toString(),
          deviceId: delivery.deviceId.toString(),
          userId: delivery.notification.userId.toString(),
          targetToken,
          payload: payloadData,
          fcmMessage,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /**
   * 3. Registrar o resultado da tentativa: aceite com fcm_message_id,
   * falha transitória, falha definitiva ou resultado desconhecido.
   *
   * Regras aplicadas:
   * - Vinculação estrita entre resultado, attemptNumber e token usado;
   * - Preserva aceites legítimos tardios mesmo com attemptNumber anterior;
   * - Erros e timeouts defasados (attemptNumber < delivery.attempts) são ignorados
   *   sem alterar a tentativa atual nem o estado do dispositivo;
   * - Aceite com fcm_message_id marca status ENVIADA e consolida notificação como PROCESSADA;
   * - Respeita Retry-After (segundos ou data HTTP); 429 sem header = 60 segundos;
   *   backoff exponencial com jitter e mínimo de 10s para outras falhas retryable;
   * - Não classificar INVALID_ARGUMENT por substring no texto do erro: usar detalhes estruturados;
   * - Falha definitiva de token utiliza estado TOKEN_INVALIDO previsto no schema;
   * - Rotação concorrente: máximo 1 retry por rotação na mesma entrega, estritamente
   *   dentro do teto cumulativo de 3 tentativas;
   * - Não retorna canRetry=true se o limite cumulativo for atingido;
   * - Não registrar tokens ou respostas sensíveis em logs.
   */
  async recordResult(
    deliveryIdStr: string,
    dto: RecordDeliveryResultDto,
  ): Promise<RecordDeliveryResultResponseDto> {
    const deliveryId = this.parseBigInt(deliveryIdStr, 'deliveryId');
    const prisma = this.prisma.getClient();

    return prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // 1. Bloqueio pessimista exclusivo na linha da entrega
        await tx.$queryRaw`
          SELECT id FROM entrega_notificacao
          WHERE id = ${deliveryId}
          FOR UPDATE
        `;

        const delivery = await tx.notificationDelivery.findUnique({
          where: { id: deliveryId },
          include: {
            notification: true,
            device: true,
          },
        });

        if (!delivery) {
          throw new DeliveryNotFoundException(
            `Entrega ${deliveryIdStr} não encontrada.`,
          );
        }

        // 2. Proteção contra sobrescrita de entregas já ENVIADAS
        if (delivery.status === 'ENVIADA') {
          if (dto.resultType === 'ACCEPTED') {
            this.logger.log(
              `Registro de aceite duplicado recebido para entrega ${delivery.id.toString()}. Mantendo aceite original.`,
            );
            return {
              deliveryId: delivery.id.toString(),
              notificationId: delivery.notificationId.toString(),
              status: 'ENVIADA',
              attempts: delivery.attempts,
              fcmMessageId: delivery.fcmMessageId,
              errorCode: null,
              errorDetail: null,
              notificationStatus:
                delivery.notification.status === 'PENDENTE'
                  ? 'PROCESSADA'
                  : delivery.notification.status,
              tokenInvalidated: false,
              canRetryWithNewToken: false,
              canRetry: false,
              backoffDelayMs: 0,
              duplicate: true,
              ignored: false,
              reason: 'ALREADY_SENT_DUPLICATE',
            };
          }

          this.logger.warn(
            `Resposta atrasada de falha ignorada para entrega ${delivery.id.toString()} já marcada como ENVIADA (fcmMessageId: ${delivery.fcmMessageId}).`,
          );
          return {
            deliveryId: delivery.id.toString(),
            notificationId: delivery.notificationId.toString(),
            status: 'ENVIADA',
            attempts: delivery.attempts,
            fcmMessageId: delivery.fcmMessageId,
            errorCode: delivery.errorCode,
            errorDetail: cleanErrorDetail(delivery.errorDetail),
            notificationStatus:
              delivery.notification.status === 'PENDENTE'
                ? 'PROCESSADA'
                : delivery.notification.status,
            tokenInvalidated: false,
            canRetryWithNewToken: false,
            canRetry: false,
            backoffDelayMs: 0,
            duplicate: false,
            ignored: true,
            reason: 'IGNORED_LATE_RESPONSE_ALREADY_SENT',
          };
        }

        // Validação de consistência do attemptNumber (apenas para entregas não enviadas)
        if (dto.attemptNumber > delivery.attempts) {
          throw new ProblemDetailsException({
            status: 422,
            code: 'INVALID_ATTEMPT_NUMBER',
            title: 'Tentativa não preparada',
            detail: `O attemptNumber ${dto.attemptNumber} informado é maior que o número de tentativas preparadas (${delivery.attempts}).`,
          });
        }

        // 3. Processamento de ACEITE do FCM (inclusive aceites legítimos tardios)
        if (dto.resultType === 'ACCEPTED') {
          const messageId = dto.fcmMessageId?.trim() || null;

          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'ENVIADA',
              fcmMessageId: messageId,
              sentAt: now,
              errorCode: null,
              errorDetail: null,
            },
          });

          const notificationStatus =
            await this.consolidateNotificationStatus(tx, delivery.notificationId);

          this.logger.log(
            `Entrega ${delivery.id.toString()} aceita com sucesso pelo FCM (fcmMessageId registrado).`,
          );

          return {
            deliveryId: delivery.id.toString(),
            notificationId: delivery.notificationId.toString(),
            status: 'ENVIADA',
            attempts: delivery.attempts,
            fcmMessageId: messageId,
            errorCode: null,
            errorDetail: null,
            notificationStatus,
            tokenInvalidated: false,
            canRetryWithNewToken: false,
            canRetry: false,
            backoffDelayMs: 0,
            duplicate: false,
            ignored: false,
            reason: 'ACCEPTED_BY_FCM',
          };
        }

        // 4. Tratar erros atrasados de tentativas anteriores (attemptNumber < delivery.attempts)
        // Se a tentativa 2 já foi preparada e a resposta atrasada de erro da tentativa 1 chega agora,
        // ela NÃO PODE alterar a tentativa atual nem o estado do dispositivo!
        if (dto.attemptNumber < delivery.attempts) {
          this.logger.warn(
            `Resultado de erro atrasado da tentativa ${dto.attemptNumber} ignorado para entrega ${delivery.id.toString()} (tentativa atual: ${delivery.attempts}).`,
          );

          return {
            deliveryId: delivery.id.toString(),
            notificationId: delivery.notificationId.toString(),
            status: delivery.status,
            attempts: delivery.attempts,
            fcmMessageId: delivery.fcmMessageId,
            errorCode: delivery.errorCode,
            errorDetail: delivery.errorDetail,
            notificationStatus: delivery.notification.status,
            tokenInvalidated: false,
            canRetryWithNewToken: false,
            canRetry:
              delivery.status === 'PENDENTE' &&
              delivery.attempts < MAX_DELIVERY_ATTEMPTS,
            backoffDelayMs: 0,
            duplicate: false,
            ignored: true,
            reason: 'IGNORED_STALE_ATTEMPT_RESULT',
          };
        }

        // 4B. Repetição de resultado para a tentativa corrente já finalizada
        // Não recalcula jitter, não reinicia recorded_at e não consome outra autorização de rotação
        const { meta: currentMeta, cleanDetail } = parseDeliveryMetadata(
          delivery.errorDetail,
        );

        if (
          dto.attemptNumber === delivery.attempts &&
          currentMeta.attemptNumber === dto.attemptNumber
        ) {
          const isRotation =
            delivery.errorCode === 'TOKEN_ROTATED_PENDING_RETRY';

          this.logger.log(
            `Resultado duplicado para a tentativa corrente ${dto.attemptNumber} da entrega ${delivery.id.toString()}. Mantendo resultado original sem recalcular prazo.`,
          );

          return {
            deliveryId: delivery.id.toString(),
            notificationId: delivery.notificationId.toString(),
            status: delivery.status,
            attempts: delivery.attempts,
            fcmMessageId: delivery.fcmMessageId,
            errorCode: delivery.errorCode,
            errorDetail: cleanDetail,
            notificationStatus: delivery.notification.status,
            tokenInvalidated: false,
            canRetryWithNewToken: isRotation,
            canRetry:
              delivery.status === 'PENDENTE' &&
              delivery.attempts < MAX_DELIVERY_ATTEMPTS,
            backoffDelayMs: currentMeta.retryAfterMs ?? 0,
            nextAttemptAllowedAt:
              currentMeta.recordedAt && currentMeta.retryAfterMs
                ? new Date(
                    currentMeta.recordedAt + currentMeta.retryAfterMs,
                  ).toISOString()
                : null,
            duplicate: true,
            ignored: false,
            reason: isRotation
              ? 'DUPLICATE_ROTATION_RESULT'
              : 'DUPLICATE_CURRENT_ATTEMPT_RESULT',
          };
        }

        // 5. Classificação Estruturada das Falhas da tentativa atual
        const isTokenRejection = isTokenSpecificRejection(
          dto.errorCode,
          dto.errorDetail,
          dto.providerResponse,
        );

        const isPayloadOrCred = isPayloadOrCredentialError(
          dto.errorCode,
          dto.errorDetail,
          isTokenRejection,
        );

        // Caso 5A: Rejeição estruturada específica de Token (UNREGISTERED ou fieldViolations no token)
        if (isTokenRejection) {
          // Atualização atômica condicional no banco pelo ID e fcmToken igual ao usedToken
          const updateResult = await tx.device.updateMany({
            where: {
              id: delivery.deviceId,
              fcmToken: dto.usedToken,
              active: true,
            },
            data: {
              active: false,
              fcmToken: null,
              invalidatedAt: now,
            },
          });

          if (updateResult.count > 0) {
            // Token rejeitado era exatamente o token ativo no banco e foi invalidado com sucesso!
            await tx.notificationDelivery.update({
              where: { id: delivery.id },
              data: {
                status: 'TOKEN_INVALIDO',
                errorCode: dto.errorCode || 'UNREGISTERED',
                errorDetail:
                  dto.errorDetail ||
                  'Token FCM rejeitado definitivamente pelo provedor.',
              },
            });

            const notificationStatus =
              await this.consolidateNotificationStatus(
                tx,
                delivery.notificationId,
              );

            this.logger.warn(
              `Token da entrega ${delivery.id.toString()} invalidado no dispositivo ${delivery.deviceId.toString()} após rejeição definitiva (status: TOKEN_INVALIDO).`,
            );

            return {
              deliveryId: delivery.id.toString(),
              notificationId: delivery.notificationId.toString(),
              status: 'TOKEN_INVALIDO',
              attempts: delivery.attempts,
              fcmMessageId: null,
              errorCode: dto.errorCode || 'UNREGISTERED',
              errorDetail: dto.errorDetail,
              notificationStatus,
              tokenInvalidated: true,
              canRetryWithNewToken: false,
              canRetry: false,
              backoffDelayMs: 0,
              duplicate: false,
              ignored: false,
              reason: 'TOKEN_INVALIDATED_PERMANENTLY',
            };
          }

          // Se nenhuma linha foi alterada: releia o dispositivo e reavalie sua elegibilidade; isso, sozinho, não comprova rotação!
          const reloadedDevice = await tx.device.findUnique({
            where: { id: delivery.deviceId },
          });

          if (
            reloadedDevice != null &&
            reloadedDevice.active &&
            reloadedDevice.fcmToken !== null &&
            reloadedDevice.fcmToken !== dto.usedToken
          ) {
            // Dispositivo ativo com NOVO token detectado
            const { meta: currentMeta } = parseDeliveryMetadata(
              delivery.errorDetail,
            );
            const alreadyRotatedOnce =
              currentMeta.rotated === true ||
              delivery.errorCode === 'TOKEN_ROTATED_PENDING_RETRY';

            if (alreadyRotatedOnce) {
              await tx.notificationDelivery.update({
                where: { id: delivery.id },
                data: {
                  status: 'FALHA',
                  errorCode: 'TOKEN_ROTATION_LIMIT_EXCEEDED',
                  errorDetail:
                    'Limite de no máximo um retry por rotação excedido na mesma entrega.',
                },
              });

              const notificationStatus =
                await this.consolidateNotificationStatus(
                  tx,
                  delivery.notificationId,
                );

              return {
                deliveryId: delivery.id.toString(),
                notificationId: delivery.notificationId.toString(),
                status: 'FALHA',
                attempts: delivery.attempts,
                fcmMessageId: null,
                errorCode: 'TOKEN_ROTATION_LIMIT_EXCEEDED',
                errorDetail:
                  'Limite de no máximo um retry por rotação excedido na mesma entrega.',
                notificationStatus,
                tokenInvalidated: false,
                canRetryWithNewToken: false,
                canRetry: false,
                backoffDelayMs: 0,
                duplicate: false,
                ignored: false,
                reason: 'TOKEN_ROTATION_LIMIT_EXCEEDED',
              };
            }

            const reachedCumulativeLimit =
              delivery.attempts >= MAX_DELIVERY_ATTEMPTS;

            if (reachedCumulativeLimit) {
              await tx.notificationDelivery.update({
                where: { id: delivery.id },
                data: {
                  status: 'FALHA',
                  errorCode: 'MAX_ATTEMPTS_EXCEEDED',
                  errorDetail:
                    'Limite cumulativo de tentativas atingido mesmo após rotação de token.',
                },
              });

              const notificationStatus =
                await this.consolidateNotificationStatus(
                  tx,
                  delivery.notificationId,
                );

              return {
                deliveryId: delivery.id.toString(),
                notificationId: delivery.notificationId.toString(),
                status: 'FALHA',
                attempts: delivery.attempts,
                fcmMessageId: null,
                errorCode: 'MAX_ATTEMPTS_EXCEEDED',
                errorDetail: 'Limite cumulativo de tentativas atingido.',
                notificationStatus,
                tokenInvalidated: false,
                canRetryWithNewToken: false,
                canRetry: false,
                backoffDelayMs: 0,
                duplicate: false,
                ignored: false,
                reason: 'MAX_ATTEMPTS_REACHED_ROTATION_EXHAUSTED',
              };
            }

            // Concede o ÚNICO retry de rotação na mesma entrega e grava marcador imutável rotated=true
            const updatedMeta: DeliveryErrorMetadata = {
              ...currentMeta,
              attemptNumber: delivery.attempts,
              rotated: true,
            };
            const storedDetail = formatDeliveryErrorDetail(
              updatedMeta,
              'Token anterior rejeitado, mas novo token detectado para retry único.',
            );

            await tx.notificationDelivery.update({
              where: { id: delivery.id },
              data: {
                status: 'PENDENTE',
                errorCode: 'TOKEN_ROTATED_PENDING_RETRY',
                errorDetail: storedDetail,
              },
            });

            const notificationStatus =
              await this.consolidateNotificationStatus(
                tx,
                delivery.notificationId,
              );

            return {
              deliveryId: delivery.id.toString(),
              notificationId: delivery.notificationId.toString(),
              status: 'PENDENTE',
              attempts: delivery.attempts,
              fcmMessageId: null,
              errorCode: 'TOKEN_ROTATED_PENDING_RETRY',
              errorDetail: 'Novo token detectado para retry.',
              notificationStatus,
              tokenInvalidated: false,
              canRetryWithNewToken: true,
              canRetry: true,
              backoffDelayMs: 0,
              duplicate: false,
              ignored: false,
              reason: 'TOKEN_ROTATED_NEW_TOKEN_AVAILABLE',
            };
          } else {
            // Dispositivo inativo ou sem novo token válido (isso, sozinho, não comprova rotação)
            await tx.notificationDelivery.update({
              where: { id: delivery.id },
              data: {
                status: 'FALHA',
                errorCode: dto.errorCode || 'DEVICE_INELIGIBLE',
                errorDetail:
                  dto.errorDetail ||
                  'Dispositivo inativo ou sem novo token disponível.',
              },
            });

            const notificationStatus =
              await this.consolidateNotificationStatus(
                tx,
                delivery.notificationId,
              );

            return {
              deliveryId: delivery.id.toString(),
              notificationId: delivery.notificationId.toString(),
              status: 'FALHA',
              attempts: delivery.attempts,
              fcmMessageId: null,
              errorCode: dto.errorCode || 'DEVICE_INELIGIBLE',
              errorDetail: dto.errorDetail,
              notificationStatus,
              tokenInvalidated: false,
              canRetryWithNewToken: false,
              canRetry: false,
              backoffDelayMs: 0,
              duplicate: false,
              ignored: false,
              reason: 'DEVICE_INELIGIBLE_AFTER_REJECTION',
            };
          }
        }

        // Caso 5B: Falha de Credencial de Serviço ou Payload (preserva o token!)
        if (isPayloadOrCred) {
          this.logger.warn(
            `Falha de credencial/payload registrada na entrega ${delivery.id.toString()} (${dto.errorCode}). Preservando token do dispositivo.`,
          );

          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'FALHA',
              errorCode: dto.errorCode || 'PAYLOAD_OR_CREDENTIAL_ERROR',
              errorDetail: dto.errorDetail,
            },
          });

          const notificationStatus =
            await this.consolidateNotificationStatus(tx, delivery.notificationId);

          return {
            deliveryId: delivery.id.toString(),
            notificationId: delivery.notificationId.toString(),
            status: 'FALHA',
            attempts: delivery.attempts,
            fcmMessageId: null,
            errorCode: dto.errorCode || 'PAYLOAD_OR_CREDENTIAL_ERROR',
            errorDetail: dto.errorDetail,
            notificationStatus,
            tokenInvalidated: false,
            canRetryWithNewToken: false,
            canRetry: false,
            backoffDelayMs: 0,
            duplicate: false,
            ignored: false,
            reason: 'PAYLOAD_OR_CREDENTIAL_ERROR',
          };
        }

        // Caso 5C: Falhas Transitórias e Resultados Desconhecidos (preserva o token!)
        const hasAttemptsRemaining = delivery.attempts < MAX_DELIVERY_ATTEMPTS;

        if (hasAttemptsRemaining) {
          const assignedErrorCode =
            dto.errorCode ||
            (dto.resultType === 'UNKNOWN'
              ? 'UNKNOWN_RESULT'
              : 'TRANSIENT_FAILURE');

          // Cálculo do delay de retry respeitando Retry-After, 429 = 60s, ou backoff exponencial com jitter (mín. 10s)
          const backoffDelayMs = calculateRetryDelayMs(
            delivery.attempts,
            assignedErrorCode,
            dto.retryAfter,
            now,
          );

          const { meta: currentMeta } = parseDeliveryMetadata(delivery.errorDetail);
          const updatedMeta: DeliveryErrorMetadata = {
            ...currentMeta,
            attemptNumber: delivery.attempts,
            retryAfterMs: backoffDelayMs,
            recordedAt: now.getTime(),
          };
          const storedErrorDetail = formatDeliveryErrorDetail(
            updatedMeta,
            dto.errorDetail,
          );

          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'PENDENTE',
              errorCode: assignedErrorCode,
              errorDetail: storedErrorDetail,
            },
          });

          const nextAttemptAllowedAt = new Date(
            now.getTime() + backoffDelayMs,
          ).toISOString();

          const notificationStatus =
            await this.consolidateNotificationStatus(tx, delivery.notificationId);

          this.logger.log(
            `Tentativa ${delivery.attempts} falhou transitóriamente para entrega ${delivery.id.toString()}. Permanece PENDENTE (backoff: ${backoffDelayMs}ms).`,
          );

          return {
            deliveryId: delivery.id.toString(),
            notificationId: delivery.notificationId.toString(),
            status: 'PENDENTE',
            attempts: delivery.attempts,
            fcmMessageId: null,
            errorCode: assignedErrorCode,
            errorDetail: dto.errorDetail,
            notificationStatus,
            tokenInvalidated: false,
            canRetryWithNewToken: false,
            canRetry: true,
            backoffDelayMs,
            nextAttemptAllowedAt,
            duplicate: false,
            ignored: false,
            reason: 'TRANSIENT_FAILURE_RETRY_ALLOWED',
          };
        } else {
          // Esgotou o limite cumulativo de tentativas: transiciona para FALHA
          const assignedErrorCode = dto.errorCode || 'MAX_ATTEMPTS_EXCEEDED';

          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'FALHA',
              errorCode: assignedErrorCode,
              errorDetail:
                dto.errorDetail ||
                'Tentativas esgotadas sem confirmação do provedor.',
            },
          });

          const notificationStatus =
            await this.consolidateNotificationStatus(tx, delivery.notificationId);

          this.logger.warn(
            `Entrega ${delivery.id.toString()} encerrou em FALHA após esgotar o limite de tentativas (${delivery.attempts}/${MAX_DELIVERY_ATTEMPTS}).`,
          );

          return {
            deliveryId: delivery.id.toString(),
            notificationId: delivery.notificationId.toString(),
            status: 'FALHA',
            attempts: delivery.attempts,
            fcmMessageId: null,
            errorCode: assignedErrorCode,
            errorDetail: dto.errorDetail,
            notificationStatus,
            tokenInvalidated: false,
            canRetryWithNewToken: false,
            canRetry: false,
            backoffDelayMs: 0,
            duplicate: false,
            ignored: false,
            reason: 'MAX_ATTEMPTS_EXCEEDED_TERMINAL_FAILURE',
          };
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /**
   * 4. Consolidar o estado da notificação a partir das suas entregas:
   * Conforme constraint ck_notificacao_status: ('PENDENTE', 'PROCESSADA', 'PARCIAL', 'FALHA', 'SEM_DISPOSITIVO')
   * Conforme constraint ck_notificacao_processamento:
   * (status = 'PENDENTE' AND processada_em IS NULL) OR (status <> 'PENDENTE' AND processada_em IS NOT NULL)
   */
  async consolidateNotificationStatus(
    tx: Prisma.TransactionClient,
    notificationId: bigint,
  ): Promise<string> {
    const deliveries = await tx.notificationDelivery.findMany({
      where: { notificationId },
      select: { status: true },
    });

    const now = new Date();
    let newStatus = 'PENDENTE';
    let processedAt: Date | null = null;

    if (deliveries.length === 0) {
      const current = await tx.notification.findUnique({
        where: { id: notificationId },
        select: { status: true },
      });
      return current?.status || 'SEM_DISPOSITIVO';
    }

    const hasSent = deliveries.some((d) => d.status === 'ENVIADA');
    const hasPending = deliveries.some((d) => d.status === 'PENDENTE');
    const hasFailedOrInvalid = deliveries.some(
      (d) => d.status === 'FALHA' || d.status === 'TOKEN_INVALIDO',
    );

    if (hasPending) {
      newStatus = 'PENDENTE';
      processedAt = null;
    } else if (hasSent && !hasFailedOrInvalid) {
      newStatus = 'PROCESSADA';
      processedAt = now;
    } else if (hasSent && hasFailedOrInvalid) {
      newStatus = 'PARCIAL';
      processedAt = now;
    } else {
      newStatus = 'FALHA';
      processedAt = now;
    }

    await tx.notification.update({
      where: { id: notificationId },
      data: {
        status: newStatus,
        processedAt,
      },
    });

    return newStatus;
  }
}
