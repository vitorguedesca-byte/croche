-- Disparo também para leads do funil sem ficha (25/11/2026).
ALTER TABLE `WaDisparoItem` MODIFY `clientId` INTEGER NULL;
ALTER TABLE `WaDisparoItem` ADD COLUMN `leadId` INTEGER NULL;
