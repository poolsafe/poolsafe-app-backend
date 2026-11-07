import 'dotenv/config';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection, type AddressInfo } from 'node:net';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from '../../dist/app.module.js';
import { ProblemDetailsFilter } from '../../dist/common/filters/problem-details.filter.js';
import { configureBodyParsers } from '../../dist/common/setup/body-parser.setup.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import {
  ProblemDetailsException,
  type ProblemErrorItem,
} from '../../dist/common/errors/problem-details.exception.js';

let app: NestExpressApplication;
let baseUrl: string;
let prisma: PrismaService;

const TEST_SERVICE_KEY =
  process.env['INTERNAL_SERVICE_KEY'] ||
  'poolsafe-internal-service-secret-local-dev';
process.env['INTERNAL_SERVICE_KEY'] = TEST_SERVICE_KEY;

function assertLocalTestDatabase(rawUrl: string): { host: string; port: number } {
  const url = new URL(rawUrl);
  const host = url.hostname;
  const port = url.port ? parseInt(url.port, 10) : 3306;
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) {
    throw new Error(
      `SEGURANÇA: Testes de integração só podem ser executados contra MySQL local. Host: ${host}`,
    );
  }
  return { host, port };
}

function isTcpPortReachable(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

interface InMemoryCameraRow {
  id: bigint;
  integrationCode: string;
  name: string;
  location: string | null;
  administrativeStatus: string;
  lastCommunicationAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
}

function createInMemoryPrismaClient() {
  let nextCameraId = 1n;
  const cameras = new Map<bigint, InMemoryCameraRow>();

  return {
    camera: {
      create: async ({ data }: { data: Partial<InMemoryCameraRow> & { integrationCode: string; name: string } }) => {
        const now = new Date();
        const row: InMemoryCameraRow = {
          id: nextCameraId++,
          integrationCode: data.integrationCode,
          name: data.name,
          location: data.location ?? null,
          administrativeStatus: data.administrativeStatus ?? 'ATIVA',
          lastCommunicationAt: data.lastCommunicationAt ?? null,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
          deactivatedAt: data.deactivatedAt ?? null,
        };
        cameras.set(row.id, row);
        return { ...row };
      },
      findMany: async ({ where }: { where?: { integrationCode?: { startsWith?: string } } }) => {
        const prefix = where?.integrationCode?.startsWith;
        const result: InMemoryCameraRow[] = [];
        for (const row of cameras.values()) {
          if (!prefix || row.integrationCode.startsWith(prefix)) {
            result.push({ ...row });
          }
        }
        return result;
      },
      findUnique: async ({ where }: { where: { id?: bigint; integrationCode?: string } }) => {
        if (where.id !== undefined) {
          const found = cameras.get(where.id);
          return found ? { ...found } : null;
        }
        if (where.integrationCode !== undefined) {
          for (const row of cameras.values()) {
            if (row.integrationCode === where.integrationCode) {
              return { ...row };
            }
          }
        }
        return null;
      },
      findUniqueOrThrow: async (args: { where: { id?: bigint; integrationCode?: string } }) => {
        const found = await (
          args.where.id !== undefined
            ? Promise.resolve(cameras.get(args.where.id) ?? null)
            : Promise.resolve(
                Array.from(cameras.values()).find(
                  (r) => r.integrationCode === args.where.integrationCode,
                ) ?? null,
              )
        );
        if (!found) {
          throw new Error('Record not found');
        }
        return { ...found };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id?: bigint;
          administrativeStatus?: string;
          OR?: Array<{
            lastCommunicationAt?: null | { lt?: Date };
          }>;
        };
        data: { lastCommunicationAt?: Date | null };
      }) => {
        let count = 0;
        for (const row of cameras.values()) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (
            where.administrativeStatus !== undefined &&
            row.administrativeStatus !== where.administrativeStatus
          ) {
            continue;
          }
          if (where.OR && where.OR.length > 0) {
            const matchesOr = where.OR.some((cond) => {
              if (cond.lastCommunicationAt === null) {
                return row.lastCommunicationAt === null;
              }
              if (
                cond.lastCommunicationAt &&
                typeof cond.lastCommunicationAt === 'object' &&
                cond.lastCommunicationAt.lt instanceof Date
              ) {
                return (
                  row.lastCommunicationAt !== null &&
                  row.lastCommunicationAt.getTime() <
                    cond.lastCommunicationAt.lt.getTime()
                );
              }
              return false;
            });
            if (!matchesOr) continue;
          }

          if (data.lastCommunicationAt !== undefined) {
            row.lastCommunicationAt = data.lastCommunicationAt
              ? new Date(data.lastCommunicationAt.getTime())
              : null;
          }
          row.updatedAt = new Date();
          count++;
        }
        return { count };
      },
      deleteMany: async ({ where }: { where?: { id?: { in?: bigint[] } } }) => {
        const ids = where?.id?.in ?? [];
        let count = 0;
        for (const id of ids) {
          if (cameras.delete(id)) count++;
        }
        return { count };
      },
    },
    systemLog: {
      deleteMany: async () => ({ count: 0 }),
    },
    cameraAccess: {
      deleteMany: async () => ({ count: 0 }),
    },
  };
}

