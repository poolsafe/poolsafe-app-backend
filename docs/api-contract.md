# PoolSafe - Contrato da API

> Especificação canônica das interfaces HTTP do MVP do PoolSafe.

**Versão do documento:** 1.0  
**Versão pública da API:** `v1`  
**Status:** aprovado para implementação e futura descrição OpenAPI  
**Última consolidação:** 18 de setembro de 2026  
**Consumidor principal:** aplicativo React Native  
**Implementação prevista:** Node.js com TypeScript

## 1. Finalidade

Este documento transforma o `domain-model.md` em contratos HTTP estáveis. Ele define:

- convenções de URL, JSON, identificadores e datas;
- autenticação, renovação e revogação de sessão;
- endpoints consumidos pelo aplicativo;
- comandos de monitoramento;
- histórico, detalhes e evidência de alertas;
- cadastro idempotente de dispositivos e FCM Tokens;
- formato uniforme de erros;
- contrato interno de eventos entre Python e N8N;
- payload mínimo das notificações push;
- requisitos de segurança, idempotência e testes de contrato.

O documento não escolhe framework HTTP, ORM, biblioteca JWT, provedor de e-mail ou ferramenta de geração OpenAPI. A implementação poderá escolher essas tecnologias desde que preserve integralmente o comportamento definido aqui.

## 2. Resultado da revisão da modelagem

A modelagem está apta a sustentar o contrato. Antes de fechar esta versão, a revisão realizou três ajustes:

1. separou alteração de senha autenticada de redefinição por recuperação;
2. definiu como a Home consolida várias sessões atuais do mesmo usuário;
3. removeu do evento Python a necessidade de conhecer o `monitoramento_id` do banco; o N8N resolve a sessão ativa pela câmera.

Também foi preservada a contingência já registrada: um alerta sem destinatários, causado por inconsistência administrativa, não é descartado e gera erro operacional prioritário.

## 3. Autoridade documental

Este contrato deve ser interpretado junto a:

1. `POOLSAFE_SOURCE_OF_TRUTH.md` — arquitetura e fronteiras;
2. `docs/database-schema.md` — persistência;
3. `docs/domain-model.md` — regras e invariantes;
4. `docs/app-requirements.md` — jornadas e critérios de aceite;
5. `docs/design-system.md` — apresentação no aplicativo.

Se um payload parecer incompatível com uma regra do domínio, prevalece o domínio e o contrato deve ser corrigido antes da implementação.

## 4. Padrões adotados

| Assunto | Decisão |
|---|---|
| Estilo | HTTP REST orientado a recursos |
| Transporte público | HTTPS obrigatório |
| Formato comum | JSON UTF-8 |
| Erros | Problem Details conforme RFC 9457 |
| Datas | RFC 3339 em UTC, com `Z` e milissegundos |
| Descrição futura | OpenAPI 3.1.2 em `openapi.yaml` |
| Autenticação | access token JWT curto e refresh token opaco rotativo |
| Paginação | cursor opaco |
| Campos JSON | `camelCase` |
| Enums | `UPPER_SNAKE_CASE`, ASCII e sem acentos |
| IDs públicos | strings decimais, nunca números JSON |

Embora OpenAPI 3.2.1 seja a versão publicada mais recente, o artefato inicial deverá usar 3.1.2 por compatibilidade de ferramentas. A migração para 3.2.x depende de validação da stack escolhida e não altera a versão pública `v1` da API.

Referências normativas e técnicas aparecem no final do documento.

## 5. Base URL e versionamento

Base pública lógica:

```text
https://<host-da-api>/api/v1
```

O host definitivo depende do domínio e do deploy. O prefixo `/api/v1` é obrigatório.

Mudanças compatíveis em `v1`:

- adicionar campo opcional em resposta;
- adicionar endpoint;
- adicionar filtro opcional;
- ampliar limites sem quebrar consumidores.

Mudanças que exigem nova versão ou transição documentada:

- remover ou renomear campo;
- alterar tipo, semântica ou nulabilidade;
- mudar código de enum sem fallback;
- tornar opcional um requisito de segurança obrigatório ou vice-versa;
- alterar a forma de autenticação esperada pelo cliente.

Clientes devem ignorar campos desconhecidos, mas tratar enum desconhecido com fallback seguro. Um valor desconhecido de estado nunca deve ser exibido como situação segura.

## 6. Convenções globais

### 6.1 Headers

Requisições JSON:

```http
Accept: application/json, application/problem+json
Content-Type: application/json
```

Requisições protegidas:

```http
Authorization: Bearer <access-token>
```

Todas as respostas incluem:

```http
X-Request-Id: <uuid>
```

O cliente pode enviar `X-Request-Id`, mas a API valida o formato e pode substituí-lo. O identificador serve para suporte e correlação; não contém dados pessoais.

