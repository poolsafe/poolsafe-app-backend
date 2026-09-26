import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from '../../dist/modules/auth/token.service.js';
import { AuthenticationRequiredException } from '../../dist/common/errors/problem-details.exception.js';

test('TokenService - Emissão e validação de Access Tokens JWT RS256', () => {
  const jwtService = new JwtService();
  const tokenService = new TokenService(jwtService);
  tokenService.onModuleInit();

  const userId = '101';
  const sessionId = '555';

  // 1. Gera token
  const { accessToken, accessExpiresAt } = tokenService.generateAccessToken(userId, sessionId);
  assert.ok(accessToken, 'O access token deve ser gerado');
  assert.ok(accessExpiresAt instanceof Date, 'accessExpiresAt deve ser uma data');

  // 2. Valida cabeçalho e algoritmo RS256
  const [headerB64] = accessToken.split('.');
  assert.ok(headerB64);
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  assert.equal(header.alg, 'RS256', 'O algoritmo deve ser estritamente RS256');

  // 3. Valida claims mínimas
  const payload = tokenService.verifyAccessToken(accessToken);
  assert.equal(payload.sub, userId, 'Claim sub deve corresponder ao userId');
  assert.equal(payload.sid, sessionId, 'Claim sid deve corresponder ao sessionId');
  assert.equal(payload.aud, 'poolsafe-app', 'Audience deve ser poolsafe-app');
  assert.equal(payload.iss, 'poolsafe-api', 'Issuer deve ser poolsafe-api');
  assert.ok(payload.jti && payload.jti.length > 0, 'jti deve ser gerado');
  assert.ok(typeof payload.iat === 'number', 'iat deve ser número');
  assert.ok(typeof payload.exp === 'number', 'exp deve ser número');

  // 4. Validade de 15 minutos (900 segundos)
  assert.equal(payload.exp - payload.iat, 900, 'A validade do access token deve ser exatamente de 15 minutos (900 segundos)');

  // 5. Token adulterado deve falhar
  const tampered = accessToken.slice(0, -6) + 'xxxxxx';
  assert.throws(
    () => tokenService.verifyAccessToken(tampered),
    (err: unknown) => err instanceof AuthenticationRequiredException,
    'Token adulterado deve lançar AuthenticationRequiredException',
  );

  // 6. Token com algoritmo HS256 não deve ser aceito
  const forgedToken = jwtService.sign({ sub: userId, sid: sessionId }, { secret: 'forgedSecret', algorithm: 'HS256' });
  assert.throws(
    () => tokenService.verifyAccessToken(forgedToken),
    (err: unknown) => err instanceof AuthenticationRequiredException,
    'Token com algoritmo não-RS256 deve ser rejeitado',
  );
});
