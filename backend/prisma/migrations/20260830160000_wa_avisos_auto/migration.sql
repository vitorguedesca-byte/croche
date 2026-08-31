-- Chave para ligar as mensagens que a ESCOLA inicia no WhatsApp — 30/08/2026.
--
-- As rodadas automáticas de aviso chegaram sem interruptor. Medido na produção
-- no dia em que subiram, o primeiro disparo mandaria:
--
--   • 76 mensagens de lembrete da véspera (38 aulas × texto + botões)
--   • 2 lembretes de mensalidade a vencer
--   • 0 cobranças de atraso (a limpeza de 26/08 zerou as vencidas)
--
-- Nenhuma dessas alunas tinha recebido mensagem automática da escola antes. E o
-- risco não é só incomodar: número que recebe mensagem não pedida bloqueia, e
-- número bloqueado não agenda mais ninguém — o mesmo raciocínio que já está
-- escrito no comentário da rodada de conversas paradas.
--
-- Nasce DESLIGADA, no mesmo padrão das outras quatro chaves (travaAtraso,
-- pixExpira, cobrarEncargos, geracaoAuto). A Inêz liga quando quiser, e aí o
-- efeito é imediato: as rodadas rodam de hora em hora.
--
-- O que a chave NÃO governa, de propósito:
--
--   • A conversa do bot em si. Ele continua respondendo quem falar com ele —
--     isso nunca foi automático, é resposta.
--   • A rodada de reservas seguradas (`holdUntil`). Ela só toca reserva criada
--     pelo próprio bot e é o que devolve a vaga quando o Pix não cai; desligá-la
--     deixaria a vaga presa para sempre, que é pior do que o problema.

ALTER TABLE `Settings`
  ADD COLUMN `waAvisosAuto` BOOLEAN NOT NULL DEFAULT false;
