import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PurgeEvidenceQueryDto {
  @ApiPropertyOptional({
    description: 'Quantidade máxima de evidências expiradas a expurgar neste lote (padrão: 100, máx: 500)',
    example: 100,
    default: 100,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um número inteiro' })
  @Min(1, { message: 'limit deve ser no mínimo 1' })
  @Max(500, { message: 'limit deve ser no máximo 500' })
  limit?: number = 100;
}

export class PurgeEvidenceResponseDto {
  @ApiProperty({
    description: 'Indica se a operação de expurgo foi concluída com sucesso',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Quantidade de evidências físicas (LONGBLOB) limpas neste lote',
    example: 100,
  })
  purgedCount!: number;

  @ApiProperty({
    description: 'Indica se ainda existem evidências vencidas pendentes de expurgo na base',
    example: false,
  })
  hasMore!: boolean;

  @ApiProperty({
    description: 'Quantidade restante aproximada de evidências vencidas e não limpas após este lote',
    example: 0,
  })
  remainingCount!: number;

  @ApiProperty({
    description: 'Instante UTC de execução do expurgo',
    example: '2026-10-18T03:00:00.000Z',
  })
  executedAt!: string;
}
