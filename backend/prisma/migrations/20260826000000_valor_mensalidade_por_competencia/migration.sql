-- Valor da mensalidade combinado para um mês específico.
--
-- Até aqui só existiam dois valores possíveis: o do plano (tabela de preços) e o
-- individual da aluna (Client.monthlyValue). Faltava o meio-termo — "esse mês
-- ela paga menos", "promoção de 3 meses" — que antes só dava para fazer mexendo
-- no valor recorrente e lembrando de desfazer depois. Com esta tabela o desconto
-- vive só nas competências marcadas e expira sozinho.
--
-- Precedência do valor de uma competência:
--   MonthlyPrice da competência → Client.monthlyValue → plano 1x/2x → legado
--
-- Não mexe em mensalidade já emitida: quando o valor de um mês que já tem boleto
-- muda, o servidor atualiza o Invoice pendente e reemite o Pix (ver
-- aplicarValorNaMensalidade em server.js). Mensalidade paga nunca é tocada.

CREATE TABLE `MonthlyPrice` (
  `id`          INTEGER      NOT NULL AUTO_INCREMENT,
  `clientId`    INTEGER      NOT NULL,
  `competencia` VARCHAR(7)   NOT NULL,
  `amountCents` INTEGER      NOT NULL,
  `origem`      VARCHAR(20)  NOT NULL DEFAULT 'ajuste',
  `motivo`      VARCHAR(200) NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `MonthlyPrice_clientId_competencia_key` (`clientId`, `competencia`),
  INDEX `MonthlyPrice_competencia_idx` (`competencia`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MonthlyPrice`
  ADD CONSTRAINT `MonthlyPrice_clientId_fkey`
  FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
