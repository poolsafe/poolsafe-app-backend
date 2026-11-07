import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateCameraHeartbeatDto,
  type CameraHeartbeatPayload,
} from '../../dist/modules/cameras/dto/camera-heartbeat.dto.js';
import {
  HEARTBEAT_FUTURE_TOLERANCE_MS,
  InternalCamerasService,
} from '../../dist/modules/cameras/internal-cameras.service.js';
import {
  CameraNotFoundException,
  InvalidCameraHeartbeatException,
} from '../../dist/common/errors/problem-details.exception.js';

describe('Unit — Validação de DTO e regras de domínio do Heartbeat de Câmera', () => {
  test('1. Valida DTO correto com sucesso (incluindo expiresAt igual ou posterior a observedAt)', () => {
    const valid: CameraHeartbeatPayload = {
      eventId: randomUUID(),
      cameraCode: 'CAM-TESTE-9B',
      observedAt: '2026-11-07T18:00:00.000Z',
      expiresAt: '2026-11-07T18:01:00.000Z',
      test: true,
    };

    const parsed = validateCameraHeartbeatDto(valid);
    assert.equal(parsed.eventId, valid.eventId);
    assert.equal(parsed.cameraCode, 'CAM-TESTE-9B');
    assert.equal(parsed.observedAt, valid.observedAt);
    assert.equal(parsed.expiresAt, valid.expiresAt);
    assert.equal(parsed.test, true);

    const equalDates = validateCameraHeartbeatDto({
      ...valid,
      expiresAt: valid.observedAt,
    });
    assert.equal(equalDates.expiresAt, valid.observedAt);
  });

  test('2. Rejeita eventId inválido, cameraCode vazio, datas inválidas, test não booleano e camera_id extra com 400', () => {
    const base: CameraHeartbeatPayload = {
      eventId: randomUUID(),
      cameraCode: 'CAM-TESTE-9B',
      observedAt: '2026-11-07T18:00:00.000Z',
      expiresAt: '2026-11-07T18:01:00.000Z',
      test: false,
    };

    const isBadRequestHeartbeatError = (err: unknown): boolean =>
      err instanceof InvalidCameraHeartbeatException &&
      err.getStatus() === 400 &&
      err.code === 'VALIDATION_ERROR';

    // eventId inválido
    assert.throws(
      () => validateCameraHeartbeatDto({ ...base, eventId: 'nao-e-uuid' }),
      isBadRequestHeartbeatError,
    );

    // cameraCode vazio ou só espaços
    assert.throws(
      () => validateCameraHeartbeatDto({ ...base, cameraCode: '' }),
      isBadRequestHeartbeatError,
    );
    assert.throws(
      () => validateCameraHeartbeatDto({ ...base, cameraCode: '   ' }),
      isBadRequestHeartbeatError,
    );

    // observedAt / expiresAt inválidos ou sem fuso/hora
    assert.throws(
      () => validateCameraHeartbeatDto({ ...base, observedAt: '2026-11-07' }),
      isBadRequestHeartbeatError,
    );
    assert.throws(
      () => validateCameraHeartbeatDto({ ...base, expiresAt: 'data-invalida' }),
      isBadRequestHeartbeatError,
    );

    // expiresAt anterior a observedAt
    assert.throws(
      () =>
        validateCameraHeartbeatDto({
          ...base,
          observedAt: '2026-11-07T18:01:00.000Z',
          expiresAt: '2026-11-07T18:00:59.999Z',
        }),
      isBadRequestHeartbeatError,
    );

    // test não booleano
    assert.throws(
      () =>
        validateCameraHeartbeatDto({
          ...base,
          test: 'true' as unknown as boolean,
        }),
      isBadRequestHeartbeatError,
    );

    // camera_id operacional enviado pelo worker deve ser rejeitado (unknown field -> 400)
    assert.throws(
      () =>
        validateCameraHeartbeatDto({
          ...base,
          camera_id: 99,
        } as unknown),
      isBadRequestHeartbeatError,
    );
  });

  test('3. Rejeita observedAt futuro além da tolerância explícita de 5 segundos com 400', async () => {
    assert.equal(HEARTBEAT_FUTURE_TOLERANCE_MS, 5_000);

    const fakePrisma = {
      getClient: () => ({
        camera: {
          findUnique: async () => {
            throw new Error(
              'Não deve consultar o banco se observedAt for excessivamente futuro',
            );
          },
        },
      }),
    };

    const service = new InternalCamerasService(fakePrisma as never);
    const now = new Date('2026-11-07T18:00:00.000Z');
    const tooFuture = new Date(
      now.getTime() + HEARTBEAT_FUTURE_TOLERANCE_MS + 1,
    ).toISOString();
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();

    await assert.rejects(
      () =>
        service.processHeartbeat(
          {
            eventId: randomUUID(),
            cameraCode: 'CAM-TESTE-9B',
            observedAt: tooFuture,
            expiresAt,
            test: true,
          },
          'req-unit-future',
          now,
        ),
      (err: unknown) =>
        err instanceof InvalidCameraHeartbeatException &&
        err.getStatus() === 400,
    );
  });

  test('4. Retorna 404 CAMERA_NOT_FOUND quando a câmera não existe', async () => {
    const fakePrisma = {
      getClient: () => ({
        camera: {
          findUnique: async () => null,
        },
      }),
    };

    const service = new InternalCamerasService(fakePrisma as never);
    const now = new Date('2026-11-07T18:00:00.000Z');

    await assert.rejects(
      () =>
        service.processHeartbeat(
          {
            eventId: randomUUID(),
            cameraCode: 'CAM-INEXISTENTE-999',
            observedAt: '2026-11-07T18:00:00.000Z',
            expiresAt: '2026-11-07T18:01:00.000Z',
            test: true,
          },
          'req-unit-404',
          now,
        ),
      (err: unknown) =>
        err instanceof CameraNotFoundException &&
        err.getStatus() === 404 &&
        err.code === 'CAMERA_NOT_FOUND',
    );
  });

  test('5. Confirma que nenhuma migration adicional foi criada no diretório prisma/migrations', () => {
    const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
    let entries: string[] = [];
    try {
      entries = readdirSync(migrationsDir);
    } catch {
      entries = [];
    }
    const heartbeatMigrations = entries.filter((name) =>
      name.toLowerCase().includes('heartbeat'),
    );
    assert.equal(
      heartbeatMigrations.length,
      0,
      'Nenhuma migration de heartbeat deve existir',
    );
  });
});
