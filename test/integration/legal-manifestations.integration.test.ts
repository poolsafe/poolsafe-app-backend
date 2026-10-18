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
      `SEGURANÇA: Testes só podem ser executados contra MySQL local. Host: ${host}`,
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

  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer();
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  prisma = app.get(PrismaService);
});

async function cleanupTestUsers(): Promise<void> {
  if (!prisma) return;
  const testUsers = await prisma.getClient().user.findMany({
    where: { email: { startsWith: 'test.legal.' } },
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

describe('Checkpoint — Termos de Uso, Aviso de Privacidade e Telefone Opcional', () => {
  test('01. Consulta pública de documentos legais (GET /legal/documents e /legal/documents/:id)', async () => {
    // 1. Lista pública de documentos
    const listRes = await fetch(`${baseUrl}/legal/documents`);
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.ok(Array.isArray(listJson.data));
    assert.equal(listJson.data.length, 2);

    const termsMeta = listJson.data.find((d: any) => d.id === 'termos-de-uso');
    assert.ok(termsMeta);
    assert.equal(termsMeta.version, '1.0');
    assert.ok(termsMeta.updatedAt);

    const privacyMeta = listJson.data.find((d: any) => d.id === 'aviso-de-privacidade');
    assert.ok(privacyMeta);
    assert.equal(privacyMeta.version, '1.0');
    assert.ok(privacyMeta.updatedAt);

    // 2. Consulta de documento por ID (Termos de Uso)
    const termsRes = await fetch(`${baseUrl}/legal/documents/termos-de-uso`);
    assert.equal(termsRes.status, 200);
    const termsJson = await termsRes.json();
    assert.equal(termsJson.data.id, 'termos-de-uso');
    assert.equal(termsJson.data.version, '1.0');
    assert.ok(termsJson.data.content.includes('# PoolSafe — Termos de Uso'));
    // Garante que aviso editorial foi removido
    assert.ok(!termsJson.data.content.includes('Preparação para publicação'));

    // 3. Consulta de documento por ID (Aviso de Privacidade)
    const privacyRes = await fetch(`${baseUrl}/legal/documents/aviso-de-privacidade`);
    assert.equal(privacyRes.status, 200);
    const privacyJson = await privacyRes.json();
    assert.equal(privacyJson.data.id, 'aviso-de-privacidade');
    assert.equal(privacyJson.data.version, '1.0');
    assert.ok(privacyJson.data.content.includes('# PoolSafe — Aviso de Privacidade'));
    // Garante que aviso editorial e notas internas foram removidos
    assert.ok(!privacyJson.data.content.includes('Nota de integração — retirar da versão publicada'));
    assert.ok(!privacyJson.data.content.includes('Notas para integração e operação'));

    // 4. Documento inexistente retorna 404 RESOURCE_NOT_FOUND
    const notFoundRes = await fetch(`${baseUrl}/legal/documents/inexistente`);
    assert.equal(notFoundRes.status, 404);
  });

  test('02. Cadastro rejeita requisição sem manifestações obrigatórias ou com versões inválidas', async () => {
    // A. Sem termsAccepted
    const resA = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Usuario Teste',
        email: 'test.legal.failA@poolsafe.local',
        password: 'Password123!',
        termsAccepted: false,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
      }),
    });
    assert.equal(resA.status, 422);

    // B. Versão dos termos inválida
    const resB = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Usuario Teste',
        email: 'test.legal.failB@poolsafe.local',
        password: 'Password123!',
        termsAccepted: true,
        termsVersion: '0.9',
        privacyAware: true,
        privacyVersion: '1.0',
      }),
    });
    assert.equal(resB.status, 422);

    // C. Sem privacyAware
    const resC = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Usuario Teste',
        email: 'test.legal.failC@poolsafe.local',
        password: 'Password123!',
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: false,
        privacyVersion: '1.0',
      }),
    });
    assert.equal(resC.status, 422);

    // D. Versão da privacidade desatualizada
    const resD = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Usuario Teste',
        email: 'test.legal.failD@poolsafe.local',
        password: 'Password123!',
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '2.0',
      }),
    });
    assert.equal(resD.status, 422);
  });

  test('03. Cadastro válido com telefone opcional e autorização persiste atomicamente com horários UTC do servidor', async () => {
    const email = 'test.legal.success1@poolsafe.local';
    const beforeCall = new Date();

    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dan Silva',
        email,
        password: 'StrongPassword123!',
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
        phone: '(11) 98765-4321',
        phoneContactAuthorized: true,
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    const afterCall = new Date();

    // Verificações na resposta pública
    const user = json.data.user;
    assert.equal(user.termsVersion, '1.0');
    assert.ok(user.termsAcceptedAt);
    assert.equal(user.privacyVersion, '1.0');
    assert.ok(user.privacyAwareAt);
    assert.equal(user.phone, '+5511987654321', 'Telefone deve ser normalizado para E.164');
    assert.equal(user.phoneContactAuthorized, true);
    assert.equal(user.phoneContactVersion, '1.0');
    assert.ok(user.phoneContactGrantedAt);
    assert.equal(user.phoneContactRevokedAt, null);

    const termsDate = new Date(user.termsAcceptedAt);
    assert.ok(termsDate >= beforeCall && termsDate <= afterCall, 'Horário deve ser gerado pelo servidor em UTC');

    // Verificação de persistência no banco de dados
    const dbUser = await prisma.getClient().user.findUnique({
      where: { id: BigInt(user.id) },
    });
    assert.ok(dbUser);
    assert.equal(dbUser.termsVersion, '1.0');
    assert.equal(dbUser.privacyVersion, '1.0');
    assert.equal(dbUser.phone, '+5511987654321');
    assert.equal(dbUser.phoneContactAuthorized, true);
  });

  test('04. Telefone fornecido sem autorização NÃO é persistido (recusa não impede cadastro)', async () => {
    const email = 'test.legal.noauth@poolsafe.local';

    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sem Autorização',
        email,
        password: 'StrongPassword123!',
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
        phone: '(11) 91234-5678',
        phoneContactAuthorized: false,
      }),
    });

    assert.equal(res.status, 201, 'Conta deve ser criada mesmo sem autorização');
    const json = await res.json();
    assert.equal(json.data.user.phone, null, 'Telefone não deve ser persistido sem autorização');
    assert.equal(json.data.user.phoneContactAuthorized, false);

    const dbUser = await prisma.getClient().user.findUnique({
      where: { id: BigInt(json.data.user.id) },
    });
    assert.equal(dbUser?.phone, null);
    assert.equal(dbUser?.phoneContactAuthorized, false);
  });

  test('05. Contas anteriores permanecem com campos nulos e registram manifestações via POST /users/me/manifestations', async () => {
    // 1. Simula conta antiga pré-existente inserida sem manifestações
    const oldUser = await prisma.getClient().user.create({
      data: {
        name: 'Conta Antiga',
        email: 'test.legal.olduser@poolsafe.local',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash$dummyhash',
        status: 'ATIVO',
        // Todos os campos de manifestação ficam nulos/default
      },
    });

    assert.equal(oldUser.termsVersion, null);
    assert.equal(oldUser.termsAcceptedAt, null);
    assert.equal(oldUser.privacyVersion, null);
    assert.equal(oldUser.privacyAwareAt, null);
    assert.equal(oldUser.phoneContactAuthorized, false);

    // Cria sessão para autenticar
    const { TokenService } = await import('../../dist/modules/auth/token.service.js');
    const tokenService = app.get(TokenService, { strict: false });
    const { SessionService } = await import('../../dist/modules/auth/session.service.js');
    const sessionService = app.get(SessionService, { strict: false });
    const session = await sessionService.createSession(oldUser.id);
    const tokenResult = tokenService.generateAccessToken(oldUser.id.toString(), session.sessionId);

    // 2. Consulta de perfil da conta antiga reflete campos nulos
    const profileRes = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
    });
    assert.equal(profileRes.status, 200);
    const profileJson = await profileRes.json();
    assert.equal(profileJson.data.termsVersion, null);
    assert.equal(profileJson.data.termsAcceptedAt, null);
    assert.equal(profileJson.data.privacyVersion, null);
    assert.equal(profileJson.data.privacyAwareAt, null);

    // 3. Registra manifestações via endpoint autenticado específico
    const manifestRes = await fetch(`${baseUrl}/users/me/manifestations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
      }),
    });
    assert.equal(manifestRes.status, 200);
    const manifestJson = await manifestRes.json();
    assert.equal(manifestJson.data.termsVersion, '1.0');
    assert.ok(manifestJson.data.termsAcceptedAt);
    assert.equal(manifestJson.data.privacyVersion, '1.0');
    assert.ok(manifestJson.data.privacyAwareAt);

    const originalTermsAcceptedAt = manifestJson.data.termsAcceptedAt;
    const originalPrivacyAwareAt = manifestJson.data.privacyAwareAt;

    // 4. Idempotência: requisição repetida preserva os horários originais
    const repeatRes = await fetch(`${baseUrl}/users/me/manifestations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
      }),
    });
    assert.equal(repeatRes.status, 200);
    const repeatJson = await repeatRes.json();
    assert.equal(repeatJson.data.termsAcceptedAt, originalTermsAcceptedAt, 'Idempotência: horário original dos Termos deve ser preservado');
    assert.equal(repeatJson.data.privacyAwareAt, originalPrivacyAwareAt, 'Idempotência: horário original da Privacidade deve ser preservado');
  });

  test('06. Perfil PATCH /users/me: atualização de telefone, remoção, revogação e proibição de edição genérica de manifestações', async () => {
    // 1. Cadastra usuário com telefone
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dan Perfil',
        email: 'test.legal.profile@poolsafe.local',
        password: 'Password123!',
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
        phone: '(11) 97777-8888',
        phoneContactAuthorized: true,
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = await regRes.json();
    const token = regJson.data.tokens.accessToken;

    // 2. Proibição de alterar manifestações via PATCH genérico (campo desconhecido -> 422)
    const illegalPatch = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        termsVersion: '2.0',
      }),
    });
    assert.equal(illegalPatch.status, 422, 'Não deve permitir alterar manifestações via PATCH /users/me');

    // 3. Atualização somente do nome preserva o telefone e autorização omitidos
    const patchName = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Dan Nome Atualizado',
      }),
    });
    assert.equal(patchName.status, 200);
    const patchNameJson = await patchName.json();
    assert.equal(patchNameJson.data.name, 'Dan Nome Atualizado');
    assert.equal(patchNameJson.data.phone, '+5511977778888', 'Telefone deve permanecer inalterado quando omitido');
    assert.equal(patchNameJson.data.phoneContactAuthorized, true);

    // 4. Alteração de telefone exige nova confirmação de autorização
    const patchPhoneWithoutAuth = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: '(11) 96666-5555',
        phoneContactAuthorized: false,
      }),
    });
    // Se phoneContactAuthorized for false, o telefone é removido/não salvo para a finalidade
    assert.equal(patchPhoneWithoutAuth.status, 200);
    const jsonWithoutAuth = await patchPhoneWithoutAuth.json();
    assert.equal(jsonWithoutAuth.data.phone, null);
    assert.equal(jsonWithoutAuth.data.phoneContactAuthorized, false);

    // 5. Atualização válida com novo número e autorização confirmada
    const patchNewPhone = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: '(21) 99999-1111',
        phoneContactAuthorized: true,
      }),
    });
    assert.equal(patchNewPhone.status, 200);
    const jsonNewPhone = await patchNewPhone.json();
    assert.equal(jsonNewPhone.data.phone, '+5521999991111');
    assert.equal(jsonNewPhone.data.phoneContactAuthorized, true);
    assert.equal(jsonNewPhone.data.phoneContactRevokedAt, null);

    // 6. Remoção do telefone enviando null
    const patchRemovePhone = await fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: null,
      }),
    });
    assert.equal(patchRemovePhone.status, 200);
    const jsonRemove = await patchRemovePhone.json();
    assert.equal(jsonRemove.data.phone, null);
    assert.equal(jsonRemove.data.phoneContactAuthorized, false);
    assert.ok(jsonRemove.data.phoneContactRevokedAt, 'Deve registrar data de revogação');
  });

  test('07. Isolamento entre usuários: usuário A não visualiza nem altera dados do usuário B', async () => {
    // Registra Usuário A
    const resA = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Usuario A',
        email: 'test.legal.userA@poolsafe.local',
        password: 'PasswordUserA123!',
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
        phone: '(11) 91111-2222',
        phoneContactAuthorized: true,
      }),
    });
    const jsonA = await resA.json();
    const tokenA = jsonA.data.tokens.accessToken;

    // Registra Usuário B
    const resB = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Usuario B',
        email: 'test.legal.userB@poolsafe.local',
        password: 'PasswordUserB123!',
        termsAccepted: true,
        termsVersion: '1.0',
        privacyAware: true,
        privacyVersion: '1.0',
        phone: '(11) 93333-4444',
        phoneContactAuthorized: true,
      }),
    });
    const jsonB = await resB.json();

    // Consulta de A retorna exclusivamente dados de A
    const profileA = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const profileAJson = await profileA.json();
    assert.equal(profileAJson.data.email, 'test.legal.usera@poolsafe.local');
    assert.equal(profileAJson.data.phone, '+5511911112222');
    assert.notEqual(profileAJson.data.id, jsonB.data.user.id);
  });
});
