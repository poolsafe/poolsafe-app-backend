import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * ProblemDetailsFilter — filtro global de erros conforme RFC 9457.
 *
 * Formata todas as exceções como `application/problem+json`.
 * O campo `X-Request-Id` é preservado da requisição ou gerado pelo middleware.
 *
 * Referência: https://www.rfc-editor.org/rfc/rfc9457
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestId = (request.headers['x-request-id'] as string) ?? '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let errors: unknown[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      title = exception.message;

      const exceptionResponse = exception.getResponse();

      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        const msg = (exceptionResponse as { message: unknown }).message;

        if (Array.isArray(msg)) {
          // Erros de validação do class-validator
          title = 'Unprocessable Entity';
          errors = msg as unknown[];
        } else if (typeof msg === 'string') {
          detail = msg;
        }
      }
    } else if (exception instanceof Error) {
      // Erros internos: logar sem expor detalhes ao cliente
      this.logger.error({ requestId, err: exception }, 'Unhandled exception');
    }

    const body = {
      type: `https://poolsafe.example/problems/${status}`,
      title,
      status,
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
      instance: request.url,
      requestId,
    };

    response
      .status(status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(body);
  }
}
