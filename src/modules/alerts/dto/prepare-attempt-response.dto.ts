import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FcmAlertPayloadDataDto {
  @ApiProperty({ example: '1' })
  schemaVersion!: string;

  @ApiProperty({ example: 'ALERT' })
  type!: string;

  @ApiProperty({ example: '418' })
  alertId!: string;

  @ApiProperty({ example: '101' })
  deliveryId!: string;

  @ApiProperty({ example: 'CRITICA' })
  severity!: string;

  @ApiProperty({ example: 'Possível situação de risco' })
  title!: string;

  @ApiProperty({ example: 'Abra o PoolSafe para verificar o alerta.' })
  message!: string;

  @ApiProperty({ example: 'poolsafe_alertas_criticos_v2' })
  channelId!: string;

  @ApiPropertyOptional({
    description: 'Timestamp UTC ISO-8601 da detecção original do alerta',
    example: '2026-10-17T20:00:00.000Z',
  })
  detectedAt?: string;
}

export class FcmMessageHttpV1Dto {
  @ApiProperty({
    description: 'FCM Registration Token de destino',
    example: 'dK5...j9Z',
  })
  token!: string;

  @ApiProperty({
    description: 'Dados da mensagem customizados (todos os valores como string)',
    type: FcmAlertPayloadDataDto,
  })
  data!: FcmAlertPayloadDataDto;

  @ApiProperty({
    description: 'Configuração específica do Android (data-only, prioridade HIGH, TTL 300s)',
    example: { priority: 'HIGH', ttl: '300s' },
  })
  android!: {
    priority: string;
    ttl?: string;
  };
}

export class PrepareAttemptResponseDto {
  @ApiProperty({
    description: 'Indica se a entrega está pronta para ser enviada pelo N8N ao FCM',
    example: true,
  })
  ready!: boolean;

  @ApiProperty({
    description: 'Identificador da entrega',
    example: '101',
  })
  deliveryId!: string;

  @ApiPropertyOptional({
    description: 'Motivo explicativo para o estado retornado',
    example: 'READY',
  })
  reason?: string;

  @ApiProperty({
    description: 'Status atual da entrega no banco de dados',
    example: 'PENDENTE',
  })
  status!: string;

  @ApiProperty({
    description: 'Número de tentativas já registradas (incluindo a atual se preparada)',
    example: 1,
  })
  attempts!: number;

  @ApiProperty({
    description: 'Limite cumulativo máximo de tentativas permitido',
    example: 3,
  })
  maxAttempts!: number;

  @ApiPropertyOptional({
    description: 'Número ordinal da tentativa sendo preparada',
    example: 1,
  })
  attemptNumber?: number;

  @ApiPropertyOptional({
    description: 'Identificador da notificação',
    example: '55',
  })
  notificationId?: string;

  @ApiPropertyOptional({
    description: 'Identificador do alerta',
    example: '418',
  })
  alertId?: string;

  @ApiPropertyOptional({
    description: 'Identificador do dispositivo',
    example: '12',
  })
  deviceId?: string;

  @ApiPropertyOptional({
    description: 'Identificador do usuário',
    example: '2',
  })
  userId?: string;

  @ApiPropertyOptional({
    description: 'Token FCM atual elegível para envio (apenas se ready=true)',
    example: 'fcm-token-elegivel-sanitizado',
  })
  targetToken?: string;

  @ApiPropertyOptional({
    description: 'Payload de dados do alerta com todos os valores como string',
    type: FcmAlertPayloadDataDto,
  })
  payload?: FcmAlertPayloadDataDto;

  @ApiPropertyOptional({
    description: 'Estrutura completa pronta para envio HTTP v1 do Firebase Cloud Messaging',
    type: FcmMessageHttpV1Dto,
  })
  fcmMessage?: FcmMessageHttpV1Dto;

  @ApiPropertyOptional({
    description: 'Tempo de espera recomendado em milissegundos antes de tentar novamente',
    example: 5000,
  })
  retryAfterMs?: number;

  @ApiPropertyOptional({
    description: 'Instante UTC a partir do qual uma nova tentativa passa a ser permitida',
    example: '2026-10-12T02:00:10.000Z',
    nullable: true,
  })
  nextAttemptAllowedAt?: string | null;
}

