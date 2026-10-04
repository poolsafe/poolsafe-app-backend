import 'dotenv/config';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { AppModule } from '../../dist/app.module.js';
import { ProblemDetailsFilter } from '../../dist/common/filters/problem-details.filter.js';
import { ProblemDetailsException } from '../../dist/common/errors/problem-details.exception.js';
import { PrismaService } from '../../dist/database/prisma.service.js';

let app: NestExpressApplication;
let baseUrl: string;
let prisma: PrismaService;

function assertLocalTestDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const host = url.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) {
    throw new Error(
      `SEGURANÇA: Testes de integração só podem ser executados contra MySQL local (127.0.0.1/localhost). Host atual: ${host}`,
    );
  }
}

async function cleanupTestData(): Promise<void> {
  if (!prisma) return;
  const client = prisma.getClient();

  const testUsers = await client.user.findMany({
    where: { email: { startsWith: 'test.home.' } },
    select: { id: true },
  });
  const userIds = testUsers.map((u) => u.id);

  const testCameras = await client.camera.findMany({
    where: { integrationCode: { startsWith: 'test.home.' } },
    select: { id: true },
  });
  const cameraIds = testCameras.map((c) => c.id);

  if (userIds.length > 0 || cameraIds.length > 0) {
    await client.alertRecipient.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { alert: { cameraId: { in: cameraIds } } },
        ],
      },
    });

    await client.alert.deleteMany({
      where: {
        OR: [
          { cameraId: { in: cameraIds } },
          { eventKey: { startsWith: 'test.home.' } },
        ],
      },
    });

    await client.monitoringCamera.deleteMany({
      where: {
        OR: [
          { cameraId: { in: cameraIds } },
          { monitoring: { startedByUserId: { in: userIds } } },
        ],
      },
    });

    await client.monitoringEvent.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { monitoring: { startedByUserId: { in: userIds } } },
        ],
      },
    });

    await client.monitoring.deleteMany({
      where: { startedByUserId: { in: userIds } },
    });

    await client.cameraAccess.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { cameraId: { in: cameraIds } },
        ],
      },
    });

    if (cameraIds.length > 0) {
      await client.camera.deleteMany({
        where: { id: { in: cameraIds } },
      });
    }

    if (userIds.length > 0) {
      await client.authSession.deleteMany({
        where: { userId: { in: userIds } },
      });
      await client.device.deleteMany({
        where: { userId: { in: userIds } },
      });
      await client.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  }
}

before(async () => {
  const dbUrl = process.env['DATABASE_URL'] || '';
  assertLocalTestDatabase(dbUrl);

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    rawBody: false,
  });

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
    }),
  );

  app.useGlobalFilters(new ProblemDetailsFilter());

  await app.init();
  await app.listen(0, '127.0.0.1');

  const addr = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

  prisma = app.get(PrismaService);

  await cleanupTestData();
});

after(async () => {
  await cleanupTestData();
  if (app) {
    await app.close();
  }
});

