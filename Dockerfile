# Dockerfile multi-stage — PoolSafe API
#
# Estágio 1 (deps):    instala apenas as dependências de produção
# Estágio 2 (builder): compila o TypeScript
# Estágio 3 (runner):  imagem final mínima com Node.js 24 Alpine
#
# Configuração exclusivamente por variáveis de ambiente.
# Nenhuma credencial é incorporada à imagem.

# ─── Estágio 1: dependências de produção ────────────────────────────────────
FROM node:24-alpine AS deps

WORKDIR /app

# Copiar manifestos de dependência e arquivos do Prisma (necessários para o postinstall: prisma generate)
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/ ./prisma/

# Instalar somente dependências de produção
RUN npm ci --omit=dev

# ─── Estágio 2: build ────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copiar manifestos e Prisma para instalação completa com devDependencies
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/ ./prisma/
RUN npm ci

# Copiar código-fonte e configurações
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src/ ./src/

# Compilar o NestJS
RUN npm run build

# ─── Estágio 3: imagem final ─────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

# Usuário não-root para execução
RUN addgroup -S poolsafe && adduser -S poolsafe -G poolsafe

# Copiar dependências de produção do estágio deps
COPY --from=deps /app/node_modules ./node_modules

# Copiar o artefato compilado do estágio builder
COPY --from=builder /app/dist ./dist

# Copiar prisma (schema e client gerado) e configuração
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY prisma.config.ts ./

# Copiar package.json (necessário para "type": "module")
COPY package.json ./

USER poolsafe

# Porta interna da API (configurável pela variável PORT)
EXPOSE 3000

# Health check coerente com o endpoint de liveness
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health/live || exit 1

CMD ["node", "dist/main.js"]
