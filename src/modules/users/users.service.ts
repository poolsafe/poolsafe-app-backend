import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { HashService } from '../auth/hash.service.js';
import {
  ReauthenticationFailedException,
  SessionExpiredException,
  ProblemDetailsException,
} from '../../common/errors/problem-details.exception.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { UpdatePasswordDto } from './dto/update-password.dto.js';
import type { RegisterManifestationsDto } from './dto/register-manifestations.dto.js';
import { invalidateDevices } from '../devices/device-state.util.js';
import {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_PHONE_CONTACT_VERSION,
} from '../legal/legal.constants.js';
import {
  validateBrazilianPhone,
  normalizeBrazilianPhone,
} from '../../common/utils/phone.util.js';

export interface UserProfileResponse {
  data: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: string;
    createdAt: string;
    termsVersion: string | null;
    termsAcceptedAt: string | null;
    privacyVersion: string | null;
    privacyAwareAt: string | null;
    phoneContactAuthorized: boolean;
    phoneContactVersion: string | null;
    phoneContactGrantedAt: string | null;
    phoneContactRevokedAt: string | null;
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
   * Formata os dados do perfil do usuário autenticado consultando o banco de dados.
   * Retorna identificação, telefone e situação de todas as manifestações legais.
   */
  async getProfile(userIdStr: string, requestId: string): Promise<UserProfileResponse> {
    let userId: bigint;
    try {
      userId = BigInt(userIdStr);
    } catch {
      throw new SessionExpiredException('Identificador de usuário inválido.');
    }

    const user = await this.prisma.getClient().user.findUnique({
      where: { id: userId },
    });

    if (!user || user.status !== 'ATIVO') {
      throw new SessionExpiredException('Usuário bloqueado ou inativo.');
    }

    return {
      data: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        termsVersion: user.termsVersion,
        termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
        privacyVersion: user.privacyVersion,
        privacyAwareAt: user.privacyAwareAt?.toISOString() ?? null,
        phoneContactAuthorized: user.phoneContactAuthorized,
        phoneContactVersion: user.phoneContactVersion,
        phoneContactGrantedAt: user.phoneContactGrantedAt?.toISOString() ?? null,
        phoneContactRevokedAt: user.phoneContactRevokedAt?.toISOString() ?? null,
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Atualiza perfil do usuário autenticado (PATCH /api/v1/users/me).
   *
   * Regras:
   * - Preserva campos omitidos no payload;
   * - Não permite alterar e-mail, status, id ou registros/horários de termos/privacidade;
   * - Permite remover o telefone ou revogar autorização enviando null/vazio ou authorized=false;
   * - Troca de telefone exige confirmação explícita de autorização (phoneContactAuthorized: true);
   * - Normaliza o telefone em E.164 e nunca expõe o número em logs.
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

    const now = new Date();
    const updateData: {
      name?: string;
      phone?: string | null;
      phoneContactAuthorized?: boolean;
      phoneContactVersion?: string | null;
      phoneContactGrantedAt?: Date | null;
      phoneContactRevokedAt?: Date | null;
    } = {};

    // 1. Atualização do nome (se fornecido)
    if (dto.name !== undefined) {
      updateData.name = dto.name;
    }

    // 2. Atualização ou remoção do telefone / autorização de contato
    const phoneIsSpecified = dto.phone !== undefined;
    const authIsSpecified = dto.phoneContactAuthorized !== undefined;

    if (phoneIsSpecified || authIsSpecified) {
      const isRemovingPhone =
        dto.phone === null ||
        (typeof dto.phone === 'string' && dto.phone.trim() === '') ||
        dto.phoneContactAuthorized === false;

      if (isRemovingPhone) {
        // Remoção do número e/ou revogação da autorização
        updateData.phone = null;
        updateData.phoneContactAuthorized = false;
        updateData.phoneContactRevokedAt = now;
      } else if (dto.phone && dto.phone.trim()) {
        // Fornecimento ou troca do número de telefone
        if (dto.phoneContactAuthorized !== true) {
          throw new ProblemDetailsException({
            status: 422,
            code: 'VALIDATION_ERROR',
            title: 'Erro de validação',
            detail:
              'A troca ou cadastro de telefone exige nova autorização de contato.',
            errors: [
              {
                pointer: '/phoneContactAuthorized',
                code: 'AUTHORIZATION_REQUIRED',
                detail:
                  'Marque a autorização para permitir o contato complementar da equipe por este número.',
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
                detail:
                  'Informe um telefone brasileiro válido com DDD (10 ou 11 dígitos).',
              },
            ],
          });
        }

        updateData.phone = normalizeBrazilianPhone(dto.phone);
        updateData.phoneContactAuthorized = true;
        updateData.phoneContactVersion = CURRENT_PHONE_CONTACT_VERSION;
        updateData.phoneContactGrantedAt = now;
        updateData.phoneContactRevokedAt = null;
      }
    }

    const updatedUser = await this.prisma.getClient().user.update({
      where: { id: userId },
      data: updateData,
    });

    return {
      data: {
        id: updatedUser.id.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        status: updatedUser.status,
        createdAt: updatedUser.createdAt.toISOString(),
        termsVersion: updatedUser.termsVersion,
        termsAcceptedAt: updatedUser.termsAcceptedAt?.toISOString() ?? null,
        privacyVersion: updatedUser.privacyVersion,
        privacyAwareAt: updatedUser.privacyAwareAt?.toISOString() ?? null,
        phoneContactAuthorized: updatedUser.phoneContactAuthorized,
        phoneContactVersion: updatedUser.phoneContactVersion,
        phoneContactGrantedAt: updatedUser.phoneContactGrantedAt?.toISOString() ?? null,
        phoneContactRevokedAt: updatedUser.phoneContactRevokedAt?.toISOString() ?? null,
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Operação autenticada específica para registrar aceite e ciência das contas existentes
   * (POST /api/v1/users/me/manifestations).
   *
   * Regras:
   * - Exige aceite explícito dos Termos e ciência do Aviso de Privacidade;
   * - Valida se as versões correspondem às versões vigentes;
   * - Idempotente: requisições repetidas da mesma versão preservam o horário original de aceite/ciência;
   * - Horários gerados em UTC no servidor.
   */
  async registerManifestations(
    userIdStr: string,
    dto: RegisterManifestationsDto,
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
            detail: 'É necessário aceitar os Termos de Uso.',
          },
        ],
      });
    }

