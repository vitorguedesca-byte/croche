import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
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

async function executar() {
  console.log("=================================================================");
  console.log("   INICIANDO LIMPEZA E REPLICAÇÃO DA AGENDA (52 SEMANAS / 12 MESES)");
  console.log("=================================================================\n");

  const feriadosPorUnidade = await carregarFeriados();
  const ehFeriado = (date, unit) => feriadoDe(feriadosPorUnidade[unit] || {}, date);

  // 1. Identificar Semana Base (31/08/2026 a 06/09/2026)
  const slotsBase = await prisma.slot.findMany({
    where: { date: { gte: "2026-08-31", lte: "2026-09-06" } },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });
  console.log(`1. Semana Base (31/08 a 06/09): ${slotsBase.length} turmas encontradas.`);

  const bksBase = await prisma.booking.findMany({
    where: {
      slotId: { in: slotsBase.map((s) => s.id) },
      status: { not: "cancelada" },
    },
  });
  console.log(`   Total de reservas ativas na semana base: ${bksBase.length}`);

  // Carrega fichas das alunas
  const allClients = await prisma.client.findMany();
  const clientMap = new Map(allClients.map((c) => [c.name, c]));

  // Filtra apenas quem pode ser replicada (Mensalista FIXA ativa)
  const bksReplicaveisBase = bksBase.filter((b) => {
    const c = clientMap.get(b.clientName);
    if (!c) return false;
    if (b.paymentMethod === PGTO_EXTRA || b.paymentMethod === PGTO_REPOSICAO) return false;
    return podeReplicarMensalista(c);
  });
  console.log(`   Mensalistas FIXAS elegíveis para replicação: ${bksReplicaveisBase.length}`);

  // 2. Identificar alunas novas na próxima semana (07/09 a 13/09) para MANTER como primeira aula
  const bksSeguinte = await prisma.booking.findMany({
    where: { date: { gte: "2026-09-07", lte: "2026-09-13" }, status: { not: "cancelada" } },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });

  const alunasComAulaNaBase = new Set(bksBase.map((b) => b.clientName));
  const primeirasAulasParaManter = new Map(); // clientName -> booking

  for (const b of bksSeguinte) {
    if (!alunasComAulaNaBase.has(b.clientName)) {
      if (!primeirasAulasParaManter.has(b.clientName)) {
        primeirasAulasParaManter.set(b.clientName, b);
      }
    }
  }

  const idsParaManter = Array.from(primeirasAulasParaManter.values()).map((b) => b.id);
  const slotIdsParaManter = Array.from(primeirasAulasParaManter.values()).map((b) => b.slotId);

  console.log(`\n2. Alunas novas na próxima semana para MANTER APENAS COMO 1ª AULA: ${idsParaManter.length}`);
  primeirasAulasParaManter.forEach((b, name) => {
    console.log(`   ✓ Mantida 1ª aula: ${name} em ${b.date} às ${b.time} (${b.unit}, reserva #${b.id})`);
  });

  // 3. Limpeza das agendas para frente (date >= 2026-09-07)
  console.log("\n3. Executando limpeza das agendas futuras (>= 07/09/2026)...");

  const delBks = await prisma.booking.deleteMany({
    where: {
      date: { gte: "2026-09-07" },
      id: { notIn: idsParaManter },
    },
  });
  console.log(`   ✓ ${delBks.count} reservas futuras deletadas.`);

  const delSlots = await prisma.slot.deleteMany({
    where: {
      date: { gte: "2026-09-07" },
      id: { notIn: slotIdsParaManter },
    },
  });
  console.log(`   ✓ ${delSlots.count} slots futuros vagos deletados.`);

  // 4. Replicação da semana base para 52 semanas (12 meses)
  console.log(`\n4. Replicando grade da semana base por ${SEMANAS_PADRAO} semanas...`);

  // Assegura seriesId em todos os slots base
  for (const s of slotsBase) {
    if (!s.seriesId) {
      const sid = crypto.randomUUID();
      await prisma.slot.update({ where: { id: s.id }, data: { seriesId: sid } });
      s.seriesId = sid;
    }
  }

  let totalSlotsCriados = 0;
  let totalAulasCriadas = 0;
  let totalFeriadosPulados = 0;
  let totalPulosLotados = 0;

  for (let n = 1; n <= SEMANAS_PADRAO; n++) {
    for (const base of slotsBase) {
      const date = addDays(base.date, n * 7);
      const feriado = ehFeriado(date, base.unit);

      if (feriado) {
        totalFeriadosPulados++;
        continue;
      }

      // Procura se já existe slot naquele dia/hora/unidade (ex: preservado para as alunas novas)
      let alvo = await prisma.slot.findFirst({
        where: { date, time: hhmm(base.time), unit: base.unit },
      });

      if (!alvo) {
        alvo = await prisma.slot.create({
          data: {
            date,
            time: hhmm(base.time),
            unit: base.unit,
            prof: base.prof || "Equipe FQC",
            capacity: base.capacity || 16,
            seriesId: base.seriesId,
          },
        });
        totalSlotsCriados++;
      } else {
        if (!alvo.seriesId) {
          await prisma.slot.update({ where: { id: alvo.id }, data: { seriesId: base.seriesId } });
        }
      }

      // Replicar as reservas ativas da turma base
      const reservasDaTurma = bksReplicaveisBase.filter((b) => b.slotId === base.id);
      let ocupacaoAtual = await prisma.booking.count({
        where: { slotId: alvo.id, status: { not: "cancelada" } },
      });

      const novasParaInserir = [];

      for (const b of reservasDaTurma) {
        // Checa se a aluna já está agendada nesta data
        const jaExiste = await prisma.booking.findFirst({
          where: { clientName: b.clientName, date, status: { not: "cancelada" } },
        });

        if (jaExiste) continue;

        if (ocupacaoAtual + novasParaInserir.length >= alvo.capacity) {
          totalPulosLotados++;
          continue;
        }

        novasParaInserir.push({
          clientName: b.clientName,
          phone: b.phone || "",
          unit: alvo.unit,
          date: alvo.date,
          time: alvo.time,
          prof: alvo.prof || "Equipe FQC",
          slotId: alvo.id,
          seriesId: b.seriesId || base.seriesId || crypto.randomUUID(),
          status: "confirmada",
          value: 0,
          paid: false,
          paymentMethod: PGTO_PLANO,
        });
      }

      if (novasParaInserir.length > 0) {
        await prisma.booking.createMany({ data: novasParaInserir });
        totalAulasCriadas += novasParaInserir.length;
      }
    }
  }

  console.log("\n=================================================================");
  console.log("   REPLICAÇÃO CONCLUÍDA COM SUCESSO!");
  console.log("=================================================================");
  console.log(`- Novos horários/turmas criados: ${totalSlotsCriados}`);
  console.log(`- Novas aulas geradas para mensalistas fixas: ${totalAulasCriadas}`);
  console.log(`- Ocorrências de feriados puladas: ${totalFeriadosPulados}`);
  console.log(`- Primeiras aulas de alunas novas preservadas na próxima semana: ${idsParaManter.length}`);
  console.log("=================================================================\n");
}

executar().finally(() => prisma.$disconnect());
