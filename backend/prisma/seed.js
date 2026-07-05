import { prisma, UNITS, VALOR_PADRAO, CAPACITY_PADRAO, profFor } from "../src/prismaClient.js";

const todayISO = () => new Date().toISOString().slice(0, 10);
function addDays(iso, n) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("Limpando dados antigos...");
  await prisma.waitlist.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.client.deleteMany();

  const t = todayISO();

  // ---- horários dos próximos 14 dias (seg a sáb) ----
  const slotData = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(t, i);
    const dow = new Date(date + "T00:00").getDay(); // 0 = domingo
    if (dow === 0) continue;
    const times = dow === 6 ? ["09:00"] : ["09:00", "14:00", "16:00"];
    for (const unit of UNITS) {
      for (const time of times) {
        slotData.push({ date, time, unit, prof: profFor(unit), capacity: CAPACITY_PADRAO });
      }
    }
  }
  await prisma.slot.createMany({ data: slotData });
  const slots = await prisma.slot.findMany({ orderBy: [{ date: "asc" }, { time: "asc" }] });
  console.log(`${slots.length} horários criados.`);

  // ---- clientes ----
  const clientsData = [
    { name: "Maria Souza", phone: "31988880001", unit: "Ipatinga", tags: ["Aluna ativa", "Em atendimento"], notes: "Adora amigurumi. Já comprou 2 kits." },
    { name: "Ana Clara", phone: "31988880002", unit: "Timóteo", tags: ["Em marcação", "Lead"], notes: "Iniciante, perguntou sobre horário de sábado." },
    { name: "Rosa Lima", phone: "31988880003", unit: "Ipatinga", tags: ["Aluna ativa", "Confirmada"], notes: "" },
    { name: "Juliana Reis", phone: "31988880004", unit: "Timóteo", tags: ["Em atendimento"], notes: "Quer turma de crochê que vira renda." },
  ];
  const clients = [];
  for (const c of clientsData) {
    clients.push(await prisma.client.create({ data: { ...c, tags: JSON.stringify(c.tags) } }));
  }
  console.log(`${clients.length} clientes criados.`);

  // ---- marcações ----
  const ipaSlots = slots.filter((s) => s.unit === "Ipatinga" && s.date >= t).slice(0, 2);
  const timSlots = slots.filter((s) => s.unit === "Timóteo" && s.date > t).slice(0, 2);

  const mk = async (cli, slot, status, paid) => {
    if (!slot) return;
    await prisma.booking.create({
      data: {
        clientName: cli.name, phone: cli.phone, unit: slot.unit, date: slot.date, time: slot.time,
        prof: slot.prof, slotId: slot.id, status, value: VALOR_PADRAO, paid: !!paid,
        paymentMethod: paid ? "Pix" : "", paymentDate: paid ? t : "",
      },
    });
  };
  await mk(clients[0], ipaSlots[0], "confirmada", true);
  await mk(clients[2], ipaSlots[0], "aguardando", false); // mesma turma
  await mk(clients[2], ipaSlots[1], "confirmada", true);
  await mk(clients[1], timSlots[0], "aguardando", false);
  await mk(clients[3], timSlots[1], "aguardando", false);

  // turma cheia (2/2) com uma pessoa na lista de espera
  if (ipaSlots[0]) {
    await prisma.slot.update({ where: { id: ipaSlots[0].id }, data: { capacity: 2 } });
    await prisma.waitlist.create({ data: { slotId: ipaSlots[0].id, name: "Beatriz Alves", phone: "31988880005" } });
  }

  // aula passada concluída, com presença marcada
  const pastSlot = await prisma.slot.create({
    data: { date: addDays(t, -4), time: "09:00", unit: "Ipatinga", prof: "Inêz", capacity: CAPACITY_PADRAO },
  });
  await prisma.booking.create({
    data: {
      clientName: clients[0].name, phone: clients[0].phone, unit: "Ipatinga", date: pastSlot.date, time: "09:00",
      prof: "Inêz", slotId: pastSlot.id, status: "concluida", attendance: "presente", value: VALOR_PADRAO,
      paid: true, paymentMethod: "Pix", paymentDate: addDays(t, -4),
    },
  });

  console.log("Seed concluído com sucesso. ✅");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
