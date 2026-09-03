import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const hoje = new Date().toISOString().slice(0, 10);
const d = new Date(hoje + "T00:00:00Z");
// domingo da semana corrente
const fimSemana = addDays(hoje, 6 - ((d.getUTCDay() + 6) % 7));

console.log(`Hoje: ${hoje}`);
console.log(`Fim da semana atual (domingo): ${fimSemana}`);

async function limpar() {
  const escalaClients = await prisma.client.findMany({
    where: { mensalistaTipo: "escala" }
  });

  console.log(`Encontradas ${escalaClients.length} alunas de escala.`);

  for (const c of escalaClients) {
    const futuras = await prisma.booking.findMany({
      where: {
        clientName: c.name,
        date: { gt: fimSemana },
        status: { not: "cancelada" },
        paymentMethod: "Mensalista",
      },
      orderBy: { date: "asc" }
    });

    console.log(`\n- ${c.name}: ${futuras.length} aula(s) futuras recorrentes além desta semana.`);
    if (futuras.length > 0) {
      const res = await prisma.booking.deleteMany({
        where: { id: { in: futuras.map(b => b.id) } }
      });
      console.log(`  ✓ Removidas ${res.count} aulas das semanas seguintes.`);
    }

    const restantes = await prisma.booking.findMany({
      where: { clientName: c.name, date: { gte: hoje }, status: { not: "cancelada" } }
    });
    console.log(`  Aulas ativas mantidas nesta semana:`, restantes.map(b => `${b.date} ${b.time}`));
  }
}

limpar().finally(() => prisma.$disconnect());