describe('Fatia 4 — Home (GET /api/v1/home)', () => {
  async function createTestUser(emailSuffix: string) {
    const email = `test.home.${emailSuffix}@example.com`;
    const password = 'PasswordHome123!';
    const name = `Usuário ${emailSuffix}`;

    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    assert.equal(regRes.status, 201, 'Cadastro deve retornar 201');
    const regJson = (await regRes.json()) as any;
    return {
      email,
      password,
      user: regJson.data.user,
      tokens: regJson.data.tokens,
    };
  }

  test('1. Requisição sem autenticação ou com token inválido retorna 401 Problem Details', async () => {
    // Sem cabeçalho Authorization
    const resNoAuth = await fetch(`${baseUrl}/home`);
    assert.equal(resNoAuth.status, 401, 'Deve retornar 401');
    const bodyNoAuth = (await resNoAuth.json()) as any;
    assert.equal(bodyNoAuth.code, 'AUTHENTICATION_REQUIRED');

    // Com token inválido
    const resInvalid = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: 'Bearer token-invalido-123' },
    });
    assert.equal(resInvalid.status, 401, 'Token inválido deve retornar 401');
    const bodyInvalid = (await resInvalid.json()) as any;
    assert.equal(bodyInvalid.code, 'AUTHENTICATION_REQUIRED');
  });

  test('2. Usuário sem câmera ou monitoramento retorna estado INDISPONIVEL, SEM_SESSAO, NO_CURRENT_MONITORING e cameras zeradas', async () => {
    const { tokens } = await createTestUser('nocam');

    const res = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    assert.equal(res.status, 200, 'Deve retornar 200 OK');
    const json = (await res.json()) as any;

    assert.ok(json.data.generatedAt, 'Deve conter generatedAt');
    assert.equal(json.data.overallMonitoring.status, 'INDISPONIVEL');
    assert.equal(json.data.overallMonitoring.reason, 'SEM_SESSAO');
    assert.equal(json.data.overallMonitoring.currentSessions, 0);
    assert.equal(json.data.overallMonitoring.activeSessions, 0);
    assert.equal(json.data.overallMonitoring.pausedSessions, 0);
    assert.equal(json.data.overallMonitoring.degradedSessions, 0);
    assert.equal(json.data.overallMonitoring.unavailableSessions, 0);

    assert.equal(json.data.cameras.total, 0);
    assert.equal(json.data.cameras.online, 0);
    assert.equal(json.data.cameras.offline, 0);
    assert.equal(json.data.cameras.unknown, 0);
    assert.equal(json.data.cameras.inactive, 0);

    assert.equal(json.data.latestAlert, null);

    assert.ok(Array.isArray(json.data.warnings));
    assert.equal(json.data.warnings.length, 1);
    assert.equal(json.data.warnings[0].code, 'NO_CURRENT_MONITORING');
    assert.equal(json.data.warnings[0].severity, 'ATENCAO');
  });

  test('3. Monitoramento ativo com câmera online retorna estado ATIVO, OPERACIONAL e sem warnings de parada', async () => {
    const client = prisma.getClient();
    const { user, tokens } = await createTestUser('active');

    // Cria câmera online (< 90s)
    const camera = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.act.${randomUUID()}`,
        name: 'Piscina Principal Teste',
        location: 'Área Externa',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(),
      },
    });

    // Concede acesso ativo à câmera para o usuário
    await client.cameraAccess.create({
      data: {
        userId: BigInt(user.id),
        cameraId: camera.id,
        active: true,
      },
    });

    // Inicia monitoramento ativo
    const monitoring = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: BigInt(user.id),
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoring.id,
        cameraId: camera.id,
      },
    });

    const res = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as any;

    assert.equal(json.data.overallMonitoring.status, 'ATIVO');
    assert.equal(json.data.overallMonitoring.reason, 'OPERACIONAL');
    assert.equal(json.data.overallMonitoring.currentSessions, 1);
    assert.equal(json.data.overallMonitoring.activeSessions, 1);
    assert.equal(json.data.overallMonitoring.pausedSessions, 0);
    assert.equal(json.data.overallMonitoring.degradedSessions, 0);
    assert.equal(json.data.overallMonitoring.unavailableSessions, 0);

    assert.equal(json.data.cameras.total, 1);
    assert.equal(json.data.cameras.online, 1);
    assert.equal(json.data.cameras.offline, 0);
    assert.equal(json.data.warnings.length, 0);
  });

  test('4. Monitoramento pausado retorna estado PAUSADO, PAUSADO_PELO_USUARIO e warning MONITORING_PAUSED', async () => {
    const client = prisma.getClient();
    const { user, tokens } = await createTestUser('paused');

    const camera = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.pau.${randomUUID()}`,
        name: 'Piscina Infantil',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(),
      },
    });

    await client.cameraAccess.create({
      data: {
        userId: BigInt(user.id),
        cameraId: camera.id,
        active: true,
      },
    });

    const now = Date.now();
    const monitoring = await client.monitoring.create({
      data: {
        status: 'PAUSADO',
        startedByUserId: BigInt(user.id),
        startedAt: new Date(now - 5000),
        pausedAt: new Date(now),
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoring.id,
        cameraId: camera.id,
      },
    });

    const res = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as any;

    assert.equal(json.data.overallMonitoring.status, 'PAUSADO');
    assert.equal(json.data.overallMonitoring.reason, 'PAUSADO_PELO_USUARIO');
    assert.equal(json.data.overallMonitoring.currentSessions, 1);
    assert.equal(json.data.overallMonitoring.activeSessions, 0);
    assert.equal(json.data.overallMonitoring.pausedSessions, 1);

    const pausedWarning = json.data.warnings.find(
      (w: any) => w.code === 'MONITORING_PAUSED',
    );
    assert.ok(pausedWarning, 'Deve conter aviso MONITORING_PAUSED');
    assert.equal(pausedWarning.monitoringId, monitoring.id.toString());
  });

  test('5. Câmera indisponível e estado degradado reporta DEGRADADO, CAMERAS_INDISPONIVEIS e CAMERA_OFFLINE', async () => {
    const client = prisma.getClient();
    const { user, tokens } = await createTestUser('degraded');

    // Câmera 1: online
    const camOnline = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.deg1.${randomUUID()}`,
        name: 'Câmera Deck',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(),
      },
    });

    // Câmera 2: offline (> 90s atrás)
    const camOffline = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.deg2.${randomUUID()}`,
        name: 'Câmera Fundo',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(Date.now() - 300_000),
      },
    });

    await client.cameraAccess.createMany({
      data: [
        { userId: BigInt(user.id), cameraId: camOnline.id, active: true },
        { userId: BigInt(user.id), cameraId: camOffline.id, active: true },
      ],
    });

    const monitoring = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: BigInt(user.id),
      },
    });

    await client.monitoringCamera.createMany({
      data: [
        { monitoringId: monitoring.id, cameraId: camOnline.id },
        { monitoringId: monitoring.id, cameraId: camOffline.id },
      ],
    });

    const res = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as any;

    assert.equal(json.data.overallMonitoring.status, 'DEGRADADO');
    assert.equal(json.data.overallMonitoring.reason, 'CAMERAS_INDISPONIVEIS');
    assert.equal(json.data.overallMonitoring.currentSessions, 1);
    assert.equal(json.data.overallMonitoring.activeSessions, 1);
    assert.equal(json.data.overallMonitoring.degradedSessions, 1);

    assert.equal(json.data.cameras.total, 2);
    assert.equal(json.data.cameras.online, 1);
    assert.equal(json.data.cameras.offline, 1);

    const offlineWarning = json.data.warnings.find(
      (w: any) => w.code === 'CAMERA_OFFLINE',
    );
    assert.ok(offlineWarning, 'Deve conter aviso CAMERA_OFFLINE');
    assert.equal(offlineWarning.cameraId, camOffline.id.toString());
    assert.equal(offlineWarning.monitoringId, monitoring.id.toString());
  });

  test('6. Alerta recente autorizado é retornado ao destinatário e isolado de outros usuários', async () => {
    const client = prisma.getClient();
    const { user: userWithAlert, tokens: tokensWithAlert } =
      await createTestUser('alert1');
    const { tokens: tokensOtherUser } = await createTestUser('alert2');

    const camera = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.alr.${randomUUID()}`,
        name: 'Piscina Olímpica',
        location: 'Clube',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(),
      },
    });

    await client.cameraAccess.create({
      data: {
        userId: BigInt(userWithAlert.id),
        cameraId: camera.id,
        active: true,
      },
    });

    const monitoring = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: BigInt(userWithAlert.id),
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoring.id,
        cameraId: camera.id,
      },
    });

    const alert = await client.alert.create({
      data: {
        eventKey: `test.home.alert.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        type: 'POSSIVEL_RISCO',
        severity: 'CRITICA',
        detectedAt: new Date(),
      },
    });

    // Atribui destinatário exclusivamente a userWithAlert
    await client.alertRecipient.create({
      data: {
        alertId: alert.id,
        userId: BigInt(userWithAlert.id),
      },
    });

    // Requisição do usuário destinatário
    const resAuthorized = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: `Bearer ${tokensWithAlert.accessToken}` },
    });
    assert.equal(resAuthorized.status, 200);
    const jsonAuthorized = (await resAuthorized.json()) as any;

    assert.ok(jsonAuthorized.data.latestAlert, 'Destinatário deve receber latestAlert');
    assert.equal(jsonAuthorized.data.latestAlert.id, alert.id.toString());
    assert.equal(jsonAuthorized.data.latestAlert.type, 'POSSIVEL_RISCO');
    assert.equal(jsonAuthorized.data.latestAlert.severity, 'CRITICA');
    assert.equal(jsonAuthorized.data.latestAlert.camera.id, camera.id.toString());
    assert.equal(jsonAuthorized.data.latestAlert.camera.name, 'Piscina Olímpica');
    assert.equal(jsonAuthorized.data.latestAlert.camera.location, 'Clube');

    // Requisição de outro usuário: NÃO deve ver o alerta!
    const resOther = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: `Bearer ${tokensOtherUser.accessToken}` },
    });
    assert.equal(resOther.status, 200);
    const jsonOther = (await resOther.json()) as any;
    assert.equal(
      jsonOther.data.latestAlert,
      null,
      'Usuário não destinatário não deve ver o alerta',
    );
  });

  test('7. Sessões ativas sem nenhuma câmera online coexistindo com sessão pausada reporta INDISPONIVEL e SEM_CAMERA_ONLINE', async () => {
    const client = prisma.getClient();
    const { user, tokens } = await createTestUser('unavail-mixed');

    // Câmera 1 (offline > 90s atrás) na sessão ATIVA
    const camActiveOffline = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.unav1.${randomUUID()}`,
        name: 'Câmera Externa Sem Sinal',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(Date.now() - 300_000),
      },
    });

    // Câmera 2 na sessão PAUSADA
    const camPaused = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.unav2.${randomUUID()}`,
        name: 'Câmera Interna Pausada',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(Date.now() - 300_000),
      },
    });

    await client.cameraAccess.createMany({
      data: [
        { userId: BigInt(user.id), cameraId: camActiveOffline.id, active: true },
        { userId: BigInt(user.id), cameraId: camPaused.id, active: true },
      ],
    });

    const now = Date.now();

    // Sessão 1: ATIVA, mas sua câmera está OFFLINE
    const monitoringActive = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: BigInt(user.id),
        startedAt: new Date(now - 10000),
      },
    });
    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoringActive.id,
        cameraId: camActiveOffline.id,
      },
    });

    // Sessão 2: PAUSADA pelo usuário
    const monitoringPaused = await client.monitoring.create({
      data: {
        status: 'PAUSADO',
        startedByUserId: BigInt(user.id),
        startedAt: new Date(now - 10000),
        pausedAt: new Date(now),
      },
    });
    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoringPaused.id,
        cameraId: camPaused.id,
      },
    });

    const res = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as any;

    // Como a única sessão ativa está sem câmeras online, não há vigilância ativa real.
    // O sistema reporta INDISPONIVEL com SEM_CAMERA_ONLINE, e não DEGRADADO / SESSIONS_MIXED.
    assert.equal(json.data.overallMonitoring.status, 'INDISPONIVEL');
    assert.equal(json.data.overallMonitoring.reason, 'SEM_CAMERA_ONLINE');
    assert.equal(json.data.overallMonitoring.currentSessions, 2);
    assert.equal(json.data.overallMonitoring.activeSessions, 1);
    assert.equal(json.data.overallMonitoring.pausedSessions, 1);
    assert.equal(json.data.overallMonitoring.unavailableSessions, 1);

    // Deve conter avisos de câmera sem sinal e sessão pausada
    const hasPausedWarning = json.data.warnings.some(
      (w: any) => w.code === 'MONITORING_PAUSED',
    );
    const hasOfflineWarning = json.data.warnings.some(
      (w: any) => w.code === 'CAMERA_OFFLINE',
    );
    assert.ok(hasPausedWarning, 'Deve conter aviso MONITORING_PAUSED');
    assert.ok(hasOfflineWarning, 'Deve conter aviso CAMERA_OFFLINE');
  });

  test('8. Sessão ativa com câmera online coexistindo com sessão pausada reporta DEGRADADO e SESSIONS_MIXED', async () => {
    const client = prisma.getClient();
    const { user, tokens } = await createTestUser('mixed-working');

    // Câmera 1 (ONLINE) na sessão ATIVA
    const camOnline = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.mix1.${randomUUID()}`,
        name: 'Câmera Deck Online',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(),
      },
    });

    // Câmera 2 na sessão PAUSADA
    const camPaused = await client.camera.create({
      data: {
        integrationCode: `test.home.cam.mix2.${randomUUID()}`,
        name: 'Câmera Spa Pausada',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(),
      },
    });

    await client.cameraAccess.createMany({
      data: [
        { userId: BigInt(user.id), cameraId: camOnline.id, active: true },
        { userId: BigInt(user.id), cameraId: camPaused.id, active: true },
      ],
    });

    const now = Date.now();

    // Sessão 1: ATIVA e operacional
    const monitoringActive = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: BigInt(user.id),
        startedAt: new Date(now - 10000),
      },
    });
    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoringActive.id,
        cameraId: camOnline.id,
      },
    });

    // Sessão 2: PAUSADA
    const monitoringPaused = await client.monitoring.create({
      data: {
        status: 'PAUSADO',
        startedByUserId: BigInt(user.id),
        startedAt: new Date(now - 10000),
        pausedAt: new Date(now),
      },
    });
    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoringPaused.id,
        cameraId: camPaused.id,
      },
    });

    const res = await fetch(`${baseUrl}/home`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as any;

    // Há vigilância ativa real em uma sessão e outra sessão pausada: DEGRADADO / SESSIONS_MIXED
    assert.equal(json.data.overallMonitoring.status, 'DEGRADADO');
    assert.equal(json.data.overallMonitoring.reason, 'SESSIONS_MIXED');
    assert.equal(json.data.overallMonitoring.currentSessions, 2);
    assert.equal(json.data.overallMonitoring.activeSessions, 1);
    assert.equal(json.data.overallMonitoring.pausedSessions, 1);
    assert.equal(json.data.overallMonitoring.unavailableSessions, 0);
  });
});
