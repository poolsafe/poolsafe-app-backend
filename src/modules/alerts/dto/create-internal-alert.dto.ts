import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InternalAlertEvidenceDto {
  @ApiPropertyOptional({
    description: 'Tipo MIME da imagem capturada (image/jpeg ou image/png)',
    example: 'image/jpeg',
    enum: ['image/jpeg', 'image/png'],
  })
  mimeType?: string;

  @ApiPropertyOptional({
    description: 'Conteúdo binário da imagem codificado em Base64 (máx. 5 MiB)',
    example: '/9j/4AAQSkZJRg...',
  })
  base64?: string;
}

export class CreateInternalAlertDto {
  @ApiProperty({
    description: 'Versão do schema do evento (deve ser "1")',
    example: '1',
  })
  @IsString()
  @Equals('1', { message: 'schemaVersion deve ser igual a "1"' })
  schemaVersion!: string;

  @ApiProperty({
    description: 'Chave global e idempotente gerada na origem da detecção',
    example: '3e38e6be-196a-4da2-a51f-252eaa2a83ad',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty({ message: 'eventKey não pode ser vazio' })
  @MaxLength(100, { message: 'eventKey deve ter no máximo 100 caracteres' })
  eventKey!: string;

  @ApiProperty({
    description: 'Código de integração da câmera cadastrada no PoolSafe',
    example: 'CAM-POOL-001',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty({ message: 'cameraCode não pode ser vazio' })
  @MaxLength(100, { message: 'cameraCode deve ter no máximo 100 caracteres' })
  cameraCode!: string;

  @ApiPropertyOptional({
    description: 'Tipo do alerta detectado',
    example: 'POSSIVEL_RISCO',
    default: 'POSSIVEL_RISCO',
    enum: ['POSSIVEL_RISCO'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['POSSIVEL_RISCO'], {
    message: 'type deve ser POSSIVEL_RISCO',
  })
  type?: string = 'POSSIVEL_RISCO';

  @ApiProperty({
    description: 'Nível de severidade do alerta',
    example: 'CRITICA',
    enum: ['CRITICA', 'ATENCAO'],
  })
  @IsString()
  @IsEnum(['CRITICA', 'ATENCAO'], {
    message: 'severity deve ser CRITICA ou ATENCAO',
  })
  severity!: 'CRITICA' | 'ATENCAO';

  @ApiProperty({
    description: 'Instante UTC em que a situação foi detectada na origem',
    example: '2026-10-11T18:00:00.000Z',
  })
  @IsISO8601(
    { strict: true },
    { message: 'detectedAt deve ser uma data ISO 8601 válida' },
  )
  detectedAt!: string;

  @ApiPropertyOptional({
    description: 'Grau de confiança da detecção entre 0.0000 e 1.0000',
    example: 0.895,
  })
  @IsOptional()
  @IsNumber({}, { message: 'confidence deve ser um número decimal' })
  @Min(0, { message: 'confidence deve ser maior ou igual a 0' })
  @Max(1, { message: 'confidence deve ser menor ou igual a 1' })
  confidence?: number;

  @ApiPropertyOptional({
    description: 'Identificador ou versão do modelo de visão computacional',
    example: 'yolov11-poolsafe-1',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'modelVersion deve ter no máximo 50 caracteres' })
  modelVersion?: string;

  @ApiPropertyOptional({
    description: 'Metadados técnicos não sensíveis da detecção (máx. 16 KiB)',
    example: { trackId: '17', confirmationFrames: 5 },
  })
  @IsOptional()
  @IsObject({ message: 'technicalData deve ser um objeto JSON' })
  technicalData?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Evidência visual opcional associada ao alerta',
    type: InternalAlertEvidenceDto,
  })
  @IsOptional()
  evidence?: unknown;

  @ApiPropertyOptional({
    description: 'Título snapshot opcional para a notificação',
    example: 'Possível situação de risco',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'title deve ter no máximo 120 caracteres' })
  title?: string;

  @ApiPropertyOptional({
    description: 'Mensagem snapshot opcional para a notificação',
    example: 'Abra o PoolSafe para verificar o alerta.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'message deve ter no máximo 500 caracteres' })
  message?: string;
}
