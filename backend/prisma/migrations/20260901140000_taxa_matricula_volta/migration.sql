-- A taxa de matrícula VOLTA (01/09/2026)
--
-- Ela saiu em 28/08 diluída na mensalidade (migration 20260828000000) e volta
-- agora como parcela SEPARADA e visível: R$ 20 somados à 1ª mensalidade da
-- aluna nova, uma vez só. Do segundo pagamento em diante é só a mensalidade.
--
-- Duas colunas, e é importante que sejam duas:
--
-- · Settings.taxaMatricula — quanto a escola cobra HOJE. Volta a ser campo (e
--   não número no código) porque já mudou duas vezes em cinco dias. Zerar aqui
--   desliga a taxa, sem deploy.
--
-- · Booking.taxaMatricula — quanto foi cobrado DAQUELA aluna. `value` é o que
--   ela paga (mensalidade + taxa), e o financeiro precisa saber separar: a
--   fatura do mês nasce com o valor da MENSALIDADE, senão a receita da escola
--   passa a mostrar R$ 20 a mais por aluna nova, para sempre. Guardar na reserva
--   também é o que faz a devolução sair certa quando a tabela mudar depois.
--
-- Reservas antigas ficam com NULL = sem taxa, que é a verdade: quem se
-- matriculou entre 28/08 e hoje pagou só a mensalidade.

ALTER TABLE `Settings`
  ADD COLUMN `taxaMatricula` DOUBLE NOT NULL DEFAULT 20;

ALTER TABLE `Booking`
  ADD COLUMN `taxaMatricula` DOUBLE NULL;
