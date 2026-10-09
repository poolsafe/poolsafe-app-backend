import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { HashService } from './hash.service.js';
import { EmailService } from '../email/email.service.js';
import { PasswordResetRateLimiter } from './password-reset-rate-limiter.service.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import {
  InvalidResetTokenException,
  ResetTokenExpiredException,
} from '../../common/errors/problem-details.exception.js';
import { invalidateDevices } from '../devices/device-state.util.js';

export interface ForgotPasswordResponse {
  data: {
    message: string;
  };
  meta: {
    requestId: string;
  };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 8;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashService: HashService,
    private readonly emailService: EmailService,
    private readonly rateLimiter: PasswordResetRateLimiter,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Gera um código de 8 caracteres utilizando o alfabeto seguro (sem ambiguidade).
   */
  public generateCode(): { raw: string; formatted: string } {
    let raw = '';
    for (let i = 0; i < TOKEN_LENGTH; i++) {
      raw += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    return { raw, formatted };
  }

  /**
   * Normaliza o código informado pelo usuário (remove hífens/espaços e converte para maiúsculas).
   * Retorna null se contiver caracteres inválidos ou comprimento divergente.
   */
  public normalizeCode(input: string): string | null {
    if (!input || typeof input !== 'string') {
      return null;
    }
    const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
    if (cleaned.length !== TOKEN_LENGTH) {
      return null;
    }
    for (const char of cleaned) {
      if (!ALPHABET.includes(char)) {
        return null;
      }
    }
    return cleaned;
  }

  /**
   * Calcula o hash SHA-256 do segredo normalizado.
   */
  public hashSecret(normalizedCode: string): string {
    return createHash('sha256').update(normalizedCode).digest('hex');
  }

  /**
   * Solicitação de recuperação de senha (POST /api/v1/auth/forgot-password).
   * Sempre responde com status 202 e mensagem genérica, exista ou não a conta.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    clientIp: string,
    requestId: string,
  ): Promise<ForgotPasswordResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    // 1. Aplicação de Rate Limiting por IP e e-mail
    this.rateLimiter.checkAndRecord(normalizedEmail, clientIp);

    // 2. Busca do usuário pelo e-mail
    const user = await this.prisma.getClient().user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, status: true },
    });

    const genericResponse: ForgotPasswordResponse = {
      data: {
        message: 'Se a conta existir, enviaremos as instruções de recuperação.',
      },
      meta: {
        requestId,
      },
    };

    // 3. Se usuário não existir ou não estiver ATIVO, responder genericamente sem revelar
    if (!user || user.status !== 'ATIVO') {
      // Delay simulado / dummy verify para mitigar ataques de temporização
      await this.hashService.dummyVerify('dummy-timing-mitigation-password');
      return genericResponse;
    }

    // 4. Usuário existente e ativo: gerar código seguro
    const { raw, formatted } = this.generateCode();
    const tokenHash = this.hashSecret(raw);
    const ttlMinutes =
      this.configService.get<number>('PASSWORD_RESET_TOKEN_TTL_MINUTES') ?? 15;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    // 5. Invalidação de códigos anteriores e gravação do novo hash em transação
    let tokenId: bigint;
    try {
      tokenId = await this.prisma.getClient().$transaction(async (tx) => {
        // Invalida tokens anteriores não utilizados do mesmo usuário
        await tx.passwordResetToken.updateMany({
          where: {
            userId: user.id,
            usedAt: null,
          },
          data: {
            usedAt: new Date(),
          },
        });

        // Grava o novo token (somente o hash SHA-256)
        const created = await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt,
            usedAt: null,
          },
        });

        return created.id;
      });
    } catch (err: unknown) {
      this.logger.error({ requestId, err }, 'Falha na persistência transacional do token de recuperação.');
      return genericResponse;
    }

    // 6. Envio do e-mail com o código pelo serviço do Resend
    const emailSent = await this.emailService.sendPasswordResetEmail({
      to: user.email,
      code: formatted,
      ttlMinutes,
    });

    // 7. Se o envio falhar, invalidar o token recém-criado para não deixá-lo vulnerável
    if (!emailSent) {
      try {
        await this.prisma.getClient().passwordResetToken.update({
          where: { id: tokenId },
          data: { usedAt: new Date() },
        });
      } catch {
        // Silêncio operacional
      }
      this.logger.warn({ requestId }, 'Token de recuperação invalidado devido à falha de entrega do e-mail.');
    }

    return genericResponse;
  }

  /**
   * Redefinição de senha com token de uso único (POST /api/v1/auth/reset-password).
   * Operação atômica que redefine a credencial, consome o token, revoga todas as sessões e invalida todos os dispositivos.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // 1. Normalização e validação sintática do código
    const normalizedCode = this.normalizeCode(dto.token);
    if (!normalizedCode) {
      throw new InvalidResetTokenException();
    }

    // 2. Busca pelo hash SHA-256 do código
    const tokenHash = this.hashSecret(normalizedCode);
    const tokenRecord = await this.prisma.getClient().passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    // 3. Validação de existência e uso prévio
    if (!tokenRecord || tokenRecord.usedAt !== null) {
      throw new InvalidResetTokenException();
    }

    // 4. Validação de expiração (docs Seção 11.6: 410 RESET_TOKEN_EXPIRED)
    if (tokenRecord.expiresAt < new Date()) {
      throw new ResetTokenExpiredException();
    }

    // 5. Validação da conta do usuário associado
    if (tokenRecord.user.status !== 'ATIVO') {
      throw new InvalidResetTokenException();
    }

    // 6. Criptografia da nova senha com Argon2id
    const newPasswordHash = await this.hashService.hash(dto.newPassword);

    // 7. Transação atômica: consumo do token, atualização da senha, revogação de sessões e invalidação de dispositivos
    const now = new Date();
    await this.prisma.getClient().$transaction(async (tx) => {
      // a) Consumo atômico do token
      await tx.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: now },
      });

      // b) Atualização da senha do usuário
      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          passwordHash: newPasswordHash,
          updatedAt: now,
        },
      });

      // c) Revogação imediata de todas as sessões ativas da conta
      await tx.authSession.updateMany({
        where: {
          userId: tokenRecord.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      // d) Invalidação de todas as instalações/dispositivos da conta
      await invalidateDevices(
        tx,
        {
          userId: tokenRecord.userId,
        },
        now,
      );
    });

    this.logger.log('Senha redefinida com sucesso. Sessões e dispositivos invalidados de forma atômica.');
  }
}
