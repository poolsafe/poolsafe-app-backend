import type { DevicePlatform } from './upsert-device.dto.js';

/**
 * Resposta pública do registro de instalação (docs/api-contract.md Seção 13.1).
 * Nunca contém o FCM Token.
 */
export interface DeviceResponseData {
  id: string;
  installationId: string;
  platform: DevicePlatform | string;
  active: boolean;
  pushEligible: boolean;
  tokenUpdatedAt: string | null;
}

export interface DeviceResponse {
  data: DeviceResponseData;
  meta: {
    requestId: string;
  };
}
