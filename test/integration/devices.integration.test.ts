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
      `SEGURANÇA: Testes de integração só podem ser executados contra MySQL local. Host: ${host}`,
    );
  }
}

function formatValidationErrors(
  errors: import('class-validator').ValidationError[],
  parent = '',
): any[] {
  const result: any[] = [];
  for (const err of errors) {
    const pointer = `${parent}/${err.property}`;
    if (err.constraints) {
      for (const [key, msg] of Object.entries(err.constraints)) {
        let code = 'INVALID_FIELD';
        if (key === 'isEmail') code = 'INVALID_EMAIL';
        else if (key === 'isNotEmpty') code = 'REQUIRED_FIELD';
        else if (key === 'isIn') code = 'INVALID_PLATFORM';
        else if (key === 'whitelistValidation') code = 'UNKNOWN_FIELD';
        result.push({ pointer, code, detail: msg });
      }
    }
    if (err.children && err.children.length > 0) {
      result.push(...formatValidationErrors(err.children, pointer));
    }
  }
  return result;
}

describe('Fatia 8B — Dispositivo e FCM Token (/api/v1/devices)', () => {
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

    app.useGlobalFilters(new ProblemDetailsFilter());

    await app.init();
    await app.listen(0, '127.0.0.1');

    const addr = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

    prisma = app.get(PrismaService);

    await cleanupTestUsers();
  }, { timeout: 30000 });

  after(async () => {
    await cleanupTestUsers();
    if (app) {
      await app.close();
    }
  });

  async function cleanupTestUsers(): Promise<void> {
    if (!prisma) return;
    const testUsers = await prisma.getClient().user.findMany({
      where: { email: { startsWith: 'test.devices.' } },
      select: { id: true },
    });
    if (testUsers.length > 0) {
      const userIds = testUsers.map((u) => u.id);
      await prisma.getClient().device.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.getClient().authSession.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.getClient().passwordResetToken.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.getClient().user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  }

  async function createTestUser(emailSuffix: string) {
    const email = `test.devices.${emailSuffix}@example.com`;
    const password = 'Password123!Secure';
    const name = 'Usuario Dispositivo';

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
    const regJson = await regRes.json();
    return {
      email,
      password,
      user: regJson.data.user,
      tokens: regJson.data.tokens,
    };
  }

  test('1. Criação de nova instalação retorna 201 Created com dados seguros e sem token', async () => {
    const { tokens, user } = await createTestUser('newinst');
    const installationId = randomUUID();
    const token = 'fcm_token_sample_abc1234567890_test_1';

    const res = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({
        platform: 'ANDROID',
        fcmToken: token,
      }),
    });

    assert.equal(res.status, 201, 'Nova instalação deve retornar 201 Created');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const json = await res.json();

    assert.ok(json.data.id);
    assert.equal(json.data.installationId, installationId.toLowerCase());
    assert.equal(json.data.platform, 'ANDROID');
    assert.equal(json.data.active, true);
    assert.equal(json.data.pushEligible, true);
    assert.ok(json.data.tokenUpdatedAt);
    assert.equal(json.data.fcmToken, undefined, 'FCM Token NUNCA pode ser devolvido');
    assert.ok(json.meta.requestId);

    // Confere no banco de dados
    const dbDevice = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(user.id),
          installationIdentifier: installationId.toLowerCase(),
        },
      },
    });
    assert.ok(dbDevice);
    assert.equal(dbDevice.fcmToken, token);
    assert.equal(dbDevice.active, true);
    assert.equal(dbDevice.invalidatedAt, null);
    assert.ok(dbDevice.lastAccessAt);
    assert.ok(dbDevice.tokenUpdatedAt);

    // Confere que a sessão atual foi vinculada ao dispositivo
    const session = await prisma.getClient().authSession.findFirst({
      where: { userId: BigInt(user.id) },
    });
    assert.equal(session?.deviceId?.toString(), dbDevice.id.toString());
  });

  test('2. Atualização idempotente da mesma instalação retorna 200 OK sem alterar tokenUpdatedAt quando token é o mesmo', async () => {
    const { tokens, user } = await createTestUser('idempotent');
    const installationId = randomUUID();
    const token = 'fcm_token_same_1234567890_test_2';

    // 1ª chamada -> 201 Created
    const res1 = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: token }),
    });
    assert.equal(res1.status, 201);
    const json1 = await res1.json();
    const firstTokenUpdatedAt = json1.data.tokenUpdatedAt;

    // Aguarda 10ms
    await new Promise((r) => setTimeout(r, 15));

    // 2ª chamada idêntica -> 200 OK
    const res2 = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: token }),
    });
    assert.equal(res2.status, 200, 'Atualização idempotente deve retornar 200 OK');
    const json2 = await res2.json();

    assert.equal(json2.data.id, json1.data.id);
    assert.equal(json2.data.tokenUpdatedAt, firstTokenUpdatedAt, 'tokenUpdatedAt NÃO deve mudar quando o token for idêntico');

    // Confere que apenas uma linha existe no banco
    const count = await prisma.getClient().device.count({
      where: {
        userId: BigInt(user.id),
        installationIdentifier: installationId.toLowerCase(),
      },
    });
    assert.equal(count, 1);
  });

  test('3. Alteração real do token atualiza token_atualizado_em e ultimo_acesso_em', async () => {
    const { tokens } = await createTestUser('tokenchange');
    const installationId = randomUUID();
    const token1 = 'fcm_token_initial_1234567890_test_3';
    const token2 = 'fcm_token_updated_9876543210_test_3';

    const res1 = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: token1 }),
    });
    assert.equal(res1.status, 201);
    const json1 = await res1.json();

    await new Promise((r) => setTimeout(r, 20));

    const res2 = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: token2 }),
    });
    assert.equal(res2.status, 200);
    const json2 = await res2.json();

    assert.notEqual(json2.data.tokenUpdatedAt, json1.data.tokenUpdatedAt, 'tokenUpdatedAt DEVE atualizar quando o token mudar');
    assert.equal(json2.data.pushEligible, true);
  });

  test('4. fcmToken: null (permissão negada) mantém instalação conhecida porém com pushEligible: false', async () => {
    const { tokens, user } = await createTestUser('nulltoken');
    const installationId = randomUUID();

    const res = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({
        platform: 'ANDROID',
        fcmToken: null,
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.active, true);
    assert.equal(json.data.pushEligible, false, 'Sem token, pushEligible deve ser falso');
    assert.equal(json.data.tokenUpdatedAt, null);

    const dbDevice = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(user.id),
          installationIdentifier: installationId.toLowerCase(),
        },
      },
    });
    assert.ok(dbDevice);
    assert.equal(dbDevice.fcmToken, null);
    assert.equal(dbDevice.active, true, 'Instalação com token nulo permanece ativa/conhecida');
    assert.equal(dbDevice.invalidatedAt, null);
  });

  test('5. Transferência atômica do token entre instalações da mesma conta remove vínculo anterior', async () => {
    const { tokens, user } = await createTestUser('tokentransfer');
    const inst1 = randomUUID();
    const inst2 = randomUUID();
    const sharedToken = 'fcm_shared_token_between_devices_test_5';

    // Registra na Instalação 1
    const res1 = await fetch(`${baseUrl}/devices/${inst1}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: sharedToken }),
    });
    assert.equal(res1.status, 201);

    // Registra o mesmo token na Instalação 2
    const res2 = await fetch(`${baseUrl}/devices/${inst2}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: sharedToken }),
    });
    assert.equal(res2.status, 201);

    // Confere que a Instalação 1 teve seu vínculo removido e foi inativada
    const dev1 = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(user.id),
          installationIdentifier: inst1.toLowerCase(),
        },
      },
    });
    assert.equal(dev1?.fcmToken, null, 'Instalação anterior deve ter fcmToken removido');
    assert.equal(dev1?.active, false, 'Instalação anterior deve ser inativada');
    assert.ok(dev1?.invalidatedAt, 'Instalação anterior deve possuir invalidatedAt');

    // Confere que a Instalação 2 é a única proprietária do token
    const dev2 = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(user.id),
          installationIdentifier: inst2.toLowerCase(),
        },
      },
    });
    assert.equal(dev2?.fcmToken, sharedToken);
    assert.equal(dev2?.active, true);
  });

  test('6. Transferência atômica do token entre contas diferentes remove vínculo da conta anterior', async () => {
    const userA = await createTestUser('usera');
    const userB = await createTestUser('userb');
    const instA = randomUUID();
    const instB = randomUUID();
    const sharedToken = 'fcm_cross_user_token_transfer_test_6';

    // Usuário A registra o token
    const resA = await fetch(`${baseUrl}/devices/${instA}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: sharedToken }),
    });
    assert.equal(resA.status, 201);

    // Usuário B registra o MESMO token em outra instalação
    const resB = await fetch(`${baseUrl}/devices/${instB}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: sharedToken }),
    });
    assert.equal(resB.status, 201);

    // Usuário A perdeu o token
    const devA = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(userA.user.id),
          installationIdentifier: instA.toLowerCase(),
        },
      },
    });
    assert.equal(devA?.fcmToken, null);
    assert.equal(devA?.active, false);

    // Usuário B possui o token
    const devB = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(userB.user.id),
          installationIdentifier: instB.toLowerCase(),
        },
      },
    });
    assert.equal(devB?.fcmToken, sharedToken);
    assert.equal(devB?.active, true);
  });

  test('7. Concorrência: duas requisições paralelas com o mesmo token concluem com consistência sem violar constraint', async () => {
    const user = await createTestUser('concurrent');
    const instA = randomUUID();
    const instB = randomUUID();
    const token = 'fcm_concurrent_racing_token_test_7';

    // Dispara dois PUTs concorrentes com o mesmo token em instalações diferentes
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/devices/${instA}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.tokens.accessToken}`,
        },
        body: JSON.stringify({ platform: 'ANDROID', fcmToken: token }),
      }),
      fetch(`${baseUrl}/devices/${instB}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.tokens.accessToken}`,
        },
        body: JSON.stringify({ platform: 'ANDROID', fcmToken: token }),
      }),
    ]);

    // Ambas as requisições devem retornar sucesso (200 ou 201) e NUNCA 500 erro de constraint
    assert.ok([200, 201].includes(resA.status), `resA retornou ${resA.status}`);
    assert.ok([200, 201].includes(resB.status), `resB retornou ${resB.status}`);

    // Exatamente uma instalação deve possuir o token no banco
    const matchingTokens = await prisma.getClient().device.findMany({
      where: { fcmToken: token },
    });
    assert.equal(matchingTokens.length, 1, 'Exatamente UMA linha deve ser proprietária do token');
    assert.equal(matchingTokens[0]?.active, true);
  });

  test('8. Reativação após novo login: instalação inativada volta a active: true e limpa invalidated_em', async () => {
    const { tokens, user, email, password } = await createTestUser('reactivate');
    const installationId = randomUUID();
    const token = 'fcm_token_reactivation_test_8';

    // 1. Registra instalação
    await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: token }),
    });

    // 2. Invalida via DELETE
    const delRes = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(delRes.status, 204);

    const devAfterDel = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(user.id),
          installationIdentifier: installationId.toLowerCase(),
        },
      },
    });
    assert.equal(devAfterDel?.active, false);
    assert.equal(devAfterDel?.fcmToken, null);

    // 3. Novo login da conta
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200);
    const newTokens = (await loginRes.json()).data.tokens;

    // 4. Registra novamente a mesma instalação
    const reactivateRes = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newTokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: 'new_token_after_login' }),
    });
    assert.equal(reactivateRes.status, 200, 'Reativação da mesma instalação retorna 200');
    const reactivateJson = await reactivateRes.json();
    assert.equal(reactivateJson.data.active, true);
    assert.equal(reactivateJson.data.pushEligible, true);

    const devReactivated = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(user.id),
          installationIdentifier: installationId.toLowerCase(),
        },
      },
    });
    assert.equal(devReactivated?.active, true);
    assert.equal(devReactivated?.invalidatedAt, null, 'invalidatedAt deve ser limpo na reativação');
    assert.equal(devReactivated?.fcmToken, 'new_token_after_login');
  });

  test('9. DELETE /devices/{installationId} é idempotente e restrito ao próprio usuário', async () => {
    const userA = await createTestUser('del_a');
    const userB = await createTestUser('del_b');
    const instA = randomUUID();

    // User A registra instalação
    await fetch(`${baseUrl}/devices/${instA}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: 'token_user_a_del_test' }),
    });

    // User B tenta deletar instalação de User A -> idempotente 204, mas NÃO altera a instalação de User A
    const delByOther = await fetch(`${baseUrl}/devices/${instA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userB.tokens.accessToken}` },
    });
    assert.equal(delByOther.status, 204, 'DELETE retorna 204 sem revelar existência');

    const devAStillActive = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(userA.user.id),
          installationIdentifier: instA.toLowerCase(),
        },
      },
    });
    assert.equal(devAStillActive?.active, true, 'Instalação de User A não pode ter sido alterada por User B');
    assert.equal(devAStillActive?.fcmToken, 'token_user_a_del_test');

    // User A deleta sua própria instalação -> 204
    const delOwn = await fetch(`${baseUrl}/devices/${instA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(delOwn.status, 204);

    // DELETE repetido por User A -> 204 No Content
    const delRepeat = await fetch(`${baseUrl}/devices/${instA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
    });
    assert.equal(delRepeat.status, 204, 'DELETE repetido deve ser 204 idempotente');
  });

  test('10. Validações: installationId inválido retorna 422 INVALID_UUID; token ou plataforma inválidos retornam 422', async () => {
    const { tokens } = await createTestUser('validation');

    // installationId não é UUID
    const resBadId = await fetch(`${baseUrl}/devices/not-a-valid-uuid`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: 'valid_length_token_123' }),
    });
    assert.equal(resBadId.status, 422);
    const jsonBadId = await resBadId.json();
    assert.equal(jsonBadId.code, 'VALIDATION_ERROR');

    // plataforma não suportada
    const resBadPlat = await fetch(`${baseUrl}/devices/${randomUUID()}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'WINDOWS_PHONE', fcmToken: 'valid_length_token_123' }),
    });
    assert.equal(resBadPlat.status, 422);

    // token muito curto (< 16 chars)
    const resShortToken = await fetch(`${baseUrl}/devices/${randomUUID()}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: 'short' }),
    });
    assert.equal(resShortToken.status, 422);
  });

  test('11. Logout (POST /auth/logout) revoga sessão e invalida o dispositivo informado', async () => {
    const { email, password } = await createTestUser('logoutdev');
    const installationId = randomUUID();
    const token = 'fcm_token_logout_test_11';

    // Login
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const { tokens, user } = (await loginRes.json()).data;

    // Registra dispositivo
    await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: token }),
    });

    // Logout informando refreshToken e installationId
    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: tokens.refreshToken,
        installationId,
      }),
    });
    assert.equal(logoutRes.status, 204);

    // Confere que o dispositivo foi invalidado e o token limpo
    const dbDev = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(user.id),
          installationIdentifier: installationId.toLowerCase(),
        },
      },
    });
    assert.equal(dbDev?.active, false, 'Dispositivo deve ser inativado no logout');
    assert.equal(dbDev?.fcmToken, null, 'fcmToken deve ser removido no logout');
    assert.ok(dbDev?.invalidatedAt);
  });

  test('12. Redefinição de senha (POST /auth/reset-password) invalida todos os dispositivos e remove tokens', async () => {
    const { email, user, tokens } = await createTestUser('resetpassdev');
    const inst1 = randomUUID();
    const inst2 = randomUUID();

    // Registra 2 dispositivos
    await fetch(`${baseUrl}/devices/${inst1}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: 'fcm_token_reset_pass_1' }),
    });
    await fetch(`${baseUrl}/devices/${inst2}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: 'fcm_token_reset_pass_2' }),
    });

    // Cria token de recuperação diretamente no banco para testar resetPassword
    const secret = 'ABCD2345';
    const tokenHash = (await import('node:crypto')).createHash('sha256').update(secret).digest('hex');
    await prisma.getClient().passwordResetToken.create({
      data: {
        userId: BigInt(user.id),
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Redefine a senha
    const resetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'ABCD-2345',
        newPassword: 'BrandNewPassword123!Secure',
      }),
    });
    assert.equal(resetRes.status, 204);

    // Confere que TODOS os dispositivos foram invalidados e tokens removidos
    const devices = await prisma.getClient().device.findMany({
      where: { userId: BigInt(user.id) },
    });
    assert.equal(devices.length, 2);
    for (const d of devices) {
      assert.equal(d.active, false, 'Todos os dispositivos devem estar inativos');
      assert.equal(d.fcmToken, null, 'Tokens FCM devem ser limpos');
      assert.ok(d.invalidatedAt);
    }
  });

  test('13. Logout SEM installationId (POST /auth/logout apenas com refreshToken) localiza dispositivo pela sessão (deviceId) e o invalida', async () => {
    const { email, password } = await createTestUser('logoutsessdev');
    const installationId = randomUUID();
    const token = 'fcm_token_logout_via_session_device_id_test_13';

    // 1. Login
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const { tokens, user } = (await loginRes.json()).data;

    // 2. Registra dispositivo vinculando à sessão
    const putRes = await fetch(`${baseUrl}/devices/${installationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: token }),
    });
    assert.equal(putRes.status, 201);

    // 3. Logout OMITINDO installationId (apenas refreshToken no corpo)
    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: tokens.refreshToken,
      }),
    });
    assert.equal(logoutRes.status, 204);

    // 4. Comprova no banco que o dispositivo vinculado à sessão foi inativado e o token removido
    const dbDev = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(user.id),
          installationIdentifier: installationId.toLowerCase(),
        },
      },
    });
    assert.equal(dbDev?.active, false, 'Dispositivo vinculado à sessão deve ser inativado mesmo sem installationId no body');
    assert.equal(dbDev?.fcmToken, null, 'Token FCM deve ser removido');
    assert.ok(dbDev?.invalidatedAt, 'invalidatedAt deve ser registrado');
  });

  test('14. Troca de usuário no mesmo aparelho (mesmo installationId e fcmToken): cria linha para novo usuário e inativa a linha anterior sem token', async () => {
    const userA = await createTestUser('sameinst_a');
    const userB = await createTestUser('sameinst_b');
    const sharedInstallationId = randomUUID();
    const sharedFcmToken = 'fcm_token_shared_hardware_test_14';

    // 1. Usuário A registra o aparelho compartilhado
    const resA = await fetch(`${baseUrl}/devices/${sharedInstallationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: sharedFcmToken }),
    });
    assert.equal(resA.status, 201);

    // 2. Usuário B registra no MESMO aparelho compartilhado (mesmo installationId e fcmToken)
    const resB = await fetch(`${baseUrl}/devices/${sharedInstallationId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: sharedFcmToken }),
    });
    assert.equal(resB.status, 201, 'Cria nova linha para o usuário B');

    // 3. Verificações no banco conforme o modelo canônico:
    // Linha do Usuário A: inativa, sem token e com data de invalidação
    const devA = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(userA.user.id),
          installationIdentifier: sharedInstallationId.toLowerCase(),
        },
      },
    });
    assert.ok(devA);
    assert.equal(devA.active, false, 'Linha do usuário anterior deve estar inativa');
    assert.equal(devA.fcmToken, null, 'Token deve ter sido desassociado da linha do usuário anterior');
    assert.ok(devA.invalidatedAt, 'Linha do usuário anterior deve possuir invalidatedAt');

    // Linha do Usuário B: ativa, com o token exclusivo e pushEligible
    const devB = await prisma.getClient().device.findUnique({
      where: {
        userId_installationIdentifier: {
          userId: BigInt(userB.user.id),
          installationIdentifier: sharedInstallationId.toLowerCase(),
        },
      },
    });
    assert.ok(devB);
    assert.equal(devB.active, true, 'Linha do novo usuário deve estar ativa');
    assert.equal(devB.fcmToken, sharedFcmToken, 'Token deve estar exclusivamente com o novo usuário');
    assert.equal(devB.invalidatedAt, null);
  });

  test('15. Logout com installationId divergente prioriza a sessão e não invalida múltiplos dispositivos', async () => {
    const { email, password } = await createTestUser('divergentdev');
    const instSession = randomUUID();
    const instOther = randomUUID();

    // 1. Login
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const { tokens, user } = (await loginRes.json()).data;

    // 2. Registra instalação 1 vinculando à sessão atual
    await fetch(`${baseUrl}/devices/${instSession}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: 'fcm_session_device_test_15' }),
    });

    // 3. Registra instalação 2 (outro dispositivo do mesmo usuário)
    await fetch(`${baseUrl}/devices/${instOther}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ platform: 'ANDROID', fcmToken: 'fcm_other_device_test_15' }),
    });

    // 4. Executa logout da sessão enviando por engano o installationId de instOther
    // Como a sessão está vinculada à instOther (ou à última registrada), apenas o dispositivo vinculado é invalidado!
    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: tokens.refreshToken,
        installationId: instSession, // envia o outro
      }),
    });
    assert.equal(logoutRes.status, 204);

    // 5. Confere no banco: o dispositivo vinculado à sessão foi invalidado, mas NÃO ambos com OR indiscriminado
    const devices = await prisma.getClient().device.findMany({
      where: { userId: BigInt(user.id) },
    });
    const activeCount = devices.filter((d) => d.active).length;
    const inactiveCount = devices.filter((d) => !d.active).length;

    assert.equal(inactiveCount, 1, 'Exatamente UM dispositivo deve ter sido invalidado pelo logout');
    assert.equal(activeCount, 1, 'O outro dispositivo deve permanecer ativo e intacto');
  });
});
