/* Tira do Financeiro de MENSALIDADES as faturas que são, na verdade, aula
   avulsa (Vitor, 08/10/2026).

   Até esta data, pagar a aula avulsa (Pix do site/WhatsApp, "Confirmar
   pagamento" ou "Dar baixa" no painel) criava também uma fatura "paga" da
   competência com o valor da avulsa. Essa fatura aparecia no Financeiro como
   mensalidade (Operação do Mês, Recebido no mês, Recebimentos) e ocupava o
   lugar da mensalidade daquele mês. O servidor já não cria mais; este script
   remove as que ficaram.

   O DINHEIRO NÃO SOME: ele está na própria reserva da avulsa (value, paid,
   paymentDate), e o relatório de Vendas já o mostra como aula avulsa a partir
   dela — a fatura era uma cópia.

   Uma fatura só é considerada da avulsa quando TUDO bate com uma reserva paga
   da mesma aluna que não é matrícula nem aula do plano:
     • mesmo txid; ou, sem txid, paga no mesmo dia em que a reserva foi paga;
     • e o MESMO VALOR. Valor diferente (ex.: R$ 120 pago no dia da avulsa de
       R$ 40) é mensalidade de verdade e fica.

   Roda em modo LISTAGEM por padrão. Só apaga com --apagar — e só depois do
   backup do banco (receita na memória do projeto).

   Rodar (dentro do container do backend, em produção):
     node scripts/separar-avulsas-das-mensalidades.mjs
     node scripts/separar-avulsas-das-mensalidades.mjs --apagar  */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APAGAR = process.argv.includes("--apagar");

// Reservas cujo dinheiro NÃO é avulsa: matrícula (1ª mensalidade) e as do plano.
const NAO_AVULSA = ["1ª mensalidade", "Matrícula", "Mensalista", "Reposição", "Avulsa", "Presente"];
const dia = (v) => String(v || "").slice(0, 10);
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

const main = async () => {
  const [clients, reservas, faturas] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true, phone: true, plan: true } }),
    prisma.booking.findMany({
      where: { paid: true, value: { gt: 0 }, paymentMethod: { notIn: NAO_AVULSA } },
      select: { id: true, clientName: true, phone: true, value: true, paymentMethod: true, paymentDate: true, date: true, txid: true },
    }),
    prisma.invoice.findMany({ where: { status: "pago", amountCents: { gt: 0 } } }),
  ]);
  const porId = new Map(clients.map((c) => [c.id, c]));

  // Reservas de cada aluna — pelo nome (como o resto do sistema) ou pelo final do telefone
  const daAluna = (c) => {
    const tel = onlyDigits(c.phone).slice(-8);
    return reservas.filter((b) => b.clientName === c.name || (tel.length === 8 && onlyDigits(b.phone).endsWith(tel)));
  };

  const achadas = [];
  for (const i of faturas) {
    const c = porId.get(i.clientId);
    if (!c) continue;
    const r = daAluna(c).find((b) => {
      if (Math.round(Number(b.value) * 100) !== i.amountCents) return false;
      if (i.txid) return !!b.txid && b.txid === i.txid;
      return dia(b.paymentDate || b.date) === dia(i.paidAt);
    });
    if (r) achadas.push({ i, c, r });
  }

  achadas.sort((a, b) => dia(a.i.paidAt).localeCompare(dia(b.i.paidAt)));
  console.log(`${achadas.length} fatura(s) de aula avulsa gravada(s) como mensalidade:\n`);
  for (const { i, c, r } of achadas) {
    console.log(`  #${i.id} · ${c.name} (hoje ${c.plan}) · comp ${i.competencia} · R$ ${(i.amountCents / 100).toFixed(2)}` +
      ` · paga ${dia(i.paidAt)}${i.baixaManual ? " (baixa manual)" : ""}` +
      `  ←  aula de ${r.date}, ${r.paymentMethod || "sem forma"} (reserva #${r.id})`);
  }

  if (!APAGAR) {
    console.log("\nModo LISTAGEM — nada foi alterado. Confira os nomes e rode com --apagar (depois do backup).");
    return;
  }
  const { count } = await prisma.invoice.deleteMany({ where: { id: { in: achadas.map(({ i }) => i.id) } } });
  console.log(`\n${count} fatura(s) removida(s). O dinheiro continua nas reservas e no relatório de Vendas.`);
};

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
