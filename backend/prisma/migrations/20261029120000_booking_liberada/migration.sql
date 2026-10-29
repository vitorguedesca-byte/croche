-- Aula liberada pela aluna (29/10/2026): na mensalista de escala, a aula
-- liberada continua contando no pacote do mês — senão liberar daria o crédito
-- de reposição E a vaga de volta no pacote.
-- Só adição: coluna com default, nada é reescrito.
ALTER TABLE `Booking` ADD COLUMN `liberada` BOOLEAN NOT NULL DEFAULT false;
