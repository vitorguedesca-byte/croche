-- Pix que caiu e não deu baixa em nada (14/10/2026). Só adição.
-- `pagoPorTxid` guarda a via que quitou a mensalidade pelo Pix, para separar
-- "webhook repetido" de "segundo Pix numa mensalidade já paga".
ALTER TABLE `Invoice` ADD COLUMN `pagoPorTxid` VARCHAR(40) NULL;

CREATE TABLE `PixAlerta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `txid` VARCHAR(40) NOT NULL,
    `motivo` VARCHAR(20) NOT NULL,
    `valorCents` INTEGER NOT NULL,
    `pagoEm` VARCHAR(30) NULL,
    `e2eId` VARCHAR(40) NULL,
    `clientId` INTEGER NULL,
    `clientName` VARCHAR(200) NULL,
    `descricao` VARCHAR(500) NOT NULL,
    `resolvidoAt` VARCHAR(10) NULL,
    `resolvidoPor` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PixAlerta_txid_key`(`txid`),
    INDEX `PixAlerta_resolvidoAt_idx`(`resolvidoAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