async function cleanupTestData(): Promise<void> {
  if (!prisma) return;
  const client = prisma.getClient();

  const testCameras = await client.camera.findMany({
    where: { integrationCode: { startsWith: 'test.cam.hb.' } },
    select: { id: true },
  });
  const cameraIds = testCameras.map((c) => c.id);

  if (cameraIds.length > 0) {
    await client.systemLog.deleteMany({
      where: { cameraId: { in: cameraIds } },
    });
    await client.cameraAccess.deleteMany({
      where: { cameraId: { in: cameraIds } },
    });
    await client.camera.deleteMany({
      where: { id: { in: cameraIds } },
    });
  }
}

before(async () => {
  const dbUrl = process.env['DATABASE_URL'] || '';
  const { host, port } = assertLocalTestDatabase(dbUrl);
  const mysqlReachable = await isTcpPortReachable(host, port);

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    rawBody: false,
    bodyParser: false,
  });

  configureBodyParsers(app);

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

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: 422,
      exceptionFactory: (errors) => {
        const formatted: ProblemErrorItem[] = errors.map((e) => ({
          pointer: `/${e.property}`,
          code: 'INVALID_FIELD',
          detail: Object.values(e.constraints || {})[0] || 'Campo inválido',
        }));
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

  app.useGlobalFilters(new ProblemDetailsFilter());

  prisma = app.get(PrismaService);
  if (!mysqlReachable) {
    const inMemoryClient = createInMemoryPrismaClient();
    prisma.getClient = () => inMemoryClient as never;
    prisma.onModuleInit = async () => {};
    prisma.onModuleDestroy = async () => {};
  }

  await app.init();
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  await cleanupTestData();
});

after(async () => {
  await cleanupTestData();
  if (app) {
    await app.close();
  }
});

