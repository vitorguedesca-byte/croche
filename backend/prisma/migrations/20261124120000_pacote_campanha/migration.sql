-- Pacote nas campanhas com código (24/11/2026). Só adições.
ALTER TABLE `Voucher` ADD COLUMN `pacoteInicio` VARCHAR(7) NULL;
ALTER TABLE `Voucher` ADD COLUMN `pacoteGratis` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Voucher` ADD COLUMN `pacotePagos` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Voucher` ADD COLUMN `pacoteVenceEm` VARCHAR(10) NULL;
ALTER TABLE `Invoice` ADD COLUMN `descricao` VARCHAR(200) NULL;
