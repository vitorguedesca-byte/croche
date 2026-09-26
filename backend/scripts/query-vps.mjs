import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const clients = await prisma.client.findMany({
    where: {
      name: { contains: 'hiago' }
    }
  });
  console.log('=== Clients matching "hiago" ===');
  console.log(JSON.stringify(clients, null, 2));

  const allClients = await prisma.client.findMany({
    select: { id: true, name: true, status: true, plan: true, unit: true, mensalistaTipo: true }
  });
  console.log('=== Total clients in DB ===', allClients.length);
  const statusCounts = {};
  for (const c of allClients) {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  }
  console.log('Status counts:', statusCounts);

  const bookings = await prisma.booking.findMany({
    where: {
      clientName: { contains: 'hiago' }
    }
  });
  console.log('=== Bookings matching "hiago" ===');
  console.log(JSON.stringify(bookings, null, 2));

  const fs = await import('fs');
  try {
    const content = fs.readFileSync('/app/data/undo-history.json', 'utf8');
    const data = JSON.parse(content);
    console.log('Undo actions count:', (data.actions || []).length);
    const thiagoActions = (data.actions || []).filter(a => JSON.stringify(a).includes('Thiago'));
    console.log('Thiago actions:', JSON.stringify(thiagoActions, null, 2));
    if (data.clientBackups) {
      console.log('Client backup 142:', JSON.stringify(data.clientBackups['142'] || data.clientBackups[142], null, 2));
    }
  } catch (err) {
    console.log('Error reading undo-history:', err.message);
  }

  // Also check docker logs or server logs for [encerramento]
}

main().catch(console.error).finally(() => prisma.$disconnect());
