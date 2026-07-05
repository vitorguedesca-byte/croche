-- AlterTable
ALTER TABLE `booking` ADD COLUMN `absenceReason` VARCHAR(500) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE `Settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `valorPadrao` DOUBLE NOT NULL DEFAULT 80,
    `capacidadePadrao` INTEGER NOT NULL DEFAULT 4,
    `units` VARCHAR(1000) NOT NULL DEFAULT '["Ipatinga","Timóteo"]',
    `profs` VARCHAR(1000) NOT NULL DEFAULT '["Inêz","Equipe FQC"]',
    `horarioFunc` VARCHAR(255) NOT NULL DEFAULT 'Seg a Sáb, 09h às 17h',
    `pixKey` VARCHAR(255) NOT NULL DEFAULT '',
    `pixName` VARCHAR(255) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
