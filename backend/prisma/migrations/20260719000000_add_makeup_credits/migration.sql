-- AlterTable
ALTER TABLE `client` ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'ativo';

-- CreateTable
CREATE TABLE `MakeupCredit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clientId` INTEGER NOT NULL,
    `competencia` VARCHAR(7) NOT NULL,
    `expiresOn` VARCHAR(10) NOT NULL,
    `originBookingId` INTEGER NULL,
    `originDate` VARCHAR(10) NOT NULL,
    `originTime` VARCHAR(5) NOT NULL,
    `usedBookingId` INTEGER NULL,
    `usedAt` VARCHAR(10) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MakeupCredit_clientId_idx`(`clientId`),
    INDEX `MakeupCredit_competencia_idx`(`competencia`),
    INDEX `MakeupCredit_usedBookingId_idx`(`usedBookingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MakeupCredit` ADD CONSTRAINT `MakeupCredit_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
