-- AlterTable: tabela de preços
ALTER TABLE `settings` ADD COLUMN `taxaMatricula` DOUBLE NOT NULL DEFAULT 20;
ALTER TABLE `settings` ADD COLUMN `valorPlano1x` DOUBLE NOT NULL DEFAULT 120;
ALTER TABLE `settings` ADD COLUMN `valorPlano2x` DOUBLE NOT NULL DEFAULT 200;
ALTER TABLE `settings` ADD COLUMN `valorAvulsa` DOUBLE NOT NULL DEFAULT 40;
ALTER TABLE `settings` ADD COLUMN `duracaoAulaMin` INTEGER NOT NULL DEFAULT 120;

-- AlterTable: plano e taxa de matrícula do aluno
ALTER TABLE `client` ADD COLUMN `weeklyFreq` INTEGER NULL;
ALTER TABLE `client` ADD COLUMN `matriculaStatus` VARCHAR(20) NOT NULL DEFAULT 'nao_aplica';
ALTER TABLE `client` ADD COLUMN `matriculaAt` VARCHAR(10) NULL;
ALTER TABLE `client` ADD COLUMN `matriculaRefundAt` VARCHAR(10) NULL;
ALTER TABLE `client` ADD COLUMN `trialDate` VARCHAR(10) NULL;
