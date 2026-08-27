-- Chave para ligar/desligar a geração automática das mensalidades do mês.
--
-- Até aqui a rodada de hora em hora (rodadaMensalidades no server) era a única
-- dona da criação: 15 segundos depois de todo boot, e depois a cada hora, ela
-- gerava a mensalidade de quem estivesse dentro da janela de antecedência. Não
-- havia como impedir — nem para limpar o financeiro e recomeçar, porque as
-- mensalidades voltavam sozinhas no reinício seguinte.
--
-- Nasce DESLIGADA, no mesmo padrão das outras três chaves de cobrança
-- (travaAtraso, pixExpira, cobrarEncargos): com o valor por competência recém
-- criado, a Inêz precisa poder combinar o preço de um mês ANTES de a cobrança
-- existir. Mensalidade que nasce sozinha no valor de tabela tira essa janela.
--
-- Desligada, as mensalidades só nascem pelo botão "gerar" do painel (a rota
-- POST /api/invoices/gerar-mes e o botão por aluna seguem funcionando normalmente
-- — a chave governa apenas a rodada automática).

ALTER TABLE `Settings`
  ADD COLUMN `geracaoAuto` BOOLEAN NOT NULL DEFAULT false;
