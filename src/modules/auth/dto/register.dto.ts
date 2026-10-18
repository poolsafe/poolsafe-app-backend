import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para cadastro de usuário (POST /api/v1/auth/register).
 *
 * Registra manifestações obrigatórias de Termos de Uso e Aviso de Privacidade,
 * além de suporte a telefone opcional com autorização destacada.
 */
export class RegisterDto {
  @ApiProperty({
    example: 'Daniel Silva',
    description: 'Nome completo do responsável',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name!: string;

  @ApiProperty({
    example: 'dan@example.com',
    description: 'E-mail de acesso da conta',
  })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MaxLength(254, { message: 'O e-mail deve ter no máximo 254 caracteres.' })
  email!: string;

  // Sem remoção de espaços nas extremidades ou internos para senhas
  @ApiProperty({
    example: 'senha-segura-123',
    description: 'Senha da conta (8 a 128 caracteres)',
  })
  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
  @MaxLength(128, { message: 'A senha deve ter no máximo 128 caracteres.' })
  password!: string;

  @ApiProperty({
    example: true,
    description: 'Manifestação explícita de aceite dos Termos de Uso',
  })
  @IsBoolean({ message: 'É necessário manifestar aceite dos Termos de Uso.' })
  termsAccepted!: boolean;

  @ApiProperty({
    example: '1.0',
    description: 'Versão apresentada e aceita dos Termos de Uso',
  })
  @IsString({ message: 'A versão dos Termos de Uso deve ser um texto.' })
  termsVersion!: string;

  @ApiProperty({
    example: true,
    description: 'Manifestação explícita de ciência do Aviso de Privacidade',
  })
  @IsBoolean({
    message: 'É necessário manifestar ciência do Aviso de Privacidade.',
  })
  privacyAware!: boolean;

  @ApiProperty({
    example: '1.0',
    description: 'Versão apresentada e ciente do Aviso de Privacidade',
  })
  @IsString({
    message: 'A versão do Aviso de Privacidade deve ser um texto.',
  })
  privacyVersion!: string;

  @ApiPropertyOptional({
    example: '(11) 98765-4321',
    description: 'Telefone opcional para contato da equipe',
  })
  @IsOptional()
  @IsString({ message: 'O telefone deve ser um texto.' })
  phone?: string | null;

  @ApiPropertyOptional({
    example: false,
    description:
      'Autorização opcional e específica para contato telefônico da equipe sobre suporte e avisos',
  })
  @IsOptional()
  @IsBoolean({ message: 'A autorização de contato deve ser booleana.' })
  phoneContactAuthorized?: boolean;

  @ApiPropertyOptional({
    example: '1.0',
    description: 'Versão da finalidade/autorização de contato telefônico',
  })
  @IsOptional()
  @IsString({ message: 'A versão da autorização de contato deve ser um texto.' })
  phoneContactVersion?: string;
}
