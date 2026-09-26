import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { EnvConfig } from './config/env.validation.js';
import { PrismaModule } from './database/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';

function validateEnv(config: Record<string, unknown>): EnvConfig {
  const validated = plainToInstance(EnvConfig, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Configuração de ambiente inválida:\n${errors.toString()}`);
  }

  return validated;
}

@Module({
  imports: [
    // Configuração validada por variáveis de ambiente
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // Rate limiting global configurável via THROTTLE_LIMIT e THROTTLE_TTL_SECONDS
    ThrottlerModule.forRoot({
      throttlers: [
        {
          limit: parseInt(process.env['THROTTLE_LIMIT'] ?? '100', 10),
          ttl: parseInt(process.env['THROTTLE_TTL_SECONDS'] ?? '60', 10) * 1000,
        },
      ],
    }),

    // Logger estruturado (Pino)
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),

    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
