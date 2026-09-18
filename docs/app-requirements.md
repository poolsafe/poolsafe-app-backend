# PoolSafe - Requisitos do Aplicativo Mobile

> Especificação funcional canônica do MVP do aplicativo PoolSafe.

**Versão:** 0.1  
**Status:** MVP funcional aprovado  
**Última consolidação:** 18 de setembro de 2026  
**Plataforma de validação inicial:** Android  
**Repositório previsto:** `poolsafe-app-frontend`

## 1. Finalidade

Este documento define o escopo funcional do Minimum Viable Product (MVP) do aplicativo mobile PoolSafe. Ele orientará o design da interface, o contrato da API Node.js, a implementação do frontend React Native e os futuros critérios de teste.

Esta especificação descreve o comportamento esperado do produto sem antecipar endpoints, tabelas, payloads ou detalhes internos ainda não aprovados. Quando houver divergência, a `POOLSAFE_SOURCE_OF_TRUTH.md` permanece como referência arquitetural superior.

## 2. Objetivo do MVP

O MVP deve permitir que um usuário autenticado:

- visualize o estado geral do monitoramento;
- consulte as câmeras previamente associadas à sua conta;
- identifique se as câmeras estão online ou offline;
- ative ou pause o monitoramento com confirmação;
- receba notificações sobre possíveis situações de risco;
- abra o alerta correspondente a partir de uma notificação;
- consulte o histórico de alertas;
- visualize os detalhes e a evidência disponível de um alerta;
- gerencie configurações básicas da conta, notificações e aparência.

O MVP será considerado bem-sucedido quando esse fluxo puder ser demonstrado de ponta a ponta no Android, utilizando o aplicativo, a API PoolSafe e a integração de notificações definida para o projeto.

## 3. Princípios do produto

1. O PoolSafe é uma camada adicional de segurança e não substitui supervisão humana ou atendimento de emergência.
2. O aplicativo não deve afirmar que ocorreu um afogamento; ele comunica uma possível situação de risco que precisa ser verificada.
3. Estados críticos devem ser claros e não podem depender exclusivamente de cores.
4. O aplicativo deve apresentar informações operacionais em linguagem compreensível, sem expor detalhes técnicos desnecessários.
5. O aplicativo se comunica com os dados do PoolSafe exclusivamente pela API Node.js.
6. O aplicativo não acessa diretamente MySQL, N8N, backend Python, Orange Pi, Cloudflare ou a câmera.
7. O estado exibido sobre câmera e monitoramento é fornecido pela API e não obtido por conexão direta do celular com o equipamento.
8. A ausência de Internet ou de resposta da API nunca deve ser apresentada como confirmação de que a piscina está segura.

## 4. Atores

### 4.1 Usuário responsável

Ator principal do aplicativo. Possui uma conta e pode consultar os recursos autorizados, receber alertas e controlar o monitoramento conforme as regras do MVP.

### 4.2 Administração do PoolSafe

Ator externo ao aplicativo mobile. É responsável por associar previamente as câmeras à conta do usuário durante o MVP.

Não haverá no aplicativo uma interface administrativa, cadastro técnico de câmera, pareamento por QR Code ou configuração do gateway.

### 4.3 Serviços externos

- **API PoolSafe:** autenticação, autorização, dados de usuário, câmeras, monitoramento, alertas, histórico e dispositivos;
- **Firebase Cloud Messaging:** entrega de notificações push;
- **sistema operacional Android:** permissões, exibição de notificações e configurações do dispositivo.

## 5. Premissas aprovadas

- As câmeras aparecem na conta já associadas pela administração.
- Um usuário pode possuir zero, uma ou várias câmeras associadas.
- O usuário pode ativar e pausar o monitoramento.
- A pausa exige aviso explícito e confirmação reforçada.
- A plataforma de desenvolvimento permanece React Native, mas os testes de aceite iniciais serão realizados no Android.
- O código deverá preservar compatibilidade arquitetural com iOS, sem tornar a validação de iOS requisito de aceite deste MVP.
- Streaming ao vivo e reprodução de vídeo não fazem parte do MVP.
- O aplicativo pode exibir um frame de evidência autorizado, quando disponível.
- O aplicativo não determina localmente se uma câmera está conectada; apenas representa o estado retornado pela API.

## 6. Arquitetura de navegação

