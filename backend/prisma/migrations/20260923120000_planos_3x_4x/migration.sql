-- AlterTable: planos de 3x e 4x por semana (só mensalista fixo)
ALTER TABLE `settings` ADD COLUMN `valorPlano3x` DOUBLE NOT NULL DEFAULT 320;
ALTER TABLE `settings` ADD COLUMN `valorPlano4x` DOUBLE NOT NULL DEFAULT 400;
