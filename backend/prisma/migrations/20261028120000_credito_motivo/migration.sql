-- Motivo de a liberação não ter gerado crédito de reposição (28/10/2026): o
-- portal mostra na aula liberada, depois que o aviso da hora some.
-- Só adição: coluna opcional, nada é reescrito.
ALTER TABLE `Booking` ADD COLUMN `creditoMotivo` VARCHAR(300) NULL;
