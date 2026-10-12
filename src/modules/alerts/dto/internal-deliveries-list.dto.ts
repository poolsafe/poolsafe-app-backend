import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalDeliveryItemDto {
  @ApiProperty({
    description: 'Identificador único da entrega',
    example: '101',
  })
  id!: string;

  @ApiProperty({
    description: 'Identificador da notificação pai',
    example: '55',
  })
  notificationId!: string;

  @ApiProperty({
    description: 'Identificador do dispositivo de destino',
    example: '12',
  })
  deviceId!: string;

  @ApiProperty({
    description: 'Identificador do usuário destinatário',
    example: '2',
  })
  userId!: string;

  @ApiProperty({
    description: 'Estado atual da entrega',
    example: 'PENDENTE',
    enum: ['PENDENTE', 'ENVIADA', 'FALHA'],
  })
  status!: string;

  @ApiProperty({
    description: 'Número cumulativo de tentativas de envio executadas',
    example: 0,
  })
  attempts!: number;

  @ApiPropertyOptional({
    description: 'Identificador retornado pelo FCM v1 após aceite',
    example: 'projects/poolsafe-1f0db/messages/1234567890',
    nullable: true,
  })
  fcmMessageId?: string | null;

  @ApiPropertyOptional({
    description: 'Código de erro da última tentativa',
    example: null,
    nullable: true,
  })
  errorCode?: string | null;

  @ApiPropertyOptional({
    description: 'Detalhe do erro da última tentativa',
    example: null,
    nullable: true,
  })
  errorDetail?: string | null;

  @ApiPropertyOptional({
    description: 'Instante UTC da última tentativa registrada',
    example: null,
    nullable: true,
  })
  lastAttemptAt?: string | null;

  @ApiPropertyOptional({
    description: 'Instante UTC do envio aceito pelo provedor',
    example: null,
    nullable: true,
  })
  sentAt?: string | null;

  @ApiProperty({
    description: 'Instante UTC de criação da entrega',
    example: '2026-10-12T00:00:00.000Z',
  })
  createdAt!: string;
}

export class InternalDeliveriesListResponseDto {
  @ApiProperty({
    description: 'Identificador do alerta correspondente',
    example: '418',
  })
  alertId!: string;

  @ApiProperty({
    description: 'Total de entregas vinculadas ao alerta',
    example: 1,
  })
  totalDeliveries!: number;

  @ApiProperty({
    description: 'Lista de entregas do alerta',
    type: [InternalDeliveryItemDto],
  })
  deliveries!: InternalDeliveryItemDto[];
}
