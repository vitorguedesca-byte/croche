/* Revoga os créditos de reposição cuja AULA DE ORIGEM voltou para a agenda
   (Vitor, 15/09/2026).

   O crédito é a troca por uma aula que deixou de acontecer. Quando a aula volta
   a existir na agenda da aluna, não há o que repor: ela ficaria com a aula E
   com o direito de marcar outra. Aconteceu por dois caminhos, ambos legítimos
   vistos de perto — a aluna remarcar a mesma aula que liberou, e a grade dela
   ser reconstruída em lote depois que a linha cancelada foi apagada junto com a
   série. O servidor já não entrega mais esses créditos (creditosComAulaDeVolta
   no server.js); este script limpa os que ficaram para trás no banco.

   DUAS TRAVAS, iguais às do revogar-creditos-feriado.mjs:

   • Crédito JÁ USADO não é tocado. A aula de reposição existe e está marcada;
     apagar o crédito deixaria essa aula órfã — que é o que
     `varrerReposicoesOrfas` passa o dia caçando. Desfazer uma reposição já
     marcada é conversa com a aluna, não linha de script.

   • Roda em modo LISTAGEM por padrão. Só apaga com --apagar: é para você ler a
     lista, reconhecer os nomes e só então confirmar.

   Rodar:
     npx dotenv -e .env -- node scripts/revogar-creditos-aula-de-volta.mjs
     npx dotenv -e .env -- node scripts/revogar-creditos-aula-de-volta.mjs --apagar  */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APAGAR = process.argv.includes("--apagar");
const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const hhmm = (t) => String(t || "").slice(0, 5);

const main = async () => {
  /* Só os não gastos, e só os que ainda valem: crédito vencido não precisa ser
     revogado — ele já não vale nada, e apagá-lo só apagaria histórico. */
  const creditos = await prisma.makeupCredit.findMany({
    where: { usedBookingId: null, expiresOn: { gte: hojeISO() } },
    orderBy: [{ clientId: "asc" }, { originDate: "asc" }],
  });
  if (!creditos.length) {
    console.log("Nenhum crédito em aberto. Nada a fazer.");
    return;
  }

  const clientes = new Map(
    (await prisma.client.findMany({
      where: { id: { in: [...new Set(creditos.map((c) => c.clientId))] } },
      select: { id: true, name: true },
    })).map((c) => [c.id, c.name])
  );

  const alvos = [];
  for (const c of creditos) {
    const nome = clientes.get(c.clientId);
    if (!nome) continue;
    /* A aula é reconhecida por aluna + data + hora, e não por originBookingId:
       nos casos que motivaram este script a reserva original foi APAGADA e uma
       nova nasceu no lugar, com outro id. Procurar pelo id não acharia nada.

       Todas as aulas do dia, e não a primeira: a mensalista 2x tem duas aulas
       na mesma data (16h e 18h). Com `findFirst`, o crédito das 18h era
       comparado com a aula das 16h, não batia, e escapava da limpeza. */
    const doDia = await prisma.booking.findMany({
      where: { clientName: nome, date: c.originDate, status: { not: "cancelada" } },
    });
    const aula = doDia.find((b) => hhmm(b.time) === hhmm(c.originTime));
    if (!aula) continue;
    alvos.push({
      id: c.id, aluna: nome, data: c.originDate, hora: hhmm(c.originTime),
      expira: c.expiresOn, aulaId: aula.id, aulaStatus: aula.status,
    });
  }

  if (!alvos.length) {
    console.log("Nenhum crédito com a aula de origem de volta na agenda. Nada a fazer.");
    return;
  }

  console.log(`\n${alvos.length} crédito(s) em aberto cuja aula de origem está de pé de novo:\n`);
  for (const a of alvos)
    console.log(`  #${String(a.id).padEnd(5)} ${a.aluna.padEnd(38)} liberou ${a.data} ${a.hora}  → aula ${a.aulaId} (${a.aulaStatus}) na agenda  ·  crédito vence ${a.expira}`);

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
