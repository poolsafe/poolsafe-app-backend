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
        else if (key === 'minLength') code = 'FIELD_TOO_SHORT';
        else if (key === 'maxLength') code = 'FIELD_TOO_LONG';
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
});

async function cleanupTestUsers(): Promise<void> {
  if (!prisma) return;
  const testUsers = await prisma.getClient().user.findMany({
    where: { email: { startsWith: 'test.users.' } },
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
    await prisma.getClient().user.deleteMany({
      where: { id: { in: userIds } },
    });
  }
}

after(async () => {
  await cleanupTestUsers();
  if (app) {
    await app.close();
  }
});

describe('Fatia 3A — Perfil e alteração autenticada de senha', () => {
  async function createTestUser(emailSuffix: string) {
    const email = `test.users.${emailSuffix}@example.com`;
    const password = 'InitialPassword123!';
    const name = 'Usuario Inicial';

    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
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

  test('1. GET /users/me retorna perfil com envelope padrão', async () => {
    const { tokens, user } = await createTestUser('getprofile');

    const res = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.id, user.id);
    assert.equal(body.data.name, user.name);
    assert.equal(body.data.email, user.email);
    assert.equal(body.data.status, 'ATIVO');
    assert.ok(body.data.createdAt);
    assert.ok(body.meta.requestId);
  });

  test('2. PATCH /users/me atualiza e persiste o nome com normalização', async () => {
    const { tokens } = await createTestUser('patchname');

    // Atualiza nome com espaços nas pontas
    const patchRes = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ name: '  Danilo Silva Atualizado  ' }),
    });

    assert.equal(patchRes.status, 200, 'Deve retornar 200');
    const patchJson = await patchRes.json();
    assert.equal(patchJson.data.name, 'Danilo Silva Atualizado', 'Nome deve ser normalizado com trim');
    assert.ok(patchJson.meta.requestId);

    // Consulta subsequente para verificar persistência
    const getRes = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const getJson = await getRes.json();
    assert.equal(getJson.data.name, 'Danilo Silva Atualizado', 'Nome deve ter sido persistido');
  });

  test('3. PATCH /users/me rejeita nome inválido (< 2 ou > 120 caracteres)', async () => {
    const { tokens } = await createTestUser('invalidname');

    // Nome com 1 caractere
    const resShort = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ name: 'A' }),
    });
    assert.equal(resShort.status, 422);
    const shortJson = await resShort.json();
    assert.equal(shortJson.code, 'VALIDATION_ERROR');

    // Nome vazio após trim
    const resEmpty = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(resEmpty.status, 422);

    // Nome > 120 caracteres
    const resLong = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ name: 'A'.repeat(121) }),
    });
    assert.equal(resLong.status, 422);
  });

  test('4. PATCH /users/me rejeita tentativa de alterar e-mail ou campos desconhecidos', async () => {
    const { tokens } = await createTestUser('forbiddenemail');

    const res = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({
        name: 'Nome Permitido',
        email: 'novo.email@example.com',
      }),
    });

    assert.equal(res.status, 422, 'Campos não autorizados devem gerar 422 UNKNOWN_FIELD');
    const json = await res.json();
    assert.equal(json.code, 'VALIDATION_ERROR');
    assert.ok(
      json.errors.some((e: any) => e.pointer.includes('email')),
      'Deve apontar o campo não permitido',
    );
  });

  test('5. PUT /users/me/password rejeita senha atual incorreta com 403 REAUTHENTICATION_FAILED', async () => {
    const { tokens } = await createTestUser('wrongcurrent');

    const res = await fetch(`${baseUrl}/users/me/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'SenhaErrada123!',
        newPassword: 'NovaSenhaSegura123!',
      }),
    });

    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.code, 'REAUTHENTICATION_FAILED');
  });

  test('6. PUT /users/me/password rejeita nova senha curta (< 8 chars)', async () => {
    const { tokens, password } = await createTestUser('shortnewpass');

    const res = await fetch(`${baseUrl}/users/me/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: password,
        newPassword: 'short',
      }),
    });

    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.code, 'VALIDATION_ERROR');
  });

  test('7. PUT /users/me/password altera senha: 204 No Content, preserva sessão atual e revoga outras sessões', async () => {
    const { email, password, tokens: session1Tokens } = await createTestUser('changepass');

    // 1. Cria uma segunda sessão via login adicional (simulando outro dispositivo/login anterior)
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200);
    const session2Tokens = (await loginRes.json()).data.tokens;

    // Cria um dispositivo simulado para este usuário no banco
    const userDb = await prisma.getClient().user.findUnique({
      where: { email },
      select: { id: true },
    });
    assert.ok(userDb);

    const device2 = await prisma.getClient().device.create({
      data: {
        userId: userDb.id,
        installationIdentifier: 'inst-other-device-uuid',
        platform: 'ANDROID',
        active: true,
      },
    });

    const newPassword = 'NewSecretPassword456!';

    // 2. Altera a senha utilizando a Sessão 1
    const changeRes = await fetch(`${baseUrl}/users/me/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session1Tokens.accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: password,
        newPassword,
      }),
    });

    assert.equal(changeRes.status, 204, 'Alteração com sucesso deve retornar 204 No Content');
    const responseText = await changeRes.text();
    assert.equal(responseText, '', '204 No Content não deve conter corpo');

    // 3. Sessão 1 permanece válida (GET /users/me funciona)
    const session1Check = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${session1Tokens.accessToken}` },
    });
    assert.equal(session1Check.status, 200, 'Sessão atual deve continuar ativa');

    // 4. Sessão 2 foi revogada (tentativa de renovação com refresh token da sessão 2 é rejeitada)
    const session2Refresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session2Tokens.refreshToken }),
    });
    assert.equal(session2Refresh.status, 401, 'Sessão 2 revogada deve retornar 401');
    const s2Json = await session2Refresh.json();
    assert.equal(s2Json.code, 'SESSION_EXPIRED');

    // 5. Outro dispositivo foi invalidado
    const updatedDevice2 = await prisma.getClient().device.findUnique({
      where: { id: device2.id },
    });
    assert.equal(updatedDevice2?.active, false, 'Outro dispositivo deve ter sido inativado');
    assert.ok(updatedDevice2?.invalidatedAt, 'Deve ter data de invalidação');

    // 6. Login com a senha antiga NÃO funciona mais
    const oldLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(oldLoginRes.status, 401, 'Senha antiga deve falhar');
    const oldLoginJson = await oldLoginRes.json();
    assert.equal(oldLoginJson.code, 'INVALID_CREDENTIALS');

    // 7. Login com a NOVA senha funciona
    const newLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: newPassword }),
    });
    assert.equal(newLoginRes.status, 200, 'Login com a nova senha deve funcionar');
    const newLoginJson = await newLoginRes.json();
    assert.ok(newLoginJson.data.tokens.accessToken);
  });
});
