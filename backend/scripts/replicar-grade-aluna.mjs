import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const addMonths = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

const hhmm = (v) => {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return s;
};

async function replicarGrade(nomeOuId) {
  const client = await prisma.client.findFirst({
    where: typeof nomeOuId === "number" ? { id: nomeOuId } : { name: { contains: nomeOuId } }
  });
  if (!client) {
    console.error("Aluna não encontrada:", nomeOuId);
    return;
  }
  console.log(`\nReplicando grade para: ${client.name} (ID: ${client.id}, Unidade: ${client.unit}, Plano: ${client.weeklyFreq}x/semana)`);

  const baseBooking = await prisma.booking.findFirst({
    where: { clientName: client.name, status: { not: "cancelada" } },
    orderBy: { date: "asc" },
  });
  if (!baseBooking) {
    console.error("Nenhuma aula base encontrada para a aluna.");
    return;
  }

  const baseSlot = await prisma.slot.findUnique({ where: { id: baseBooking.slotId } });
  if (!baseSlot) {
    console.error("Horário base não encontrado no banco:", baseBooking.slotId);
    return;
  }

  let slotSeriesId = baseSlot.seriesId;
  if (!slotSeriesId) {
    slotSeriesId = crypto.randomUUID();
    await prisma.slot.update({ where: { id: baseSlot.id }, data: { seriesId: slotSeriesId } });
  }

  const bookingSeriesId = baseBooking.seriesId || crypto.randomUUID();
  if (!baseBooking.seriesId) {
    await prisma.booking.update({ where: { id: baseBooking.id }, data: { seriesId: bookingSeriesId } });
  }

  const fim = addMonths(baseSlot.date, 12);
  const criadas = [];
  const puladas = [];

  for (let date = baseSlot.date; date < fim; date = addDays(date, 7)) {
    const slotsDoDia = await prisma.slot.findMany({ where: { date, unit: baseSlot.unit } });
    let alvo = slotsDoDia.find((s) => hhmm(s.time) === hhmm(baseSlot.time));

    if (!alvo) {
      alvo = await prisma.slot.create({
        data: {
          date,
          time: hhmm(baseSlot.time),
          unit: baseSlot.unit,
          prof: baseSlot.prof || "Equipe FQC",
          capacity: baseSlot.capacity || 16,
          seriesId: slotSeriesId,
        },
      });
    }

    const jaTem = await prisma.booking.findFirst({
      where: { clientName: client.name, date, status: { not: "cancelada" } },
    });

    if (jaTem) {
      puladas.push({ date, motivo: "já possui aula ativa" });
      continue;
    }

    const nova = await prisma.booking.create({
      data: {
        clientName: client.name,
        phone: client.phone || "",
        unit: alvo.unit,
        date: alvo.date,
        time: alvo.time,
        prof: alvo.prof || "Equipe FQC",
        slotId: alvo.id,
        seriesId: bookingSeriesId,
        status: "confirmada",
        value: 0,
        paid: false,
        paymentMethod: "Mensalista",
      },
    });
    criadas.push(nova);
  }

  console.log(`\nSucesso! Grade de 12 meses gerada:`);
  console.log(`- ${criadas.length} aulas criadas.`);
  console.log(`- ${puladas.length} datas já agendadas (incluindo a primeira aula).`);
  console.log(`- Período: ${baseSlot.date} até ${fim}.`);
}

const target = process.argv[2] || "Maria Aparecida Ferreira dos Santos";
replicarGrade(target).finally(() => prisma.$disconnect());
