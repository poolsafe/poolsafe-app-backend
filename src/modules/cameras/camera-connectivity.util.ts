/**
 * Utilitários compartilhados para cálculo de conectividade e estado operacional
 * das câmeras e sessões de monitoramento do PoolSafe.
 *
 * Referências:
 * - docs/domain-model.md Seções 7.4, 7.6 e 9
 * - docs/api-contract.md Seções 14 e 15
 */

export const DEFAULT_CAMERA_OFFLINE_THRESHOLD_SECONDS = 90;
export const DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS =
  DEFAULT_CAMERA_OFFLINE_THRESHOLD_SECONDS * 1000;

export type CameraConnectionState =
  | 'ONLINE'
  | 'OFFLINE'
  | 'DESCONHECIDA'
  | 'INATIVA';

export type CameraConnectionStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'DESCONHECIDA';

export type MonitoringOperationalStatus =
  | 'ATIVO'
  | 'DEGRADADO'
  | 'INDISPONIVEL'
  | 'PAUSADO';

export type MonitoringOperationalReason =
  | 'OPERACIONAL'
  | 'SEM_SESSAO'
  | 'PAUSADO_PELO_USUARIO'
  | 'CAMERAS_INDISPONIVEIS'
  | 'SEM_CAMERA_ONLINE';

/**
 * Calcula o estado interno de conexão para resumos agregados (ex: Home),
 * onde a distinção administrativa 'INATIVA' é separada da contagem de online/offline.
 */
export function calculateCameraConnectionState(
  camera: {
    administrativeStatus: string;
    lastCommunicationAt: Date | null;
  },
  now: Date,
  thresholdMs: number = DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS,
): CameraConnectionState {
  if (camera.administrativeStatus !== 'ATIVA') {
    return 'INATIVA';
  }
  if (!camera.lastCommunicationAt) {
    return 'DESCONHECIDA';
  }
  if (now.getTime() - camera.lastCommunicationAt.getTime() <= thresholdMs) {
    return 'ONLINE';
  }
  return 'OFFLINE';
}

/**
 * Resolve o connectionStatus estrito do modelo público de câmera (ONLINE, OFFLINE, DESCONHECIDA).
 * Conforme docs/api-contract.md Seção 15.1:
 * "connectionStatus aceita ONLINE, OFFLINE ou DESCONHECIDA. A situação administrativa permanece separada em ATIVA ou INATIVA."
 */
export function resolveCameraConnectionStatus(
  camera: {
    administrativeStatus: string;
    lastCommunicationAt: Date | null;
  },
  now: Date,
  thresholdMs: number = DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS,
): CameraConnectionStatus {
  if (!camera.lastCommunicationAt) {
    return 'DESCONHECIDA';
  }
  if (
    camera.administrativeStatus === 'ATIVA' &&
    now.getTime() - camera.lastCommunicationAt.getTime() <= thresholdMs
  ) {
    return 'ONLINE';
  }
  return 'OFFLINE';
}

/**
 * Calcula o estado operacional de uma sessão de monitoramento (ATIVO, DEGRADADO, INDISPONIVEL, PAUSADO)
 * conforme docs/domain-model.md Seção 9.
 */
export function calculateMonitoringOperationalStatus(
  monitoring: {
    status: string;
    monitoringCameras: Array<{
      camera: {
        administrativeStatus: string;
        lastCommunicationAt: Date | null;
      };
    }>;
  },
  now: Date,
  thresholdMs: number = DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS,
): MonitoringOperationalStatus {
  if (monitoring.status === 'PAUSADO') {
    return 'PAUSADO';
  }

  const sessionCameras = monitoring.monitoringCameras.map((mc) => mc.camera);
  let sessionOnlineCameras = 0;

  for (const cam of sessionCameras) {
    const connState = calculateCameraConnectionState(cam, now, thresholdMs);
    if (connState === 'ONLINE') {
      sessionOnlineCameras++;
    }
  }

  if (sessionOnlineCameras === sessionCameras.length && sessionCameras.length > 0) {
    return 'ATIVO';
  }
  if (sessionOnlineCameras > 0) {
    return 'DEGRADADO';
  }
  return 'INDISPONIVEL';
}

/**
 * Calcula tanto o estado operacional quanto o motivo operacional de uma sessão de monitoramento,
 * conforme docs/domain-model.md Seção 9 e docs/api-contract.md Seção 16.1.
 */
export function calculateMonitoringOperationalState(
  monitoring: {
    status: string;
    monitoringCameras: Array<{
      camera: {
        administrativeStatus: string;
        lastCommunicationAt: Date | null;
      };
    }>;
  },
  now: Date,
  thresholdMs: number = DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS,
): {
  operationalStatus: MonitoringOperationalStatus;
  operationalReason: MonitoringOperationalReason;
} {
  if (monitoring.status === 'PAUSADO') {
    return {
      operationalStatus: 'PAUSADO',
      operationalReason: 'PAUSADO_PELO_USUARIO',
    };
  }

  const sessionCameras = monitoring.monitoringCameras.map((mc) => mc.camera);
  let sessionOnlineCameras = 0;

  for (const cam of sessionCameras) {
    const connState = calculateCameraConnectionState(cam, now, thresholdMs);
    if (connState === 'ONLINE') {
      sessionOnlineCameras++;
    }
  }

  if (sessionOnlineCameras === sessionCameras.length && sessionCameras.length > 0) {
    return {
      operationalStatus: 'ATIVO',
      operationalReason: 'OPERACIONAL',
    };
  }
  if (sessionOnlineCameras > 0) {
    return {
      operationalStatus: 'DEGRADADO',
      operationalReason: 'CAMERAS_INDISPONIVEIS',
    };
  }
  return {
    operationalStatus: 'INDISPONIVEL',
    operationalReason: 'SEM_CAMERA_ONLINE',
  };
}
