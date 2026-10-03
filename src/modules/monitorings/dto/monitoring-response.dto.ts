import type {
  CameraConnectionStatus,
  MonitoringOperationalStatus,
  MonitoringOperationalReason,
} from '../../cameras/camera-connectivity.util.js';

export type MonitoringPersistedStatus = 'ATIVO' | 'PAUSADO' | 'ENCERRADO';

export interface MonitoringCameraItem {
  id: string;
  name: string;
  connectionStatus: CameraConnectionStatus;
}

export interface MonitoringItem {
  id: string;
  status: MonitoringPersistedStatus;
  operationalStatus: MonitoringOperationalStatus;
  operationalReason: MonitoringOperationalReason;
  cameras: MonitoringCameraItem[];
  startedAt: string;
  pausedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

export interface MonitoringResponse {
  data: MonitoringItem;
  meta: {
    requestId: string;
  };
}

export interface CurrentMonitoringsResponse {
  data: MonitoringItem[];
  meta: {
    requestId: string;
  };
}
