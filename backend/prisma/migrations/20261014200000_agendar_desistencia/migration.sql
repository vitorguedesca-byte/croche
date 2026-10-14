-- /agendar: quem deixa o WhatsApp e desiste (fase 2 do funil, 14/10/2026).
-- Só adição: duas colunas na Lead e a tabela anônima das visitas.
ALTER TABLE `Lead` ADD COLUMN `siteAula` VARCHAR(80) NULL,
    ADD COLUMN `siteEm` DATETIME(3) NULL;

CREATE TABLE `SiteVisita` (
    `id` VARCHAR(40) NOT NULL,
    `dia` VARCHAR(10) NOT NULL,
    `passo` VARCHAR(12) NOT NULL,
    `unit` VARCHAR(100) NULL,
    `origem` VARCHAR(12) NULL,
    `leadId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SiteVisita_dia_idx`(`dia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
