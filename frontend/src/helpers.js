export const UNITS = ["Ipatinga", "Timóteo"];
export const PROFS = ["Equipe FQC"];
export const VALOR_PADRAO = 80;
export const CAPACITY_PADRAO = 4;
// Etiquetas de aluno: nenhuma no momento. A única que existia ("Lead") saiu do
// sistema em 22/08/2026. O campo continua no banco para não perder histórico.
export const TAG_OPTIONS = [];

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

// "hoje" pelo relógio de Brasília, não pelo UTC: com toISOString, das 21h à
// meia-noite o sistema já achava que era o dia seguinte e a aula da noite
// sumia das "próximas aulas". ('sv-SE' formata como YYYY-MM-DD.)
export const todayISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
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
// Extrai só o "HH:MM" de uma string de hora, mesmo que venha suja
// (ex.: "09:00 as 11:00" digitado à mão vira "09:00"). Evita cálculos com NaN.
export const hhmm = (t) => {
  const m = String(t || "").match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};
// Fim da aula a partir do início + duração em minutos (padrão: 2h)
export function fimDaAula(time, dur = 120) {
  const ini = hhmm(time);
  if (!ini) return "";
  const [h, m] = ini.split(":").map(Number);
  const t = h * 60 + m + (Number(dur) || 120);
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
// "09:00 às 11:00" — usado na agenda, no portal e nas confirmações
export const faixaHorario = (time, dur) => {
  const ini = hhmm(time);
  return ini ? `${ini} às ${fimDaAula(ini, dur)}` : "";
};
export function waLink(phone, msg) {
  const p = (phone || "").replace(/\D/g, "");
  return "https://wa.me/55" + p + "?text=" + encodeURIComponent(msg || "");
}
export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ---- dias da semana / horário de funcionamento ---- */
// Segunda = 0 … Domingo = 6 (mesma ordem usada na agenda)
export const WEEKDAYS_PT = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export const WEEKDAYS_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export const dowMon = (iso) => (new Date(iso + "T00:00").getDay() + 6) % 7;

// horário de funcionamento: 7 posições (Seg..Dom), cada uma { open, from, to }
export const DEFAULT_HORARIO = WEEKDAYS_PT.map((_, i) => ({ open: i < 6, from: "09:00", to: "17:00" }));
// Formato compacto guardado no banco: array de 7 posições (Seg..Dom),
// cada uma "HH:MM-HH:MM" (aberto) ou 0 (fechado). Ex.: ["09:00-17:00",...,0]
export const serializeHorario = (days) =>
  JSON.stringify(days.map((d) => (d.open ? `${d.from}-${d.to}` : 0)));
export function parseHorario(raw) {
  if (Array.isArray(raw)) return { legacy: "", days: normalizeHorario(raw) };
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { return { legacy: "", days: normalizeHorario(JSON.parse(raw)) }; } catch { /* legado */ }
  }
  return { legacy: typeof raw === "string" ? raw : "", days: DEFAULT_HORARIO.map((d) => ({ ...d })) };
}
function normalizeHorario(arr) {
  return DEFAULT_HORARIO.map((def, i) => {
    const d = arr[i];
    if (typeof d === "string" && d.includes("-")) { const [from, to] = d.split("-"); return { open: true, from: from || "09:00", to: to || "17:00" }; }
    if (d && typeof d === "object") return { open: d.open !== false, from: d.from || "09:00", to: d.to || "17:00" };
    if (d === 0 || d === false || d == null) return { open: false, from: def.from, to: def.to };
    return { ...def };
  });
}
// texto amigável agrupando dias seguidos com o mesmo horário (ex.: "Seg a Sex 09:00–17:00")
export function horarioToText(days) {
  const parts = [];
  let i = 0;
  while (i < 7) {
    if (!days[i].open) { i++; continue; }
    let j = i;
    while (j + 1 < 7 && days[j + 1].open && days[j + 1].from === days[i].from && days[j + 1].to === days[i].to) j++;
    const range = i === j ? WEEKDAYS_SHORT[i] : `${WEEKDAYS_SHORT[i]} a ${WEEKDAYS_SHORT[j]}`;
    parts.push(`${range} ${days[i].from}–${days[i].to}`);
    i = j + 1;
  }
  return parts.join(" · ") || "Fechado";
}

