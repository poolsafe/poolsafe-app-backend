import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  CameraNotFoundException,
  InvalidCameraHeartbeatException,
} from '../../common/errors/problem-details.exception.js';
import {
  validateCameraHeartbeatDto,
  type CameraHeartbeatPayload,
  type CameraHeartbeatResponseDto,
} from './dto/camera-heartbeat.dto.js';

/**
 * Tolerância máxima explícita para pequenos desvios de relógio em observedAt (5 segundos),
 * considerando que API e worker executam na mesma VPS.
 */
export const HEARTBEAT_FUTURE_TOLERANCE_MS = 5_000;

@Injectable()
export class InternalCamerasService {
  private readonly logger = new Logger(InternalCamerasService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Processa o recebimento interno de heartbeat de câmera (N8N -> API).
   *
   * Regras e Invariantes:
   * 1. Valida estrutura do DTO, ordem temporal (expiresAt >= observedAt) e tolerância futura (5s).
   * 2. Resolve a câmera exclusivamente pelo código de integração oficial (cameraCode).
   * 3. Nunca confia em camera_id externo.
   * 4. Câmera inexistente retorna 404 CAMERA_NOT_FOUND.
   * 5. Câmera administrativamente inativa não avança lastCommunicationAt (CAMERA_INACTIVE).
   * 6. Heartbeat já vencido (expiresAt <= now) é descartado de forma terminal e idempotente (EXPIRED).
   * 7. Atualiza lastCommunicationAt somente quando observedAt for estritamente maior que o valor persistido,
   *    utilizando updateMany condicional atômico no banco de dados (proteção contra regressão e concorrência).
   * 8. Repetição, mesma data ou heartbeat antigo retorna NOT_NEWER sem regredir o campo nem causar erro.
   */
  async processHeartbeat(
    rawDto: CameraHeartbeatPayload,
    requestId = '',
    now: Date = new Date(),
  ): Promise<CameraHeartbeatResponseDto> {
    const dto = validateCameraHeartbeatDto(rawDto);
    const cameraCode = dto.cameraCode.trim();
    const observedAt = new Date(dto.observedAt);
    const expiresAt = new Date(dto.expiresAt);

    // Rejeitar instante observedAt excessivamente futuro (> now + 5s)
    if (observedAt.getTime() > now.getTime() + HEARTBEAT_FUTURE_TOLERANCE_MS) {
      throw new InvalidCameraHeartbeatException(
        'O campo observedAt está no futuro além da tolerância permitida de 5 segundos.',
        [
          {
            pointer: '/observedAt',
            code: 'FUTURE_TIMESTAMP_NOT_ALLOWED',
            detail:
              'observedAt não pode exceder a tolerância máxima de 5 segundos no futuro',
          },
        ],
      );
    }

    const prisma = this.prisma.getClient();

    // Resolver a câmera exclusivamente pelo código de integração oficial
    const camera = await prisma.camera.findUnique({
      where: { integrationCode: cameraCode },
      select: {
        id: true,
        integrationCode: true,
        administrativeStatus: true,
        lastCommunicationAt: true,
      },
    });

    if (!camera) {
      this.logger.warn(
        `Câmera não encontrada no recebimento de heartbeat para cameraCode: ${cameraCode} [req: ${requestId}]`,
      );
      throw new CameraNotFoundException(
        `Câmera com código de integração "${cameraCode}" não encontrada no sistema.`,
      );
    }

    // Não avançar câmera administrativamente inativa
    if (camera.administrativeStatus !== 'ATIVA') {
      return {
        accepted: false,
        updated: false,
        reason: 'CAMERA_INACTIVE',
        cameraId: camera.id.toString(),
        cameraCode: camera.integrationCode,
        lastCommunicationAt: camera.lastCommunicationAt
          ? camera.lastCommunicationAt.toISOString()
          : null,
      };
    }

    // Heartbeat já vencido deve ser descartado de forma terminal e idempotente
    if (expiresAt.getTime() <= now.getTime()) {
      return {
        accepted: false,
        updated: false,
        reason: 'EXPIRED',
        cameraId: camera.id.toString(),
        cameraCode: camera.integrationCode,
        lastCommunicationAt: camera.lastCommunicationAt
          ? camera.lastCommunicationAt.toISOString()
          : null,
      };
    }

    // Atualização atômica e monotônica no banco:
    // avança lastCommunicationAt somente se a câmera continuar ATIVA e
    // (lastCommunicationAt IS NULL OR lastCommunicationAt < observedAt)
    const updateResult = await prisma.camera.updateMany({
      where: {
        id: camera.id,
        administrativeStatus: 'ATIVA',
        OR: [
          { lastCommunicationAt: null },
          { lastCommunicationAt: { lt: observedAt } },
        ],
      },
      data: {
        lastCommunicationAt: observedAt,
      },
    });

    if (updateResult.count > 0) {
      // Relê o registro para refletir o instante persistido no banco
      // (inclusive caso outra chamada concorrente com timestamp ainda maior tenha comitado em seguida)
      const updatedCamera = await prisma.camera.findUnique({
        where: { id: camera.id },
        select: {
          lastCommunicationAt: true,
        },
      });

      const finalLastComm = updatedCamera?.lastCommunicationAt ?? observedAt;

      return {
        accepted: true,
        updated: true,
        reason: 'UPDATED',
        cameraId: camera.id.toString(),
        cameraCode: camera.integrationCode,
        lastCommunicationAt: finalLastComm.toISOString(),
      };
    }

    // Caso nenhuma linha tenha sido atualizada, reler o estado atual no banco
    const currentCamera = await prisma.camera.findUnique({
      where: { id: camera.id },
      select: {
        id: true,
        integrationCode: true,
        administrativeStatus: true,
        lastCommunicationAt: true,
      },
    });

    if (!currentCamera) {
      throw new CameraNotFoundException(
        `Câmera com código de integração "${cameraCode}" não encontrada no sistema.`,
      );
    }

    if (currentCamera.administrativeStatus !== 'ATIVA') {
      return {
        accepted: false,
        updated: false,
        reason: 'CAMERA_INACTIVE',
        cameraId: currentCamera.id.toString(),
        cameraCode: currentCamera.integrationCode,
        lastCommunicationAt: currentCamera.lastCommunicationAt
          ? currentCamera.lastCommunicationAt.toISOString()
          : null,
      };
    }

    return {
      accepted: true,
      updated: false,
      reason: 'NOT_NEWER',
      cameraId: currentCamera.id.toString(),
      cameraCode: currentCamera.integrationCode,
      lastCommunicationAt: currentCamera.lastCommunicationAt
        ? currentCamera.lastCommunicationAt.toISOString()
        : null,
    };
  }
}

