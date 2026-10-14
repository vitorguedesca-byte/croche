-- Funil de leads (14/10/2026). Só adição: duas tabelas novas.
-- Sem backfill aqui: as leads das fichas que já existem nascem sozinhas na
-- sincronização do servidor (sincronizarFunil), então o `db push` do deploy
-- basta — nenhum SQL precisa rodar à mão na produção.
CREATE TABLE `Lead` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `phoneKey` VARCHAR(12) NULL,
    `unit` VARCHAR(100) NULL,
    `clientId` INTEGER NULL,
    `canal` VARCHAR(12) NULL,
    `origem` VARCHAR(12) NULL,
    `origemDetalhe` VARCHAR(200) NULL,
    `utm` VARCHAR(1000) NULL,
    `etapa` VARCHAR(12) NOT NULL DEFAULT 'contato',
    `etapaDesde` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `detalhe` VARCHAR(160) NULL,
    `marcouAt` VARCHAR(10) NULL,
    `pagouAt` VARCHAR(10) NULL,
    `ganhaAt` VARCHAR(10) NULL,
    `proximoContato` VARCHAR(10) NULL,
    `ultimoContatoAt` DATETIME(3) NULL,
    `perdidaAt` VARCHAR(10) NULL,
    `motivoPerda` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Lead_clientId_key`(`clientId`),
    INDEX `Lead_phoneKey_idx`(`phoneKey`),
    INDEX `Lead_etapa_idx`(`etapa`),
    INDEX `Lead_createdAt_idx`(`createdAt`),
    INDEX `Lead_proximoContato_idx`(`proximoContato`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LeadEvento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `tipo` VARCHAR(12) NOT NULL,
    `texto` VARCHAR(1000) NOT NULL,
    `por` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeadEvento_leadId_idx`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LeadEvento` ADD CONSTRAINT `LeadEvento_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
