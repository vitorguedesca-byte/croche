-- Liberar turma por completo (14/10/2026): a ADMIN esvazia UMA aula, dá o
-- crédito a cada aluna e tranca a turma para alunas novas.
-- Só adição: colunas com padrão, nada é reescrito.
ALTER TABLE `Slot` ADD COLUMN `bloqueada` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `bloqueadaEm` VARCHAR(10) NULL,
    ADD COLUMN `bloqueadaPor` VARCHAR(60) NULL,
    ADD COLUMN `bloqueioMotivo` VARCHAR(200) NULL;

ALTER TABLE `MakeupCredit` ADD COLUMN `porEscola` BOOLEAN NOT NULL DEFAULT false;
