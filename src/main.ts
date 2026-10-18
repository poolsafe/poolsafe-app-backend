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
import { configureBodyParsers } from './common/setup/body-parser.setup.js';
import {
  ProblemDetailsException,
  ProblemErrorItem,
} from './common/errors/problem-details.exception.js';

function formatValidationErrors(
  errors: import('class-validator').ValidationError[],
  parent = '',
): ProblemErrorItem[] {
  const result: ProblemErrorItem[] = [];
  for (const err of errors) {
    const pointer = `${parent}/${err.property}`;
    if (err.constraints) {
      for (const [key, msg] of Object.entries(err.constraints)) {
        let code = 'INVALID_FIELD';
        if (key === 'isEmail') code = 'INVALID_EMAIL';
        else if (key === 'isNotEmpty') code = 'REQUIRED_FIELD';
        else if (key === 'minLength') code = 'FIELD_TOO_SHORT';
        else if (key === 'maxLength') code = 'FIELD_TOO_LONG';
        else if (key === 'whitelistValidation') code = 'UNKNOWN_FIELD';
        result.push({
          pointer,
          code,
          detail: msg,
        });
      }
    }
    if (err.children && err.children.length > 0) {
      result.push(...formatValidationErrors(err.children, pointer));
    }
  }
  return result;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Desabilita o logger padrão do Nest em favor do Pino
    rawBody: false,
    // Desabilita o parser padrão (100kb fixo) para aplicar limites seletivos por rota
    bodyParser: false,
  });

  // Configuração de parsers JSON com limite estendido para rotas internas (10 MiB)
  configureBodyParsers(app);

  // Logger estruturado (Pino)
  app.useLogger(app.get(Logger));

  // Headers de segurança
  app.use(helmet());

  // X-Request-Id: preserva o header do cliente ou gera um novo
  app.use(
    (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      const existing = req.headers['x-request-id'];
      const requestId =
        typeof existing === 'string' && existing.length > 0
          ? existing
          : randomUUID();
      req.headers['x-request-id'] = requestId;
      res.setHeader('X-Request-Id', requestId);
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
      exceptionFactory: (errors) => {
        const formatted = formatValidationErrors(errors);
        return new ProblemDetailsException({
          status: 422,
          code: 'VALIDATION_ERROR',
          title: 'Dados inválidos',
          detail: 'Um ou mais campos precisam ser corrigidos.',
          errors: formatted,
        });
      },
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
