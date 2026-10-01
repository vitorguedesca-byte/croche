-- Campanhas promocionais com código (voucher). Tabelas novas, nada existente muda.
CREATE TABLE IF NOT EXISTS `Voucher` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(20) NOT NULL,
    `nome` VARCHAR(120) NOT NULL,
    `descricao` VARCHAR(500) NULL,
    `publico` VARCHAR(10) NOT NULL DEFAULT 'novas',
    `isentaMatricula` BOOLEAN NOT NULL DEFAULT false,
    `descontoTipo` VARCHAR(12) NULL,
    `descontoValor` DOUBLE NULL,
    `descontoMeses` INTEGER NOT NULL DEFAULT 1,
    `aulaExperimental` BOOLEAN NOT NULL DEFAULT false,
    `valorExperimental` DOUBLE NOT NULL DEFAULT 0,
    `premio` VARCHAR(200) NULL,
    `planos` VARCHAR(40) NOT NULL DEFAULT '[]',
    `unidade` VARCHAR(100) NULL,
    `inicio` VARCHAR(10) NULL,
    `fim` VARCHAR(10) NULL,
    `limiteUsos` INTEGER NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `criadoPor` VARCHAR(60) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Voucher_codigo_key`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `VoucherUso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `voucherId` INTEGER NOT NULL,
    `clientId` INTEGER NULL,
    `nome` VARCHAR(120) NOT NULL,
    `cpf` VARCHAR(14) NULL,
    `contexto` VARCHAR(12) NOT NULL,
    `bookingId` INTEGER NULL,
    `invoiceId` INTEGER NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'reservado',
    `descontoCents` INTEGER NOT NULL DEFAULT 0,
    `resumo` VARCHAR(300) NULL,
    `meses` VARCHAR(2000) NOT NULL DEFAULT '[]',
    `premioEntregueAt` VARCHAR(10) NULL,
    `confirmadoAt` VARCHAR(10) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `VoucherUso_voucherId_idx`(`voucherId`),
    INDEX `VoucherUso_clientId_idx`(`clientId`),
    INDEX `VoucherUso_bookingId_idx`(`bookingId`),
    INDEX `VoucherUso_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `VoucherUso_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Código de promoção na conversa do WhatsApp (01/10/2026)
ALTER TABLE `WaConversation` ADD COLUMN `voucher` VARCHAR(30) NULL;
