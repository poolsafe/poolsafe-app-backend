-- PoolSafe - Inicialização do ambiente MySQL 8.4 local para desenvolvimento
-- Criação do banco shadow para o Prisma Migrate e concessão de privilégios restritos

CREATE DATABASE IF NOT EXISTS `poolsafe_shadow`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Garantir privilégios do usuário de desenvolvimento exclusivamente nos dois bancos locais
GRANT ALL PRIVILEGES ON `poolsafe`.* TO 'poolsafe_dev'@'%';
GRANT ALL PRIVILEGES ON `poolsafe_shadow`.* TO 'poolsafe_dev'@'%';
FLUSH PRIVILEGES;
