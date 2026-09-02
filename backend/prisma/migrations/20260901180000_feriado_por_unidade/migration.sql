-- A chave "Terá aula" é por data e unidade. O calendário automático guarda o
-- nome; esta tabela registra somente a decisão da ADMIN de abrir no feriado.
CREATE TABLE `HolidayOverride` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(10) NOT NULL,
  `unit` VARCHAR(100) NOT NULL,
  `hasClasses` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `HolidayOverride_date_idx`(`date`),
  UNIQUE INDEX `HolidayOverride_date_unit_key`(`date`, `unit`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
