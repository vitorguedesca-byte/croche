-- Perfis de acesso ao painel.
-- "admin" continua com tudo; "instrutora" só enxerga a Agenda, em modo leitura.
ALTER TABLE `AdminUser` ADD COLUMN `role` VARCHAR(20) NOT NULL DEFAULT 'admin';
ALTER TABLE `AdminUser` ADD COLUMN `nome` VARCHAR(120) NULL;