/* ---- cálculo de datas para criação/replicação de horários ---- */
// repetição semanal: próximas `count` semanas a partir de startISO (inclui a data base)
export const datesWeekly = (startISO, count) =>
  Array.from({ length: Math.max(1, count) }, (_, i) => addDays(startISO, i * 7));
// repetição diária: `count` dias seguidos a partir de startISO (inclui a data base)
export const datesDaily = (startISO, count) =>
  Array.from({ length: Math.max(1, count) }, (_, i) => addDays(startISO, i));
// dias específicos da semana por `weeks` semanas; `weekdays` = conjunto de índices Seg..Dom
export function datesForWeekdays(startISO, weekdays, weeks) {
  const ws = weekStart(startISO);
  const out = [];
  for (let w = 0; w < Math.max(1, weeks); w++) {
    for (const wd of weekdays) {
      const d = addDays(ws, w * 7 + wd);
      if (d >= startISO) out.push(d); // não cria datas antes da base
    }
  }
  return [...new Set(out)].sort();
}

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

/* ---- classificação de pessoas: cliente | novato ----
   A etiqueta "Lead" saiu do sistema em 22/08/2026: quem entra pelo site já
   marca a experimental, então "cadastrou e não prosseguiu" deixou de ser um
   estado real. Restaram dois: quem está na primeira aula e todo o resto. */
// nº de marcações ativas (não canceladas) de uma pessoa
export const clientActiveCount = (data, c) =>
  bookingsActive(data).filter((b) => b.clientName === c.name).length;

