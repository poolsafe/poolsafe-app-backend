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
    where: { email: { startsWith: 'test.cam.' } },
    select: { id: true },
  });
  const userIds = testUsers.map((u) => u.id);

  const testCameras = await client.camera.findMany({
    where: { integrationCode: { startsWith: 'test.cam.' } },
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

    await client.alertEvidence.deleteMany({
      where: {
        alert: {
          OR: [
            { cameraId: { in: cameraIds } },
            { eventKey: { startsWith: 'test.cam.' } },
          ],
        },
      },
    });

    await client.alert.deleteMany({
      where: {
        OR: [
          { cameraId: { in: cameraIds } },
          { eventKey: { startsWith: 'test.cam.' } },
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

    const addr = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

    prisma = app.get(PrismaService);

    await cleanupTestData();
  } catch (err) {
    console.error('ERROR IN BEFORE:', err);
    throw err;
  }
});

after(async () => {
  await cleanupTestData();
  if (app) {
    await app.close();
  }
});

describe('Fatia 5 — Câmeras autorizadas (GET /api/v1/cameras e /cameras/{cameraId})', () => {
  async function createTestUser(emailSuffix: string) {
    const email = `test.cam.${emailSuffix}@example.com`;
    const password = 'PasswordCam123!';
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

  test('1. Requisições sem autenticação retornam 401 Problem Details', async () => {
    const listRes = await fetch(`${baseUrl}/cameras`);
    assert.equal(listRes.status, 401);
    const listJson = (await listRes.json()) as any;
    assert.equal(listJson.code, 'AUTHENTICATION_REQUIRED');

    const detailRes = await fetch(`${baseUrl}/cameras/123`);
    assert.equal(detailRes.status, 401);
    const detailJson = (await detailRes.json()) as any;
    assert.equal(detailJson.code, 'AUTHENTICATION_REQUIRED');
  });

  test('2. Usuário sem câmeras autorizadas recebe lista vazia data: []', async () => {
    const { tokens } = await createTestUser('nocam');

    const res = await fetch(`${baseUrl}/cameras`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as any;
    assert.deepEqual(json.data, []);
    assert.ok(json.meta?.requestId);
  });

  test('3. Listagem retorna apenas câmeras autorizadas com acesso ativo e dados calculados corretos', async () => {
    const userA = await createTestUser('user-a');
    const userB = await createTestUser('user-b');
    const client = prisma.getClient();
    const now = new Date();

    // Cria câmeras para usuário A
    const camOnline = await client.camera.create({
      data: {
        integrationCode: `test.cam.online.${userA.user.id}`,
        name: 'Piscina Principal',
        location: 'Área externa',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: now,
      },
    });

    const camOffline = await client.camera.create({
      data: {
        integrationCode: `test.cam.offline.${userA.user.id}`,
        name: 'Deck e Prainha',
        location: 'Área externa sul',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: new Date(now.getTime() - 150_000), // 150s atrás (> 90s)
      },
    });

    const camUnknown = await client.camera.create({
      data: {
        integrationCode: `test.cam.unknown.${userA.user.id}`,
        name: 'Área Gourmet',
        location: null,
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: null,
      },
    });

    // Câmera do usuário B (não deve aparecer para usuário A)
    const camUserB = await client.camera.create({
      data: {
        integrationCode: `test.cam.userb.${userB.user.id}`,
        name: 'Câmera Exclusiva User B',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: now,
      },
    });

    // Concede acesso ativo às câmeras do Usuário A
    await client.cameraAccess.createMany({
      data: [
        { userId: BigInt(userA.user.id), cameraId: camOnline.id, active: true },
        { userId: BigInt(userA.user.id), cameraId: camOffline.id, active: true },
        { userId: BigInt(userA.user.id), cameraId: camUnknown.id, active: true },
        { userId: BigInt(userB.user.id), cameraId: camUserB.id, active: true },
      ],
    });

    // Cria sessão de monitoramento para camOnline
    const monitoring = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: BigInt(userA.user.id),
      },
    });
    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoring.id,
        cameraId: camOnline.id,
      },
    });

    // Faz a consulta
    const res = await fetch(`${baseUrl}/cameras`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as any;

    assert.equal(json.data.length, 3, 'Deve retornar exatamente as 3 câmeras do Usuário A');

    // Validação de ordenação estável por nome (Área Gourmet, Deck e Prainha, Piscina Principal)
    assert.equal(json.data[0].name, 'Área Gourmet');
    assert.equal(json.data[0].connectionStatus, 'DESCONHECIDA');
    assert.equal(json.data[0].location, null);
    assert.equal(json.data[0].lastCommunicationAt, null);
    assert.equal(json.data[0].currentMonitoring, null);

    assert.equal(json.data[1].name, 'Deck e Prainha');
    assert.equal(json.data[1].connectionStatus, 'OFFLINE');
    assert.ok(json.data[1].lastCommunicationAt);

    assert.equal(json.data[2].name, 'Piscina Principal');
    assert.equal(json.data[2].connectionStatus, 'ONLINE');
    assert.ok(json.data[2].currentMonitoring);
    assert.equal(json.data[2].currentMonitoring.status, 'ATIVO');
    assert.equal(json.data[2].currentMonitoring.operationalStatus, 'ATIVO');

    // Isolamento: confirma que câmera de B não está presente
    const ids = json.data.map((c: any) => c.id);
    assert.ok(!ids.includes(camUserB.id.toString()));
  });

  test('4. GET /cameras/:cameraId retorna 404 RESOURCE_NOT_FOUND para ID inexistente ou sem autorização', async () => {
    const userA = await createTestUser('404-a');
    const userB = await createTestUser('404-b');
    const client = prisma.getClient();

    // Câmera associada apenas a User B
    const camB = await client.camera.create({
      data: {
        integrationCode: `test.cam.404.${userB.user.id}`,
        name: 'Piscina B',
        administrativeStatus: 'ATIVA',
      },
    });
    await client.cameraAccess.create({
      data: {
        userId: BigInt(userB.user.id),
        cameraId: camB.id,
        active: true,
      },
    });

    // 1. User A tentando acessar câmera de B
    const resForbidden = await fetch(`${baseUrl}/cameras/${camB.id}`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(resForbidden.status, 404, 'Sem autorização deve retornar 404');
    const jsonForbidden = (await resForbidden.json()) as any;
    assert.equal(jsonForbidden.code, 'RESOURCE_NOT_FOUND');

    // 2. ID que não existe no banco
    const resNotFound = await fetch(`${baseUrl}/cameras/999999999`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(resNotFound.status, 404);
    const jsonNotFound = (await resNotFound.json()) as any;
    assert.equal(jsonNotFound.code, 'RESOURCE_NOT_FOUND');

    // 3. ID inválido (não numérico)
    const resInvalid = await fetch(`${baseUrl}/cameras/abc-not-number`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(resInvalid.status, 404);
    const jsonInvalid = (await resInvalid.json()) as any;
    assert.equal(jsonInvalid.code, 'RESOURCE_NOT_FOUND');
  });

  test('5. GET /cameras/:cameraId retorna 404 se o acesso foi revogado (active: false)', async () => {
    const user = await createTestUser('revoked');
    const client = prisma.getClient();

    const cam = await client.camera.create({
      data: {
        integrationCode: `test.cam.revoked.${user.user.id}`,
        name: 'Piscina Antiga',
        administrativeStatus: 'ATIVA',
      },
    });
    await client.cameraAccess.create({
      data: {
        userId: BigInt(user.user.id),
        cameraId: cam.id,
        active: false,
        grantedAt: new Date(Date.now() - 60_000),
        revokedAt: new Date(),
      },
    });

    const res = await fetch(`${baseUrl}/cameras/${cam.id}`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(res.status, 404);
    const json = (await res.json()) as any;
    assert.equal(json.code, 'RESOURCE_NOT_FOUND');
  });

  test('6. Detalhe da câmera retorna até 30 alertas ordenados e filtrados por destinatário', async () => {
    const userA = await createTestUser('alerts-a');
    const userB = await createTestUser('alerts-b');
    const client = prisma.getClient();
    const now = new Date();

    const cam = await client.camera.create({
      data: {
        integrationCode: `test.cam.alerts.${userA.user.id}`,
        name: 'Piscina Olímpica',
        location: 'Clube',
        administrativeStatus: 'ATIVA',
        lastCommunicationAt: now,
      },
    });

    await client.cameraAccess.create({
      data: {
        userId: BigInt(userA.user.id),
        cameraId: cam.id,
        active: true,
      },
    });

    const monitoring = await client.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: BigInt(userA.user.id),
      },
    });
    await client.monitoringCamera.create({
      data: {
        monitoringId: monitoring.id,
        cameraId: cam.id,
      },
    });

    // Cria 35 alertas para a câmera em momentos decrescentes
    for (let i = 1; i <= 35; i++) {
      const detectedAt = new Date(now.getTime() - i * 60_000); // 1 min, 2 min, etc
      const alert = await client.alert.create({
        data: {
          eventKey: `test.cam.alert.${userA.user.id}.${i}`,
          monitoringId: monitoring.id,
          cameraId: cam.id,
          type: 'POSSIVEL_RISCO',
          severity: i % 2 === 0 ? 'CRITICA' : 'ATENCAO',
          detectedAt,
        },
      });

      // No alerta 1 (mais recente), cria evidência disponível
      if (i === 1) {
        await client.alertEvidence.create({
          data: {
            alertId: alert.id,
            mimeType: 'image/jpeg',
            content: Buffer.from('fake image content'),
            sizeBytes: BigInt(1024),
            hashSha256: 'a'.repeat(64),
            expiresAt: new Date(now.getTime() + 86400_000), // expira em 1 dia
            removedAt: null,
          },
        });
      }

      // No alerta 2, cria evidência já removida
      if (i === 2) {
        await client.alertEvidence.create({
          data: {
            alertId: alert.id,
            mimeType: 'image/jpeg',
            content: null,
            sizeBytes: BigInt(1024),
            hashSha256: 'b'.repeat(64),
            expiresAt: new Date(now.getTime() + 86400_000),
            removedAt: new Date(),
          },
        });
      }

      // Se i === 35, vincula APENAS ao User B (destinatário não é User A)
      if (i === 35) {
        await client.alertRecipient.create({
          data: {
            alertId: alert.id,
            userId: BigInt(userB.user.id),
          },
        });
      } else {
        // Vincula a User A
        await client.alertRecipient.create({
          data: {
            alertId: alert.id,
            userId: BigInt(userA.user.id),
          },
        });
      }
    }

    const res = await fetch(`${baseUrl}/cameras/${cam.id}`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as any;
    const data = json.data;

    assert.equal(data.id, cam.id.toString());
    assert.equal(data.name, 'Piscina Olímpica');
    assert.equal(data.location, 'Clube');
    assert.equal(data.administrativeStatus, 'ATIVA');
    assert.equal(data.connectionStatus, 'ONLINE');
    assert.ok(data.currentMonitoring);
    assert.equal(data.currentMonitoring.status, 'ATIVO');
    assert.equal(data.currentMonitoring.operationalStatus, 'ATIVO');

    // User A é destinatário de 34 alertas (35 menos o atribuído apenas a User B)
    assert.equal(data.recentAlertsCount, 34, 'recentAlertsCount deve contabilizar apenas alertas do destinatário');

    // recentAlerts tem limite máximo de 30
    assert.equal(data.recentAlerts.length, 30, 'Deve limitar em no máximo 30 alertas');

    // Valida ordenação decrescente por detectedAt
    for (let i = 0; i < data.recentAlerts.length - 1; i++) {
      const t1 = new Date(data.recentAlerts[i].detectedAt).getTime();
      const t2 = new Date(data.recentAlerts[i + 1].detectedAt).getTime();
      assert.ok(t1 >= t2, `Alertas devem estar em ordem decrescente de data: ${t1} >= ${t2}`);
    }

    // Alerta 1 tem evidência disponível (true)
    assert.equal(data.recentAlerts[0].evidenceAvailable, true);

    // Alerta 2 tem evidência removida (false)
    assert.equal(data.recentAlerts[1].evidenceAvailable, false);

    // Alerta sem evidência cadastrada tem false
    assert.equal(data.recentAlerts[2].evidenceAvailable, false);

    // Sem vazamento de campos técnicos
    assert.equal(data.ip, undefined);
    assert.equal(data.streamUrl, undefined);
    assert.equal(data.rtsp, undefined);
  });
});
