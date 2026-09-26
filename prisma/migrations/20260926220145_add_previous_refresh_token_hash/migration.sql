-- AlterTable
ALTER TABLE sessao_autenticacao
ADD COLUMN token_hash_anterior CHAR(64)
CHARACTER SET ascii
COLLATE ascii_bin
NULL AFTER token_hash;