// Novato: está na primeira aula (firstClass). Cliente: todo o resto.
export function classifyClient(data, c) {
  return c.firstClass ? "novato" : "cliente";
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

/* ================= tipo da aula: reposição / aula extra =================
   O backend marca o tipo no paymentMethod ao criar a reserva:
   "Reposição" = consumiu crédito do MakeupCredit · "Avulsa" = aula extra paga. */
// Esquema de cores da agenda por tipo de aula:
//   AZUL = reposição · VERMELHO = 1ª aula (experimental) · VERDE = aula extra
export const BOOKING_KINDS = {
  reposicao: { key: "reposicao", label: "Reposição", ic: "🔁", cls: "b-info",   color: "var(--info)" },
  primeira:  { key: "primeira",  label: "1ª aula",    ic: "🎟️", cls: "b-danger", color: "var(--danger)" },
  extra:     { key: "extra",     label: "Aula extra", ic: "✨", cls: "b-ok",     color: "var(--green-mid)" },
};
export const bookingKind = (b) =>
  b.paymentMethod === "Reposição" ? BOOKING_KINDS.reposicao
  : b.paymentMethod === "Matrícula" ? BOOKING_KINDS.primeira
  : b.paymentMethod === "Avulsa" ? BOOKING_KINDS.extra
  : null;

// Reservas do horário INCLUINDO canceladas (a agenda mostra quem desmarcou).
export const slotBookingsAll = (data, slotId) =>
  data.bookings
    .filter((b) => b.slotId === slotId)
    .sort((a, b) => (a.status === "cancelada") - (b.status === "cancelada") || a.clientName.localeCompare(b.clientName));

/* ================= mensalidades: competências ================= */
export const compAtual = () => todayISO().slice(0, 7); // 'YYYY-MM'
export function addComp(comp, n) {
  const [y, m] = comp.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function compLabel(comp) {
  const [y, m] = comp.split("-").map(Number);
  return capitalize(new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
}
// Data da primeira matrícula do aluno (taxa paga → experimental → cadastro).
export const matriculaISO = (c) =>
  c.matriculaAt || c.trialDate || (c.createdAt ? String(c.createdAt).slice(0, 10) : null);
// Competências da matrícula até `ate` (mais recente primeiro).
export function competenciasDoAluno(c, ate = compAtual()) {
  const ini = matriculaISO(c);
  if (!ini) return [ate];
  let comp = ini.slice(0, 7);
  const out = [];
  while (comp <= ate && out.length < 240) { out.push(comp); comp = addComp(comp, 1); }
  return out.reverse();
}
// Mensalidade efetiva do aluno (individual → plano 1x/2x → padrão legado).
export function mensalidadeDe(c, meta) {
  if (c.monthlyValue != null) return c.monthlyValue || 0;
  if (c.weeklyFreq === 1) return (meta && meta.valorPlano1x) || 0;
  if (c.weeklyFreq === 2) return (meta && meta.valorPlano2x) || 0;
  return (meta && meta.mensalidadeValor) || 0;
}
/* Valor combinado só para um mês (desconto/promoção), se houver.
   ESPELHO de valorDaCompetencia no server — quem manda é o backend; aqui é para
   a tela mostrar o valor certo de meses que ainda nem têm boleto. */
export const precoDaComp = (precos, clientId, comp) =>
  (precos || []).find((p) => p.clientId === clientId && p.competencia === comp) || null;
export function mensalidadeDaComp(c, comp, meta, precos) {
  const p = precoDaComp(precos, c.id, comp);
  return p ? p.amountCents / 100 : mensalidadeDe(c, meta);
}

/* ================= regras de marcação do mensalista =================
   ESPELHO de backend/src/regrasAula.js — é lá que a regra é aplicada de
   verdade; aqui é só para o painel avisar a Inêz ANTES de mandar a requisição.
   Ao mexer numa regra, mexa nos dois lugares.

   • Sábado não faz parte do plano de mensalista.
   • Horário a partir das 18:00 também não (18:00 já entra no bloqueio).
   • Escala: a aluna marca a próxima aula no dia da aula dela.
   Quem já estava em sábado / à noite quando a regra entrou continua podendo —
   é o que `podeSabado` e `podeNoite` guardam (preenchidos pela migration). */
export const NOITE_A_PARTIR = "18:00";
export const ehSabadoISO = (iso) => new Date(iso + "T00:00").getDay() === 6;
export const ehNoite = (time) => hhmm(time) >= NOITE_A_PARTIR;
export const tipoMensalista = (c) =>
  !c || c.plan !== "mensalista" ? null : c.mensalistaTipo === "escala" ? "escala" : "fixo";
export const TIPO_MENSALISTA_LABEL = { fixo: "Fixo", escala: "Escala" };

/* Por que este horário fura o plano da aluna — ou "" quando está tudo certo.
   Só olha data/hora: a janela da escala é do portal, não do painel (quem agenda
   pelo painel é a Inêz, e ela pode marcar quando quiser). */
export function motivoForaDaRegra(c, { date, time }) {
  if (!tipoMensalista(c)) return "";
  if (ehSabadoISO(date) && !c.podeSabado) return "sábado não faz parte do plano de mensalista";
  if (ehNoite(time) && !c.podeNoite) return `horário a partir das ${NOITE_A_PARTIR} não faz parte do plano de mensalista`;
  return "";
}
// Mesma checagem a partir de dia-da-semana (Seg=0…Dom=6) + hora — usada no lote,
// que escolhe turmas recorrentes em vez de datas soltas.
export function motivoForaDaRegraDow(c, dow, time) {
  if (!tipoMensalista(c)) return "";
  if (dow === 5 && !c.podeSabado) return "sábado não faz parte do plano de mensalista";
  if (ehNoite(time) && !c.podeNoite) return `horário a partir das ${NOITE_A_PARTIR} não faz parte do plano de mensalista`;
  return "";
}
