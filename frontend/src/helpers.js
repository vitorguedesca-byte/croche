export const UNITS = ["Ipatinga", "Timóteo"];
export const PROFS = ["Inêz", "Equipe FQC"];
export const VALOR_PADRAO = 80;
export const CAPACITY_PADRAO = 4;
export const TAG_OPTIONS = ["Em atendimento", "Em marcação", "Aluna ativa", "Confirmada", "Lead", "Inadimplente", "Lista de espera"];

export const STATUS = {
  aguardando: { label: "Aguardando pagamento", badge: "b-warn", dot: "var(--warn)" },
  confirmada: { label: "Confirmada", badge: "b-ok", dot: "var(--ok)" },
  concluida: { label: "Concluída", badge: "b-info", dot: "var(--info)" },
  cancelada: { label: "Cancelada", badge: "b-danger", dot: "var(--danger)" },
};

export const UNIT_META = {
  Ipatinga: { color: "#B85C36", soft: "rgba(184,92,54,.20)" },
  "Timóteo": { color: "#3E6FA0", soft: "rgba(62,111,160,.20)" },
};
// paleta para unidades novas (cadastradas nas Configurações)
const PALETTE = ["#B85C36", "#3E6FA0", "#6E7C5A", "#9C6B2E", "#7A5C8A", "#3F8A7E"];
let UNIT_ORDER = [...UNITS];
export function setUnitOrder(list) { if (Array.isArray(list) && list.length) UNIT_ORDER = list; }
export function unitColor(u) {
  if (UNIT_META[u]) return UNIT_META[u].color;
  const i = UNIT_ORDER.indexOf(u);
  return i >= 0 ? PALETTE[i % PALETTE.length] : "var(--muted)";
}
export function unitSoft(u) {
  if (UNIT_META[u]) return UNIT_META[u].soft;
  const c = unitColor(u);
  return c.startsWith("#") ? c + "30" : "rgba(0,0,0,.05)";
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekStart(iso) {
  const d = new Date(iso + "T00:00");
  const dow = (d.getDay() + 6) % 7;
  return addDays(iso, -dow);
}
export const fmtDate = (iso) => new Date(iso + "T00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
export const fmtDateLong = (iso) => new Date(iso + "T00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "long" });
export const weekdayShort = (iso) => new Date(iso + "T00:00").toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
export const money = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function waLink(phone, msg) {
  const p = (phone || "").replace(/\D/g, "");
  return "https://wa.me/55" + p + "?text=" + encodeURIComponent(msg || "");
}
export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ---- derivados do estado (data = {clients, slots, bookings}) ---- */
export const bookingsActive = (data) => data.bookings.filter((b) => b.status !== "cancelada");
export const slotById = (data, id) => data.slots.find((s) => s.id === id);
export const slotBookings = (data, slotId) =>
  data.bookings
    .filter((b) => b.slotId === slotId && b.status !== "cancelada")
    .sort((a, b) => a.time.localeCompare(b.time));
export const slotCapacity = (s) => (s ? s.capacity || 1 : 1);
export const slotOccupancy = (data, slotId) => slotBookings(data, slotId).length;
export const slotIsFull = (data, s) => slotOccupancy(data, s.id) >= slotCapacity(s);
export const slotWaitlist = (s) => (s && s.waitlist) || [];
export function clientAttendance(data, name) {
  const done = bookingsActive(data).filter((b) => b.clientName === name);
  return {
    pres: done.filter((b) => b.attendance === "presente").length,
    falt: done.filter((b) => b.attendance === "falta").length,
  };
}

/* ---- classificação de pessoas: cliente | lead | novato ---- */
// nº de marcações ativas (não canceladas) de uma pessoa
export const clientActiveCount = (data, c) =>
  bookingsActive(data).filter((b) => b.clientName === c.name).length;

// Novato: primeira aula (firstClass). Lead: veio do portal (etiqueta "Lead") e não prosseguiu (sem marcação ativa).
// Cliente: cadastro manual ou qualquer pessoa com marcação ativa. Cadastrar "Novo cliente" sempre resulta em Cliente.
export function classifyClient(data, c) {
  if (c.firstClass) return "novato";
  if (clientActiveCount(data, c) > 0) return "cliente";
  return (c.tags || []).includes("Lead") ? "lead" : "cliente";
}

// Marcação "nova": pessoa ainda sem acesso (sem PIN) ou na primeira aula
export function isNewLead(data, booking) {
  const phone = (booking.phone || "").replace(/\D/g, "");
  const client = phone
    ? data.clients.find((c) => (c.phone || "").replace(/\D/g, "").endsWith(phone.slice(-8)))
    : null;
  if (client && client.firstClass) return true;
  return !client || !client.hasPin;
}