### 6.1 Fluxo não autenticado

```text
Inicialização
├── Login
├── Cadastro
├── Solicitar recuperação de senha
└── Redefinir senha
```

### 6.2 Área autenticada

```text
Bottom Navigation
├── Home
├── Histórico
│   └── Detalhes do alerta
├── Câmeras
│   └── Detalhes da câmera
└── Definições
    ├── Conta
    ├── Notificações
    ├── Aparência
    ├── Sobre
    └── Sair
```

As telas de autenticação não pertencem à Bottom Navigation. Detalhes de alerta e de câmera são abertos acima da navegação principal e devem permitir retorno à tela de origem.

## 7. Jornadas principais

### 7.1 Primeiro acesso

1. O usuário abre o aplicativo.
2. O aplicativo identifica que não existe sessão válida.
3. O usuário acessa o cadastro.
4. O usuário informa os dados obrigatórios e aceita os termos que vierem a ser definidos.
5. A API cria a conta ou retorna erros de validação.
6. Após autenticação, o aplicativo solicita a permissão de notificações no momento apropriado.
7. O aplicativo registra o dispositivo e o FCM Token pela API.
8. O usuário é direcionado à Home.

### 7.2 Acesso recorrente

1. O aplicativo recupera a sessão armazenada de forma segura.
2. A validade da sessão é verificada conforme o mecanismo de autenticação futuro.
3. Com uma sessão válida, o aplicativo abre a área autenticada.
4. Com sessão ausente ou irrecuperável, o aplicativo retorna ao Login.

### 7.3 Consulta do estado do sistema

1. O usuário abre a Home.
2. O aplicativo consulta a API.
3. A Home apresenta o estado do monitoramento, resumo das câmeras, última atualização e alerta mais recente.
4. Se a atualização falhar, o aplicativo diferencia dados desatualizados de estado operacional confirmado.

### 7.4 Pausa e ativação do monitoramento

1. O usuário aciona o controle de monitoramento.
2. O aplicativo apresenta o impacto da ação.
3. Para pausar, o usuário confirma explicitamente e realiza a reautenticação exigida.
4. A API processa a solicitação.
5. O aplicativo só altera o estado definitivo após confirmação da API.
6. O usuário recebe feedback de sucesso ou falha.

Para o MVP, a confirmação reforçada da pausa deverá utilizar a senha da conta, salvo decisão posterior de segurança que substitua esse mecanismo.

### 7.5 Recebimento de alerta

1. O pipeline do PoolSafe produz um alerta e o fluxo de orquestração solicita o envio pelo FCM.
2. O dispositivo recebe a notificação.
3. Ao tocar na notificação, o aplicativo identifica o alerta relacionado.
4. Se necessário, o aplicativo restaura ou solicita autenticação.
5. O aplicativo consulta os dados autorizados pela API.
6. Os Detalhes do alerta são apresentados.
7. Home e Histórico são atualizados.

### 7.6 Consulta ao histórico

1. O usuário abre Histórico.
2. O aplicativo solicita alertas relacionados ao usuário.
3. Os alertas são apresentados do mais recente para o mais antigo.
4. O usuário seleciona um item.
5. O aplicativo abre os Detalhes do alerta.

## 8. Especificação das telas

### 8.1 Inicialização

**Objetivo:** preparar o aplicativo e decidir a rota inicial.

**Responsabilidades:**

- carregar configurações locais necessárias;
- recuperar a sessão segura;
- preparar os providers essenciais;
- verificar se existe uma sessão utilizável;
- encaminhar para Login ou área autenticada;
- evitar exibição prolongada de uma tela vazia.

**Estados:** carregando, falha recuperável e sessão inválida.

### 8.2 Login

**Objetivo:** autenticar um usuário existente.

**Conteúdo mínimo:**

- identidade visual do PoolSafe;
- campo de e-mail;
- campo de senha;
- ação para exibir ou ocultar senha;
- botão Entrar;
- acesso ao Cadastro;
- acesso à Recuperação de senha;
- feedback de validação e autenticação.

**Regras:**

- o botão deve impedir envios duplicados durante o processamento;
- erros de credenciais não devem revelar se uma conta específica existe;
- o formulário deve usar teclado e preenchimento automático adequados;
- a senha não deve ser registrada em logs nem armazenada pelo aplicativo.

