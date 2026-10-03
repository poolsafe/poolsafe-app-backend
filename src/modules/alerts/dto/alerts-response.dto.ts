export type AlertSeverity = 'ATENCAO' | 'CRITICA';
export type EvidenceUnavailableReason = 'NOT_CAPTURED' | 'EXPIRED' | 'REMOVED';

export interface AlertCameraSummary {
  id: string;
  name: string;
  location: string | null;
}

export interface AlertSummaryItem {
  id: string;
  type: string;
  severity: AlertSeverity;
  detectedAt: string;
  camera: AlertCameraSummary;
  evidenceAvailable: boolean;
}

export interface AlertsPaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AlertsListResponse {
  data: AlertSummaryItem[];
  pagination: AlertsPaginationMeta;
  meta: {
    requestId: string;
  };
}

export interface AlertEvidenceInfo {
  available: boolean;
  mimeType: string | null;
  expiresAt: string | null;
  unavailableReason: EvidenceUnavailableReason | null;
}

export interface AlertNotificationInfo {
  status: string;
  processedAt: string | null;
}

export interface AlertDetailItem {
  id: string;
  type: string;
  severity: AlertSeverity;
  detectedAt: string;
  camera: AlertCameraSummary;
  monitoringId: string;
  evidence: AlertEvidenceInfo;
  notification: AlertNotificationInfo | null;
}

export interface AlertDetailResponse {
  data: AlertDetailItem;
  meta: {
    requestId: string;
  };
}
