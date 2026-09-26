import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import {
  SessionExpiredException,
  AuthenticationRequiredException,
} from '../../common/errors/problem-details.exception.js';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface.js';

export type PrismaTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface CreateSessionResult {
  sessionId: string;
  refreshToken: string;
  sessionExpiresAt: Date;
}

export interface RotateSessionResult {
  sessionId: string;
  userId: string;
  newRefreshToken: string;
  sessionExpiresAt: Date;
}

/**
 * SessionService — Gerenciamento seguro de sessões e refresh tokens opacos.
 *
 * Requisitos:
 * - Refresh token opaco formato: psrt_<sessionId>.<segredo-aleatorio>
 * - Segredo com 256 bits de aleatoriedade via node:crypto
 * - Apenas SHA-256 do segredo é persistido
 * - Validade máxima da sessão de 30 dias (não estendida por renovação)
 * - Rotação transacional com bloqueio MySQL (SELECT ... FOR UPDATE)
 * - Reutilização de token anterior detectada revoga a sessão inteira
 * - Revogação é commitada antes de retornar o erro
 * - dispositivo_id permanece NULL nesta etapa
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessionDurationMs = 30 * 24 * 60 * 60 * 1000; // 30 dias

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria uma nova sessão independente com refresh token opaco criptográfico de 256 bits.
   */
  async createSession(
    userId: bigint,
    txClient?: PrismaTransactionClient,
  ): Promise<CreateSessionResult> {
    const prismaClient = txClient ?? this.prisma.getClient();

    const secret = randomBytes(32).toString('hex'); // 256 bits
    const tokenHash = createHash('sha256').update(secret).digest('hex');
    const expiresAt = new Date(Date.now() + this.sessionDurationMs);

    const session = await prismaClient.authSession.create({
      data: {
        userId,
        tokenHash,
        tokenHashAnterior: null,
        expiresAt,
        deviceId: null,
      },
    });

    const sessionIdStr = session.id.toString();
    const refreshToken = `psrt_${sessionIdStr}.${secret}`;

    return {
      sessionId: sessionIdStr,
      refreshToken,
      sessionExpiresAt: expiresAt,
    };
  }

  /**
   * Decompõe o refresh token no formato canônico psrt_<sessionId>.<segredo>.
   */
  private parseRefreshToken(refreshToken: string): { sessionId: bigint; secret: string } {
    const match = refreshToken.match(/^psrt_(\d+)\.([a-zA-Z0-9_-]+)$/);
    if (!match || !match[1] || !match[2]) {
      throw new AuthenticationRequiredException('Formato do refreshToken inválido.');
    }

    try {
      const sessionId = BigInt(match[1]);
      return { sessionId, secret: match[2] };
    } catch {
      throw new AuthenticationRequiredException('Identificador de sessão inválido no refreshToken.');
    }
  }

  /**
   * Compara com segurança em tempo constante dois hashes SHA-256 hexadecimais.
   */
  private constantTimeCompare(presentedHex: string, storedHex: string | null | undefined): boolean {
    if (!storedHex || typeof storedHex !== 'string') {
      return false;
    }
    const cleanStored = storedHex.trim();
    if (presentedHex.length !== 64 || cleanStored.length !== 64) {
      return false;
    }
    try {
      return timingSafeEqual(
        Buffer.from(presentedHex, 'hex'),
        Buffer.from(cleanStored, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Rotaciona o refresh token de forma transacional e atômica.
   *
   * Bloqueia a linha da sessão com SELECT ... FOR UPDATE.
   *
   * NOTA TÉCNICA (MVP PoolSafe):
   * Para evitar ataques de negação de serviço (DoS) via revogação abusiva provocada
   * por tokens forjados com sessionId existente e segredo aleatório não emitido, o
   * MVP mantém no banco de dados o token atual (token_hash) e o imediatamente anterior
   * (token_hash_anterior):
   * - Caso A: hash apresentado corresponde a token_hash -> rotação atômica; move o hash
   *   atual para token_hash_anterior, grava novo hash em token_hash e atualiza ultimo_uso_em;
   * - Caso B: hash apresentado corresponde a token_hash_anterior -> reutilização comprovada
   *   de refresh token emitido anteriormente; grava revogada_em no banco, comita e lança SESSION_EXPIRED;
   * - Caso C: hash não corresponde a nenhum dos dois -> token inválido ou forjado; lança
   *   AUTHENTICATION_REQUIRED sem alterar nenhum campo da sessão e sem revogar a sessão legítima.
   * Tokens mais antigos que o imediatamente anterior são tratados pelo Caso C (limitação aceita do MVP).
   * Não estende a data original de expira_em.
   */
  async rotateRefreshToken(rawRefreshToken: string): Promise<RotateSessionResult> {
    const { sessionId, secret } = this.parseRefreshToken(rawRefreshToken);
    const presentedHash = createHash('sha256').update(secret).digest('hex');

    const prisma = this.prisma.getClient();

    // Executa a renovação em transação MySQL com SELECT ... FOR UPDATE
    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Carrega e bloqueia a sessão
      const sessions = await tx.$queryRaw<
        Array<{
          id: bigint;
          usuario_id: bigint;
          token_hash: string;
          token_hash_anterior: string | null;
          expira_em: Date;
          ultimo_uso_em: Date | null;
          revogada_em: Date | null;
        }>
      >`SELECT id, usuario_id, token_hash, token_hash_anterior, expira_em, ultimo_uso_em, revogada_em FROM sessao_autenticacao WHERE id = ${sessionId} FOR UPDATE`;

      if (!sessions || sessions.length === 0) {
        return { outcome: 'NOT_FOUND' as const };
      }

      const session = sessions[0]!;

      // 2. Verifica se a sessão já está revogada ou expirada
      if (session.revogada_em !== null || session.expira_em <= new Date()) {
        return { outcome: 'REVOKED_OR_EXPIRED' as const };
      }

      // 3. Verifica se o usuário continua ativo
      const user = await tx.user.findUnique({
        where: { id: session.usuario_id },
        select: { id: true, status: true },
      });

      if (!user || user.status !== 'ATIVO') {
        return { outcome: 'USER_INACTIVE' as const };
      }

      // 4. Comparação em tempo constante
      const matchesCurrent = this.constantTimeCompare(presentedHash, session.token_hash);
      const matchesPrevious = this.constantTimeCompare(presentedHash, session.token_hash_anterior);

      if (matchesCurrent) {
        // Caso A — hash apresentado corresponde a token_hash:
        // - gerar novo segredo;
        // - gravar o valor atual de token_hash em token_hash_anterior;
        // - gravar o hash do novo segredo em token_hash;
        // - atualizar ultimo_uso_em;
        // - preservar expira_em;
        // - emitir o novo par de tokens.
        const newSecret = randomBytes(32).toString('hex');
        const newTokenHash = createHash('sha256').update(newSecret).digest('hex');
        const now = new Date();

        await tx.authSession.update({
          where: { id: sessionId },
          data: {
            tokenHashAnterior: session.token_hash,
            tokenHash: newTokenHash,
            lastUsedAt: now,
            // Não altera nem estende expira_em
          },
        });

        return {
          outcome: 'SUCCESS' as const,
          sessionId: session.id.toString(),
          userId: session.usuario_id.toString(),
          sessionExpiresAt: session.expira_em,
          newRefreshToken: `psrt_${session.id.toString()}.${newSecret}`,
        };
      }

      if (matchesPrevious) {
        // Caso B — hash apresentado corresponde a token_hash_anterior:
        // - considerar reutilização comprovada do refresh imediatamente anterior;
        // - gravar revogada_em;
        // - garantir que a transação seja commitada;
        // - somente depois retornar 401 SESSION_EXPIRED.
        await tx.authSession.update({
          where: { id: sessionId },
          data: { revokedAt: new Date() },
        });

        return { outcome: 'REUSE_REVOKED' as const };
      }

      // Caso C — hash não corresponde a nenhum dos dois:
      // - considerar token inválido ou nunca emitido;
      // - retornar 401 AUTHENTICATION_REQUIRED;
      // - não modificar token_hash;
      // - não modificar token_hash_anterior;
      // - não preencher revogada_em;
      // - não revogar a sessão legítima.
      return { outcome: 'INVALID_TOKEN' as const };
    });

    // Trata os resultados fora da transação para garantir que alterações foram commitadas
    if (txResult.outcome === 'REUSE_REVOKED') {
      this.logger.warn({ sessionId: sessionId.toString() }, 'Reutilização de refresh token detectada. Sessão revogada.');
      throw new SessionExpiredException('Possível reutilização de token. A sessão foi revogada.');
    }

    if (txResult.outcome === 'INVALID_TOKEN') {
      throw new AuthenticationRequiredException('Refresh token inválido ou não reconhecido.');
    }

    if (txResult.outcome === 'NOT_FOUND') {
      throw new SessionExpiredException('Sessão não encontrada.');
    }

    if (txResult.outcome === 'REVOKED_OR_EXPIRED') {
      throw new SessionExpiredException('Sessão expirada ou revogada.');
    }

    if (txResult.outcome === 'USER_INACTIVE') {
      throw new SessionExpiredException('Usuário bloqueado ou inativo.');
    }

    return {
      sessionId: txResult.sessionId,
      userId: txResult.userId,
      newRefreshToken: txResult.newRefreshToken,
      sessionExpiresAt: txResult.sessionExpiresAt,
    };
  }

  /**
   * Revoga a sessão (logout). Idempotente conforme docs/api-contract.md Seção 11.4.
   *
   * Exige que o segredo apresentado coincida com o hash da sessão antes de revogar,
   * impedindo que tokens forjados com sessionId válido causem revogação abusiva.
   */
  async revokeSession(rawRefreshToken: string): Promise<void> {
    try {
      const { sessionId, secret } = this.parseRefreshToken(rawRefreshToken);
      const session = await this.prisma.getClient().authSession.findUnique({
        where: { id: sessionId },
        select: { id: true, tokenHash: true, revokedAt: true },
      });

      if (!session) {
        return;
      }

      if (session.revokedAt !== null) {
        return;
      }

      const presentedHash = createHash('sha256').update(secret).digest('hex');
      const matches = timingSafeEqual(
        Buffer.from(presentedHash, 'hex'),
        Buffer.from(session.tokenHash, 'hex'),
      );

      if (matches) {
        await this.prisma.getClient().authSession.update({
          where: { id: sessionId },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // Idempotência: mesmo se o token for malformado ou inexistente, logout conclui sem erro
    }
  }


  /**
   * Valida se a sessão e o usuário continuam ativos para autorização de requisições protegidas.
   */
  async validateSessionForAuth(userIdStr: string, sessionIdStr: string): Promise<AuthenticatedUser> {
    let sessionId: bigint;
    let userId: bigint;
    try {
      sessionId = BigInt(sessionIdStr);
      userId = BigInt(userIdStr);
    } catch {
      throw new AuthenticationRequiredException('Identificadores de token inválidos.');
    }

    const session = await this.prisma.getClient().authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session) {
      throw new SessionExpiredException('Sessão não encontrada.');
    }

    if (session.revokedAt !== null) {
      throw new SessionExpiredException('Sessão revogada.');
    }

    if (session.expiresAt <= new Date()) {
      throw new SessionExpiredException('Sessão expirada.');
    }

    if (session.userId !== userId) {
      throw new AuthenticationRequiredException('Sessão não pertence ao usuário autenticado.');
    }

    if (session.user.status !== 'ATIVO') {
      throw new SessionExpiredException('Usuário bloqueado ou inativo.');
    }

    return {
      id: session.user.id.toString(),
      name: session.user.name,
      email: session.user.email,
      status: session.user.status,
      createdAt: session.user.createdAt,
      sessionId: session.id.toString(),
    };
  }
}
