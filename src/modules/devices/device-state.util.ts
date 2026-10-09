import type { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from '../auth/session.service.js';

/**
 * Formato aceito para o identificador da instalação (UUID gerado pelo aplicativo).
 * Aceita qualquer versão RFC 9562 (1 a 8) e é comparado em minúsculas, pois a coluna
 * `identificador_instalacao` usa collation binária (`utf8mb4_bin`).
 */
const INSTALLATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Normaliza e valida o identificador de instalação. Retorna `null` quando inválido.
 */
export function normalizeInstallationId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const candidate = raw.trim();
  if (!INSTALLATION_ID_PATTERN.test(candidate)) {
    return null;
  }
  return candidate.toLowerCase();
}

/**
 * Invalida instalações de forma centralizada (logout, DELETE, troca/recuperação de senha).
 *
 * Efeito (docs/domain-model.md §7.3 e docs/database-schema.md §6.1):
 * - `ativo = false` e `invalidado_em` preenchido (exigido pela constraint `ck_dispositivo_invalidacao`);
 * - remove o vínculo utilizável do FCM Token (`fcm_token = NULL`), de modo que o registro
 *   deixa de ser elegível para push e o token deixa de existir em uma linha inativa;
 * - preserva a linha (e, portanto, o histórico de `entrega_notificacao`).
 *
 * Idempotente: linhas já inativas e sem token não são alteradas, preservando o
 * `invalidado_em` original.
 *
 * @returns quantidade de registros efetivamente alterados.
 */
export async function invalidateDevices(
  tx: PrismaTransactionClient,
  where: Prisma.DeviceWhereInput,
  now: Date,
): Promise<number> {
  const result = await tx.device.updateMany({
    where: {
      AND: [where, { OR: [{ active: true }, { fcmToken: { not: null } }] }],
    },
    data: {
      active: false,
      invalidatedAt: now,
      fcmToken: null,
    },
  });
  return result.count;
}
