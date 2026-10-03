import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para redefinição de senha com código/token de uso único (POST /api/v1/auth/reset-password).
 *
 * Referência: docs/api-contract.md Seção 11.6.
 */
export class ResetPasswordDto {
  @ApiProperty({
    description: 'Código de 8 caracteres alfanuméricos recebido por e-mail (formato XXXX-XXXX ou sem hífen)',
    example: 'AB7K-2P9Q',
  })
  @IsNotEmpty({ message: 'Informe o código de recuperação.' })
  @IsString({ message: 'O código deve ser uma string.' })
  token!: string;

  @ApiProperty({
    description: 'Nova senha segura da conta (mínimo 8 e máximo 128 caracteres, espaços preservados)',
    example: 'nova-senha-segura',
  })
  @IsString({ message: 'A nova senha deve ser uma string.' })
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
  @MaxLength(128, { message: 'A senha deve ter no máximo 128 caracteres.' })
  newPassword!: string;
}
