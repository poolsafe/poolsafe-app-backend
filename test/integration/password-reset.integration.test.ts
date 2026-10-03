import 'dotenv/config';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID, createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { AppModule } from '../../dist/app.module.js';
import { ProblemDetailsFilter } from '../../dist/common/filters/problem-details.filter.js';
import { ProblemDetailsException } from '../../dist/common/errors/problem-details.exception.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { EmailService } from '../../dist/modules/email/email.service.js';
import { PasswordResetRateLimiter } from '../../dist/modules/auth/password-reset-rate-limiter.service.js';

let app: NestExpressApplication;
let baseUrl: string;
let prisma: PrismaService;
let emailService: EmailService;
let rateLimiter: PasswordResetRateLimiter;

interface CapturedEmail {
  to: string;
  code: string;
  ttlMinutes: number;
}

const sentEmails: CapturedEmail[] = [];
let simulateEmailFailure = false;

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
  emailService = app.get(EmailService);
  rateLimiter = app.get(PasswordResetRateLimiter);

  // Substitui o envio real pelo mock capturador
  emailService.sendPasswordResetEmail = async (options) => {
    if (simulateEmailFailure) {
      return false;
    }
    sentEmails.push({ ...options });
    return true;
  };

  // Limpeza de segurança para dados de teste
  const usersBefore = await prisma.getClient().user.findMany({
    where: { email: { startsWith: 'test.reset.' } },
    select: { id: true },
  });
  const userIdsBefore = usersBefore.map((u) => u.id);
  if (userIdsBefore.length > 0) {
    await prisma.getClient().device.deleteMany({ where: { userId: { in: userIdsBefore } } });
    await prisma.getClient().passwordResetToken.deleteMany({ where: { userId: { in: userIdsBefore } } });
    await prisma.getClient().authSession.deleteMany({ where: { userId: { in: userIdsBefore } } });
    await prisma.getClient().user.deleteMany({ where: { id: { in: userIdsBefore } } });
  }
});

after(async () => {
  if (prisma) {
    const usersAfter = await prisma.getClient().user.findMany({
      where: { email: { startsWith: 'test.reset.' } },
      select: { id: true },
    });
    const userIdsAfter = usersAfter.map((u) => u.id);
    if (userIdsAfter.length > 0) {
      await prisma.getClient().device.deleteMany({ where: { userId: { in: userIdsAfter } } });
      await prisma.getClient().passwordResetToken.deleteMany({ where: { userId: { in: userIdsAfter } } });
      await prisma.getClient().authSession.deleteMany({ where: { userId: { in: userIdsAfter } } });
      await prisma.getClient().user.deleteMany({ where: { id: { in: userIdsAfter } } });
    }
  }
  if (app) {
    await app.close();
  }
});

