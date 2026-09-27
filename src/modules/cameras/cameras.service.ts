import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { ResourceNotFoundException } from '../../common/errors/problem-details.exception.js';
import {
  DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS,
  resolveCameraConnectionStatus,
  calculateMonitoringOperationalStatus,
} from './camera-connectivity.util.js';
import type {
  CameraAdministrativeStatus,
  CameraItem,
  CamerasListResponse,
  CameraDetailResponse,
  CameraCurrentMonitoring,
  CameraRecentAlert,
} from './dto/cameras-response.dto.js';

@Injectable()
export class CamerasService {
  private readonly logger = new Logger(CamerasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private getThresholdMs(): number {
    const thresholdSeconds =
      this.configService.get<number>('CAMERA_OFFLINE_THRESHOLD_SECONDS') ?? 90;
    return thresholdSeconds * 1000 || DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS;
  }

  /**
   * Lista as câmeras às quais o usuário autenticado possui acesso ativo (acesso_camera).
   * Conforme docs/api-contract.md Seção 15.2 e docs/domain-model.md Seção 10.
   */
  async getCameras(userIdStr: string, requestId: string): Promise<CamerasListResponse> {
    const prisma = this.prisma.getClient();
    const userBigInt = BigInt(userIdStr);
    const now = new Date();
    const thresholdMs = this.getThresholdMs();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. Câmeras com acesso ativo do usuário
    const accesses = await prisma.cameraAccess.findMany({
      where: {
        userId: userBigInt,
        active: true,
        revokedAt: null,
      },
      include: {
        camera: {
          include: {
            monitoringCameras: {
              where: {
                monitoring: {
                  status: { in: ['ATIVO', 'PAUSADO'] },
                },
              },
              include: {
                monitoring: {
                  include: {
                    monitoringCameras: {
                      include: {
                        camera: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const cameraIds = accesses.map((a) => a.camera.id);

    // 2. Contagem de alertas recentes dentro da retenção de 30 dias dos quais o usuário foi destinatário
    const alertsCountMap = new Map<string, number>();

    if (cameraIds.length > 0) {
      const recipientRecords = await prisma.alertRecipient.findMany({
        where: {
          userId: userBigInt,
          alert: {
            cameraId: { in: cameraIds },
            detectedAt: { gte: thirtyDaysAgo },
          },
        },
        select: {
          alert: {
            select: {
              cameraId: true,
            },
          },
        },
      });

      for (const record of recipientRecords) {
        const cId = record.alert.cameraId.toString();
        alertsCountMap.set(cId, (alertsCountMap.get(cId) ?? 0) + 1);
      }
    }

    // 3. Mapeamento das câmeras
    const cameraItems: CameraItem[] = accesses.map((access) => {
      const cam = access.camera;
      const connectionStatus = resolveCameraConnectionStatus(cam, now, thresholdMs);

      let currentMonitoring: CameraCurrentMonitoring | null = null;
      const activeOrPausedMc = cam.monitoringCameras[0];
      if (activeOrPausedMc?.monitoring) {
        const opStatus = calculateMonitoringOperationalStatus(
          activeOrPausedMc.monitoring,
          now,
          thresholdMs,
        );
        currentMonitoring = {
          id: activeOrPausedMc.monitoring.id.toString(),
          status: activeOrPausedMc.monitoring.status,
          operationalStatus: opStatus,
        };
      }

      return {
        id: cam.id.toString(),
        name: cam.name,
        location: cam.location ?? null,
        administrativeStatus: cam.administrativeStatus as CameraAdministrativeStatus,
        connectionStatus,
        lastCommunicationAt: cam.lastCommunicationAt
          ? cam.lastCommunicationAt.toISOString()
          : null,
        currentMonitoring,
        recentAlertsCount: alertsCountMap.get(cam.id.toString()) ?? 0,
      };
    });

    // 4. Ordenação estável por nome e, em caso de empate, por ID
    cameraItems.sort((a, b) => {
      const nameComparison = a.name.localeCompare(b.name, 'pt-BR');
      if (nameComparison !== 0) {
        return nameComparison;
      }
      const aId = BigInt(a.id);
      const bId = BigInt(b.id);
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    });

    return {
      data: cameraItems,
      meta: {
        requestId,
      },
    };
  }

  /**
   * Obtém os detalhes de uma câmera autorizada e até 30 alertas recentes dos quais o usuário foi destinatário.
   * Conforme docs/api-contract.md Seção 15.3 e docs/domain-model.md Seção 10.
   */
  async getCameraDetails(
    cameraIdStr: string,
    userIdStr: string,
    requestId: string,
  ): Promise<CameraDetailResponse> {
    // Validação de formato do ID
    if (!/^\d+$/.test(cameraIdStr)) {
      throw new ResourceNotFoundException('Câmera não encontrada ou acesso não autorizado.');
    }

    const prisma = this.prisma.getClient();
    const userBigInt = BigInt(userIdStr);
    const cameraBigInt = BigInt(cameraIdStr);
    const now = new Date();
    const thresholdMs = this.getThresholdMs();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. Verifica acesso ativo do usuário à câmera
    const access = await prisma.cameraAccess.findFirst({
      where: {
        userId: userBigInt,
        cameraId: cameraBigInt,
        active: true,
        revokedAt: null,
      },
      include: {
        camera: {
          include: {
            monitoringCameras: {
              where: {
                monitoring: {
                  status: { in: ['ATIVO', 'PAUSADO'] },
                },
              },
              include: {
                monitoring: {
                  include: {
                    monitoringCameras: {
                      include: {
                        camera: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!access) {
      throw new ResourceNotFoundException('Câmera não encontrada ou acesso não autorizado.');
    }

    const cam = access.camera;
    const connectionStatus = resolveCameraConnectionStatus(cam, now, thresholdMs);

    // 2. Monitoramento atual da câmera
    let currentMonitoring: CameraCurrentMonitoring | null = null;
    const activeOrPausedMc = cam.monitoringCameras[0];
    if (activeOrPausedMc?.monitoring) {
      const opStatus = calculateMonitoringOperationalStatus(
        activeOrPausedMc.monitoring,
        now,
        thresholdMs,
      );
      currentMonitoring = {
        id: activeOrPausedMc.monitoring.id.toString(),
        status: activeOrPausedMc.monitoring.status,
        operationalStatus: opStatus,
      };
    }

    // 3. Contagem de alertas recentes disponíveis nos últimos 30 dias para o usuário
    const recentAlertsCount = await prisma.alertRecipient.count({
      where: {
        userId: userBigInt,
        alert: {
          cameraId: cameraBigInt,
          detectedAt: { gte: thirtyDaysAgo },
        },
      },
    });

    // 4. Até 30 alertas mais recentes dos quais o usuário foi destinatário
    const recipientRecords = await prisma.alertRecipient.findMany({
      where: {
        userId: userBigInt,
        alert: {
          cameraId: cameraBigInt,
          detectedAt: { gte: thirtyDaysAgo },
        },
      },
      include: {
        alert: {
          include: {
            camera: true,
            evidence: {
              select: {
                expiresAt: true,
                removedAt: true,
              },
            },
          },
        },
      },
      orderBy: [
        { alert: { detectedAt: 'desc' } },
        { alert: { id: 'desc' } },
      ],
      take: 30,
    });

    const recentAlerts: CameraRecentAlert[] = recipientRecords.map(({ alert }) => {
      const isEvidenceAvailable = Boolean(
        alert.evidence &&
        alert.evidence.removedAt === null &&
        alert.evidence.expiresAt > now,
      );

      return {
        id: alert.id.toString(),
        type: alert.type,
        severity: alert.severity,
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
      data: {
        id: cam.id.toString(),
        name: cam.name,
        location: cam.location ?? null,
        administrativeStatus: cam.administrativeStatus as CameraAdministrativeStatus,
        connectionStatus,
        lastCommunicationAt: cam.lastCommunicationAt
          ? cam.lastCommunicationAt.toISOString()
          : null,
        currentMonitoring,
        recentAlertsCount,
        recentAlerts,
      },
      meta: {
        requestId,
      },
    };
  }
}
