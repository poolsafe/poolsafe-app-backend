import { IsIn, IsString, Length, Matches, ValidateIf } from 'class-validator';

export const SUPPORTED_DEVICE_PLATFORMS = ['ANDROID', 'IOS'] as const;
export type DevicePlatform = (typeof SUPPORTED_DEVICE_PLATFORMS)[number];

/** Tamanho máximo do FCM Token persistido (coluna `fcm_token VARCHAR(512)`). */
export const FCM_TOKEN_MAX_LENGTH = 512;
/** Limite inferior deliberadamente folgado: não presume a estrutura interna do token. */
export const FCM_TOKEN_MIN_LENGTH = 16;

/**
 * DTO de registro/atualização idempotente da instalação (PUT /api/v1/devices/:installationId).
 *
 * Referência: docs/api-contract.md Seção 13.1.
 *
 * - `fcmToken: null` mantém a instalação conhecida, porém sem elegibilidade para push.
 * - `fcmToken` ausente é inválido: o cliente precisa declarar explicitamente `null`.
 * - Nenhuma mensagem de validação interpola o valor recebido, para que o token nunca
 *   apareça em respostas ou logs de erro.
 */
export class UpsertDeviceDto {
  @IsIn(SUPPORTED_DEVICE_PLATFORMS, { message: 'A plataforma informada não é suportada.' })
  platform!: DevicePlatform;

  @ValidateIf((_object, value) => value !== null)
  @IsString({ message: 'O fcmToken deve ser uma string ou null.' })
  @Length(FCM_TOKEN_MIN_LENGTH, FCM_TOKEN_MAX_LENGTH, {
    message: 'O fcmToken possui tamanho inválido.',
  })
  @Matches(/^[\x21-\x7E]+$/, {
    message: 'O fcmToken contém caracteres inválidos.',
  })
  fcmToken!: string | null;
}
