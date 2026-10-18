import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { HashService } from './hash.service.js';
import { TokenService } from './token.service.js';
import { SessionService } from './session.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import {
  InvalidCredentialsException,
  AccountCannotBeCreatedException,
  ProblemDetailsException,
} from '../../common/errors/problem-details.exception.js';
import {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_PHONE_CONTACT_VERSION,
} from '../legal/legal.constants.js';
import {
  validateBrazilianPhone,
  normalizeBrazilianPhone,
} from '../../common/utils/phone.util.js';

export interface AuthenticatedUserPayload {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  privacyVersion: string | null;
  privacyAwareAt: string | null;
  phoneContactAuthorized: boolean;
  phoneContactVersion: string | null;
  phoneContactGrantedAt: string | null;
  phoneContactRevokedAt: string | null;
}

export interface AuthenticatedResponse {
  data: {
    user: AuthenticatedUserPayload;
    tokens: {
      tokenType: 'Bearer';
      accessToken: string;
      refreshToken: string;
      accessExpiresAt: string;
      sessionExpiresAt: string;
    };
  };
  meta: {
    requestId: string;
  };
}

export interface RefreshResponse {
  data: {
    tokenType: 'Bearer';
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: string;
    sessionExpiresAt: string;
  };
  meta: {
    requestId: string;
  };
}

