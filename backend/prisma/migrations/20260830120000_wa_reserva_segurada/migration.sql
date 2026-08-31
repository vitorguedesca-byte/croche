-- Fluxo do WhatsApp: reserva segurada e avisos de mensalidade — 30/08/2026.
--
-- Até aqui, a conversa do bot terminava reservando a aula sem cobrar nada: a
-- vaga saía da grade na hora e ficava "aguardando" para sempre. Conversa
-- abandonada tirava a vaga de quem ia pagar.
--
-- Agora quem confirma a reserva é o PAGAMENTO. A conversa passa a pedir o plano
-- (1x ou 2x por semana, que define o valor da 1ª mensalidade) e o CPF (o Sicredi
-- exige para emitir o Pix), cria a reserva com `holdUntil` = agora + 1 hora e
-- manda o código. A meia hora do fim, o bot pergunta se ficou dúvida e oferece o
-- atendimento humano (`holdNudged` marca que já perguntou). Passou da hora sem o
-- Pix cair, a rodada cancela a reserva e a vaga volta para a lista.
--
-- Em Invoice entram as datas dos dois avisos automáticos. São DATAS e não
-- booleanos porque o que interessa é quando a escola falou com a aluna — e
-- porque um reenvio acidental fica visível no banco em vez de sumir num true.
--
-- Em WaConversation entram o que a conversa precisa carregar até o pagamento:
-- o plano escolhido, o CPF e a reserva que está segurada.

-- `lembreteAulaAt` é o lembrete da véspera: um toque no dia anterior, com botão
-- para avisar que não vai. É a mensagem de maior retorno prático da escola —
-- ninguém falta de propósito, esquece; e o aviso a tempo vira vaga liberada,
-- crédito justo para quem avisou e turma cheia. A data guarda quando o lembrete
-- saiu, o que impede o segundo envio para a mesma aula.
ALTER TABLE `Booking`
  ADD COLUMN `holdUntil` DATETIME(3) NULL,
  ADD COLUMN `holdNudged` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `lembreteAulaAt` VARCHAR(10) NULL;

CREATE INDEX `Booking_holdUntil_idx` ON `Booking`(`holdUntil`);

ALTER TABLE `Invoice`
  ADD COLUMN `avisoAVencerAt` VARCHAR(10) NULL,
  ADD COLUMN `avisoAtrasoAt` VARCHAR(10) NULL;

-- `retomadaAt` é o lembrete de conversa parada: a aluna começou a marcar e
-- sumiu, e 30 minutos depois o bot retoma dizendo o que falta. A coluna guarda
-- QUANDO o bot cutucou, e fica preenchida até ela responder — é o que faz o
-- lembrete sair uma vez por abandono em vez de um a cada meia hora. Insistir com
-- quem não respondeu é o caminho curto para o bloqueio, e um número bloqueado
-- não agenda mais ninguém.
ALTER TABLE `WaConversation`
  ADD COLUMN `weeklyFreq` INT NULL,
  ADD COLUMN `cpf` VARCHAR(14) NULL,
  ADD COLUMN `bookingId` INT NULL,
  ADD COLUMN `retomadaAt` DATETIME(3) NULL;
