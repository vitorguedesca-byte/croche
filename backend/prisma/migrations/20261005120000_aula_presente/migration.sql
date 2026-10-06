-- Aula de presente dada pela ADMIN na ficha da aluna (05/10/2026). Só adições.
-- Fica fora de toda conta (plano, aula extra, reposição) — ver regrasAula.js.
CREATE TABLE `AulaPresente` (
  `id`            INTEGER      NOT NULL AUTO_INCREMENT,
  `clientId`      INTEGER      NOT NULL,
  `expiresOn`     VARCHAR(10)  NOT NULL,
  `status`        VARCHAR(12)  NOT NULL DEFAULT 'disponivel',
  `motivo`        VARCHAR(200) NULL,
  `dadoPor`       VARCHAR(60)  NULL,
  `usedBookingId` INTEGER      NULL,
  `usedAt`        VARCHAR(10)  NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AulaPresente_clientId_idx` (`clientId`),
  INDEX `AulaPresente_usedBookingId_idx` (`usedBookingId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AulaPresente`
  ADD CONSTRAINT `AulaPresente_clientId_fkey`
  FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