### 8.3 Cadastro

**Objetivo:** criar a conta do usuário responsável.

**Conteúdo mínimo:**

- nome;
- e-mail;
- senha;
- confirmação de senha;
- requisitos de senha;
- aceite dos documentos obrigatórios quando definidos;
- botão Criar conta;
- retorno ao Login.

Os campos definitivos e as regras de senha deverão ser alinhados ao contrato da API. A associação de câmeras não ocorre nessa tela.

### 8.4 Recuperação e redefinição de senha

**Objetivo:** permitir que o usuário recupere o acesso à conta.

**Conteúdo mínimo:**

- solicitação por e-mail;
- confirmação genérica do recebimento da solicitação;
- tratamento de link ou código de redefinição;
- definição e confirmação da nova senha;
- retorno ao Login após conclusão.

O provedor de e-mail e o mecanismo exato de entrega permanecem pendentes, mas a jornada faz parte do escopo funcional.

### 8.5 Home

**Objetivo:** comunicar rapidamente se o PoolSafe está operando e se existe algo que exige atenção.

**Conteúdo mínimo:**

- saudação ou identificação do usuário;
- estado geral do monitoramento;
- quantidade de câmeras online em relação ao total associado;
- horário da última atualização dos dados;
- alerta mais recente, quando existir;
- avisos de câmera desconectada, monitoramento pausado ou serviço indisponível;
- atalhos para Câmeras e Histórico.

**Estados sugeridos para o monitoramento:**

- ativo;
- pausado;
- degradado;
- indisponível;
- carregando ou ainda não verificado.

O aplicativo não deve converter falha de comunicação em estado seguro. Se a situação for desconhecida, deve utilizar linguagem como “Não foi possível verificar o monitoramento”.

### 8.6 Histórico

**Objetivo:** apresentar os alertas relacionados ao usuário.

**Conteúdo mínimo de cada item:**

- tipo ou título do alerta;
- severidade do alerta;
- câmera de origem;
- data e horário;
- destaque visual proporcional à prioridade.

**Comportamentos:**

- ordenação decrescente por data;
- atualização manual por gesto ou ação equivalente;
- paginação ou carregamento incremental;
- abertura dos detalhes;
- preservação da posição da lista ao retornar, quando tecnicamente viável.

**Estados:** carregando, lista vazia, erro, sem conexão, carregando próxima página e fim da lista.

Filtros avançados não são obrigatórios no MVP. A arquitetura deve permitir futura filtragem por período, câmera e severidade.

### 8.7 Detalhes do alerta

**Objetivo:** apresentar o contexto disponível de uma possível situação de risco.

**Conteúdo mínimo:**

- título em linguagem não conclusiva, como “Possível situação de risco”;
- severidade;
- data e horário da detecção;
- câmera de origem;
- local ou descrição da câmera, quando disponível;
- frame de evidência autorizado, quando disponível;
- horário do envio ou recebimento da notificação, quando aplicável;

**Regras:**

- a indisponibilidade do frame não pode impedir a exibição dos demais dados;
- frames devem ser tratados como conteúdo sensível;
- não deve existir afirmação automática de afogamento confirmado;
- dados técnicos do modelo, como confiança e bounding boxes, não são obrigatórios na interface do usuário.

### 8.8 Câmeras

**Objetivo:** listar as câmeras associadas à conta.

**Conteúdo mínimo de cada card:**

- nome da câmera;
- local ou descrição;
- online, offline ou estado desconhecido;
- monitoramento ativo ou pausado;
- horário da última comunicação;
- quantidade ou indicação de alertas recentes, quando disponível;
- ação para abrir os detalhes.

**Estados:** carregando, nenhuma câmera associada, erro, dados desatualizados e lista disponível.

A tela não oferece cadastro, exclusão, pareamento ou configuração técnica da câmera no MVP.

### 8.9 Detalhes da câmera

**Objetivo:** apresentar informações operacionais de uma câmera autorizada.

**Conteúdo mínimo:**

- nome e local;
- estado de conexão;
- estado do monitoramento;
- última comunicação;
- alertas recentes relacionados;
- ação para ativar ou pausar o monitoramento.

**Regras:**

