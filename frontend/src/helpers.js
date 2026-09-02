export const UNITS = ["Ipatinga", "Timóteo"];
export const PROFS = ["Equipe FQC"];
export const VALOR_PADRAO = 80;
export const CAPACITY_PADRAO = 4;
// Etiquetas de aluno: nenhuma no momento. A única que existia ("Lead") saiu do
// sistema em 22/08/2026. O campo continua no banco para não perder histórico.
export const TAG_OPTIONS = [];

export const STATUS = {
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

/* Horizonte padrão de tudo que a ADMIN faz no painel (Vitor, 02/09/2026).
   O painel age em LOTE por padrão: incluir, alterar e excluir valem para as
   próximas ocorrências da turma, não para a data isolada em que a Inêz clicou.
   52 semanas ≈ 12 meses, o mesmo horizonte da grade inicial da mensalista — as
   duas coisas têm que bater, senão a aluna nova ganha uma agenda mais longa que
   a turma dela e as últimas aulas ficam sem horário.

   O lote é o padrão, não uma obrigação: toda tela mantém a saída "só esta". */
export const SEMANAS_PADRAO = 52;
export const MESES_PADRAO = 12;

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

/* Nome curto para caber no cartão da agenda: primeiro nome + inicial do
   sobrenome ("Maria da Conceição dos Santos" → "Maria S."). Só o primeiro nome
   não bastava — a escola tem duas Adrianas e três Marias, e na coluna da
   semana elas ficavam idênticas. Conectivos (da, de, dos) não viram inicial. */
const CONECTIVOS_NOME = new Set(["da", "das", "de", "del", "di", "do", "dos", "du", "e", "y", "la", "le", "van", "von"]);
export function nomeCurto(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return partes[0] || "";
  const ultimo = [...partes].slice(1).reverse().find((p) => !CONECTIVOS_NOME.has(p.toLowerCase()));
  return ultimo ? `${partes[0]} ${ultimo[0].toUpperCase()}.` : partes[0];
}

/* ---- derivados do estado (data = {clients, slots, bookings}) ---- */
export const bookingsActive = (data) => data.bookings.filter((b) => b.status !== "cancelada");
export const slotById = (data, id) => data.slots.find((s) => s.id === id);
export const slotBookings = (data, slotId) =>
  data.bookings
    .filter((b) => b.slotId === slotId && b.status !== "cancelada")
    .sort((a, b) => a.time.localeCompare(b.time));
/* As outras ocorrências FUTURAS da mesma turma — as que o lote do painel
   alcança ao incluir, alterar ou excluir. Espelho de irmasDaTurma() no
   backend/src/server.js: mesma unidade, hora e dia da semana, ou mesma série.
   Os dois critérios somam porque nenhum basta sozinho — o seriesId perde as
   turmas criadas em levas separadas, e unidade+hora+dia perde as que já foram
   movidas para outro horário. Mexeu num, mexa no outro.

   Passado nunca entra: aula que já aconteceu é histórico.

   A hora passa por hhmm() dos dois lados porque `time` é texto livre no banco
   (ver a migration de horários HH:MM) — "9:00" e "09:00" são a mesma turma. */
export const irmasNaAgenda = (data, slot) => {
  if (!slot) return [];
  const t = todayISO();
  const dow = new Date(slot.date + "T00:00").getDay();
  const hora = hhmm(slot.time);
  return (data.slots || []).filter((s) => s.id !== slot.id && s.date >= t && (
    (slot.seriesId && s.seriesId === slot.seriesId) ||
    (s.unit === slot.unit && hhmm(s.time) === hora && new Date(s.date + "T00:00").getDay() === dow)
  ));
};
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

/* ================= feriados: não há aula =================
   O calendário vem pronto do servidor em `meta.feriados` ({ 'YYYY-MM-DD': nome }),
   nacionais e manuais já resolvidos — a tela não recalcula Páscoa nem junta
   listas, só pergunta pelo dia. Quem manda continua sendo o backend: aqui é só
   para a agenda marcar o dia e os botões avisarem antes de tentar. */
export const feriadoDe = (data, date, unit) => {
  const porUnidade = data?.meta?.feriadosPorUnidade || {};
  if (unit && unit !== "Todas") return (porUnidade[unit] || {})[String(date || "")] || "";
  const nomes = [...new Set(Object.values(porUnidade).map((cal) => cal?.[String(date || "")]).filter(Boolean))];
  return nomes.join(" / ") || (data?.meta?.feriados || {})[String(date || "")] || "";
};
export const feriadoBaseDe = (data, date, unit) => {
  const porUnidade = data?.meta?.feriadosBasePorUnidade || {};
  if (unit && unit !== "Todas") return (porUnidade[unit] || {})[String(date || "")] || "";
  const nomes = [...new Set(Object.values(porUnidade).map((cal) => cal?.[String(date || "")]).filter(Boolean))];
  return nomes.join(" / ") || "";
};
export const ehFeriado = (data, date, unit) => !!feriadoDe(data, date, unit);

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
/* Marcas que o backend põe no paymentMethod da reserva da aula experimental —
   o dinheiro dela é a 1ª MENSALIDADE da aluna, não o preço de uma aula.
   "Matrícula" é o rótulo antigo, de quando existia a taxa de R$20 separada;
   segue reconhecido para as reservas que já estão no banco. Espelho de
   MARCAS_MATRICULA em backend/src/server.js. */
export const MARCAS_MATRICULA = ["1ª mensalidade", "Matrícula"];
export const ehPagamentoDeMatricula = (m) => MARCAS_MATRICULA.includes(m);

export const bookingKind = (b) =>
  b.paymentMethod === "Reposição" ? BOOKING_KINDS.reposicao
  : ehPagamentoDeMatricula(b.paymentMethod) ? BOOKING_KINDS.primeira
  : b.paymentMethod === "Avulsa" ? BOOKING_KINDS.extra
  : null;

/* Tipo da aula com REFORÇO pela ficha da aluna.
   O paymentMethod só sai marcado quando a reserva nasce no fluxo público da
   experimental. Quando a Inêz marca a aula pelo painel, a reserva nasce sem
   marca nenhuma — mas a ficha continua dizendo `firstClass`, e para a agenda
   aquela ainda é a 1ª aula da pessoa. Só a marcação ATIVA mais antiga dela
   ganha o destaque: as seguintes já são aula normal de quem está começando. */
export function bookingKindDe(data, b) {
  const k = bookingKind(b);
  if (k) return k;
  if (b.status === "cancelada") return null;
  const c = clientOfBooking(data, b);
  if (!c || !c.firstClass) return null;
  const tel = (b.phone || "").replace(/\D/g, "").slice(-8);
  const mesmaPessoa = (x) =>
    x.clientName === b.clientName ||
    (tel.length >= 8 && (x.phone || "").replace(/\D/g, "").endsWith(tel));
  const primeira = data.bookings
    .filter((x) => x.status !== "cancelada" && mesmaPessoa(x))
    .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))[0];
  return primeira && primeira.id === b.id ? BOOKING_KINDS.primeira : null;
}

