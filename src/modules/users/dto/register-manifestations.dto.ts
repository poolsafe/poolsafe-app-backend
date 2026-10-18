import { IsBoolean, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para registrar aceite de Termos de Uso e ciência do Aviso de Privacidade
 * por contas existentes (POST /api/v1/users/me/manifestations).
 */
export class RegisterManifestationsDto {
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
}
