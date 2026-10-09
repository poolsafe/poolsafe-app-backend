import { Injectable, PipeTransform } from '@nestjs/common';
import { ProblemDetailsException } from '../../../common/errors/problem-details.exception.js';
import { normalizeInstallationId } from '../device-state.util.js';

/**
 * Valida o parâmetro de rota `installationId` como UUID e o normaliza em minúsculas.
 * Entradas inválidas retornam 422 VALIDATION_ERROR (Problem Details), conforme o contrato.
 */
@Injectable()
export class InstallationIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const normalized = normalizeInstallationId(value);
    if (!normalized) {
      throw new ProblemDetailsException({
        status: 422,
        code: 'VALIDATION_ERROR',
        title: 'Dados inválidos',
        detail: 'Um ou mais campos precisam ser corrigidos.',
        errors: [
          {
            pointer: '/installationId',
            code: 'INVALID_UUID',
            detail: 'O installationId deve ser um UUID válido.',
          },
        ],
      });
    }
    return normalized;
  }
}
