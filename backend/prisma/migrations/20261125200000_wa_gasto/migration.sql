-- Gasto com a Meta no disparo (25/11/2026): cobrança e categoria de cada mensagem, vindas do webhook de status. Só adição.
ALTER TABLE `WaMessage` ADD COLUMN `cobrada` BOOLEAN NULL;
ALTER TABLE `WaMessage` ADD COLUMN `categoria` VARCHAR(30) NULL;
