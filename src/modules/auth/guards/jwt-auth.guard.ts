import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../token.service.js';
import { SessionService } from '../session.service.js';
import { AuthenticationRequiredException } from '../../../common/errors/problem-details.exception.js';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * JwtAuthGuard — Proteção de rotas autenticadas da API.
 *
 * Em toda requisição protegida:
 * 1. Extrai o Bearer token do header Authorization
 * 2. Valida a assinatura RS256, expiração, issuer e audience
 * 3. Extrai sub (userId) e sid (sessionId)
 * 4. Consulta a sessão no banco em tempo real (revogada_em, expira_em, pertencimento e status do usuário)
 * 5. Garante que revogação ou bloqueio tenham efeito imediato
 * 6. Anexa a identidade tipada AuthenticatedUser ao objeto Request
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      throw new AuthenticationRequiredException('Token de autenticação não fornecido.');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
      throw new AuthenticationRequiredException(
        'Formato do cabeçalho de autorização deve ser: Bearer <token>.',
      );
    }

    const token = parts[1];
    if (!token) {
      throw new AuthenticationRequiredException('Token de autenticação ausente.');
    }

    // 1. Validação estrita do JWT RS256
    const payload = this.tokenService.verifyAccessToken(token);

    // 2. Validação da sessão ativa no banco (efeito imediato de revogação/desativação)
    const user = await this.sessionService.validateSessionForAuth(
      payload.sub,
      payload.sid,
    );

    // 3. Disponibiliza a identidade tipada
    request.user = user;
    return true;
  }
}
