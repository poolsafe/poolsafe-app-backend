import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para solicitação de recuperação de senha (POST /api/v1/auth/forgot-password).
 *
 * Referência: docs/api-contract.md Seção 11.5.
 */
export class ForgotPasswordDto {
  @ApiProperty({
    description: 'E-mail do usuário cadastrado',
    example: 'usuario@example.com',
  })
  @IsNotEmpty({ message: 'Informe seu e-mail.' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MaxLength(254, { message: 'O e-mail deve ter no máximo 254 caracteres.' })
  email!: string;
}
