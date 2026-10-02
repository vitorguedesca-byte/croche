-- Aula avulsa de presente nas campanhas (02/10/2026). Só adições.
ALTER TABLE `Voucher` ADD COLUMN `aulasExtras` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `ExtraPass` ADD COLUMN `voucherUsoId` INTEGER NULL;
CREATE INDEX `ExtraPass_voucherUsoId_idx` ON `ExtraPass`(`voucherUsoId`);
