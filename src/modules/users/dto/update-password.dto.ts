import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para alteração autenticada de senha (PUT /api/v1/users/me/password).
 *
 * Conforme docs/api-contract.md Seção 12.3:
 * - currentPassword e newPassword devem ter entre 8 e 128 caracteres.
 * - SEM remoção de espaços nas extremidades ou internos para senhas.
 */
export class UpdatePasswordDto {
  @IsString({ message: 'A senha atual deve ser informada.' })
  @MinLength(8, { message: 'A senha atual deve ter no mínimo 8 caracteres.' })
  @MaxLength(128, { message: 'A senha atual deve ter no máximo 128 caracteres.' })
  currentPassword!: string;

  @IsString({ message: 'A nova senha deve ser informada.' })
  @MinLength(8, { message: 'A nova senha deve ter no mínimo 8 caracteres.' })
  @MaxLength(128, { message: 'A nova senha deve ter no máximo 128 caracteres.' })
  newPassword!: string;
}
