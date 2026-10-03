import { HttpException, HttpStatus } from '@nestjs/common';

export interface ProblemErrorItem {
  pointer: string;
  code: string;
  detail: string;
}

export interface ProblemDetailsOptions {
  status: number;
  code: string;
  title: string;
  detail: string;
  errors?: ProblemErrorItem[];
  extensions?: Record<string, unknown>;
}

/**
 * Exceção base para respostas de erro formatadas conforme RFC 9457 Problem Details.
 *
 * Referência: docs/api-contract.md Seção 8.
 */
export class ProblemDetailsException extends HttpException {
  public readonly code: string;
  public readonly title: string;
  public readonly detailMessage: string;
  public readonly errorsList?: ProblemErrorItem[];
  public readonly extensions?: Record<string, unknown>;

  constructor(options: ProblemDetailsOptions) {
    super(
      {
        status: options.status,
        code: options.code,
        title: options.title,
        detail: options.detail,
        errors: options.errors,
        ...(options.extensions ? options.extensions : {}),
      },
      options.status,
    );
    this.code = options.code;
    this.title = options.title;
    this.detailMessage = options.detail;
    this.errorsList = options.errors;
    this.extensions = options.extensions;
  }
}

export class InvalidCredentialsException extends ProblemDetailsException {
  constructor(detail = 'Credenciais inválidas.') {
    super({
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_CREDENTIALS',
      title: 'Credenciais inválidas',
      detail,
    });
  }
}

export class AuthenticationRequiredException extends ProblemDetailsException {
  constructor(detail = 'Token de autenticação ausente ou inválido.') {
    super({
      status: HttpStatus.UNAUTHORIZED,
      code: 'AUTHENTICATION_REQUIRED',
      title: 'Autenticação obrigatória',
      detail,
    });
  }
}

export class SessionExpiredException extends ProblemDetailsException {
  constructor(detail = 'Sessão expirada ou revogada.') {
    super({
      status: HttpStatus.UNAUTHORIZED,
      code: 'SESSION_EXPIRED',
      title: 'Sessão expirada',
      detail,
    });
  }
}

export class AccessDeniedException extends ProblemDetailsException {
  constructor(detail = 'Acesso negado ao recurso solicitado.') {
    super({
      status: HttpStatus.FORBIDDEN,
      code: 'ACCESS_DENIED',
      title: 'Acesso negado',
      detail,
    });
  }
}

export class ResourceConflictException extends ProblemDetailsException {
  constructor(detail = 'Não foi possível concluir a operação devido a um conflito.') {
    super({
      status: HttpStatus.CONFLICT,
      code: 'RESOURCE_CONFLICT',
      title: 'Conflito de recurso',
      detail,
    });
  }
}

export class AccountCannotBeCreatedException extends ProblemDetailsException {
  constructor(detail = 'Não foi possível concluir o cadastro com os dados informados.') {
    super({
      status: HttpStatus.CONFLICT,
      code: 'ACCOUNT_CANNOT_BE_CREATED',
      title: 'Conflito de cadastro',
      detail,
    });
  }
}


export class MalformedRequestException extends ProblemDetailsException {
  constructor(detail = 'Corpo da requisição ilegível ou JSON inválido.') {
    super({
      status: HttpStatus.BAD_REQUEST,
      code: 'MALFORMED_REQUEST',
      title: 'Requisição inválida',
      detail,
    });
  }
}

export class ReauthenticationFailedException extends ProblemDetailsException {
  constructor(detail = 'A senha atual informada está incorreta.') {
    super({
      status: HttpStatus.FORBIDDEN,
      code: 'REAUTHENTICATION_FAILED',
      title: 'Falha na reautenticação',
      detail,
    });
  }
}

export class ResourceNotFoundException extends ProblemDetailsException {
  constructor(detail = 'Recurso não encontrado ou inexistente.') {
    super({
      status: HttpStatus.NOT_FOUND,
      code: 'RESOURCE_NOT_FOUND',
      title: 'Recurso não encontrado',
      detail,
    });
  }
}

export class InvalidResetTokenException extends ProblemDetailsException {
  constructor(detail = 'O código de recuperação informado é inválido ou já foi utilizado.') {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'INVALID_RESET_TOKEN',
      title: 'Token de recuperação inválido',
      detail,
    });
  }
}

export class ResetTokenExpiredException extends ProblemDetailsException {
  constructor(detail = 'O código de recuperação informado expirou. Solicite um novo código.') {
    super({
      status: HttpStatus.GONE,
      code: 'RESET_TOKEN_EXPIRED',
      title: 'Token de recuperação expirado',
      detail,
    });
  }
}

export class RateLimitedException extends ProblemDetailsException {
  public readonly retryAfterSeconds?: number;

  constructor(
    detail = 'Muitas solicitações em sequência. Tente novamente mais tarde.',
    retryAfterSeconds?: number,
  ) {
    super({
      status: HttpStatus.TOO_MANY_REQUESTS,
      code: 'RATE_LIMITED',
      title: 'Limite temporário excedido',
      detail,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class MonitoringStateConflictException extends ProblemDetailsException {
  constructor(detail = 'Não foi possível concluir a operação devido a um conflito no estado da sessão ou das câmeras.') {
    super({
      status: HttpStatus.CONFLICT,
      code: 'MONITORING_STATE_CONFLICT',
      title: 'Conflito de estado de monitoramento',
      detail,
    });
  }
}

export class CameraNotOperationalException extends ProblemDetailsException {
  constructor(detail = 'Uma ou mais câmeras selecionadas não estão operacionais (inativas, offline ou desconhecidas).') {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'CAMERA_NOT_OPERATIONAL',
      title: 'Câmera não operacional',
      detail,
    });
  }
}

export class EvidenceNotFoundException extends ProblemDetailsException {
  constructor(detail = 'Evidência não encontrada para este alerta.') {
    super({
      status: HttpStatus.NOT_FOUND,
      code: 'EVIDENCE_NOT_FOUND',
      title: 'Evidência não encontrada',
      detail,
    });
  }
}

export class EvidenceUnavailableException extends ProblemDetailsException {
  constructor(
    detail = 'Evidência indisponível.',
    reason: 'EXPIRED' | 'REMOVED' = 'EXPIRED',
  ) {
    super({
      status: HttpStatus.GONE,
      code: 'EVIDENCE_UNAVAILABLE',
      title: 'Evidência indisponível',
      detail,
      extensions: { reason },
    });
  }
}

