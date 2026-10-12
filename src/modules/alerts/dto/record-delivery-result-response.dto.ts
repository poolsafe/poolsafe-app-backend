import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordDeliveryResultResponseDto {
  @ApiProperty({
    description: 'Identificador único da entrega',
    example: '101',
  })
  deliveryId!: string;

  @ApiProperty({
    description: 'Identificador da notificação pai',
    example: '55',
  })
  notificationId!: string;

  @ApiProperty({
    description: 'Status consolidado da entrega após o registro do resultado',
    example: 'ENVIADA',
    enum: ['ENVIADA', 'PENDENTE', 'FALHA', 'TOKEN_INVALIDO'],
  })
  status!: string;

  @ApiProperty({
    description: 'Total acumulado de tentativas da entrega',
    example: 1,
  })
  attempts!: number;

  @ApiPropertyOptional({
    description: 'Identificador retornado pelo FCM v1 após aceite',
    example: 'projects/poolsafe-1f0db/messages/1234567890',
    nullable: true,
  })
  fcmMessageId?: string | null;

  @ApiPropertyOptional({
    description: 'Código de erro registrado no banco de dados',
    example: null,
    nullable: true,
  })
  errorCode?: string | null;

  @ApiPropertyOptional({
    description: 'Detalhe do erro registrado no banco de dados',
    example: null,
    nullable: true,
  })
  errorDetail?: string | null;

  @ApiProperty({
    description:
      'Status consolidado da notificação agregada a partir de todas as suas entregas',
    example: 'PROCESSADA',
    enum: ['PROCESSADA', 'PARCIAL', 'PENDENTE', 'FALHA', 'SEM_DISPOSITIVO'],
  })
  notificationStatus!: string;

  @ApiProperty({
    description: 'Indica se o token FCM e dispositivo foram invalidados no banco de dados',
    example: false,
  })
  tokenInvalidated!: boolean;

  @ApiProperty({
    description:
      'Indica se uma rotação concorrente de token foi detectada e permite uma tentativa adicional com o novo token',
    example: false,
  })
  canRetryWithNewToken!: boolean;

  @ApiProperty({
    description: 'Indica se uma nova tentativa é permitida (respeitando limite cumulativo)',
    example: false,
  })
  canRetry!: boolean;

  @ApiProperty({
    description: 'Atraso recomendado de backoff em milissegundos para a próxima tentativa',
    example: 0,
  })
  backoffDelayMs!: number;

  @ApiProperty({
    description: 'Indica se a requisição é duplicada de uma entrega já aceita anteriormente',
    example: false,
  })
  duplicate!: boolean;

  @ApiProperty({
    description:
      'Indica se o resultado foi ignorado para evitar que uma resposta atrasada sobrescreva um aceite prévio',
    example: false,
  })
  ignored!: boolean;

  @ApiPropertyOptional({
    description: 'Motivo explicativo para o estado retornado',
    example: 'DELIVERY_ACCEPTED',
  })
  reason?: string;

  @ApiPropertyOptional({
    description: 'Instante UTC a partir do qual uma nova tentativa passa a ser permitida',
    example: '2026-10-12T02:00:10.000Z',
    nullable: true,
  })
  nextAttemptAllowedAt?: string | null;
}

