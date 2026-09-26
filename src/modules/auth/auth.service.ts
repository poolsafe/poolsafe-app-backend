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
} from '../../common/errors/problem-details.exception.js';

export interface AuthenticatedResponse {
  data: {
    user: {
      id: string;
      name: string;
      email: string;
      status: string;
    };
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
   */
  async register(dto: RegisterDto, requestId: string): Promise<AuthenticatedResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const normalizedName = dto.name.trim();

    // 1. Pré-verificação de existência do e-mail
    const existing = await this.prisma.getClient().user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existing) {
      throw new AccountCannotBeCreatedException(
        'Não foi possível concluir o cadastro com os dados informados.',
      );
    }

    // 2. Hash da senha com Argon2id
    const passwordHash = await this.hashService.hash(dto.password);

    try {
      // 3. Criação do usuário e da sessão inicial em transação
      const { user, sessionResult } = await this.prisma.getClient().$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            name: normalizedName,
            email: normalizedEmail,
            passwordHash,
            status: 'ATIVO',
          },
        });

        const createdSession = await this.sessionService.createSession(createdUser.id, tx);

        return { user: createdUser, sessionResult: createdSession };
      });

      // 4. Emissão do Access Token JWT RS256
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
            status: user.status,
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
          status: user.status,
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
    await this.sessionService.revokeSession(dto.refreshToken);
  }
}
