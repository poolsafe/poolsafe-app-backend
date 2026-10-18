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
    where: { email: { startsWith: 'test.internal.deliv.' } },
    select: { id: true },
  });
  const userIds = testUsers.map((u) => u.id);

  const testCameras = await client.camera.findMany({
    where: { integrationCode: { startsWith: 'test.cam.deliv.' } },
    select: { id: true },
  });
  const cameraIds = testCameras.map((c) => c.id);

  const testAlerts = await client.alert.findMany({
    where: {
      OR: [
        { cameraId: { in: cameraIds } },
        { eventKey: { startsWith: 'test.evt.deliv.' } },
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
        OR: [{ userId: { in: userIds } }, { cameraId: { in: cameraIds } }],
      },
    });

    await client.authSession.deleteMany({
      where: { userId: { in: userIds } },
    });

    await client.device.deleteMany({
      where: { userId: { in: userIds } },
    });

    await client.camera.deleteMany({
      where: { id: { in: cameraIds } },
    });

    await client.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }
}

describe('Fatia 9B.3 — Envio e Rastreabilidade FCM (Internal Deliveries)', () => {
  before(async () => {
    const dbUrl = process.env['DATABASE_URL'];
    assert.ok(dbUrl, 'DATABASE_URL deve estar configurada no ambiente.');
    assertLocalTestDatabase(dbUrl);

    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });

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

    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    prisma = app.get(PrismaService);
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData();
    if (app) {
      await app.close();
    }
  });

  async function createTestScenario(suffix: string, customToken = `token-fcm-${suffix}`) {
    const client = prisma.getClient();
    const hashService = app.get(HashService);
    const passHash = await hashService.hash('SenhaForte123!');

    const user = await client.user.create({
      data: {
        name: `Usuario Deliv ${suffix}`,
        email: `test.internal.deliv.${suffix}@example.com`,
        passwordHash: passHash,
        status: 'ATIVO',
      },
    });

    const device = await client.device.create({
      data: {
        userId: user.id,
        installationIdentifier: randomUUID(),
        platform: 'ANDROID',
        fcmToken: customToken,
        active: true,
        lastAccessAt: new Date(),
        tokenUpdatedAt: new Date(),
      },
    });

    const camera = await client.camera.create({
      data: {
        integrationCode: `test.cam.deliv.${suffix}`,
        name: `Camera Deliv ${suffix}`,
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(),
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

    const alert = await client.alert.create({
      data: {
        eventKey: `test.evt.deliv.${suffix}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        type: 'POSSIVEL_RISCO',
        severity: 'CRITICA',
        detectedAt: new Date(),
      },
    });

    await client.alertRecipient.create({
      data: {
        alertId: alert.id,
        userId: user.id,
      },
    });

    const notification = await client.notification.create({
      data: {
        alertId: alert.id,
        userId: user.id,
        title: 'Alerta de Teste',
        message: 'Mensagem de teste de risco.',
        status: 'PENDENTE',
      },
    });

    const delivery = await client.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        deviceId: device.id,
        status: 'PENDENTE',
        attempts: 0,
      },
    });

    return { user, device, camera, monitoring, alert, notification, delivery };
  }

  test('1. Proteção de rota: Rejeita chamadas sem autenticação de serviço interna (401)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/internal/alerts/999/deliveries`, {
      method: 'GET',
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'INVALID_SERVICE_SECRET');
  });

  test('2. Proteção de rota: Rejeita chamadas com segredo de serviço inválido (401)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/internal/alerts/999/deliveries`, {
      method: 'GET',
      headers: {
        'X-Internal-Service-Key': 'chave-incorreta-ou-falsa',
      },
    });
    assert.equal(res.status, 401);
  });

  test('3. Obter entregas de um alerta aceito (GET /internal/alerts/:alertId/deliveries)', async () => {
    const scenario = await createTestScenario('list_01');

    const res = await fetch(
      `${baseUrl}/api/v1/internal/alerts/${scenario.alert.id}/deliveries`,
      {
        method: 'GET',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
        },
      },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.alertId, scenario.alert.id.toString());
    assert.equal(body.totalDeliveries, 1);
    assert.equal(body.deliveries[0].id, scenario.delivery.id.toString());
    assert.equal(body.deliveries[0].status, 'PENDENTE');
    assert.equal(body.deliveries[0].attempts, 0);
  });

  test('4. Preparar tentativa: incrementa attempts, atualiza lastAttemptAt e monta payload FCM data-only com strings', async () => {
    const scenario = await createTestScenario('prep_01');

    const res = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
        },
      },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ready, true);
    assert.equal(body.deliveryId, scenario.delivery.id.toString());
    assert.equal(body.attemptNumber, 1);
    assert.equal(body.attempts, 1);
    assert.equal(body.maxAttempts, 3);
    assert.equal(body.targetToken, scenario.device.fcmToken);

    // Payload de dados deve conter todos os valores como string
    assert.equal(body.payload.schemaVersion, '1');
    assert.equal(body.payload.type, 'ALERT');
    assert.equal(body.payload.alertId, scenario.alert.id.toString());
    assert.equal(body.payload.deliveryId, scenario.delivery.id.toString());
    assert.equal(body.payload.severity, 'CRITICA');
    assert.equal(body.payload.channelId, 'poolsafe_alertas_criticos_v2');
    assert.equal(typeof body.payload.title, 'string');
    assert.equal(typeof body.payload.message, 'string');
    assert.equal(body.payload.detectedAt, scenario.alert.detectedAt.toISOString());

    // Mensagem FCM completa para HTTP v1
    assert.equal(body.fcmMessage.token, scenario.device.fcmToken);
    assert.equal(body.fcmMessage.android.priority, 'HIGH');
    assert.equal(body.fcmMessage.android.ttl, '300s');

    // Verificar no banco de dados que a tentativa foi incrementada e data registrada
    const inDb = await prisma.getClient().notificationDelivery.findUnique({
      where: { id: scenario.delivery.id },
    });
    assert.equal(inDb?.attempts, 1);
    assert.ok(inDb?.lastAttemptAt != null);
  });

  test('5. Preparação simultânea (in-flight): impede que duas preparações ocorram na mesma janela de 20s', async () => {
    const scenario = await createTestScenario('inflight_01');

    // 1ª preparação: autorizada
    const res1 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.ready, true);

    // 2ª preparação imediata: rejeitada como tentativa em andamento
    const res2 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.ready, false);
    assert.equal(body2.reason, 'ATTEMPT_IN_PROGRESS');
    assert.ok(body2.retryAfterMs > 0);
    assert.ok(body2.nextAttemptAllowedAt != null);
  });

  test('6. Registro de aceite (ACCEPTED): grava fcm_message_id, marca ENVIADA e consolida notificação como PROCESSADA', async () => {
    const scenario = await createTestScenario('accept_01');

    // Prepara tentativa 1
    await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );

    const fcmMessageId = 'projects/poolsafe-1f0db/messages/msg-test-12345';
    const res = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'ACCEPTED',
          fcmMessageId,
        }),
      },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ENVIADA');
    assert.equal(body.fcmMessageId, fcmMessageId);
    assert.equal(body.notificationStatus, 'PROCESSADA');

    // Banco de dados: entrega e notificação com status atualizado
    const deliveryDb = await prisma.getClient().notificationDelivery.findUnique({
      where: { id: scenario.delivery.id },
    });
    assert.equal(deliveryDb?.status, 'ENVIADA');
    assert.equal(deliveryDb?.fcmMessageId, fcmMessageId);
    assert.ok(deliveryDb?.sentAt != null);

    const notifDb = await prisma.getClient().notification.findUnique({
      where: { id: scenario.notification.id },
    });
    assert.equal(notifDb?.status, 'PROCESSADA');
    assert.ok(notifDb?.processedAt != null);
  });

  test('7. Não reenviar entregas já ENVIADAS: prepare recusa com ALREADY_SENT', async () => {
    const scenario = await createTestScenario('already_sent_01');

    // Marca como ENVIADA (com sentAt para respeitar a constraint ck_entrega_notificacao_envio)
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { status: 'ENVIADA', fcmMessageId: 'msg-existente', sentAt: new Date() },
    });

    const res = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ready, false);
    assert.equal(body.reason, 'ALREADY_SENT');
    assert.equal(body.status, 'ENVIADA');
  });

  test('8. Idempotência e respostas atrasadas: resposta de erro tardia não pode sobrescrever entrega já ENVIADA', async () => {
    const scenario = await createTestScenario('late_resp_01');

    // Marca como ENVIADA com ID legítimo e sentAt
    const originalMessageId = 'projects/poolsafe-1f0db/messages/original-msg-ok';
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: {
        status: 'ENVIADA',
        attempts: 1,
        fcmMessageId: originalMessageId,
        sentAt: new Date(),
      },
    });

    // Envia resultado tardio de erro ou timeout
    const res = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'UNKNOWN',
          errorCode: 'TIMEOUT',
          errorDetail: 'Timeout de rede tardio após resposta externa.',
        }),
      },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ENVIADA');
    assert.equal(body.fcmMessageId, originalMessageId);
    assert.equal(body.ignored, true);
    assert.equal(body.reason, 'IGNORED_LATE_RESPONSE_ALREADY_SENT');

    // Banco de dados intacto com status ENVIADA e ID original
    const inDb = await prisma.getClient().notificationDelivery.findUnique({
      where: { id: scenario.delivery.id },
    });
    assert.equal(inDb?.status, 'ENVIADA');
    assert.equal(inDb?.fcmMessageId, originalMessageId);
  });

  test('9. Correlação: erro atrasado da tentativa 1 após preparação da tentativa 2 é ignorado e não altera a tentativa atual', async () => {
    const scenario = await createTestScenario('stale_attempt_01');

    // Prepara tentativa 1
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date(Date.now() - 30_000) }, // 30s atrás para sair da janela in-flight
    });

    // Prepara tentativa 2
    const prepRes = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );
    assert.equal(prepRes.status, 200);
    const prepBody = await prepRes.json();
    assert.equal(prepBody.ready, true);
    assert.equal(prepBody.attemptNumber, 2);

    // Agora chega uma resposta de erro da tentativa 1 (attemptNumber: 1 < attempts: 2)
    const staleRes = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: 'UNAVAILABLE',
          errorDetail: 'Erro atrasado da tentativa 1.',
        }),
      },
    );

    assert.equal(staleRes.status, 200);
    const staleBody = await staleRes.json();
    assert.equal(staleBody.ignored, true);
    assert.equal(staleBody.reason, 'IGNORED_STALE_ATTEMPT_RESULT');
    assert.equal(staleBody.attempts, 2); // Tentativa 2 permanece intacta

    // Repetição do resultado da tentativa 1 também é ignorada
    const repRes = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: 'UNAVAILABLE',
        }),
      },
    );
    assert.equal(repRes.status, 200);
    const repBody = await repRes.json();
    assert.equal(repBody.ignored, true);
  });

  test('10. Correlação: aceite legítimo tardio da tentativa 1 após preparação da tentativa 2 é honrado com sucesso', async () => {
    const scenario = await createTestScenario('late_accept_01');

    // Prepara tentativa 1 há 30s
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date(Date.now() - 30_000) },
    });

    // Prepara tentativa 2
    await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );

    // Aceite da tentativa 1 chega tardiamente (attemptNumber: 1 < attempts: 2)
    const fcmMessageId = 'projects/poolsafe-1f0db/messages/tardia-mas-aceita';
    const res = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'ACCEPTED',
          fcmMessageId,
        }),
      },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ENVIADA');
    assert.equal(body.fcmMessageId, fcmMessageId);
    assert.equal(body.notificationStatus, 'PROCESSADA');
  });

  test('11. Retry-After e 429: respeita header explícito (segundos ou data HTTP) e aplica 60s para 429 sem header', async () => {
    const scenario = await createTestScenario('retry_after_01');

    // Preparada há pouco tempo
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    // 11A: Erro 429 sem Retry-After -> aplica exatamente 60 segundos
    const res429 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: '429',
          errorDetail: 'Too Many Requests',
        }),
      },
    );
    assert.equal(res429.status, 200);
    const body429 = await res429.json();
    assert.equal(body429.backoffDelayMs, 60_000);
    assert.ok(body429.nextAttemptAllowedAt != null);

    // 11B: Chamada antecipada em prepare deve ser bloqueada antes dos 60s com BACKOFF_REQUIRED
    const prepBlocked = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );
    assert.equal(prepBlocked.status, 200);
    const prepBlockedBody = await prepBlocked.json();
    assert.equal(prepBlockedBody.ready, false);
    assert.equal(prepBlockedBody.reason, 'BACKOFF_REQUIRED');
    assert.ok(prepBlockedBody.retryAfterMs > 0);
    assert.ok(prepBlockedBody.nextAttemptAllowedAt != null);

    // 11C: Respeita header Retry-After explícito numérico (ex: 45 segundos)
    const scenarioExplicit = await createTestScenario('retry_num_45');
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenarioExplicit.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });
    const resExplicit = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenarioExplicit.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenarioExplicit.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: 'UNAVAILABLE',
          retryAfter: 45,
        }),
      },
    );
    assert.equal(resExplicit.status, 200);
    const bodyExplicit = await resExplicit.json();
    assert.equal(bodyExplicit.backoffDelayMs, 45_000);

    // 11D: Respeita header Retry-After em formato data HTTP
    const scenarioDate = await createTestScenario('retry_http_date');
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenarioDate.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });
    const futureDate = new Date(Date.now() + 50_000).toUTCString();
    const resDate = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenarioDate.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenarioDate.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: 'UNAVAILABLE',
          retryAfter: futureDate,
        }),
      },
    );
    assert.equal(resDate.status, 200);
    const bodyDate = await resDate.json();
    assert.ok(bodyDate.backoffDelayMs >= 48_000 && bodyDate.backoffDelayMs <= 52_000);
  });

  test('12. Demais falhas retryable: backoff exponencial com jitter e intervalo mínimo de 10s', async () => {
    const scenario = await createTestScenario('backoff_exp_01');

    // Tentativa 1: >= 10s (10s + jitter)
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    const res1 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: 'UNAVAILABLE',
        }),
      },
    );
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.ok(body1.backoffDelayMs >= 10_000, 'Backoff deve ser no mínimo 10s para a tentativa 1');

    // Tentativa 2: >= 20s (20s + jitter)
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 2, lastAttemptAt: new Date() },
    });

    const res2 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 2,
          usedToken: scenario.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: 'UNAVAILABLE',
        }),
      },
    );
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.ok(body2.backoffDelayMs >= 20_000, 'Backoff deve ser no mínimo 20s para a tentativa 2');
  });

  test('13. Limite de rotação: no máximo um retry por rotação na mesma entrega (T1 -> T2 -> T3) e respeitando teto de 3 tentativas', async () => {
    const tokenT1 = 'token-rot-T1';
    const tokenT2 = 'token-rot-T2';
    const tokenT3 = 'token-rot-T3';
    const scenario = await createTestScenario('rot_chain_01', tokenT1);

    // Tentativa 1 preparada com T1
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    // 1ª Rotação: Dispositivo foi atualizado para T2 pelo aplicativo
    await prisma.getClient().device.update({
      where: { id: scenario.device.id },
      data: { fcmToken: tokenT2 },
    });

    // Tentativa 1 reporta falha com T1 -> 1ª rotação concedida!
    const resRot1 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: tokenT1,
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'UNREGISTERED',
        }),
      },
    );
    assert.equal(resRot1.status, 200);
    const bodyRot1 = await resRot1.json();
    assert.equal(bodyRot1.status, 'PENDENTE');
    assert.equal(bodyRot1.canRetryWithNewToken, true);
    assert.equal(bodyRot1.canRetry, true);

    // Tentativa 2 é preparada e enviada com T2
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 2, lastAttemptAt: new Date(Date.now() - 30_000) },
    });

    // Agora simula que o aplicativo rotacionou NOVAMENTE para T3 (T1 -> T2 -> T3)
    await prisma.getClient().device.update({
      where: { id: scenario.device.id },
      data: { fcmToken: tokenT3 },
    });

    // Tentativa 2 reporta falha com T2: como já houve 1 rotação concedida nesta entrega, segunda rotação NÃO É PERMITIDA!
    const resRot2 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 2,
          usedToken: tokenT2,
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'UNREGISTERED',
        }),
      },
    );
    assert.equal(resRot2.status, 200);
    const bodyRot2 = await resRot2.json();
    assert.equal(bodyRot2.status, 'FALHA');
    assert.equal(bodyRot2.canRetryWithNewToken, false);
    assert.equal(bodyRot2.canRetry, false);
    assert.equal(bodyRot2.errorCode, 'TOKEN_ROTATION_LIMIT_EXCEEDED');

    // O token T3 no dispositivo NÃO É APAGADO (preservado para o futuro)
    const devDb = await prisma.getClient().device.findUnique({
      where: { id: scenario.device.id },
    });
    assert.equal(devDb?.fcmToken, tokenT3);

    // 13B: Teto de 3 tentativas: Se a 3ª tentativa falhar, rotação nunca retorna canRetry=true
    const scenarioTeto = await createTestScenario('rot_teto_01', 'token-teto-A');
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenarioTeto.delivery.id },
      data: { attempts: 3, lastAttemptAt: new Date() }, // 3ª tentativa
    });
    await prisma.getClient().device.update({
      where: { id: scenarioTeto.device.id },
      data: { fcmToken: 'token-teto-B' },
    });

    const resTeto = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenarioTeto.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 3,
          usedToken: 'token-teto-A',
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'UNREGISTERED',
        }),
      },
    );
    assert.equal(resTeto.status, 200);
    const bodyTeto = await resTeto.json();
    assert.equal(bodyTeto.status, 'FALHA');
    assert.equal(bodyTeto.canRetry, false);
    assert.equal(bodyTeto.canRetryWithNewToken, false);
  });

  test('14. Falhas definitivas estruturadas do FCM e estado TOKEN_INVALIDO previsto no schema', async () => {
    const scenario = await createTestScenario('struct_err_01');

    // 14A: INVALID_ARGUMENT com fieldViolations em "message.data.teste" -> erro de payload, token PRESERVADO!
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    const resPayload = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'INVALID_ARGUMENT',
          errorDetail: 'Field violation occurred in message.data.',
          providerResponse: {
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.BadRequest',
                  fieldViolations: [
                    {
                      field: 'message.data.invalidKey',
                      description: 'Invalid data key.',
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
    );
    assert.equal(resPayload.status, 200);
    const bodyPayload = await resPayload.json();
    assert.equal(bodyPayload.status, 'FALHA');
    assert.equal(bodyPayload.tokenInvalidated, false); // TOKEN PRESERVADO!

    const devAfterPayload = await prisma.getClient().device.findUnique({
      where: { id: scenario.device.id },
    });
    assert.equal(devAfterPayload?.active, true);
    assert.equal(devAfterPayload?.fcmToken, scenario.device.fcmToken);

    // 14B: Rejeição estruturada com fieldViolations em "message.token" e usedToken igual -> status TOKEN_INVALIDO!
    const scenarioToken = await createTestScenario('struct_tok_01');
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenarioToken.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    const resToken = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenarioToken.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenarioToken.device.fcmToken,
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'INVALID_ARGUMENT',
          errorDetail: 'Token violation.',
          providerResponse: {
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.BadRequest',
                  fieldViolations: [
                    {
                      field: 'message.token',
                      description: 'The registration token is invalid.',
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
    );
    assert.equal(resToken.status, 200);
    const bodyToken = await resToken.json();
    assert.equal(bodyToken.status, 'TOKEN_INVALIDO'); // Estado TOKEN_INVALIDO previsto no schema!
    assert.equal(bodyToken.tokenInvalidated, true);

    const devAfterToken = await prisma.getClient().device.findUnique({
      where: { id: scenarioToken.device.id },
    });
    assert.equal(devAfterToken?.active, false);
    assert.equal(devAfterToken?.fcmToken, null);
    assert.ok(devAfterToken?.invalidatedAt != null);

    // Notificação consolidada em FALHA
    assert.equal(bodyToken.notificationStatus, 'FALHA');
    const notifAfterToken = await prisma.getClient().notification.findUnique({
      where: { id: scenarioToken.notification.id },
    });
    assert.equal(notifAfterToken?.status, 'FALHA');
  });

  test('15. Revalidação de elegibilidade: se dispositivo for inativado antes do envio, prepare recusa e falha a entrega', async () => {
    const scenario = await createTestScenario('ineligible_01');

    // Desativa o dispositivo (ex: logout pelo usuário)
    await prisma.getClient().device.update({
      where: { id: scenario.device.id },
      data: { active: false, fcmToken: null, invalidatedAt: new Date() },
    });

    const res = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ready, false);
    assert.equal(body.reason, 'DEVICE_INELIGIBLE');
    assert.equal(body.status, 'FALHA');

    // Entrega no banco atualizada para FALHA
    const delivDb = await prisma.getClient().notificationDelivery.findUnique({
      where: { id: scenario.delivery.id },
    });
    assert.equal(delivDb?.status, 'FALHA');
    assert.equal(delivDb?.errorCode, 'DEVICE_INELIGIBLE');
  });

  test('16. Preservação do marcador de rotação: sobrevive a prepare real e falhas transitórias posteriores', async () => {
    const tokenT1 = 'token-rot16-T1';
    const tokenT2 = 'token-rot16-T2';
    const tokenT3 = 'token-rot16-T3';
    const scenario = await createTestScenario('rot_preserve_16', tokenT1);

    // Tentativa 1 preparada
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    // Dispositivo rotaciona para T2
    await prisma.getClient().device.update({
      where: { id: scenario.device.id },
      data: { fcmToken: tokenT2 },
    });

    // Record-result para T1 com UNREGISTERED: concede 1ª rotação
    const resRot1 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: tokenT1,
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'UNREGISTERED',
        }),
      },
    );
    assert.equal(resRot1.status, 200);
    const bodyRot1 = await resRot1.json();
    assert.equal(bodyRot1.canRetryWithNewToken, true);
    assert.equal(bodyRot1.status, 'PENDENTE');

    // Tentativa 2 é preparada chamando o endpoint REAL POST /prepare
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { lastAttemptAt: new Date(Date.now() - 30_000) },
    });

    const prepRes = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );
    assert.equal(prepRes.status, 200);
    const prepBody = await prepRes.json();
    assert.equal(prepBody.ready, true);
    assert.equal(prepBody.attemptNumber, 2);
    assert.equal(prepBody.targetToken, tokenT2);

    // Tentativa 2 sofre uma FALHA TRANSITÓRIA (ex: UNAVAILABLE)
    const resTrans = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 2,
          usedToken: tokenT2,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: 'UNAVAILABLE',
        }),
      },
    );
    assert.equal(resTrans.status, 200);
    const bodyTrans = await resTrans.json();
    assert.equal(bodyTrans.status, 'PENDENTE');

    // Agora o aplicativo tenta uma SEGUNDA rotação para T3
    await prisma.getClient().device.update({
      where: { id: scenario.device.id },
      data: { fcmToken: tokenT3 },
    });

    // Tentativa 3 preparada chamando POST /prepare após expirar backoff
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: {
        lastAttemptAt: new Date(Date.now() - 60_000),
        errorDetail: `[meta:attempt=2;retry_after_ms=20000;recorded_at=${Date.now() - 60_000};rotated=true]`,
      },
    });

    const prep3Res = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/prepare`,
      {
        method: 'POST',
        headers: { 'X-Internal-Service-Key': TEST_SERVICE_KEY },
      },
    );
    assert.equal(prep3Res.status, 200);
    const prep3Body = await prep3Res.json();
    assert.equal(prep3Body.ready, true);
    assert.equal(prep3Body.attemptNumber, 3);
    assert.equal(prep3Body.targetToken, tokenT3);

    // Tentativa 3 reporta erro de token com token antigo (tentando segunda rotação):
    // Como a entrega já utilizou sua cota de rotação, a segunda rotação NÃO É PERMITIDA!
    const resRot2 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 3,
          usedToken: 'token-antigo-diferente',
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'UNREGISTERED',
        }),
      },
    );
    assert.equal(resRot2.status, 200);
    const bodyRot2 = await resRot2.json();
    assert.equal(bodyRot2.status, 'FALHA');
    assert.equal(bodyRot2.canRetryWithNewToken, false);
    assert.equal(bodyRot2.errorCode, 'TOKEN_ROTATION_LIMIT_EXCEEDED');

    // Dispositivo permanece ativo com tokenT3 intacto
    const devDb = await prisma.getClient().device.findUnique({
      where: { id: scenario.device.id },
    });
    assert.equal(devDb?.active, true);
    assert.equal(devDb?.fcmToken, tokenT3);
  });

  test('17. Idempotência de resultado corrente: repetição de falha e rotação não recalcula prazo nem queima rotação', async () => {
    // 17A: Falha transitória repetida
    const scenario = await createTestScenario('dup_curr_17');
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    const res1 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: '429',
        }),
      },
    );
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.duplicate, false);
    assert.equal(body1.backoffDelayMs, 60_000);
    const originalNextAt = body1.nextAttemptAllowedAt;

    // Repete exatamente a mesma chamada de record-result para a tentativa 1
    const res2 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'TRANSIENT_FAILURE',
          errorCode: '429',
        }),
      },
    );
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.duplicate, true);
    assert.equal(body2.backoffDelayMs, 60_000);
    assert.equal(body2.nextAttemptAllowedAt, originalNextAt);

    // 17B: Rotação repetida para a mesma tentativa 1
    const scenarioRot = await createTestScenario('dup_rot_17', 'token-17-A');
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenarioRot.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });
    await prisma.getClient().device.update({
      where: { id: scenarioRot.device.id },
      data: { fcmToken: 'token-17-B' },
    });

    const resRotCall1 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenarioRot.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: 'token-17-A',
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'UNREGISTERED',
        }),
      },
    );
    assert.equal(resRotCall1.status, 200);
    const bodyRotCall1 = await resRotCall1.json();
    assert.equal(bodyRotCall1.status, 'PENDENTE');
    assert.equal(bodyRotCall1.canRetryWithNewToken, true);

    // Reenvia a mesma chamada de rotação: deve retornar duplicata e NÃO falhar a entrega!
    const resRotCall2 = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenarioRot.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: 'token-17-A',
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'UNREGISTERED',
        }),
      },
    );
    assert.equal(resRotCall2.status, 200);
    const bodyRotCall2 = await resRotCall2.json();
    assert.equal(bodyRotCall2.duplicate, true);
    assert.equal(bodyRotCall2.status, 'PENDENTE');
    assert.equal(bodyRotCall2.canRetryWithNewToken, true);
  });

  test('18. Precedência de ACCEPTED: resultado UNKNOWN seguido de ACCEPTED na mesma tentativa é aceito', async () => {
    const scenario = await createTestScenario('unk_then_acc_18');
    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    // 1º Envio: Timeout / resultado desconhecido na tentativa 1
    const resUnk = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'UNKNOWN',
          errorCode: 'TIMEOUT',
          errorDetail: 'Timeout aguardando socket FCM.',
        }),
      },
    );
    assert.equal(resUnk.status, 200);
    const bodyUnk = await resUnk.json();
    assert.equal(bodyUnk.status, 'PENDENTE');
    assert.equal(bodyUnk.errorCode, 'TIMEOUT');

    // 2º Envio: Webhook ou resposta atrasada do FCM confirma aceite legítimo na MESMA tentativa 1
    const fcmMessageId = 'projects/poolsafe-1f0db/messages/late-after-timeout';
    const resAcc = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: scenario.device.fcmToken,
          resultType: 'ACCEPTED',
          fcmMessageId,
        }),
      },
    );
    assert.equal(resAcc.status, 200);
    const bodyAcc = await resAcc.json();
    assert.equal(bodyAcc.status, 'ENVIADA');
    assert.equal(bodyAcc.fcmMessageId, fcmMessageId);
    assert.equal(bodyAcc.notificationStatus, 'PROCESSADA');

    // Confirma no banco de dados
    const dbDelivery = await prisma.getClient().notificationDelivery.findUnique({
      where: { id: scenario.delivery.id },
    });
    assert.equal(dbDelivery?.status, 'ENVIADA');
    assert.equal(dbDelivery?.fcmMessageId, fcmMessageId);
    assert.ok(dbDelivery?.sentAt != null);
  });

  test('19. Invalidação atômica: atualização concorrente de token no dispositivo impede deleção indevida', async () => {
    const tokenOriginal = 'token-original-19';
    const tokenNovoConcorrente = 'token-novo-concorrente-19';
    const scenario = await createTestScenario('atomic_inval_19', tokenOriginal);

    await prisma.getClient().notificationDelivery.update({
      where: { id: scenario.delivery.id },
      data: { attempts: 1, lastAttemptAt: new Date() },
    });

    // Simula transação concorrente de login no app que atualizou o token do dispositivo antes de record-result
    await prisma.getClient().device.update({
      where: { id: scenario.device.id },
      data: { active: true, fcmToken: tokenNovoConcorrente },
    });

    // Agora chega record-result informando que tokenOriginal é UNREGISTERED
    const res = await fetch(
      `${baseUrl}/api/v1/internal/deliveries/${scenario.delivery.id}/record-result`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': TEST_SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptNumber: 1,
          usedToken: tokenOriginal,
          resultType: 'TERMINAL_FAILURE',
          errorCode: 'UNREGISTERED',
        }),
      },
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    // A API detecta que o token do dispositivo mudou, preserva o token novo e concede rotação
    assert.equal(body.status, 'PENDENTE');
    assert.equal(body.canRetryWithNewToken, true);
    assert.equal(body.tokenInvalidated, false);

    // O token novo no dispositivo permaneceu estritamente INTACTO e ATIVO
    const devDb = await prisma.getClient().device.findUnique({
      where: { id: scenario.device.id },
    });
    assert.equal(devDb?.active, true);
    assert.equal(devDb?.fcmToken, tokenNovoConcorrente);
    assert.equal(devDb?.invalidatedAt, null);
  });
});
