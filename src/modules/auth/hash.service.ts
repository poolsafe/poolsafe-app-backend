import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * HashService — Gerenciamento centralizado de hash e verificação de senhas com Argon2id.
 *
 * Configurações recomendadas pela OWASP para Argon2id:
 * - Tipo: Argon2id (v=19)
 * - memoryCost: 65536 KiB (64 MiB)
 * - timeCost: 3 iterações
 * - parallelism: 4 threads
 *
 * NUNCA armazene ou registre senhas em texto puro.
 * NUNCA retorne o hash de senha em respostas da API.
 */
@Injectable()
export class HashService {
  private readonly logger = new Logger(HashService.name);

  // Parâmetros centralizados do Argon2id
  private readonly options: argon2.HashOptions = {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  };

  // Hash pré-calculado com os mesmos parâmetros para verificação de tempo constante
  // quando o usuário não for encontrado no banco de dados (mitigação de timing attack)
  private readonly dummyHash =
    '$argon2id$v=19$m=65536,t=3,p=4$tempDummySaltForConstantTimeVerify$70EtOnoXNDwCub0GK+NXlbcks6gDLPwPKSKRHufZ9Q4';

  /**
   * Gera o hash seguro da senha usando Argon2id.
   */
  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, { ...this.options, raw: false });
  }

  /**
   * Verifica se a senha em texto puro corresponde ao hash Argon2id informado.
   */
  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch (err) {
      this.logger.warn({ err }, 'Falha na verificação do hash Argon2id');
      return false;
    }
  }

  /**
   * Executa uma verificação falsa com hash fixo para igualar o tempo de resposta
   * quando o usuário não existe no login, impedindo ataques de temporização para enumeração.
   */
  async dummyVerify(plainPassword: string): Promise<void> {
    try {
      await argon2.verify(this.dummyHash, plainPassword);
    } catch {
      // Ignora erro intencional do hash dummy
    }
  }
}
