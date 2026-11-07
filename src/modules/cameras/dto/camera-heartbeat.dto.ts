import { Injectable, PipeTransform } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  validateSync,
  type ValidationError,
} from 'class-validator';
import {
  InvalidCameraHeartbeatException,
  type ProblemErrorItem,
} from '../../../common/errors/problem-details.exception.js';

export const ISO_8601_INSTANT_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/i;

export type CameraHeartbeatReason =
  | 'UPDATED'
  | 'NOT_NEWER'
  | 'EXPIRED'
  | 'CAMERA_INACTIVE';

export interface CameraHeartbeatPayload {
  eventId: string;
  cameraCode: string;
  observedAt: string;
  expiresAt: string;
  test: boolean;
}

export class CameraHeartbeatDto implements CameraHeartbeatPayload {
  @ApiProperty({
    description: 'Identificador UUID do evento de heartbeat',
    example: '7b83c180-87a4-43ea-9c09-fa936a58fbe8',
  })
  @IsString({ message: 'eventId deve ser uma string' })
  @IsUUID('all', { message: 'eventId deve ser um UUID válido' })
  eventId!: string;

  @ApiProperty({
    description: 'Código de integração oficial da câmera cadastrada no PoolSafe',
    example: 'CAM-TESTE-9B',
    maxLength: 100,
  })
  @IsString({ message: 'cameraCode deve ser uma string' })
  @IsNotEmpty({ message: 'cameraCode não pode ser vazio' })
  @Matches(/\S/, { message: 'cameraCode não pode conter apenas espaços' })
  @MaxLength(100, { message: 'cameraCode deve ter no máximo 100 caracteres' })
  cameraCode!: string;

  @ApiProperty({
    description: 'Instante ISO 8601 UTC observado na captura do frame pela câmera',
    example: '2026-11-07T18:00:00.000Z',
  })
  @IsString({ message: 'observedAt deve ser uma string' })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'observedAt deve ser um instante ISO 8601 válido' },
  )
  @Matches(ISO_8601_INSTANT_REGEX, {
    message: 'observedAt deve ser um instante ISO 8601 completo com fuso horário',
  })
  observedAt!: string;

  @ApiProperty({
    description: 'Instante ISO 8601 UTC de expiração de validade do heartbeat',
    example: '2026-11-07T18:01:00.000Z',
  })
  @IsString({ message: 'expiresAt deve ser uma string' })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'expiresAt deve ser um instante ISO 8601 válido' },
  )
  @Matches(ISO_8601_INSTANT_REGEX, {
    message: 'expiresAt deve ser um instante ISO 8601 completo com fuso horário',
  })
  expiresAt!: string;

  @ApiProperty({
    description: 'Indica se o evento foi emitido em modo de teste',
    example: true,
  })
  @IsBoolean({ message: 'test deve ser um valor booleano' })
  test!: boolean;
}

export class CameraHeartbeatResponseDto {
  @ApiProperty({
    description: 'Indica se o heartbeat foi aceito pelo domínio',
    example: true,
  })
  accepted!: boolean;

  @ApiProperty({
    description: 'Indica se o campo lastCommunicationAt da câmera avançou no banco',
    example: true,
  })
  updated!: boolean;

  @ApiProperty({
    description: 'Razão explícita do resultado do processamento do heartbeat',
    example: 'UPDATED',
    enum: ['UPDATED', 'NOT_NEWER', 'EXPIRED', 'CAMERA_INACTIVE'],
  })
  reason!: CameraHeartbeatReason;

  @ApiProperty({
    description: 'Identificador interno da câmera resolvida pelo cameraCode',
    example: '1',
  })
  cameraId!: string;

  @ApiProperty({
    description: 'Código de integração oficial da câmera',
    example: 'CAM-TESTE-9B',
  })
  cameraCode!: string;

  @ApiProperty({
    description: 'Último instante de comunicação persistido na câmera (UTC ISO 8601)',
    example: '2026-11-07T18:00:00.000Z',
    nullable: true,
  })
  lastCommunicationAt!: string | null;
}

function formatDtoValidationErrors(
  errors: ValidationError[],
  parent = '',
): ProblemErrorItem[] {
  const result: ProblemErrorItem[] = [];
  for (const err of errors) {
    const pointer = `${parent}/${err.property}`;
    if (err.constraints) {
      for (const [key, msg] of Object.entries(err.constraints)) {
        let code = 'INVALID_FIELD';
        if (key === 'isUuid') code = 'INVALID_UUID';
        else if (key === 'isNotEmpty') code = 'REQUIRED_FIELD';
        else if (key === 'maxLength') code = 'FIELD_TOO_LONG';
        else if (key === 'whitelistValidation') code = 'UNKNOWN_FIELD';
        result.push({
          pointer,
          code,
          detail: msg,
        });
      }
    }
    if (err.children && err.children.length > 0) {
      result.push(...formatDtoValidationErrors(err.children, pointer));
    }
  }
  return result;
}

export function validateCameraHeartbeatDto(raw: unknown): CameraHeartbeatDto {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidCameraHeartbeatException(
      'O corpo da requisição deve ser um objeto JSON válido.',
    );
  }

  const instance = plainToInstance(CameraHeartbeatDto, raw, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    throw new InvalidCameraHeartbeatException(
      'Um ou mais campos precisam ser corrigidos.',
      formatDtoValidationErrors(errors),
    );
  }

  const observedAtMs = Date.parse(instance.observedAt);
  const expiresAtMs = Date.parse(instance.expiresAt);

  if (Number.isNaN(observedAtMs)) {
    throw new InvalidCameraHeartbeatException(
      'O campo observedAt deve ser um instante ISO 8601 válido.',
      [
        {
          pointer: '/observedAt',
          code: 'INVALID_FIELD',
          detail: 'observedAt deve ser um instante ISO 8601 válido',
        },
      ],
    );
  }

  if (Number.isNaN(expiresAtMs)) {
    throw new InvalidCameraHeartbeatException(
      'O campo expiresAt deve ser um instante ISO 8601 válido.',
      [
        {
          pointer: '/expiresAt',
          code: 'INVALID_FIELD',
          detail: 'expiresAt deve ser um instante ISO 8601 válido',
        },
      ],
    );
  }

  if (expiresAtMs < observedAtMs) {
    throw new InvalidCameraHeartbeatException(
      'O campo expiresAt deve ser posterior ou igual a observedAt.',
      [
        {
          pointer: '/expiresAt',
          code: 'INVALID_TIME_RANGE',
          detail: 'expiresAt deve ser posterior ou igual a observedAt',
        },
      ],
    );
  }

  return instance;
}

@Injectable()
export class CameraHeartbeatValidationPipe
  implements PipeTransform<unknown, CameraHeartbeatDto>
{
  transform(value: unknown): CameraHeartbeatDto {
    return validateCameraHeartbeatDto(value);
  }
}

