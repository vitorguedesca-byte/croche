-- Adiciona campo PIN ao Client (hash bcrypt do PIN de 4 dígitos)
ALTER TABLE `Client` ADD COLUMN `pin` VARCHAR(255) NULL;
