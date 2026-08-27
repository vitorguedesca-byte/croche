-- Libera as alunas que estavam presas em "Aguardando pagamento".
--
-- O contexto (26/08/2026): a agenda mostrava turma inteira marcada como
-- "Aguardando pagamento", porque toda marcação nasce assim desde o começo.
-- Só que na Fios que Curam NINGUÉM ENTRA NA AGENDA SEM TER PAGO ANTES: a aluna
-- paga (Pix combinado no WhatsApp) e só então a Inêz põe o nome dela na turma.
-- Ou seja, estar na agenda já é o comprovante — o "aguardando" nunca
-- correspondeu à realidade, era só o estado inicial que o código nunca tirava.
--
-- O que esta migration faz com as aulas 'aguardando':
--   1. status → 'confirmada'  (some o rótulo de devedora na agenda)
--   2. paid   → 1             (zera o "A receber" em Recebimentos)
--   3. paymentDate → o dia em que a marcação foi criada, que é o dia em que o
--      pagamento aconteceu (a aula é marcada DEPOIS de pagar).
--
-- O que NÃO é tocado, de propósito:
--   • paymentMethod fica como está. Onde é NULL continua NULL: sabemos que foi
--     pago, não sabemos por qual meio, e inventar "Pix" seria criar registro
--     financeiro que ninguém conferiu. Aparece como "—" em Recebimentos.
--   • Aulas do plano (value = 0, paymentMethod 'Mensalista') não viram "pagas":
--     elas não se pagam por aula, quem as cobre é a mensalidade. Ficam só
--     confirmadas, que é o par que o agendamento em lote do mensalista já usa.
--   • Canceladas e concluídas ficam como estão — são histórico.

UPDATE `Booking`
   SET `status`      = 'confirmada',
       `paid`        = CASE WHEN `value` > 0 THEN 1 ELSE `paid` END,
       `paymentDate` = CASE
                         WHEN `value` > 0 AND `paymentDate` IS NULL
                           THEN DATE_FORMAT(`createdAt`, '%Y-%m-%d')
                         ELSE `paymentDate`
                       END
 WHERE `status` = 'aguardando';
