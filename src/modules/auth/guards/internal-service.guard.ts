import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { InvalidServiceSecretException } from '../../../common/errors/problem-details.exception.js';

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * InternalServiceGuard — Protege rotas de comunicação interna de serviço (N8N -> API).
 *
 * Utiliza autenticação por segredo compartilhado (INTERNAL_SERVICE_KEY) transmitido
 * via header X-Internal-Service-Key, X-Service-Key ou Authorization: Bearer <key>.
 * Realiza comparação em tempo constante para mitigar ataques de temporização.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  private readonly logger = new Logger(InternalServiceGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedKey = this.configService.get<string>('INTERNAL_SERVICE_KEY');

    if (!expectedKey || expectedKey.trim().length === 0) {
      this.logger.error(
        'INTERNAL_SERVICE_KEY não configurada no ambiente. Rejeitando chamada interna.',
      );
      throw new InvalidServiceSecretException(
        'Autenticação de serviço indisponível.',
      );
    }

    const headerDirect =
      request.headers['x-internal-service-key'] ||
      request.headers['x-service-key'];

    let providedKey: string | null = null;

    if (typeof headerDirect === 'string' && headerDirect.trim().length > 0) {
      providedKey = headerDirect.trim();
    } else {
      const authHeader = request.headers['authorization'];
      if (typeof authHeader === 'string') {
        const parts = authHeader.trim().split(' ');
        if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer') {
          providedKey = parts[1] || null;
        }
      }
    }

    if (!providedKey) {
      throw new InvalidServiceSecretException(
        'Chave de autenticação de serviço ausente.',
      );
    }

    if (!constantTimeEqual(providedKey, expectedKey)) {
      throw new InvalidServiceSecretException(
        'Chave de autenticação de serviço inválida.',
      );
    }

    return true;
  }
}
