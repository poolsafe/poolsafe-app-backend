import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
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
import { MonitoringsService } from './monitorings.service.js';
import { CreateMonitoringDto } from './dto/create-monitoring.dto.js';
import { PauseMonitoringDto } from './dto/pause-monitoring.dto.js';
import { EndMonitoringDto } from './dto/end-monitoring.dto.js';
import type {
  MonitoringResponse,
  CurrentMonitoringsResponse,
} from './dto/monitoring-response.dto.js';

@ApiTags('Monitorings')
@ApiBearerAuth()
@Controller('monitorings')
@UseGuards(JwtAuthGuard)
export class MonitoringsController {
  constructor(private readonly monitoringsService: MonitoringsService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Listar sessões de monitoramento atuais',
    description:
      'Retorna todas as sessões ATIVAS ou PAUSADAS nas quais o usuário autenticado possui acesso ativo a todas as câmeras.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de sessões atuais retornada com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  getCurrentMonitorings(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<CurrentMonitoringsResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.monitoringsService.getCurrentMonitorings(user.id, requestId);
  }

  @Get(':monitoringId')
  @ApiOperation({
    summary: 'Obter detalhes de uma sessão autorizada',
    description:
      'Retorna os dados da sessão quando o usuário possui acesso ativo a todas as suas câmeras; caso contrário, retorna 404 RESOURCE_NOT_FOUND.',
  })
  @ApiParam({
    name: 'monitoringId',
    description: 'Identificador decimal da sessão',
    example: '51',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalhes da sessão retornados com sucesso.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 404,
    description: 'Sessão inexistente ou sem autorização ativa em todas as câmeras.',
  })
  getMonitoringById(
    @Param('monitoringId') monitoringId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MonitoringResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.monitoringsService.getMonitoringById(monitoringId, user.id, requestId);
  }

  @Post()
  @ApiOperation({
    summary: 'Iniciar nova sessão de monitoramento',
    description:
      'Inicia uma sessão para o conjunto de câmeras informado. Retorna 201 Created para nova sessão e 200 OK quando já existir sessão ativa com a mesma composição exata.',
  })
  @ApiResponse({
    status: 201,
    description: 'Nova sessão iniciada com sucesso.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sessão ativa com exatamente a mesma composição já existente retornada idempotentemente.',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 403,
    description: 'Usuário não possui autorização ativa para todas as câmeras.',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflito de sessão ou câmeras já pertencentes a outra sessão não encerrada.',
  })
  @ApiResponse({
    status: 422,
    description: 'Câmera inativa, offline, desconhecida ou dados inválidos.',
  })
  async startMonitoring(
    @Body() dto: CreateMonitoringDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MonitoringResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const { response, isCreated } = await this.monitoringsService.startMonitoring(
      dto,
      user.id,
      requestId,
    );
    res.status(isCreated ? HttpStatus.CREATED : HttpStatus.OK);
    return response;
  }

  @Post(':monitoringId/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pausar sessão de monitoramento',
    description:
      'Pausa a sessão após validação da senha atual. A senha é verificada e nunca é registrada em logs.',
  })
  @ApiParam({
    name: 'monitoringId',
    description: 'Identificador decimal da sessão',
    example: '51',
  })
  @ApiResponse({
    status: 200,
    description: 'Sessão pausada com sucesso ou já pausada (idempotência).',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 403,
    description: 'Falha na reautenticação por senha.',
  })
  @ApiResponse({
    status: 404,
    description: 'Sessão inexistente ou sem autorização ativa em todas as câmeras.',
  })
  @ApiResponse({
    status: 409,
    description: 'Sessão já se encontra encerrada.',
  })
  pauseMonitoring(
    @Param('monitoringId') monitoringId: string,
    @Body() dto: PauseMonitoringDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MonitoringResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.monitoringsService.pauseMonitoring(monitoringId, dto, user.id, requestId);
  }

  @Post(':monitoringId/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retomar sessão de monitoramento pausada',
    description:
      'Retoma a sessão pausada. Todas as câmeras da sessão precisam estar ativas e online.',
  })
  @ApiParam({
    name: 'monitoringId',
    description: 'Identificador decimal da sessão',
    example: '51',
  })
  @ApiResponse({
    status: 200,
    description: 'Sessão retomada com sucesso ou já ativa (idempotência).',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 404,
    description: 'Sessão inexistente ou sem autorização ativa em todas as câmeras.',
  })
  @ApiResponse({
    status: 409,
    description: 'Sessão já se encontra encerrada.',
  })
  @ApiResponse({
    status: 422,
    description: 'Uma ou mais câmeras da sessão estão offline, inativas ou indisponíveis.',
  })
  resumeMonitoring(
    @Param('monitoringId') monitoringId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MonitoringResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.monitoringsService.resumeMonitoring(monitoringId, user.id, requestId);
  }

  @Post(':monitoringId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Encerrar sessão de monitoramento',
    description:
      'Encerra a sessão de monitoramento definitivamente com reautenticação obrigatória por senha. Libera todas as suas câmeras.',
  })
  @ApiParam({
    name: 'monitoringId',
    description: 'Identificador decimal da sessão',
    example: '51',
  })
  @ApiResponse({
    status: 200,
    description: 'Sessão encerrada com sucesso ou já encerrada (idempotência).',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou sessão revogada/expirada.',
  })
  @ApiResponse({
    status: 403,
    description: 'Reautenticação obrigatória falhou (senha incorreta).',
  })
  @ApiResponse({
    status: 404,
    description: 'Sessão inexistente ou sem autorização ativa em todas as câmeras.',
  })
  endMonitoring(
    @Param('monitoringId') monitoringId: string,
    @Body() dto: EndMonitoringDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MonitoringResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.monitoringsService.endMonitoring(monitoringId, dto, user.id, requestId);
  }
}
