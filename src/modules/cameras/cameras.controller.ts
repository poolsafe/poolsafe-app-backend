import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { CamerasService } from './cameras.service.js';
import type {
  CamerasListResponse,
  CameraDetailResponse,
} from './dto/cameras-response.dto.js';

@ApiTags('Cameras')
@ApiBearerAuth()
@Controller('cameras')
@UseGuards(JwtAuthGuard)
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar câmeras com acesso ativo do usuário',
    description:
      'Retorna somente câmeras associadas ao usuário por um acesso ativo, com status de conexão, monitoramento operacional e contagem de alertas.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de câmeras autorizadas retornada com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  getCameras(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<CamerasListResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.camerasService.getCameras(user.id, requestId);
  }

  @Get(':cameraId')
  @ApiOperation({
    summary: 'Obter detalhes da câmera e seus alertas recentes autorizados',
    description:
      'Retorna os dados operacionais da câmera autorizada e até 30 alertas recentes dos quais o usuário foi destinatário.',
  })
  @ApiParam({
    name: 'cameraId',
    description: 'Identificador da câmera',
    example: '8',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalhes da câmera retornados com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 404,
    description: 'Câmera inexistente ou sem acesso ativo para o usuário.',
  })
  getCameraDetails(
    @Param('cameraId') cameraId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<CameraDetailResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.camerasService.getCameraDetails(cameraId, user.id, requestId);
  }
}
