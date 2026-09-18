# PoolSafe — Backend

API Node.js do PoolSafe, construída com NestJS 12 + TypeScript (ESM) + Prisma ORM 7.

## Requisitos

- Node.js 24 LTS
- npm
- Docker (para build da imagem)
- MySQL 8.4 (para execução completa com banco de dados)

## Bootstrap

```bash
# 1. Instalar dependências
npm install

# 2. Copiar e preencher variáveis de ambiente
cp .env.example .env

# 3. Verificar TypeScript
npm run typecheck

# 4. Compilar
npm run build

# 5. Iniciar em modo desenvolvimento
npm run start:dev
```

## Health checks

Com a API rodando localmente:

```bash
# Liveness
curl http://localhost:3000/api/v1/health/live

# Readiness
curl http://localhost:3000/api/v1/health/ready
```

## Prisma

```bash
# Validar schema (sem banco real)
DATABASE_URL="mysql://user:pass@localhost:3306/poolsafe" npm run prisma:validate

# Gerar client (sem banco real)
DATABASE_URL="mysql://user:pass@localhost:3306/poolsafe" npm run prisma:generate
```

> ⚠️ Não execute `prisma migrate dev` antes da modelagem das entidades ser autorizada.

## Docker

```bash
# Build da imagem
docker build -t poolsafe-backend .
```

## Estrutura

```
src/
  config/          Validação de variáveis de ambiente
  database/        PrismaModule e PrismaService
  common/filters/  Filtro global de erros (RFC 9457)
  modules/health/  Health checks (liveness e readiness)
  app.module.ts    Módulo raiz
  main.ts          Bootstrap da aplicação
prisma/
  schema.prisma    Schema Prisma (entidades pendentes)
scripts/
  generate-openapi.ts  Geração do openapi.yaml (pendente)
```

## Variáveis de ambiente

Consulte `.env.example` para a lista completa.

## Pendências do bootstrap

Consulte `.agents/BOOTSTRAP_PENDENCIAS.md` na raiz do workspace.
