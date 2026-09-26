import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';

import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Desabilita o logger padrão do Nest em favor do Pino
    rawBody: false,
  });

  // Logger estruturado (Pino)
  app.useLogger(app.get(Logger));

  // Headers de segurança
  app.use(helmet());

  // X-Request-Id: preserva o header do cliente ou gera um novo
  app.use(
    (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      const existing = req.headers['x-request-id'];
      req.headers['x-request-id'] =
        typeof existing === 'string' && existing.length > 0
          ? existing
          : randomUUID();
      next();
    },
  );

  // Prefixo global e versionamento por URI
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Validação global — rejeita campos desconhecidos com 422
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: 422,
    }),
  );

  // Filtro global de erros (RFC 9457 Problem Details)
  app.useGlobalFilters(new ProblemDetailsFilter());

  // Swagger — somente fora de produção
  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('PoolSafe API')
      .setDescription(
        'API Node.js do PoolSafe — v1. ' +
          'Consulte docs/api-contract.md para o contrato canônico.',
      )
      .setVersion('1')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Desligamento gracioso
  app.enableShutdownHooks();

  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
}

await bootstrap();
