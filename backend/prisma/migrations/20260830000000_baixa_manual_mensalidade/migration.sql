-- Baixa manual da mensalidade — 30/08/2026.
--
-- Toda baixa dada pelo painel é manual por definição: o Pix pago cai sozinho
-- pelo webhook do Sicredi, sem passar pela tela. Então clicar em "Baixar" é a
-- escola dizendo "recebi por fora" (dinheiro, transferência, acerto pessoal).
--
-- E quem paga por fora não usa Pix. Por isso a mensalidade SEGUINTE nasce sem
-- QR nenhum: nada é enviado para o WhatsApp da aluna, e o portal dela mostra
-- "combinada direto com a escola" em vez de um código que ninguém vai pagar.
--
-- São duas marcas, e elas são diferentes de propósito:
--
--   baixaManual  fica na mensalidade PAGA. É o registro de como o dinheiro
--                entrou, e é o que gerarMensalidade lê ao criar o mês seguinte.
--
--   semPix       fica na mensalidade EM ABERTO que nasceu depois dessa baixa.
--                É a supressão em si: pixPagavelDaMensalidade recusa emitir e o
--                portal não oferece QR.
--
-- A supressão vale por UM mês. O mês seguinte volta ao normal, a não ser que
-- também leve baixa manual. E a saída está sempre à mão: o botão "Gerar Pix"
-- do painel limpa `semPix` e emite o código — é para quando a aluna pedir.

ALTER TABLE `Invoice`
  ADD COLUMN `baixaManual` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `semPix` BOOLEAN NOT NULL DEFAULT false;
