import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

export class CreateMonitoringDto {
  @ApiProperty({
    description: 'Lista de identificadores decimais das câmeras a serem monitoradas',
    example: ['8', '9'],
    type: [String],
  })
  @IsArray({ message: 'cameraIds deve ser uma lista de identificadores.' })
  @ArrayNotEmpty({ message: 'Informe ao menos um identificador de câmera.' })
  @ArrayUnique({ message: 'A lista de câmeras não pode conter identificadores duplicados.' })
  @IsString({ each: true, message: 'Cada identificador de câmera deve ser uma string.' })
  @Matches(/^\d+$/, {
    each: true,
    message: 'Cada identificador de câmera deve ser uma string decimal válida.',
  })
  cameraIds!: string[];
}
