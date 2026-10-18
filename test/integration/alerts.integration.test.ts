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
    where: { email: { startsWith: 'test.alert.' } },
    select: { id: true },
  });
  const userIds = testUsers.map((u) => u.id);

  const testCameras = await client.camera.findMany({
    where: { integrationCode: { startsWith: 'test.alert.' } },
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
            { eventKey: { startsWith: 'test.alert.' } },
          ],
        },
      },
    });

    await client.alert.deleteMany({
      where: {
        OR: [
          { cameraId: { in: cameraIds } },
          { eventKey: { startsWith: 'test.alert.' } },
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
    console.error('ERROR IN BEFORE ALERTS:', err);
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
    console.error('ERROR IN AFTER ALERTS:', err);
    throw err;
  }
});

describe('Fatia 7 — Histórico, alertas e evidências', () => {
  async function createTestUser(emailSuffix: string) {
    const email = `test.alert.${emailSuffix}@example.com`;
    const password = 'PasswordAlert123!';
    const name = `Usuário Alerta ${emailSuffix}`;

    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        password,
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
      }),
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
    const listRes = await fetch(`${baseUrl}/alerts`);
    assert.equal(listRes.status, 401);
    const listJson = (await listRes.json()) as any;
    assert.equal(listJson.code, 'AUTHENTICATION_REQUIRED');

    const detailRes = await fetch(`${baseUrl}/alerts/123`);
    assert.equal(detailRes.status, 401);
    const detailJson = (await detailRes.json()) as any;
    assert.equal(detailJson.code, 'AUTHENTICATION_REQUIRED');

    const evidenceRes = await fetch(`${baseUrl}/alerts/123/evidence`);
    assert.equal(evidenceRes.status, 401);
    const evidenceJson = (await evidenceRes.json()) as any;
    assert.equal(evidenceJson.code, 'AUTHENTICATION_REQUIRED');
  });

  test('2. Paginação estável, ordenação detectedAt DESC e id DESC, limite padrão e cursor opaco', async () => {
    const client = prisma.getClient();
    const userA = await createTestUser('user_pagination');
    const userBigInt = BigInt(userA.user.id);
    const now = new Date();

    // Cria câmera e monitoramento
    const camera = await client.camera.create({
      data: {
        integrationCode: `test.alert.cam.pag.${randomUUID()}`,
        name: 'Câmera Paginação',
        location: 'Área Teste',
      },
    });

    const monitoring = await client.monitoring.create({
      data: {
        startedByUserId: userBigInt,
        status: 'ATIVO',
      },
    });
    await client.monitoringCamera.create({
      data: { monitoringId: monitoring.id, cameraId: camera.id },
    });

    // Cria 25 alertas com timestamps decrescentes
    const createdAlerts = [];
    for (let i = 1; i <= 25; i++) {
      const detectedAt = new Date(now.getTime() - i * 60_000);
      const alert = await client.alert.create({
        data: {
          eventKey: `test.alert.evt.${randomUUID()}`,
          monitoringId: monitoring.id,
          cameraId: camera.id,
          type: 'POSSIVEL_RISCO',
          severity: i % 2 === 0 ? 'CRITICA' : 'ATENCAO',
          detectedAt,
        },
      });
      await client.alertRecipient.create({
        data: { alertId: alert.id, userId: userBigInt },
      });
      createdAlerts.push(alert);
    }

    // Página 1: limit padrão deve ser 20
    const page1Res = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(page1Res.status, 200);
    const page1Json = (await page1Res.json()) as any;

    assert.equal(page1Json.data.length, 20, 'Página 1 deve conter 20 alertas (limite padrão)');
    assert.equal(page1Json.pagination.hasMore, true, 'hasMore deve ser true');
    assert.ok(page1Json.pagination.nextCursor, 'nextCursor deve existir');

    // Verifica ordenação decrescente na página 1
    for (let j = 0; j < page1Json.data.length - 1; j++) {
      const d1 = new Date(page1Json.data[j].detectedAt).getTime();
      const d2 = new Date(page1Json.data[j + 1].detectedAt).getTime();
      assert.ok(d1 >= d2, 'Alertas devem estar ordenados por detectedAt DESC');
    }

    // Página 2: usando nextCursor
    const page2Res = await fetch(
      `${baseUrl}/alerts?cursor=${encodeURIComponent(page1Json.pagination.nextCursor)}`,
      {
        headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
      },
    );
    assert.equal(page2Res.status, 200);
    const page2Json = (await page2Res.json()) as any;

    assert.equal(page2Json.data.length, 5, 'Página 2 deve conter os 5 alertas restantes');
    assert.equal(page2Json.pagination.hasMore, false, 'hasMore da página 2 deve ser false');
    assert.equal(page2Json.pagination.nextCursor, null, 'nextCursor da última página deve ser null');

    // Validação de não duplicidade entre as páginas
    const page1Ids = new Set(page1Json.data.map((a: any) => a.id));
    for (const a of page2Json.data) {
      assert.ok(!page1Ids.has(a.id), `Alerta #${a.id} não pode aparecer em ambas as páginas`);
    }

    // Validação de limite máximo: limit=50 deve funcionar; limit=51 deve retornar 422
    const maxRes = await fetch(`${baseUrl}/alerts?limit=50`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(maxRes.status, 200);
    const maxJson = (await maxRes.json()) as any;
    assert.equal(maxJson.data.length, 25);

    const exceedRes = await fetch(`${baseUrl}/alerts?limit=51`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(exceedRes.status, 422, 'limit > 50 deve retornar 422');
  });

  test('3. Cursor inválido ou adulterado retorna 400 MALFORMED_REQUEST', async () => {
    const user = await createTestUser('cursor_tamper');

    // Cursor adulterado (muda parte da string base64)
    const tamperedRes = await fetch(`${baseUrl}/alerts?cursor=invalid_tampered_cursor_12345`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(tamperedRes.status, 400);
    const tamperedJson = (await tamperedRes.json()) as any;
    assert.equal(tamperedJson.code, 'MALFORMED_REQUEST');
  });

  test('4. Paginação sem duplicidade ou salto quando dois alertas possuem exatamente o mesmo detectedAt', async () => {
    const client = prisma.getClient();
    const user = await createTestUser('same_detected_at');
    const userBigInt = BigInt(user.user.id);

    const camera = await client.camera.create({
      data: {
        integrationCode: `test.alert.cam.same.${randomUUID()}`,
        name: 'Câmera Mesma Data',
      },
    });

    const monitoring = await client.monitoring.create({
      data: { startedByUserId: userBigInt, status: 'ATIVO' },
    });
    await client.monitoringCamera.create({
      data: { monitoringId: monitoring.id, cameraId: camera.id },
    });

    const sameTime = new Date('2026-09-20T12:00:00.000Z');

    // Cria 4 alertas com a mesma data exata
    const a1 = await client.alert.create({
      data: {
        eventKey: `test.alert.same.1.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: sameTime,
      },
    });
    const a2 = await client.alert.create({
      data: {
        eventKey: `test.alert.same.2.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: sameTime,
      },
    });
    const a3 = await client.alert.create({
      data: {
        eventKey: `test.alert.same.3.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: sameTime,
      },
    });
    const a4 = await client.alert.create({
      data: {
        eventKey: `test.alert.same.4.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: sameTime,
      },
    });

    for (const a of [a1, a2, a3, a4]) {
      await client.alertRecipient.create({
        data: { alertId: a.id, userId: userBigInt },
      });
    }

    // Consulta com limit=2: deve trazer os dois maiores IDs
    const p1Res = await fetch(`${baseUrl}/alerts?limit=2`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(p1Res.status, 200);
    const p1 = (await p1Res.json()) as any;
    assert.equal(p1.data.length, 2);
    assert.ok(p1.pagination.nextCursor);

    // Consulta página 2 com o cursor retornado
    const p2Res = await fetch(
      `${baseUrl}/alerts?limit=2&cursor=${encodeURIComponent(p1.pagination.nextCursor)}`,
      {
        headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
      },
    );
    assert.equal(p2Res.status, 200);
    const p2 = (await p2Res.json()) as any;
    assert.equal(p2.data.length, 2);

    // Garante que todos os 4 alertas foram retornados sem duplicata ou omissão
    const allIds = [...p1.data.map((x: any) => x.id), ...p2.data.map((x: any) => x.id)];
    const uniqueIds = new Set(allIds);
    assert.equal(uniqueIds.size, 4, 'Todos os 4 alertas devem ser entregues sem duplicidade');
  });

  test('5. Isolamento por alerta_destinatario (alertas de outro usuário não aparecem)', async () => {
    const client = prisma.getClient();
    const userA = await createTestUser('iso_a');
    const userB = await createTestUser('iso_b');

    const camera = await client.camera.create({
      data: {
        integrationCode: `test.alert.cam.iso.${randomUUID()}`,
        name: 'Câmera Isolamento',
      },
    });

    const monitoring = await client.monitoring.create({
      data: { startedByUserId: BigInt(userA.user.id), status: 'ATIVO' },
    });
    await client.monitoringCamera.create({
      data: { monitoringId: monitoring.id, cameraId: camera.id },
    });

    // Alerta atribuído somente ao Usuário B
    const alertB = await client.alert.create({
      data: {
        eventKey: `test.alert.iso.b.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: new Date(),
      },
    });
    await client.alertRecipient.create({
      data: { alertId: alertB.id, userId: BigInt(userB.user.id) },
    });

    // Usuário A consulta alertas: deve vir vazio
    const resA = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(resA.status, 200);
    const jsonA = (await resA.json()) as any;
    assert.equal(jsonA.data.length, 0, 'Usuário A não deve ver alertas do Usuário B');

    // Usuário B consulta alertas: deve ver o alerta dele
    const resB = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${userB.tokens.accessToken}` },
    });
    assert.equal(resB.status, 200);
    const jsonB = (await resB.json()) as any;
    assert.equal(jsonB.data.length, 1);
    assert.equal(jsonB.data[0].id, alertB.id.toString());
  });

  test('6. Preservação histórica do alerta após revogação do acesso à câmera', async () => {
    const client = prisma.getClient();
    const user = await createTestUser('revoked_cam');
    const userBigInt = BigInt(user.user.id);

    const camera = await client.camera.create({
      data: {
        integrationCode: `test.alert.cam.rev.${randomUUID()}`,
        name: 'Câmera de Acesso Revogado',
      },
    });

    // Acesso revogado posteriormente
    await client.cameraAccess.create({
      data: {
        userId: userBigInt,
        cameraId: camera.id,
        active: false,
        grantedAt: new Date(Date.now() - 3600_000),
        revokedAt: new Date(),
      },
    });

    const monitoring = await client.monitoring.create({
      data: { startedByUserId: userBigInt, status: 'ATIVO' },
    });
    await client.monitoringCamera.create({
      data: { monitoringId: monitoring.id, cameraId: camera.id },
    });

    const alert = await client.alert.create({
      data: {
        eventKey: `test.alert.rev.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: new Date(),
      },
    });
    await client.alertRecipient.create({
      data: { alertId: alert.id, userId: userBigInt },
    });

    // Mesmo com o acesso à câmera revogado, o alerta permanece acessível no histórico
    const res = await fetch(`${baseUrl}/alerts`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as any;
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].id, alert.id.toString());
    assert.equal(json.data[0].camera.id, camera.id.toString());
  });

  test('7. Filtros do contrato: severity, cameraId, from e to', async () => {
    const client = prisma.getClient();
    const user = await createTestUser('filters_test');
    const userBigInt = BigInt(user.user.id);

    const cam1 = await client.camera.create({
      data: { integrationCode: `test.alert.filt.1.${randomUUID()}`, name: 'Cam 1' },
    });
    const cam2 = await client.camera.create({
      data: { integrationCode: `test.alert.filt.2.${randomUUID()}`, name: 'Cam 2' },
    });

    const monitoring = await client.monitoring.create({
      data: { startedByUserId: userBigInt, status: 'ATIVO' },
    });
    await client.monitoringCamera.createMany({
      data: [
        { monitoringId: monitoring.id, cameraId: cam1.id },
        { monitoringId: monitoring.id, cameraId: cam2.id },
      ],
    });

    const d1 = new Date('2026-09-10T10:00:00.000Z');
    const d2 = new Date('2026-09-15T10:00:00.000Z');

    const a1 = await client.alert.create({
      data: {
        eventKey: `test.alert.filt.a1.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: cam1.id,
        severity: 'ATENCAO',
        detectedAt: d1,
      },
    });
    const a2 = await client.alert.create({
      data: {
        eventKey: `test.alert.filt.a2.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: cam2.id,
        severity: 'CRITICA',
        detectedAt: d2,
      },
    });

    for (const a of [a1, a2]) {
      await client.alertRecipient.create({
        data: { alertId: a.id, userId: userBigInt },
      });
    }

    // Filtro por severidade ATENCAO
    const resSev = await fetch(`${baseUrl}/alerts?severity=ATENCAO`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(resSev.status, 200);
    const jsonSev = (await resSev.json()) as any;
    assert.equal(jsonSev.data.length, 1);
    assert.equal(jsonSev.data[0].id, a1.id.toString());

    // Filtro por cameraId
    const resCam = await fetch(`${baseUrl}/alerts?cameraId=${cam2.id}`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(resCam.status, 200);
    const jsonCam = (await resCam.json()) as any;
    assert.equal(jsonCam.data.length, 1);
    assert.equal(jsonCam.data[0].id, a2.id.toString());

    // Filtro por intervalo de datas (from / to)
    const resDate = await fetch(
      `${baseUrl}/alerts?from=2026-09-14T00:00:00.000Z&to=2026-09-16T00:00:00.000Z`,
      {
        headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
      },
    );
    assert.equal(resDate.status, 200);
    const jsonDate = (await resDate.json()) as any;
    assert.equal(jsonDate.data.length, 1);
    assert.equal(jsonDate.data[0].id, a2.id.toString());

    // Intervalo inválido (to anterior a from) deve retornar 422
    const resInvalidDate = await fetch(
      `${baseUrl}/alerts?from=2026-09-20T00:00:00.000Z&to=2026-09-10T00:00:00.000Z`,
      {
        headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
      },
    );
    assert.equal(resInvalidDate.status, 422);
  });

  test('8. Detalhe autorizado de alerta (GET /alerts/{alertId}) e 404 indistinguível para não autorizado', async () => {
    const client = prisma.getClient();
    const userA = await createTestUser('detail_a');
    const userB = await createTestUser('detail_b');

    const camera = await client.camera.create({
      data: {
        integrationCode: `test.alert.cam.det.${randomUUID()}`,
        name: 'Piscina Principal',
        location: 'Área externa',
      },
    });

    const monitoring = await client.monitoring.create({
      data: { startedByUserId: BigInt(userA.user.id), status: 'ATIVO' },
    });
    await client.monitoringCamera.create({
      data: { monitoringId: monitoring.id, cameraId: camera.id },
    });

    const alert = await client.alert.create({
      data: {
        eventKey: `test.alert.det.evt.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        type: 'POSSIVEL_RISCO',
        severity: 'CRITICA',
        detectedAt: new Date('2026-09-18T22:27:10.000Z'),
        confidence: 0.89,
        modelVersion: 'yolo-secret',
        technicalData: { internal: 'confidential' },
      },
    });

    await client.alertRecipient.create({
      data: { alertId: alert.id, userId: BigInt(userA.user.id) },
    });

    // Detalhe autorizado para Usuário A
    const detailRes = await fetch(`${baseUrl}/alerts/${alert.id}`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as any;

    assert.equal(detailJson.data.id, alert.id.toString());
    assert.equal(detailJson.data.type, 'POSSIVEL_RISCO');
    assert.equal(detailJson.data.severity, 'CRITICA');
    assert.equal(detailJson.data.camera.name, 'Piscina Principal');
    assert.equal(detailJson.data.camera.location, 'Área externa');
    assert.equal(detailJson.data.monitoringId, monitoring.id.toString());
    assert.equal(detailJson.data.evidence.available, false);
    assert.equal(detailJson.data.evidence.unavailableReason, 'NOT_CAPTURED');

    // Validação estrita: ausência de exposição de dados técnicos internos
    assert.equal(detailJson.data.confidence, undefined, 'Não deve expor confiança');
    assert.equal(detailJson.data.modelVersion, undefined, 'Não deve expor versão do modelo');
    assert.equal(detailJson.data.technicalData, undefined, 'Não deve expor dados técnicos');
    assert.equal(detailJson.data.eventKey, undefined, 'Não deve expor eventKey interna');
    assert.equal(detailJson.data.viewed, undefined, 'Não deve conter campo viewed');

    // Usuário B tenta acessar alerta do Usuário A: retorna 404 indistinguível
    const forbiddenRes = await fetch(`${baseUrl}/alerts/${alert.id}`, {
      headers: { Authorization: `Bearer ${userB.tokens.accessToken}` },
    });
    assert.equal(forbiddenRes.status, 404, 'Deve retornar 404 sem revelar a existência');
    const forbiddenJson = (await forbiddenRes.json()) as any;
    assert.equal(forbiddenJson.code, 'RESOURCE_NOT_FOUND');

    // Alerta inexistente: retorna o mesmo 404
    const notFoundRes = await fetch(`${baseUrl}/alerts/999999999`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(notFoundRes.status, 404);
  });

  test('9. Evidência disponível (GET /alerts/{alertId}/evidence): 200 OK com headers de segurança', async () => {
    const client = prisma.getClient();
    const user = await createTestUser('evidence_avail');
    const userBigInt = BigInt(user.user.id);

    const camera = await client.camera.create({
      data: { integrationCode: `test.alert.cam.evi.${randomUUID()}`, name: 'Cam Evi' },
    });
    const monitoring = await client.monitoring.create({
      data: { startedByUserId: userBigInt, status: 'ATIVO' },
    });
    await client.monitoringCamera.create({
      data: { monitoringId: monitoring.id, cameraId: camera.id },
    });

    const alert = await client.alert.create({
      data: {
        eventKey: `test.alert.evi.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: new Date(),
      },
    });
    await client.alertRecipient.create({
      data: { alertId: alert.id, userId: userBigInt },
    });

    const fakeJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    await client.alertEvidence.create({
      data: {
        alertId: alert.id,
        mimeType: 'image/jpeg',
        content: fakeJpegBytes,
        sizeBytes: BigInt(fakeJpegBytes.length),
        hashSha256: 'f'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000), // expira amanhã
      },
    });

    const res = await fetch(`${baseUrl}/alerts/${alert.id}/evidence`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(res.status, 200);

    // Validação dos headers de segurança obrigatórios
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.ok(
      res.headers.get('content-disposition')?.includes('inline'),
      'Content-Disposition deve ser inline',
    );
    assert.ok(
      res.headers.get('cache-control')?.includes('private, no-store'),
      'Cache-Control deve ser private, no-store',
    );
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

    const bodyBytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(bodyBytes, fakeJpegBytes, 'Bytes retornados devem ser idênticos aos armazenados');
  });

  test('10. Evidência ausente (404 EVIDENCE_NOT_FOUND), expirada (410) e removida (410)', async () => {
    const client = prisma.getClient();
    const user = await createTestUser('evidence_states');
    const userBigInt = BigInt(user.user.id);

    const camera = await client.camera.create({
      data: { integrationCode: `test.alert.cam.est.${randomUUID()}`, name: 'Cam States' },
    });
    const monitoring = await client.monitoring.create({
      data: { startedByUserId: userBigInt, status: 'ATIVO' },
    });
    await client.monitoringCamera.create({
      data: { monitoringId: monitoring.id, cameraId: camera.id },
    });

    // 1. Alerta sem evidência capturada
    const alertNoEvi = await client.alert.create({
      data: {
        eventKey: `test.alert.noevi.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'ATENCAO',
        detectedAt: new Date(),
      },
    });
    await client.alertRecipient.create({
      data: { alertId: alertNoEvi.id, userId: userBigInt },
    });

    const noEviRes = await fetch(`${baseUrl}/alerts/${alertNoEvi.id}/evidence`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(noEviRes.status, 404);
    const noEviJson = (await noEviRes.json()) as any;
    assert.equal(noEviJson.code, 'EVIDENCE_NOT_FOUND');

    // 2. Alerta com evidência expirada (mesmo com bytes ainda físicos no banco)
    const alertExpired = await client.alert.create({
      data: {
        eventKey: `test.alert.expired.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: new Date(),
      },
    });
    await client.alertRecipient.create({
      data: { alertId: alertExpired.id, userId: userBigInt },
    });
    const createdPast = new Date(Date.now() - 35 * 86_400_000);
    const expiredPast = new Date(Date.now() - 5 * 86_400_000);
    await client.alertEvidence.create({
      data: {
        alertId: alertExpired.id,
        mimeType: 'image/jpeg',
        content: Buffer.from([0x01, 0x02]),
        sizeBytes: BigInt(2),
        hashSha256: 'e'.repeat(64),
        createdAt: createdPast,
        expiresAt: expiredPast,
      },
    });

    const expiredRes = await fetch(`${baseUrl}/alerts/${alertExpired.id}/evidence`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(expiredRes.status, 410, 'Evidência expirada deve retornar 410 Gone');
    const expiredJson = (await expiredRes.json()) as any;
    assert.equal(expiredJson.code, 'EVIDENCE_UNAVAILABLE');
    assert.equal(expiredJson.reason, 'EXPIRED');

    // 3. Alerta com evidência removida
    const alertRemoved = await client.alert.create({
      data: {
        eventKey: `test.alert.removed.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: new Date(),
      },
    });
    await client.alertRecipient.create({
      data: { alertId: alertRemoved.id, userId: userBigInt },
    });
    await client.alertEvidence.create({
      data: {
        alertId: alertRemoved.id,
        mimeType: 'image/jpeg',
        content: null,
        sizeBytes: BigInt(100),
        hashSha256: 'r'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
        removedAt: new Date(Date.now() - 60_000), // Removida há 1 min
      },
    });

    const removedRes = await fetch(`${baseUrl}/alerts/${alertRemoved.id}/evidence`, {
      headers: { Authorization: `Bearer ${user.tokens.accessToken}` },
    });
    assert.equal(removedRes.status, 410, 'Evidência removida deve retornar 410 Gone');
    const removedJson = (await removedRes.json()) as any;
    assert.equal(removedJson.code, 'EVIDENCE_UNAVAILABLE');
    assert.equal(removedJson.reason, 'REMOVED');
  });

  test('11. Tentativa de obter evidência de outro usuário retorna 404 indistinguível', async () => {
    const client = prisma.getClient();
    const userA = await createTestUser('other_user_evi_a');
    const userB = await createTestUser('other_user_evi_b');

    const camera = await client.camera.create({
      data: { integrationCode: `test.alert.cam.oth.${randomUUID()}`, name: 'Cam Other' },
    });
    const monitoring = await client.monitoring.create({
      data: { startedByUserId: BigInt(userA.user.id), status: 'ATIVO' },
    });
    await client.monitoringCamera.create({
      data: { monitoringId: monitoring.id, cameraId: camera.id },
    });

    const alert = await client.alert.create({
      data: {
        eventKey: `test.alert.oth.evi.${randomUUID()}`,
        monitoringId: monitoring.id,
        cameraId: camera.id,
        severity: 'CRITICA',
        detectedAt: new Date(),
      },
    });
    // Destinatário é apenas Usuário A
    await client.alertRecipient.create({
      data: { alertId: alert.id, userId: BigInt(userA.user.id) },
    });
    await client.alertEvidence.create({
      data: {
        alertId: alert.id,
        mimeType: 'image/jpeg',
        content: Buffer.from([0x01, 0x02]),
        sizeBytes: BigInt(2),
        hashSha256: 'o'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    // Usuário B tenta baixar evidência do alerta de A
    const res = await fetch(`${baseUrl}/alerts/${alert.id}/evidence`, {
      headers: { Authorization: `Bearer ${userB.tokens.accessToken}` },
    });
    assert.equal(res.status, 404, 'Não deve revelar existência da evidência para outro usuário');
    const json = (await res.json()) as any;
    assert.equal(json.code, 'RESOURCE_NOT_FOUND');
  });
});
