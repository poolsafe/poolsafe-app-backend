import { createHmac, timingSafeEqual } from 'node:crypto';
import { MalformedRequestException } from '../../common/errors/problem-details.exception.js';

export interface AlertCursorPayload {
  detectedAt: string;
  id: string;
}

/**
 * Gera um cursor opaco e assinado com HMAC-SHA256 para paginação estável.
 * Encapsula a data de detecção (ISO UTC) e o identificador do último alerta da página.
 */
export function generateAlertCursor(
  detectedAt: Date,
  id: string,
  secret: string,
): string {
  const isoDate = detectedAt.toISOString();
  const rawPayload = `${isoDate}|${id}`;
  const hmac = createHmac('sha256', secret).update(rawPayload).digest('base64url');
  const cursorObj = {
    d: isoDate,
    i: id,
    s: hmac,
  };
  return Buffer.from(JSON.stringify(cursorObj), 'utf8').toString('base64url');
}

/**
 * Decodifica e valida a autenticidade e integridade do cursor de paginação.
 * Se o cursor estiver corrompido, adulterado ou com assinatura inválida,
 * lança MalformedRequestException.
 */
export function parseAndValidateAlertCursor(
  cursorStr: string,
  secret: string,
): AlertCursorPayload {
  try {
    const jsonStr = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Formato inválido');
    }
    const { d, i, s } = parsed;
    if (typeof d !== 'string' || typeof i !== 'string' || typeof s !== 'string') {
      throw new Error('Campos obrigatórios ausentes');
    }

    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) {
      throw new Error('Data inválida no cursor');
    }

    if (!/^\d+$/.test(i)) {
      throw new Error('ID inválido no cursor');
    }

    const rawPayload = `${d}|${i}`;
    const expectedHmac = createHmac('sha256', secret).update(rawPayload).digest('base64url');

    const expectedBuf = Buffer.from(expectedHmac, 'utf8');
    const actualBuf = Buffer.from(s, 'utf8');

    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new Error('Assinatura do cursor não confere');
    }

    return {
      detectedAt: d,
      id: i,
    };
  } catch {
    throw new MalformedRequestException('Cursor de paginação inválido ou adulterado.');
  }
}
