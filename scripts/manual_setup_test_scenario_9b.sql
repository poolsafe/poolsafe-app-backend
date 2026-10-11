
-- PoolSafe — preparação manual do cenário de teste da Task 9B.2.
-- MySQL 8.4 / banco poolsafe. Execute o arquivo inteiro como script.
-- Altere somente @usuario_id (e, se necessário, @codigo_camera).
-- Use uma câmera dedicada ao teste e execute uma preparação por vez,
-- sem alterar esse monitoramento pelo aplicativo durante a execução.
-- O procedimento auxiliar é criado antes da transação e removido ao final.
-- A conexão precisa poder criar, executar e remover procedimentos no banco.
-- Execute em uma conexão sem outra transação pendente.

USE poolsafe;
SET @usuario_id = 2; -- TROQUE 0 pelo ID do seu usuário já cadastrado.
SET @codigo_camera = 'CAM-TESTE-9B';

DROP PROCEDURE IF EXISTS poolsafe_setup_teste_9b2_20261011;

DELIMITER $$
CREATE PROCEDURE poolsafe_setup_teste_9b2_20261011(
    IN p_usuario_id BIGINT UNSIGNED,
    IN p_codigo_camera VARCHAR(100)
)
SQL SECURITY INVOKER
BEGIN
    DECLARE v_camera_id BIGINT UNSIGNED;
    DECLARE v_monitoramento_id BIGINT UNSIGNED;
    DECLARE v_acesso_id BIGINT UNSIGNED;
    DECLARE v_qtd BIGINT UNSIGNED DEFAULT 0;
    DECLARE v_status_camera VARCHAR(20);
    DECLARE v_status_monitoramento VARCHAR(20);
    DECLARE v_criou_monitoramento BOOLEAN DEFAULT FALSE;
    DECLARE v_reativou_monitoramento BOOLEAN DEFAULT FALSE;
    DECLARE v_agora DATETIME(3);

    -- Toda exceção encerra a chamada, desfaz as escritas e devolve o erro.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SET v_agora = UTC_TIMESTAMP(3);

    IF p_usuario_id IS NULL OR p_usuario_id = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Informe @usuario_id com o ID do seu usuario cadastrado.';
    END IF;

    SELECT COUNT(*) INTO v_qtd
    FROM usuario WHERE id = p_usuario_id AND status = 'ATIVO';
    IF v_qtd <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'O usuario informado nao existe ou nao esta ATIVO.';
    END IF;

    IF p_codigo_camera IS NULL OR CHAR_LENGTH(TRIM(p_codigo_camera)) = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Informe um codigo de camera de teste valido.';
    END IF;

    -- Reutiliza a câmera pelo código único, sem sobrescrever seus dados.
    -- Não simula heartbeat: a câmera poderá aparecer como DESCONHECIDA.
    INSERT INTO camera (
        codigo_integracao, nome, localizacao, status_administrativo,
        ultima_comunicacao_em, criado_em, atualizado_em
    ) VALUES (
        p_codigo_camera, 'Camera Teste 9B', 'Teste controlado', 'ATIVA',
        NULL, v_agora, v_agora
    ) ON DUPLICATE KEY UPDATE codigo_integracao = codigo_integracao;

    SELECT id, status_administrativo INTO v_camera_id, v_status_camera
    FROM camera WHERE codigo_integracao = p_codigo_camera FOR UPDATE;

    IF v_status_camera <> 'ATIVA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'A camera existente esta INATIVA; use uma camera dedicada ativa.';
    END IF;

    -- Nunca escolhe arbitrariamente uma sessão entre várias abertas.
    SELECT COUNT(*), MAX(m.id) INTO v_qtd, v_monitoramento_id
    FROM monitoramento m
    JOIN monitoramento_camera mc ON mc.monitoramento_id = m.id
    WHERE mc.camera_id = v_camera_id AND m.status IN ('ATIVO', 'PAUSADO');

    IF v_qtd > 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Ha mais de uma sessao aberta para a camera; nenhuma alteracao foi confirmada.';
    END IF;

    IF v_qtd = 1 THEN
        -- Este preparador deve atuar somente na sessão da câmera de teste.
        SELECT COUNT(*) INTO v_qtd FROM monitoramento_camera
        WHERE monitoramento_id = v_monitoramento_id;
        IF v_qtd <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A sessao existente contem outras cameras; use um cenario dedicado.';
        END IF;

        SELECT status INTO v_status_monitoramento
        FROM monitoramento WHERE id = v_monitoramento_id FOR UPDATE;
        IF v_status_monitoramento NOT IN ('ATIVO', 'PAUSADO') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'O monitoramento mudou durante a preparacao; execute novamente.';
        END IF;
    END IF;

    -- Preserva todos os períodos revogados. Reutiliza somente acesso ativo.
    SELECT COUNT(*), MAX(id) INTO v_qtd, v_acesso_id
    FROM acesso_camera
    WHERE usuario_id = p_usuario_id AND camera_id = v_camera_id AND ativo = TRUE;

    IF v_qtd > 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Ha mais de um acesso ativo para esse usuario e camera; revise os dados.';
    END IF;

    IF v_qtd = 0 THEN
        INSERT INTO acesso_camera (
            usuario_id, camera_id, ativo, concedido_em,
            revogado_em, criado_em, atualizado_em
        ) VALUES (
            p_usuario_id, v_camera_id, TRUE, v_agora,
            NULL, v_agora, v_agora
        );
        SET v_acesso_id = LAST_INSERT_ID();
    END IF;

    IF v_monitoramento_id IS NULL THEN
        INSERT INTO monitoramento (
            status, iniciado_por_usuario_id, iniciado_em, criado_em, atualizado_em
        ) VALUES ('ATIVO', p_usuario_id, v_agora, v_agora, v_agora);
        SET v_monitoramento_id = LAST_INSERT_ID();
        SET v_status_monitoramento = 'ATIVO';
        SET v_criou_monitoramento = TRUE;

        INSERT INTO monitoramento_camera (monitoramento_id, camera_id, adicionada_em)
        VALUES (v_monitoramento_id, v_camera_id, v_agora);

        INSERT INTO evento_monitoramento (
            monitoramento_id, usuario_id, tipo, motivo, ocorrido_em
        ) VALUES (
            v_monitoramento_id, p_usuario_id, 'INICIADO',
            'Preparacao manual do teste da Task 9B.2.', v_agora
        );
    ELSEIF v_status_monitoramento = 'PAUSADO' THEN
        -- Conserva o instante da última pausa, além do evento histórico.
        UPDATE monitoramento SET status = 'ATIVO', atualizado_em = v_agora
        WHERE id = v_monitoramento_id;
        SET v_status_monitoramento = 'ATIVO';
        SET v_reativou_monitoramento = TRUE;

        INSERT INTO evento_monitoramento (
            monitoramento_id, usuario_id, tipo, motivo, ocorrido_em
        ) VALUES (
            v_monitoramento_id, p_usuario_id, 'REATIVADO',
            'Reativacao manual para teste da Task 9B.2.', v_agora
        );
    END IF;

    COMMIT;

    SELECT p_usuario_id AS usuario_id, v_camera_id AS camera_id,
        p_codigo_camera AS cameraCode, v_acesso_id AS acesso_camera_id,
        v_monitoramento_id AS monitoramento_id,
        v_status_monitoramento AS status_monitoramento,
        v_criou_monitoramento AS novo_monitoramento_criado,
        v_reativou_monitoramento AS monitoramento_reativado,
        (SELECT COUNT(*) FROM dispositivo
         WHERE usuario_id = p_usuario_id AND ativo = TRUE
           AND fcm_token IS NOT NULL AND CHAR_LENGTH(TRIM(fcm_token)) > 0
        ) AS dispositivos_fcm_elegiveis;
END$$
DELIMITER ;

CALL poolsafe_setup_teste_9b2_20261011(@usuario_id, @codigo_camera);
DROP PROCEDURE IF EXISTS poolsafe_setup_teste_9b2_20261011;

-- Se o cliente parar no erro da chamada, as escritas já estarão desfeitas;
-- o procedimento pode permanecer até repetir este script ou removê-lo com
-- o DROP PROCEDURE acima. Ele não é uma migration nem parte da aplicação.
-- Este arquivo não cria alertas, notificações ou entregas, nem altera tokens.


