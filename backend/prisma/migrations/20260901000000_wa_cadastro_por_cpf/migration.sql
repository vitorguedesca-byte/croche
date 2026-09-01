-- Cadastro da aluna pela conversa do WhatsApp
--
-- A conversa passou a COMEÇAR pelo CPF: antes de marcar, o bot procura a ficha.
-- Quem já existe é reconhecida pelo nome e segue direto; quem não existe
-- preenche nome, WhatsApp, e-mail e data de nascimento ali mesmo, e a ficha
-- nasce no painel marcada como "Cadastro via WhatsApp". O Pix da 1ª mensalidade
-- sai com esse mesmo CPF.
--
-- As colunas abaixo guardam esses dados enquanto a conversa acontece (só viram
-- ficha quando o conjunto está completo), contam as vezes que ela pediu para
-- falar com uma pessoa (o número do atendente só sai na 3ª) e marcam a hora da
-- última mensagem DELA, que é o relógio das 12 horas de expiração.

ALTER TABLE `WaConversation`
  ADD COLUMN `pendingEmail` VARCHAR(255) NULL,
  ADD COLUMN `pendingBirthday` VARCHAR(10) NULL,
  ADD COLUMN `pendingPhone` VARCHAR(20) NULL,
  ADD COLUMN `clientId` INT NULL,
  ADD COLUMN `humanoPedidos` INT NOT NULL DEFAULT 0,
  ADD COLUMN `lastInboundAt` DATETIME(3) NULL;

-- De onde veio a ficha. O painel usa para mostrar "Cadastro via WhatsApp" —
-- aquele nome e aquela data de nascimento foram digitados pela própria aluna,
-- sem ninguém conferindo do outro lado.
ALTER TABLE `Client`
  ADD COLUMN `origem` VARCHAR(20) NULL;

-- Fichas que já vieram do portal ficam identificadas pelo que a rota gravava em
-- `notes` na época. É só para o histórico não nascer todo em branco.
UPDATE `Client`
   SET `origem` = 'portal'
 WHERE `origem` IS NULL
   AND `notes` LIKE '%Cadastrou-se pelo portal do aluno%';
