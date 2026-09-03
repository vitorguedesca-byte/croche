import { PrismaClient } from "@prisma/client";
import { tipoMensalista, podeReplicarMensalista, PGTO_PLANO, PGTO_EXTRA, PGTO_REPOSICAO, SEMANAS_PADRAO } from "./src/regrasAula.js";
import { feriadoDe, calendarioFeriados, anosDoCalendario } from "./src/feriados.js";

const prisma = new PrismaClient();

const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const hhmm = (v) => {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return s;
};

async function simular() {
  console.log("=== SIMULAÇÃO: LIMPEZA E REPLICAÇÃO ===");

  // 1. Semana Base: 31/08/2026 a 06/09/2026
  const slotsBase = await prisma.slot.findMany({
    where: { date: { gte: "2026-08-31", lte: "2026-09-06" } },
    orderBy: [{ date: "asc" }, { time: "asc" }]
  });
  console.log(`Turmas/Slots na semana base (31/08 a 06/09): ${slotsBase.length}`);

  const bksBase = await prisma.booking.findMany({
    where: {
      slotId: { in: slotsBase.map(s => s.id) },
      status: { not: "cancelada" }
    }
  });
  console.log(`Reservas ativas na semana base: ${bksBase.length}`);

  // Carrega clientes
  const allClients = await prisma.client.findMany();
  const clientMap = new Map(allClients.map(c => [c.name, c]));

  // Analisa quem na base é replicável
  const replicaveisBase = bksBase.filter(b => {
    const c = clientMap.get(b.clientName);
    if (!c) return false;
    if (b.paymentMethod === PGTO_EXTRA || b.paymentMethod === PGTO_REPOSICAO) return false;
    return podeReplicarMensalista(c);
  });

  const naoReplicaveisBase = bksBase.filter(b => {
    const c = clientMap.get(b.clientName);
    return !c || !podeReplicarMensalista(c) || b.paymentMethod === PGTO_EXTRA || b.paymentMethod === PGTO_REPOSICAO;
  });

  console.log(`- Mensalistas fixas replicáveis na base: ${replicaveisBase.length}`);
  console.log(`- Não-replicáveis na base (escala, reposição, avulsa): ${naoReplicaveisBase.length}`);
  console.log(`  Não-replicáveis:`, naoReplicaveisBase.map(b => `${b.clientName} (${b.date} ${b.time}, ${b.paymentMethod}, tipo: ${clientMap.get(b.clientName)?.mensalistaTipo})`));

  // 2. Alunas novas na semana seguinte (07/09 a 13/09)
  const bksSeguinte = await prisma.booking.findMany({
    where: { date: { gte: "2026-09-07", lte: "2026-09-13" }, status: { not: "cancelada" } },
    orderBy: [{ date: "asc" }, { time: "asc" }]
  });

  const alunasBaseSet = new Set(bksBase.map(b => b.clientName));
  const novasParaManter = new Map(); // clientName -> first booking

  for (const b of bksSeguinte) {
    if (!alunasBaseSet.has(b.clientName)) {
      if (!novasParaManter.has(b.clientName)) {
        novasParaManter.set(b.clientName, b);
      }
    }
  }

  console.log(`\nAlunas novas identificadas na próxima semana para manter como 1ª aula: ${novasParaManter.size}`);
  novasParaManter.forEach((b, name) => {
    console.log(`  * ${name}: ${b.date} ${b.time} (${b.unit}, slot: ${b.slotId})`);
  });

  // 3. Contagem de exclusão futura
  const totalFuturas = await prisma.booking.count({
    where: { date: { gte: "2026-09-07" } }
  });
  console.log(`\nTotal de reservas futuras a deletar (exceto as ${novasParaManter.size} mantidas): ${totalFuturas - novasParaManter.size}`);

  const totalSlotsFuturos = await prisma.slot.count({
    where: { date: { gte: "2026-09-07" } }
  });
  console.log(`Total de slots futuros existentes a ajustar/substituir: ${totalSlotsFuturos}`);
}

simular().finally(() => prisma.$disconnect());
