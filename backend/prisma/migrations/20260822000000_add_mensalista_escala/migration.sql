-- Mensalista escala + travas de sábado e de horário noturno.
--
-- Regra nova combinada com a Inêz:
--   * sábado não faz mais parte do plano de mensalista;
--   * horário a partir das 18:00 também não;
--   * quem JÁ estava nesses horários continua podendo (direito herdado).
--
-- Este backfill é o que congela esse "quem já estava". Depois dele ninguém
-- novo entra em sábado nem à noite: as colunas não são editáveis pelo painel.

ALTER TABLE `Client`
  ADD COLUMN `mensalistaTipo` VARCHAR(10) NOT NULL DEFAULT 'fixo',
  ADD COLUMN `podeSabado` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `podeNoite` BOOLEAN NOT NULL DEFAULT false;

-- As aulas guardam o nome do aluno (não há FK), então o casamento é por nome.
-- Só contam as aulas do próprio plano: reposição e aula extra num sábado não
-- transformam a aluna em "aluna de sábado". A janela de 60 dias para trás evita
-- que uma aula solta de um ano atrás vire direito adquirido.

-- Direito herdado: sábado (DAYOFWEEK = 7 no MySQL)
UPDATE `Client` c
   SET c.`podeSabado` = 1
 WHERE EXISTS (
   SELECT 1 FROM `Booking` b
    WHERE b.`clientName` = c.`name`
      AND b.`status` <> 'cancelada'
      AND b.`date` >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 60 DAY), '%Y-%m-%d')
      AND DAYOFWEEK(b.`date`) = 7
      AND (b.`paymentMethod` IS NULL OR b.`paymentMethod` NOT IN ('Reposição', 'Avulsa'))
 );

-- Direito herdado: aula às 18:00 ou depois (o horário é 'HH:MM', comparação de texto resolve)
UPDATE `Client` c
   SET c.`podeNoite` = 1
 WHERE EXISTS (
   SELECT 1 FROM `Booking` b
    WHERE b.`clientName` = c.`name`
      AND b.`status` <> 'cancelada'
      AND b.`date` >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 60 DAY), '%Y-%m-%d')
      AND b.`time` >= '18:00'
      AND (b.`paymentMethod` IS NULL OR b.`paymentMethod` NOT IN ('Reposição', 'Avulsa'))
 );
