import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export type DeliveryResultType =
  | 'ACCEPTED'
  | 'TRANSIENT_FAILURE'
  | 'TERMINAL_FAILURE'
  | 'UNKNOWN';

export class RecordDeliveryResultDto {
  @ApiProperty({
    description: 'Número ordinal da tentativa sendo reportada (obtido na preparação)',
    example: 1,
  })
  @IsInt({ message: 'attemptNumber deve ser um número inteiro' })
  @Min(1, { message: 'attemptNumber deve ser no mínimo 1' })
  attemptNumber!: number;

  @ApiProperty({
    description: 'Token FCM utilizado na tentativa de envio externo pelo N8N',
    example: 'dK5...j9Z',
  })
  @IsString()
  @IsNotEmpty({ message: 'usedToken não pode ser vazio' })
  usedToken!: string;


  @ApiProperty({
    description:
      'Classificação do resultado da tentativa: ACCEPTED, TRANSIENT_FAILURE, TERMINAL_FAILURE ou UNKNOWN',
    example: 'ACCEPTED',
    enum: ['ACCEPTED', 'TRANSIENT_FAILURE', 'TERMINAL_FAILURE', 'UNKNOWN'],
  })
  @IsString()
  @IsEnum(['ACCEPTED', 'TRANSIENT_FAILURE', 'TERMINAL_FAILURE', 'UNKNOWN'], {
    message:
      'resultType deve ser ACCEPTED, TRANSIENT_FAILURE, TERMINAL_FAILURE ou UNKNOWN',
  })
  resultType!: DeliveryResultType;

  @ApiPropertyOptional({
    description:
      'Identificador retornado pelo FCM v1 após aceite (obrigatório se resultType=ACCEPTED)',
    example: 'projects/poolsafe-1f0db/messages/1234567890',
  })
  @ValidateIf((o) => o.resultType === 'ACCEPTED')
  @IsString()
  @IsNotEmpty({
    message: 'fcmMessageId é obrigatório quando resultType for ACCEPTED',
  })
  @MaxLength(255, {
    message: 'fcmMessageId deve ter no máximo 255 caracteres',
  })
  fcmMessageId?: string;

  @ApiPropertyOptional({
    description:
      'Código de erro retornado pelo provedor ou pelo executor (ex: UNREGISTERED, UNAVAILABLE, TIMEOUT)',
    example: 'UNREGISTERED',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, {
    message: 'errorCode deve ter no máximo 100 caracteres',
  })
  errorCode?: string;

  @ApiPropertyOptional({
    description:
      'Detalhes descritivos do erro sem dados sensíveis (máx. 500 caracteres)',
    example: 'Requested entity was not found.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'errorDetail deve ter no máximo 500 caracteres',
  })
  errorDetail?: string;

  @ApiPropertyOptional({
    description: 'Objeto de resposta do provedor para auditoria diagnóstica',
    example: {},
  })
  @IsOptional()
  @IsObject()
  providerResponse?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Header Retry-After retornado pelo FCM v1 (em segundos ou formato date-time HTTP)',
    example: 60,
  })
  @IsOptional()
  retryAfter?: string | number;
}