- IP, credenciais, URL de stream, protocolo e parâmetros de infraestrutura não são expostos;
- o estado de conexão vem da API;
- a ação de monitoramento deve aguardar confirmação do servidor;
- pausar exige aviso claro e confirmação reforçada;
- em estado offline ou desconhecido, ações incompatíveis devem ser bloqueadas ou explicadas.

### 8.10 Definições

**Objetivo:** agrupar configurações pessoais e informações do aplicativo.

**Seções mínimas:**

#### Conta

- visualizar nome e e-mail;
- editar nome, caso suportado pela API;
- iniciar alteração de senha;
- acessar informações relacionadas à conta.

O e-mail pode permanecer somente leitura no MVP para evitar uma jornada incompleta de reverificação.

#### Notificações

- mostrar se a permissão do sistema operacional está concedida;
- explicar o impacto de manter notificações desativadas;
- solicitar permissão quando aplicável;
- abrir as configurações do sistema quando a permissão não puder ser solicitada novamente;
- reservar espaço para preferências futuras.

O aplicativo não deve prometer controlar sons ou comportamentos que pertencem exclusivamente aos canais e configurações do Android.

#### Aparência

- tema do sistema;
- tema claro;
- tema escuro.

O padrão inicial será acompanhar o sistema. A direção visual principal poderá ser concebida primeiro no tema escuro, mas o modo claro precisa manter legibilidade e identidade próprias antes de ser considerado concluído.

#### Sobre

- nome do aplicativo;
- versão instalada;
- descrição curta;
- aviso de que o sistema não substitui supervisão humana;
- links institucionais ou documentos quando definidos.

#### Sessão

- ação Sair;
- confirmação antes de encerrar a sessão;
- limpeza dos dados locais sensíveis relacionados à sessão.

## 9. Requisitos funcionais

### 9.1 Autenticação e sessão

| ID | Requisito |
|---|---|
| RF-APP-001 | O aplicativo deve permitir o cadastro de um usuário. |
| RF-APP-002 | O aplicativo deve permitir autenticação por e-mail e senha. |
| RF-APP-003 | O aplicativo deve oferecer uma jornada de recuperação de senha. |
| RF-APP-004 | O aplicativo deve manter a sessão de forma segura entre aberturas, conforme o mecanismo definido pela API. |
| RF-APP-005 | O aplicativo deve encerrar a sessão e remover dados locais sensíveis ao executar logout. |
| RF-APP-006 | O aplicativo deve encaminhar sessões expiradas ou inválidas para o fluxo de autenticação. |

### 9.2 Home e monitoramento

| ID | Requisito |
|---|---|
| RF-APP-007 | A Home deve exibir o estado geral do monitoramento retornado pela API. |
| RF-APP-008 | A Home deve exibir a relação entre câmeras online e câmeras associadas. |
| RF-APP-009 | A Home deve exibir o horário da última atualização conhecida. |
| RF-APP-010 | A Home deve destacar alertas recentes e situações que exigem atenção. |
| RF-APP-011 | O usuário deve poder ativar o monitoramento. |
| RF-APP-012 | O usuário deve poder pausar o monitoramento após aviso e confirmação reforçada. |
| RF-APP-013 | O aplicativo deve apresentar o resultado confirmado pela API antes de assumir uma mudança de estado. |

### 9.3 Câmeras

| ID | Requisito |
|---|---|
| RF-APP-014 | O aplicativo deve listar apenas câmeras associadas ao usuário autenticado. |
| RF-APP-015 | Cada câmera deve apresentar nome, local, conexão, monitoramento e última comunicação. |
| RF-APP-016 | O usuário deve poder abrir os detalhes de uma câmera. |
| RF-APP-017 | O aplicativo não deve oferecer associação ou configuração técnica de câmeras no MVP. |

### 9.4 Alertas e histórico

| ID | Requisito |
|---|---|
| RF-APP-018 | O aplicativo deve listar alertas relacionados ao usuário do mais recente para o mais antigo. |
| RF-APP-019 | O histórico deve suportar paginação ou carregamento incremental. |
| RF-APP-020 | O usuário deve poder abrir os detalhes de um alerta. |
| RF-APP-021 | O detalhe deve exibir data, horário, câmera, severidade e evidência disponível. |
| RF-APP-022 | O histórico não deve atribuir ao alerta estados de visualização, verificação ou resolução no MVP. |
| RF-APP-023 | O aplicativo deve comunicar a severidade sem depender exclusivamente de cor. |
| RF-APP-024 | O aplicativo deve atualizar Home e Histórico após o recebimento de um novo alerta. |