describe('Fatia 3B — Recuperação e Redefinição de Senha', () => {
  const testEmail = 'test.reset.usuario@poolsafe.local';
  const initialPassword = 'SenhaAntiga123!';
  const newPassword = 'NovaSenhaSegura456!';
  let userId: bigint;
  let lastCapturedCode: string;

  test('01. Preparação: cadastrar usuário ativo com sessão e dispositivo', async () => {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Usuario Recuperacao',
        email: testEmail,
        password: initialPassword,
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = await regRes.json();
    userId = BigInt(regJson.data.user.id);

    // Cria um dispositivo para este usuário
    await prisma.getClient().device.create({
      data: {
        userId,
        installationIdentifier: 'inst-test-device-uuid',
        platform: 'ANDROID',
        active: true,
      },
    });
  });

  test('02. Solicitação para conta inexistente retorna 202 genérico e não dispara e-mail', async () => {
    sentEmails.length = 0;
    rateLimiter.clear();

    const res = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test.reset.inexistente@poolsafe.local' }),
    });

    assert.equal(res.status, 202, 'Status deve ser 202 Accepted');
    const json = await res.json();
    assert.equal(
      json.data.message,
      'Se a conta existir, enviaremos as instruções de recuperação.',
    );
    assert.ok(json.meta?.requestId);
    assert.equal(sentEmails.length, 0, 'Nenhum e-mail deve ser despachado');
  });

  test('03. Solicitação para conta existente retorna 202, aciona e-mail e persiste apenas hash SHA-256', async () => {
    sentEmails.length = 0;
    rateLimiter.clear();

    const res = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });

    assert.equal(res.status, 202, 'Status deve ser 202 Accepted');
    const json = await res.json();
    assert.equal(
      json.data.message,
      'Se a conta existir, enviaremos as instruções de recuperação.',
    );

    // Verifica que o serviço de e-mail foi acionado
    assert.equal(sentEmails.length, 1);
    const emailData = sentEmails[0]!;
    assert.equal(emailData.to, testEmail);
    assert.match(emailData.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(emailData.ttlMinutes, 15);
    lastCapturedCode = emailData.code;

    // Verifica no banco de dados: somente hash SHA-256 é persistido
    const cleanedCode = lastCapturedCode.replace('-', '');
    const expectedHash = createHash('sha256').update(cleanedCode).digest('hex');

    const tokenInDb = await prisma.getClient().passwordResetToken.findUnique({
      where: { tokenHash: expectedHash },
    });

    assert.ok(tokenInDb, 'Token deve ser encontrado pelo hash SHA-256');
    assert.equal(tokenInDb.userId, userId);
    assert.equal(tokenInDb.usedAt, null, 'usedAt deve ser null inicialmente');
    assert.ok(tokenInDb.expiresAt > new Date(), 'expiresAt deve ser no futuro');
  });

  test('04. Código anterior é invalidado quando uma nova solicitação válida é criada', async () => {
    sentEmails.length = 0;
    rateLimiter.clear();

    // Primeira solicitação
    await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    assert.equal(sentEmails.length, 1);
    const firstCode = sentEmails[0]!.code;
    const firstHash = createHash('sha256').update(firstCode.replace('-', '')).digest('hex');

    // Segunda solicitação para a mesma conta
    await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    assert.equal(sentEmails.length, 2);
    const secondCode = sentEmails[1]!.code;
    const secondHash = createHash('sha256').update(secondCode.replace('-', '')).digest('hex');

    // Verifica no banco que o primeiro token foi invalidado (usedAt !== null)
    const firstToken = await prisma.getClient().passwordResetToken.findUnique({
      where: { tokenHash: firstHash },
    });
    assert.ok(firstToken);
    assert.ok(firstToken.usedAt !== null, 'Token anterior deve ser marcado como invalidado/usado');

    // Verifica que o segundo token está ativo
    const secondToken = await prisma.getClient().passwordResetToken.findUnique({
      where: { tokenHash: secondHash },
    });
    assert.ok(secondToken);
    assert.equal(secondToken.usedAt, null, 'Novo token deve estar ativo');

    lastCapturedCode = secondCode;
  });

  test('05. Falha simulada no Resend não revela existência da conta e invalida o token não entregue', async () => {
    rateLimiter.clear();
    simulateEmailFailure = true;

    const res = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });

    // Resposta continua 202 genérica
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(
      json.data.message,
      'Se a conta existir, enviaremos as instruções de recuperação.',
    );

    // O último token gerado deve ter sido invalidado no banco
    const tokens = await prisma.getClient().passwordResetToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    assert.equal(tokens.length, 1);
    assert.ok(tokens[0]!.usedAt !== null, 'Token não entregue deve ser invalidado');

    simulateEmailFailure = false;
  });

  test('06. Limite de requisições: 4ª solicitação na mesma hora retorna 429 RATE_LIMITED com Retry-After', async () => {
    rateLimiter.clear();
    const emailLim = 'test.reset.rate@poolsafe.local';

    // 3 solicitações bem-sucedidas
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailLim }),
      });
      assert.equal(res.status, 202);
    }

    // 4ª solicitação deve estourar o limite
    const blockedRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailLim }),
    });

    assert.equal(blockedRes.status, 429, 'Status deve ser 429 Too Many Requests');
    assert.ok(blockedRes.headers.get('retry-after'), 'Deve incluir header Retry-After');
    const problem = await blockedRes.json();
    assert.equal(problem.code, 'RATE_LIMITED');
    assert.equal(problem.type, 'urn:poolsafe:problem:rate-limited');
  });

  test('07. Token inválido retorna 422 INVALID_RESET_TOKEN', async () => {
    const res = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'ZZZZ-9999', // Código inexistente
        newPassword: 'NovaSenhaSegura123!',
      }),
    });

    assert.equal(res.status, 422, 'Status deve ser 422 Unprocessable Entity');
    const json = await res.json();
    assert.equal(json.code, 'INVALID_RESET_TOKEN');
    assert.equal(json.type, 'urn:poolsafe:problem:invalid-reset-token');
  });

  test('08. Token expirado retorna 410 RESET_TOKEN_EXPIRED', async () => {
    rateLimiter.clear();
    // Solicita um novo token para obter um código real
    sentEmails.length = 0;
    await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const code = sentEmails[0]!.code;
    const hash = createHash('sha256').update(code.replace('-', '')).digest('hex');

    // Força a expiração no banco de dados mantendo a constraint ck_token_recuperacao_senha_expiracao (expira_em > criado_em)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    await prisma.getClient().passwordResetToken.update({
      where: { tokenHash: hash },
      data: {
        createdAt: twoHoursAgo,
        expiresAt: oneHourAgo,
      },
    });

    const res = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: code,
        newPassword: 'NovaSenhaSegura123!',
      }),
    });

    assert.equal(res.status, 410, 'Status deve ser 410 Gone');
    const json = await res.json();
    assert.equal(json.code, 'RESET_TOKEN_EXPIRED');
    assert.equal(json.type, 'urn:poolsafe:problem:reset-token-expired');
  });

  test('09. Token válido redefine a senha, revoga todas as sessões e invalida dispositivos (204 No Content)', async () => {
    rateLimiter.clear();
    sentEmails.length = 0;

    // 1. Gera código válido
    await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const validCode = sentEmails[0]!.code;

    // 2. Confirma que há sessões e dispositivos ativos antes do reset
    const activeSessionsBefore = await prisma.getClient().authSession.count({
      where: { userId, revokedAt: null },
    });
    assert.ok(activeSessionsBefore > 0, 'Deve haver sessões ativas antes do reset');

    const activeDevicesBefore = await prisma.getClient().device.count({
      where: { userId, active: true },
    });
    assert.ok(activeDevicesBefore > 0, 'Deve haver dispositivos ativos antes do reset');

    // 3. Executa a redefinição de senha com sucesso (código aceito com hífen)
    const resetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: validCode,
        newPassword,
      }),
    });

    assert.equal(resetRes.status, 204, 'Status deve ser 204 No Content');

    // 4. Todas as sessões devem estar revogadas
    const activeSessionsAfter = await prisma.getClient().authSession.count({
      where: { userId, revokedAt: null },
    });
    assert.equal(activeSessionsAfter, 0, 'Todas as sessões ativas devem ser revogadas');

    // 5. Todos os dispositivos devem estar inativados
    const activeDevicesAfter = await prisma.getClient().device.count({
      where: { userId, active: true },
    });
    assert.equal(activeDevicesAfter, 0, 'Todos os dispositivos ativos devem ser invalidados');

    // 6. Nova senha deve estar criptografada com Argon2id
    const updatedUser = await prisma.getClient().user.findUnique({
      where: { id: userId },
    });
    assert.ok(updatedUser);
    assert.ok(
      updatedUser.passwordHash.startsWith('$argon2id$'),
      'Nova senha deve ser protegida por Argon2id',
    );

    // 7. Login com a nova senha deve funcionar
    const newLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: newPassword,
      }),
    });
    assert.equal(newLoginRes.status, 200, 'Login com a nova senha deve funcionar');

    // 8. Login com a senha antiga deve falhar
    const oldLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: initialPassword,
      }),
    });
    assert.equal(oldLoginRes.status, 401, 'Login com a senha antiga deve falhar');
  });

  test('10. Token já utilizado não pode ser reutilizado (consumo único atômico)', async () => {
    rateLimiter.clear();
    sentEmails.length = 0;

    // Gera um novo token
    await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const singleUseCode = sentEmails[0]!.code;

    // Primeiro uso: sucesso
    const firstRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: singleUseCode,
        newPassword: 'OutraNovaSenha789!',
      }),
    });
    assert.equal(firstRes.status, 204);

    // Segundo uso com o mesmo token: deve falhar com 422
    const secondRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: singleUseCode,
        newPassword: 'TentativaReutilizacao123!',
      }),
    });
    assert.equal(secondRes.status, 422);
    const json = await secondRes.json();
    assert.equal(json.code, 'INVALID_RESET_TOKEN');
  });
});
