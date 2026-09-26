import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO para autenticação de usuário (POST /api/v1/auth/login).
 *
 * Referência: docs/api-contract.md Seção 11.2.
 */
export class LoginDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MaxLength(254, { message: 'O e-mail deve ter no máximo 254 caracteres.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
  @MaxLength(128, { message: 'A senha deve ter no máximo 128 caracteres.' })
  password!: string;
}
