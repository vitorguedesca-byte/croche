/* Em que aba da tela Alunos a ficha cai — ESPELHO de classifyClient,
   ehLeadPrimeiraAula, aulaAvulsaDe e reservasDaPessoa em
   frontend/src/helpers.js. O relatório de Alunos e Leads usa esta regra para
   bater com a tela (Vitor, 25/11/2026): antes ele olhava só o `status` da
   ficha e contava como aluna quem ainda não tinha fechado o plano. Mudou lá,
   muda aqui.

   Devolve "cliente" (aluna) | "novato" (Leads 1ª aula) | "lead" (Leads
   Remarketing) | "ex-aluno". `reservas` = todas as reservas do sistema (a
   ligação é pelo nome ou pelo final do telefone, como na tela). */

const MARCAS_MATRICULA = ["1ª mensalidade", "Matrícula"];
const MARCAS_DO_PLANO = ["Mensalista", "Reposição", "Avulsa", "Presente"]; // "Avulsa" = aula EXTRA

export function reservasDaPessoa(reservas, c) {
  const clientDigits = (c.phone || "").replace(/\D/g, "");
  return (reservas || []).filter((b) => {
    if (b.clientName === c.name) return true;
    if (clientDigits && b.phone) {
      const bDigits = b.phone.replace(/\D/g, "");
      return bDigits && clientDigits.endsWith(bDigits.slice(-8));
    }
    return false;
  });
}

function temAulaAvulsa(bks) {
  return bks.some((b) => b.paymentMethod === "Aula Avulsa" ||
    (Number(b.value) > 0 && !MARCAS_DO_PLANO.includes(b.paymentMethod) && !MARCAS_MATRICULA.includes(b.paymentMethod)));
}

function ehLeadPrimeiraAula(c, bks) {
  if (c.status === "cancelado" || c.status === "inativo") return false;
  if (c.plan === "mensalista" || c.matriculaStatus === "paga" || c.matriculaStatus === "convertida") return false;
  if (!(c.trialDate || c.firstClass || c.status === "lead")) return false;
  return temAulaAvulsa(bks);
}

export function classificarFicha(c, reservas, agora = Date.now()) {
  if (c.status === "cancelado" || c.status === "inativo") return "ex-aluno";
  const bks = reservasDaPessoa(reservas, c);
  if (ehLeadPrimeiraAula(c, bks)) return "novato";

  const activeBks = bks.filter((b) => b.status !== "cancelada");
  const hasPaidBooking = bks.some((b) => b.paid || b.status === "concluida" || (b.status === "confirmada" && b.paymentMethod));
  const isMatriculada = c.matriculaStatus === "paga" || c.matriculaStatus === "convertida" || c.plan === "mensalista";

  // Já pagou alguma aula ou é mensalista matriculada: nunca é lead
  if (hasPaidBooking || isMatriculada) return c.firstClass ? "novato" : "cliente";

  if (c.status === "lead") return "lead";

  const hasActiveHold = activeBks.some((b) => b.status === "aguardando" && b.holdUntil && new Date(b.holdUntil).getTime() > agora);
  if (!hasActiveHold) return "lead";

  return c.firstClass ? "novato" : "cliente";
}
