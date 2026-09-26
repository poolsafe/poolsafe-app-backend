import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ProblemDetailsException,
  ProblemErrorItem,
} from '../errors/problem-details.exception.js';

function toKebabCase(str: string): string {
  return str.toLowerCase().replace(/_/g, '-');
}

/**
 * Mapeamento padrão de código canônico e título para status HTTP.
 */
function getDefaultProblemMetadata(status: number): { code: string; title: string; detail: string } {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return {
        code: 'MALFORMED_REQUEST',
        title: 'Requisição inválida',
        detail: 'Corpo da requisição ilegível ou JSON inválido.',
      };
    case HttpStatus.UNAUTHORIZED:
      return {
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Autenticação obrigatória',
        detail: 'Token de autenticação ausente ou inválido.',
      };
    case HttpStatus.FORBIDDEN:
      return {
        code: 'ACCESS_DENIED',
        title: 'Acesso negado',
        detail: 'Você não possui permissão para acessar este recurso.',
      };
    case HttpStatus.NOT_FOUND:
      return {
        code: 'RESOURCE_NOT_FOUND',
        title: 'Recurso não encontrado',
        detail: 'O recurso solicitado não foi encontrado.',
      };
    case HttpStatus.CONFLICT:
      return {
        code: 'RESOURCE_CONFLICT',
        title: 'Conflito de recurso',
        detail: 'Não foi possível concluir a operação devido a um conflito.',
      };
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return {
        code: 'VALIDATION_ERROR',
        title: 'Dados inválidos',
        detail: 'Um ou mais campos precisam ser corrigidos.',
      };
    case HttpStatus.TOO_MANY_REQUESTS:
      return {
        code: 'RATE_LIMITED',
        title: 'Limite temporário excedido',
        detail: 'Muitas requisições. Tente novamente mais tarde.',
      };
    case HttpStatus.SERVICE_UNAVAILABLE:
      return {
        code: 'SERVICE_UNAVAILABLE',
        title: 'Serviço indisponível',
        detail: 'Dependência essencial indisponível.',
      };
    default:
      return {
        code: 'INTERNAL_SERVER_ERROR',
        title: 'Erro interno do servidor',
        detail: 'Ocorreu um erro interno inesperado.',
      };
  }
}

/**
 * ProblemDetailsFilter — filtro global de erros conforme RFC 9457 e docs/api-contract.md Seção 8.
 *
 * Formata todas as exceções como `application/problem+json`.
 * O campo `X-Request-Id` é preservado da requisição ou gerado pelo middleware.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestId = (request.headers['x-request-id'] as string) || '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let title = 'Erro interno do servidor';
    let detail = 'Ocorreu um erro interno inesperado.';
    let errors: ProblemErrorItem[] | undefined;

    if (exception instanceof ProblemDetailsException) {
      status = exception.getStatus();
      code = exception.code;
      title = exception.title;
      detail = exception.detailMessage;
      errors = exception.errorsList;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const meta = getDefaultProblemMetadata(status);
      code = meta.code;
      title = meta.title;
      detail = meta.detail;

      const exceptionResponse = exception.getResponse();

      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const respObj = exceptionResponse as Record<string, unknown>;

        if (typeof respObj['code'] === 'string') {
          code = respObj['code'];
        }
        if (typeof respObj['title'] === 'string') {
          title = respObj['title'];
        }
        if (typeof respObj['detail'] === 'string') {
          detail = respObj['detail'];
        } else if (typeof respObj['message'] === 'string') {
          detail = respObj['message'];
        }

        if (Array.isArray(respObj['errors'])) {
          errors = respObj['errors'] as ProblemErrorItem[];
        }
      }
    } else if (exception instanceof Error) {
      // Tratar erro de sintaxe JSON do body-parser
      if ('type' in exception && exception.type === 'entity.parse.failed') {
        status = HttpStatus.BAD_REQUEST;
        code = 'MALFORMED_REQUEST';
        title = 'Requisição inválida';
        detail = 'Corpo da requisição ilegível ou JSON inválido.';
      } else {
        // Erros internos: logar sem expor detalhes internos ao cliente
        this.logger.error({ requestId, err: exception }, 'Unhandled exception');
      }
    }

    const problemBody = {
      type: `urn:poolsafe:problem:${toKebabCase(code)}`,
      title,
      status,
      detail,
      instance: `urn:poolsafe:request:${requestId}`,
      code,
      requestId,
      ...(errors && errors.length > 0 ? { errors } : {}),
    };

    response
      .status(status)
      .setHeader('Content-Type', 'application/problem+json')
      .setHeader('X-Request-Id', requestId)
      .json(problemBody);
  }
}
