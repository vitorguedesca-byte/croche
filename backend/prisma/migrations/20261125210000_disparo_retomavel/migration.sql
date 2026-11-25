-- Disparo que continua depois de um deploy (25/11/2026): a configuração do envio fica gravada. Só adição.
ALTER TABLE `WaDisparo` ADD COLUMN `config` TEXT NULL;
