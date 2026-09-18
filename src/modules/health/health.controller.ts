import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * HealthController — endpoints de liveness e readiness.
 *
 * GET /api/v1/health/live  — liveness: a aplicação está em execução?
 * GET /api/v1/health/ready — readiness: a aplicação está pronta para receber tráfego?
 *
 * No bootstrap, o readiness não verifica o banco de dados.
 * A verificação de conexão com o Prisma será adicionada quando
 * o PrismaHealthIndicator for configurado na fatia de banco de dados.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get('live')
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Retorna 200 enquanto o processo estiver em execução.',
  })
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Retorna 200 quando a aplicação estiver pronta para receber tráfego. ' +
      'A verificação de banco de dados será adicionada em etapa posterior.',
  })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
