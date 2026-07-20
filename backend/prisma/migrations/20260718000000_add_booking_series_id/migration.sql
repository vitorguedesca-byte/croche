-- AlterTable
ALTER TABLE `booking` ADD COLUMN `seriesId` VARCHAR(40) NULL;

-- CreateIndex
CREATE INDEX `Booking_seriesId_idx` ON `booking`(`seriesId`);