### 9.5 Dispositivo e notificações

| ID | Requisito |
|---|---|
| RF-APP-025 | O aplicativo deve solicitar permissão de notificações com contexto adequado. |
| RF-APP-026 | O aplicativo deve obter e registrar o FCM Token pela API. |
| RF-APP-027 | O aplicativo deve atualizar a API quando o FCM Token for renovado. |
| RF-APP-028 | O aplicativo deve tratar notificações em primeiro plano, segundo plano e com o processo encerrado. |
| RF-APP-029 | Tocar em uma notificação deve abrir o alerta correspondente ou um fallback seguro quando ele não estiver disponível. |
| RF-APP-030 | O aplicativo deve representar quando a permissão de notificações estiver desativada. |

### 9.6 Configurações

| ID | Requisito |
|---|---|
| RF-APP-031 | O aplicativo deve permitir a visualização dos dados básicos da conta. |
| RF-APP-032 | O aplicativo deve oferecer acesso à alteração de senha. |
| RF-APP-033 | O aplicativo deve permitir a seleção entre tema do sistema, claro e escuro. |
| RF-APP-034 | O aplicativo deve mostrar a situação da permissão de notificações. |
| RF-APP-035 | O aplicativo deve exibir versão, descrição e aviso de segurança do PoolSafe. |

## 10. Regras de negócio

| ID | Regra |
|---|---|
| RN-APP-001 | O usuário acessa somente dados autorizados pela API. |
| RN-APP-002 | Câmeras são associadas fora do aplicativo durante o MVP. |
| RN-APP-003 | O aplicativo nunca se conecta diretamente ao banco ou à câmera. |
| RN-APP-004 | Pausar o monitoramento exige aviso de impacto e confirmação reforçada. |
| RN-APP-005 | O estado do monitoramento só muda após confirmação da API. |
| RN-APP-006 | Falha de comunicação deve resultar em estado desconhecido ou indisponível, nunca em indicação de segurança. |
| RN-APP-007 | Um alerta representa uma possível situação de risco, não a confirmação de afogamento. |
| RN-APP-008 | Um alerta é um registro imutável da detecção e não possui estado de visualização, verificação ou resolução no MVP. |
| RN-APP-009 | Frames de evidência são dados sensíveis e somente devem ser exibidos a usuários autorizados. |
| RN-APP-010 | Tokens de notificação inválidos devem ser tratados pelo backend e não reutilizados indefinidamente. |
| RN-APP-011 | O aplicativo deve informar quando notificações essenciais estiverem desativadas no sistema operacional. |
| RN-APP-012 | Credenciais e detalhes técnicos da infraestrutura não são exibidos na interface. |

## 11. Matriz de notificações

| Estado do aplicativo | Comportamento esperado |
|---|---|
| Primeiro plano | Apresentar aviso dentro do aplicativo, atualizar dados e permitir abrir o alerta. |
| Segundo plano | Exibir notificação do sistema e navegar para o alerta ao tocar. |
| Encerrado | Exibir notificação do sistema e reconstruir a navegação necessária ao abrir. |
| Sessão expirada | Solicitar autenticação e, após sucesso, tentar continuar para o alerta autorizado. |
| Permissão negada | Exibir aviso persistente apropriado e orientar o usuário a habilitar notificações. |
| Token renovado | Enviar o novo token à API e substituir ou invalidar a associação anterior conforme o contrato. |
| Alerta indisponível | Informar que o item não está disponível e oferecer retorno seguro ao Histórico ou à Home. |

## 12. Estados transversais de interface

Todas as telas que carregam dados remotos devem considerar:

- carregamento inicial;
- atualização em andamento;
- conteúdo disponível;
- conteúdo vazio;
- erro recuperável;
- erro de autenticação;
- ausência de Internet;
- serviço indisponível;
- dados desatualizados;
- acesso negado;
- recurso removido ou não encontrado.

Dados armazenados em cache podem ser exibidos como última informação conhecida, desde que sejam marcados como potencialmente desatualizados e apresentem o horário de referência. Ações que exigem confirmação do servidor devem permanecer indisponíveis sem conexão.

## 13. Requisitos não funcionais

