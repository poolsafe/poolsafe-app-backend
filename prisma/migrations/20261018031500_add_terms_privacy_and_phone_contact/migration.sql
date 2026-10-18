-- AlterTable
ALTER TABLE usuario
    ADD COLUMN termos_versao VARCHAR(20) NULL,
    ADD COLUMN termos_aceitos_em DATETIME(3) NULL,
    ADD COLUMN privacidade_versao VARCHAR(20) NULL,
    ADD COLUMN privacidade_ciente_em DATETIME(3) NULL,
    ADD COLUMN contato_telefonico_autorizado BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN contato_telefonico_versao VARCHAR(20) NULL,
    ADD COLUMN contato_telefonico_concedido_em DATETIME(3) NULL,
    ADD COLUMN contato_telefonico_revogado_em DATETIME(3) NULL;
