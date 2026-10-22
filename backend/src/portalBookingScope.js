// Booking legado não possui clientId. No portal, nome sozinho nunca é prova
// de titularidade: use nome e telefone, recusando pares ambíguos.
const SCOPE = Symbol("portalBookingScope");
const phoneKey = value => {
  let valueDigits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (valueDigits.startsWith("55") && valueDigits.length > 11) valueDigits = valueDigits.slice(2);
  return /^\d{10,11}$/.test(valueDigits) ? valueDigits : "";
};

export async function bindPortalBookingScope(prisma, client) {
  const phone = phoneKey(client.phone);
  if (!phone) throw Object.assign(new Error("Peça à escola para conferir o telefone do seu cadastro antes de acessar o portal."), { status: 403 });
  const peers = await prisma.client.findMany({ where: { name: client.name }, select: { id: true, phone: true } });
  if (peers.some(other => other.id !== client.id && phoneKey(other.phone) === phone)) {
    throw Object.assign(new Error("Há cadastros com o mesmo nome e telefone. Peça à escola para conferir seu cadastro."), { status: 403 });
  }
  const bookings = await prisma.booking.findMany({ where: { clientName: client.name }, select: { phone: true } });
  const phones = [...new Set([client.phone, ...bookings.filter(b => phoneKey(b.phone) === phone).map(b => b.phone)])];
  client[SCOPE] = { clientName: client.name, phone: { in: phones } };
}

// Chamadores administrativos mantêm seu comportamento. A identidade que veio
// de uma sessão do portal carrega obrigatoriamente o filtro adicional.
export const bookingWhere = client => typeof client === "string" ? { clientName: client } : client[SCOPE] || { clientName: client.name };
export const ownsPortalBooking = (client, booking) => !!booking && !!client[SCOPE] &&
  booking.clientName === client.name && client[SCOPE].phone.in.includes(booking.phone);
