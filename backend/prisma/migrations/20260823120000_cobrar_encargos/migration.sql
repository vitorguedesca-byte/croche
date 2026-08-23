-- Chave para ligar/desligar a cobrança de multa e juros da mensalidade em atraso.
--
-- Nasce DESLIGADA, igual às outras duas travas de cobrança: sem ela, subir os
-- encargos faria a multa cair de uma vez sobre todas as mensalidades vencidas
-- (eram 102 na data desta migration). A Inêz vira a chave em Configurações
-- quando decidir que quer cobrar assim.
--
-- Os valores da multa e dos juros continuam fixos no código
-- (MULTA_ATRASO_REAIS e JUROS_DIA_PERCENTUAL em backend/src/regrasAula.js);
-- esta chave controla apenas SE eles são aplicados.

ALTER TABLE `Settings`
  ADD COLUMN `cobrarEncargos` BOOLEAN NOT NULL DEFAULT false;
