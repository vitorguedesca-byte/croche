import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { PGTO_PLANO } from "./src/regrasAula.js";
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

async function carregarFeriados() {
  const [manuais, aberturas] = await Promise.all([
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    prisma.holidayOverride.findMany({ where: { hasClasses: true }, orderBy: { date: "asc" } }),
  ]);
  const anos = anosDoCalendario("2026-09-01");
  const unidades = ["Timóteo", "Ipatinga"];
  const feriadosPorUnidade = {};
  for (const unidade of unidades) {
    const cal = calendarioFeriados(anos, manuais, unidade);
    for (const a of aberturas) if (a.unit === unidade) delete cal[a.date];
    feriadosPorUnidade[unidade] = cal;
  }
  return feriadosPorUnidade;
}

const ALUNAS_LISTA = [
  { name: "Marinete Almeida Neto", date: "2026-09-07", time: "09:00", unit: "Ipatinga" },
  { name: "Creusa Maria Oliveira Gonçalves Silva", date: "2026-09-07", time: "18:00", unit: "Timóteo" },
  { name: "Marcia Xavier Januario", date: "2026-09-07", time: "18:00", unit: "Timóteo" },
  { name: "Georgia Rocha do Nascimento", date: "2026-09-08", time: "13:00", unit: "Ipatinga" },
  { name: "Ana Maria de Mello Morais", date: "2026-09-08", time: "13:00", unit: "Timóteo" },
  { name: "Claudia Cristina Alves", date: "2026-09-08", time: "15:00", unit: "Ipatinga" },
  { name: "Priscilla Angelis de Almeida", date: "2026-09-08", time: "15:00", unit: "Ipatinga" },
  { name: "Montserrat Santibanez Paula Silva Cunha", date: "2026-09-09", time: "18:00", unit: "Timóteo" },
  { name: "Maria das Graças Pessoa (Pitya)", date: "2026-09-09", time: "18:00", unit: "Timóteo" },
  { name: "Larissa Julia Silva Laurentino", date: "2026-09-09", time: "18:00", unit: "Timóteo" },
  { name: "Letícia Silveira Damascos", date: "2026-09-09", time: "18:00", unit: "Timóteo" },
  { name: "Kathryn C Reis", date: "2026-09-10", time: "16:00", unit: "Timóteo" },
  { name: "Dara Lice Chagas Quintanilha Carvalhais", date: "2026-09-10", time: "18:00", unit: "Ipatinga" },
  { name: "Claudineia Alvez Miranda Monteiro", date: "2026-09-12", time: "09:00", unit: "Timóteo" },
];

async function executar() {
  console.log("=================================================================");
  console.log("   REPLICAÇÃO DAS 14 ALUNAS NOVAS PARA 52 SEMANAS (12 MESES)");
  console.log("=================================================================\n");

  const feriadosPorUnidade = await carregarFeriados();
  const ehFeriado = (date, unit) => feriadoDe(feriadosPorUnidade[unit] || {}, date);

  let totalAulasCriadasGeral = 0;
  let totalFeriadosPuladosGeral = 0;

  for (const item of ALUNAS_LISTA) {
    // Acha a aluna no banco
    const client = await prisma.client.findFirst({ where: { name: item.name } });
    if (!client) {
      console.warn(`[AVISO] Cliente não encontrado: ${item.name}`);
      continue;
    }

    // Acha a reserva base da semana seguinte
    const baseBooking = await prisma.booking.findFirst({
      where: {
        clientName: item.name,
        date: item.date,
        time: item.time,
        unit: item.unit,
        status: { not: "cancelada" },
      },
    });

    if (!baseBooking) {
      console.warn(`[AVISO] Reserva base não encontrada para ${item.name} em ${item.date} ${item.time}`);
      continue;
    }

    // Garante que a reserva base tem seriesId
    let seriesId = baseBooking.seriesId;
    if (!seriesId) {
      seriesId = crypto.randomUUID();
      await prisma.booking.update({ where: { id: baseBooking.id }, data: { seriesId } });
    }

    let aulasCriadasAluna = 0;
    let feriadosPuladosAluna = 0;

    for (let w = 1; w <= 51; w++) {
      const date = addDays(item.date, w * 7);
      const feriado = ehFeriado(date, item.unit);

      if (feriado) {
        feriadosPuladosAluna++;
        continue;
      }

      // Procura ou cria slot no dia/hora/unidade
      let slot = await prisma.slot.findFirst({
        where: { date, time: hhmm(item.time), unit: item.unit },
      });

      if (!slot) {
        slot = await prisma.slot.create({
          data: {
            date,
            time: hhmm(item.time),
            unit: item.unit,
            prof: baseBooking.prof || "Equipe FQC",
            capacity: 16,
            seriesId,
          },
        });
      }

      // Checa se aluna já tem reserva ativa nesta data
      const jaExiste = await prisma.booking.findFirst({
        where: { clientName: item.name, date, status: { not: "cancelada" } },
      });

      if (jaExiste) continue;

      // Checa capacidade
      const ocupacao = await prisma.booking.count({
        where: { slotId: slot.id, status: { not: "cancelada" } },
      });

      if (ocupacao >= slot.capacity) {
        console.warn(`[LOTADA] Turma ${date} ${item.time} (${item.unit}) cheia (${ocupacao}/${slot.capacity}). Pulando ${item.name}.`);
        continue;
      }

      await prisma.booking.create({
        data: {
          clientName: item.name,
          phone: client.phone || baseBooking.phone || "",
          unit: slot.unit,
          date: slot.date,
          time: slot.time,
          prof: slot.prof || baseBooking.prof || "Equipe FQC",
          slotId: slot.id,
          seriesId,
          status: "confirmada",
          value: 0,
          paid: false,
          paymentMethod: PGTO_PLANO,
        },
      });

      aulasCriadasAluna++;
    }

    console.log(`✓ ${item.name}: +${aulasCriadasAluna} aulas replicadas (${feriadosPuladosAluna} feriados pulados)`);
    totalAulasCriadasGeral += aulasCriadasAluna;
    totalFeriadosPuladosGeral += feriadosPuladosAluna;
  }

  console.log("\n=================================================================");
  console.log("   REPLICAÇÃO DAS ALUNAS NOVAS FINALIZADA!");
  console.log("=================================================================");
  console.log(`- Total de novas aulas criadas: ${totalAulasCriadasGeral}`);
  console.log(`- Total de feriados pulados: ${totalFeriadosPuladosGeral}`);
  console.log("=================================================================\n");
}

executar().finally(() => prisma.$disconnect());
