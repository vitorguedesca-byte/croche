-- Aula extra comprada no portal + as duas travas de cobrança.
--
-- 1. ExtraPass: a aluna paga o Pix da aula extra ANTES de escolher o horário.
--    O passe nasce "pendente", vira "pago" quando o Sicredi confirma e "usado"
--    quando ela marca a aula. Não gera crédito de reposição e não é devolvido.
-- 2. Settings.travaAtraso e Settings.pixExpira: as duas travas de cobrança,
--    criadas DESLIGADAS. A Inêz vira a chave nas Configurações quando quiser.

CREATE TABLE `ExtraPass` (
  `id`            INTEGER      NOT NULL AUTO_INCREMENT,
  `clientId`      INTEGER      NOT NULL,
  `amountCents`   INTEGER      NOT NULL,
  `status`        VARCHAR(20)  NOT NULL DEFAULT 'pendente',
  `txid`          VARCHAR(40)  NULL,
  `pixCode`       TEXT         NULL,
  `paidAt`        VARCHAR(10)  NULL,
  `usedBookingId` INTEGER      NULL,
  `usedAt`        VARCHAR(10)  NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ExtraPass_clientId_idx` (`clientId`),
  INDEX `ExtraPass_txid_idx` (`txid`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ExtraPass`
  ADD CONSTRAINT `ExtraPass_clientId_fkey`
  FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Travas de cobrança, ambas desligadas por ora:
--   travaAtraso = mensalidade vencida bloqueia ganhar/usar crédito de reposição
--   pixExpira   = o Pix da mensalidade morre no vencimento e precisa reemissão
ALTER TABLE `Settings`
  ADD COLUMN `travaAtraso` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `pixExpira`   BOOLEAN NOT NULL DEFAULT false;
