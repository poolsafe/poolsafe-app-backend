export type CameraAdministrativeStatus = 'ATIVA' | 'INATIVA';
export type CameraConnectionStatus = 'ONLINE' | 'OFFLINE' | 'DESCONHECIDA';

export interface CameraCurrentMonitoring {
  id: string;
  status: string;
  operationalStatus: string;
}

export interface CameraAlertCamera {
  id: string;
  name: string;
  location: string | null;
}

export interface CameraRecentAlert {
  id: string;
  type: string;
  severity: string;
  detectedAt: string;
  camera: CameraAlertCamera;
  evidenceAvailable: boolean;
}

export interface CameraItem {
  id: string;
  name: string;
  location: string | null;
  administrativeStatus: CameraAdministrativeStatus;
  connectionStatus: CameraConnectionStatus;
  lastCommunicationAt: string | null;
  currentMonitoring: CameraCurrentMonitoring | null;
  recentAlertsCount: number;
}

export interface CamerasListResponse {
  data: CameraItem[];
  meta: {
    requestId: string;
  };
}

export interface CameraDetailItem extends CameraItem {
  recentAlerts: CameraRecentAlert[];
}

export interface CameraDetailResponse {
  data: CameraDetailItem;
  meta: {
    requestId: string;
  };
}
