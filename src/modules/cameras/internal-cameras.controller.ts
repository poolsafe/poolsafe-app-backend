import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard.js';
import { InternalCamerasService } from './internal-cameras.service.js';
import {
  CameraHeartbeatDto,
  CameraHeartbeatResponseDto,
  CameraHeartbeatValidationPipe,
  type CameraHeartbeatPayload,
} from './dto/camera-heartbeat.dto.js';

@ApiTags('Internal Cameras')
@Controller('internal/cameras')
@UseGuards(InternalServiceGuard)
export class InternalCamerasController {
  constructor(
    private readonly internalCamerasService: InternalCamerasService,
  ) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Recebimento interno, atômico e monotônico de heartbeat de câmera (N8N -> API)',
    description:
      'Valida o evento de heartbeat consumido pelo N8N da fila poolsafe.heartbeat, ' +
      'resolve a câmera exclusivamente por cameraCode e avança atomicamente lastCommunicationAt ' +
      'somente quando observedAt for estritamente mais recente que o valor persistido.',
  })
  @ApiHeader({
    name: 'X-Internal-Service-Key',
    description:
      'Chave secreta configurada no ambiente para autenticação de serviço entre N8N e API',
    required: false,
  })
  @ApiBody({ type: CameraHeartbeatDto })
  @ApiResponse({
    status: 200,
    description:
      'Heartbeat processado com sucesso (UPDATED) ou descartado de forma terminal e idempotente (NOT_NEWER, EXPIRED, CAMERA_INACTIVE).',
    type: CameraHeartbeatResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'DTO inválido, expiresAt anterior a observedAt ou observedAt futuro além da tolerância de 5 segundos.',
  })
  @ApiResponse({
    status: 401,
    description: 'Chave de autenticação de serviço ausente ou inválida.',
  })
  @ApiResponse({
    status: 404,
    description: 'Câmera associada ao código de integração não encontrada.',
  })
  async receiveHeartbeat(
    @Body(CameraHeartbeatValidationPipe) dto: CameraHeartbeatPayload,
    @Req() req: Request,
  ): Promise<CameraHeartbeatResponseDto> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.internalCamerasService.processHeartbeat(dto, requestId);
  }
}

