import 'dotenv/config';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from '../../dist/app.module.js';
import { ProblemDetailsFilter } from '../../dist/common/filters/problem-details.filter.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { HashService } from '../../dist/modules/auth/hash.service.js';
import { MonitoringsService } from '../../dist/modules/monitorings/monitorings.service.js';

let app: NestExpressApplication;
let baseUrl: string;
let prisma: PrismaService;

const TEST_SERVICE_KEY =
  process.env['INTERNAL_SERVICE_KEY'] || 'poolsafe-internal-service-secret-local-dev';
process.env['INTERNAL_SERVICE_KEY'] = TEST_SERVICE_KEY;

function assertLocalTestDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const host = url.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) {
    throw new Error(
      `SEGURANÇA: Testes de integração só podem ser executados contra MySQL local. Host: ${host}`,
    );
  }
}

async function cleanupTestData(): Promise<void> {
  if (!prisma) return;
  const client = prisma.getClient();

  const testUsers = await client.user.findMany({
    where: { email: { startsWith: 'test.internal.alert.' } },
    select: { id: true },
  });
  const userIds = testUsers.map((u) => u.id);

  const testCameras = await client.camera.findMany({
    where: { integrationCode: { startsWith: 'test.cam.internal.' } },
    select: { id: true },
  });
  const cameraIds = testCameras.map((c) => c.id);

  const testAlerts = await client.alert.findMany({
    where: {
      OR: [
        { cameraId: { in: cameraIds } },
        { eventKey: { startsWith: 'test.evt.internal.' } },
      ],
    },
    select: { id: true },
  });
  const alertIds = testAlerts.map((a) => a.id);

  if (alertIds.length > 0) {
    await client.notificationDelivery.deleteMany({
      where: { notification: { alertId: { in: alertIds } } },
    });
    await client.notification.deleteMany({
      where: { alertId: { in: alertIds } },
    });
    await client.alertRecipient.deleteMany({
      where: { alertId: { in: alertIds } },
    });
    await client.alertEvidence.deleteMany({
      where: { alertId: { in: alertIds } },
    });
    await client.systemLog.deleteMany({
      where: { alertId: { in: alertIds } },
    });
    await client.alert.deleteMany({
      where: { id: { in: alertIds } },
    });
  }

  if (userIds.length > 0 || cameraIds.length > 0) {
    await client.systemLog.deleteMany({
      where: {
        OR: [
          { cameraId: { in: cameraIds } },
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
  try {
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
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    prisma = app.get(PrismaService);
    await cleanupTestData();
  } catch (err) {
    console.error('ERROR IN BEFORE:', err);
    throw err;
  }
});

after(async () => {
  try {
    await cleanupTestData();
    if (app) {
      await app.close();
    }
  } catch (err) {
    console.error('ERROR IN AFTER:', err);
  }
});

describe('Fatia 9B — Task 9B.2 — Persistência atômica e idempotente de alertas (N8N -> API)', () => {
  test('1. Autenticação de serviço: rejeita sem chave ou com chave incorreta (401)', async () => {
    // Sem chave
    const resNoKey = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey: 'test.evt.internal.auth.1',
        cameraCode: 'test.cam.internal.auth',
        severity: 'CRITICA',
        detectedAt: new Date().toISOString(),
      }),
    });
    assert.equal(resNoKey.status, 401);
    const jsonNoKey = await resNoKey.json();
    assert.equal(jsonNoKey.code, 'INVALID_SERVICE_SECRET');

    // Chave incorreta
    const resWrongKey = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': 'chave-incorreta-inventada',
      },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey: 'test.evt.internal.auth.2',
        cameraCode: 'test.cam.internal.auth',
        severity: 'CRITICA',
        detectedAt: new Date().toISOString(),
      }),
    });
    assert.equal(resWrongKey.status, 401);
    const jsonWrongKey = await resWrongKey.json();
    assert.equal(jsonWrongKey.code, 'INVALID_SERVICE_SECRET');
  });

  test('2. Evento novo em monitoramento ativo: persiste alerta, evidência, destinatários, notificação PENDENTE e entregas PENDENTES', async () => {
    const client = prisma.getClient();

    // Criar usuário com dispositivo elegível (ativo e com FCM Token)
    const user = await client.user.create({
      data: {
        name: 'Usuário Notificação 9B',
        email: 'test.internal.alert.user1@example.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
        status: 'ATIVO',
      },
    });

    const device = await client.device.create({
      data: {
        userId: user.id,
        installationIdentifier: '11111111-1111-4111-8111-111111111111',
        platform: 'ANDROID',
        fcmToken: 'fcm_token_teste_elegivel_user1',
        active: true,
      },
    });

    // Criar câmera
    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.internal.c1',
        name: 'Câmera Teste 9B C1',
        administrativeStatus: 'ATIVA',
      },
    });

    // Criar acesso ativo da câmera para o usuário
    await client.cameraAccess.create({
      data: {
        userId: user.id,
        cameraId: camera.id,
        active: true,
      },
    });

    // Criar monitoramento ATIVO
    const monitoring = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: user.id,
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoring.id,
        cameraId: camera.id,
      },
    });

    const eventKey = 'test.evt.internal.c1.novo';
    const fakeBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString('base64');

    const res = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey,
        cameraCode: camera.integrationCode,
        type: 'POSSIVEL_RISCO',
        severity: 'CRITICA',
        detectedAt: '2026-10-11T18:30:00.000Z',
        confidence: 0.952,
        modelVersion: 'yolov11-poolsafe-1',
        technicalData: { trackId: '42' },
        evidence: {
          mimeType: 'image/jpeg',
          base64: fakeBase64,
        },
      }),
    });

    assert.equal(res.status, 202);
    const body = await res.json();

    assert.equal(body.eventKey, eventKey);
    assert.equal(body.accepted, true);
    assert.equal(body.duplicate, false);
    assert.ok(typeof body.alertId === 'string' && body.alertId.length > 0);
    assert.equal(body.summary.recipientsCount, 1);
    assert.equal(body.summary.notificationsCount, 1);
    assert.equal(body.summary.deliveriesCount, 1);

    const alertIdBigInt = BigInt(body.alertId);

    // Verificar banco de dados
    const persistedAlert = await client.alert.findUnique({
      where: { id: alertIdBigInt },
      include: {
        evidence: true,
        recipients: true,
      },
    });

    assert.ok(persistedAlert);
    assert.equal(persistedAlert.eventKey, eventKey);
    assert.equal(persistedAlert.severity, 'CRITICA');
    assert.equal(persistedAlert.type, 'POSSIVEL_RISCO');
    assert.ok(persistedAlert.evidence);
    assert.equal(persistedAlert.evidence.mimeType, 'image/jpeg');
    assert.equal(persistedAlert.evidence.sizeBytes, BigInt(8));
    assert.equal(persistedAlert.recipients.length, 1);
    assert.equal(persistedAlert.recipients[0].userId.toString(), user.id.toString());

    // Verificar notificação criada
    const persistedNotif = await client.notification.findUnique({
      where: {
        alertId_userId: {
          alertId: alertIdBigInt,
          userId: user.id,
        },
      },
      include: {
        deliveries: true,
      },
    });

    assert.ok(persistedNotif);
    assert.equal(persistedNotif.status, 'PENDENTE');
    assert.equal(persistedNotif.processedAt, null);
    assert.equal(persistedNotif.deliveries.length, 1);

    const delivery = persistedNotif.deliveries[0];
    assert.equal(delivery.deviceId.toString(), device.id.toString());
    assert.equal(delivery.status, 'PENDENTE');
    assert.equal(delivery.attempts, 0);
  });

  test('3. Idempotência sequencial: repetição da mesma chave retorna o mesmo alerta sem duplicar linhas (duplicate: true)', async () => {
    const client = prisma.getClient();
    const eventKey = 'test.evt.internal.c1.novo';

    const existingAlert = await client.alert.findUniqueOrThrow({ where: { eventKey } });

    const countAlertsBefore = await client.alert.count({ where: { eventKey } });
    const countNotifsBefore = await client.notification.count({ where: { alertId: existingAlert.id } });
    const countDeliveriesBefore = await client.notificationDelivery.count({
      where: { notification: { alertId: existingAlert.id } },
    });

    const res = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey,
        cameraCode: 'test.cam.internal.c1',
        severity: 'CRITICA',
        detectedAt: '2026-10-11T18:30:00.000Z',
      }),
    });

    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.eventKey, eventKey);
    assert.equal(body.accepted, true);
    assert.equal(body.duplicate, true);
    assert.equal(body.alertId, existingAlert.id.toString());
    assert.equal(body.summary.recipientsCount, 1);
    assert.equal(body.summary.notificationsCount, 1);
    assert.equal(body.summary.deliveriesCount, 1);

    const countAlertsAfter = await client.alert.count({ where: { eventKey } });
    const countNotifsAfter = await client.notification.count({ where: { alertId: existingAlert.id } });
    const countDeliveriesAfter = await client.notificationDelivery.count({
      where: { notification: { alertId: existingAlert.id } },
    });

    assert.equal(countAlertsAfter, countAlertsBefore);
    assert.equal(countNotifsAfter, countNotifsBefore);
    assert.equal(countDeliveriesAfter, countDeliveriesBefore);
  });

  test('4. Idempotência concorrente: chamadas simultâneas com a mesma nova chave produzem exatamente 1 alerta', async () => {
    const client = prisma.getClient();

    const camera = await client.camera.findUniqueOrThrow({
      where: { integrationCode: 'test.cam.internal.c1' },
    });

    const concurrentEventKey = 'test.evt.internal.concurrent.1';

    const promises = Array.from({ length: 5 }).map(() =>
      fetch(`${baseUrl}/internal/alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
        },
        body: JSON.stringify({
          schemaVersion: '1',
          eventKey: concurrentEventKey,
          cameraCode: camera.integrationCode,
          severity: 'CRITICA',
          detectedAt: new Date().toISOString(),
        }),
      }),
    );

    const responses = await Promise.all(promises);
    const bodies = await Promise.all(responses.map((r) => r.json()));

    for (const res of responses) {
      assert.equal(res.status, 202);
    }

    const firstAlertId = bodies[0].alertId;
    for (const b of bodies) {
      assert.equal(b.alertId, firstAlertId);
      assert.equal(b.eventKey, concurrentEventKey);
      assert.equal(b.accepted, true);
    }

    const alertsCount = await client.alert.count({
      where: { eventKey: concurrentEventKey },
    });
    assert.equal(alertsCount, 1);
  });

  test('5. Evento novo em monitoramento pausado: rejeição operacional (409) sem criar alerta nem notificação', async () => {
    const client = prisma.getClient();

    const user = await client.user.create({
      data: {
        name: 'Usuário Monitoramento Pausado',
        email: 'test.internal.alert.paused@example.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
        status: 'ATIVO',
      },
    });

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.internal.paused',
        name: 'Câmera Monitoramento Pausado',
        administrativeStatus: 'ATIVA',
      },
    });

    await client.cameraAccess.create({
      data: {
        userId: user.id,
        cameraId: camera.id,
        active: true,
      },
    });

    // Monitoramento PAUSADO (startedAt anterior a pausedAt para satisfazer ck_monitoramento_datas)
    const startedAt = new Date(Date.now() - 60000);
    const pausedAt = new Date();
    const mon = await client.monitoring.create({
      data: {
        status: 'PAUSADO',
        startedByUserId: user.id,
        startedAt,
        pausedAt,
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: mon.id,
        cameraId: camera.id,
      },
    });

    const newPausedEventKey = 'test.evt.internal.paused.new';

    const res = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey: newPausedEventKey,
        cameraCode: camera.integrationCode,
        severity: 'CRITICA',
        detectedAt: new Date().toISOString(),
      }),
    });

    assert.equal(res.status, 409);
    const errBody = await res.json();
    assert.equal(errBody.code, 'ACTIVE_MONITORING_NOT_FOUND');

    const alertInDb = await client.alert.findUnique({
      where: { eventKey: newPausedEventKey },
    });
    assert.equal(alertInDb, null);
  });

  test('6. Repetição de evento já aceito após pausa do monitoramento: recupera alerta e mantém histórico intacto', async () => {
    const client = prisma.getClient();

    // Buscar monitoramento da câmera c1 que criamos no teste 2
    const camera = await client.camera.findUniqueOrThrow({
      where: { integrationCode: 'test.cam.internal.c1' },
      include: {
        monitoringCameras: {
          include: { monitoring: true },
        },
      },
    });

    const monitoringId = camera.monitoringCameras[0].monitoringId;

    // Pausar o monitoramento
    await client.monitoring.update({
      where: { id: monitoringId },
      data: {
        status: 'PAUSADO',
        pausedAt: new Date(),
      },
    });

    // Reenviar a chave c1.novo que já havia sido aceita
    const existingKey = 'test.evt.internal.c1.novo';

    const res = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey: existingKey,
        cameraCode: camera.integrationCode,
        severity: 'CRITICA',
        detectedAt: new Date().toISOString(),
      }),
    });

    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.eventKey, existingKey);
    assert.equal(body.accepted, true);
    assert.equal(body.duplicate, true);
    assert.equal(body.summary.recipientsCount, 1);
    assert.equal(body.summary.notificationsCount, 1);
    assert.equal(body.summary.deliveriesCount, 1);
  });

  test('7. Destinatário sem dispositivo elegível: gera notificação SEM_DISPOSITIVO sem criar entregas fictícias', async () => {
    const client = prisma.getClient();

    const userNoDevice = await client.user.create({
      data: {
        name: 'Usuário Sem Dispositivo',
        email: 'test.internal.alert.nodevice@example.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
        status: 'ATIVO',
      },
    });

    // Dispositivo ativo mas sem token FCM registrado (inelegível para push)
    await client.device.create({
      data: {
        userId: userNoDevice.id,
        installationIdentifier: '22222222-2222-4222-8222-222222222222',
        platform: 'ANDROID',
        fcmToken: null,
        active: true,
      },
    });

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.internal.nodevice',
        name: 'Câmera Sem Dispositivo',
        administrativeStatus: 'ATIVA',
      },
    });

    await client.cameraAccess.create({
      data: {
        userId: userNoDevice.id,
        cameraId: camera.id,
        active: true,
      },
    });

    const mon = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: userNoDevice.id,
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: mon.id,
        cameraId: camera.id,
      },
    });

    const eventKey = 'test.evt.internal.nodevice.1';

    const res = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey,
        cameraCode: camera.integrationCode,
        severity: 'ATENCAO',
        detectedAt: new Date().toISOString(),
      }),
    });

    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.accepted, true);
    assert.equal(body.duplicate, false);
    assert.equal(body.summary.recipientsCount, 1);
    assert.equal(body.summary.notificationsCount, 1);
    assert.equal(body.summary.deliveriesCount, 0); // ZERO entregas

    const alertIdBigInt = BigInt(body.alertId);

    const notification = await client.notification.findUniqueOrThrow({
      where: {
        alertId_userId: {
          alertId: alertIdBigInt,
          userId: userNoDevice.id,
        },
      },
      include: {
        deliveries: true,
      },
    });

    assert.equal(notification.status, 'SEM_DISPOSITIVO');
    assert.ok(notification.processedAt !== null);
    assert.equal(notification.deliveries.length, 0);
  });

  test('8. Câmera sem destinatários ativos: preserva alerta para auditoria e gera log de erro sem distribuição', async () => {
    const client = prisma.getClient();

    const creatorUser = await client.user.create({
      data: {
        name: 'Criador Sessão',
        email: 'test.internal.alert.norecipients@example.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
        status: 'ATIVO',
      },
    });

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.internal.norecipients',
        name: 'Câmera Sem Destinatários',
        administrativeStatus: 'ATIVA',
      },
    });

    // Câmera NÃO tem acessos ativos na tabela acesso_camera!
    const mon = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: creatorUser.id,
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: mon.id,
        cameraId: camera.id,
      },
    });

    const eventKey = 'test.evt.internal.norecipients.1';

    const res = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey,
        cameraCode: camera.integrationCode,
        severity: 'CRITICA',
        detectedAt: new Date().toISOString(),
      }),
    });

    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.accepted, true);
    assert.equal(body.summary.recipientsCount, 0);
    assert.equal(body.summary.notificationsCount, 0);
    assert.equal(body.summary.deliveriesCount, 0);

    const alertIdBigInt = BigInt(body.alertId);

    // Verificar que o alerta foi preservado
    const alert = await client.alert.findUnique({
      where: { id: alertIdBigInt },
    });
    assert.ok(alert);

    // Verificar que um log operacional de nível ERRO foi gravado
    const systemLog = await client.systemLog.findFirst({
      where: {
        alertId: alertIdBigInt,
        level: 'ERRO',
        category: 'ALERTA',
      },
    });
    assert.ok(systemLog);
  });

  test('9. Validação de payload: tipo MIME inválido é rejeitado antes da persistência (422)', async () => {
    const client = prisma.getClient();

    const camera = await client.camera.findUniqueOrThrow({
      where: { integrationCode: 'test.cam.internal.c1' },
    });

    const invalidEventKey = 'test.evt.internal.validation.mime.1';

    // Evidência com tipo MIME não suportado (ex: application/pdf)
    const res = await fetch(`${baseUrl}/internal/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': TEST_SERVICE_KEY,
      },
      body: JSON.stringify({
        schemaVersion: '1',
        eventKey: invalidEventKey,
        cameraCode: camera.integrationCode,
        severity: 'CRITICA',
        detectedAt: new Date().toISOString(),
        evidence: {
          mimeType: 'application/pdf',
          base64: 'dGVzdGU=',
        },
      }),
    });

    assert.equal(res.status, 422); // ValidationPipe rejeita mimeType inválido com 422 Problem Details

    // Garantir que nenhum alerta parcial foi criado
    const alertInDb = await client.alert.findUnique({
      where: { eventKey: invalidEventKey },
    });
    assert.equal(alertInDb, null);
  });

  test('10. Rollback atômico pós-escrita: falha interna após escrita desfaz transação e não deixa registros parciais', async () => {
    const client = prisma.getClient();

    // 1. Criar cenário com usuário elegível e câmera ativa
    const user = await client.user.create({
      data: {
        name: 'Usuário Rollback Mid-Tx',
        email: 'test.internal.alert.rollback.midtx@example.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
        status: 'ATIVO',
      },
    });

    const device = await client.device.create({
      data: {
        userId: user.id,
        installationIdentifier: '22222222-2222-4222-8222-222222222222',
        platform: 'ANDROID',
        fcmToken: 'fcm_token_teste_rollback_midtx',
        active: true,
      },
    });

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.internal.rollback.midtx',
        name: 'Câmera Rollback Mid-Tx',
        administrativeStatus: 'ATIVA',
      },
    });

    await client.cameraAccess.create({
      data: {
        userId: user.id,
        cameraId: camera.id,
        active: true,
      },
    });

    const monitoring = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: user.id,
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoring.id,
        cameraId: camera.id,
      },
    });

    const rollbackEventKey = 'test.evt.internal.rollback.midtx.1';

    // 2. Interceptar a transação do Prisma para provocar falha APÓS a inserção do alerta
    const realPrisma = app.get(PrismaService);
    const prismaClient = realPrisma.getClient();
    const originalTransaction = prismaClient.$transaction.bind(prismaClient);

    let alertWasActuallyInsertedInTx = false;

    (prismaClient as unknown as { $transaction: unknown }).$transaction = async (
      cb: unknown,
      opts: unknown,
    ) => {
      if (typeof cb === 'function') {
        return originalTransaction(async (tx: Record<string, unknown>) => {
          // Injeta gatilho de falha na criação da notificação (após criação do alerta e recipients)
          const notificationModel = tx['notification'] as {
            create: (...args: unknown[]) => Promise<unknown>;
          };
          const alertModel = tx['alert'] as {
            findUnique: (args: unknown) => Promise<unknown>;
          };

          notificationModel.create = async () => {
            // Comprova que o alerta DE FATO já foi inserido fisicamente na transação aberta
            const inTxAlert = await alertModel.findUnique({
              where: { eventKey: rollbackEventKey },
            });
            if (inTxAlert) {
              alertWasActuallyInsertedInTx = true;
            }
            throw new Error('FALHA_SIMULADA_MID_TRANSACTION_APOS_INSERT_ALERTA');
          };

          return (cb as (txParam: Record<string, unknown>) => Promise<unknown>)(tx);
        }, opts as never);
      }
      return (originalTransaction as (cbParam: unknown, optsParam: unknown) => Promise<unknown>)(
        cb,
        opts,
      );
    };

    try {
      const res = await fetch(`${baseUrl}/internal/alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
        },
        body: JSON.stringify({
          schemaVersion: '1',
          eventKey: rollbackEventKey,
          cameraCode: camera.integrationCode,
          severity: 'CRITICA',
          detectedAt: new Date().toISOString(),
        }),
      });

      // Como uma exceção não tratada ocorreu dentro da transação, o servidor retorna 500
      assert.equal(res.status, 500);

      // Confirma que a escrita do alerta DE FATO aconteceu dentro da transação antes do abort
      assert.equal(alertWasActuallyInsertedInTx, true);

      // 3. Comprovação de Rollback: verificar que NENHUM registro sobreviveu fora da transação
      const alertInDb = await client.alert.findUnique({
        where: { eventKey: rollbackEventKey },
      });
      assert.equal(alertInDb, null, 'O alerta deve ter sido desfeito pelo rollback');

      const recipientsInDb = await client.alertRecipient.findMany({
        where: { userId: user.id },
      });
      assert.equal(recipientsInDb.length, 0, 'Nenhum destinatário parcial deve ter persistido');

      const notificationsInDb = await client.notification.findMany({
        where: { userId: user.id },
      });
      assert.equal(notificationsInDb.length, 0, 'Nenhuma notificação parcial deve ter persistido');

      const deliveriesInDb = await client.notificationDelivery.findMany({
        where: { deviceId: device.id },
      });
      assert.equal(deliveriesInDb.length, 0, 'Nenhuma entrega parcial deve ter persistido');
    } finally {
      // Restaurar a implementação original do $transaction
      (prismaClient as unknown as { $transaction: unknown }).$transaction = originalTransaction;
    }
  });

  test('11. Concorrência: corrida entre criação de evento novo e pausa de monitoramento com bloqueio FOR UPDATE coordenado', async () => {
    const client = prisma.getClient();
    const hashService = app.get(HashService);
    const monitoringsService = app.get(MonitoringsService);

    const passwordPlain = 'SenhaCorrida123!';
    const passwordHash = await hashService.hash(passwordPlain);

    const user = await client.user.create({
      data: {
        name: 'Usuário Concorrência Pausa',
        email: 'test.internal.alert.race.pause@example.com',
        passwordHash,
        status: 'ATIVO',
      },
    });

    const camera = await client.camera.create({
      data: {
        integrationCode: 'test.cam.internal.race.pause',
        name: 'Câmera Concorrência Pausa',
        administrativeStatus: 'ATIVA',
      },
    });

    await client.cameraAccess.create({
      data: {
        userId: user.id,
        cameraId: camera.id,
        active: true,
      },
    });

    const startedAt = new Date(Date.now() - 10000);
    const monitoring = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: user.id,
        startedAt,
      },
    });

    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoring.id,
        cameraId: camera.id,
      },
    });

    const raceEventKey = 'test.evt.internal.race.pause.1';

    // Disparar simultaneamente:
    // 1. Criação do alerta via endpoint interno
    // 2. Pausa do monitoramento via serviço de monitoramento (que exige lock FOR UPDATE na linha do monitoramento)
    const [alertResponse, pauseResult] = await Promise.all([
      fetch(`${baseUrl}/internal/alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
        },
        body: JSON.stringify({
          schemaVersion: '1',
          eventKey: raceEventKey,
          cameraCode: camera.integrationCode,
          severity: 'CRITICA',
          detectedAt: new Date().toISOString(),
        }),
      }),
      monitoringsService.pauseMonitoring(
        monitoring.id.toString(),
        { password: passwordPlain },
        user.id.toString(),
        'req-race-pause-test',
      ),
    ]);

    // A pausa deve sempre ser concluída com sucesso
    assert.ok(pauseResult.data);
    assert.equal(pauseResult.data.status, 'PAUSADO');

    // Verificar o resultado do alerta sob a corrida serializada pelos locks FOR UPDATE:
    // Se o alerta adquiriu o lock antes da pausa: status 202 e alerta persistido
    // Se a pausa adquiriu o lock antes do alerta: status 409 (ACTIVE_MONITORING_NOT_FOUND) e nenhum alerta persistido
    if (alertResponse.status === 202) {
      const alertBody = (await alertResponse.json()) as { accepted: boolean; eventKey: string };
      assert.equal(alertBody.accepted, true);
      assert.equal(alertBody.eventKey, raceEventKey);

      const alertInDb = await client.alert.findUnique({
        where: { eventKey: raceEventKey },
      });
      assert.ok(alertInDb);
    } else {
      assert.equal(alertResponse.status, 409);
      const errBody = (await alertResponse.json()) as { code: string };
      assert.equal(errBody.code, 'ACTIVE_MONITORING_NOT_FOUND');

      const alertInDb = await client.alert.findUnique({
        where: { eventKey: raceEventKey },
      });
      assert.equal(alertInDb, null, 'Alerta não deve ter sido persistido se a pausa comitou antes');
    }

    // Verificar que o estado final do monitoramento no banco está consistente (PAUSADO)
    const finalMonitoring = await client.monitoring.findUniqueOrThrow({
      where: { id: monitoring.id },
    });
    assert.equal(finalMonitoring.status, 'PAUSADO');
  });
});
