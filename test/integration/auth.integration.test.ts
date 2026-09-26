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

  // Limpeza de segurança de usuários criados em execuções anteriores de teste
  await prisma.getClient().user.deleteMany({
    where: {
      email: { startsWith: 'test.auth.' },
    },
  });
});

after(async () => {
  if (prisma) {
    // Limpeza apenas dos dados criados neste teste
    await prisma.getClient().user.deleteMany({
      where: {
        email: { startsWith: 'test.auth.' },
      },
    });
  }
  if (app) {
    await app.close();
  }
});

describe('Etapa 2B — Autenticação e Sessões', () => {
  const testEmail = 'test.auth.dan@poolsafe.local';
  const testPassword = 'Password123!';
  const testName = 'Dan Silva';

  let currentAccessToken: string;
  let currentRefreshToken: string;
  let registeredUserId: string;

  test('01. Cadastro válido (POST /api/v1/auth/register)', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `   ${testName}   `,
        email: `   ${testEmail.toUpperCase()}   `,
        password: testPassword,
      }),
    });

    assert.equal(res.status, 201, 'Status deve ser 201 Created');
    const json = await res.json();

    assert.ok(json.data, 'Deve conter envelope data');
    assert.ok(json.meta?.requestId, 'Deve conter meta.requestId');

    assert.ok(typeof json.data.user.id === 'string', 'ID deve ser string');
    assert.equal(json.data.user.name, testName, 'Nome deve ser normalizado');
    assert.equal(json.data.user.email, testEmail.toLowerCase(), 'E-mail deve ser minúsculo');
    assert.equal(json.data.user.status, 'ATIVO', 'Status inicial deve ser ATIVO');

    assert.equal(json.data.tokens.tokenType, 'Bearer');
    assert.ok(json.data.tokens.accessToken, 'Deve retornar access token');
    assert.ok(json.data.tokens.refreshToken.startsWith('psrt_'), 'Refresh token deve seguir formato psrt_');
    assert.ok(json.data.tokens.accessExpiresAt, 'Deve conter accessExpiresAt');
    assert.ok(json.data.tokens.sessionExpiresAt, 'Deve conter sessionExpiresAt');

    registeredUserId = json.data.user.id;
    currentAccessToken = json.data.tokens.accessToken;
    currentRefreshToken = json.data.tokens.refreshToken;

    const match = currentRefreshToken.match(/^psrt_(\d+)\./);
    assert.ok(match);
    const sessionInDb = await prisma.getClient().authSession.findUnique({
      where: { id: BigInt(match[1]!) },
    });
    assert.ok(sessionInDb);
    assert.equal(sessionInDb.tokenHashAnterior, null, 'token_hash_anterior deve ser NULL na emissão inicial');
  });

  test('02. Validação de cadastro com campos inválidos (422 Problem Details)', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A',
        email: 'invalid-email',
        password: '123',
      }),
    });

    assert.equal(res.status, 422, 'Status deve ser 422');
    const json = await res.json();
    assert.equal(json.code, 'VALIDATION_ERROR');
    assert.equal(json.type, 'urn:poolsafe:problem:validation-error');
    assert.ok(Array.isArray(json.errors), 'Deve conter array errors');
    assert.ok(json.errors.some((e: any) => e.pointer === '/name'));
    assert.ok(json.errors.some((e: any) => e.pointer === '/email'));
    assert.ok(json.errors.some((e: any) => e.pointer === '/password'));
  });

  test('03. Validação de cadastro rejeitando campos desconhecidos (422 UNKNOWN_FIELD)', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dan Silva',
        email: 'test.auth.extra@poolsafe.local',
        password: 'Password123!',
        passwordConfirmation: 'Password123!',
      }),
    });
    assert.equal(res.status, 422, 'Campo desconhecido deve retornar 422');
    const json = await res.json();
    assert.equal(json.code, 'VALIDATION_ERROR');
    assert.ok(json.errors.some((e: any) => e.code === 'UNKNOWN_FIELD'));
  });

  test('04. Conflito de e-mail existente (409 ACCOUNT_CANNOT_BE_CREATED)', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Outro Nome',
        email: testEmail,
        password: 'OutraSenha123!',
      }),
    });

    assert.equal(res.status, 409, 'Status deve ser 409 Conflict');
    const json = await res.json();
    assert.equal(json.code, 'ACCOUNT_CANNOT_BE_CREATED');
    assert.equal(json.type, 'urn:poolsafe:problem:account-cannot-be-created');
    assert.equal(json.detail, 'Não foi possível concluir o cadastro com os dados informados.');
  });

  test('05. Hash Argon2id persistido no banco e senha em texto puro não persistida', async () => {
    const userInDb = await prisma.getClient().user.findUnique({
      where: { id: BigInt(registeredUserId) },
    });

    assert.ok(userInDb, 'Usuário deve existir no banco');
    assert.ok(
      userInDb.passwordHash.startsWith('$argon2id$v=19$m=65536,'),
      'passwordHash deve ser Argon2id com parâmetros especificados',
    );
    assert.notEqual(userInDb.passwordHash, testPassword, 'A senha nunca deve estar em texto puro');
  });

  test('06. Login válido (POST /api/v1/auth/login)', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail.toUpperCase(),
        password: testPassword,
      }),
    });

    assert.equal(res.status, 200, 'Status deve ser 200 OK');
    const json = await res.json();

    assert.ok(json.data.user);
    assert.equal(json.data.user.email, testEmail);
    assert.ok(json.data.tokens.accessToken);
    assert.ok(json.data.tokens.refreshToken);

    const userInDb = await prisma.getClient().user.findUnique({
      where: { id: BigInt(registeredUserId) },
    });
    assert.ok(userInDb?.lastLoginAt !== null, 'ultimo_login_em deve estar preenchido');

    currentAccessToken = json.data.tokens.accessToken;
    currentRefreshToken = json.data.tokens.refreshToken;
  });

  test('07. Credenciais inválidas (401 INVALID_CREDENTIALS) não enumeráveis', async () => {
    const resWrongPass = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'WrongPassword999!',
      }),
    });
    assert.equal(resWrongPass.status, 401);
    const jsonWrongPass = await resWrongPass.json();
    assert.equal(jsonWrongPass.code, 'INVALID_CREDENTIALS');
    assert.equal(jsonWrongPass.type, 'urn:poolsafe:problem:invalid-credentials');

    const resNoUser = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test.auth.nonexistent@poolsafe.local',
        password: 'Password123!',
      }),
    });
    assert.equal(resNoUser.status, 401);
    const jsonNoUser = await resNoUser.json();
    assert.equal(jsonNoUser.code, 'INVALID_CREDENTIALS');
    assert.equal(jsonWrongPass.detail, jsonNoUser.detail, 'Mensagens de credenciais inválidas devem ser idênticas');
  });

  test('08. Usuário bloqueado ou desativado rejeitado no login', async () => {
    await prisma.getClient().user.update({
      where: { id: BigInt(registeredUserId) },
      data: { status: 'BLOQUEADO' },
    });

    const resBlocked = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    assert.equal(resBlocked.status, 401);
    const jsonBlocked = await resBlocked.json();
    assert.equal(jsonBlocked.code, 'INVALID_CREDENTIALS', 'Usuário bloqueado deve receber erro genérico');

    await prisma.getClient().user.update({
      where: { id: BigInt(registeredUserId) },
      data: { status: 'ATIVO' },
    });
  });

  test('09. Claims e assinatura RS256 do access token', async () => {
    const parts = currentAccessToken.split('.');
    assert.equal(parts.length, 3, 'JWT deve ter 3 partes');

    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
    assert.equal(header.alg, 'RS256', 'Algoritmo deve ser RS256');

    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    assert.equal(payload.iss, 'poolsafe-api');
    assert.equal(payload.aud, 'poolsafe-app');
    assert.equal(payload.sub, registeredUserId);
    assert.ok(payload.sid);
    assert.ok(payload.jti);
    assert.ok(payload.exp > payload.iat);
  });

  test('10. Acesso autorizado a GET /api/v1/users/me', async () => {
    const res = await fetch(`${baseUrl}/users/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${currentAccessToken}`,
      },
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.id, registeredUserId);
    assert.equal(json.data.name, testName);
    assert.equal(json.data.email, testEmail);
    assert.equal(json.data.status, 'ATIVO');
    assert.ok(json.data.createdAt, 'Deve retornar createdAt em RFC 3339');
    assert.ok(json.meta?.requestId);
  });

  test('11. Acesso sem token a GET /api/v1/users/me (401 AUTHENTICATION_REQUIRED)', async () => {
    const res = await fetch(`${baseUrl}/users/me`);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.code, 'AUTHENTICATION_REQUIRED');
  });

  test('12. Access token inválido ou com assinatura forjada (401 AUTHENTICATION_REQUIRED)', async () => {
    const res = await fetch(`${baseUrl}/users/me`, {
      headers: {
        Authorization: `Bearer ${currentAccessToken}corrupted`,
      },
    });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.code, 'AUTHENTICATION_REQUIRED');
  });

  test('13. Sessão revogada invalida imediatamente o access token em /users/me', async () => {
    const parts = currentAccessToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    const sessionId = BigInt(payload.sid);

    await prisma.getClient().authSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    const res = await fetch(`${baseUrl}/users/me`, {
      headers: {
        Authorization: `Bearer ${currentAccessToken}`,
      },
    });

    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.code, 'SESSION_EXPIRED');

    await prisma.getClient().authSession.update({
      where: { id: sessionId },
      data: { revokedAt: null },
    });
  });

  test('14. Sessão com expira_em no passado é rejeitada imediatamente', async () => {
    const parts = currentAccessToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    const sessionId = BigInt(payload.sid);

    const pastCreated = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const pastExpires = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    await prisma.getClient().authSession.update({
      where: { id: sessionId },
      data: {
        createdAt: pastCreated,
        expiresAt: pastExpires,
      },
    });

    const res = await fetch(`${baseUrl}/users/me`, {
      headers: {
        Authorization: `Bearer ${currentAccessToken}`,
      },
    });

    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.code, 'SESSION_EXPIRED');

    await prisma.getClient().authSession.update({
      where: { id: sessionId },
      data: {
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  });

  test('15. Refresh válido (POST /api/v1/auth/refresh)', async () => {
    const prevMatch = currentRefreshToken.match(/^psrt_(\d+)\.([a-zA-Z0-9_-]+)$/);
    assert.ok(prevMatch);
    const sessionId = BigInt(prevMatch[1]!);
    const prevSecret = prevMatch[2]!;
    const { createHash } = await import('node:crypto');
    const prevHash = createHash('sha256').update(prevSecret).digest('hex');

    const sessionBefore = await prisma.getClient().authSession.findUnique({
      where: { id: sessionId },
    });
    assert.ok(sessionBefore);
    const originalExpiresAt = sessionBefore.expiresAt;

    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: currentRefreshToken,
      }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.data.tokenType, 'Bearer');
    assert.ok(json.data.accessToken);
    assert.ok(json.data.refreshToken);
    assert.notEqual(json.data.refreshToken, currentRefreshToken, 'Refresh token deve ser rotacionado');
    assert.ok(json.data.accessExpiresAt);
    assert.ok(json.data.sessionExpiresAt);

    const newMatch = json.data.refreshToken.match(/^psrt_(\d+)\.([a-zA-Z0-9_-]+)$/);
    assert.ok(newMatch);
    const newSecret = newMatch[2]!;
    const newHash = createHash('sha256').update(newSecret).digest('hex');

    currentAccessToken = json.data.accessToken;
    currentRefreshToken = json.data.refreshToken;
  });

  test('16. Rotação do refresh token refletida no banco com preservação de expira_em', async () => {
    const prevMatch = currentRefreshToken.match(/^psrt_(\d+)\.([a-zA-Z0-9_-]+)$/);
    assert.ok(prevMatch);
    const sessionId = BigInt(prevMatch[1]!);
    const prevSecret = prevMatch[2]!;
    const { createHash } = await import('node:crypto');
    const prevHash = createHash('sha256').update(prevSecret).digest('hex');

    const sessionBefore = await prisma.getClient().authSession.findUnique({
      where: { id: sessionId },
    });
    assert.ok(sessionBefore);
    const originalExpiresAt = sessionBefore.expiresAt;

    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: currentRefreshToken,
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    currentAccessToken = json.data.accessToken;
    currentRefreshToken = json.data.refreshToken;

    const newMatch = json.data.refreshToken.match(/^psrt_(\d+)\.([a-zA-Z0-9_-]+)$/);
    assert.ok(newMatch);
    const newSecret = newMatch[2]!;
    const newHash = createHash('sha256').update(newSecret).digest('hex');

    const sessionAfter = await prisma.getClient().authSession.findUnique({
      where: { id: sessionId },
    });
    assert.ok(sessionAfter);
    assert.equal(sessionAfter.tokenHashAnterior, prevHash, 'Refresh legítimo move o hash atual para token_hash_anterior');
    assert.equal(sessionAfter.tokenHash, newHash, 'Novo hash passa a ser o token atual');
    assert.equal(sessionAfter.expiresAt.getTime(), originalExpiresAt.getTime(), 'expira_em NÃO é estendido na rotação');
    assert.ok(sessionAfter.lastUsedAt !== null, 'ultimo_uso_em deve ser atualizado na rotação');
  });

  test('17. Tentativa de reutilizar refresh token antigo resulta em 401 SESSION_EXPIRED', async () => {
    // 1. Faz novo login para obter token fresco
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginJson = await loginRes.json();
    const tokenToRotate = loginJson.data.tokens.refreshToken;

    // 2. Rotaciona uma vez com sucesso
    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenToRotate }),
    });
    assert.equal(refreshRes.status, 200);

    // 3. Tenta reutilizar o token anterior já rotacionado
    const resReuse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenToRotate }),
    });

    assert.equal(resReuse.status, 401);
    const jsonReuse = await resReuse.json();
    assert.equal(jsonReuse.code, 'SESSION_EXPIRED');

    // 18. Revogação persistida no banco após tentativa de reutilização
    const match = tokenToRotate.match(/^psrt_(\d+)\./);
    assert.ok(match);
    const sessionId = BigInt(match[1]!);
    const sessionAfterReuse = await prisma.getClient().authSession.findUnique({
      where: { id: sessionId },
    });
    assert.ok(sessionAfterReuse?.revokedAt !== null, 'A sessão inteira deve estar revogada no banco após reutilização');
  });

  test('18. Duas renovações concorrentes com o mesmo refresh token', async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    const concurrentRefreshToken = loginJson.data.tokens.refreshToken;

    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: concurrentRefreshToken }),
      }),
      fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: concurrentRefreshToken }),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();

    assert.ok(
      (statuses[0] === 200 && statuses[1] === 401) || (statuses[0] === 401 && statuses[1] === 401),
      `Apenas uma pode ter sucesso no máximo. Statuses obtidos: ${statuses.join(', ')}`,
    );
  });

  test('19. Logout com token legítimo (POST /api/v1/auth/logout) revoga a sessão', async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    const loginJson = await loginRes.json();
    const logoutToken = loginJson.data.tokens.refreshToken;
    const logoutAccessToken = loginJson.data.tokens.accessToken;

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: logoutToken,
        installationId: 'd67bd8e9-c001-4ae4-8da0-cbd75b660ec8',
      }),
    });

    assert.equal(logoutRes.status, 204, 'Logout deve retornar 204 No Content');

    const repeatLogoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: logoutToken,
      }),
    });
    assert.equal(repeatLogoutRes.status, 204, 'Repetir logout deve ser idempotente (204)');

    // 20. Rejeição do access token depois do logout
    const resMe = await fetch(`${baseUrl}/users/me`, {
      headers: {
        Authorization: `Bearer ${logoutAccessToken}`,
      },
    });
    assert.equal(resMe.status, 401, 'Access token associado à sessão deslogada deve ser rejeitado');
    const jsonMe = await resMe.json();
    assert.equal(jsonMe.code, 'SESSION_EXPIRED');
  });

  test('20. Logout com token fabricado NÃO pode revogar a sessão legítima', async () => {
    // 1. Cria sessão legítima
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginJson = await loginRes.json();
    const realRefreshToken = loginJson.data.tokens.refreshToken;
    const realAccessToken = loginJson.data.tokens.accessToken;

    // 2. Fabrica token com mesmo sessionId mas segredo aleatório
    const match = realRefreshToken.match(/^psrt_(\d+)\./);
    assert.ok(match);
    const sessionId = match[1];
    const fabricatedToken = `psrt_${sessionId}.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`;

    // 3. Envia token fabricado ao logout
    const fakeLogoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: fabricatedToken }),
    });
    assert.equal(fakeLogoutRes.status, 204);

    // 4. A sessão legítima NÃO pode ter sido revogada
    const resMe = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${realAccessToken}` },
    });
    assert.equal(resMe.status, 200, 'Sessão legítima não pode ser revogada por token forjado no logout');

    // 5. Logout com o token real revoga de fato
    const realLogoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: realRefreshToken }),
    });
    assert.equal(realLogoutRes.status, 204);

    const resMeAfter = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${realAccessToken}` },
    });
    assert.equal(resMeAfter.status, 401);
  });

  test('21. Ausência de senha_hash e token_hash nas respostas', async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    const loginText = await loginRes.text();
    assert.ok(!loginText.includes('senha_hash'), 'senha_hash não deve estar na resposta de login');
    assert.ok(!loginText.includes('passwordHash'), 'passwordHash não deve estar na resposta de login');
    assert.ok(!loginText.includes('token_hash'), 'token_hash não deve estar na resposta de login');
    assert.ok(!loginText.includes('tokenHash'), 'tokenHash não deve estar na resposta de login');

    const parsed = JSON.parse(loginText);
    const meRes = await fetch(`${baseUrl}/users/me`, {
      headers: {
        Authorization: `Bearer ${parsed.data.tokens.accessToken}`,
      },
    });

    const meText = await meRes.text();
    assert.ok(!meText.includes('senha_hash'), 'senha_hash não deve estar na resposta de /users/me');
    assert.ok(!meText.includes('passwordHash'), 'passwordHash não deve estar na resposta de /users/me');
  });

  test('22. Auditoria de refresh contra revogação abusiva por token fabricado', async () => {
    // 1. Cria sessão ativa e obtém refresh token legítimo
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginJson = await loginRes.json();
    const realRefreshToken = loginJson.data.tokens.refreshToken;
    const realAccessToken = loginJson.data.tokens.accessToken;

    // 2. Extrai sessionId e fabrica outro token sintaticamente válido com segredo aleatório nunca emitido
    const match = realRefreshToken.match(/^psrt_(\d+)\./);
    assert.ok(match);
    const sessionId = match[1];
    const fabricatedToken = `psrt_${sessionId}.fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210`;

    // 3. Envia o token fabricado a POST /api/v1/auth/refresh
    const fakeRefreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: fabricatedToken }),
    });

    // 4. A resposta deve ser 401
    assert.equal(fakeRefreshRes.status, 401);

    // 5. A sessão legítima NÃO pode ser revogada: access token legítimo deve continuar funcionando
    const resMe = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${realAccessToken}` },
    });
    assert.equal(resMe.status, 200, 'Sessão legítima NÃO pode ser revogada por refresh token fabricado');

    // 6. O refresh token legítimo deve continuar capaz de realizar uma renovação
    const realRefreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: realRefreshToken }),
    });
    assert.equal(realRefreshRes.status, 200, 'Refresh token legítimo deve continuar funcionando');
  });

  test('23. Limitação aceita do MVP: token mais antigo que token_hash_anterior é rejeitado sem revogar a sessão', async () => {
    // 1. Cria nova sessão ativa (Token V1)
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginJson = await loginRes.json();
    const tokenV1 = loginJson.data.tokens.refreshToken;

    // 2. Primeira rotação bem-sucedida: V1 -> V2 (token_hash = V2, token_hash_anterior = V1)
    const rot1Res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenV1 }),
    });
    assert.equal(rot1Res.status, 200);
    const rot1Json = await rot1Res.json();
    const tokenV2 = rot1Json.data.refreshToken;

    // 3. Segunda rotação bem-sucedida: V2 -> V3 (token_hash = V3, token_hash_anterior = V2, V1 é descartado)
    const rot2Res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenV2 }),
    });
    assert.equal(rot2Res.status, 200);
    const rot2Json = await rot2Res.json();
    const tokenV3 = rot2Json.data.refreshToken;
    const activeAccessToken = rot2Json.data.accessToken;

    // 4. Apresenta o token mais antigo V1 (anterior a token_hash_anterior V2):
    // Deve ser rejeitado com 401 AUTHENTICATION_REQUIRED e não emitir tokens
    const oldRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenV1 }),
    });
    assert.equal(oldRes.status, 401, 'Token histórico além da janela do MVP deve retornar 401');
    const oldJson = await oldRes.json();
    assert.equal(oldJson.code, 'AUTHENTICATION_REQUIRED');
    assert.ok(!oldJson.data, 'Não pode emitir tokens');

    // 5. Ele não precisa revogar a sessão porque o MVP retém apenas o hash imediatamente anterior:
    // A sessão legítima deve permanecer ativa e o access token legítimo continua funcionando
    const meRes = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${activeAccessToken}` },
    });
    assert.equal(meRes.status, 200, 'Sessão legítima não deve ser revogada pelo token histórico descartado');

    // 6. O refresh token legítimo atual (V3) continua apto a renovar a sessão
    const rot3Res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenV3 }),
    });
    assert.equal(rot3Res.status, 200, 'Refresh token legítimo atual continua operando normalmente');
  });
});


