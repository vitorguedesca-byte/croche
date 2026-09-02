/* Revoga os créditos de reposição que nasceram de FERIADO e ainda não foram
   gastos (Vitor, 02/09/2026).

   Até esta data, cancelar as aulas de um feriado gerava um crédito por
   mensalista. A regra foi invertida: feriado não gera crédito, porque a
   mensalidade já é calculada sobre os dias em que a escola abre — creditar o
   feriado pagaria a aluna duas vezes pelo mesmo dia. O servidor já não cria
   mais esses créditos; este script limpa os que ficaram para trás.

   DUAS TRAVAS, de propósito:

   • Crédito JÁ USADO não é tocado. A aula de reposição existe, aconteceu ou
     está marcada, e apagar o crédito deixaria essa aula órfã — exatamente o que
     `varrerReposicoesOrfas` no server.js passa o dia caçando. O passado não se
     reescreve; o que se corrige é o que ainda vale para frente.

   • Roda em modo LISTAGEM por padrão. Só apaga com --apagar. Este script mexe
     em benefício de aluna: é para você ler a lista, reconhecer os nomes e só
     então confirmar.

   Rodar:
     npx dotenv -e .env -- node scripts/revogar-creditos-feriado.mjs
     npx dotenv -e .env -- node scripts/revogar-creditos-feriado.mjs --apagar  */
import { PrismaClient } from "@prisma/client";
import { calendarioFeriados, anosDoCalendario, feriadoDe } from "../src/feriados.js";

const prisma = new PrismaClient();
const APAGAR = process.argv.includes("--apagar");
const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

const main = async () => {
  /* O calendário é montado igual ao do servidor (loadFeriados): nacionais +
     municipais da unidade + os manuais da Inêz, menos as aberturas ("terá aula
     neste feriado"). Um calendário diferente daria uma resposta diferente da
     que o sistema dá — e aí o script apagaria crédito legítimo. */
  const [manuais, aberturas, settings] = await Promise.all([
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    prisma.holidayOverride.findMany({ where: { hasClasses: true } }),
    prisma.settings.findFirst(),
  ]);
  const anos = anosDoCalendario(hojeISO());
  const unidades = (() => {
    try { return JSON.parse(settings?.units || "[]"); } catch { return []; }
  })();
  const lista = unidades.length ? unidades : ["Ipatinga", "Timóteo"];

  const calPorUnidade = {};
  for (const unidade of lista) {
    const cal = calendarioFeriados(anos, manuais, unidade);
    for (const a of aberturas) if (a.unit === unidade) delete cal[a.date];
    calPorUnidade[unidade] = cal;
  }
  const calGlobal = calendarioFeriados(anos, manuais);

  // Só os não gastos. `usedBookingId` preenchido = crédito que virou aula.
  const creditos = await prisma.makeupCredit.findMany({
    where: { usedBookingId: null },
    orderBy: { originDate: "asc" },
  });

  const alvos = [];
  for (const c of creditos) {
    /* A unidade vem da reserva de origem, que é quem sabe onde a aula seria.
       Sem ela (reserva já apagada), cai na ficha da aluna e, em último caso, no
       calendário global — um feriado nacional é feriado em qualquer unidade. */
    const origem = c.originBookingId
      ? await prisma.booking.findUnique({ where: { id: c.originBookingId } })
      : null;
    const client = await prisma.client.findUnique({ where: { id: c.clientId } });
    const unidade = origem?.unit || client?.unit || "";
    const cal = calPorUnidade[unidade] || calGlobal;
    const nome = feriadoDe(cal, c.originDate);
    if (!nome) continue;
    alvos.push({ id: c.id, aluna: client?.name || `cliente #${c.clientId}`, data: c.originDate, unidade: unidade || "—", feriado: nome, expira: c.expiresOn });
  }

  if (!alvos.length) {
    console.log("Nenhum crédito de feriado por usar. Nada a fazer.");
    return;
  }

  console.log(`\n${alvos.length} crédito(s) de reposição nascido(s) de feriado e ainda não usado(s):\n`);
  for (const a of alvos)
    console.log(`  #${String(a.id).padEnd(5)} ${a.aluna.padEnd(28)} ${a.data}  ${a.feriado} (${a.unidade})  vence ${a.expira}`);

  const vencidos = alvos.filter((a) => a.expira < hojeISO()).length;
  if (vencidos)
    console.log(`\n  (${vencidos} desses já estavam vencidos — não valiam mais nada de qualquer forma.)`);

  if (!APAGAR) {
    console.log("\nModo listagem. Para apagar de verdade, rode de novo com --apagar.");
    return;
  }

  const r = await prisma.makeupCredit.deleteMany({ where: { id: { in: alvos.map((a) => a.id) } } });
  console.log(`\n${r.count} crédito(s) revogado(s).`);
  console.log("As alunas que viam esse crédito no portal deixam de vê-lo. Vale avisar quem já tinha reparado.");
};

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