### 6.2 Identificadores

IDs `BIGINT` são serializados como strings para evitar perda de precisão no JavaScript:

```json
{
  "id": "184"
}
```

O cliente não interpreta ordem, tamanho ou significado de IDs.

### 6.3 Datas

Todas as datas retornam em UTC:

```json
{
  "detectedAt": "2026-09-18T22:30:15.123Z"
}
```

Offsets podem ser aceitos em filtros, mas são normalizados para UTC. Datas sem timezone são inválidas.

### 6.4 Nulos e campos omitidos

- respostas incluem campos estáveis anuláveis com `null`;
- pedidos de atualização omitem propriedades que não devem mudar;
- enviar `null` somente remove um valor quando o endpoint documentar essa ação;
- campos desconhecidos em requisições resultam em `422`, evitando erros de digitação silenciosos.

### 6.5 Limites gerais

- corpo JSON: até 1 MiB;
- evidência interna: até 5 MiB;
- nome de usuário: 2 a 120 caracteres após normalização;
- e-mail: até 254 caracteres;
- senha: 8 a 128 caracteres, sem remoção automática de espaços internos ou nas extremidades;
- `limit` de paginação: padrão 20, máximo 50.

## 7. Formato de sucesso

### 7.1 Recurso único

```json
{
  "data": {
    "id": "42"
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

### 7.2 Lista paginada

```json
{
  "data": [],
  "pagination": {
    "nextCursor": null,
    "hasMore": false
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

### 7.3 Sem conteúdo

Operações concluídas sem representação retornam `204 No Content` e não enviam JSON.

## 8. Formato de erro

Erros usam `Content-Type: application/problem+json` e o modelo da RFC 9457.

```json
{
  "type": "urn:poolsafe:problem:validation-error",
  "title": "Dados inválidos",
  "status": 422,
  "detail": "Um ou mais campos precisam ser corrigidos.",
  "instance": "urn:poolsafe:request:f91d70b3-ff4a-42a2-b79e-425e90a96020",
  "code": "VALIDATION_ERROR",
  "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020",
  "errors": [
    {
      "pointer": "/email",
      "code": "INVALID_EMAIL",
      "detail": "Informe um e-mail válido."
    }
  ]
}
```

Regras:

- `code` é estável e deve orientar a lógica do aplicativo;
- `title` e `detail` são humanos e não devem ser analisados pelo cliente;
- `errors` existe somente quando houver erros localizáveis;
- detalhes internos, stack traces, SQL e nomes de serviços não são retornados;
- para evitar enumeração, um recurso protegido inexistente e um recurso de outro usuário podem retornar o mesmo `404`.

### 8.1 Mapeamento básico

| HTTP | Código comum | Uso |
|---:|---|---|
| `400` | `MALFORMED_REQUEST` | JSON inválido ou requisição ilegível |
| `401` | `INVALID_CREDENTIALS` | login inválido |
| `401` | `AUTHENTICATION_REQUIRED` | token ausente ou inválido |
| `401` | `SESSION_EXPIRED` | sessão expirada ou revogada |
| `403` | `ACCESS_DENIED` | ator autenticado sem permissão |
| `403` | `REAUTHENTICATION_FAILED` | senha da ação sensível inválida |
| `404` | `RESOURCE_NOT_FOUND` | inexistente ou não revelável ao ator |
| `409` | `RESOURCE_CONFLICT` | unicidade ou concorrência genérica |
| `409` | `ACCOUNT_CANNOT_BE_CREATED` | conflito de e-mail no cadastro de conta |
| `409` | `MONITORING_STATE_CONFLICT` | composição ou transição incompatível |
| `410` | `EVIDENCE_UNAVAILABLE` | evidência conhecida, porém expirada ou removida |
| `413` | `PAYLOAD_TOO_LARGE` | limite excedido |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | tipo de corpo não aceito |
| `422` | `VALIDATION_ERROR` | conteúdo semanticamente inválido |
| `429` | `RATE_LIMITED` | limite temporário excedido |
| `503` | `SERVICE_UNAVAILABLE` | dependência essencial indisponível |

`429` e indisponibilidades temporárias podem incluir `Retry-After`.

## 9. Autenticação e sessão

### 9.1 Estratégia

- access token JWT com validade de 15 minutos;
- refresh token opaco com validade absoluta de 30 dias;
- refresh token rotacionado em toda renovação;
- somente o hash SHA-256 do segredo do refresh token é armazenado;
- formato lógico do refresh token: `psrt_<sessionId>.<segredo-aleatorio>`;
- access e refresh tokens ficam no SecureStore do aplicativo;
- senha é protegida com Argon2id no backend;
- a API verifica usuário e sessão ativa em toda requisição protegida;
- logout e revogação têm efeito imediato mesmo que o JWT ainda não tenha expirado.

Claims mínimos do access token:

| Claim | Conteúdo |
|---|---|
| `iss` | identificador da API PoolSafe |
| `aud` | `poolsafe-app` |
| `sub` | ID string do usuário |
| `sid` | ID string da sessão |
| `jti` | identificador único do JWT |
| `iat` | emissão |
| `exp` | expiração |

O algoritmo de assinatura será assimétrico e fixado no bootstrap da API. `alg: none` e seleção dinâmica de algoritmo a partir de entrada não confiável são proibidos.

Na rotação, reutilizar refresh token antigo invalida a sessão inteira. A expiração absoluta de 30 dias não é estendida pela rotação.

### 9.2 Resposta autenticada

```json
{
  "data": {
    "user": {
      "id": "12",
      "name": "Dan",
      "email": "dan@example.com",
      "status": "ATIVO"
    },
    "tokens": {
      "tokenType": "Bearer",
      "accessToken": "<jwt>",
      "refreshToken": "<token-opaco>",
      "accessExpiresAt": "2026-09-18T22:45:15.123Z",
      "sessionExpiresAt": "2026-10-18T22:30:15.123Z"
    }
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

Tokens nunca aparecem em logs, erros ou respostas posteriores de consulta.

## 10. Catálogo de endpoints públicos

| Método | Rota | Autenticação | Finalidade |
|---|---|---:|---|
| `POST` | `/auth/register` | não | criar conta e sessão |
| `POST` | `/auth/login` | não | autenticar |
| `POST` | `/auth/refresh` | refresh token | rotacionar tokens |
| `POST` | `/auth/logout` | refresh token | revogar sessão e instalação |
| `POST` | `/auth/forgot-password` | não | solicitar recuperação |
| `POST` | `/auth/reset-password` | token de recuperação | redefinir senha |
| `GET` | `/users/me` | sim | consultar perfil |
| `PATCH` | `/users/me` | sim | atualizar nome |
| `PUT` | `/users/me/password` | sim | alterar senha autenticada |
| `PUT` | `/devices/{installationId}` | sim | registrar ou atualizar instalação |
| `DELETE` | `/devices/{installationId}` | sim | invalidar instalação |
| `GET` | `/home` | sim | obter resumo do painel |
| `GET` | `/cameras` | sim | listar câmeras autorizadas |
| `GET` | `/cameras/{cameraId}` | sim | obter detalhes da câmera |
| `GET` | `/monitorings/current` | sim | listar sessões atuais |
| `GET` | `/monitorings/{monitoringId}` | sim | obter sessão autorizada |
| `POST` | `/monitorings` | sim | iniciar sessão |
| `POST` | `/monitorings/{monitoringId}/pause` | sim + senha | pausar sessão |
| `POST` | `/monitorings/{monitoringId}/resume` | sim | reativar sessão |
| `GET` | `/alerts` | sim | listar histórico paginado |
| `GET` | `/alerts/{alertId}` | sim | obter detalhes do alerta |
| `GET` | `/alerts/{alertId}/evidence` | sim | transmitir evidência autorizada |

Endpoints administrativos de câmera, acesso e encerramento de sessão não fazem parte da API pública do MVP.

## 11. Autenticação

### 11.1 `POST /auth/register`

Pedido:

```json
{
  "name": "Dan",
  "email": "dan@example.com",
  "password": "senha-com-8-ou-mais"
}
```

Resposta: `201 Created` com a resposta autenticada da seção 9.2.

Regras:

- normalizar nome e e-mail;
- não receber `passwordConfirmation`; essa validação pertence ao formulário;
- e-mail em conflito retorna `409 ACCOUNT_CANNOT_BE_CREATED` com mensagem não enumerável;
- cadastro não associa câmeras.

### 11.2 `POST /auth/login`

```json
{
  "email": "dan@example.com",
  "password": "senha-do-usuario"
}
```

Resposta: `200 OK` com a resposta autenticada.

Credenciais incorretas, usuário inexistente, bloqueado ou desativado retornam a mesma resposta pública `401 INVALID_CREDENTIALS`.

### 11.3 `POST /auth/refresh`

```json
{
  "refreshToken": "psrt_31.<segredo>"
}
```

Resposta `200 OK`:

```json
{
  "data": {
    "tokenType": "Bearer",
    "accessToken": "<novo-jwt>",
    "refreshToken": "<novo-token-opaco>",
    "accessExpiresAt": "2026-09-18T23:00:15.123Z",
    "sessionExpiresAt": "2026-10-18T22:30:15.123Z"
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

O token anterior deixa de ser válido no mesmo commit que grava o novo hash.

### 11.4 `POST /auth/logout`

```json
{
  "refreshToken": "psrt_31.<segredo>",
  "installationId": "d67bd8e9-c001-4ae4-8da0-cbd75b660ec8"
}
```

Resposta: `204 No Content` mesmo se a sessão já estiver revogada. A operação revoga a sessão identificável e invalida a instalação correspondente sem revelar se o token existia.

### 11.5 `POST /auth/forgot-password`

```json
{
  "email": "dan@example.com"
}
```

Resposta: `202 Accepted` com mensagem genérica, existindo ou não a conta.

```json
{
  "data": {
    "message": "Se a conta existir, enviaremos as instruções de recuperação."
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

### 11.6 `POST /auth/reset-password`

```json
{
  "token": "<segredo-recebido>",
  "newPassword": "nova-senha-segura"
}
```

Resposta: `204 No Content`.

O token é de uso único. A operação revoga todas as sessões e invalida todos os dispositivos da conta. Token inválido retorna `422 INVALID_RESET_TOKEN`; token reconhecido porém expirado retorna `410 RESET_TOKEN_EXPIRED`.

## 12. Usuário atual

### 12.1 `GET /users/me`

Resposta `200 OK`:

```json
{
  "data": {
    "id": "12",
    "name": "Dan",
    "email": "dan@example.com",
    "status": "ATIVO",
    "createdAt": "2026-09-01T14:20:00.000Z"
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

### 12.2 `PATCH /users/me`

```json
{
  "name": "Dan Silva"
}
```

Resposta: `200 OK` com o usuário atualizado. E-mail não é editável no MVP.

### 12.3 `PUT /users/me/password`

```json
{
  "currentPassword": "senha-atual",
  "newPassword": "nova-senha-segura"
}
```

Resposta: `204 No Content`.

A sessão e o dispositivo atuais permanecem ativos. Todas as outras sessões são revogadas e os demais dispositivos são invalidados. Senha atual incorreta retorna `403 REAUTHENTICATION_FAILED`.

## 13. Dispositivos

### 13.1 `PUT /devices/{installationId}`

`installationId` é um UUID gerado e preservado pela instalação do aplicativo.

```json
{
  "platform": "ANDROID",
  "fcmToken": "<token-ou-null>"
}
```

Respostas:

- `201 Created` para nova instalação;
- `200 OK` para atualização idempotente.

```json
{
  "data": {
    "id": "90",
    "installationId": "d67bd8e9-c001-4ae4-8da0-cbd75b660ec8",
    "platform": "ANDROID",
    "active": true,
    "pushEligible": true,
    "tokenUpdatedAt": "2026-09-18T22:30:15.123Z"
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

O FCM Token nunca é devolvido. `fcmToken: null` mantém a instalação conhecida, mas `pushEligible` será falso. Registrar o token em uma nova instalação remove atomicamente qualquer vínculo anterior do mesmo token. A sessão atual passa a referenciar esse dispositivo.

### 13.2 `DELETE /devices/{installationId}`

Resposta: `204 No Content`. Repetir a operação produz o mesmo resultado. Um usuário não pode invalidar a instalação de outra conta.

## 14. Home

### 14.1 `GET /home`

Resposta `200 OK`:

```json
{
  "data": {
    "generatedAt": "2026-09-18T22:30:15.123Z",
    "overallMonitoring": {
      "status": "DEGRADADO",
      "reason": "CAMERAS_INDISPONIVEIS",
      "currentSessions": 2,
      "activeSessions": 2,
      "pausedSessions": 0,
      "degradedSessions": 1,
      "unavailableSessions": 0
    },
    "cameras": {
      "total": 3,
      "online": 2,
      "offline": 1,
      "unknown": 0,
      "inactive": 0
    },
    "latestAlert": {
      "id": "418",
      "type": "POSSIVEL_RISCO",
      "severity": "CRITICA",
      "detectedAt": "2026-09-18T22:27:10.000Z",
      "camera": {
        "id": "8",
        "name": "Piscina principal",
        "location": "Área externa"
      }
    },
    "warnings": [
      {
        "code": "CAMERA_OFFLINE",
        "severity": "ATENCAO",
        "cameraId": "9",
        "monitoringId": "51"
      }
    ]
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

Enums:

- `overallMonitoring.status`: `ATIVO`, `PAUSADO`, `DEGRADADO`, `INDISPONIVEL`;
- razões iniciais: `OPERACIONAL`, `SEM_SESSAO`, `PAUSADO_PELO_USUARIO`, `CAMERAS_INDISPONIVEIS`, `SEM_CAMERA_ONLINE`;
- resumo com sessões ativas e pausadas usa também `SESSIONS_MIXED`;
- warning codes iniciais: `NO_CURRENT_MONITORING`, `MONITORING_PAUSED`, `CAMERA_OFFLINE`, `CAMERA_UNKNOWN`.

A ausência de resposta da API é tratada pelo aplicativo como `NAO_VERIFICADO`; esse valor não é retornado como estado operacional confirmado.

## 15. Câmeras

### 15.1 Modelo público de câmera

```json
{
  "id": "8",
  "name": "Piscina principal",
  "location": "Área externa",
  "administrativeStatus": "ATIVA",
  "connectionStatus": "ONLINE",
  "lastCommunicationAt": "2026-09-18T22:29:58.000Z",
  "currentMonitoring": {
    "id": "51",
    "status": "ATIVO",
    "operationalStatus": "ATIVO"
  },
  "recentAlertsCount": 2
}
```

`connectionStatus` aceita `ONLINE`, `OFFLINE` ou `DESCONHECIDA`. A situação administrativa permanece separada em `ATIVA` ou `INATIVA`.

### 15.2 `GET /cameras`

Retorna `200 OK` com todas as câmeras de acesso ativo do usuário. Não usa paginação no MVP.

### 15.3 `GET /cameras/{cameraId}`

Retorna a câmera, sua sessão atual e até cinco alertas recentes dos quais o usuário foi destinatário. IP, protocolo, stream e credenciais nunca são retornados.

Sem acesso ativo, retorna `404 RESOURCE_NOT_FOUND`.

## 16. Monitoramentos

### 16.1 Modelo público

```json
{
  "id": "51",
  "status": "ATIVO",
  "operationalStatus": "DEGRADADO",
  "operationalReason": "CAMERAS_INDISPONIVEIS",
  "cameras": [
    {
      "id": "8",
      "name": "Piscina principal",
      "connectionStatus": "ONLINE"
    },
    {
      "id": "9",
      "name": "Piscina lateral",
      "connectionStatus": "OFFLINE"
    }
  ],
  "startedAt": "2026-09-18T18:00:00.000Z",
  "pausedAt": null,
  "endedAt": null,
  "updatedAt": "2026-09-18T18:00:00.000Z"
}
```

### 16.2 `GET /monitorings/current`

Retorna todas as sessões `ATIVAS` ou `PAUSADAS` nas quais o usuário possui acesso ativo a todas as câmeras. A resposta é uma lista não paginada no MVP.

### 16.3 `GET /monitorings/{monitoringId}`

Retorna `200 OK` quando o usuário possui acesso ativo a todas as câmeras; caso contrário, `404`.

### 16.4 `POST /monitorings`

```json
{
  "cameraIds": ["8", "9"]
}
```

Resultados:

- `201 Created`: nova sessão iniciada;
- `200 OK`: já existia sessão ativa com exatamente a mesma composição;
- `409 MONITORING_STATE_CONFLICT`: alguma câmera pertence a outra sessão não encerrada ou a composição conflita;
- `403 ACCESS_DENIED`: usuário sem acesso a todas as câmeras;
- `422 CAMERA_NOT_OPERATIONAL`: câmera inativa, offline ou desconhecida.

`cameraIds` precisa conter ao menos um ID, sem duplicatas. A lista é tratada como conjunto; sua ordem não altera a identidade lógica da solicitação.

### 16.5 `POST /monitorings/{monitoringId}/pause`

```json
{
  "password": "senha-atual"
}
```

Resposta: `200 OK` com o monitoramento atualizado.

Regras:

- exige acesso ativo a todas as câmeras;
- senha é verificada na mesma requisição e nunca logada;
- sessão já pausada retorna `200` com o estado atual;
- sessão encerrada retorna `409 MONITORING_STATE_CONFLICT`;
- senha inválida retorna `403 REAUTHENTICATION_FAILED`.

### 16.6 `POST /monitorings/{monitoringId}/resume`

Sem corpo. Resposta: `200 OK` com o monitoramento atualizado.

Todas as câmeras precisam estar ativas e online. Sessão já ativa retorna `200`; encerrada retorna `409`; câmera indisponível retorna `422 CAMERA_NOT_OPERATIONAL`.

O encerramento não é exposto ao aplicativo no MVP.

## 17. Alertas

### 17.1 Resumo público

```json
{
  "id": "418",
  "type": "POSSIVEL_RISCO",
  "severity": "CRITICA",
  "detectedAt": "2026-09-18T22:27:10.000Z",
  "camera": {
    "id": "8",
    "name": "Piscina principal",
    "location": "Área externa"
  },
  "evidenceAvailable": true
}
```

Não existe campo `viewed`, `verified`, `resolved` ou `status` do alerta.

### 17.2 `GET /alerts`

Query parameters:

| Parâmetro | Tipo | Regra |
|---|---|---|
| `limit` | inteiro | padrão 20; máximo 50 |
| `cursor` | string | opaco; não deve ser interpretado pelo cliente |
| `cameraId` | ID string | opcional; precisa estar no escopo histórico do usuário |
| `severity` | enum | `ATENCAO` ou `CRITICA` |
| `from` | date-time | inclusivo |
| `to` | date-time | exclusivo; precisa ser posterior a `from` |

Ordenação fixa: `detectedAt DESC, id DESC`. O cursor encapsula esses dois valores e deve ser assinado ou protegido contra adulteração.

Somente alertas presentes em `alerta_destinatario` para o usuário autenticado são listados. A revogação posterior de acesso à câmera não remove o item.

### 17.3 `GET /alerts/{alertId}`

Resposta `200 OK`:

```json
{
  "data": {
    "id": "418",
    "type": "POSSIVEL_RISCO",
    "severity": "CRITICA",
    "detectedAt": "2026-09-18T22:27:10.000Z",
    "camera": {
      "id": "8",
      "name": "Piscina principal",
      "location": "Área externa"
    },
    "monitoringId": "51",
    "evidence": {
      "available": true,
      "mimeType": "image/jpeg",
      "expiresAt": "2026-10-18T22:27:10.000Z",
      "unavailableReason": null
    },
    "notification": {
      "status": "PROCESSADA",
      "processedAt": "2026-09-18T22:27:12.000Z"
    }
  },
  "meta": {
    "requestId": "f91d70b3-ff4a-42a2-b79e-425e90a96020"
  }
}
```

`unavailableReason` aceita `NOT_CAPTURED`, `EXPIRED` ou `REMOVED`. Metadados técnicos de detecção não são retornados no contrato comum do aplicativo.

### 17.4 `GET /alerts/{alertId}/evidence`

Resposta bem-sucedida: `200 OK` com bytes da imagem.

Headers mínimos:

```http
Content-Type: image/jpeg
Content-Disposition: inline; filename="alert-418.jpg"
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

Regras:

- exige que o usuário seja destinatário do alerta;
- não retorna URL pública nem Base64;
- evidência nunca capturada retorna `404 EVIDENCE_NOT_FOUND`;
- evidência removida ou expirada enquanto o alerta ainda existe retorna `410 EVIDENCE_UNAVAILABLE`, com `reason` igual a `EXPIRED` ou `REMOVED`;
- alerta removido pela retenção retorna `404 RESOURCE_NOT_FOUND`.

## 18. Contrato interno Python -> N8N

Este contrato não pertence à API pública Node.js. Ele documenta o webhook interno que recebe eventos consolidados do backend de visão.

### 18.1 Endpoint lógico

```text
POST /webhook/poolsafe/v1/risk-events
```

O endpoint deve ser alcançável somente pela rede interna ou caminho privado autorizado. O N8N não deve ser exposto diretamente à Internet para o aplicativo.

### 18.2 Autenticação da mensagem

Headers:

```http
X-PoolSafe-Timestamp: <unix-seconds>
X-PoolSafe-Signature: v1=<hex-hmac-sha256>
```

A assinatura é calculada com segredo compartilhado sobre:

```text
<timestamp>.<corpo-bruto-da-requisicao>
```

Regras:

- comparação da assinatura em tempo constante;
- tolerância máxima de cinco minutos;
- rejeitar timestamp fora da janela;
- segredo fornecido por ambiente seguro, nunca no repositório;
- HTTPS ou rede privada continuam obrigatórios; HMAC não substitui transporte seguro.

### 18.3 Corpo multipart

`Content-Type: multipart/form-data`

Partes:

| Nome | Content-Type | Obrigatório |
|---|---|---:|
| `event` | `application/json` | sim |
| `evidence` | `image/jpeg` ou `image/png` | não |

Conteúdo de `event`:

```json
{
  "schemaVersion": "1",
  "eventKey": "3e38e6be-196a-4da2-a51f-252eaa2a83ad",
  "cameraCode": "CAM-POOL-001",
  "type": "POSSIVEL_RISCO",
  "severity": "CRITICA",
  "detectedAt": "2026-09-18T22:27:10.000Z",
  "confidence": 0.8734,
  "modelVersion": "yolov11-poolsafe-1",
  "technicalData": {
    "trackId": "17",
    "confirmationFrames": 5
  }
}
```

Regras:

- `eventKey`: obrigatório, estável, até 100 caracteres;
- `cameraCode`: corresponde a `camera.codigo_integracao`;
- o Python não envia `cameraId`, `monitoringId`, usuário ou destinatário;
- `confidence` é opcional e varia de 0 a 1;
- `technicalData` é opcional, limitado a 16 KiB e não contém imagem ou segredo;
- evidência tem até 5 MiB;
- o N8N resolve exatamente uma sessão ativa que contenha a câmera;
- ausência ou ambiguidade da sessão rejeita o evento e gera log operacional;
- repetir `eventKey` não duplica o alerta nem entregas já aceitas.

### 18.4 Resposta

Após persistir o alerta de modo idempotente:

```json
{
  "eventKey": "3e38e6be-196a-4da2-a51f-252eaa2a83ad",
  "accepted": true,
  "duplicate": false,
  "alertId": "418",
  "acceptedAt": "2026-09-18T22:27:10.650Z"
}
```

Status `202 Accepted`. Para retry da mesma chave, `duplicate` será verdadeiro e `alertId` permanecerá o mesmo.

Erros internos seguem Problem Details quando tecnicamente possível:

- `401 INVALID_SERVICE_SIGNATURE`;
- `404 CAMERA_NOT_FOUND`;
- `409 ACTIVE_MONITORING_NOT_FOUND`;
- `409 ACTIVE_MONITORING_AMBIGUOUS`;
- `413 EVIDENCE_TOO_LARGE`;
- `415 UNSUPPORTED_EVIDENCE_TYPE`;
- `422 INVALID_RISK_EVENT`;
- `503 EVENT_PERSISTENCE_UNAVAILABLE`.

O alerta e seus destinatários precisam existir antes de qualquer tentativa ao FCM. A resposta não precisa aguardar todas as entregas push.

## 19. Payload FCM

O N8N envia uma notification message com data payload mínimo:

```json
{
  "notification": {
    "title": "Possível situação de risco",
    "body": "Abra o PoolSafe para verificar o alerta."
  },
  "data": {
    "schemaVersion": "1",
    "type": "ALERT",
    "alertId": "418",
    "severity": "CRITICA"
  }
}
```

Todos os valores de `data` são strings. O payload não inclui evidência, nome de pessoa, endereço, credencial, URL interna, confiança ou dados técnicos. O aplicativo trata `alertId` apenas como destino de navegação e consulta novamente a API com autenticação.

Comportamento:

- foreground: callback do aplicativo apresenta aviso e invalida consultas relacionadas;
- background ou encerrado: o sistema exibe a notification message;
- sessão expirada: o app preserva temporariamente o destino, autentica e tenta abrir o alerta;
- alerta indisponível ou não autorizado: fallback para Histórico ou Home.

## 20. Health checks

Endpoints operacionais, fora do prefixo público de recursos:

| Método | Rota | Uso |
|---|---|---|
| `GET` | `/health/live` | processo em execução |
| `GET` | `/health/ready` | API pronta e dependências essenciais alcançáveis |

Respostas não incluem versão de biblioteca, credenciais, hostnames internos ou detalhes do banco. `ready` retorna `503` quando a API não pode atender com segurança.

## 21. Autorização resumida

| Recurso | Regra aplicada pela API |
|---|---|
| perfil | `sub` do access token |
| dispositivo | instalação pertencente ao `sub` |
| câmera | acesso ativo usuário/câmera |
| monitoramento | acesso ativo a todas as câmeras |
| alerta | destinatário histórico do alerta |
| evidência | destinatário histórico + conta ativa + conteúdo disponível |

O frontend ocultar um botão não constitui autorização. Todas as regras são reaplicadas no servidor.

## 22. Concorrência e idempotência

- `PUT /devices/{installationId}` é idempotente;
- `DELETE /devices/{installationId}` é idempotente;
- pausar sessão já pausada e reativar sessão já ativa retornam o estado atual;
- iniciar com a mesma composição já ativa retorna a sessão existente;
- composição sobreposta a outra sessão gera `409`;
- transições usam bloqueio ou versão interna para impedir corrida;
- `eventKey` protege criação do alerta;
- constraints únicas protegem destinatários, notificações e entregas;
- retry do webhook pode completar etapas pendentes, mas não repete entrega `ENVIADA`;
- refresh token é rotacionado atomicamente.

Quando duas ações concorrentes produzirem resultados incompatíveis, a primeira confirmada vence e a outra recebe `409` com representação suficiente para o cliente atualizar seus dados.

## 23. Rate limiting inicial

Valores são configuração operacional, mas o MVP parte destas referências:

| Grupo | Limite inicial |
|---|---|
| login | 10 tentativas/15 min por IP e 5/15 min por e-mail normalizado |
| cadastro | 5/hora por IP |
| recuperação | 3/hora por e-mail e 10/hora por IP |
| refresh | 30/min por sessão |
| API autenticada geral | 120/min por usuário |
| webhook de risco | 60/min por câmera, com proteção adicional por assinatura |

Os valores podem ser ajustados sem mudar `v1`, desde que não impeçam o uso normal. Respostas limitadas retornam `429 RATE_LIMITED` e `Retry-After`.

## 24. Cache e armazenamento no cliente

- autenticação, perfil, alertas e evidência usam `Cache-Control: private, no-store`;
- o aplicativo pode manter estado remoto em memória pelo TanStack Query;
- persistência offline de alertas ou evidências não faz parte do MVP;
- dados antigos em memória precisam exibir o horário de referência;
- ações de estado nunca são assumidas concluídas a partir do cache.

## 25. Logging e observabilidade

Cada requisição registra, quando aplicável:

- `requestId`;
- método e rota parametrizada, sem query sensível;
- status HTTP;
- duração;
- ID interno do usuário ou sessão de forma controlada;
- categoria do erro;
- timestamp UTC.

Nunca registrar:

- senha atual ou nova;
- access, refresh ou recovery token;
- FCM Token;
- corpo da evidência;
- assinatura HMAC ou segredo;
- URL com token de recuperação;
- payload completo de autenticação.

## 26. Segurança de transporte e conteúdo

- API pública somente por HTTPS;
- MySQL e N8N não são expostos ao aplicativo;
- validação de schema ocorre antes do caso de uso;
- MIME type declarado da evidência deve ser confrontado com os bytes;
- respostas incluem `X-Content-Type-Options: nosniff`;
- CORS usa allowlist caso uma interface web seja adicionada; aplicativo nativo não justifica `*`;
- secrets são fornecidos por ambiente ou mecanismo seguro de deploy;
- erros não expõem stack, SQL, paths locais ou topologia interna;
- refresh e recovery tokens são comparados de forma segura;
- operações de senha aplicam rate limit e proteção contra força bruta.

## 27. OpenAPI e testes de contrato

Após a escolha do framework, deve ser criado `openapi.yaml` derivado deste documento.

Requisitos:

- OpenAPI 3.1.2 inicialmente;
- todos os endpoints, exemplos, enums e Problem Details documentados;
- lint no CI;
- validação de requests e responses em testes;
- SDK TypeScript do aplicativo gerado ou tipos compartilhados somente a partir do contrato versionado;
- teste que impeça números JSON para IDs `BIGINT`;
- teste de compatibilidade para mudanças em `v1`;
- coleção de exemplos sem tokens ou credenciais reais.

Cenários obrigatórios:

- cadastro, login, refresh rotativo, logout e recuperação;
- credencial inválida sem enumeração de conta;
- token revogado ou expirado;
- renovação e colisão de FCM Token;
- câmera sem acesso retornando `404`;
- monitoramento de uma e várias câmeras;
- pausa com e sem reautenticação válida;
- duas tentativas concorrentes de iniciar monitoramento;
- paginação estável de alertas;
- histórico após revogação do acesso à câmera;
- evidência disponível, ausente e expirada;
- webhook válido, assinatura inválida e replay;
- `eventKey` duplicada;
- alerta sem destinatários gerando log operacional;
- falha parcial no FCM e retry sem duplicidade.

## 28. Itens deliberadamente fora do contrato

- endpoints administrativos de associação de câmera;
- exclusão definitiva da conta;
- streaming ou reprodução de vídeo;
- confirmação, resolução ou visualização de alertas;
- edição de e-mail;
- preferências avançadas de push;
- agendamento de monitoramento;
- analytics e telemetria de produto;
- exposição de confiança ou bounding boxes ao app;
- GraphQL, WebSocket ou Server-Sent Events;
- API direta entre aplicativo e N8N/Python/MySQL.

## 29. Decisões restantes de implementação

Não bloqueiam este contrato:

- framework Node.js;
- ORM ou query builder;
- biblioteca de validação e geração OpenAPI;
- algoritmo assimétrico concreto e gestão das chaves JWT;
- provedor de e-mail;
- hostname público da API;
- solução de rate limiting distribuído;
- ferramenta de logs e métricas;
- estratégia de deploy pelo Portainer.

Essas escolhas não podem alterar payloads, segurança ou semântica sem revisão documental.

## 30. Referências técnicas

- OpenAPI Initiative. [OpenAPI Specification 3.2.1](https://spec.openapis.org/oas/v3.2.1.html), versão publicada em 10 de setembro de 2026.
- OpenAPI Initiative. [OpenAPI Specification 3.1.2](https://spec.openapis.org/oas/v3.1.2.html), baseline escolhida para o primeiro `openapi.yaml`.
- IETF. [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html).
- IETF. [RFC 3339 — Date and Time on the Internet: Timestamps](https://www.rfc-editor.org/rfc/rfc3339.html).
- Firebase. [Firebase Cloud Messaging message types](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type).

## 31. Próximos artefatos

Este contrato permite produzir, sem novas decisões de produto:

1. `openapi.yaml`;
2. migrations do MySQL;
3. estrutura inicial da API Node.js;
4. schemas/DTOs de integração do aplicativo;
5. contrato executável do webhook N8N;
6. testes de contrato e integração.

Antes do início do código, o `.agents/rules/project-context.md` deverá indicar este arquivo como autoridade para interfaces HTTP e proibir a invenção de endpoints temporários não identificados como mocks.