/**
 * AuthService — Casos de uso de autenticação: cadastro, login, renovação e encerramento de sessão.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashService: HashService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Cadastro de novo usuário e emissão da primeira sessão autenticada.
   *
   * Valida e registra atomicamente o aceite dos Termos de Uso, a ciência do Aviso de
   * Privacidade e o consentimento opcional de contato por telefone.
   */
  async register(dto: RegisterDto, requestId: string): Promise<AuthenticatedResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const normalizedName = dto.name.trim();

    // 1. Validação estrita das manifestações obrigatórias de Termos e Privacidade
    if (dto.termsAccepted !== true) {
      throw new ProblemDetailsException({
        status: 422,
        code: 'VALIDATION_ERROR',
        title: 'Erro de validação',
        detail: 'É necessário manifestar aceite dos Termos de Uso.',
        errors: [
          {
            pointer: '/termsAccepted',
            code: 'TERMS_NOT_ACCEPTED',
            detail: 'É necessário aceitar os Termos de Uso para criar uma conta.',
          },
        ],
      });
    }

    if (dto.termsVersion !== CURRENT_TERMS_VERSION) {
      throw new ProblemDetailsException({
        status: 422,
        code: 'VALIDATION_ERROR',
        title: 'Erro de validação',
        detail: 'A versão dos Termos de Uso apresentada é inválida ou desatualizada.',
        errors: [
          {
            pointer: '/termsVersion',
            code: 'INVALID_TERMS_VERSION',
            detail: `A versão vigente dos Termos de Uso é ${CURRENT_TERMS_VERSION}.`,
          },
        ],
      });
    }

    if (dto.privacyAware !== true) {
      throw new ProblemDetailsException({
        status: 422,
        code: 'VALIDATION_ERROR',
        title: 'Erro de validação',
        detail: 'É necessário declarar ciência do Aviso de Privacidade.',
        errors: [
          {
            pointer: '/privacyAware',
            code: 'PRIVACY_NOT_ACKNOWLEDGED',
            detail: 'É necessário declarar ciência do Aviso de Privacidade para criar uma conta.',
          },
        ],
      });
    }

    if (dto.privacyVersion !== CURRENT_PRIVACY_VERSION) {
      throw new ProblemDetailsException({
        status: 422,
        code: 'VALIDATION_ERROR',
        title: 'Erro de validação',
        detail: 'A versão do Aviso de Privacidade apresentada é inválida ou desatualizada.',
        errors: [
          {
            pointer: '/privacyVersion',
            code: 'INVALID_PRIVACY_VERSION',
            detail: `A versão vigente do Aviso de Privacidade é ${CURRENT_PRIVACY_VERSION}.`,
          },
        ],
      });
    }

    // 2. Validação e normalização do telefone opcional
    let normalizedPhone: string | null = null;
    let phoneContactAuthorized = false;
    let phoneContactVersion: string | null = null;
    let phoneContactGrantedAt: Date | null = null;
    const now = new Date();

    if (dto.phoneContactAuthorized === true) {
      if (!dto.phone || !dto.phone.trim()) {
        throw new ProblemDetailsException({
          status: 422,
          code: 'VALIDATION_ERROR',
          title: 'Erro de validação',
          detail: 'Informe o telefone para autorizar o contato da equipe.',
          errors: [
            {
              pointer: '/phone',
              code: 'REQUIRED_FIELD',
              detail: 'Informe o número do telefone com DDD.',
            },
          ],
        });
      }

      if (!validateBrazilianPhone(dto.phone)) {
        throw new ProblemDetailsException({
          status: 422,
          code: 'VALIDATION_ERROR',
          title: 'Erro de validação',
          detail: 'Número de telefone inválido.',
          errors: [
            {
              pointer: '/phone',
              code: 'INVALID_PHONE',
              detail: 'Informe um telefone brasileiro válido com DDD (10 ou 11 dígitos).',
            },
          ],
        });
      }

      normalizedPhone = normalizeBrazilianPhone(dto.phone);
      phoneContactAuthorized = true;
      phoneContactVersion = dto.phoneContactVersion ?? CURRENT_PHONE_CONTACT_VERSION;
      phoneContactGrantedAt = now;
    }

    // 3. Pré-verificação de existência do e-mail
    const existing = await this.prisma.getClient().user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existing) {
      throw new AccountCannotBeCreatedException(
        'Não foi possível concluir o cadastro com os dados informados.',
      );
    }

    // 4. Hash da senha com Argon2id
    const passwordHash = await this.hashService.hash(dto.password);

    try {
      // 5. Criação do usuário e da sessão inicial em transação atômica única
      const { user, sessionResult } = await this.prisma.getClient().$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            name: normalizedName,
            email: normalizedEmail,
            passwordHash,
            status: 'ATIVO',
            phone: normalizedPhone,
            termsVersion: CURRENT_TERMS_VERSION,
            termsAcceptedAt: now,
            privacyVersion: CURRENT_PRIVACY_VERSION,
            privacyAwareAt: now,
            phoneContactAuthorized,
            phoneContactVersion,
            phoneContactGrantedAt,
            phoneContactRevokedAt: null,
          },
        });

        const createdSession = await this.sessionService.createSession(createdUser.id, tx);

        return { user: createdUser, sessionResult: createdSession };
      });

      // 6. Emissão do Access Token JWT RS256
      const tokenResult = this.tokenService.generateAccessToken(
        user.id.toString(),
        sessionResult.sessionId,
      );

      return {
        data: {
          user: {
            id: user.id.toString(),
            name: user.name,
            email: user.email,
            phone: user.phone,
            status: user.status,
            termsVersion: user.termsVersion,
            termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
            privacyVersion: user.privacyVersion,
            privacyAwareAt: user.privacyAwareAt?.toISOString() ?? null,
            phoneContactAuthorized: user.phoneContactAuthorized,
            phoneContactVersion: user.phoneContactVersion,
            phoneContactGrantedAt: user.phoneContactGrantedAt?.toISOString() ?? null,
            phoneContactRevokedAt: user.phoneContactRevokedAt?.toISOString() ?? null,
          },
          tokens: {
            tokenType: 'Bearer',
            accessToken: tokenResult.accessToken,
            refreshToken: sessionResult.refreshToken,
            accessExpiresAt: tokenResult.accessExpiresAt.toISOString(),
            sessionExpiresAt: sessionResult.sessionExpiresAt.toISOString(),
          },
        },
        meta: {
          requestId,
        },
      };
    } catch (err) {
      // Trata corrida de concorrência com chave duplicada no MySQL
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AccountCannotBeCreatedException(
          'Não foi possível concluir o cadastro com os dados informados.',
        );
      }
      throw err;
    }
  }

  /**
   * Autenticação de credenciais existentes e emissão de nova sessão.
   */
  async login(dto: LoginDto, requestId: string): Promise<AuthenticatedResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    // 1. Busca pelo e-mail normalizado
    const user = await this.prisma.getClient().user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Verificação dummy para impedir timing attacks de enumeração de e-mail
      await this.hashService.dummyVerify(dto.password);
      throw new InvalidCredentialsException();
    }

    // 2. Verificação de senha com Argon2id
    const passwordMatches = await this.hashService.verify(user.passwordHash, dto.password);
    if (!passwordMatches) {
      throw new InvalidCredentialsException();
    }

    // 3. Validação do status da conta (apenas ATIVO autentica)
    if (user.status !== 'ATIVO') {
      throw new InvalidCredentialsException();
    }

    // 4. Atualização de ultimo_login_em
    await this.prisma.getClient().user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 5. Emissão de nova sessão independente
    const sessionResult = await this.sessionService.createSession(user.id);

    // 6. Emissão do Access Token JWT RS256
    const tokenResult = this.tokenService.generateAccessToken(
      user.id.toString(),
      sessionResult.sessionId,
    );

    return {
      data: {
        user: {
          id: user.id.toString(),
          name: user.name,
          email: user.email,
          phone: user.phone,
          status: user.status,
          termsVersion: user.termsVersion,
          termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
          privacyVersion: user.privacyVersion,
          privacyAwareAt: user.privacyAwareAt?.toISOString() ?? null,
          phoneContactAuthorized: user.phoneContactAuthorized,
          phoneContactVersion: user.phoneContactVersion,
          phoneContactGrantedAt: user.phoneContactGrantedAt?.toISOString() ?? null,
          phoneContactRevokedAt: user.phoneContactRevokedAt?.toISOString() ?? null,
        },
        tokens: {
          tokenType: 'Bearer',
          accessToken: tokenResult.accessToken,
          refreshToken: sessionResult.refreshToken,
          accessExpiresAt: tokenResult.accessExpiresAt.toISOString(),
          sessionExpiresAt: sessionResult.sessionExpiresAt.toISOString(),
        },
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Rotação transacional do par de tokens via refresh token.
   */
  async refresh(dto: RefreshDto, requestId: string): Promise<RefreshResponse> {
    // 1. Rotação atômica com bloqueio da linha no MySQL
    const rotateResult = await this.sessionService.rotateRefreshToken(dto.refreshToken);

    // 2. Emissão do novo Access Token JWT
    const tokenResult = this.tokenService.generateAccessToken(
      rotateResult.userId,
      rotateResult.sessionId,
    );

    return {
      data: {
        tokenType: 'Bearer',
        accessToken: tokenResult.accessToken,
        refreshToken: rotateResult.newRefreshToken,
        accessExpiresAt: tokenResult.accessExpiresAt.toISOString(),
        sessionExpiresAt: rotateResult.sessionExpiresAt.toISOString(),
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Encerramento da sessão (logout) idempotente.
   */
  async logout(dto: LogoutDto): Promise<void> {
    await this.sessionService.revokeSession(dto.refreshToken, dto.installationId);
  }
}
