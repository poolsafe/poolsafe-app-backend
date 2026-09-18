import { defineConfig } from 'prisma/config';

/**
 * prisma.config.ts — configuração do Prisma ORM 7.
 *
 * No Prisma 7, esta é a forma de configurar schema, migrations e datasource
 * para a CLI do Prisma (prisma migrate, prisma generate, etc.).
 *
 * O adapter de conexão (@prisma/adapter-mariadb) é configurado no runtime,
 * no PrismaService, e passado ao construtor do PrismaClient.
 *
 * Referência: https://pris.ly/d/config-datasource
 *
 * Nunca commite credenciais reais neste arquivo.
 */
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
  migrations: {
    path: './prisma/migrations',
  },
});
