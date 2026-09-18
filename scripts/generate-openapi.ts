/**
 * scripts/generate-openapi.ts
 *
 * Script de geração do openapi.yaml a partir dos controllers e DTOs do NestJS.
 *
 * STATUS: PENDENTE — geração completa depende de todos os módulos de negócio
 * estarem implementados com seus controllers e DTOs finais.
 *
 * Quando implementado, este script deverá:
 * 1. Inicializar o AppModule sem escutar na porta
 * 2. Criar o documento Swagger via DocumentBuilder
 * 3. Serializar para OpenAPI 3.1.2 em YAML
 * 4. Salvar em openapi.yaml na raiz do repositório
 *
 * O openapi.yaml gerado deve ser versionado no repositório conforme
 * docs/api-contract.md e project-context.md.
 *
 * Consulte .agents/BOOTSTRAP_PENDENCIAS.md para o item correspondente.
 */

console.warn(
  '[generate-openapi] PENDENTE: a geração completa do openapi.yaml ' +
  'está aguardando a implementação dos módulos de negócio. ' +
  'Consulte .agents/BOOTSTRAP_PENDENCIAS.md.',
);

process.exit(0);
