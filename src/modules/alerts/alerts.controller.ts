import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
import { AlertsService } from './alerts.service.js';
import { GetAlertsQueryDto } from './dto/get-alerts-query.dto.js';
import type {
  AlertsListResponse,
  AlertDetailResponse,
} from './dto/alerts-response.dto.js';

@ApiTags('Alerts')
@ApiBearerAuth()
@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar alertas históricos do usuário autenticado de forma paginada',
    description:
      'Retorna alertas dos quais o usuário é destinatário histórico, ordenados do mais recente para o mais antigo, com paginação estável por cursor opaco.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de alertas retornada com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Cursor de paginação inválido ou adulterado.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 422,
    description: 'Parâmetros de consulta inválidos.',
  })
  getAlerts(
    @Query() query: GetAlertsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<AlertsListResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.alertsService.getAlerts(user.id, query, requestId);
  }

  @Get(':alertId')
  @ApiOperation({
    summary: 'Obter detalhes de um alerta autorizado',
    description:
      'Retorna os dados do alerta, câmera de origem e metadados de evidência. Retorna 404 indistinguível se não encontrado ou se o usuário não for destinatário.',
  })
  @ApiParam({
    name: 'alertId',
    description: 'Identificador do alerta',
    example: '418',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalhes do alerta retornados com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 404,
    description: 'Alerta inexistente ou não autorizado para o usuário.',
  })
  getAlertDetails(
    @Param('alertId') alertId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<AlertDetailResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.alertsService.getAlertDetails(alertId, user.id, requestId);
  }

  @Get(':alertId/evidence')
  @ApiOperation({
    summary: 'Obter imagem de evidência de alerta autorizado',
    description:
      'Transmite os bytes binários da imagem capturada no momento do alerta para um destinatário autorizado.',
  })
  @ApiParam({
    name: 'alertId',
    description: 'Identificador do alerta',
    example: '418',
  })
  @ApiResponse({
    status: 200,
    description: 'Bytes da imagem de evidência transmitidos com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 404,
    description: 'Alerta não autorizado ou evidência nunca capturada.',
  })
  @ApiResponse({
    status: 410,
    description: 'Evidência expirada ou removida do sistema.',
  })
  async getAlertEvidence(
    @Param('alertId') alertId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, mimeType, alertId: normalizedId } =
      await this.alertsService.getAlertEvidence(alertId, user.id);

    const ext = mimeType === 'image/png' ? 'png' : 'jpg';

    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="alert-${normalizedId}.${ext}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.end(buffer);
  }
}
