import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Helper replicating frontend logic exactly
function bookingsActive(bookings) {
  return bookings.filter(b => b.status !== 'cancelada');
}

function classifyClient(data, c) {
  if (c.status === "cancelado" || c.status === "inativo") return "ex-aluno";

  const clientDigits = (c.phone || "").replace(/\D/g, "");
  const bks = (data.bookings || []).filter((b) => {
    if (b.clientName === c.name) return true;
    if (clientDigits && b.phone) {
      const bDigits = b.phone.replace(/\D/g, "");
      return bDigits && clientDigits.endsWith(bDigits.slice(-8));
    }
    return false;
  });
  const activeBks = bks.filter((b) => b.status !== "cancelada");
  const hasMultipleBookings = activeBks.length > 1;
  const hasAttendance = bks.some((b) => b.attendance === "presente");
  const hasPaidBooking = bks.some((b) => b.paid || b.status === "concluida" || (b.status === "confirmada" && b.paymentMethod));
  const isMatriculada = c.matriculaStatus === "paga" || c.matriculaStatus === "convertida" || c.plan === "mensalista";

  if (hasPaidBooking || isMatriculada) {
    return c.firstClass ? "novato" : "cliente";
  }

  if (c.status === "lead") return "lead";

  const hasActiveHold = activeBks.some((b) => b.status === "aguardando" && b.holdUntil && new Date(b.holdUntil).getTime() > Date.now());
  if (!hasActiveHold) return "lead";

  return c.firstClass ? "novato" : "cliente";
}

async function main() {
  const [clients, bookings, invoices] = await Promise.all([
    prisma.client.findMany(),
    prisma.booking.findMany(),
    prisma.invoice.findMany(),
  ]);

  const data = { clients, bookings, invoices };

  const groups = { cliente: [], novato: [], lead: [], "ex-aluno": [] };
  clients.forEach((c) => {
    const k = classifyClient(data, c);
    (groups[k] || groups.cliente).push(c);
  });

  console.log('--- Counts in Clientes Tabs / Dashboard ---');
  console.log('cliente (Alunos):', groups.cliente.length);
  console.log('novato (1ª Aula Pagas):', groups.novato.length);
  console.log('lead (Leads):', groups.lead.length);
  console.log('ex-aluno (Ex-Alunos):', groups['ex-aluno'].length);

  const waConvs = await prisma.waConversation.findMany();
  console.log('Total waConversations:', waConvs.length);
  const waMatch = waConvs.filter(w => JSON.stringify(w).toLowerCase().includes('thiago') || JSON.stringify(w).toLowerCase().includes('tiago'));
  console.log('WA matches:', waMatch);

  const allBookings = await prisma.booking.findMany();
  const bksMatch = allBookings.filter(b => b.clientName.toLowerCase().includes('thiago') || b.clientName.toLowerCase().includes('tiago'));
  console.log('Bookings matching thiago/tiago:', bksMatch.map(b => ({ id: b.id, clientName: b.clientName, phone: b.phone, date: b.date, status: b.status })));

  // backup checked previously


  console.log('\n--- 10 Most Recently Created Clients ---');
  const sortedClients = [...clients].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
  console.log(sortedClients.map(c => ({ id: c.id, name: c.name, status: c.status, plan: c.plan, createdAt: c.createdAt })));


  const thiago = clients.find(c => c.name.toLowerCase().includes('thiago'));
  const thiagoInvoices = invoices.filter(i => i.clientId === thiago?.id);
  console.log('Thiago invoices in DB:', thiagoInvoices);

  // Check if there are other clients with 'cancelado' status
  const cancelados = clients.filter(c => c.status === 'cancelado');
  console.log('\nTotal clients with status=cancelado:', cancelados.length);
  console.log('Cancelados names:', cancelados.map(c => ({ id: c.id, name: c.name })));

  // Check Financeiro mensalistas
  const comp = '2026-09';
  const mensalistas = clients
    .filter((c) => c.plan === "mensalista")
    .filter((c) => c.status !== "cancelado" || (invoices || []).some((i) => i.clientId === c.id && i.competencia === comp))
    .sort((a, b) => a.name.localeCompare(b.name));
  console.log('\nFinanceiro mensalistas for 2026-09:', mensalistas.length);
  console.log('Is Thiago in mensalistas?', mensalistas.some(c => c.id === thiago?.id));

  // Check Financeiro for 2026-10
  const comp10 = '2026-10';
  const mensalistas10 = clients
    .filter((c) => c.plan === "mensalista")
    .filter((c) => c.status !== "cancelado" || (invoices || []).some((i) => i.clientId === c.id && i.competencia === comp10))
    .sort((a, b) => a.name.localeCompare(b.name));
  console.log('Financeiro mensalistas for 2026-10:', mensalistas10.length);
  console.log('Is Thiago in mensalistas 2026-10?', mensalistas10.some(c => c.id === thiago?.id));

  // What about Turmas da unidade de Thiago (Ipatinga)?
  // What slots was Thiago in on Mondays 09:00?
  const slotsIpatingaSegunda = await prisma.slot.findMany({
    where: {
      unit: 'Ipatinga',
      time: '09:00',
      date: { gte: '2026-09-21', lte: '2026-10-31' }
    },
    include: {
      waitlist: true
    },
    orderBy: { date: 'asc' }
  });

  console.log('\nSlots Ipatinga 09:00 (next weeks):');
  for (const s of slotsIpatingaSegunda) {
    const slotBks = bookings.filter(b => b.slotId === s.id && b.status !== 'cancelada');
    console.log(`Slot ${s.date} ${s.time} (id ${s.id}): capacity=${s.capacity}, occupied=${slotBks.length}`);
    console.log('   Enrolled:', slotBks.map(b => b.clientName));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
