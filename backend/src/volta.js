/* VOLTA DA EX-ALUNA PELO AUTOATENDIMENTO (Vitor, 19/10/2026).

   Quem foi inativada (ficha "cancelado") volta sozinha — pelo portal, pelo
   site ou pelo robô do WhatsApp — sem passar pela Inêz. Até aqui ela batia
   em três portas fechadas: o portal dizia "cadastro inativo, fale com a
   escola", o robô mandava para o portal e a matrícula do site/robô dizia "você
   já é nossa aluna".

   A volta é uma REMATRÍCULA na mesma ficha: ela escolhe unidade, horário e
   plano e paga o 1º Pix. Decisões do Vitor:
   • a ficha só volta a ficar ATIVA quando o Pix cai. Sem pagamento nada volta,
     e a vaga segurada cai no prazo de sempre;
   • SEM taxa de matrícula: a matrícula é uma só na vida da aluna. O 1º Pix é
     só a mensalidade do plano escolhido;
   • o que ficou para trás não é cobrado: a inativação já cancelou as
     mensalidades pendentes, e a volta começa do zero;
   • só PLANO (1x a 4x). A aula avulsa é a porta de quem está conhecendo a
     escola, e virar avulsa apagaria da ficha a matrícula que ela já tem.

   Enquanto o Pix não cai ela CONTINUA ex-aluna: não vira lead, não entra no
   funil e o plano antigo fica onde está (o relatório de Vendas lê o plano para
   saber o que já era mensalidade). O plano escolhido na volta mora em
   voltaFreq/voltaTipo até o pagamento, e voltaDesde marca a tentativa — é por
   ela que se sabe que o Pix pago é DESTA volta, e não uma reserva velha. */

export const FREQS_VOLTA = [1, 2, 3, 4];

export const ehExAluna = (c) => !!c && c.status === "cancelado";

/* Folga para o relógio: a reserva nasce no mesmo instante em que a volta é
   anotada na ficha, e um milissegundo de diferença não pode recusar o Pix. */
const FOLGA_MS = 60_000;

/* O Pix desta reserva é o da volta? Só se a ficha ainda está inativa, tem uma
   volta em curso e a reserva nasceu depois de a volta começar. Reserva de
   matrícula antiga dela (de quando entrou na escola) nunca reativa ninguém. */
export function ehPagamentoDaVolta(c, booking) {
  if (!ehExAluna(c) || !c.voltaDesde || !booking?.createdAt) return false;
  return new Date(booking.createdAt).getTime() >= new Date(c.voltaDesde).getTime() - FOLGA_MS;
}

/* O que a ficha guarda quando a reserva da volta nasce. `voltaDesde` é o
   começo da PRIMEIRA tentativa desde que ela saiu: se o Pix de uma tentativa
   anterior ainda cair (depois de uma nova), ele continua sendo da volta. */
export function intencaoDaVolta(c, { freq, tipo, agora = new Date() }) {
  const f = FREQS_VOLTA.includes(Number(freq)) ? Number(freq) : null;
  if (!f) throw Object.assign(new Error("Para voltar às aulas, escolha um dos planos (1x a 4x por semana). 💚"), { code: 400 });
  return {
    voltaDesde: c.voltaDesde || agora,
    voltaFreq: f,
    voltaTipo: tipo === "escala" ? "escala" : "fixo",
  };
}

/* A ficha no dia em que o Pix da volta cai. Depois disto quem termina o
   serviço é converterEmMensalista (grade, mês pago, próxima mensalidade).
   • plano da volta vira o plano dela, pelo valor de tabela de hoje — o
     desconto individual antigo (monthlyValue) era do plano antigo;
   • troca de plano pendente (weeklyFreqAnterior/Desde) sai: o plano novo vale
     já;
   • matrícula "paga" (vira "convertida" na conversão). A DATA da matrícula só
     é gravada em quem nunca teve uma e não era mensalista: para a ex-mensalista
     o relatório de Vendas lê essa data como "entrada no plano", e trazê-la
     para hoje faria as aulas antigas dela aparecerem como venda avulsa. */
export function fichaDaVoltaPaga(c, pagoEm) {
  const eraMensalista = c.plan === "mensalista";
  return {
    status: "ativo",
    weeklyFreq: FREQS_VOLTA.includes(Number(c.voltaFreq)) ? Number(c.voltaFreq) : (c.weeklyFreq || 1),
    mensalistaTipo: c.voltaTipo === "escala" ? "escala" : c.voltaTipo === "fixo" ? "fixo" : (c.mensalistaTipo || "fixo"),
    weeklyFreqAnterior: null,
    weeklyFreqDesde: null,
    monthlyValue: null,
    firstClass: false,
    matriculaStatus: "paga",
    ...(eraMensalista || c.matriculaAt ? {} : { matriculaAt: pagoEm }),
    voltaDesde: null,
    voltaFreq: null,
    voltaTipo: null,
    voltaAt: pagoEm,
  };
}

/* Campos da volta zerados — quando a Inêz reativa a ficha pelo painel, a
   tentativa pela metade não pode sobrar para um Pix tardio reativar de novo. */
export const SEM_VOLTA = { voltaDesde: null, voltaFreq: null, voltaTipo: null };
