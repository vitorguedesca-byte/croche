import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const clients = await prisma.client.findMany({
    where: {
      name: { contains: 'THIAGO' }
    },
    include: {
      invoices: true
    }
  });
  console.log('Found clients:', JSON.stringify(clients, null, 2));

  const allClients = await prisma.client.findMany();
  console.log('Total clients:', allClients.length);
  const matchClients = allClients.filter(c => 
    c.name.toLowerCase().includes('tiago') || 
    (c.email && c.email.toLowerCase().includes('tiago')) ||
    (c.notes && c.notes.toLowerCase().includes('tiago'))
  );
  console.log('Match clients (tiago):', matchClients);

  const bookings = await prisma.booking.findMany({
    where: {
      clientName: { contains: 'iago' }
    }
  });
  console.log('Match bookings (iago):', bookings);

  // Check recent clients created or updated
  const recentClients = [...allClients].sort((a, b) => b.id - a.id).slice(0, 10);
  console.log('Last 10 clients:', recentClients.map(c => ({ id: c.id, name: c.name, status: c.status, plan: c.plan })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
