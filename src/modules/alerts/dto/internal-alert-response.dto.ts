import { ApiProperty } from '@nestjs/swagger';

export class InternalAlertSummaryDto {
  @ApiProperty({
    description: 'Quantidade de usuários autorizados registrados como destinatários históricos',
    example: 2,
  })
  recipientsCount!: number;

  @ApiProperty({
    description: 'Quantidade de notificações lógicas criadas ou existentes',
    example: 2,
  })
  notificationsCount!: number;

  @ApiProperty({
    description: 'Quantidade de entregas preparadas para envio com status PENDENTE',
    example: 2,
  })
  deliveriesCount!: number;
}

export class InternalAlertResponseDto {
  @ApiProperty({
    description: 'Chave idempotente do evento de alerta',
    example: '3e38e6be-196a-4da2-a51f-252eaa2a83ad',
  })
  eventKey!: string;

  @ApiProperty({
    description: 'Indica se o evento foi aceito e persistido com sucesso',
    example: true,
  })
  accepted!: boolean;

  @ApiProperty({
    description: 'Indica se a requisição é duplicada (mesma chave de evento já aceita)',
    example: false,
  })
  duplicate!: boolean;

  @ApiProperty({
    description: 'Identificador do alerta persistido ou recuperado no banco de dados',
    example: '418',
  })
  alertId!: string;

  @ApiProperty({
    description: 'Instante UTC de aceite/criação do alerta',
    example: '2026-10-11T18:00:00.000Z',
  })
  acceptedAt!: string;

  @ApiProperty({
    description: 'Resumo dos registros atômicos criados ou recuperados',
    type: InternalAlertSummaryDto,
  })
  summary!: InternalAlertSummaryDto;
}
