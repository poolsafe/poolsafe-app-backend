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
    where: { email: { startsWith: 'test.mon.' } },
    select: { id: true },
  });
  const userIds = testUsers.map((u) => u.id);

  const testCameras = await client.camera.findMany({
    where: { integrationCode: { startsWith: 'test.mon.' } },
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
            { eventKey: { startsWith: 'test.mon.' } },
          ],
        },
      },
    });

    await client.alert.deleteMany({
      where: {
        OR: [
          { cameraId: { in: cameraIds } },
          { eventKey: { startsWith: 'test.mon.' } },
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
    console.error('ERROR IN BEFORE (Monitorings):', err);
    throw err;
  }
});

after(async () => {
  await cleanupTestData();
  if (app) {
    await app.close();
  }
});

describe('Fatia 6 — Controle de monitoramento (/api/v1/monitorings)', () => {
  async function createTestUser(emailSuffix: string) {
    const email = `test.mon.${emailSuffix}@example.com`;
    const password = 'PasswordMon123!';
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

  async function createTestCamera(codeSuffix: string, options?: {
    adminStatus?: string;
    lastComm?: Date | null;
  }) {
    const client = prisma.getClient();
    const adminStatus = options?.adminStatus ?? 'ATIVA';
    const camera = await client.camera.create({
      data: {
        integrationCode: `test.mon.${codeSuffix}`,
        name: `Câmera ${codeSuffix}`,
        location: `Local ${codeSuffix}`,
        administrativeStatus: adminStatus,
        deactivatedAt: adminStatus === 'INATIVA' ? new Date() : null,
        lastCommunicationAt: options !== undefined && 'lastComm' in options ? options.lastComm : new Date(),
      },
    });
    return camera;
  }

  async function grantCameraAccess(userId: bigint | string, cameraId: bigint | string) {
    const client = prisma.getClient();
    return await client.cameraAccess.create({
      data: {
        userId: BigInt(userId),
        cameraId: BigInt(cameraId),
        active: true,
      },
    });
  }

  test('1. Autenticação obrigatória em todos os endpoints de monitoramento', async () => {
    const endpoints = [
      { method: 'GET', url: `${baseUrl}/monitorings/current` },
      { method: 'GET', url: `${baseUrl}/monitorings/1` },
      { method: 'POST', url: `${baseUrl}/monitorings`, body: { cameraIds: ['1'] } },
      { method: 'POST', url: `${baseUrl}/monitorings/1/pause`, body: { password: 'pass' } },
      { method: 'POST', url: `${baseUrl}/monitorings/1/resume` },
    ];

    for (const ep of endpoints) {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        ...(ep.body ? { body: JSON.stringify(ep.body) } : {}),
      });
      assert.equal(res.status, 401, `${ep.method} ${ep.url} deve retornar 401 sem autenticação`);
      const json = (await res.json()) as any;
      assert.equal(json.code, 'AUTHENTICATION_REQUIRED');
    }
  });

  test('2. GET /monitorings/current retorna lista vazia quando usuário não tem sessões', async () => {
    const { tokens } = await createTestUser('empty');
    const res = await fetch(`${baseUrl}/monitorings/current`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as any;
    assert.deepEqual(json.data, []);
    assert.ok(json.meta?.requestId);
  });

  test('3. POST /monitorings validações básicas (lista vazia, IDs duplicados, IDs não numéricos)', async () => {
    const { tokens } = await createTestUser('val');

    // Lista vazia
    const emptyRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [] }),
    });
    assert.equal(emptyRes.status, 422);

    // IDs duplicados
    const dupRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: ['10', '10'] }),
    });
    assert.equal(dupRes.status, 422);

    // ID não numérico
    const nonNumRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: ['abc'] }),
    });
    assert.equal(nonNumRes.status, 422);
  });

  test('4. POST /monitorings rejeita câmera sem autorização ativa com 403 ACCESS_DENIED', async () => {
    const userA = await createTestUser('user-acc-a');
    const userB = await createTestUser('user-acc-b');
    const cam = await createTestCamera('cam-unauth');

    // Apenas userB tem acesso
    await grantCameraAccess(userB.user.id, cam.id);

    // userA tenta iniciar
    const res = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    assert.equal(res.status, 403);
    const json = (await res.json()) as any;
    assert.equal(json.code, 'ACCESS_DENIED');
  });

  test('5. POST /monitorings rejeita câmera inativa, offline ou desconhecida com 422 CAMERA_NOT_OPERATIONAL', async () => {
    const { user, tokens } = await createTestUser('cam-inop');

    // Câmera inativa
    const camInativa = await createTestCamera('inativa', { adminStatus: 'INATIVA' });
    await grantCameraAccess(user.id, camInativa.id);

    const resInativa = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [camInativa.id.toString()] }),
    });
    assert.equal(resInativa.status, 422);
    const jsonInativa = (await resInativa.json()) as any;
    assert.equal(jsonInativa.code, 'CAMERA_NOT_OPERATIONAL');

    // Câmera desconhecida (nunca comunicou)
    const camDesconhecida = await createTestCamera('desconhecida', { lastComm: null });
    await grantCameraAccess(user.id, camDesconhecida.id);

    const resDesconhecida = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [camDesconhecida.id.toString()] }),
    });
    assert.equal(resDesconhecida.status, 422);
    const jsonDesconhecida = (await resDesconhecida.json()) as any;
    assert.equal(jsonDesconhecida.code, 'CAMERA_NOT_OPERATIONAL');

    // Câmera offline (> 90s atrás)
    const camOffline = await createTestCamera('offline', {
      lastComm: new Date(Date.now() - 300_000), // 5 min atrás
    });
    await grantCameraAccess(user.id, camOffline.id);

    const resOffline = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [camOffline.id.toString()] }),
    });
    assert.equal(resOffline.status, 422);
    const jsonOffline = (await resOffline.json()) as any;
    assert.equal(jsonOffline.code, 'CAMERA_NOT_OPERATIONAL');
  });

  test('6. POST /monitorings rejeita câmeras com conjuntos divergentes de usuários autorizados (409)', async () => {
    const userA = await createTestUser('diverg-a');
    const userB = await createTestUser('diverg-b');
    const cam1 = await createTestCamera('diverg-1');
    const cam2 = await createTestCamera('diverg-2');

    // cam1 tem userA e userB
    await grantCameraAccess(userA.user.id, cam1.id);
    await grantCameraAccess(userB.user.id, cam1.id);

    // cam2 tem SOMENTE userA
    await grantCameraAccess(userA.user.id, cam2.id);

    // userA tenta iniciar com ambas
    const res = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam1.id.toString(), cam2.id.toString()] }),
    });
    assert.equal(res.status, 409);
    const json = (await res.json()) as any;
    assert.equal(json.code, 'MONITORING_STATE_CONFLICT');
  });

  test('7. POST /monitorings inicia com 1 câmera e cria evento INICIADO atomicamente (201 Created)', async () => {
    const { user, tokens } = await createTestUser('start-single');
    const cam = await createTestCamera('start-single-cam');
    await grantCameraAccess(user.id, cam.id);

    const res = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    assert.equal(res.status, 201);
    const json = (await res.json()) as any;
    assert.ok(json.data.id);
    assert.equal(json.data.status, 'ATIVO');
    assert.equal(json.data.operationalStatus, 'ATIVO');
    assert.equal(json.data.operationalReason, 'OPERACIONAL');
    assert.equal(json.data.cameras.length, 1);
    assert.equal(json.data.cameras[0].id, cam.id.toString());
    assert.equal(json.data.cameras[0].connectionStatus, 'ONLINE');

    // Verificar se evento INICIADO foi persistido
    const client = prisma.getClient();
    const events = await client.monitoringEvent.findMany({
      where: { monitoringId: BigInt(json.data.id) },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'INICIADO');
    assert.equal(events[0].userId?.toString(), user.id);
  });

  test('8. POST /monitorings com a mesma composição já ativa retorna 200 OK idempotentemente', async () => {
    const { user, tokens } = await createTestUser('idempotent-start');
    const cam = await createTestCamera('idemp-cam');
    await grantCameraAccess(user.id, cam.id);

    // Primeiro início -> 201
    const res1 = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    assert.equal(res1.status, 201);
    const json1 = (await res1.json()) as any;

    // Segundo início com a mesma câmera -> 200 OK idempotente
    const res2 = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    assert.equal(res2.status, 200);
    const json2 = (await res2.json()) as any;
    assert.equal(json2.data.id, json1.data.id);

    // Eventos continuam sendo apenas 1
    const client = prisma.getClient();
    const events = await client.monitoringEvent.findMany({
      where: { monitoringId: BigInt(json1.data.id) },
    });
    assert.equal(events.length, 1);
  });

  test('9. POST /monitorings com sobreposição ou conflito de câmera retorna 409 MONITORING_STATE_CONFLICT', async () => {
    const { user, tokens } = await createTestUser('conflict-start');
    const cam1 = await createTestCamera('conf-1');
    const cam2 = await createTestCamera('conf-2');
    await grantCameraAccess(user.id, cam1.id);
    await grantCameraAccess(user.id, cam2.id);

    // Inicia sessão com cam1
    const res1 = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam1.id.toString()] }),
    });
    assert.equal(res1.status, 201);

    // Tenta iniciar com cam1 e cam2 -> conflito pois cam1 já está em sessão ativa
    const res2 = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam1.id.toString(), cam2.id.toString()] }),
    });
    assert.equal(res2.status, 409);
    const json2 = (await res2.json()) as any;
    assert.equal(json2.code, 'MONITORING_STATE_CONFLICT');
  });

  test('10. GET /monitorings/current e GET /monitorings/:id filtram por autorização e retornam 404 indistinguível', async () => {
    const userA = await createTestUser('filter-a');
    const userB = await createTestUser('filter-b');
    const camA = await createTestCamera('filter-cam-a');
    await grantCameraAccess(userA.user.id, camA.id);

    // userA cria monitoramento
    const startRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [camA.id.toString()] }),
    });
    assert.equal(startRes.status, 201);
    const startJson = (await startRes.json()) as any;
    const monitoringId = startJson.data.id;

    // userA vê a sessão em /current
    const listResA = await fetch(`${baseUrl}/monitorings/current`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(listResA.status, 200);
    const listJsonA = (await listResA.json()) as any;
    assert.equal(listJsonA.data.length, 1);
    assert.equal(listJsonA.data[0].id, monitoringId);

    // userB não tem acesso à câmera: /current NÃO traz a sessão
    const listResB = await fetch(`${baseUrl}/monitorings/current`, {
      headers: { Authorization: `Bearer ${userB.tokens.accessToken}` },
    });
    assert.equal(listResB.status, 200);
    const listJsonB = (await listResB.json()) as any;
    assert.equal(listJsonB.data.length, 0);

    // userB tenta acessar pelo ID: 404 RESOURCE_NOT_FOUND (indistinguível de inexistente)
    const getResB = await fetch(`${baseUrl}/monitorings/${monitoringId}`, {
      headers: { Authorization: `Bearer ${userB.tokens.accessToken}` },
    });
    assert.equal(getResB.status, 404);
    const getJsonB = (await getResB.json()) as any;
    assert.equal(getJsonB.code, 'RESOURCE_NOT_FOUND');

    // ID inexistente também retorna 404 RESOURCE_NOT_FOUND
    const nonExistentRes = await fetch(`${baseUrl}/monitorings/99999999`, {
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(nonExistentRes.status, 404);
    const nonExistentJson = (await nonExistentRes.json()) as any;
    assert.equal(nonExistentJson.code, 'RESOURCE_NOT_FOUND');
  });

  test('11. POST /monitorings/:id/pause exige senha correta (403 REAUTHENTICATION_FAILED com senha errada)', async () => {
    const { user, tokens, password } = await createTestUser('pause-auth');
    const cam = await createTestCamera('pause-cam');
    await grantCameraAccess(user.id, cam.id);

    const startRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    const startJson = (await startRes.json()) as any;
    const monitoringId = startJson.data.id;

    // Pausa com senha errada -> 403
    const failRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/pause`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: 'WrongPassword999!' }),
    });
    assert.equal(failRes.status, 403);
    const failJson = (await failRes.json()) as any;
    assert.equal(failJson.code, 'REAUTHENTICATION_FAILED');

    // Pausa com senha correta -> 200 OK
    const okRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/pause`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as any;
    assert.equal(okJson.data.status, 'PAUSADO');
    assert.equal(okJson.data.operationalStatus, 'PAUSADO');
    assert.equal(okJson.data.operationalReason, 'PAUSADO_PELO_USUARIO');
    assert.ok(okJson.data.pausedAt);

    // Evento PAUSADO criado
    const client = prisma.getClient();
    const events = await client.monitoringEvent.findMany({
      where: { monitoringId: BigInt(monitoringId), type: 'PAUSADO' },
    });
    assert.equal(events.length, 1);

    // Pausa idempotente: chamar pause novamente com senha correta retorna 200 sem novo evento
    const idempRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/pause`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    assert.equal(idempRes.status, 200);
    const idempEvents = await client.monitoringEvent.findMany({
      where: { monitoringId: BigInt(monitoringId), type: 'PAUSADO' },
    });
    assert.equal(idempEvents.length, 1);
  });

  test('12. POST /monitorings/:id/resume retoma sessão pausada com câmeras online (200 OK) e idempotência', async () => {
    const { user, tokens, password } = await createTestUser('resume-flow');
    const cam = await createTestCamera('resume-cam');
    await grantCameraAccess(user.id, cam.id);

    // Inicia e pausa
    const startRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    const { id: monitoringId } = (await startRes.json()).data;

    await fetch(`${baseUrl}/monitorings/${monitoringId}/pause`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });

    // Retoma sessão
    const resumeRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/resume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    assert.equal(resumeRes.status, 200);
    const resumeJson = (await resumeRes.json()) as any;
    assert.equal(resumeJson.data.status, 'ATIVO');
    assert.equal(resumeJson.data.operationalStatus, 'ATIVO');
    assert.equal(resumeJson.data.pausedAt, null);

    // Evento REATIVADO criado
    const client = prisma.getClient();
    const resumeEvents = await client.monitoringEvent.findMany({
      where: { monitoringId: BigInt(monitoringId), type: 'REATIVADO' },
    });
    assert.equal(resumeEvents.length, 1);

    // Retomada idempotente em sessão já ativa retorna 200 sem novo evento
    const idempRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/resume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    assert.equal(idempRes.status, 200);
    const idempEvents = await client.monitoringEvent.findMany({
      where: { monitoringId: BigInt(monitoringId), type: 'REATIVADO' },
    });
    assert.equal(idempEvents.length, 1);
  });

  test('13. POST /monitorings/:id/resume falha com 422 CAMERA_NOT_OPERATIONAL se alguma câmera estiver offline', async () => {
    const { user, tokens, password } = await createTestUser('resume-fail');
    const cam = await createTestCamera('resume-fail-cam');
    await grantCameraAccess(user.id, cam.id);

    const startRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    const { id: monitoringId } = (await startRes.json()).data;

    await fetch(`${baseUrl}/monitorings/${monitoringId}/pause`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });

    // Simula câmera caindo offline
    const client = prisma.getClient();
    await client.camera.update({
      where: { id: cam.id },
      data: { lastCommunicationAt: new Date(Date.now() - 300_000) },
    });

    const resumeRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/resume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    assert.equal(resumeRes.status, 422);
    const resumeJson = (await resumeRes.json()) as any;
    assert.equal(resumeJson.code, 'CAMERA_NOT_OPERATIONAL');
  });

  test('14. Pausa ou retomada em sessão ENCERRADA retorna 409 MONITORING_STATE_CONFLICT', async () => {
    const { user, tokens, password } = await createTestUser('ended-conflict');
    const cam = await createTestCamera('ended-cam');
    await grantCameraAccess(user.id, cam.id);

    const startRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    const { id: monitoringId } = (await startRes.json()).data;

    // Encerra sessão administrativamente no banco
    const client = prisma.getClient();
    await client.monitoring.update({
      where: { id: BigInt(monitoringId) },
      data: { status: 'ENCERRADO', endedAt: new Date() },
    });

    // Pausa em encerrada -> 409
    const pauseRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/pause`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    assert.equal(pauseRes.status, 409);
    const pauseJson = (await pauseRes.json()) as any;
    assert.equal(pauseJson.code, 'MONITORING_STATE_CONFLICT');

    // Retomada em encerrada -> 409
    const resumeRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/resume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    assert.equal(resumeRes.status, 409);
    const resumeJson = (await resumeRes.json()) as any;
    assert.equal(resumeJson.code, 'MONITORING_STATE_CONFLICT');
  });

  test('15. Proteção de concorrência: duas criações simultâneas para a mesma câmera não produzem duas sessões', async () => {
    const { user, tokens } = await createTestUser('concurrency');
    const cam = await createTestCamera('concurrency-cam');
    await grantCameraAccess(user.id, cam.id);

    const postPayload = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    };

    // Dispara duas chamadas em paralelo
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/monitorings`, postPayload),
      fetch(`${baseUrl}/monitorings`, postPayload),
    ]);

    // Uma delas cria (201) e a outra deve ser 200 (idempotência da mesma composição) ou 409 (se colisão)
    const statuses = [res1.status, res2.status].sort();
    assert.equal(statuses[0] === 200 || statuses[0] === 201, true);
    assert.equal(statuses[1] === 200 || statuses[1] === 201 || statuses[1] === 409, true);

    // No banco, deve existir exatamente 1 sessão não encerrada para essa câmera
    const client = prisma.getClient();
    const activeSessions = await client.monitoringCamera.findMany({
      where: {
        cameraId: cam.id,
        monitoring: { status: { in: ['ATIVO', 'PAUSADO'] } },
      },
    });
    assert.equal(activeSessions.length, 1, 'Deve existir exatamente uma sessão vinculada à câmera');
  });

  test('16. POST /monitorings/:id/end exige senha, encerra a sessão e libera a câmera', async () => {
    const { user, tokens, password } = await createTestUser('end-session');
    const cam = await createTestCamera('cam-end');
    await grantCameraAccess(user.id, cam.id);

    // Inicia sessão
    const createRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    assert.equal(createRes.status, 201);
    const createJson = (await createRes.json()) as any;
    const monitoringId = createJson.data.id;

    // Tentativa com senha incorreta -> 403 REAUTHENTICATION_FAILED
    const wrongPassRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/end`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: 'SenhaErrada123!' }),
    });
    assert.equal(wrongPassRes.status, 403);
    const wrongPassJson = (await wrongPassRes.json()) as any;
    assert.equal(wrongPassJson.code, 'REAUTHENTICATION_FAILED');

    // Encerra sessão com senha correta -> 200 OK
    const endRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/end`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    assert.equal(endRes.status, 200);
    const endJson = (await endRes.json()) as any;
    assert.equal(endJson.data.status, 'ENCERRADO');
    assert.ok(endJson.data.endedAt);

    // Idempotência ao chamar end novamente com senha correta
    const reEndRes = await fetch(`${baseUrl}/monitorings/${monitoringId}/end`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    assert.equal(reEndRes.status, 200);

    // Deve existir exatamente um único evento ENCERRADO no banco
    const client = prisma.getClient();
    const events = await client.monitoringEvent.findMany({
      where: { monitoringId: BigInt(monitoringId), type: 'ENCERRADO' },
    });
    assert.equal(events.length, 1, 'Deve existir exatamente 1 evento ENCERRADO (sem duplicação)');

    // Câmera está liberada para iniciar nova sessão
    const newStartRes = await fetch(`${baseUrl}/monitorings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraIds: [cam.id.toString()] }),
    });
    assert.equal(newStartRes.status, 201, 'Câmera liberada deve permitir novo início');
  });
});
