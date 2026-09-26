import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

export interface UserProfileResponse {
  data: {
    id: string;
    name: string;
    email: string;
    status: string;
    createdAt: string;
  };
  meta: {
    requestId: string;
  };
}

@Injectable()
export class UsersService {
  /**
   * Formata os dados do perfil do usuário autenticado conforme docs/api-contract.md Seção 12.1.
   */
  getProfile(user: AuthenticatedUser, requestId: string): UserProfileResponse {
    return {
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
      },
      meta: {
        requestId,
      },
    };
  }
}