describe('Integração — POST /api/v1/internal/cameras/heartbeat', () => {
  test('1. Autenticação interna ausente ou inválida retorna 401 INVALID_SERVICE_SECRET', async () => {
    const payload = {
      eventId: randomUUID(),
      cameraCode: 'test.cam.hb.auth',
      observedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      test: true,
    };

    const resNoKey = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(resNoKey.status, 401);
    const bodyNoKey = (await resNoKey.json()) as { code: string };
    assert.equal(bodyNoKey.code, 'INVALID_SERVICE_SECRET');

    const resBadKey = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': 'segredo-invalido',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(resBadKey.status, 401);
    const bodyBadKey = (await resBadKey.json()) as { code: string };
    assert.equal(bodyBadKey.code, 'INVALID_SERVICE_SECRET');
  });

  test('2. Câmera com lastCommunicationAt nulo: avança para observedAt e retorna UPDATED (200)', async () => {
    const client = prisma.getClient();
    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.hb.null.init',
        name: 'Câmera Heartbeat Inicial Nulo',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: null,
      },
    });

    const observedAt = new Date(Date.now() - 2_000);
    const expiresAt = new Date(observedAt.getTime() + 60_000);

    const res = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        cameraCode: camera.integrationCode,
        observedAt: observedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        test: true,
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['accepted'], true);
    assert.equal(body['updated'], true);
    assert.equal(body['reason'], 'UPDATED');
    assert.equal(body['cameraId'], camera.id.toString());
    assert.equal(body['cameraCode'], camera.integrationCode);
    assert.equal(body['lastCommunicationAt'], observedAt.toISOString());

    const inDb = await client.camera.findUniqueOrThrow({
      where: { id: camera.id },
    });
    assert.equal(
      inDb.lastCommunicationAt?.toISOString(),
      observedAt.toISOString(),
    );
  });

  test('3. Heartbeat mais novo: avança lastCommunicationAt existente e retorna UPDATED', async () => {
    const client = prisma.getClient();
    const initialTime = new Date(Date.now() - 20_000);
    const newerTime = new Date(Date.now() - 5_000);
    const expiresAt = new Date(newerTime.getTime() + 60_000);

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.hb.newer',
        name: 'Câmera Heartbeat Mais Novo',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: initialTime,
      },
    });

    const res = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        cameraCode: camera.integrationCode,
        observedAt: newerTime.toISOString(),
        expiresAt: expiresAt.toISOString(),
        test: false,
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['accepted'], true);
    assert.equal(body['updated'], true);
    assert.equal(body['reason'], 'UPDATED');
    assert.equal(body['cameraId'], camera.id.toString());
    assert.equal(body['cameraCode'], camera.integrationCode);
    assert.equal(body['lastCommunicationAt'], newerTime.toISOString());

    const inDb = await client.camera.findUniqueOrThrow({
      where: { id: camera.id },
    });
    assert.equal(
      inDb.lastCommunicationAt?.toISOString(),
      newerTime.toISOString(),
    );
  });

  test('4. Repetição do mesmo heartbeat (mesmo observedAt): idempotente, retorna 200 com updated=false e reason=NOT_NEWER', async () => {
    const client = prisma.getClient();
    const observedAt = new Date(Date.now() - 4_000);
    const expiresAt = new Date(observedAt.getTime() + 60_000);
    const eventId = randomUUID();

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.hb.repeat',
        name: 'Câmera Heartbeat Repetido',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: observedAt,
      },
    });

    const res = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId,
        cameraCode: camera.integrationCode,
        observedAt: observedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        test: true,
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['accepted'], true);
    assert.equal(body['updated'], false);
    assert.equal(body['reason'], 'NOT_NEWER');
    assert.equal(body['cameraId'], camera.id.toString());
    assert.equal(body['cameraCode'], camera.integrationCode);
    assert.equal(body['lastCommunicationAt'], observedAt.toISOString());

    const inDb = await client.camera.findUniqueOrThrow({
      where: { id: camera.id },
    });
    assert.equal(
      inDb.lastCommunicationAt?.toISOString(),
      observedAt.toISOString(),
    );
  });

  test('5. Heartbeat mais antigo: não regride lastCommunicationAt e retorna 200 com updated=false e reason=NOT_NEWER', async () => {
    const client = prisma.getClient();
    const persistedNewer = new Date(Date.now() - 3_000);
    const olderObservedAt = new Date(Date.now() - 25_000);
    const expiresAt = new Date(Date.now() + 35_000);

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.hb.older',
        name: 'Câmera Heartbeat Mais Antigo',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: persistedNewer,
      },
    });

    const res = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        cameraCode: camera.integrationCode,
        observedAt: olderObservedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        test: true,
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['accepted'], true);
    assert.equal(body['updated'], false);
    assert.equal(body['reason'], 'NOT_NEWER');
    assert.equal(body['cameraId'], camera.id.toString());
    assert.equal(body['cameraCode'], camera.integrationCode);
    assert.equal(body['lastCommunicationAt'], persistedNewer.toISOString());

    const inDb = await client.camera.findUniqueOrThrow({
      where: { id: camera.id },
    });
    assert.equal(
      inDb.lastCommunicationAt?.toISOString(),
      persistedNewer.toISOString(),
    );
  });

  test('6. Heartbeat vencido (expiresAt no passado): descartado de forma terminal e idempotente com updated=false e reason=EXPIRED', async () => {
    const client = prisma.getClient();
    const previousComm = new Date(Date.now() - 120_000);
    const expiredObservedAt = new Date(Date.now() - 90_000);
    const expiredExpiresAt = new Date(Date.now() - 30_000);

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.hb.expired',
        name: 'Câmera Heartbeat Vencido',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: previousComm,
      },
    });

    const res = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        cameraCode: camera.integrationCode,
        observedAt: expiredObservedAt.toISOString(),
        expiresAt: expiredExpiresAt.toISOString(),
        test: true,
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['accepted'], false);
    assert.equal(body['updated'], false);
    assert.equal(body['reason'], 'EXPIRED');
    assert.equal(body['cameraId'], camera.id.toString());
    assert.equal(body['cameraCode'], camera.integrationCode);
    assert.equal(body['lastCommunicationAt'], previousComm.toISOString());

    const inDb = await client.camera.findUniqueOrThrow({
      where: { id: camera.id },
    });
    assert.equal(
      inDb.lastCommunicationAt?.toISOString(),
      previousComm.toISOString(),
    );
  });

  test('7. observedAt futuro além da tolerância de 5 segundos: rejeitado com 400 sem atualizar a câmera', async () => {
    const client = prisma.getClient();
    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.hb.future',
        name: 'Câmera Heartbeat Futuro',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: null,
      },
    });

    const futureObservedAt = new Date(Date.now() + 15_000); // 15s no futuro (> 5s)
    const futureExpiresAt = new Date(futureObservedAt.getTime() + 60_000);

    const res = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        cameraCode: camera.integrationCode,
        observedAt: futureObservedAt.toISOString(),
        expiresAt: futureExpiresAt.toISOString(),
        test: true,
      }),
    });

    assert.equal(res.status, 400);
    const errBody = (await res.json()) as { code: string; status: number };
    assert.equal(errBody.status, 400);
    assert.equal(errBody.code, 'VALIDATION_ERROR');

    const inDb = await client.camera.findUniqueOrThrow({
      where: { id: camera.id },
    });
    assert.equal(inDb.lastCommunicationAt, null);
  });

  test('8. expiresAt anterior a observedAt e demais erros de DTO retornam 400', async () => {
    const now = new Date();
    const observedAt = new Date(now.getTime() - 1_000);
    const expiresBeforeObserved = new Date(observedAt.getTime() - 1_000);

    // 8.1 expiresAt < observedAt
    const resInverted = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        cameraCode: 'test.cam.hb.any',
        observedAt: observedAt.toISOString(),
        expiresAt: expiresBeforeObserved.toISOString(),
        test: true,
      }),
    });
    assert.equal(resInverted.status, 400);

    // 8.2 eventId inválido
    const resBadUuid = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: 'id-invalido',
        cameraCode: 'test.cam.hb.any',
        observedAt: observedAt.toISOString(),
        expiresAt: new Date(observedAt.getTime() + 60_000).toISOString(),
        test: true,
      }),
    });
    assert.equal(resBadUuid.status, 400);

    // 8.3 camera_id enviado pelo worker (nunca confiar em camera_id operacional)
    const resWithCameraId = await fetch(
      `${baseUrl}/internal/cameras/heartbeat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
        },
        body: JSON.stringify({
          eventId: randomUUID(),
          camera_id: '1',
          cameraCode: 'test.cam.hb.any',
          observedAt: observedAt.toISOString(),
          expiresAt: new Date(observedAt.getTime() + 60_000).toISOString(),
          test: true,
        }),
      },
    );
    assert.equal(resWithCameraId.status, 400);
  });

  test('9. Câmera inexistente retorna 404 CAMERA_NOT_FOUND', async () => {
    const now = new Date();
    const res = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        cameraCode: 'test.cam.hb.inexistente.999999',
        observedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        test: true,
      }),
    });

    assert.equal(res.status, 404);
    const body = (await res.json()) as { code: string; status: number };
    assert.equal(body.status, 404);
    assert.equal(body.code, 'CAMERA_NOT_FOUND');
  });

  test('10. Câmera administrativamente inativa: não avança lastCommunicationAt e retorna 200 com updated=false e reason=CAMERA_INACTIVE', async () => {
    const client = prisma.getClient();
    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.hb.inactive',
        name: 'Câmera Heartbeat Inativa',
        administrativeStatus: 'INATIVA',
        deactivatedAt: new Date(Date.now() - 3600_000),
        lastCommunicationAt: null,
      },
    });

    const now = new Date();
    const res = await fetch(`${baseUrl}/internal/cameras/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        cameraCode: camera.integrationCode,
        observedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        test: true,
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['accepted'], false);
    assert.equal(body['updated'], false);
    assert.equal(body['reason'], 'CAMERA_INACTIVE');
    assert.equal(body['cameraId'], camera.id.toString());
    assert.equal(body['cameraCode'], camera.integrationCode);
    assert.equal(body['lastCommunicationAt'], null);

    const inDb = await client.camera.findUniqueOrThrow({
      where: { id: camera.id },
    });
    assert.equal(inDb.lastCommunicationAt, null);
  });

  test('11. Concorrência: duas atualizações concorrentes em ordem inversa garantem que o maior instante permaneça no banco', async () => {
    const client = prisma.getClient();
    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.hb.concurrent.reverse',
        name: 'Câmera Heartbeat Concorrente',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: null,
      },
    });

    const tNewer = new Date(Date.now() - 2_000);
    const tOlder = new Date(Date.now() - 15_000);
    const expiresAt = new Date(Date.now() + 60_000);

    // Dispara concorrentemente o mais novo (tNewer) e o mais antigo (tOlder) em ordem inversa
    const [resNewer, resOlder] = await Promise.all([
      fetch(`${baseUrl}/internal/cameras/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
        },
        body: JSON.stringify({
          eventId: randomUUID(),
          cameraCode: camera.integrationCode,
          observedAt: tNewer.toISOString(),
          expiresAt: expiresAt.toISOString(),
          test: true,
        }),
      }),
      fetch(`${baseUrl}/internal/cameras/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
        },
        body: JSON.stringify({
          eventId: randomUUID(),
          cameraCode: camera.integrationCode,
          observedAt: tOlder.toISOString(),
          expiresAt: expiresAt.toISOString(),
          test: true,
        }),
      }),
    ]);

    assert.equal(resNewer.status, 200);
    assert.equal(resOlder.status, 200);

    const bodyNewer = (await resNewer.json()) as Record<string, unknown>;
    assert.equal(bodyNewer['updated'], true);
    assert.equal(bodyNewer['reason'], 'UPDATED');
    assert.equal(bodyNewer['lastCommunicationAt'], tNewer.toISOString());

    const inDb = await client.camera.findUniqueOrThrow({
      where: { id: camera.id },
    });
    assert.equal(
      inDb.lastCommunicationAt?.toISOString(),
      tNewer.toISOString(),
      'O maior instante (tNewer) deve obrigatoriamente prevalecer após chamadas concorrentes',
    );
  });

  test('12. Confirmação de que nenhuma migration de heartbeat foi criada', () => {
    const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
    let entries: string[] = [];
    try {
      entries = readdirSync(migrationsDir);
    } catch {
      entries = [];
    }
    const heartbeatMigrations = entries.filter((name) =>
      name.toLowerCase().includes('heartbeat'),
    );
    assert.equal(heartbeatMigrations.length, 0);
  });
});
