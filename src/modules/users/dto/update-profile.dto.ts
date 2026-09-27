import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO para atualização do perfil do usuário autenticado (PATCH /api/v1/users/me).
 *
 * Conforme docs/api-contract.md Seção 12.2:
 * - Apenas o nome pode ser atualizado.
 * - E-mail não é editável no MVP.
 * - Nome deve ter entre 2 e 120 caracteres após normalização (trim).
 */
export class UpdateProfileDto {
  @IsString({ message: 'O nome deve ser um texto.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name!: string;
}
