-- Trocar o plano de uma mensalista — 30/08/2026.
--
-- Até aqui o plano era imutável depois de definido: `converterEmMensalista`
-- recusava com "Esta aluna já é mensalista.", e o PATCH /api/clients nem sequer
-- aceitava `weeklyFreq` na lista de campos que grava. Não havia caminho nenhum
-- para mudar uma aluna de 1x para 2x — o painel tentava e levava 409.
--
-- A troca vale A PARTIR DO MÊS SEGUINTE, tanto no dinheiro quanto nas aulas:
--
--   Dinheiro — o mês corrente é fixado no valor antigo em `MonthlyPrice` (a
--   tabela de valor por competência criada em 26/08). Assim a mensalidade deste
--   mês sai pelo preço do plano velho mesmo que só venha a ser gerada depois da
--   troca — o que importa aqui, porque a geração automática está desligada e a
--   Inêz emite à mão, às vezes com atraso.
--
--   Aulas — `weeklyFreq` passa a valer o plano NOVO (é o que a ficha mostra e o
--   que vale daqui pra frente), e as duas colunas abaixo guardam de quando ele
--   vale. O teto semanal olha a data da aula: antes de `weeklyFreqDesde`, mede
--   pelo plano antigo. Sem isso, subir de 1x para 2x no dia 30 abriria uma vaga
--   extra na semana que está acabando, dentro de um mês já cobrado pelo plano
--   velho.
--
-- As colunas ficam preenchidas depois da virada, de propósito: elas não são um
-- "pendente a consolidar", são o registro de que ANTES daquela competência o
-- teto era outro. Aula marcada em data passada continua sendo medida certo.

ALTER TABLE `Client`
  ADD COLUMN `weeklyFreqAnterior` INTEGER     NULL,
  ADD COLUMN `weeklyFreqDesde`    VARCHAR(7)  NULL;
