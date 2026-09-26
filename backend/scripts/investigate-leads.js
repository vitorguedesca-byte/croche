import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const clients = await prisma.client.findMany();
  const bookings = await prisma.booking.findMany();
  const invoices = await prisma.invoice.findMany();
  const waConvs = await prisma.waConversation.findMany();

  console.log('Total clients:', clients.length);
  console.log('Total bookings:', bookings.length);
  console.log('Total invoices:', invoices.length);
  console.log('Total waConversations:', waConvs.length);

  // Let's inspect clients whose status is lead or who have paid bookings or recent bookings
  console.log('\n--- Status counts ---');
  const statusCounts = {};
  for (const c of clients) {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  }
  console.log('Client status counts:', statusCounts);

  const matCounts = {};
  for (const c of clients) {
    matCounts[c.matriculaStatus] = (matCounts[c.matriculaStatus] || 0) + 1;
  }
  console.log('Client matriculaStatus counts:', matCounts);

  // Let's check recent bookings (last 30)
  const sortedBookings = [...bookings].sort((a, b) => b.id - a.id).slice(0, 30);
  console.log('\n--- Last 30 bookings ---');
  for (const b of sortedBookings) {
    console.log(`[#${b.id}] ${b.clientName} | Phone: ${b.phone} | Unit: ${b.unit} | Date: ${b.date} ${b.time} | Status: ${b.status} | Paid: ${b.paid} | Method: ${b.paymentMethod} | Txid: ${b.txid || 'none'} | HoldUntil: ${b.holdUntil}`);
  }

  // Let's check which clients would be classified as "lead" by classifyClient logic
  console.log('\n--- Checking client classifications ---');
  const now = Date.now();
  let leadCount = 0;
  for (const c of clients) {
    const bks = bookings.filter((b) => b.clientName === c.name);
    const activeBks = bks.filter((b) => b.status !== 'cancelada');
    const hasPaidBooking = bks.some((b) => b.paid || b.status === 'concluida' || (b.status === 'confirmada' && b.paymentMethod));
    const isMatriculada = c.matriculaStatus === 'paga' || c.matriculaStatus === 'convertida' || c.plan === 'mensalista';
    const hasActiveHold = activeBks.some((b) => b.status === 'aguardando' && b.holdUntil && new Date(b.holdUntil).getTime() > now);

    let classification = 'cliente';
    if (c.status === 'cancelado' || c.status === 'inativo') classification = 'ex-aluno';
    else if (c.status === 'lead') classification = 'lead';
    else if (!hasPaidBooking && !isMatriculada) {
      if (!hasActiveHold) classification = 'lead';
    }

    if (classification === 'lead') {
      leadCount++;
      console.log(`\nLEAD FOUND #${leadCount}: Client ID ${c.id}: ${c.name} (status: ${c.status}, matricula: ${c.matriculaStatus}, plan: ${c.plan}, phone: ${c.phone})`);
      console.log(`  Bookings (${bks.length}):`, bks.map(b => ({ id: b.id, status: b.status, paid: b.paid, method: b.paymentMethod, txid: b.txid, date: b.date, holdUntil: b.holdUntil })));
      const invs = invoices.filter(i => i.clientId === c.id);
      if (invs.length) console.log(`  Invoices (${invs.length}):`, invs.map(i => ({ id: i.id, status: i.status, paidAt: i.paidAt, txid: i.txid })));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
