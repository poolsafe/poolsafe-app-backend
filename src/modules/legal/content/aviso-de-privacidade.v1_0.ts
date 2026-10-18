/**
 * Conteúdo canônico do Aviso de Privacidade v1.0 do PoolSafe.
 * Data de elaboração/atualização: 18 de outubro de 2026.
 *
 * Avisos editoriais e instruções internas foram removidos da apresentação pública.
 */
export const PRIVACY_NOTICE_V1_0 = `# PoolSafe — Aviso de Privacidade

**Versão:** 1.0  
**Data de atualização:** 18 de outubro de 2026  

## 1. Quem responde pelos seus dados

Este Aviso explica o tratamento de dados no aplicativo e na infraestrutura do PoolSafe, protótipo acadêmico de apoio à verificação de situações de risco em ambientes de piscina.

**Responsáveis indicados pelo projeto pelas decisões de tratamento — controladores, no âmbito das decisões que efetivamente exercerem:** Cristyan Lisboa Soares David, Daniel Borges Maciel e Jonatas Clara dos Santos.  
**Canal para privacidade e solicitações:** poolsafeoficial@gmail.com.

A vinculação do projeto a um TCC não permite presumir que a instituição de ensino seja a controladora dos dados. A identificação acima deve refletir quem efetivamente decide sobre o tratamento.

O responsável pelo ambiente da câmera e a equipe do projeto podem ter responsabilidades diferentes, conforme suas decisões e atividades. Os papéis devem ser esclarecidos na organização de cada teste; não são definidos apenas por este Aviso.

## 2. Dados utilizados e suas finalidades

| Grupo | Dados envolvidos | Para que são utilizados |
|---|---|---|
| Conta | Nome, e-mail, senha fornecida no acesso e hash de senha armazenado | Criar e identificar a conta, autenticar o usuário e permitir recuperação de acesso |
| Contato opcional | Telefone informado pelo usuário e registro da autorização correspondente | Contato complementar da equipe sobre suporte, avisos operacionais e situações relacionadas ao uso do protótipo |
| Sessão e instalação | Identificadores de conta, sessão e instalação; tokens de autenticação e de notificação; plataforma e informações técnicas necessárias | Manter o acesso e encaminhar notificações aos aparelhos vinculados |
| Câmeras e monitoramento | Identificadores e nomes das câmeras, identificação do local, permissões de acesso, horários e ações de início, pausa e encerramento | Definir quais recursos cada usuário pode acessar e registrar a operação do monitoramento |
| Eventos e evidências | Tipo e horário do evento, câmera relacionada, destinatários, resultado de envio e imagem de evidência quando existente | Comunicar o evento e permitir sua consulta por pessoas autorizadas |
| Manifestações | Versões dos documentos, data e hora de aceite dos Termos, ciência deste Aviso e autorizações específicas quando aplicáveis | Demonstrar quais informações foram apresentadas e quais escolhas foram realizadas |
| Segurança e suporte | Registros técnicos limitados de operação e informações encaminhadas pelo próprio solicitante | Investigar falhas, proteger acessos e responder a solicitações |

O cadastro não solicita CPF nem dados de pagamento. O local associado à câmera é uma informação do ambiente monitorado; não corresponde a rastreamento contínuo da localização do celular.

A senha é processada para autenticação e armazenada no servidor como hash, e não em formato legível. Tokens e segredos não devem integrar registros comuns de diagnóstico. Nos serviços de conexão e proteção podem ser processados dados técnicos, como endereço IP e informações da requisição, conforme a operação de cada serviço.

## 3. Imagens e pessoas que não possuem conta

O projeto contempla a análise de vídeo da câmera para identificar situações de desequilíbrio próximo à piscina. A integração da detecção real ao aplicativo deve ser distinguida das demonstrações que utilizam eventos e imagens de teste.

O armazenamento de evidência descrito aqui é de imagens associadas a eventos. O escopo do aplicativo não inclui um arquivo de gravação contínua de vídeo. A existência de gravação própria na câmera ou em outro equipamento do ambiente deve ser informada separadamente por quem a configurar.

Uma imagem pode permitir identificar alguém mesmo sem seu nome. Dependendo de seu conteúdo, também pode revelar informações sensíveis e exigir proteção adicional. [1]

**O cadastro de uma pessoa não autoriza automaticamente a filmagem ou o uso de imagens de outras pessoas.** Pessoas filmadas também podem utilizar o canal da seção 1 para exercer direitos.

No estágio atual, a equipe informa utilizar imagens dos próprios integrantes e datasets públicos, sem ter aplicado TCLE a participantes externos. A concordância dos integrantes com o uso de sua imagem deve corresponder aos usos efetivamente realizados. A disponibilidade pública de um dataset não significa, por si só, licença irrestrita: devem ser respeitadas suas condições de uso, atribuição e proteção dos titulares. [1][9]

Se forem incluídos participantes externos, a equipe utilizará o modelo de Termo de Consentimento Livre e Esclarecido (TCLE) da UNIP, especificando filmagem, armazenamento e apresentação acadêmica, antes da coleta, com as assinaturas e a anexação exigidas pela instituição. Treinamento de modelos, publicação identificável ou outros usos precisam estar contemplados quando previstos. Este Aviso não declara que tais autorizações já tenham sido obtidas.

## 4. Fundamentos do tratamento

O aceite dos Termos, a ciência deste Aviso e o consentimento para uma finalidade específica são registros diferentes. A ciência deste Aviso não funciona como autorização geral para qualquer uso dos dados. [1]

Para o escopo desta minuta, adota-se a seguinte proposta de enquadramento, a ser confirmada pelos responsáveis antes da publicação:

| Operação | Fundamento proposto e delimitação |
|---|---|
| Conta, autenticação, recuperação de acesso e funcionalidades solicitadas pelo titular | Execução da relação de uso disciplinada pelos Termos, na medida em que os dados sejam necessários ao que o usuário solicitou — art. 7º, V |
| Telefone opcional para contato complementar | Consentimento específico e facultativo — arts. 7º, I, e 8º; a autorização deve acompanhar a finalidade de contato e não pode ser embutida no aceite obrigatório dos Termos |
| Dados pessoais identificáveis de participantes em testes planejados, incluindo imagens | Consentimento próprio dos participantes — art. 7º, I; se houver dado sensível, consentimento específico e destacado nos termos do art. 11, I, salvo outro fundamento efetivamente aplicável e previamente documentado |

A proposta não declara que todas as operações do projeto já possuem fundamento validado. Tratamento adicional por obrigação legal ou exercício de direitos exige identificar a situação concreta e sua necessidade; não se usa uma lista de bases legais como autorização indeterminada.

A finalidade acadêmica, por si só, não dispensa fundamento para o tratamento. O art. 4º, II, “b”, preserva a aplicação dos arts. 7º e 11 nesse contexto. A equipe também não se presume “órgão de pesquisa” apenas por desenvolver um TCC. A finalidade de apoiar a segurança não será utilizada como justificativa automática para toda captura ou conservação de imagens. [1]

## 5. Sua escolha sobre o telefone

Informar telefone é opcional. A equipe solicitará uma autorização específica para utilizá-lo em contato complementar ao e-mail. A recusa não impede a conta nem altera o recebimento de push pelo aplicativo.

Esse contato poderá tratar de suporte, avisos operacionais ou situações relacionadas ao uso do protótipo. Não haverá uso para publicidade. O telefone não é uma central de emergência e não implica acompanhamento humano contínuo das câmeras.

Você poderá alterar ou remover o número no perfil e retirar a autorização pelo canal da seção 1. A retirada interrompe contatos futuros baseados nessa autorização. Um registro mínimo da escolha poderá ser mantido somente quando houver fundamento e necessidade de sua conservação, que serão informados ao titular.

Alertas automáticos por WhatsApp e SMS são possibilidades futuras. Não estão habilitados pelo fornecimento do número ou pelo aceite dos Termos. Antes de oferecê-los, serão apresentados os serviços envolvidos e as condições de uso, com ativação específica e confirmação do número.

## 6. Acesso aos dados e serviços envolvidos

O acesso deve se limitar aos usuários autorizados e às pessoas da equipe que precisem dos dados para operação, manutenção ou atendimento de solicitações. O acesso técnico da equipe não equivale a acompanhamento humano contínuo do ambiente.

No aplicativo, evidências são disponibilizadas aos destinatários autorizados do evento. Revogar posteriormente um acesso à câmera não elimina automaticamente o acesso a eventos anteriormente destinados àquela conta. Solicitações relacionadas a esses registros serão analisadas individualmente.

Os serviços atualmente documentados no projeto incluem:

| Serviço | Participação no tratamento |
|---|---|
| Contabo | Hospedagem dos servidores e do banco do projeto |
| Cloudflare | Conexão protegida e tráfego entre componentes e aplicativo |
| Google Firebase Cloud Messaging | Encaminhamento de notificações, utilizando identificadores do aplicativo e do dispositivo e dados necessários do evento |
| Resend | Envio de e-mails transacionais, como recuperação de acesso, com endereço do destinatário e conteúdo necessário |
| n8n na infraestrutura do projeto | Orquestração do fluxo de eventos e notificações e de rotinas de manutenção; registros de execução precisam ser minimizados |

A imagem de evidência é consultada pelo aplicativo na API autenticada do PoolSafe. Não precisa ser anexada ao push ou ao e-mail de recuperação. Credenciais e endereços técnicos da câmera não são apresentados ao usuário do aplicativo.

O cadastro não autoriza venda de dados, envio de publicidade ou compartilhamento indiscriminado de imagens.

## 7. Tratamento fora do Brasil

A VPS principal está na região **Hub Europe da Contabo**, conforme informação da equipe. A Contabo identifica esse centro como localizado na União Europeia; não se infere um país específico apenas do nome da região. [5]

Além da hospedagem, existem os seguintes fluxos internacionais, conforme as informações públicas consultadas dos provedores:

| Serviço | Destinos ou alcance informado | Finalidade do fluxo no PoolSafe |
|---|---|---|
| Contabo | Hub Europe, União Europeia | Hospedagem da aplicação e do banco |
| Cloudflare | Rede global, incluindo processamento ou acesso nos Estados Unidos | Comunicação e proteção do tráfego |
| Google Firebase Cloud Messaging | Infraestrutura global do Google, com possibilidade de tratamento nos Estados Unidos e em outros países onde mantenha instalações | Entrega de notificações e tratamento dos identificadores necessários |
| Resend | Armazenamento nos Estados Unidos, independentemente da região escolhida para envio do e-mail | E-mails transacionais e registros associados |

Esses dados não permanecem necessariamente no Brasil. Os termos de processamento e informações dos provedores estão nas referências [5] a [8]. Informações adicionais sobre os fluxos do projeto podem ser solicitadas pelo contato da seção 1.

Para as operações estritamente necessárias às funcionalidades solicitadas pelo titular, o enquadramento a avaliar é o art. 33, IX, combinado com o art. 7º, V, da LGPD. Esse enquadramento não cobre automaticamente tratamentos adicionais nem todas as imagens de terceiros. Outros fluxos exigem fundamento próprio e, quando cabível, mecanismo contratual compatível com as regras brasileiras. A ciência deste Aviso não é consentimento específico para uma transferência internacional. [1][4]

A existência de cláusulas europeias, certificações ou um contrato de processamento do provedor não será apresentada como comprovação automática de cumprimento das exigências brasileiras. A Resend, especificamente, informa não assinar cláusulas-padrão brasileiras; a conformidade do fluxo não pode ser presumida a partir de seu contrato europeu. [8]

## 8. Conservação e eliminação

**Imagens de evidência:** a imagem fica disponível por até 30 dias contados da criação do registro de evidência, salvo remoção antecipada cabível. Ao vencer, o acesso é bloqueado; uma rotina diária remove o conteúdo da imagem do banco. Se a rotina falhar, o bloqueio de acesso por expiração continua aplicável, mas a limpeza física pode aguardar a correção.

**Demais registros:** a exclusão da imagem não apaga automaticamente o alerta, seus destinatários, o histórico de monitoramento ou os registros de envio. Não existe, no estado documentado, expurgo geral automático desses registros após 30 dias.

**Conta e dados operacionais sob controle da equipe:** o escopo atual é o período de desenvolvimento e avaliação do TCC. Até **30 dias após a aprovação final do trabalho**, a equipe realizará exclusão ou anonimização efetiva dos dados pessoais operacionais, abrangendo conta, telefone, sessões, dispositivos, históricos, manifestações e registros técnicos sob seu controle. O procedimento será manual; não se declara uma rotina automática já implementada. Solicitações anteriores continuam possíveis.

O encerramento do protótipo é a previsão atual. Uma eventual continuidade exigirá revisar previamente o escopo, as finalidades e a conservação, informar os envolvidos e obter as manifestações cabíveis. A possibilidade de continuidade não prorroga automaticamente o prazo acima.

Documentos institucionais e autorizações, se produzidos, serão guardados separadamente pelo prazo aplicável indicado pela instituição. Eventual conservação excepcional por obrigação ou defesa de direitos deve ser delimitada e justificada, e não constitui extensão geral do prazo operacional.

**Backups:** a equipe informa que atualmente não mantém cópias de segurança de dados do projeto. Isso não significa ausência de cópias ou registros internos dos provedores. Se a equipe passar a produzir backups com dados pessoais, essas cópias serão incluídas no procedimento de limpeza e não deverão restaurar indevidamente dados eliminados.

**Registros dos provedores:** não estão todos sujeitos ao controle direto da equipe nem à exclusão simultânea no banco do PoolSafe. A Resend informa prazos próprios, incluindo até 90 dias para exclusão de dados remanescentes após encerramento da conta. O Firebase informa que identificadores de instalação exigem solicitação própria de eliminação, com conclusão nos sistemas ativos e de backup em até 180 dias após essa solicitação. A equipe deve solicitar as eliminações cabíveis; apagar apenas o registro local não substitui esses procedimentos. [7][8]

Solicitações de eliminação serão analisadas pelo canal da seção 1. Eventual conservação ou impossibilidade de atendimento imediato deverá ser explicada com sua justificativa e alcance. [1][2]

## 9. Segurança

O projeto utiliza controle de acesso por conta, comunicação protegida, hash de senha e restrição de acesso às evidências. O aplicativo mantém as imagens consultadas temporariamente em memória, sem oferecer download ou compartilhamento ou armazená-las de forma persistente no escopo atual.

Nenhuma dessas medidas constitui garantia absoluta contra incidentes. Não compartilhe senhas e comunique acessos suspeitos. Incidentes serão avaliados pelos responsáveis e comunicados às pessoas e autoridades competentes quando exigido pelas regras aplicáveis.

## 10. Seus direitos e como solicitar atendimento

Você pode pedir confirmação de tratamento, acesso, correção, informações sobre compartilhamento e, conforme a situação, anonimização, bloqueio, eliminação, portabilidade, oposição e revogação de consentimento. Também pode pedir informações sobre a recusa de consentimento e suas consequências e recorrer à autoridade de proteção de dados. [2]

As solicitações devem ser enviadas ao canal da seção 1 e serão tratadas sem cobrança. Para proteger dados de terceiros, a equipe poderá solicitar apenas os elementos proporcionais necessários para confirmar a identidade ou a representação do solicitante.

Pessoas sem conta que apareçam nas imagens também podem solicitar atendimento. Sempre que possível, informe data aproximada e ambiente do registro, sem enviar documentos ou dados excessivos.

A ausência de um botão específico no aplicativo não elimina a possibilidade de exercer direitos pelo contato indicado. Encerrar sessão, desinstalar o aplicativo ou remover a permissão de notificações não equivale a excluir dados dos servidores.

## 11. Crianças e adolescentes

O aplicativo não solicita que crianças criem contas para aparecerem nas imagens. Isso não afasta os cuidados necessários caso sejam filmadas.

Testes que envolvam crianças ou adolescentes exigem organização específica, avaliação de seu melhor interesse e definição da base legal pertinente. Quando o tratamento se fundamentar no consentimento de responsável, ele deve ser obtido e verificado de forma adequada, com informações próprias sobre finalidade e uso das imagens. A manifestação do titular de uma conta não representa autorização de responsáveis por outras crianças. [3]

Estes documentos não substituem as autorizações e avaliações éticas ou institucionais cabíveis ao estudo.

## 12. Análise automatizada e uso acadêmico

O objetivo da análise de imagens é sinalizar eventos para verificação humana. Uma classificação não confirma afogamento nem substitui avaliação humana. Dúvidas ou pedidos sobre classificações relacionadas aos seus dados podem ser encaminhados ao canal da seção 1.

Não há autorização genérica, por meio deste Aviso, para usar imagens operacionais no treinamento de modelos ou publicar pessoas identificáveis no TCC, em apresentações ou redes sociais. Uma nova finalidade depende de avaliação própria e de autorização específica quando exigida. Resultados acadêmicos devem priorizar dados agregados, imagens de demonstração autorizadas ou anonimização efetiva.

## 13. Atualizações deste Aviso

As versões serão identificadas e disponibilizadas de forma acessível. Mudanças relevantes nas finalidades, dados ou serviços envolvidos serão informadas. Novos consentimentos serão solicitados quando necessários, sem presumir autorização pelo silêncio ou pelo aceite de uma versão anterior.

## 14. Referências normativas e orientativas

Referências consultadas em 18 de outubro de 2026. As descrições do funcionamento do PoolSafe também se baseiam na documentação técnica do projeto e nas decisões deste checkpoint; tais documentos internos não são fontes normativas.

1. **BRASIL. Lei nº 13.709, de 14 de agosto de 2018 — Lei Geral de Proteção de Dados Pessoais.** Especialmente arts. 4º, II, “b”; 5º a 11; 14 a 20; 33 a 36; e 46 a 49. [Texto atualizado — Câmara dos Deputados](https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html).
2. **ANPD. Direito dos Titulares.** Orientações sobre direitos e atendimento de solicitações. [Página oficial](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares).
3. **ANPD. Enunciado CD/ANPD nº 1, de 22 de maio de 2023.** Bases legais e melhor interesse no tratamento de dados de crianças e adolescentes. [Texto — Ministério da Justiça e Segurança Pública](https://bibliotecadigital.mj.gov.br/bitstream/1/10215/2/Enunciado_ANPD_2023_1.html).
4. **ANPD. Resolução CD/ANPD nº 19, de 23 de agosto de 2024**, com retificação de 18 de agosto de 2025. Regulamento de Transferência Internacional de Dados e cláusulas-padrão contratuais. [Texto oficial](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024).
5. **CONTABO. Hub Europe e proteção de dados.** Confirmação de que o centro se encontra na União Europeia. [Informação oficial do suporte](https://help.contabo.com/de/support/solutions/articles/103000311185-hat-die-migration-in-das-hub-europe-data-center-auswirkungen-auf-die-gdpr-oder-den-schutz-meiner-date).
6. **CLOUDFLARE. Brazil LGPD FAQs e Data Processing Addendum.** [Informações sobre LGPD](https://www.cloudflare.com/trust-hub/brazil-lgpd/) e [contrato de processamento](https://www.cloudflare.com/cloudflare-customer-dpa/).
7. **GOOGLE FIREBASE. Privacy and Security in Firebase; Data Processing and Security Terms.** Localizações globais e retenção dos identificadores de instalação. [Privacidade e segurança](https://firebase.google.com/support/privacy/) e [termos de processamento](https://firebase.google.com/terms/data-processing-terms). Não se confunde o Firebase installation ID com o identificador próprio de instalação do PoolSafe.
8. **RESEND. Security; GDPR; Data Processing Addendum.** Localização dos dados, prazos de retenção e limitações dos instrumentos oferecidos. [Segurança](https://resend.com/security), [informações de processamento e retenção](https://resend.com/security/gdpr) e [contrato de processamento](https://resend.com/legal/dpa).
9. **ANPD. Guia orientativo — Tratamento de dados pessoais para fins acadêmicos e para a realização de estudos e pesquisas.** Versão 1.0, junho de 2023. [Página oficial e acesso ao guia](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-tratamento-de-dados-pessoais-para-fins-academicos-e-para-a-realizacao-de-estudos-e-pesquisas).
`;
