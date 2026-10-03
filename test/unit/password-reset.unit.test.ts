import test from 'node:test';
import assert from 'node:assert/strict';
import { PasswordResetService } from '../../dist/modules/auth/password-reset.service.js';
import { PasswordResetRateLimiter } from '../../dist/modules/auth/password-reset-rate-limiter.service.js';
import { EmailService } from '../../dist/modules/email/email.service.js';
import { RateLimitedException } from '../../dist/common/errors/problem-details.exception.js';

test('PasswordResetService - Geração e formato visual do código de recuperação', () => {
  // Instanciação com mocks
  const service = new PasswordResetService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const { raw, formatted } = service.generateCode();

  // 1. O código bruto deve ter exatamente 8 caracteres
  assert.equal(raw.length, 8);

  // 2. O formato visual deve ser XXXX-XXXX
  assert.match(formatted, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(formatted, `${raw.slice(0, 4)}-${raw.slice(4)}`);

  // 3. Alfabeto sem ambiguidade (não deve conter '0', 'O', '1', 'I')
  const unambiguousRegex = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
  assert.ok(
    unambiguousRegex.test(raw),
    `O código gerado (${raw}) contém caracteres fora do alfabeto sem ambiguidade`,
  );
});

test('PasswordResetService - Normalização estrita do código', () => {
  const service = new PasswordResetService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  // Aceita com hífen
  assert.equal(service.normalizeCode('AB7K-2P9Q'), 'AB7K2P9Q');

  // Aceita sem hífen
  assert.equal(service.normalizeCode('AB7K2P9Q'), 'AB7K2P9Q');

  // Aceita com minúsculas e espaços
  assert.equal(service.normalizeCode('  ab7k-2p9q  '), 'AB7K2P9Q');

  // Rejeita caracteres proibidos (ex: dígito 0 ou letra O)
  assert.equal(service.normalizeCode('AB7K-2P90'), null);
  assert.equal(service.normalizeCode('AB7K-2P9O'), null);
  assert.equal(service.normalizeCode('AB7K-2P91'), null);
  assert.equal(service.normalizeCode('AB7K-2P9I'), null);

  // Rejeita tamanho inadequado
  assert.equal(service.normalizeCode('AB7K-2P'), null);
  assert.equal(service.normalizeCode('AB7K-2P9QXX'), null);
  assert.equal(service.normalizeCode(''), null);
});

test('PasswordResetService - Hash SHA-256 do segredo normalizado', () => {
  const service = new PasswordResetService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const hash1 = service.hashSecret('AB7K2P9Q');
  const hash2 = service.hashSecret('AB7K2P9Q');

  // SHA-256 produz 64 caracteres hexadecimais
  assert.equal(hash1.length, 64);
  assert.match(hash1, /^[0-9a-f]{64}$/);
  // Determinístico
  assert.equal(hash1, hash2);

  // Códigos diferentes produzem hashes diferentes
  const hashDiff = service.hashSecret('CD8L3R0R');
  assert.notEqual(hash1, hashDiff);
});

test('EmailService - Construção dos templates HTML e Texto Plano', () => {
  const mockConfigService = {
    get: (key: string) => {
      if (key === 'EMAIL_FROM') return 'PoolSafe <nao-responda@send.poolsafe.app>';
      if (key === 'EMAIL_LOGO_URL') return 'https://poolsafe.app/assets/poolsafe-email-logo.png';
      return undefined;
    },
  };

  const emailService = new EmailService(mockConfigService as any);

  const code = 'AB7K-2P9Q';
  const ttlMinutes = 15;

  const html = emailService.buildHtmlTemplate(code, ttlMinutes);
  const text = emailService.buildTextTemplate(code, ttlMinutes);

  // 1. HTML contém logo URL e fallback textual PoolSafe
  assert.ok(html.includes('https://poolsafe.app/assets/poolsafe-email-logo.png'));
  assert.ok(html.includes('PoolSafe'));
  assert.ok(html.includes('Redefinição de senha'));

  // 2. HTML contém código e validade
  assert.ok(html.includes('AB7K-2P9Q'));
  assert.ok(html.includes('15 minutos'));

  // 3. HTML contém avisos de segurança
  assert.ok(html.includes('O PoolSafe nunca solicita sua senha'));

  // 4. Versão texto plano
  assert.ok(text.includes('PoolSafe — Redefinição de senha'));
  assert.ok(text.includes('AB7K-2P9Q'));
  assert.ok(text.includes('15 minutos'));
  assert.ok(text.includes('O PoolSafe nunca solicita sua senha'));

  // 5. Template sem EMAIL_LOGO_URL não quebra imagem
  const noLogoConfigService = {
    get: (key: string) => (key === 'EMAIL_FROM' ? 'PoolSafe <nao-responda@send.poolsafe.app>' : undefined),
  };
  const emailServiceNoLogo = new EmailService(noLogoConfigService as any);
  const htmlNoLogo = emailServiceNoLogo.buildHtmlTemplate(code, ttlMinutes);
  assert.ok(!htmlNoLogo.includes('<img src='), 'Não deve renderizar tag img quando a URL estiver ausente');
  assert.ok(htmlNoLogo.includes('PoolSafe'), 'Deve preservar o nome PoolSafe em texto');
});

test('PasswordResetRateLimiter - Limites por e-mail (3/hora) e por IP (10/hora)', () => {
  const limiter = new PasswordResetRateLimiter();
  const email = 'usuario.teste@example.com';
  const ip = '192.168.1.100';

  // 3 chamadas válidas para o mesmo e-mail
  limiter.checkAndRecord(email, ip);
  limiter.checkAndRecord(email, ip);
  limiter.checkAndRecord(email, ip);

  // 4ª chamada com o mesmo e-mail deve estourar o limite (3/hora)
  assert.throws(
    () => {
      limiter.checkAndRecord(email, '192.168.1.101');
    },
    (err: any) => {
      assert.ok(err instanceof RateLimitedException);
      assert.equal(err.code, 'RATE_LIMITED');
      assert.ok(typeof err.retryAfterSeconds === 'number' && err.retryAfterSeconds > 0 && err.retryAfterSeconds <= 3600);
      return true;
    },
  );

  // Limpa para testar o limite de IP
  limiter.clear();

  // 10 chamadas com o mesmo IP mas e-mails diferentes
  for (let i = 0; i < 10; i++) {
    limiter.checkAndRecord(`usuario${i}@example.com`, '10.0.0.50');
  }

  // 11ª chamada com o mesmo IP deve estourar o limite (10/hora)
  assert.throws(
    () => {
      limiter.checkAndRecord('outro.usuario@example.com', '10.0.0.50');
    },
    (err: any) => {
      assert.ok(err instanceof RateLimitedException);
      assert.equal(err.code, 'RATE_LIMITED');
      assert.ok(typeof err.retryAfterSeconds === 'number' && err.retryAfterSeconds > 0 && err.retryAfterSeconds <= 3600);
      return true;
    },
  );
});
