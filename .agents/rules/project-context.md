# PoolSafe Backend — Project Context

## Projeto

Este repositório contém somente a API Node.js consumida pelo aplicativo mobile do PoolSafe. A API é a fronteira pública de dados, autenticação, autorização e regras de aplicação.

O backend Python de visão computacional, o N8N, o MySQL, o Firebase Cloud Messaging, o gateway Orange Pi e a infraestrutura Cloudflare são componentes externos. Não implemente suas responsabilidades dentro desta API.

## Autoridades do projeto

Antes de planejar ou implementar, consulte os documentos aplicáveis:

- `POOLSAFE_SOURCE_OF_TRUTH.md`: arquitetura, escopo e fronteiras gerais;
- `docs/domain-model.md`: regras de negócio, invariantes, transações e autorização;
- `docs/database-schema.md`: tabelas, relacionamentos, índices e retenção;
- `docs/api-contract.md`: endpoints, payloads, erros e comportamento HTTP;
- `docs/app-requirements.md`: jornadas e necessidades do consumidor mobile.

O domínio governa as regras de negócio; o schema governa a persistência; o contrato governa a interface HTTP. Não corrija divergências silenciosamente. Interrompa a tarefa e solicite uma decisão quando houver incompatibilidade relevante.

## Stack aprovada

- Node.js 24 LTS;
- NestJS 12 com Express;
- TypeScript em modo estrito;
- módulos ESM;
- npm e `package-lock.json`;
- MySQL 8.4;
- Prisma ORM 7, com versões major fixadas no `package.json`;
- `@prisma/adapter-mariadb` para o MySQL;
- Prisma Migrate como proprietário das migrations;
- `class-validator` e `class-transformer` para DTOs;
- `@nestjs/config` para configuração validada;
- `@nestjs/jwt` para access tokens;
- `argon2` com Argon2id para senhas;
- `@nestjs/swagger` para OpenAPI 3.1.2;
- `@nestjs/throttler` para rate limiting;
- `nestjs-pino` e `pino` para logs estruturados;
- `helmet` para headers de segurança;
- `@nestjs/terminus` para health checks;
- Docker multi-stage para deploy na VPS.

Não adicionar Jest ou Vitest no bootstrap inicial. Os cenários de teste documentados continuam válidos e serão tratados em etapa posterior.

## Arquitetura

Use um monólito modular organizado por funcionalidade:

```text
prisma/               schema e migrations
scripts/              scripts operacionais, incluindo exportação OpenAPI
src/config/           configuração e validação de ambiente
src/database/         PrismaModule e PrismaService
src/common/           somente recursos realmente compartilhados
src/modules/auth/      autenticação e sessões
src/modules/users/     conta do usuário
src/modules/devices/   instalações e FCM Tokens
src/modules/cameras/   consultas e autorização de câmeras
src/modules/monitorings/ controle do monitoramento
src/modules/alerts/    histórico, detalhes e evidência
src/modules/health/    liveness e readiness
```

Dentro de um módulo, use controller, service, DTOs e repository somente quando cada elemento tiver responsabilidade real.

## Convenções de implementação

- Controllers tratam HTTP e delegam casos de uso; não contêm regras de negócio.
- Services coordenam casos de uso, autorização e transações.
- Repositories encapsulam consultas complexas, bloqueios e SQL específico.
- Não crie `BaseRepository`, CRUD genérico ou camadas sem necessidade concreta.
- Não retorne models do Prisma diretamente pela API.
- Use DTOs e mapeadores explícitos nas fronteiras HTTP.
- Código, arquivos e identificadores TypeScript usam inglês.
- Tabelas e colunas mantêm os nomes aprovados em português e `snake_case`, usando `@map` e `@@map` no Prisma.
- IDs `BIGINT` são strings em todo JSON público.
- Datas públicas usam RFC 3339 em UTC com milissegundos.
- Enums públicos usam `UPPER_SNAKE_CASE`.
- Campos desconhecidos em requests devem gerar `422`.
- Erros seguem RFC 9457 e `application/problem+json`.
- Use `/api/v1` como prefixo público.
- Toda resposta inclui ou preserva `X-Request-Id` válido.
- SQL manual deve ser parametrizado e restrito ao repository que realmente precisar dele.
- Regras transacionais, idempotência e concorrência devem seguir o domínio e o schema.
- Migrations são propriedade deste repositório. N8N não cria nem altera tabelas.

## Autenticação

- Access token JWT com validade de 15 minutos.
- Assinatura assimétrica fixa `RS256`.
- Use `@nestjs/jwt` e aceite somente o algoritmo configurado.
- Claims mínimas: `iss`, `aud`, `sub`, `sid`, `jti`, `iat` e `exp`.
- Verifique usuário e sessão ativa em toda requisição protegida.
- Logout e revogação devem ter efeito imediato.
- Refresh token é opaco, rotativo e não é um JWT.
- Gere o segredo do refresh token com `node:crypto` e persista somente seu hash SHA-256.
- Reutilização de refresh token anterior revoga a sessão.
- Senhas usam Argon2id e nunca são armazenadas ou registradas em texto puro.
- Chaves, tokens, credenciais e service accounts nunca entram no Git.

## OpenAPI

- `docs/api-contract.md` é a autoridade humana do contrato HTTP.
- Gere `openapi.yaml` 3.1.2 a partir dos controllers e DTOs do Nest.
- Versione o arquivo gerado no repositório.
- Documente endpoints, exemplos, enums, autenticação e Problem Details.
- Não exponha Swagger publicamente em produção sem decisão explícita.
- Não altere o contrato público apenas para facilitar a implementação.

## Segurança e operação

- O aplicativo nunca acessa o MySQL, N8N ou backend Python diretamente.
- A API acessa o MySQL somente pela rede interna autorizada.
- Não registrar senhas, JWTs, refresh tokens, recovery tokens, FCM Tokens, evidências ou assinaturas.
- Aplicar autorização no servidor em cada recurso protegido.
- Usar rate limits definidos em `docs/api-contract.md`.
- CORS não deve usar `*`; para o aplicativo nativo, mantenha desabilitado enquanto não houver consumidor web.
- Respostas sensíveis usam `Cache-Control: private, no-store`.
- Não retornar stack traces, SQL, paths locais ou topologia interna.
- Evidências são sensíveis e nunca recebem URL pública.
- O container deve participar apenas das redes Docker necessárias.

## Forma de trabalho

- Implemente somente o escopo solicitado.
- Trabalhe por pequenas fatias verticais revisáveis.
- Antes de codificar uma funcionalidade, apresente o plano e os arquivos que pretende alterar.
- Não troque a stack aprovada sem autorização.
- Não adicione dependências sem justificar a necessidade.
- Não invente endpoints, campos, tabelas, estados ou regras.
- No bootstrap inicial, prepare somente projeto Nest, estrutura, dependências, configuração, conexão preparada com Prisma, Docker e health checks mínimos. Não implemente funcionalidades, migrations definitivas ou regras de negócio sem nova autorização.

## Pendências conhecidas

- provedor e template de e-mail para recuperação de senha;
- hostname público da API;
- publicação HTTPS e possível Cloudflare Tunnel na VPS;
- fluxo de build da imagem e atualização pelo Portainer;
- parâmetros finais do Argon2id, a calibrar na VPS;
- exposição ou proteção da documentação Swagger;
- rate limiting distribuído, necessário somente com múltiplas instâncias;
- geração completa e validação automatizada do `openapi.yaml`;
- ferramenta e etapa de implementação dos testes automatizados.

