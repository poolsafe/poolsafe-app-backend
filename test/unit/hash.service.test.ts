import test from 'node:test';
import assert from 'node:assert/strict';
import { HashService } from '../../dist/modules/auth/hash.service.js';

test('HashService - Geração e verificação de hash com Argon2id', async () => {
  const hashService = new HashService();
  const password = 'SuperSecretPassword123!';

  // 1. Gera o hash
  const hash = await hashService.hash(password);

  // 2. Valida formato canônico do Argon2id (v=19, m=65536, t=3, p=4)
  assert.ok(
    hash.startsWith('$argon2id$v=19$m=65536,'),
    'O hash deve começar com parâmetros do Argon2id (v=19, m=65536)',
  );
  assert.ok(
    hash.includes('p=4') && hash.includes('t=3'),
    'O hash deve conter paralelismo 4 e custo de tempo 3',
  );

  // 3. Verificação de senha correta
  const isValid = await hashService.verify(hash, password);
  assert.equal(isValid, true, 'A verificação da senha correta deve retornar true');

  // 4. Verificação de senha incorreta
  const isInvalid = await hashService.verify(hash, 'WrongPassword456!');
  assert.equal(isInvalid, false, 'A verificação de senha incorreta deve retornar false');

  // 5. Dummy verification não deve lançar exceção
  await assert.doesNotReject(async () => {
    await hashService.dummyVerify('anyPassword');
  });
});
