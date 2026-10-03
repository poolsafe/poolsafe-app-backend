import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsString,
  IsIn,
  IsISO8601,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetAlertsQueryDto {
  @ApiPropertyOptional({
    description: 'Quantidade máxima de alertas por página (padrão: 20, máximo: 50)',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um número inteiro' })
  @Min(1, { message: 'limit mínimo é 1' })
  @Max(50, { message: 'limit máximo é 50' })
  limit?: number;

  @ApiPropertyOptional({
    description: 'Cursor opaco assinado para continuidade da paginação',
  })
  @IsOptional()
  @IsString({ message: 'cursor deve ser uma string' })
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por identificador de câmera',
    example: '8',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'cameraId deve ser um identificador numérico' })
  cameraId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por severidade do alerta',
    enum: ['ATENCAO', 'CRITICA'],
  })
  @IsOptional()
  @IsIn(['ATENCAO', 'CRITICA'], {
    message: 'severity deve ser ATENCAO ou CRITICA',
  })
  severity?: 'ATENCAO' | 'CRITICA';

  @ApiPropertyOptional({
    description: 'Data/hora inicial inclusiva em formato ISO 8601 UTC',
    example: '2026-09-18T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'from deve ser uma data/hora no formato ISO 8601' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Data/hora final exclusiva em formato ISO 8601 UTC (posterior a from)',
    example: '2026-09-19T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'to deve ser uma data/hora no formato ISO 8601' })
  to?: string;
}
