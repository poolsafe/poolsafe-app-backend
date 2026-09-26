import { IsOptional, IsString } from 'class-validator';

/**
 * DTO para encerramento de sessão (POST /api/v1/auth/logout).
 *
 * Referência: docs/api-contract.md Seção 11.4.
 */
export class LogoutDto {
  @IsString({ message: 'O refreshToken é obrigatório.' })
  refreshToken!: string;

  @IsOptional()
  @IsString({ message: 'O installationId deve ser uma string válida.' })
  installationId?: string;
}