    if (dto.termsVersion !== CURRENT_TERMS_VERSION) {
      throw new ProblemDetailsException({
        status: 422,
        code: 'VALIDATION_ERROR',
        title: 'Erro de validação',
        detail: 'A versão dos Termos de Uso informada é inválida ou desatualizada.',
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
            detail: 'É necessário declarar ciência do Aviso de Privacidade.',
          },
        ],
      });
    }

    if (dto.privacyVersion !== CURRENT_PRIVACY_VERSION) {
      throw new ProblemDetailsException({
        status: 422,
        code: 'VALIDATION_ERROR',
        title: 'Erro de validação',
        detail: 'A versão do Aviso de Privacidade informada é inválida ou desatualizada.',
        errors: [
          {
            pointer: '/privacyVersion',
            code: 'INVALID_PRIVACY_VERSION',
            detail: `A versão vigente do Aviso de Privacidade é ${CURRENT_PRIVACY_VERSION}.`,
          },
        ],
      });
    }

    const now = new Date();

    // Idempotência: preserva o timestamp original caso já tenha aceitado a mesma versão
    const termsAcceptedAt =
      existingUser.termsVersion === dto.termsVersion && existingUser.termsAcceptedAt !== null
        ? existingUser.termsAcceptedAt
        : now;

    const privacyAwareAt =
      existingUser.privacyVersion === dto.privacyVersion && existingUser.privacyAwareAt !== null
        ? existingUser.privacyAwareAt
        : now;

    const updatedUser = await this.prisma.getClient().user.update({
      where: { id: userId },
      data: {
        termsVersion: dto.termsVersion,
        termsAcceptedAt,
        privacyVersion: dto.privacyVersion,
        privacyAwareAt,
      },
    });

    return {
      data: {
        id: updatedUser.id.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        status: updatedUser.status,
        createdAt: updatedUser.createdAt.toISOString(),
        termsVersion: updatedUser.termsVersion,
        termsAcceptedAt: updatedUser.termsAcceptedAt?.toISOString() ?? null,
        privacyVersion: updatedUser.privacyVersion,
        privacyAwareAt: updatedUser.privacyAwareAt?.toISOString() ?? null,
        phoneContactAuthorized: updatedUser.phoneContactAuthorized,
        phoneContactVersion: updatedUser.phoneContactVersion,
        phoneContactGrantedAt: updatedUser.phoneContactGrantedAt?.toISOString() ?? null,
        phoneContactRevokedAt: updatedUser.phoneContactRevokedAt?.toISOString() ?? null,
      },
      meta: {
        requestId,
      },
    };
  }

  /**
   * Altera a senha do usuário autenticado conforme docs/api-contract.md Seção 12.3.
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
