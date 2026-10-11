import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  /**
   * Chave RSA privada codificada em Base64 para assinatura RS256 dos Access Tokens.
   */
  @IsString()
  JWT_PRIVATE_KEY_BASE64!: string;

  /**
   * Chave RSA pública codificada em Base64 para verificação RS256 dos Access Tokens.
   */
  @IsString()
  JWT_PUBLIC_KEY_BASE64!: string;

  /**
   * Identificador do emissor (iss) do token JWT.
   */
  @IsString()
  JWT_ISSUER: string = 'poolsafe-api';

  /**
   * Janela máxima sem comunicação para considerar a câmera online (em segundos).
   * Padrão: 90 segundos.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  CAMERA_OFFLINE_THRESHOLD_SECONDS: number = 90;

  /**
   * Chave da API do Resend para envio de e-mails transacionais (Fatia 3B).
   * Opcional em ambiente local/testes sem envio real.
   */
  @IsOptional()
  @IsString()
  RESEND_API_KEY?: string;

  /**
   * Remetente dos e-mails transacionais.
   * Padrão: PoolSafe <nao-responda@send.poolsafe.app>
   */
  @IsOptional()
  @IsString()
  EMAIL_FROM: string = 'PoolSafe <nao-responda@send.poolsafe.app>';

  /**
   * URL do logo oficial do PoolSafe para inserção no cabeçalho do e-mail.
   */
  @IsOptional()
  @IsString()
  EMAIL_LOGO_URL: string = 'https://poolsafe.app/assets/poolsafe-email-logo.png';

  /**
   * Tempo de vida (TTL) do código de recuperação de senha em minutos.
   * Padrão: 15 minutos.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  PASSWORD_RESET_TOKEN_TTL_MINUTES: number = 15;

  /**
   * Segredo criptográfico independente para assinatura HMAC-SHA256 do cursor de paginação de alertas (Fatia 7).
   * Padrão com fallback para desenvolvimento local.
   */
  @IsOptional()
  @IsString()
  ALERT_CURSOR_SECRET: string = 'poolsafe-alerts-cursor-secret-default';

  /**
   * Chave de autenticação de serviço para comunicação interna N8N -> API (Fatia 9B).
   * Separada das credenciais dos usuários.
   */
  @IsOptional()
  @IsString()
  INTERNAL_SERVICE_KEY?: string;
}

