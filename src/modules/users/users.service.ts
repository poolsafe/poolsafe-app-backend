import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { HashService } from '../auth/hash.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import {
  ReauthenticationFailedException,
  SessionExpiredException,
} from '../../common/errors/problem-details.exception.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { UpdatePasswordDto } from './dto/update-password.dto.js';
import { invalidateDevices } from '../devices/device-state.util.js';

export interface UserProfileResponse {
  data: {
    id: string;
    name: string;
    email: string;
    status: string;
    createdAt: string;
  };
  meta: {
    requestId: string;
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashService: HashService,
  ) {}

  /**
   * Formata os dados do perfil do usuário autenticado conforme docs/api-contract.md Seção 12.1.
   */
  getProfile(user: AuthenticatedUser, requestId: string): UserProfileResponse {
    return {
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Atualiza o nome do usuário autenticado conforme docs/api-contract.md Seção 12.2.
   * E-mail não pode ser alterado.
   */
  async updateProfile(
    userIdStr: string,
    dto: UpdateProfileDto,
    requestId: string,
  ): Promise<UserProfileResponse> {
    let userId: bigint;
    try {
      userId = BigInt(userIdStr);
    } catch {
      throw new SessionExpiredException('Identificador de usuário inválido.');
    }

    const existingUser = await this.prisma.getClient().user.findUnique({
      where: { id: userId },
    });

    if (!existingUser || existingUser.status !== 'ATIVO') {
      throw new SessionExpiredException('Usuário bloqueado ou inativo.');
    }

    const updatedUser = await this.prisma.getClient().user.update({
      where: { id: userId },
      data: {
        name: dto.name,
      },
    });

    return {
      data: {
        id: updatedUser.id.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        status: updatedUser.status,
        createdAt: updatedUser.createdAt.toISOString(),
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Altera a senha do usuário autenticado conforme docs/api-contract.md Seção 12.3.
   *
   * Regras:
   * - Confirma senha atual com Argon2id;
   * - Senha incorreta retorna 403 REAUTHENTICATION_FAILED;
   * - Atualiza hash de forma segura e transacional;
   * - Preserva a sessão atual;
   * - Revoga todas as outras sessões do usuário;
   * - Invalida outros dispositivos;
   * - NUNCA registra senhas, hashes ou tokens em logs.
   */
  async changePassword(
    userIdStr: string,
    sessionIdStr: string,
    dto: UpdatePasswordDto,
  ): Promise<void> {
    let userId: bigint;
    let sessionId: bigint;
    try {
      userId = BigInt(userIdStr);
      sessionId = BigInt(sessionIdStr);
    } catch {
      throw new SessionExpiredException('Identificadores de usuário ou sessão inválidos.');
    }

    const user = await this.prisma.getClient().user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        status: true,
      },
    });

    if (!user || user.status !== 'ATIVO') {
      throw new SessionExpiredException('Usuário bloqueado ou inativo.');
    }

    // Confirmação da senha atual com Argon2id
    const isCurrentPasswordValid = await this.hashService.verify(
      user.passwordHash,
      dto.currentPassword,
    );

    if (!isCurrentPasswordValid) {
      throw new ReauthenticationFailedException();
    }

    // Geração do novo hash Argon2id
    const newPasswordHash = await this.hashService.hash(dto.newPassword);
    const now = new Date();

    // Execução transacional de atualização do hash e revogação das demais sessões
    await this.prisma.getClient().$transaction(async (tx) => {
      // 1. Atualização do hash da senha
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: newPasswordHash,
        },
      });

      // 2. Consulta a sessão atual para identificar deviceId associado
      const currentSession = await tx.authSession.findUnique({
        where: { id: sessionId },
        select: { id: true, deviceId: true },
      });

      // 3. Revogação de todas as outras sessões do usuário (preserva a atual)
      await tx.authSession.updateMany({
        where: {
          userId,
          id: { not: sessionId },
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      // 4. Invalidação de outros dispositivos
      if (currentSession?.deviceId) {
        await invalidateDevices(
          tx,
          {
            userId,
            id: { not: currentSession.deviceId },
          },
          now,
        );
      } else {
        await invalidateDevices(
          tx,
          {
            userId,
          },
          now,
        );
      }
    });

    this.logger.log(
      { userId: userIdStr },
      'Senha alterada com sucesso; outras sessões revogadas e sessão atual preservada.',
    );
  }
}
