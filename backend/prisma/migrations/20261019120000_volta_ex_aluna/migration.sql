-- Volta da ex-aluna pelo autoatendimento (19/10/2026). Só adição.
-- A ex-aluna escolhe horário e plano pelo portal, site ou robô e paga o 1º Pix;
-- até o pagamento a ficha continua "cancelado" e o plano escolhido fica aqui.
ALTER TABLE `Client` ADD COLUMN `voltaDesde` DATETIME(3) NULL;
ALTER TABLE `Client` ADD COLUMN `voltaFreq` INTEGER NULL;
ALTER TABLE `Client` ADD COLUMN `voltaTipo` VARCHAR(10) NULL;
ALTER TABLE `Client` ADD COLUMN `voltaAt` VARCHAR(10) NULL;
