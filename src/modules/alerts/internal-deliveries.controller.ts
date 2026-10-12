import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard.js';
import { InternalDeliveriesService } from './internal-deliveries.service.js';
import { RecordDeliveryResultDto } from './dto/record-delivery-result.dto.js';
import { RecordDeliveryResultResponseDto } from './dto/record-delivery-result-response.dto.js';
import { PrepareAttemptResponseDto } from './dto/prepare-attempt-response.dto.js';

@ApiTags('Internal Deliveries')
@Controller('internal/deliveries')
@UseGuards(InternalServiceGuard)
export class InternalDeliveriesController {
  constructor(
    private readonly internalDeliveriesService: InternalDeliveriesService,
  ) {}

  @Post(':id/prepare')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Preparar e registrar tentativa de envio FCM antes da chamada externa (N8N -> API)',
    description:
      'Valida a elegibilidade do dispositivo e destinatário, serializa tentativas simultâneas, ' +
      'incrementa tentativas uma única vez, aplica limites e backoff, e retorna o payload data-only ' +
      'e o token FCM atual elegível para o envio HTTP v1 pelo N8N.',
  })
  @ApiHeader({
    name: 'X-Internal-Service-Key',
    description:
      'Chave secreta configurada no ambiente para autenticação de serviço entre N8N e API',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description:
      'Tentativa preparada com sucesso ou recusa com justificativa clara (ALREADY_SENT, ATTEMPT_IN_PROGRESS, BACKOFF_REQUIRED, MAX_ATTEMPTS_EXCEEDED).',
    type: PrepareAttemptResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Chave de autenticação de serviço ausente ou inválida.',
  })
  @ApiResponse({
    status: 404,
    description: 'Entrega não encontrada.',
  })
  async prepareDelivery(@Param('id') id: string): Promise<PrepareAttemptResponseDto> {
    return this.internalDeliveriesService.prepareAttempt(id);
  }

  @Post(':id/prepare-attempt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Alias para prepareDelivery (:id/prepare)',
  })
  async prepareDeliveryAttempt(
    @Param('id') id: string,
  ): Promise<PrepareAttemptResponseDto> {
    return this.internalDeliveriesService.prepareAttempt(id);
  }

  @Post(':id/record-result')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Registrar resultado da tentativa FCM e atualizar rastreabilidade (N8N -> API)',
    description:
      'Registra aceite com fcm_message_id, falha transitória com retry/backoff, falha definitiva com ' +
      'invalidação segura de token ou suporte a rotação concorrente T1->T2, ou resultado desconhecido. ' +
      'Garante idempotência e consolida o estado da notificação.',
  })
  @ApiHeader({
    name: 'X-Internal-Service-Key',
    description:
      'Chave secreta configurada no ambiente para autenticação de serviço entre N8N e API',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado registrado e notificação consolidada com sucesso.',
    type: RecordDeliveryResultResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Chave de autenticação de serviço ausente ou inválida.',
  })
  @ApiResponse({
    status: 404,
    description: 'Entrega não encontrada.',
  })
  async recordDeliveryResult(
    @Param('id') id: string,
    @Body() dto: RecordDeliveryResultDto,
  ): Promise<RecordDeliveryResultResponseDto> {
    return this.internalDeliveriesService.recordResult(id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consultar estado e contadores de uma entrega (N8N -> API)',
  })
  @ApiHeader({
    name: 'X-Internal-Service-Key',
    description:
      'Chave secreta configurada no ambiente para autenticação de serviço entre N8N e API',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Dados da entrega.',
    type: PrepareAttemptResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Entrega não encontrada.',
  })
  async getDeliveryById(
    @Param('id') id: string,
  ): Promise<PrepareAttemptResponseDto> {
    return this.internalDeliveriesService.getDeliveryById(id);
  }
}
