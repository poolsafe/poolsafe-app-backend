import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  HomeResponse,
  OverallMonitoringStatus,
  OverallMonitoringReason,
  CamerasSummary,
  LatestAlert,
  WarningItem,
} from './dto/home-response.dto.js';
import {
  DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS,
  calculateCameraConnectionState,
  type CameraConnectionState,
} from '../cameras/camera-connectivity.util.js';

export const CAMERA_OFFLINE_THRESHOLD_MS = DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS;
export { calculateCameraConnectionState, type CameraConnectionState };

@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Obtém o resumo consolidado da Home para o usuário autenticado.
   * Conforme docs/api-contract.md Seção 14 e docs/domain-model.md Seção 9, 10 e 12.
   *
   * Regras estritas:
   * - Retorna apenas câmeras às quais o usuário possui acesso ativo (acesso_camera).
   * - Retorna apenas monitoramentos que contêm câmeras autorizadas do usuário.
   * - Retorna o alerta mais recente apenas se o usuário foi destinatário (alerta_destinatario).
   */
  async getHomeSummary(userIdStr: string, requestId: string): Promise<HomeResponse> {
    const prisma = this.prisma.getClient();
    const userBigInt = BigInt(userIdStr);
    const now = new Date();
    const thresholdSeconds =
      this.configService.get<number>('CAMERA_OFFLINE_THRESHOLD_SECONDS') ?? 90;
    const thresholdMs = thresholdSeconds * 1000;

    // 1. Câmeras com acesso ativo do usuário
    const cameraAccesses = await prisma.cameraAccess.findMany({
      where: {
        userId: userBigInt,
        active: true,
        revokedAt: null,
      },
      include: {
        camera: true,
      },
      orderBy: {
        camera: {
          id: 'asc',
        },
      },
    });

    // 2. Resumo de conectividade das câmeras autorizadas
    let onlineCount = 0;
    let offlineCount = 0;
    let unknownCount = 0;
    let inactiveCount = 0;

    const cameraMap = new Map<
      string,
      {
        camera: typeof cameraAccesses[0]['camera'];
        connectionState: CameraConnectionState;
      }
    >();

    for (const access of cameraAccesses) {
      const state = calculateCameraConnectionState(access.camera, now, thresholdMs);
      cameraMap.set(access.camera.id.toString(), {
        camera: access.camera,
        connectionState: state,
      });

      if (state === 'ONLINE') onlineCount++;
      else if (state === 'OFFLINE') offlineCount++;
      else if (state === 'DESCONHECIDA') unknownCount++;
      else if (state === 'INATIVA') inactiveCount++;
    }

    const camerasSummary: CamerasSummary = {
      total: cameraAccesses.length,
      online: onlineCount,
      offline: offlineCount,
      unknown: unknownCount,
      inactive: inactiveCount,
    };

    // 3. Monitoramentos atuais (não encerrados) associados às câmeras autorizadas
    let currentSessions = 0;
    let activeSessions = 0;
    let pausedSessions = 0;
    let degradedSessions = 0;
    let unavailableSessions = 0;

    const cameraIds = Array.from(cameraMap.keys()).map((id) => BigInt(id));
    const monitorings: Array<{
      id: bigint;
      status: string;
      monitoringCameras: Array<{
        camera: {
          id: bigint;
          administrativeStatus: string;
          lastCommunicationAt: Date | null;
        };
      }>;
    }> = [];
    const cameraToMonitoringMap = new Map<string, { id: bigint; status: string }>();

    if (cameraIds.length > 0) {
      const monitoringCameras = await prisma.monitoringCamera.findMany({
        where: {
          cameraId: { in: cameraIds },
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
      });

      const uniqueMonitoringMap = new Map<string, typeof monitoringCameras[0]['monitoring']>();

      for (const mc of monitoringCameras) {
        if (!uniqueMonitoringMap.has(mc.monitoring.id.toString())) {
          uniqueMonitoringMap.set(mc.monitoring.id.toString(), mc.monitoring);
          monitorings.push(mc.monitoring);
        }
        cameraToMonitoringMap.set(mc.cameraId.toString(), {
          id: mc.monitoring.id,
          status: mc.monitoring.status,
        });
      }

      for (const monitoring of monitorings) {
        if (monitoring.status === 'PAUSADO') {
          pausedSessions++;
        } else if (monitoring.status === 'ATIVO') {
          activeSessions++;

          const sessionCameras = monitoring.monitoringCameras.map((mc) => mc.camera);
          let sessionOnlineCameras = 0;

          for (const cam of sessionCameras) {
            const state = calculateCameraConnectionState(cam, now, thresholdMs);
            if (state === 'ONLINE') {
              sessionOnlineCameras++;
            }
          }

          if (sessionOnlineCameras === sessionCameras.length && sessionCameras.length > 0) {
            // Sessão totalmente operacional
          } else if (sessionOnlineCameras > 0) {
            degradedSessions++;
          } else {
            unavailableSessions++;
          }
        }
      }

      currentSessions = activeSessions + pausedSessions;
    }

    // 4. Consolidação do estado global do monitoramento (docs/domain-model.md Seção 9)
    let overallStatus: OverallMonitoringStatus;
    let overallReason: OverallMonitoringReason;

    if (currentSessions === 0) {
      overallStatus = 'INDISPONIVEL';
      overallReason = 'SEM_SESSAO';
    } else if (activeSessions === 0) {
      overallStatus = 'PAUSADO';
      overallReason = 'PAUSADO_PELO_USUARIO';
    } else if (pausedSessions > 0 && activeSessions > 0) {
      overallStatus = 'DEGRADADO';
      overallReason = 'SESSIONS_MIXED';
    } else {
      // Todas as sessões atuais são ativas
      if (unavailableSessions === activeSessions) {
        overallStatus = 'INDISPONIVEL';
        overallReason = 'SEM_CAMERA_ONLINE';
      } else if (degradedSessions > 0 || unavailableSessions > 0) {
        overallStatus = 'DEGRADADO';
        overallReason = 'CAMERAS_INDISPONIVEIS';
      } else {
        overallStatus = 'ATIVO';
        overallReason = 'OPERACIONAL';
      }
    }

    // 5. Avisos operacionais (warnings)
    const warnings: WarningItem[] = [];

    // Aviso de ausência de monitoramento
    if (currentSessions === 0) {
      warnings.push({
        code: 'NO_CURRENT_MONITORING',
        severity: 'ATENCAO',
      });
    }

    // Avisos de sessões pausadas
    for (const monitoring of monitorings) {
      if (monitoring.status === 'PAUSADO') {
        warnings.push({
          code: 'MONITORING_PAUSED',
          severity: 'ATENCAO',
          monitoringId: monitoring.id.toString(),
        });
      }
    }

    // Avisos de câmeras offline ou desconhecidas
    for (const [camIdStr, entry] of cameraMap.entries()) {
      const assignedMonitoring = cameraToMonitoringMap.get(camIdStr);
      if (entry.connectionState === 'OFFLINE') {
        warnings.push({
          code: 'CAMERA_OFFLINE',
          severity: 'ATENCAO',
          cameraId: camIdStr,
          ...(assignedMonitoring ? { monitoringId: assignedMonitoring.id.toString() } : {}),
        });
      } else if (entry.connectionState === 'DESCONHECIDA') {
        warnings.push({
          code: 'CAMERA_UNKNOWN',
          severity: 'ATENCAO',
          cameraId: camIdStr,
          ...(assignedMonitoring ? { monitoringId: assignedMonitoring.id.toString() } : {}),
        });
      }
    }

    // 6. Alerta mais recente autorizado para o usuário
    const latestRecipient = await prisma.alertRecipient.findFirst({
      where: {
        userId: userBigInt,
      },
      include: {
        alert: {
          include: {
            camera: true,
          },
        },
      },
      orderBy: {
        alert: {
          detectedAt: 'desc',
        },
      },
    });

    let latestAlert: LatestAlert | null = null;
    if (latestRecipient?.alert) {
      const alert = latestRecipient.alert;
      latestAlert = {
        id: alert.id.toString(),
        type: alert.type,
        severity: alert.severity,
        detectedAt: alert.detectedAt.toISOString(),
        camera: {
          id: alert.camera.id.toString(),
          name: alert.camera.name,
          location: alert.camera.location ?? null,
        },
      };
    }

    return {
      data: {
        generatedAt: now.toISOString(),
        overallMonitoring: {
          status: overallStatus,
          reason: overallReason,
          currentSessions,
          activeSessions,
          pausedSessions,
          degradedSessions,
          unavailableSessions,
        },
        cameras: camerasSummary,
        latestAlert,
        warnings,
      },
      meta: {
        requestId,
      },
    };
  }
}
