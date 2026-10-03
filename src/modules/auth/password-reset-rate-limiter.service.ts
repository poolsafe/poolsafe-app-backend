import { Injectable } from '@nestjs/common';
import { RateLimitedException } from '../../common/errors/problem-details.exception.js';

interface RateLimitRecord {
  timestamps: number[];
}

@Injectable()
export class PasswordResetRateLimiter {
  // Limites definidos em docs/api-contract.md Seção 23:
  // recuperação: 3/hora por e-mail e 10/hora por IP
  private readonly EMAIL_LIMIT = 3;
  private readonly EMAIL_WINDOW_MS = 60 * 60 * 1000; // 1 hora

  private readonly IP_LIMIT = 10;
  private readonly IP_WINDOW_MS = 60 * 60 * 1000; // 1 hora

  private readonly emailRecords = new Map<string, RateLimitRecord>();
  private readonly ipRecords = new Map<string, RateLimitRecord>();

  /**
   * Verifica se a solicitação excede os limites de e-mail ou IP.
   * Se exceder, lança RateLimitedException com o tempo em segundos para Retry-After.
   * Se não exceder, registra a tentativa.
   */
  checkAndRecord(normalizedEmail: string, clientIp: string): void {
    const now = Date.now();

    // 1. Verificar limite por e-mail
    if (normalizedEmail) {
      const emailRecord = this.emailRecords.get(normalizedEmail) ?? { timestamps: [] };
      // Limpa timestamps fora da janela
      emailRecord.timestamps = emailRecord.timestamps.filter(
        (t) => now - t < this.EMAIL_WINDOW_MS,
      );

      if (emailRecord.timestamps.length >= this.EMAIL_LIMIT) {
        const oldest = emailRecord.timestamps[0]!;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.EMAIL_WINDOW_MS - now) / 1000));
        throw new RateLimitedException(
          'Muitas solicitações de recuperação para este e-mail. Tente novamente mais tarde.',
          retryAfterSeconds,
        );
      }
    }

    // 2. Verificar limite por IP
    if (clientIp) {
      const ipRecord = this.ipRecords.get(clientIp) ?? { timestamps: [] };
      ipRecord.timestamps = ipRecord.timestamps.filter(
        (t) => now - t < this.IP_WINDOW_MS,
      );

      if (ipRecord.timestamps.length >= this.IP_LIMIT) {
        const oldest = ipRecord.timestamps[0]!;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.IP_WINDOW_MS - now) / 1000));
        throw new RateLimitedException(
          'Muitas solicitações de recuperação originadas deste endereço de rede. Tente novamente mais tarde.',
          retryAfterSeconds,
        );
      }
    }

    // Registra a tentativa em ambas as chaves
    if (normalizedEmail) {
      const record = this.emailRecords.get(normalizedEmail) ?? { timestamps: [] };
      record.timestamps.push(now);
      this.emailRecords.set(normalizedEmail, record);
    }

    if (clientIp) {
      const record = this.ipRecords.get(clientIp) ?? { timestamps: [] };
      record.timestamps.push(now);
      this.ipRecords.set(clientIp, record);
    }
  }

  /**
   * Limpa os registros de limite (útil para suítes de teste).
   */
  clear(): void {
    this.emailRecords.clear();
    this.ipRecords.clear();
  }
}
