-- Feriado: a escola não abre, e nenhuma aula é marcada
--
-- Regra combinada em 01/09/2026. Os feriados NACIONAIS não são guardados aqui:
-- src/feriados.js calcula os fixos e os móveis (Carnaval, Sexta-feira Santa e
-- Corpus Christi andam com a Páscoa, então digitá-los seria erro esperando
-- acontecer). Esta tabela guarda só o que o calendário nacional não sabe:
--
--   • o feriado municipal de Ipatinga, o de Timóteo, um recesso, uma emenda;
--   • o contrário disso — `remove` = neste feriado nacional a escola ABRE.
--
-- A data é única: um dia é feriado ou não é.

CREATE TABLE `Holiday` (
  `id`        INTEGER      NOT NULL AUTO_INCREMENT,
  `date`      VARCHAR(10)  NOT NULL,
  `nome`      VARCHAR(120) NOT NULL DEFAULT 'Feriado',
  `remove`    BOOLEAN      NOT NULL DEFAULT false,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Holiday_date_key`(`date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
