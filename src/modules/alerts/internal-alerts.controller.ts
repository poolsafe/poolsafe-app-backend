import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard.js';
import { InternalAlertsService } from './internal-alerts.service.js';
import { InternalDeliveriesService } from './internal-deliveries.service.js';
import { CreateInternalAlertDto } from './dto/create-internal-alert.dto.js';
import { InternalAlertResponseDto } from './dto/internal-alert-response.dto.js';
import { InternalDeliveriesListResponseDto } from './dto/internal-deliveries-list.dto.js';
import {
  PurgeEvidenceQueryDto,
  PurgeEvidenceResponseDto,
} from './dto/purge-evidence.dto.js';

@ApiTags('Internal Alerts')
@Controller('internal/alerts')
@UseGuards(InternalServiceGuard)
export class InternalAlertsController {
  constructor(
    private readonly internalAlertsService: InternalAlertsService,
    private readonly internalDeliveriesService: InternalDeliveriesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Ingestão atômica e idempotente de eventos de alerta de risco (N8N -> API)',
    description:
      'Recebe um evento de detecção de risco, resolve a câmera e a sessão de monitoramento ativa correspondente, ' +
      'persiste o alerta e sua evidência opcional, congela os destinatários históricos e prepara as entregas pendentes ' +
      'para envio via push notification em uma única transação de banco de dados.',
  })
  @ApiHeader({
    name: 'X-Internal-Service-Key',
    description:
      'Chave secreta configurada no ambiente para autenticação de serviço entre N8N e API',
    required: false,
  })
  @ApiResponse({
    status: 202,
    description:
      'Evento aceito com sucesso ou recuperado de forma idempotente se já existente.',
    type: InternalAlertResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Chave de autenticação de serviço ausente ou inválida.',
  })
  @ApiResponse({
    status: 404,
    description: 'Câmera associada ao código de integração não encontrada.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Monitoramento ativo não encontrado para a câmera ou ambiguidade com múltiplas sessões.',
  })
  @ApiResponse({
    status: 413,
    description: 'Evidência excede o tamanho máximo de 5 MiB.',
  })
  @ApiResponse({
    status: 415,
    description: 'Tipo MIME de evidência não suportado (exige image/jpeg ou image/png).',
  })
  @ApiResponse({
    status: 422,
    description:
      'Dados inválidos no evento de risco ou câmera inativa administrativamente.',
  })
  async receiveAlertEvent(
    @Body() dto: CreateInternalAlertDto,
    @Req() req: Request,
  ): Promise<InternalAlertResponseDto> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.internalAlertsService.processAlertEvent(dto, requestId);
  }

  @Post('purge-evidence')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Expurgo periódico de evidências vencidas (N8N / Manutenção -> API)',
    description:
      'Processa em lote ordenado as evidências cujo expira_em já foi alcançado, limpando atomicamente ' +
      'o conteúdo binário (LONGBLOB) e preenchendo removida_em sem carregar blobs na memória.',
  })
  @ApiHeader({
    name: 'X-Internal-Service-Key',
    description:
      'Chave secreta configurada no ambiente para autenticação de serviço entre N8N e API',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Lote de expurgo executado com sucesso.',
    type: PurgeEvidenceResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Chave de autenticação de serviço ausente ou inválida.',
  })
  async purgeExpiredEvidences(
    @Query() query: PurgeEvidenceQueryDto,
    @Req() req: Request,
  ): Promise<PurgeEvidenceResponseDto> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.internalAlertsService.purgeExpiredEvidences(
      query.limit,
      requestId,
    );
  }

  @Get(':alertId/deliveries')
  @ApiOperation({
    summary: 'Obter as entregas associadas a um alerta aceito (N8N -> API)',
    description:
      'Retorna todas as entregas do alerta, permitindo filtrar por status (ex: PENDENTE) ' +
      'para orquestração do envio FCM pelo N8N.',
  })
  @ApiHeader({
    name: 'X-Internal-Service-Key',
    description:
      'Chave secreta configurada no ambiente para autenticação de serviço entre N8N e API',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de entregas do alerta retornada com sucesso.',
    type: InternalDeliveriesListResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Chave de autenticação de serviço ausente ou inválida.',
  })
  @ApiResponse({
    status: 404,
    description: 'Alerta não encontrado.',
  })
  async getAlertDeliveries(
    @Param('alertId') alertId: string,
    @Query('status') status?: string,
  ): Promise<InternalDeliveriesListResponseDto> {
    return this.internalDeliveriesService.getDeliveriesByAlertId(
      alertId,
      status,
    );
  }
}