/* Reservas do horário INCLUINDO canceladas (a agenda mostra quem desmarcou).
   A aluna nova sobe para o topo da lista: com o corte de "+N mais" no cartão,
   ordem alfabética escondia justamente quem precisa ser vista. */
export const slotBookingsAll = (data, slotId) => {
  const nova = (b) => (bookingKindDe(data, b)?.key === "primeira" ? 0 : 1);
  return data.bookings
    .filter((b) => b.slotId === slotId)
    .sort((a, b) =>
      (a.status === "cancelada") - (b.status === "cancelada") ||
      nova(a) - nova(b) ||
      a.clientName.localeCompare(b.clientName));
};

/* ================= aniversários =================
   `birthday` é 'YYYY-MM-DD' e o ano dela é o de NASCIMENTO — o que interessa
   para a Inêz é o dia e o mês. Tudo aqui trabalha com o próximo aniversário a
   acontecer, medido pelo relógio de Brasília (todayISO), não pelo do navegador.

   29 de fevereiro: em ano não bissexto o JS empurra para 1º de março, e é o que
   a gente quer — a aluna é parabenizada, não some do sistema por quatro anos. */

// { dia, mes } de um 'YYYY-MM-DD', ou null se não houver data válida
export function diaMesNasc(bd) {
  const m = String(bd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { ano: +m[1], mes: +m[2], dia: +m[3] } : null;
}

// Data ISO do próximo aniversário (hoje conta como o próximo). null sem data.
export function proximoAniversario(bd, hoje = todayISO()) {
  const n = diaMesNasc(bd);
  if (!n) return null;
  const [hy] = hoje.split("-").map(Number);
  const iso = (ano) => {
    const d = new Date(ano, n.mes - 1, n.dia); // 29/02 em ano comum vira 01/03
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const esteAno = iso(hy);
  return esteAno >= hoje ? esteAno : iso(hy + 1);
}

// Quantos dias faltam (0 = hoje). null sem data.
export function diasAteAniversario(bd, hoje = todayISO()) {
  const prox = proximoAniversario(bd, hoje);
  if (!prox) return null;
  return Math.round((new Date(prox + "T00:00") - new Date(hoje + "T00:00")) / 86400000);
}

// Idade que ela COMPLETA no próximo aniversário. null sem data (ou ano zoado).
export function idadeQueFaz(bd, hoje = todayISO()) {
  const n = diaMesNasc(bd);
  const prox = proximoAniversario(bd, hoje);
  if (!n || !prox) return null;
  const idade = Number(prox.slice(0, 4)) - n.ano;
  return idade > 0 && idade < 130 ? idade : null;
}

// "hoje! 🎉" | "amanhã" | "em 5 dias" | "há 3 dias" — como a Inêz lê na tela
export function faltamLabel(dias) {
  if (dias === null || dias === undefined) return "—";
  if (dias === 0) return "hoje! 🎉";
  if (dias === 1) return "amanhã";
  if (dias === -1) return "ontem";
  if (dias < 0) return `há ${-dias} dias`;
  return `em ${dias} dias`;
}

// '15/03' a partir de um 'YYYY-MM-DD' (sem depender do fuso)
export const diaMesLabel = (bd) => {
  const n = diaMesNasc(bd);
  return n ? `${String(n.dia).padStart(2, "0")}/${String(n.mes).padStart(2, "0")}` : "—";
};

/* Distância (em dias) entre o aniversário da aluna e UMA data qualquer —
   diferente de diasAteAniversario, que mede sempre a partir de hoje. Aqui a
   referência é o dia da AULA: é isso que faz sentido na agenda, onde a Inêz
   olha a semana que vem. Negativo = o aniversário já passou naquela semana.
   Devolve null quando não há data de nascimento. */
export function diasEntreAniversarioE(bd, data) {
  const n = diaMesNasc(bd);
  if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return null;
  const alvo = new Date(data + "T00:00");
  // testa o aniversário no ano anterior, no mesmo e no seguinte: a janela pode
  // atravessar a virada do ano (aula em 30/12, aniversário em 02/01)
  const candidatos = [-1, 0, 1].map((dy) => new Date(alvo.getFullYear() + dy, n.mes - 1, n.dia));
  const dias = candidatos.map((d) => Math.round((d - alvo) / 86400000));
  return dias.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
}

/* Aniversariantes de um período, do mais próximo para o mais distante.
   `periodo`:
     'semana' — a semana corrente, de segunda a domingo (weekStart manda)
     'mes'    — o mês corrente inteiro, incluindo os dias que já passaram
     'proximos' — os próximos `dias` dias corridos, a partir de hoje
   O mês corrente traz quem já fez aniversário: em 26/08 a Inêz ainda quer ver
   quem fez dia 3 — é o mês dela, não uma janela para a frente. */
export function aniversariantes(clients, periodo = "mes", hoje = todayISO(), dias = 30) {
  const [hy, hm] = hoje.split("-").map(Number);
  const ini = periodo === "semana" ? weekStart(hoje) : null;
  const fim = ini ? addDays(ini, 6) : null;
  const noAnoDe = (n, ano) => `${ano}-${String(n.mes).padStart(2, "0")}-${String(n.dia).padStart(2, "0")}`;

  return (clients || [])
    .map((c) => {
      const n = diaMesNasc(c.birthday);
      if (!n) return null;
      // `quando` é a data do aniversário DENTRO do período que estamos olhando —
      // e não o próximo, senão quem já fez aniversário este mês apareceria com
      // "em 342 dias" em vez de "foi dia 3".
      let quando;
      if (periodo === "semana") {
        // a semana pode atravessar a virada do ano — por isso testa os dois anos
        quando = [noAnoDe(n, hy), noAnoDe(n, hy + 1)].find((d) => d >= ini && d <= fim);
        if (!quando) return null;
      } else if (periodo === "proximos") {
        const d = diasAteAniversario(c.birthday, hoje);
        if (d === null || d > dias) return null;
        quando = proximoAniversario(c.birthday, hoje);
      } else {
        if (n.mes !== hm) return null;
        quando = noAnoDe(n, hy);
      }
      const idade = Number(quando.slice(0, 4)) - n.ano;
      return {
        c,
        quando,
        passou: quando < hoje,
        dias: Math.round((new Date(quando + "T00:00") - new Date(hoje + "T00:00")) / 86400000),
        idade: idade > 0 && idade < 130 ? idade : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.quando.localeCompare(b.quando) || a.c.name.localeCompare(b.c.name));
}

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

/* ---- aulas do mês de um aluno (usado na coluna "Aulas" da tela Alunos) ----
   Contagem real do mês corrente, não o total da vida inteira:
   • feitas  = marcação não cancelada, com data já passada (ou hoje), que não
               foi marcada como falta — a aula aconteceu;
   • faltas  = data já passada e attendance === "falta";
   • futuras = ainda vai acontecer neste mês.
   A ligação com o aluno é por clientName, igual ao resto do painel. */
export function clientMonthClasses(data, name, comp = compAtual()) {
  const hoje = todayISO();
  const doMes = bookingsActive(data).filter(
    (b) => b.clientName === name && String(b.date || "").slice(0, 7) === comp
  );
  const passadas = doMes.filter((b) => b.date <= hoje);
  return {
    feitas: passadas.filter((b) => b.attendance !== "falta").length,
    faltas: passadas.filter((b) => b.attendance === "falta").length,
    futuras: doMes.filter((b) => b.date > hoje).length,
  };
}
// Data da primeira matrícula do aluno (matrícula → experimental → cadastro).
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

/* ================= situação da mensalidade do mês =================
   A marcação de uma aula não tem preço próprio desde 28/08/2026: a aluna paga
   por MÊS, não por aula. O que importa ao olhar uma marcação é como está a
   mensalidade da competência atual dela — é isso que estas duas funções
   respondem, e é o que a coluna de status das Marcações mostra.

   Volta { estado, label, cls, valor, inv }, com `estado` em:
     recebido | a_receber | atraso | sem_boleto | sem_mensalidade */
export const SIT_MENSALIDADE = {
  recebido:        { label: "✓ Recebido",       cls: "b-ok" },
  a_receber:       { label: "⏳ A receber",      cls: "b-warn" },
  atraso:          { label: "⚠️ Em atraso",      cls: "b-danger" },
  sem_boleto:      { label: "📄 Sem mensalidade gerada", cls: "b-muted" },
  sem_mensalidade: { label: "sem mensalidade",  cls: "b-muted" },
};

// A ficha da aluna por trás de uma marcação (a reserva guarda nome e telefone,
// não o id). Casa pelo telefone quando existe; o nome é o desempate.
export function clientOfBooking(data, booking) {
  const tel = (booking.phone || "").replace(/\D/g, "");
  const porTel = tel.length >= 8
    ? data.clients.find((c) => (c.phone || "").replace(/\D/g, "").endsWith(tel.slice(-8)))
    : null;
  return porTel || data.clients.find((c) => c.name === booking.clientName) || null;
}

/* Marcadores que aparecem ANTES do nome da aluna no cartão da agenda.
   São as duas coisas que a Inêz precisa saber batendo o olho na turma:
     🎂 tem aniversariante nesta aula (ou na semana dela)
     🙋 é mensalista de ESCALA — quem marca a própria aula, então esta
        presença não é fixa: ela pode não repetir na semana seguinte
   Devolve [] quando não há nada a dizer. `forte` = destaque cheio (o dia é
   exatamente hoje/na aula); sem ele o ícone fica esmaecido, como um aviso. */
const JANELA_ANIVERSARIO = 3; // dias para cada lado do dia da aula
export function marcadoresDoAluno(data, booking, dataAula) {
  const c = clientOfBooking(data, booking);
  if (!c) return [];
  const marcas = [];

  const dias = diasEntreAniversarioE(c.birthday, dataAula || booking.date);
  if (dias !== null && Math.abs(dias) <= JANELA_ANIVERSARIO) {
    const quando = dias === 0 ? "no dia desta aula" : dias === 1 ? "amanhã" : dias === -1 ? "foi ontem"
      : dias > 0 ? `em ${dias} dias` : `foi há ${-dias} dias`;
    marcas.push({ k: "bday", ic: "🎂", forte: dias === 0, label: `Aniversário ${quando} (${diaMesLabel(c.birthday)})` });
  }

  if (tipoMensalista(c) === "escala") {
    marcas.push({ k: "escala", ic: "🙋", forte: true, label: "Mensalista escala — ela marca a própria aula" });
  }
  return marcas;
}

export function situacaoMensalidade(data, client, comp = compAtual()) {
  const base = { valor: 0, inv: null, client };
  // Quem não é mensalista não entra na régua mensal — nem cobrar, nem alarmar.
  if (!client || client.plan !== "mensalista") {
    return { ...base, estado: "sem_mensalidade", ...SIT_MENSALIDADE.sem_mensalidade };
  }
  const inv = (data.invoices || []).find((i) => i.clientId === client.id && i.competencia === comp);
  if (!inv) {
    return {
      ...base, estado: "sem_boleto", ...SIT_MENSALIDADE.sem_boleto,
      valor: mensalidadeDaComp(client, comp, data.meta, data.precos),
    };
  }
  // Cancelada é dívida perdoada: não é receita nem cobrança em aberto.
  if (inv.status === "cancelado") {
    return { ...base, inv, estado: "sem_mensalidade", ...SIT_MENSALIDADE.sem_mensalidade };
  }
  if (inv.status === "pago") {
    return { ...base, inv, estado: "recebido", ...SIT_MENSALIDADE.recebido, valor: inv.amountCents / 100 };
  }
  // Em aberto: o valor a cobrar hoje já vem com multa e juros calculados pelo backend.
  const atrasada = !!(inv.encargos && inv.encargos.atrasada);
  return {
    ...base, inv,
    estado: atrasada ? "atraso" : "a_receber",
    ...(atrasada ? SIT_MENSALIDADE.atraso : SIT_MENSALIDADE.a_receber),
    valor: inv.encargos ? inv.encargos.total : inv.amountCents / 100,
  };
}

/* ================= regras de marcação do mensalista =================
   ESPELHO de backend/src/regrasAula.js — é lá que a regra é aplicada de
   verdade; aqui é só para o painel avisar a Inêz ANTES de mandar a requisição.
   Ao mexer numa regra, mexa nos dois lugares.

   • A frequência do plano define a grade inicial de 12 meses.
   • Escala: a aluna marca a próxima aula no dia da aula dela.

   Não há mais regra por DATA. As duas que existiam saíram, porque as duas
   diziam que parte da grade real da escola estava fora do plano: "a partir das
   18:00" em 26/08/2026 e "sábado" em 30/08/2026. Com elas foram embora daqui o
   `ehSabadoISO` e as funções `motivoForaDaRegra` / `motivoForaDaRegraDow`, que
   avisavam a Inêz antes de mandar a requisição — sem regra de data, elas
   respondiam "" para tudo. Ver o cabeçalho de backend/src/regrasAula.js.

   Ajustes posteriores da aluna são sempre unitários. */
export const tipoMensalista = (c) =>
  !c || c.plan !== "mensalista" ? null : c.mensalistaTipo === "escala" ? "escala" : "fixo";
export const TIPO_MENSALISTA_LABEL = { fixo: "Fixo", escala: "Escala" };

/**
 * Validação do algoritmo oficial do CPF (módulo 11 com 2 dígitos verificadores).
 */
export function validarCPF(cpf) {
  const limpo = String(cpf || "").replace(/\D/g, "");
  if (limpo.length !== 11 || /^(\d)\1{10}$/.test(limpo)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(limpo[i], 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(limpo[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(limpo[i], 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(limpo[10], 10)) return false;
  return true;
}

/**
 * Formata CPF em tempo real: 000.000.000-00
 */
export function formatarCPF(cpf) {
  const d = String(cpf || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}
