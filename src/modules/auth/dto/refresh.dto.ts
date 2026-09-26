import { IsString, Matches } from 'class-validator';

/**
 * DTO para rotação de tokens (POST /api/v1/auth/refresh).
 *
 * Referência: docs/api-contract.md Seção 11.3.
 */
export class RefreshDto {
  @IsString({ message: 'O refreshToken é obrigatório.' })
  @Matches(/^psrt_\d+\.[a-zA-Z0-9_-]+$/, {
    message: 'Formato do refreshToken inválido. Formato esperado: psrt_<sessionId>.<segredo>',
  })
  refreshToken!: string;
}