### 13.1 Segurança

- credenciais de sessão devem ser armazenadas em mecanismo seguro do dispositivo;
- senhas nunca devem ser armazenadas localmente;
- a API deve ser consumida por HTTPS;
- tokens, senhas e dados sensíveis não devem aparecer em logs;
- a navegação por notificação deve continuar sujeita à autenticação e autorização;
- logout deve limpar dados locais sensíveis;
- frames e dados de alertas não devem ser persistidos localmente além do necessário sem decisão explícita;
- mensagens de autenticação não devem facilitar enumeração de contas.

### 13.2 Acessibilidade

- cores não podem ser o único indicador de estado;
- controles devem possuir rótulos acessíveis;
- textos essenciais devem manter contraste adequado;
- áreas de toque devem ser compatíveis com uso móvel;
- a interface deve suportar aumento razoável do tamanho de fonte;
- animações decorativas devem respeitar preferências de redução de movimento quando disponíveis;
- alertas críticos devem ser compreensíveis por texto, ícone e hierarquia visual.

### 13.3 Desempenho

- listas devem usar renderização apropriada para conjuntos crescentes;
- telas devem fornecer feedback imediato durante requisições;
- imagens de evidência devem ser dimensionadas e carregadas de forma controlada;
- animações decorativas não devem comprometer navegação ou consumo excessivo de recursos;
- requisições duplicadas devem ser evitadas ou consolidadas quando possível;
- a atualização de dados deve ser compatível com retomada do aplicativo e reconexão de rede.

### 13.4 Confiabilidade

- falhas de rede devem ser tratadas sem encerramento inesperado;
- ações mutáveis não devem parecer concluídas antes da resposta do servidor;
- o aplicativo deve evitar envios repetidos por múltiplos toques;
- erros devem oferecer recuperação ou próximo passo compreensível;
- o usuário deve conseguir distinguir estado confirmado de informação desatualizada.

### 13.5 Manutenibilidade

- TypeScript deve operar em modo estrito;
- estado remoto deve permanecer separado do estado local de interface;
- componentes visuais compartilhados devem seguir o futuro sistema de design;
- regras de acesso a dados devem permanecer fora dos componentes puramente visuais;
- dependências adicionais exigem necessidade e justificativa;
- comportamento público deve possuir testes proporcionais ao risco.

## 14. Direção visual inicial

A direção visual será detalhada em documento próprio. Para o MVP, ficam registradas as seguintes intenções:

- identidade aquática em fundo azul-marinho;
- elementos decorativos de água e bolhas com baixa interferência;
- cards escuros translúcidos com bordas e gradientes controlados;
- ciano e turquesa para informação, conexão e estado seguro;
- amarelo para atenção;
- rosa ou vermelho para possível risco crítico;
- Bottom Navigation escura com item ativo destacado;
- linguagem de central de monitoramento sem excesso de aparência militar ou técnica;
- prioridade à legibilidade e clareza em situações críticas.

A referência visual externa será utilizada como inspiração de linguagem, não como reprodução literal. Autoria, licença e link da referência devem ser preservados na documentação de design.

## 15. Fora do escopo do MVP

- streaming ao vivo;
- reprodução de gravações ou vídeos;
- cadastro manual de câmera pelo usuário;
- pareamento por QR Code;
- configuração de rede, IP, RTSP, MJPEG ou credenciais da câmera;
- administração do Orange Pi, Cloudflare, Contabo, Docker, N8N ou MySQL;
- compartilhamento de câmeras entre usuários pelo aplicativo;
- painel administrativo;
- gráficos avançados e relatórios analíticos;
- mapas geográficos;
- edição de parâmetros do modelo de IA;
- exibição de bounding boxes ou métricas técnicas como requisito de usuário;
- funcionamento offline completo;
- horários e regras avançadas de automação do monitoramento;
- customização avançada de sons, vibração e canais de notificação;
- validação formal do aplicativo em iOS nesta primeira etapa.

## 16. Critérios de aceite de alto nível

### CA-01 - Autenticação

Um usuário com credenciais válidas consegue entrar, fechar e reabrir o aplicativo mantendo uma sessão segura, e posteriormente sair da conta.

### CA-02 - Dashboard

A Home apresenta monitoramento, câmeras, última atualização e alerta recente sem confundir falha de comunicação com estado seguro.

