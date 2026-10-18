import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { EnvConfig } from './config/env.validation.js';
import { PrismaModule } from './database/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { HomeModule } from './modules/home/home.module.js';
import { CamerasModule } from './modules/cameras/cameras.module.js';
import { MonitoringsModule } from './modules/monitorings/monitorings.module.js';
import { AlertsModule } from './modules/alerts/alerts.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { LegalModule } from './modules/legal/legal.module.js';

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
        serializers: {
          req: (req: Record<string, unknown> & { raw: { body?: unknown } }) => {
            req['body'] = req.raw?.body;
            return req;
          },
        },
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-internal-service-key"]',
          'req.headers["x-service-key"]',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.refreshToken',
          'req.body.token',
          'req.body.fcmToken',
          'req.body.evidence.base64',
          'req.body.phone',
          'req.body.telefone',
        ],
      },
    }),

    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    HomeModule,
    CamerasModule,
    MonitoringsModule,
    AlertsModule,
    DevicesModule,
    LegalModule,
  ],
})
export class AppModule {}

