/**
 * Identidade tipada do usuário autenticado anexada ao request.
 */
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: Date;
  sessionId: string;
}
