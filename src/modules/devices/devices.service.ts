import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import {
  ProblemDetailsException,
  ResourceConflictException,
  SessionExpiredException,
} from '../../common/errors/problem-details.exception.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { UpsertDeviceDto } from './dto/upsert-device.dto.js';
import type { DeviceResponse } from './dto/device-response.dto.js';
import { invalidateDevices } from './device-state.util.js';

export interface RegisterDeviceResult {
  /** `true` quando a instalação foi criada (201); `false` em atualização idempotente (200). */
  created: boolean;
  response: DeviceResponse;
}

/** Tentativas totais (inclui a primeira) diante de colisão de unicidade ou deadlock. */
const MAX_TRANSACTION_ATTEMPTS = 4;

/**
 * DevicesService — instalações do aplicativo e FCM Tokens (Fatia 8B).
 *
 * Regras (docs/domain-model.md §7.3, docs/database-schema.md §6.1, docs/api-contract.md §13):
 * - `UNIQUE(usuario_id, identificador_instalacao)`: registrar novamente é atualização idempotente;
 * - `UNIQUE(fcm_token)`: um token pertence a uma única instalação por vez; a transferência
 *   remove o vínculo anterior e inativa o registro antigo na MESMA transação;
 * - elegível para push = ativo + token presente (`pushEligible`);
 * - `token_atualizado_em` muda somente quando o valor armazenado do token realmente muda;
 * - `ultimo_acesso_em` é atualizado em toda sincronização bem-sucedida;
 * - a sessão autenticada atual passa a referenciar o dispositivo.
 *
 * Segurança: o FCM Token jamais é devolvido, registrado em log ou incluído em exceções.
 * Erros inesperados são convertidos em 500 genérico sem a mensagem original, pois erros de
 * driver podem carregar fragmentos da consulta.
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * PUT /devices/{installationId}.
   */
  async register(
    user: AuthenticatedUser,
    installationId: string,
    dto: UpsertDeviceDto,
    requestId: string,
  ): Promise<RegisterDeviceResult> {
    const userId = BigInt(user.id);
    const sessionId = BigInt(user.sessionId);

    return this.runWithRetry('registro de dispositivo', () =>
      this.registerOnce(userId, sessionId, installationId, dto, requestId),
    );
  }

  /**
   * DELETE /devices/{installationId}. Idempotente e restrito às instalações do próprio usuário.
   */
  async invalidate(user: AuthenticatedUser, installationId: string): Promise<void> {
    const userId = BigInt(user.id);

    await this.runWithRetry('invalidação de dispositivo', async () => {
      await this.prisma.getClient().$transaction(async (tx) => {
        await invalidateDevices(
          tx,
          { userId, installationIdentifier: installationId },
          new Date(),
        );
      });
    });
  }

  private async registerOnce(
    userId: bigint,
    sessionId: bigint,
    installationId: string,
    dto: UpsertDeviceDto,
    requestId: string,
  ): Promise<RegisterDeviceResult> {
    const token = dto.fcmToken;

    return this.prisma.getClient().$transaction(
      async (tx) => {
        const now = new Date();

        // 1. Bloqueia a sessão autenticada e a revalida DENTRO da transação. Um logout, uma
        //    revogação ou uma recuperação de senha concluídos antes deste ponto impedem o
        //    registro; os concluídos depois aguardam o commit e então invalidam o dispositivo.
        const sessions = await tx.$queryRaw<
          Array<{ usuario_id: bigint; revogada_em: Date | null; expira_em: Date }>
        >`SELECT usuario_id, revogada_em, expira_em FROM sessao_autenticacao WHERE id = ${sessionId} FOR UPDATE`;

        const session = sessions[0];
        if (
          !session ||
          session.usuario_id !== userId ||
          session.revogada_em !== null ||
          session.expira_em <= now
        ) {
          throw new SessionExpiredException('Sessão expirada ou revogada.');
        }

        // 2. Localiza e bloqueia a instalação do próprio usuário (se existir).
        const ownLock = await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id FROM dispositivo
          WHERE usuario_id = ${userId} AND identificador_instalacao = ${installationId}
          FOR UPDATE`;
        const own = ownLock[0]
          ? await tx.device.findUnique({ where: { id: ownLock[0].id } })
          : null;

        // 3. Transferência atômica do token: remove o vínculo de qualquer outro proprietário e
        //    torna aquele registro inelegível antes de associar o token a esta instalação.
        if (token !== null) {
          const owners = await tx.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM dispositivo WHERE fcm_token = ${token} FOR UPDATE`;
          for (const previousOwner of owners) {
            if (own && previousOwner.id === own.id) {
              continue;
            }
            await tx.device.update({
              where: { id: previousOwner.id },
              data: { fcmToken: null, active: false, invalidatedAt: now },
            });
          }
        }

        // 4. Upsert da combinação usuário/instalação.
        let created = false;
        let device;
        if (!own) {
          created = true;
          device = await tx.device.create({
            data: {
              userId,
              installationIdentifier: installationId,
              platform: dto.platform,
              fcmToken: token,
              active: true,
              invalidatedAt: null,
              tokenUpdatedAt: token !== null ? now : null,
              lastAccessAt: now,
            },
          });
        } else {
          const tokenChanged = own.fcmToken !== token;
          device = await tx.device.update({
            where: { id: own.id },
            data: {
              platform: dto.platform,
              fcmToken: token,
              active: true,
              invalidatedAt: null,
              lastAccessAt: now,
              ...(tokenChanged ? { tokenUpdatedAt: now } : {}),
            },
          });
        }

        // 5. A sessão atual passa a referenciar o dispositivo.
        await tx.authSession.update({
          where: { id: sessionId },
          data: { deviceId: device.id },
        });

        return {
          created,
          response: {
            data: {
              id: device.id.toString(),
              installationId: device.installationIdentifier,
              platform: device.platform,
              active: device.active,
              pushEligible: device.active && device.fcmToken !== null,
              tokenUpdatedAt: device.tokenUpdatedAt ? device.tokenUpdatedAt.toISOString() : null,
            },
            meta: { requestId },
          },
        };
      },
      {
        // READ COMMITTED reduz bloqueios de intervalo (gap locks) e a chance de deadlock
        // entre registros concorrentes do mesmo token.
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 10000,
      },
    );
  }

  /**
   * Repete a operação diante de violação de unicidade ou deadlock (concorrência legítima).
   * Esgotadas as tentativas: 409 RESOURCE_CONFLICT. Qualquer outro erro inesperado é
   * sanitizado em 500 genérico, sem a mensagem original do driver.
   */
  private async runWithRetry<T>(operation: string, run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
      try {
        return await run();
      } catch (err: unknown) {
        if (err instanceof ProblemDetailsException) {
          throw err;
        }
        if (isRetryableConcurrencyError(err)) {
          if (attempt < MAX_TRANSACTION_ATTEMPTS) {
            continue;
          }
          this.logger.warn({ operation }, 'Conflito de concorrência persistente.');
          throw new ResourceConflictException(
            'Não foi possível concluir a operação devido a um conflito. Tente novamente.',
          );
        }
        this.logger.error(
          { operation, errorName: err instanceof Error ? err.name : 'UnknownError' },
          'Falha inesperada na operação de dispositivo.',
        );
        throw new InternalServerErrorException();
      }
    }
    throw new ResourceConflictException();
  }
}

function isRetryableConcurrencyError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002' || err.code === 'P2034') {
      return true;
    }
    const message = err.message.toLowerCase();
    return message.includes('deadlock') || message.includes('lock wait timeout');
  }
  return false;
}
