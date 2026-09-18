import { IsEnum, IsInt, IsString, Max, Min } from 'class-validator';

export enum AppEnvironment {
  Development = 'development',
  Production = 'production',
}

/**
 * Variáveis de ambiente obrigatórias e opcionais da API.
 * Validadas no startup pelo ConfigModule com validate().
 */
export class EnvConfig {
  @IsEnum(AppEnvironment)
  NODE_ENV: AppEnvironment = AppEnvironment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /**
   * URL de conexão com o MySQL no formato:
   * mysql://usuario:senha@host:3306/banco
   * Nunca versionar o valor real.
   */
  @IsString()
  DATABASE_URL!: string;

  /**
   * Tempo máximo de requisições por janela para o rate limiting global.
   * Padrão: 100 requisições a cada 60 segundos por IP.
   */
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number = 100;

  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS: number = 60;
}
