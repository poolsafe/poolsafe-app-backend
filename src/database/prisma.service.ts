import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

interface MariaDbPoolConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit: number;
  allowPublicKeyRetrieval?: boolean;
}

function parseDatabaseUrl(rawUrl: string): MariaDbPoolConfig {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL inválida: formato de URL inválido');
  }

  let host = parsed.hostname;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (!host) {
    host = 'localhost';
  }

  const parsedPort = parsed.port ? parseInt(parsed.port, 10) : 3306;
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3306;

  const user = parsed.username
    ? decodeURIComponent(parsed.username)
    : undefined;
  const password = parsed.password
    ? decodeURIComponent(parsed.password)
    : undefined;

  const rawPath = parsed.pathname.replace(/^\/+/, '');
  const database = rawPath ? decodeURIComponent(rawPath) : undefined;

  const limitParam =
    parsed.searchParams.get('connectionLimit') ??
    parsed.searchParams.get('connection_limit');
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : undefined;
  const connectionLimit =
    parsedLimit !== undefined &&
    Number.isInteger(parsedLimit) &&
    parsedLimit > 0
      ? parsedLimit
      : 10;

  const allowPublicKeyRetrievalParam = parsed.searchParams.get(
    'allowPublicKeyRetrieval',
  );
  const allowPublicKeyRetrieval =
    allowPublicKeyRetrievalParam !== null
      ? allowPublicKeyRetrievalParam === 'true'
      : true;

  return {
    host,
    port,
    user,
    password,
    database,
    connectionLimit,
    allowPublicKeyRetrieval,
  };
}

/**
 * PrismaService — wrapper do PrismaClient para integração com o NestJS.
 *
 * No Prisma ORM 7 com driver adapters, o adapter é passado diretamente
 * ao construtor do PrismaClient. As credenciais e parâmetros de conexão
 * são extraídos de forma segura a partir de DATABASE_URL (mysql://).
 *
 * Referência: https://pris.ly/d/config-datasource
 *
 * Não realiza operações de domínio nesta etapa do bootstrap.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: PrismaClient;

  constructor() {
    const url = process.env['DATABASE_URL'];
    if (!url) {
      throw new Error('DATABASE_URL não definida');
    }

    const poolConfig = parseDatabaseUrl(url);
    const adapter = new PrismaMariaDb(poolConfig);

    this.client = new PrismaClient({ adapter });
  }

  getClient(): PrismaClient {
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('Prisma conectado ao banco de dados');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
    this.logger.log('Prisma desconectado do banco de dados');
  }
}
