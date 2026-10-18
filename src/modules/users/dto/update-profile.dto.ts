import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para atualização do perfil do usuário autenticado (PATCH /api/v1/users/me).
 *
 * Permite atualizar nome, telefone e autorização específica de contato.
 * Preserva campos omitidos no PATCH.
 * Não permite alterar e-mail, horários do servidor ou versões de documentos.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Daniel Silva',
    description: 'Nome completo do usuário (2 a 120 caracteres)',
  })
  @IsOptional()
  @IsString({ message: 'O nome deve ser um texto.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name?: string;

  @ApiPropertyOptional({
    example: '(11) 98765-4321',
    description:
      'Telefone para contato da equipe. Enviar null ou vazio para remover o número.',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'O telefone deve ser um texto ou nulo.' })
  phone?: string | null;

  @ApiPropertyOptional({
    example: true,
    description:
      'Autorização para contato telefônico da equipe. Definir como false para revogar.',
  })
  @IsOptional()
  @IsBoolean({ message: 'A autorização de contato deve ser booleana.' })
  phoneContactAuthorized?: boolean;
}
