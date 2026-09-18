import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb from 'mariadb';

/**
 * PrismaService — wrapper do PrismaClient para integração com o NestJS.
 *
 * No Prisma ORM 7 com driver adapters, o adapter é passado diretamente
 * ao construtor do PrismaClient. A URL de conexão vem de DATABASE_URL.
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

    const pool = mariadb.createPool(url);
    const adapter = new PrismaMariaDb(pool);

    this.client = new PrismaClient({ adapter } as import('@prisma/client').Prisma.PrismaClientOptions);
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
