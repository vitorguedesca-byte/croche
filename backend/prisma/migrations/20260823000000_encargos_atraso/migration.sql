-- Multa e juros da mensalidade em atraso.
--
-- O valor ORIGINAL (Invoice.amountCents) não muda nunca. O que muda é quanto a
-- mensalidade custa hoje, e isso é recalculado a cada pedido de Pix:
--   multa de R$ 5,00 a partir do 1º dia de atraso (uma vez, não cresce)
--   juros de 0,001% ao dia, simples, sobre o valor original
-- Os dois números são fixos no código, em backend/src/regrasAula.js.
--
-- `encargosAte` guarda a data usada para calcular o acréscimo embutido no
-- pixCode atual. É por ela que o servidor sabe que o QR ficou desatualizado e
-- precisa ser reemitido com o valor novo. NULL = QR emitido sem acréscimo.

ALTER TABLE `Invoice`
  ADD COLUMN `encargosAte` VARCHAR(10) NULL;