### CA-03 - Câmeras associadas

O usuário visualiza somente câmeras previamente associadas à sua conta e consegue abrir os detalhes de cada uma.

### CA-04 - Controle do monitoramento

O usuário consegue ativar e pausar o monitoramento; a pausa apresenta aviso, exige confirmação reforçada e só é refletida após confirmação da API.

### CA-05 - Histórico

O usuário consulta alertas em ordem cronológica decrescente, percorre mais de uma página de resultados e abre os detalhes de um item.

### CA-06 - Detalhe do alerta

O aplicativo apresenta contexto suficiente para identificar quando, onde e por qual câmera a possível situação de risco foi detectada, exibindo a evidência quando autorizada e disponível.

### CA-07 - Notificação em primeiro plano

Com o aplicativo aberto, um novo alerta gera indicação visível, atualiza os dados e pode ser aberto pelo usuário.

### CA-08 - Notificação em segundo plano

Com o aplicativo em segundo plano, o Android apresenta a notificação e o toque abre o alerta correspondente.

### CA-09 - Aplicativo encerrado

Com o processo encerrado, o Android apresenta a notificação e o aplicativo reconstrói a navegação necessária ao ser aberto por ela.

### CA-10 - Renovação do token

Quando o FCM Token é renovado, o novo valor é enviado à API e o dispositivo continua elegível para receber alertas.

### CA-11 - Permissão negada

Quando as notificações estão desabilitadas, o aplicativo comunica o problema e fornece orientação para habilitá-las.

### CA-12 - Falha de rede

Sem conexão, o aplicativo não encerra inesperadamente, identifica dados desatualizados e impede ações que exigem confirmação do servidor.

### CA-13 - Aparência

A escolha de tema é preservada e todas as informações essenciais permanecem legíveis no modo selecionado.

## 17. Dependências para implementação completa

As dependências de produto, domínio, persistência, design e contrato HTTP estão definidas nos documentos relacionados. Permanecem como dependências de implementação:

- escolha e bootstrap do framework da API;
- geração e validação do `openapi.yaml`;
- criação das migrations a partir do schema aprovado;
- provedor de e-mail para recuperação de senha;
- workflow definitivo do N8N e integração real com FCM;
- implementação dos endpoints e integração do aplicativo com a API.

Essas dependências não impedem a criação da estrutura inicial do frontend, desde que o agente use contratos aprovados ou identifique explicitamente qualquer mock.

## 18. Decisões pendentes não bloqueadoras

- textos finais e microcopy;
- campos adicionais de perfil;
- documentos legais e links institucionais;
- filtros iniciais do Histórico;
- eventual comunicação ao usuário sobre a retenção de 30 dias definida para o MVP;
- preferência exata de sons e vibração;
- conteúdo completo da seção Sobre;
- comportamento visual do tema claro;
- animações e transições;
- textos finais para tipos e severidades de alerta;
- método administrativo de associação de câmeras;
- telemetria e analytics, se vierem a ser adotados.

## 19. Sequência recomendada de desenvolvimento

O MVP deve ser implementado em fatias verticais revisáveis:

1. bootstrap técnico e navegação vazia;
2. identidade visual e componentes fundamentais;
3. Login, Cadastro e sessão;
4. Home com estados simulados e contrato aprovado;
5. lista e detalhes de câmeras;
6. ativação e pausa do monitoramento;
7. Histórico e Detalhes do alerta;
8. registro do dispositivo e FCM Token;
9. notificações em foreground, background e app encerrado;
10. Definições e temas;
11. estados de erro, acessibilidade e refinamento;
12. testes completos do fluxo Android.

Cada fatia deve possuir critérios de aceite próprios e não deve depender da invenção de endpoints temporários sem identificação explícita como mock.

## 20. Documentos relacionados

- `POOLSAFE_SOURCE_OF_TRUTH.md` - arquitetura e decisões canônicas gerais;
- `docs/design-system.md` - identidade, tokens e componentes visuais;
- `docs/database-schema.md` - persistência, relacionamentos e retenção;
- `docs/domain-model.md` - agregados, comandos, consultas e invariantes;
- `docs/api-contract.md` - contratos HTTP, autenticação, erros e schemas;
- futuro `.agents/rules/project-context.md` - contexto curto e regras permanentes para o Antigravity.
