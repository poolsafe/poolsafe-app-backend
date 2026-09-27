export type OverallMonitoringStatus =
  | 'ATIVO'
  | 'PAUSADO'
  | 'DEGRADADO'
  | 'INDISPONIVEL';

export type OverallMonitoringReason =
  | 'OPERACIONAL'
  | 'SEM_SESSAO'
  | 'PAUSADO_PELO_USUARIO'
  | 'CAMERAS_INDISPONIVEIS'
  | 'SEM_CAMERA_ONLINE'
  | 'SESSIONS_MIXED';

export type WarningCode =
  | 'NO_CURRENT_MONITORING'
  | 'MONITORING_PAUSED'
  | 'CAMERA_OFFLINE'
  | 'CAMERA_UNKNOWN';

export type WarningSeverity = 'ATENCAO' | 'CRITICA';

export interface WarningItem {
  code: WarningCode;
  severity: WarningSeverity;
  cameraId?: string;
  monitoringId?: string;
}

export interface LatestAlertCamera {
  id: string;
  name: string;
  location: string | null;
}

export interface LatestAlert {
  id: string;
  type: string;
  severity: string;
  detectedAt: string;
  camera: LatestAlertCamera;
}

export interface OverallMonitoring {
  status: OverallMonitoringStatus;
  reason: OverallMonitoringReason;
  currentSessions: number;
  activeSessions: number;
  pausedSessions: number;
  degradedSessions: number;
  unavailableSessions: number;
}

export interface CamerasSummary {
  total: number;
  online: number;
  offline: number;
  unknown: number;
  inactive: number;
}

export interface HomeData {
  generatedAt: string;
  overallMonitoring: OverallMonitoring;
  cameras: CamerasSummary;
  latestAlert: LatestAlert | null;
  warnings: WarningItem[];
}

export interface HomeResponse {
  data: HomeData;
  meta: {
    requestId: string;
  };
}
