SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';

-- =========================================================
-- 1. IDENTIDADE
-- =========================================================

CREATE TABLE usuario (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    telefone VARCHAR(20) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
    email_verificado_em DATETIME(3) NULL,
    ultimo_login_em DATETIME(3) NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    desativado_em DATETIME(3) NULL,

    CONSTRAINT pk_usuario PRIMARY KEY (id),
    CONSTRAINT uq_usuario_email UNIQUE (email),
    CONSTRAINT ck_usuario_nome_nao_vazio
        CHECK (CHAR_LENGTH(TRIM(nome)) > 0),
    CONSTRAINT ck_usuario_email_nao_vazio
        CHECK (CHAR_LENGTH(TRIM(email)) > 0),
    CONSTRAINT ck_usuario_status
        CHECK (status IN ('ATIVO', 'BLOQUEADO', 'DESATIVADO')),
    CONSTRAINT ck_usuario_desativacao
        CHECK (status <> 'DESATIVADO' OR desativado_em IS NOT NULL)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- =========================================================
-- 2. CÂMERAS
-- =========================================================

CREATE TABLE camera (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    codigo_integracao VARCHAR(100)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    nome VARCHAR(100) NOT NULL,
    localizacao VARCHAR(150) NULL,
    status_administrativo VARCHAR(20) NOT NULL DEFAULT 'ATIVA',
    ultima_comunicacao_em DATETIME(3) NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    desativado_em DATETIME(3) NULL,

    CONSTRAINT pk_camera PRIMARY KEY (id),
    CONSTRAINT uq_camera_codigo_integracao UNIQUE (codigo_integracao),
    CONSTRAINT ck_camera_codigo_nao_vazio
        CHECK (CHAR_LENGTH(TRIM(codigo_integracao)) > 0),
    CONSTRAINT ck_camera_nome_nao_vazio
        CHECK (CHAR_LENGTH(TRIM(nome)) > 0),
    CONSTRAINT ck_camera_status_administrativo
        CHECK (status_administrativo IN ('ATIVA', 'INATIVA')),
    CONSTRAINT ck_camera_desativacao
        CHECK (status_administrativo <> 'INATIVA' OR desativado_em IS NOT NULL),

    INDEX idx_camera_status_comunicacao
        (status_administrativo, ultima_comunicacao_em)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- =========================================================
-- 3. DISPOSITIVOS E AUTENTICAÇÃO
-- =========================================================

CREATE TABLE dispositivo (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    usuario_id BIGINT UNSIGNED NOT NULL,
    identificador_instalacao VARCHAR(128)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    plataforma VARCHAR(20) NOT NULL,
    fcm_token VARCHAR(512)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    token_atualizado_em DATETIME(3) NULL,
    ultimo_acesso_em DATETIME(3) NULL,
    invalidado_em DATETIME(3) NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_dispositivo PRIMARY KEY (id),
    CONSTRAINT uq_dispositivo_usuario_instalacao
        UNIQUE (usuario_id, identificador_instalacao),
    CONSTRAINT uq_dispositivo_fcm_token UNIQUE (fcm_token),
    CONSTRAINT ck_dispositivo_identificador_nao_vazio
        CHECK (CHAR_LENGTH(TRIM(identificador_instalacao)) > 0),
    CONSTRAINT ck_dispositivo_plataforma
        CHECK (plataforma IN ('ANDROID', 'IOS')),
    CONSTRAINT ck_dispositivo_ativo
        CHECK (ativo IN (FALSE, TRUE)),
    CONSTRAINT ck_dispositivo_invalidacao
        CHECK (
            (ativo = TRUE AND invalidado_em IS NULL)
            OR
            (ativo = FALSE AND invalidado_em IS NOT NULL)
        ),
    CONSTRAINT fk_dispositivo_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,

    INDEX idx_dispositivo_usuario_ativo (usuario_id, ativo)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE sessao_autenticacao (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    usuario_id BIGINT UNSIGNED NOT NULL,
    dispositivo_id BIGINT UNSIGNED NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expira_em DATETIME(3) NOT NULL,
    ultimo_uso_em DATETIME(3) NULL,
    revogada_em DATETIME(3) NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_sessao_autenticacao PRIMARY KEY (id),
    CONSTRAINT uq_sessao_autenticacao_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_sessao_autenticacao_expiracao
        CHECK (expira_em > criado_em),
    CONSTRAINT fk_sessao_autenticacao_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_sessao_autenticacao_dispositivo
        FOREIGN KEY (dispositivo_id) REFERENCES dispositivo (id)
        ON UPDATE RESTRICT ON DELETE SET NULL,

    INDEX idx_sessao_usuario_revogacao_expiracao
        (usuario_id, revogada_em, expira_em),
    INDEX idx_sessao_expiracao (expira_em)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE token_recuperacao_senha (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    usuario_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expira_em DATETIME(3) NOT NULL,
    utilizado_em DATETIME(3) NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_token_recuperacao_senha PRIMARY KEY (id),
    CONSTRAINT uq_token_recuperacao_senha_hash UNIQUE (token_hash),
    CONSTRAINT ck_token_recuperacao_senha_expiracao
        CHECK (expira_em > criado_em),
    CONSTRAINT fk_token_recuperacao_senha_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON UPDATE RESTRICT ON DELETE CASCADE,

    INDEX idx_token_recuperacao_usuario (usuario_id, criado_em),
    INDEX idx_token_recuperacao_expiracao (expira_em, utilizado_em)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- =========================================================
-- 4. AUTORIZAÇÃO DE CÂMERAS
-- =========================================================

CREATE TABLE acesso_camera (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    usuario_id BIGINT UNSIGNED NOT NULL,
    camera_id BIGINT UNSIGNED NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    concedido_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    revogado_em DATETIME(3) NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_acesso_camera PRIMARY KEY (id),
    CONSTRAINT ck_acesso_camera_periodo
        CHECK (
            (ativo = TRUE AND revogado_em IS NULL)
            OR
            (ativo = FALSE AND revogado_em IS NOT NULL)
        ),
    CONSTRAINT ck_acesso_camera_revogacao_cronologica
        CHECK (revogado_em IS NULL OR revogado_em >= concedido_em),
    CONSTRAINT fk_acesso_camera_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_acesso_camera_camera
        FOREIGN KEY (camera_id) REFERENCES camera (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,

    INDEX idx_acesso_camera_usuario_ativo_camera
        (usuario_id, ativo, camera_id),
    INDEX idx_acesso_camera_camera_ativo_usuario
        (camera_id, ativo, usuario_id)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- =========================================================
-- 5. MONITORAMENTO
-- =========================================================

CREATE TABLE monitoramento (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
    iniciado_por_usuario_id BIGINT UNSIGNED NOT NULL,
    iniciado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    pausado_em DATETIME(3) NULL,
    encerrado_em DATETIME(3) NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_monitoramento PRIMARY KEY (id),
    CONSTRAINT ck_monitoramento_status
        CHECK (status IN ('ATIVO', 'PAUSADO', 'ENCERRADO')),
    CONSTRAINT ck_monitoramento_pausa
        CHECK (status <> 'PAUSADO' OR pausado_em IS NOT NULL),
    CONSTRAINT ck_monitoramento_encerramento
        CHECK (
            (status = 'ENCERRADO' AND encerrado_em IS NOT NULL)
            OR
            (status <> 'ENCERRADO' AND encerrado_em IS NULL)
        ),
    CONSTRAINT ck_monitoramento_datas
        CHECK (
            (pausado_em IS NULL OR pausado_em >= iniciado_em)
            AND
            (encerrado_em IS NULL OR encerrado_em >= iniciado_em)
        ),
    CONSTRAINT fk_monitoramento_usuario_iniciador
        FOREIGN KEY (iniciado_por_usuario_id) REFERENCES usuario (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,

    INDEX idx_monitoramento_status_inicio (status, iniciado_em),
    INDEX idx_monitoramento_usuario_iniciador (iniciado_por_usuario_id)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE monitoramento_camera (
    monitoramento_id BIGINT UNSIGNED NOT NULL,
    camera_id BIGINT UNSIGNED NOT NULL,
    adicionada_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_monitoramento_camera
        PRIMARY KEY (monitoramento_id, camera_id),
    CONSTRAINT fk_monitoramento_camera_monitoramento
        FOREIGN KEY (monitoramento_id) REFERENCES monitoramento (id)
        ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_monitoramento_camera_camera
        FOREIGN KEY (camera_id) REFERENCES camera (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,

    INDEX idx_monitoramento_camera_camera_monitoramento
        (camera_id, monitoramento_id)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE evento_monitoramento (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    monitoramento_id BIGINT UNSIGNED NOT NULL,
    usuario_id BIGINT UNSIGNED NULL,
    tipo VARCHAR(20) NOT NULL,
    motivo VARCHAR(255) NULL,
    ocorrido_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_evento_monitoramento PRIMARY KEY (id),
    CONSTRAINT ck_evento_monitoramento_tipo
        CHECK (tipo IN ('INICIADO', 'PAUSADO', 'REATIVADO', 'ENCERRADO')),
    CONSTRAINT fk_evento_monitoramento_monitoramento
        FOREIGN KEY (monitoramento_id) REFERENCES monitoramento (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_evento_monitoramento_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON UPDATE RESTRICT ON DELETE SET NULL,

    INDEX idx_evento_monitoramento_ocorrido
        (monitoramento_id, ocorrido_em)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- =========================================================
-- 6. ALERTAS E EVIDÊNCIAS
-- =========================================================

CREATE TABLE alerta (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    chave_evento VARCHAR(100)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    monitoramento_id BIGINT UNSIGNED NOT NULL,
    camera_id BIGINT UNSIGNED NOT NULL,
    tipo VARCHAR(50) NOT NULL DEFAULT 'POSSIVEL_RISCO',
    severidade VARCHAR(20) NOT NULL,
    detectado_em DATETIME(3) NOT NULL,
    confianca DECIMAL(5,4) NULL,
    versao_modelo VARCHAR(50) NULL,
    dados_tecnicos JSON NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_alerta PRIMARY KEY (id),
    CONSTRAINT uq_alerta_chave_evento UNIQUE (chave_evento),
    CONSTRAINT ck_alerta_chave_evento_nao_vazia
        CHECK (CHAR_LENGTH(TRIM(chave_evento)) > 0),
    CONSTRAINT ck_alerta_tipo
        CHECK (tipo IN ('POSSIVEL_RISCO')),
    CONSTRAINT ck_alerta_severidade
        CHECK (severidade IN ('ATENCAO', 'CRITICA')),
    CONSTRAINT ck_alerta_confianca
        CHECK (confianca IS NULL OR confianca BETWEEN 0.0000 AND 1.0000),
    CONSTRAINT fk_alerta_monitoramento
        FOREIGN KEY (monitoramento_id) REFERENCES monitoramento (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_alerta_camera
        FOREIGN KEY (camera_id) REFERENCES camera (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_alerta_monitoramento_camera
        FOREIGN KEY (monitoramento_id, camera_id)
        REFERENCES monitoramento_camera (monitoramento_id, camera_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,

    INDEX idx_alerta_camera_deteccao (camera_id, detectado_em DESC),
    INDEX idx_alerta_monitoramento_deteccao
        (monitoramento_id, detectado_em DESC),
    INDEX idx_alerta_monitoramento_camera
        (monitoramento_id, camera_id)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE evidencia_alerta (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alerta_id BIGINT UNSIGNED NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    conteudo LONGBLOB NULL,
    tamanho_bytes BIGINT UNSIGNED NOT NULL,
    hash_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expira_em DATETIME(3) NOT NULL,
    removida_em DATETIME(3) NULL,

    CONSTRAINT pk_evidencia_alerta PRIMARY KEY (id),
    CONSTRAINT uq_evidencia_alerta_alerta UNIQUE (alerta_id),
    CONSTRAINT ck_evidencia_alerta_mime_type
        CHECK (mime_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT ck_evidencia_alerta_tamanho
        CHECK (tamanho_bytes > 0),
    CONSTRAINT ck_evidencia_alerta_disponibilidade
        CHECK (
            (removida_em IS NULL AND conteudo IS NOT NULL)
            OR
            (removida_em IS NOT NULL AND conteudo IS NULL)
        ),
    CONSTRAINT ck_evidencia_alerta_expiracao
        CHECK (expira_em >= criado_em),
    CONSTRAINT fk_evidencia_alerta_alerta
        FOREIGN KEY (alerta_id) REFERENCES alerta (id)
        ON UPDATE RESTRICT ON DELETE CASCADE,

    INDEX idx_evidencia_alerta_expiracao_remocao
        (expira_em, removida_em)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE alerta_destinatario (
    alerta_id BIGINT UNSIGNED NOT NULL,
    usuario_id BIGINT UNSIGNED NOT NULL,
    atribuido_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_alerta_destinatario PRIMARY KEY (alerta_id, usuario_id),
    CONSTRAINT fk_alerta_destinatario_alerta
        FOREIGN KEY (alerta_id) REFERENCES alerta (id)
        ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_alerta_destinatario_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,

    INDEX idx_alerta_destinatario_usuario_atribuicao
        (usuario_id, atribuido_em DESC)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- =========================================================
-- 7. NOTIFICAÇÕES PUSH
-- =========================================================

CREATE TABLE notificacao (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alerta_id BIGINT UNSIGNED NOT NULL,
    usuario_id BIGINT UNSIGNED NOT NULL,
    titulo VARCHAR(120) NOT NULL,
    mensagem VARCHAR(500) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
    criada_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    processada_em DATETIME(3) NULL,

    CONSTRAINT pk_notificacao PRIMARY KEY (id),
    CONSTRAINT uq_notificacao_alerta_usuario UNIQUE (alerta_id, usuario_id),
    CONSTRAINT ck_notificacao_titulo_nao_vazio
        CHECK (CHAR_LENGTH(TRIM(titulo)) > 0),
    CONSTRAINT ck_notificacao_mensagem_nao_vazia
        CHECK (CHAR_LENGTH(TRIM(mensagem)) > 0),
    CONSTRAINT ck_notificacao_status
        CHECK (
            status IN (
                'PENDENTE',
                'PROCESSADA',
                'PARCIAL',
                'FALHA',
                'SEM_DISPOSITIVO'
            )
        ),
    CONSTRAINT ck_notificacao_processamento
        CHECK (
            (status = 'PENDENTE' AND processada_em IS NULL)
            OR
            (status <> 'PENDENTE' AND processada_em IS NOT NULL)
        ),
    CONSTRAINT fk_notificacao_alerta_destinatario
        FOREIGN KEY (alerta_id, usuario_id)
        REFERENCES alerta_destinatario (alerta_id, usuario_id)
        ON UPDATE RESTRICT ON DELETE CASCADE,

    INDEX idx_notificacao_usuario_criacao (usuario_id, criada_em DESC),
    INDEX idx_notificacao_status_criacao (status, criada_em)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE entrega_notificacao (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    notificacao_id BIGINT UNSIGNED NOT NULL,
    dispositivo_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
    tentativas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    fcm_message_id VARCHAR(255) NULL,
    erro_codigo VARCHAR(100) NULL,
    erro_detalhe VARCHAR(500) NULL,
    ultima_tentativa_em DATETIME(3) NULL,
    enviada_em DATETIME(3) NULL,
    criada_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_entrega_notificacao PRIMARY KEY (id),
    CONSTRAINT uq_entrega_notificacao_notificacao_dispositivo
        UNIQUE (notificacao_id, dispositivo_id),
    CONSTRAINT ck_entrega_notificacao_status
        CHECK (status IN ('PENDENTE', 'ENVIADA', 'FALHA', 'TOKEN_INVALIDO')),
    CONSTRAINT ck_entrega_notificacao_envio
        CHECK (status <> 'ENVIADA' OR enviada_em IS NOT NULL),
    CONSTRAINT fk_entrega_notificacao_notificacao
        FOREIGN KEY (notificacao_id) REFERENCES notificacao (id)
        ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_entrega_notificacao_dispositivo
        FOREIGN KEY (dispositivo_id) REFERENCES dispositivo (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,

    INDEX idx_entrega_notificacao_status_tentativa
        (status, ultima_tentativa_em)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- =========================================================
-- 8. LOGS OPERACIONAIS
-- =========================================================

CREATE TABLE log_sistema (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    nivel VARCHAR(20) NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    descricao VARCHAR(500) NOT NULL,
    alerta_id BIGINT UNSIGNED NULL,
    monitoramento_id BIGINT UNSIGNED NULL,
    camera_id BIGINT UNSIGNED NULL,
    dados JSON NULL,
    ocorrido_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_log_sistema PRIMARY KEY (id),
    CONSTRAINT ck_log_sistema_nivel
        CHECK (nivel IN ('INFO', 'AVISO', 'ERRO')),
    CONSTRAINT ck_log_sistema_categoria_nao_vazia
        CHECK (CHAR_LENGTH(TRIM(categoria)) > 0),
    CONSTRAINT ck_log_sistema_descricao_nao_vazia
        CHECK (CHAR_LENGTH(TRIM(descricao)) > 0),
    CONSTRAINT fk_log_sistema_alerta
        FOREIGN KEY (alerta_id) REFERENCES alerta (id)
        ON UPDATE RESTRICT ON DELETE SET NULL,
    CONSTRAINT fk_log_sistema_monitoramento
        FOREIGN KEY (monitoramento_id) REFERENCES monitoramento (id)
        ON UPDATE RESTRICT ON DELETE SET NULL,
    CONSTRAINT fk_log_sistema_camera
        FOREIGN KEY (camera_id) REFERENCES camera (id)
        ON UPDATE RESTRICT ON DELETE SET NULL,

    INDEX idx_log_sistema_ocorrido (ocorrido_em),
    INDEX idx_log_sistema_categoria_ocorrido (categoria, ocorrido_em),
    INDEX idx_log_sistema_alerta (alerta_id),
    INDEX idx_log_sistema_monitoramento (monitoramento_id),
    INDEX idx_log_sistema_camera (camera_id)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
