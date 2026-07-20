import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";
import { mkdirSync } from "fs";
import {
  prisma,
  UNITS,
  PROFS,
  VALOR_PADRAO,
  CAPACITY_PADRAO,
  profFor,
} from "./prismaClient.js";
import { coraConfigured, createInvoice, getInvoice } from "./cora.js";
import { waConfigured, waVerify, sendWaText, sendWaButtons, sendWaList, parseIncoming, normalizePhone } from "./wa.js";

// pasta de fotos de depoimentos (servida estaticamente pelo Vite via frontend/public)
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPO_DIR = process.env.DEPO_DIR || join(__dirname, "../../frontend/public/depoimentos");
mkdirSync(DEPO_DIR, { recursive: true });

const depoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DEPO_DIR),
    filename: (_req, file, cb) => {
      const safe = Date.now() + extname(file.originalname).toLowerCase();
      cb(null, safe);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
  },
});

const app = express();
app.use(cors());
app.use(express.json());
// Garantir UTF-8 em todas as respostas JSON
app.use((_req, res, next) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); next(); });

/* ===================== AUTENTICAÇÃO DO PAINEL ADMIN =====================
   Protege as rotas do painel. Só quem tem conta (usuário+senha) acessa.
   Rotas públicas (site, portal do aluno, webhook) ficam liberadas. */
const adminTokens = new Set(); // tokens de sessão válidos (em memória)
const genToken = () => crypto.randomBytes(24).toString("hex");
// Enquanto não houver NENHUM admin cadastrado, o painel fica aberto (primeiro uso),
// para não travar o sistema antes de você criar o acesso. Depois de criar, passa a exigir login.
let hasAdmin = false;
prisma.adminUser.count().then((n) => { hasAdmin = n > 0; }).catch(() => {});
// rotas que NÃO exigem login (site público, portal do aluno, webhooks)
const PUBLIC_API = [
  ["GET", /^\/api\/health$/],
  ["GET", /^\/api\/admin\/exists$/],
  ["POST", /^\/api\/admin\/(login|setup|register)$/],
  ["GET", /^\/api\/slots\/available$/],
  ["POST", /^\/api\/bookings$/],
  ["POST", /^\/api\/bookings\/\d+\/(invoice|pay)$/],
  ["PATCH", /^\/api\/bookings\/\d+$/],
  ["POST", /^\/api\/auth\/(check|set-pin|login)$/],
  [null, /^\/api\/portal\//],
  ["GET", /^\/api\/testimonials$/],
  ["GET", /^\/api\/settings$/],
  [null, /^\/api\/wa\/webhook$/],
  [null, /^\/api\/cora\/webhook$/],
];
const isPublicApi = (req) => PUBLIC_API.some(([m, re]) => (!m || m === req.method) && re.test(req.path));
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next(); // arquivos estáticos etc.
  if (!hasAdmin) return next(); // primeiro uso: sem admin cadastrado, tudo liberado
  if (isPublicApi(req)) return next();
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (tok && adminTokens.has(tok)) return next();
  return res.status(401).json({ error: "Acesso restrito ao painel. Faça login." });
});

const todayISO = () => new Date().toISOString().slice(0, 10);
function addDays(iso, n) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const onlyDigits = (s) => (s || "").replace(/\D/g, "");
// única etiqueta do sistema: "Lead" (alunos não têm etiqueta); valores antigos no banco são ignorados
const VALID_TAGS = ["Lead"];
const parseTags = (t) => {
  try {
    const a = JSON.parse(t || "[]");
    return Array.isArray(a) ? a.filter((x) => VALID_TAGS.includes(x)) : [];
  } catch {
    return [];
  }
};

// quantas reservas ativas (não canceladas) um slot tem
async function occupancy(slotId) {
  return prisma.booking.count({
    where: { slotId, status: { not: "cancelada" } },
  });
}

/* ===================== REPOSIÇÃO (mensalistas) =====================
   Regras combinadas com a Inêz:
   1. Reposição não é obrigatória e não há vaga reservada — só entra em turma
      que já tem vaga livre, aberta por outra aluna que liberou a aula.
   2. A vaga só conta como liberada se o aviso vier com antecedência:
      - aula antes das 10:00 → até 23:59 do dia anterior;
      - demais horários      → no mínimo 6 horas antes.
   3. No máximo 2 créditos por mês (competência da aula liberada), mesmo que
      a aluna libere 3 ou mais.
   4. O crédito vale até o fim do mês seguinte ao da aula liberada.
   5. Só para mensalista ativa e com mensalidade em dia.
   6. Quem rompe com o curso (status "cancelado") não ganha nem usa crédito. */
const REPO_MAX_MES = 2;
const REPO_HORAS_MIN = 6;
const REPO_MANHA_ATE = "10:00"; // aula antes disso usa o prazo da meia-noite

// O prazo é do relógio da aluna, não do UTC do servidor. 'sv-SE' formata ISO.
const agoraBR = () =>
  new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T");

// 'YYYY-MM-DDTHH:MM:SS' — instante limite para liberar a aula e ganhar crédito
function prazoLiberacao(date, time) {
  if (time < REPO_MANHA_ATE) return `${addDays(date, -1)}T23:59:59`;
  const [h, m] = time.split(":").map(Number);
  let min = h * 60 + m - REPO_HORAS_MIN * 60;
  let d = date;
  while (min < 0) { min += 1440; d = addDays(d, -1); }
  return `${d}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
}
const liberouATempo = (date, time, agora = agoraBR()) => agora <= prazoLiberacao(date, time);

// 'YYYY-MM' → 'julho de 2026', para as mensagens ficarem legíveis
const compPorExtenso = (comp) => {
  const [y, m] = comp.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
};

// último dia do mês seguinte à competência 'YYYY-MM'
function fimDoMesSeguinte(comp) {
  const [y, m] = comp.split("-").map(Number);
  const fim = new Date(Date.UTC(y, m + 1, 0)); // dia 0 do mês m+2 = último dia de m+1
  return fim.toISOString().slice(0, 10);
}

// A mensalidade está em dia se não há boleto pendente já vencido.
async function mensalidadeEmDia(clientId) {
  const atrasadas = await prisma.invoice.count({
    where: { clientId, status: "pendente", dueDate: { lt: todayISO() } },
  });
  return atrasadas === 0;
}

// { ok, motivo } — se a aluna pode ganhar/usar crédito de reposição agora
async function elegivelReposicao(client) {
  if (client.status === "cancelado")
    return { ok: false, motivo: "Inscrição cancelada — não há direito a reposição." };
  if (client.plan !== "mensalista")
    return { ok: false, motivo: "A reposição é um benefício das alunas mensalistas." };
  if (!(await mensalidadeEmDia(client.id)))
    return { ok: false, motivo: "Há mensalidade em atraso. Regularize para poder repor." };
  return { ok: true, motivo: "" };
}

const creditoValido = (t) => ({ usedBookingId: null, expiresOn: { gte: t } });

// Saldo + histórico, já classificando cada crédito para a tela
async function resumoReposicao(client) {
  const t = todayISO();
  const [eleg, creditos] = await Promise.all([
    elegivelReposicao(client),
    prisma.makeupCredit.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const marcados = creditos.map((c) => ({
    ...c,
    situacao: c.usedBookingId ? "usado" : c.expiresOn < t ? "expirado" : "disponivel",
  }));
  return {
    elegivel: eleg.ok,
    motivo: eleg.motivo,
    saldo: marcados.filter((c) => c.situacao === "disponivel").length,
    creditos: marcados,
    regras: {
      maxPorMes: REPO_MAX_MES,
      horasMin: REPO_HORAS_MIN,
      manhaAte: REPO_MANHA_ATE,
    },
  };
}

// Concede o crédito quando a aluna libera a aula. Devolve o crédito ou null
// (com o motivo) — liberar fora do prazo continua valendo, só não gera crédito.
async function concederCredito(client, booking) {
  const eleg = await elegivelReposicao(client);
  if (!eleg.ok) return { credito: null, motivo: eleg.motivo };
  if (!liberouATempo(booking.date, booking.time))
    return {
      credito: null,
      motivo: booking.time < REPO_MANHA_ATE
        ? "Aula da manhã precisa ser liberada até 23:59 do dia anterior para gerar crédito."
        : `Aviso com menos de ${REPO_HORAS_MIN}h de antecedência não gera crédito de reposição.`,
    };
  const competencia = booking.date.slice(0, 7);
  const noMes = await prisma.makeupCredit.count({ where: { clientId: client.id, competencia } });
  if (noMes >= REPO_MAX_MES)
    return { credito: null, motivo: `Você já atingiu o limite de ${REPO_MAX_MES} reposições de ${compPorExtenso(competencia)}.` };
  const credito = await prisma.makeupCredit.create({
    data: {
      clientId: client.id,
      competencia,
      expiresOn: fimDoMesSeguinte(competencia),
      originBookingId: booking.id,
      originDate: booking.date,
      originTime: booking.time,
    },
  });
  return { credito, motivo: "" };
}

// Marca uma aula de reposição consumindo o crédito mais antigo ainda válido.
// Lança { code, message } para o wrap devolver o status certo.
async function marcarReposicao(client, slotId) {
  const eleg = await elegivelReposicao(client);
  if (!eleg.ok) throw Object.assign(new Error(eleg.motivo), { code: 403 });
  const t = todayISO();
  const credito = await prisma.makeupCredit.findFirst({
    where: { clientId: client.id, ...creditoValido(t) },
    orderBy: { expiresOn: "asc" }, // gasta primeiro o que vence antes
  });
  if (!credito) throw Object.assign(new Error("Você não tem crédito de reposição disponível."), { code: 409 });

  const slot = await prisma.slot.findUnique({ where: { id: Number(slotId) } });
  if (!slot) throw Object.assign(new Error("Horário não encontrado."), { code: 404 });
  if (slot.date < t) throw Object.assign(new Error("Não dá para repor em uma aula que já passou."), { code: 400 });
  const dup = await prisma.booking.findFirst({
    where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } },
  });
  if (dup) throw Object.assign(new Error("Você já tem essa aula marcada."), { code: 400 });
  // não há vaga reservada para reposição: só entra se a turma tiver vaga livre
  if ((await occupancy(slot.id)) >= (slot.capacity || 1))
    throw Object.assign(new Error("Turma lotada — não há vaga de reposição nesse horário."), { code: 409 });

  const booking = await prisma.booking.create({
    data: {
      clientName: client.name, phone: client.phone || "", unit: slot.unit,
      date: slot.date, time: slot.time, prof: slot.prof || profFor(slot.unit),
      slotId: slot.id, status: "confirmada", value: 0, paid: true, paymentMethod: "Reposição",
      paymentDate: t,
    },
  });
  await prisma.makeupCredit.update({
    where: { id: credito.id },
    data: { usedBookingId: booking.id, usedAt: t },
  });
  return booking;
}

/* Aula extra avulsa: caminho separado da reposição — sempre paga, não consome
   nem gera crédito. Nasce "aguardando" para a aluna pagar. */
async function marcarAulaExtra(client, slotId) {
  if (client.status === "cancelado")
    throw Object.assign(new Error("Inscrição cancelada. Fale com a Inêz."), { code: 403 });
  const t = todayISO();
  const slot = await prisma.slot.findUnique({ where: { id: Number(slotId) } });
  if (!slot) throw Object.assign(new Error("Horário não encontrado."), { code: 404 });
  if (slot.date < t) throw Object.assign(new Error("Escolha uma aula futura."), { code: 400 });
  const dup = await prisma.booking.findFirst({
    where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } },
  });
  if (dup) throw Object.assign(new Error("Você já tem essa aula marcada."), { code: 400 });
  if ((await occupancy(slot.id)) >= (slot.capacity || 1))
    throw Object.assign(new Error("Turma lotada."), { code: 409 });
  return prisma.booking.create({
    data: {
      clientName: client.name, phone: client.phone || "", unit: slot.unit,
      date: slot.date, time: slot.time, prof: slot.prof || profFor(slot.unit),
      slotId: slot.id, status: "aguardando", value: SETTINGS.valorAvulsa, paid: false,
      paymentMethod: "Avulsa",
    },
  });
}

// Se a aula de reposição foi cancelada/excluída, o crédito volta para a aluna
// (desde que ainda esteja na validade).
async function devolverCredito(bookingId) {
  const c = await prisma.makeupCredit.findFirst({ where: { usedBookingId: bookingId } });
  if (!c) return null;
  if (c.expiresOn < todayISO()) return null; // já venceu: não ressuscita
  return prisma.makeupCredit.update({ where: { id: c.id }, data: { usedBookingId: null, usedAt: null } });
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

/* ---------- configurações (linha única id=1, cache em memória) ---------- */
const PRECOS_PADRAO = { taxaMatricula: 20, valorPlano1x: 120, valorPlano2x: 200, valorAvulsa: 40, duracaoAulaMin: 120 };
let SETTINGS = { valorPadrao: VALOR_PADRAO, capacidadePadrao: CAPACITY_PADRAO, units: UNITS, profs: PROFS, horarioFunc: "", pixKey: "", pixName: "", mensalidadeValor: 0, vencimentoDia: 10, ...PRECOS_PADRAO };
async function loadSettings() {
  let s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) s = await prisma.settings.create({ data: { id: 1 } });
  SETTINGS = {
    valorPadrao: s.valorPadrao,
    capacidadePadrao: s.capacidadePadrao,
    units: JSON.parse(s.units || "[]"),
    profs: JSON.parse(s.profs || "[]"),
    horarioFunc: s.horarioFunc || "",
    pixKey: s.pixKey || "",
    pixName: s.pixName || "",
    mensalidadeValor: s.mensalidadeValor ?? 0,
    vencimentoDia: s.vencimentoDia ?? 10,
    taxaMatricula: s.taxaMatricula ?? PRECOS_PADRAO.taxaMatricula,
    valorPlano1x: s.valorPlano1x ?? PRECOS_PADRAO.valorPlano1x,
    valorPlano2x: s.valorPlano2x ?? PRECOS_PADRAO.valorPlano2x,
    valorAvulsa: s.valorAvulsa ?? PRECOS_PADRAO.valorAvulsa,
    duracaoAulaMin: s.duracaoAulaMin ?? PRECOS_PADRAO.duracaoAulaMin,
  };
  return SETTINGS;
}

// Preços derivados do plano do aluno
const valorDoPlano = (freq) => (Number(freq) === 2 ? SETTINGS.valorPlano2x : SETTINGS.valorPlano1x);
// Fim da aula ('HH:MM'), a partir do início + duração configurada
function fimDaAula(time, dur = SETTINGS.duracaoAulaMin) {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m + (dur || 0);
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
// Duas aulas de mesma unidade/dia se sobrepõem? (compara em minutos)
function haChoque(timeA, timeB, dur = SETTINGS.duracaoAulaMin) {
  const min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const a = min(timeA), b = min(timeB);
  return a < b + dur && b < a + dur;
}

/* ---------- estado completo (usado pelo frontend) ---------- */
app.get(
  "/api/state",
  wrap(async (req, res) => {
    const [clients, slots, bookings, invoices, makeups] = await Promise.all([
      prisma.client.findMany({ orderBy: { name: "asc" } }),
      prisma.slot.findMany({ include: { waitlist: true }, orderBy: [{ date: "asc" }, { time: "asc" }] }),
      prisma.booking.findMany({ orderBy: [{ date: "asc" }, { time: "asc" }] }),
      prisma.invoice.findMany({ orderBy: [{ competencia: "desc" }, { createdAt: "desc" }] }),
      prisma.makeupCredit.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    res.json({
      meta: { ...SETTINGS },
      clients: clients.map(({ pin, ...c }) => ({ ...c, tags: parseTags(c.tags), hasPin: !!pin })),
      slots,
      bookings,
      invoices,
      makeups,
    });
  })
);

/* ---------- SLOTS ---------- */
app.post(
  "/api/slots",
  wrap(async (req, res) => {
    const { unit, prof, date, time, capacity, weeks, dates, baseSlotId } = req.body;
    if (!unit || !time) return res.status(400).json({ error: "unit e time são obrigatórios" });
    const cap = Math.max(1, parseInt(capacity, 10) || SETTINGS.capacidadePadrao);
    // O frontend pode mandar uma lista de datas já calculada (criação com dias
    // da semana / replicação). Como fallback, usa date + weeks (repetição semanal).
    let targets = [];
    if (Array.isArray(dates) && dates.length) {
      targets = dates;
    } else {
      if (!date) return res.status(400).json({ error: "date é obrigatório" });
      const n = Math.max(1, parseInt(weeks, 10) || 1);
      for (let i = 0; i < n; i++) targets.push(addDays(date, i * 7));
    }
    // normaliza: só 'YYYY-MM-DD' válidas, sem duplicatas, em ordem
    targets = [...new Set(targets.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    // Cadastro replicado: horários criados juntos ganham um seriesId em comum,
    // para a exclusão poder oferecer "excluir também os demais". Na replicação de
    // um horário existente (baseSlotId), o horário original entra na mesma série.
    const base = baseSlotId ? await prisma.slot.findUnique({ where: { id: Number(baseSlotId) } }) : null;
    let seriesId = base?.seriesId || null;
    if (!seriesId && (targets.length > 1 || base)) {
      seriesId = crypto.randomUUID();
      if (base) await prisma.slot.update({ where: { id: base.id }, data: { seriesId } });
    }
    // As aulas duram SETTINGS.duracaoAulaMin: duas turmas na mesma unidade não
    // podem se sobrepor (ex.: 09:00 e 10:00 com aula de 2h).
    const created = [], conflitos = [];
    for (const d of targets) {
      const doDia = await prisma.slot.findMany({ where: { date: d, unit } });
      if (doDia.some((s) => s.time === time)) continue; // duplicado exato: ignora em silêncio
      const choque = doDia.find((s) => haChoque(s.time, time));
      if (choque) {
        conflitos.push({ date: d, time, conflitaCom: choque.time });
        continue;
      }
      const slot = await prisma.slot.create({
        data: { unit, prof: prof || profFor(unit), date: d, time, capacity: cap, seriesId },
      });
      created.push(slot);
    }
    res.json({ created, conflitos });
  })
);

app.patch(
  "/api/slots/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cap = Math.max(1, parseInt(req.body.capacity, 10) || 1);
    const occ = await occupancy(id);
    if (cap < occ) return res.status(400).json({ error: `Capacidade (${cap}) menor que as ${occ} reservas existentes.` });
    const slot = await prisma.slot.update({ where: { id }, data: { capacity: cap } });
    res.json(slot);
  })
);

app.delete(
  "/api/slots/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const slot = await prisma.slot.findUnique({ where: { id } });
    if (!slot) return res.json({ ok: true, deleted: 0 });
    // ?series=1: exclui também os demais horários da mesma série (replicados),
    // de hoje em diante — horários passados ficam para preservar o histórico.
    if (req.query.series === "1" && slot.seriesId) {
      const r = await prisma.slot.deleteMany({
        where: { seriesId: slot.seriesId, OR: [{ id }, { date: { gte: todayISO() } }] },
      });
      return res.json({ ok: true, deleted: r.count });
    }
    await prisma.slot.delete({ where: { id } });
    res.json({ ok: true, deleted: 1 });
  })
);

/* ---------- horários disponíveis (público, p/ fluxo de primeira aula) ---------- */
app.get(
  "/api/slots/available",
  wrap(async (req, res) => {
    const t = todayISO();
    const unit = req.query.unit;
    const [slots, bookings] = await Promise.all([
      prisma.slot.findMany(),
      prisma.booking.findMany({ where: { status: { not: "cancelada" } } }),
    ]);
    const occ = {};
    bookings.forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });
    const available = slots
      .filter((s) => s.date >= t && (!unit || s.unit === unit) && (occ[s.id] || 0) < s.capacity)
      .map((s) => ({ id: s.id, date: s.date, time: s.time, unit: s.unit, prof: s.prof, vagas: s.capacity - (occ[s.id] || 0) }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    res.json({ available, meta: { units: SETTINGS.units, valorPadrao: SETTINGS.valorPadrao, pixKey: SETTINGS.pixKey, pixName: SETTINGS.pixName } });
  })
);

/* ---------- BOOKINGS ---------- */
async function ensureClient(name, phone, unit, tags, cpf, email, firstClass) {
  const found = await prisma.client.findFirst({ where: { name } });
  if (found) {
    // se o cliente já existe mas ainda não tem CPF/email, completa com o informado
    const patch = {};
    if (cpf && !found.cpf) patch.cpf = onlyDigits(cpf);
    if (email && !found.email) patch.email = email.trim();
    if (firstClass && !found.firstClass) patch.firstClass = true;
    if (Object.keys(patch).length) return prisma.client.update({ where: { id: found.id }, data: patch });
    return found;
  }
  return prisma.client.create({
    data: { name, phone: phone || "", email: (email || "").trim() || null, cpf: onlyDigits(cpf) || null, unit, tags: JSON.stringify(tags || []), firstClass: !!firstClass },
  });
}

app.post(
  "/api/bookings",
  wrap(async (req, res) => {
    const b = req.body;
    if (!b.clientName) return res.status(400).json({ error: "clientName é obrigatório" });
    const unit = b.unit || UNITS[0];
    const date = b.date || todayISO();
    const time = b.time || "09:00";

    let slot = b.slotId
      ? await prisma.slot.findUnique({ where: { id: Number(b.slotId) } })
      : await prisma.slot.findFirst({ where: { date, time, unit } });

    if (slot) {
      const occ = await occupancy(slot.id);
      if (occ >= slot.capacity) return res.status(409).json({ error: "Turma lotada." });
    } else {
      slot = await prisma.slot.create({
        data: { date, time, unit, prof: b.prof || profFor(unit), capacity: SETTINGS.capacidadePadrao },
      });
    }

    // Aula experimental: a aula em si é gratuita — o que se cobra é a taxa de
    // matrícula, devolvida se a aluna não continuar e aproveitada se continuar.
    const experimental = !!b.firstClass;
    const booking = await prisma.booking.create({
      data: {
        clientName: b.clientName,
        phone: b.phone || "",
        unit,
        date: slot.date,
        time: slot.time,
        prof: slot.prof,
        slotId: slot.id,
        status: "aguardando",
        value: experimental ? SETTINGS.taxaMatricula : (Number(b.value) || SETTINGS.valorPadrao),
        paymentMethod: experimental ? "Matrícula" : null,
      },
    });
    const client = await ensureClient(b.clientName, b.phone, unit, [], b.cpf, b.email, b.firstClass);
    if (experimental && client) {
      await prisma.client.update({
        where: { id: client.id },
        data: { matriculaStatus: "pendente", trialDate: slot.date },
      });
    }
    res.json(booking);
  })
);

app.patch(
  "/api/bookings/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await prisma.booking.findUnique({ where: { id } });
    if (!cur) return res.status(404).json({ error: "Marcação não encontrada" });
    const data = {};
    for (const k of ["status", "attendance", "date", "time", "paymentMethod", "paymentDate"])
      if (req.body[k] !== undefined) data[k] = req.body[k];
    if (req.body.value !== undefined) data.value = Number(req.body.value) || cur.value;
    if (req.body.paid !== undefined) data.paid = !!req.body.paid;
    // mover a reserva para outro horário (usado no fluxo da 1ª aula)
    if (req.body.slotId !== undefined && Number(req.body.slotId) !== cur.slotId) {
      const ns = await prisma.slot.findUnique({ where: { id: Number(req.body.slotId) } });
      if (!ns) return res.status(404).json({ error: "Horário não encontrado" });
      const occ = await occupancy(ns.id);
      if (occ >= ns.capacity) return res.status(409).json({ error: "Turma lotada." });
      data.slotId = ns.id; data.date = ns.date; data.time = ns.time; data.unit = ns.unit; data.prof = ns.prof;
    }
    // presente → conclui a aula
    if (data.attendance === "presente" && (data.status || cur.status) !== "cancelada") data.status = "concluida";
    // confirmada sem pagamento → marca paga
    if ((data.status || cur.status) === "confirmada" && !(data.paid ?? cur.paid)) {
      data.paid = true;
      data.paymentMethod = data.paymentMethod || cur.paymentMethod || "Pix";
      data.paymentDate = data.paymentDate || cur.paymentDate || todayISO();
    }
    const booking = await prisma.booking.update({ where: { id }, data });
    // cancelar uma reposição devolve o crédito para a aluna
    if (data.status === "cancelada" && cur.status !== "cancelada" && cur.paymentMethod === "Reposição")
      await devolverCredito(id);
    res.json(booking);
  })
);

app.delete(
  "/api/bookings/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const bk = await prisma.booking.findUnique({ where: { id } });
    if (!bk) return res.json({ ok: true, deleted: 0 });
    // ?series=1: exclui também as demais aulas da mesma marcação replicada,
    // de hoje em diante — aulas passadas ficam para preservar o histórico.
    if (req.query.series === "1" && bk.seriesId) {
      const where = { seriesId: bk.seriesId, OR: [{ id }, { date: { gte: todayISO() } }] };
      const alvos = await prisma.booking.findMany({ where, select: { id: true } });
      const r = await prisma.booking.deleteMany({ where });
      for (const a of alvos) await devolverCredito(a.id); // reposição excluída devolve o crédito
      return res.json({ ok: true, deleted: r.count });
    }
    await prisma.booking.delete({ where: { id } });
    await devolverCredito(id);
    res.json({ ok: true, deleted: 1 });
  })
);

// Marca a taxa de matrícula como paga quando a reserva da experimental é quitada.
async function registrarMatriculaPaga(booking) {
  if (booking.paymentMethod !== "Matrícula") return;
  const c = await prisma.client.findFirst({ where: { name: booking.clientName } });
  if (!c || c.matriculaStatus !== "pendente") return;
  await prisma.client.update({
    where: { id: c.id },
    data: { matriculaStatus: "paga", matriculaAt: booking.paymentDate || todayISO() },
  });
}

app.post(
  "/api/bookings/:id/pay",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await prisma.booking.findUnique({ where: { id } });
    const booking = await prisma.booking.update({
      where: { id },
      data: {
        paid: true,
        status: "confirmada",
        // a experimental mantém a marca "Matrícula" para o dinheiro não virar aula
        paymentMethod: cur?.paymentMethod === "Matrícula" ? "Matrícula" : (req.body.paymentMethod || "Pix"),
        paymentDate: req.body.paymentDate || todayISO(),
        ...(req.body.value !== undefined ? { value: Number(req.body.value) } : {}),
      },
    });
    await registrarMatriculaPaga(booking);
    res.json(booking);
  })
);

/* ---------- COBRANÇA VIA CORA (Pix com confirmação automática) ---------- */
// Extração defensiva do retorno da Cora — os nomes exatos dos campos precisam
// ser confirmados no primeiro teste em stage; por isso cobrimos várias formas.
const extractPix = (inv) =>
  inv?.pix?.emv || inv?.pix?.qr_code || inv?.payment?.pix?.emv ||
  inv?.qr_code?.emv || (typeof inv?.qr_code === "string" ? inv.qr_code : null) || inv?.emv || null;
const extractBoletoUrl = (inv) =>
  inv?.payment_options?.bank_slip?.url || inv?.bank_slip?.url || inv?.pdf || inv?.url || inv?.link || null;
const isPaidStatus = (s) => ["PAID", "SETTLED", "PAYED", "CONFIRMED", "RECEIVED"].includes(String(s || "").toUpperCase());
async function clientCpfByName(name) {
  if (!name) return "";
  const c = await prisma.client.findFirst({ where: { name } });
  return (c?.cpf || "").replace(/\D/g, "");
}

// Gera (ou reaproveita) a cobrança Pix de uma reserva
app.post(
  "/api/bookings/:id/invoice",
  wrap(async (req, res) => {
    if (!coraConfigured()) return res.status(400).json({ error: "Cora não configurada no servidor (falta certificado + client_id)." });
    const id = Number(req.params.id);
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: "Marcação não encontrada" });
    if (booking.coraInvoiceId) {
      return res.json({ invoiceId: booking.coraInvoiceId, pixCode: booking.pixCode, boletoUrl: booking.boletoUrl, reused: true });
    }
    const cpf = (req.body.cpf || "").replace(/\D/g, "") || (await clientCpfByName(booking.clientName));
    if (!cpf) return res.status(400).json({ error: "CPF do pagador é obrigatório. Cadastre o CPF da aluna antes de gerar a cobrança." });
    const amountCents = Math.round((booking.value || SETTINGS.valorPadrao) * 100);
    const inv = await createInvoice({
      code: `fqc-booking-${id}`,
      name: req.body.name || booking.clientName,
      cpf,
      email: req.body.email || undefined,
      amountCents,
      dueDate: req.body.dueDate || addDays(todayISO(), 2),
      description: `Reserva de aula — ${booking.unit} · ${booking.date} ${booking.time}`,
    });
    const invoiceId = inv?.id || inv?.invoice_id || null;
    const pixCode = extractPix(inv);
    const boletoUrl = extractBoletoUrl(inv);
    await prisma.booking.update({
      where: { id },
      data: {
        coraInvoiceId: invoiceId ? String(invoiceId) : booking.coraInvoiceId,
        pixCode: pixCode || booking.pixCode,
        boletoUrl: boletoUrl || booking.boletoUrl,
      },
    });
    res.json({ invoiceId, pixCode, boletoUrl });
  })
);

// Webhook da Cora — apenas um GATILHO. A verdade vem de getInvoice (chamada mTLS
// autenticada à Cora), então um webhook forjado não confirma nada sozinho.
app.post(
  "/api/cora/webhook",
  wrap(async (req, res) => {
    const b = req.body || {};
    const invoiceId = b?.resource?.id || b?.invoice?.id || b?.data?.id || b?.id || b?.invoice_id || null;
    const code = b?.resource?.code || b?.invoice?.code || b?.code || null;
    if (coraConfigured() && invoiceId) {
      const inv = await getInvoice(invoiceId);
      if (isPaidStatus(inv?.status)) {
        const realId = String(inv?.id || invoiceId);
        let booking = await prisma.booking.findFirst({ where: { coraInvoiceId: realId } });
        if (!booking && code) {
          const m = String(code).match(/^fqc-booking-(\d+)$/);
          if (m) booking = await prisma.booking.findUnique({ where: { id: Number(m[1]) } });
        }
        if (booking && !booking.paid) {
          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              paid: true, status: "confirmada", paymentDate: todayISO(),
              paymentMethod: booking.paymentMethod === "Matrícula" ? "Matrícula" : "Pix",
            },
          });
          await registrarMatriculaPaga({ ...booking, paymentDate: todayISO() });
          console.log(`[cora] pagamento confirmado — reserva ${booking.id}`);
        }
        // mensalidade? (código fqc-mensalidade-<clientId>-<YYYY-MM>)
        let invoice = await prisma.invoice.findFirst({ where: { coraInvoiceId: realId } });
        if (!invoice && code) {
          const mm = String(code).match(/^fqc-mensalidade-(\d+)-(\d{4}-\d{2})$/);
          if (mm) invoice = await prisma.invoice.findFirst({ where: { clientId: Number(mm[1]), competencia: mm[2] } });
        }
        if (invoice && invoice.status !== "pago") {
          await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "pago", paidAt: todayISO() } });
          console.log(`[cora] mensalidade confirmada — invoice ${invoice.id}`);
        }
      }
    }
    res.json({ ok: true });
  })
);

/* ---------- MENSALIDADES (mensalistas) ---------- */
const competenciaAtual = () => todayISO().slice(0, 7); // 'YYYY-MM'
// Valor efetivo da mensalidade, na ordem: valor individual → plano 1x/2x →
// valor padrão legado das Configurações (alunos cadastrados antes dos planos).
const mensalidadeValorDe = (c) => {
  if (c.monthlyValue != null) return c.monthlyValue || 0;
  if (c.weeklyFreq) return valorDoPlano(c.weeklyFreq) || 0;
  return SETTINGS.mensalidadeValor || 0;
};
// Vencimento do boleto de uma competência. Nunca devolve data no passado: quem
// se matricula depois do dia de vencimento teria a 1ª mensalidade nascendo
// vencida — e entraria em atraso (perdendo a reposição) sem dever nada.
const vencimentoDe = (c, comp = competenciaAtual()) => {
  const dia = Math.min(28, Math.max(1, c.billingDay || SETTINGS.vencimentoDia || 10));
  const [y, m] = comp.split("-").map(Number);
  const venc = `${y}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const hoje = todayISO();
  return venc < hoje ? hoje : venc;
};

// Gera (ou reaproveita) o boleto da mensalidade de um aluno para uma competência
async function gerarMensalidade(clientId, competencia) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw Object.assign(new Error("Aluno não encontrado"), { code: 404 });
  if (client.plan !== "mensalista") throw Object.assign(new Error("Aluno não é mensalista"), { code: 400 });
  const comp = competencia || competenciaAtual();
  // já existe para essa competência? reaproveita
  const existing = await prisma.invoice.findFirst({ where: { clientId, competencia: comp } });
  if (existing) return existing;
  const valor = mensalidadeValorDe(client);
  if (!valor) throw Object.assign(new Error("Defina o valor da mensalidade (no aluno ou nas Configurações)."), { code: 400 });
  const dueDate = vencimentoDe(client, comp);
  let coraInvoiceId = null, pixCode = null, boletoUrl = null;
  if (coraConfigured()) {
    const cpf = (client.cpf || "").replace(/\D/g, "");
    if (!cpf) throw Object.assign(new Error("Cadastre o CPF do aluno antes de gerar o boleto."), { code: 400 });
    // Se a Cora falhar, a mensalidade ainda precisa existir aqui — senão a aluna
    // fica sem cobrança nenhuma. Fica sem Pix/boleto e a tela oferece gerar de novo.
    try {
      const inv = await createInvoice({
        code: `fqc-mensalidade-${clientId}-${comp}`,
        name: client.name,
        cpf,
        email: client.email || undefined,
        amountCents: Math.round(valor * 100),
        dueDate,
        description: `Mensalidade ${comp} — Fios que Curam`,
      });
      coraInvoiceId = (inv?.id || inv?.invoice_id || null);
      coraInvoiceId = coraInvoiceId ? String(coraInvoiceId) : null;
      pixCode = extractPix(inv);
      boletoUrl = extractBoletoUrl(inv);
    } catch (e) {
      console.warn(`[mensalidade] Cora falhou para ${client.name} (${comp}): ${e.message}. Boleto registrado sem Pix.`);
    }
  }
  return prisma.invoice.create({
    data: { clientId, competencia: comp, amountCents: Math.round(valor * 100), dueDate, status: "pendente", coraInvoiceId, pixCode, boletoUrl },
  });
}

// Gerar boleto da mensalidade (manual) — body opcional { competencia: 'YYYY-MM' }
app.post("/api/clients/:id/invoice", wrap(async (req, res) => {
  try {
    const inv = await gerarMensalidade(Number(req.params.id), req.body?.competencia);
    res.json(inv);
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message });
  }
}));

// Marcar mensalidade como paga (manual)
app.post("/api/invoices/:id/pay", wrap(async (req, res) => {
  const inv = await prisma.invoice.update({
    where: { id: Number(req.params.id) },
    data: { status: "pago", paidAt: req.body?.paidAt || todayISO() },
  });
  res.json(inv);
}));

// Cancelar mensalidade
app.post("/api/invoices/:id/cancel", wrap(async (req, res) => {
  const inv = await prisma.invoice.update({ where: { id: Number(req.params.id) }, data: { status: "cancelado" } });
  res.json(inv);
}));

// Gerar boletos de TODOS os mensalistas ativos para a competência atual (usado no botão "gerar todos" e no automático)
async function gerarMensalidadesDoMes() {
  const comp = competenciaAtual();
  const mensalistas = await prisma.client.findMany({ where: { plan: "mensalista" } });
  const feitas = [];
  for (const c of mensalistas) {
    try { feitas.push(await gerarMensalidade(c.id, comp)); } catch (e) { console.warn(`[mensalidade] ${c.name}: ${e.message}`); }
  }
  return feitas;
}
app.post("/api/invoices/gerar-mes", wrap(async (_req, res) => {
  const feitas = await gerarMensalidadesDoMes();
  res.json({ geradas: feitas.length });
}));

// Automático: 1x/dia verifica se é o dia de vencimento padrão e gera as mensalidades do mês
let ultimoDiaGeracao = null;
setInterval(async () => {
  try {
    const hoje = todayISO();
    const diaHoje = new Date(hoje + "T00:00").getDate();
    if (diaHoje === (SETTINGS.vencimentoDia || 10) && ultimoDiaGeracao !== hoje) {
      ultimoDiaGeracao = hoje;
      const feitas = await gerarMensalidadesDoMes();
      if (feitas.length) console.log(`[mensalidade] ${feitas.length} boleto(s) do mês gerados automaticamente.`);
    }
  } catch (e) { console.warn("[mensalidade auto]", e.message); }
}, 60 * 60 * 1000); // a cada hora

/* ---------- PORTAL DO ALUNO ---------- */
// Localiza o aluno pela "chave" usada no portal: CPF, telefone (dígitos) ou id.
async function clientByPortalKey(key) {
  const d = onlyDigits(key);
  const clients = await prisma.client.findMany();
  return (
    clients.find((c) => (c.cpf && onlyDigits(c.cpf) === d) || (c.phone && onlyDigits(c.phone) === d)) ||
    (Number(key) ? clients.find((c) => c.id === Number(key)) : null) ||
    null
  );
}
const safeClient = (c) => { const { pin, ...rest } = c; return { ...rest, tags: parseTags(c.tags), hasPin: !!pin }; };

// Dados do aluno: cadastro, aulas e horários disponíveis para marcar
app.get("/api/portal/:key", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const t = todayISO();
  const [bookings, slots, ativas] = await Promise.all([
    prisma.booking.findMany({ where: { clientName: client.name }, orderBy: [{ date: "asc" }, { time: "asc" }] }),
    prisma.slot.findMany({ where: { date: { gte: t } }, orderBy: [{ date: "asc" }, { time: "asc" }] }),
    prisma.booking.findMany({ where: { status: { not: "cancelada" } } }),
  ]);
  const occ = {}; ativas.forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });
  const available = slots
    .filter((s) => (occ[s.id] || 0) < (s.capacity || 1))
    .map((s) => ({ ...s, occupancy: occ[s.id] || 0, free: (s.capacity || 1) - (occ[s.id] || 0) }));
  const makeup = await resumoReposicao(client);
  res.json({ client: safeClient(client), bookings, available, makeup, meta: { units: SETTINGS.units, valorPadrao: SETTINGS.valorPadrao, pixKey: SETTINGS.pixKey, pixName: SETTINGS.pixName } });
}));

// Converter em mensalista pelo portal (usado no tablet da sala, ao fim da experimental)
app.post("/api/portal/:key/enroll", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try { res.json(await converterEmMensalista(client, req.body || {})); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
}));

// Marcar aula. { reposicao: true } consome crédito; { extra: true } é aula
// avulsa paga (não mexe no saldo de reposição — são coisas separadas).
app.post("/api/portal/:key/book", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  if (req.body.reposicao) {
    try {
      return res.json(await marcarReposicao(client, req.body.slotId));
    } catch (e) {
      return res.status(e.code || 500).json({ error: e.message });
    }
  }
  if (req.body.extra) {
    try {
      return res.json(await marcarAulaExtra(client, req.body.slotId));
    } catch (e) {
      return res.status(e.code || 500).json({ error: e.message });
    }
  }
  const slot = await prisma.slot.findUnique({ where: { id: Number(req.body.slotId) } });
  if (!slot) return res.status(404).json({ error: "Horário não encontrado." });
  const dup = await prisma.booking.findFirst({ where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } } });
  if (dup) return res.status(400).json({ error: "Você já tem essa aula marcada." });
  if ((await occupancy(slot.id)) >= (slot.capacity || 1)) return res.status(400).json({ error: "Turma lotada." });
  const mensalista = client.plan === "mensalista";
  const booking = await prisma.booking.create({
    data: {
      clientName: client.name, phone: client.phone || "", unit: slot.unit, date: slot.date, time: slot.time, prof: slot.prof || profFor(slot.unit),
      slotId: slot.id,
      status: mensalista ? "confirmada" : "aguardando",
      value: mensalista ? 0 : SETTINGS.valorPadrao,
      paid: false,
      paymentMethod: mensalista ? "Mensalista" : null,
    },
  });
  res.json(booking);
}));

// Libera a vaga da aula e, se couber, gera o crédito de reposição.
// Cancelar a própria aula de reposição devolve o crédito em vez de gerar outro.
async function liberarAula(client, b, extra = {}) {
  await prisma.booking.update({ where: { id: b.id }, data: { status: "cancelada", ...extra } });
  if (b.paymentMethod === "Reposição") {
    const devolvido = await devolverCredito(b.id);
    return {
      credito: false,
      devolvido: !!devolvido,
      motivo: devolvido ? "Crédito de reposição devolvido para você." : "",
    };
  }
  const { credito, motivo } = await concederCredito(client, b);
  return { credito: !!credito, devolvido: false, motivo };
}

// Cancelar aula (libera a vaga)
app.post("/api/portal/:key/cancel/:bookingId", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const b = await prisma.booking.findUnique({ where: { id: Number(req.params.bookingId) } });
  if (!b || b.clientName !== client.name) return res.status(404).json({ error: "Aula não encontrada." });
  const r = await liberarAula(client, b);
  res.json({ ok: true, ...r });
}));

// "Não poderei ir" — registra o aviso/motivo e libera a vaga
app.post("/api/portal/:key/absence/:bookingId", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const b = await prisma.booking.findUnique({ where: { id: Number(req.params.bookingId) } });
  if (!b || b.clientName !== client.name) return res.status(404).json({ error: "Aula não encontrada." });
  const r = await liberarAula(client, b, { absenceReason: String(req.body.reason || "").slice(0, 500) });
  res.json({ ok: true, ...r });
}));

/* ===================== MATRÍCULA E CONVERSÃO =====================
   Fluxo combinado com a Inêz:
   - Para agendar a experimental, a aluna paga só a taxa de matrícula.
     A aula em si é gratuita.
   - Fez e não gostou → a taxa é devolvida (status "devolvida").
   - Quis continuar → a taxa vira a matrícula (status "convertida"), ela
     escolhe o plano (1x ou 2x por semana), paga a 1ª mensalidade e agenda
     a 1ª aula oficial. Dali em diante os boletos saem todo mês. */

// Converte a aluna em mensalista: define o plano, gera a 1ª mensalidade e
// (se veio slotId) agenda a 1ª aula oficial. Lança { code } em caso de erro.
async function converterEmMensalista(client, { weeklyFreq, slotId, billingDay }) {
  const freq = Number(weeklyFreq) === 2 ? 2 : 1;
  if (client.plan === "mensalista" && client.weeklyFreq)
    throw Object.assign(new Error("Esta aluna já é mensalista."), { code: 409 });

  // 1ª aula oficial (opcional aqui — pode ser agendada depois)
  let booking = null;
  if (slotId) {
    const slot = await prisma.slot.findUnique({ where: { id: Number(slotId) } });
    if (!slot) throw Object.assign(new Error("Horário não encontrado."), { code: 404 });
    if (slot.date < todayISO()) throw Object.assign(new Error("Escolha uma aula futura."), { code: 400 });
    if ((await occupancy(slot.id)) >= (slot.capacity || 1))
      throw Object.assign(new Error("Turma lotada — escolha outro horário."), { code: 409 });
    booking = await prisma.booking.create({
      data: {
        clientName: client.name, phone: client.phone || "", unit: slot.unit,
        date: slot.date, time: slot.time, prof: slot.prof || profFor(slot.unit),
        slotId: slot.id, status: "confirmada", value: 0, paid: true, paymentMethod: "Mensalista",
        paymentDate: todayISO(),
      },
    });
  }

  // A taxa paga vira matrícula; quem não pagou entra como isenta.
  const virouMatricula = client.matriculaStatus === "paga" || client.matriculaStatus === "convertida";
  const atualizado = await prisma.client.update({
    where: { id: client.id },
    data: {
      plan: "mensalista",
      status: "ativo",
      weeklyFreq: freq,
      firstClass: false, // deixou de ser aluna nova/experimental
      monthlyValue: null, // passa a seguir a tabela do plano
      ...(billingDay ? { billingDay: Math.min(28, Math.max(1, parseInt(billingDay, 10))) } : {}),
      ...(virouMatricula ? { matriculaStatus: "convertida" } : {}),
    },
  });

  // 1ª mensalidade
  let invoice = null;
  try { invoice = await gerarMensalidade(atualizado.id); }
  catch (e) { console.warn(`[conversao] ${atualizado.name}: ${e.message}`); }

  return { client: safeClient(atualizado), booking, invoice, valorMensal: mensalidadeValorDe(atualizado) };
}

// Converter pelo painel — body { weeklyFreq, slotId?, billingDay? }
app.post("/api/clients/:id/enroll", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try { res.json(await converterEmMensalista(client, req.body || {})); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
}));

// Marcar a taxa de matrícula como devolvida (aluna não continuou)
app.post("/api/clients/:id/matricula/refund", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  if (client.matriculaStatus === "convertida")
    return res.status(409).json({ error: "A taxa virou matrícula — não há o que devolver." });
  if (client.matriculaStatus !== "paga")
    return res.status(409).json({ error: "A taxa de matrícula não consta como paga." });
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { matriculaStatus: "devolvida", matriculaRefundAt: req.body?.date || todayISO() },
  });
  res.json(safeClient(updated));
}));

// Saldo/histórico de reposição (admin)
app.get("/api/clients/:id/makeup", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  res.json(await resumoReposicao(client));
}));

// Marcar aula extra avulsa pelo painel (admin) — body { slotId }
app.post("/api/clients/:id/extra-book", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try { res.json(await marcarAulaExtra(client, req.body?.slotId)); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
}));

// Marcar reposição pelo painel (admin) — body { slotId }
app.post("/api/clients/:id/makeup-book", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try {
    res.json(await marcarReposicao(client, req.body?.slotId));
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message });
  }
}));

// Liberar a aula pelo painel, aplicando as mesmas regras de crédito do portal
app.post("/api/bookings/:id/release", wrap(async (req, res) => {
  const b = await prisma.booking.findUnique({ where: { id: Number(req.params.id) } });
  if (!b) return res.status(404).json({ error: "Aula não encontrada." });
  const client = await prisma.client.findFirst({ where: { name: b.clientName } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const r = await liberarAula(client, b, { absenceReason: String(req.body?.reason || "").slice(0, 500) });
  res.json({ ok: true, ...r });
}));

/* ---------- AGENDAMENTO EM LOTE (mensalista) ---------- */
// Agenda o aluno em várias turmas de uma vez, só nos horários JÁ existentes,
// respeitando a capacidade. Body: { unit, time, dates: ['YYYY-MM-DD', ...] }
app.post("/api/clients/:id/batch-book", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado" });
  const { unit, time } = req.body || {};
  const dates = Array.isArray(req.body?.dates) ? req.body.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  if (!unit || !time || !dates.length) return res.status(400).json({ error: "Informe unidade, horário e ao menos uma data." });

  // Marcação replicada: as aulas criadas na mesma leva ganham um seriesId em
  // comum, para a exclusão poder oferecer "excluir também as demais".
  const seriesId = new Set(dates).size > 1 ? crypto.randomUUID() : null;
  const agendadas = [], pulos = { semTurma: 0, cheia: 0, jaAgendado: 0 };
  for (const date of [...new Set(dates)].sort()) {
    const slot = await prisma.slot.findFirst({ where: { date, time, unit } });
    if (!slot) { pulos.semTurma++; continue; }
    // já agendado nesta turma?
    const jaTem = await prisma.booking.findFirst({ where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } } });
    if (jaTem) { pulos.jaAgendado++; continue; }
    // capacidade
    if ((await occupancy(slot.id)) >= (slot.capacity || 1)) { pulos.cheia++; continue; }
    const b = await prisma.booking.create({
      data: {
        clientName: client.name, phone: client.phone || "", unit, date, time, prof: slot.prof || profFor(unit),
        slotId: slot.id, seriesId, status: "confirmada", value: 0, paid: false, paymentMethod: "Mensalista",
      },
    });
    agendadas.push(b);
  }
  res.json({ agendadas: agendadas.length, pulos });
}));

/* ---------- WHATSAPP (Cloud API) ---------- */
// Verificação do webhook (a Meta chama com GET ao registrar a URL)
app.get("/api/wa/webhook", (req, res) => {
  const challenge = waVerify(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
  if (challenge) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// Recebe mensagens e conduz o fluxo de agendamento.
const waSeen = new Set(); // dedupe simples de message ids (a Meta reenvia)
app.post("/api/wa/webhook", async (req, res) => {
  res.sendStatus(200); // ACK imediato — a Meta exige resposta rápida
  try {
    const msg = parseIncoming(req.body);
    if (!msg || waSeen.has(msg.id)) return;
    waSeen.add(msg.id);
    if (waSeen.size > 2000) waSeen.clear();
    console.log(`[wa] recebido de ${msg.from} (${msg.name}): "${msg.text}"`);
    if (!waConfigured()) return;
    await handleWaMessage(msg);
  } catch (e) {
    console.error("[wa webhook]", e.message, e.body || "");
  }
});

/* ---------- Fluxo de agendamento pelo WhatsApp ---------- */
const DOW_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function fmtSlotBR(s) {
  const d = new Date(s.date + "T00:00");
  const [, m, day] = s.date.split("-");
  return `${DOW_PT[d.getDay()]} ${day}/${m} às ${s.time}`;
}
async function waSend(to, text) {
  try { await sendWaText(to, text); console.log(`[wa] respondido para ${to}`); }
  catch (e) { console.error("[wa send]", e.message, e.body || ""); }
}
async function waButtons(to, body, buttons) {
  try { await sendWaButtons(to, body, buttons); console.log(`[wa] botões para ${to}`); }
  catch (e) { console.error("[wa send]", e.message, e.body || ""); }
}
async function waList(to, body, buttonText, rows) {
  try { await sendWaList(to, body, buttonText, rows); console.log(`[wa] lista para ${to}`); }
  catch (e) { console.error("[wa send]", e.message, e.body || ""); }
}
// menu de unidades: botões se couber (≤3), senão lista
async function sendUnitMenu(to, body) {
  const us = SETTINGS.units;
  if (us.length <= 3) return waButtons(to, body, us.map((u) => ({ id: "unit:" + u, title: u })));
  return waList(to, body, "Escolher unidade", us.map((u) => ({ id: "unit:" + u, title: u })));
}
const unitsMenu = () => SETTINGS.units.map((u, i) => `${i + 1}️⃣ ${u}`).join("\n");
function parseUnitChoice(body) {
  const us = SETTINGS.units;
  const n = parseInt(body, 10);
  if (n >= 1 && n <= us.length) return us[n - 1];
  const low = body.toLowerCase();
  return us.find((u) => low.includes(u.toLowerCase())) || null;
}
async function waAvailableSlots(unit) {
  const t = todayISO();
  const [slots, bookings] = await Promise.all([
    prisma.slot.findMany(),
    prisma.booking.findMany({ where: { status: { not: "cancelada" } } }),
  ]);
  const occ = {};
  bookings.forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });
  return slots
    .filter((s) => s.date >= t && s.unit === unit && (occ[s.id] || 0) < s.capacity)
    .map((s) => ({ ...s, vagas: s.capacity - (occ[s.id] || 0) }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function bookingConfirmText(name, slot) {
  return `Prontinho, ${name.split(" ")[0]}! 💚\n\nSua aula está *reservada*:\n📍 ${slot.unit}\n🗓️ ${fmtSlotBR(slot)}\n💰 R$ ${SETTINGS.valorPadrao}\n\nStatus: *aguardando pagamento*. Em breve enviaremos os detalhes para confirmar. Até logo! 🧶`;
}
async function createWaBooking(name, phone, slot) {
  await prisma.booking.create({
    data: {
      clientName: name, phone: phone || "", unit: slot.unit,
      date: slot.date, time: slot.time, prof: slot.prof, slotId: slot.id,
      status: "aguardando", value: SETTINGS.valorPadrao,
    },
  });
  await ensureClient(name, phone, slot.unit, ["Lead"], null);
}

async function handleWaMessage(msg) {
  const phone = normalizePhone(msg.from);
  const body = (msg.text || "").trim();
  const low = body.toLowerCase();
  let conv = await prisma.waConversation.findUnique({ where: { phone } });
  if (!conv) conv = await prisma.waConversation.create({ data: { phone } });

  const setConv = (data) => prisma.waConversation.update({ where: { phone }, data });
  const start = async (prefix = "") => {
    await setConv({ step: "unit", unit: null, slotId: null, offered: "[]" });
    const nome = msg.name ? " " + msg.name.split(" ")[0] : "";
    await sendUnitMenu(msg.from, `${prefix}Olá${nome}! 💚 Sou o assistente da *Fios que Curam*. Vamos agendar sua aula? Escolha a unidade:`);
  };

  // envia a lista tocável de horários de uma unidade
  const enviarHorarios = async (unit) => {
    const slots = await waAvailableSlots(unit);
    if (!slots.length) { await setConv({ step: "unit" }); return sendUnitMenu(msg.from, `No momento não há horários livres em *${unit}*. 😢 Quer ver a outra unidade?`); }
    const top = slots.slice(0, 10);
    const rows = top.map((s) => ({ id: "slot:" + s.id, title: fmtSlotBR(s), description: `${s.vagas} vaga(s)` }));
    await setConv({ step: "slot", unit, offered: JSON.stringify(top.map((s) => s.id)) });
    return waList(msg.from, `📅 Toque para escolher um horário em *${unit}*:`, "Ver horários", rows);
  };

  // Saudação / recomeço
  if (["menu", "oi", "olá", "ola", "agendar", "começar", "comecar", "início", "inicio"].includes(low) || conv.step === "start" || conv.step === "done") {
    return start();
  }

  if (conv.step === "unit") {
    const unit = msg.replyId?.startsWith("unit:") ? msg.replyId.slice(5) : parseUnitChoice(body);
    if (!unit || !SETTINGS.units.includes(unit)) return sendUnitMenu(msg.from, `Não entendi 🤔. Escolha a unidade:`);
    return enviarHorarios(unit);
  }

  if (conv.step === "slot") {
    const offered = JSON.parse(conv.offered || "[]");
    let slotId = null;
    if (msg.replyId?.startsWith("slot:")) slotId = parseInt(msg.replyId.slice(5), 10);
    else { const n = parseInt(body, 10); if (n >= 1 && n <= offered.length) slotId = offered[n - 1]; }
    if (!slotId) return waSend(msg.from, `Toque em *Ver horários* e escolha um da lista, ou digite *menu* para recomeçar.`);
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) return start("Esse horário não está mais disponível. ");
    const occ = await prisma.booking.count({ where: { slotId: slot.id, status: { not: "cancelada" } } });
    if (occ >= slot.capacity) return waSend(msg.from, `Ops, esse horário acabou de lotar. 😔 Digite *menu* para escolher outro.`);
    const client = await prisma.client.findFirst({ where: { phone } });
    if (client && client.name) {
      await createWaBooking(client.name, phone, slot);
      await setConv({ step: "done", slotId: null });
      return waSend(msg.from, bookingConfirmText(client.name, slot));
    }
    await setConv({ step: "name", slotId: slot.id });
    return waSend(msg.from, `Perfeito! Para confirmar, me diz seu *nome completo*, por favor. 💚`);
  }

  if (conv.step === "name") {
    const name = body.replace(/\s+/g, " ").trim();
    if (name.length < 2) return waSend(msg.from, `Me diz seu nome completo, por favor. 💚`);
    const slot = conv.slotId ? await prisma.slot.findUnique({ where: { id: conv.slotId } }) : null;
    if (!slot) return start("Esse horário expirou. ");
    const occ = await prisma.booking.count({ where: { slotId: slot.id, status: { not: "cancelada" } } });
    if (occ >= slot.capacity) return start("Esse horário lotou enquanto conversávamos. Vamos de novo. ");
    await createWaBooking(name, phone, slot);
    await setConv({ step: "done", slotId: null });
    return waSend(msg.from, bookingConfirmText(name, slot));
  }

  return start();
}

/* ---------- CLIENTS ---------- */
app.post(
  "/api/clients",
  wrap(async (req, res) => {
    const { name, phone, email, cpf, unit, tags, notes, birthday, level, firstClass, plan, monthlyValue, billingDay } = req.body;
    if (!name) return res.status(400).json({ error: "name é obrigatório" });
    const client = await prisma.client.create({
      data: {
        name, phone: phone || "", email: (email || "").trim() || null, cpf: onlyDigits(cpf) || null, unit: unit || UNITS[0], tags: JSON.stringify(tags || []), notes: notes || "",
        birthday: birthday || null, level: level || null, firstClass: !!firstClass,
        plan: plan === "mensalista" ? "mensalista" : "avulso",
        monthlyValue: monthlyValue === "" || monthlyValue == null ? null : Number(monthlyValue),
        billingDay: billingDay === "" || billingDay == null ? null : Math.min(28, Math.max(1, parseInt(billingDay, 10) || 0)) || null,
      },
    });
    res.json(client);
  })
);

app.patch(
  "/api/clients/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { name, phone, email, cpf, unit, tags, notes, birthday, level, firstClass, plan, status, monthlyValue, billingDay } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (email !== undefined) data.email = (email || "").trim() || null;
    if (cpf !== undefined) data.cpf = onlyDigits(cpf) || null;
    if (unit !== undefined) data.unit = unit;
    if (tags !== undefined) data.tags = JSON.stringify(tags);
    if (notes !== undefined) data.notes = notes;
    if (birthday !== undefined) data.birthday = birthday || null;
    if (level !== undefined) data.level = level || null;
    if (firstClass !== undefined) data.firstClass = !!firstClass;
    if (plan !== undefined) data.plan = plan === "mensalista" ? "mensalista" : "avulso";
    // "cancelado" = rompeu com o curso; perde o direito a reposição
    if (status !== undefined) data.status = status === "cancelado" ? "cancelado" : "ativo";
    if (monthlyValue !== undefined) data.monthlyValue = monthlyValue === "" || monthlyValue == null ? null : Number(monthlyValue);
    if (billingDay !== undefined) data.billingDay = billingDay === "" || billingDay == null ? null : Math.min(28, Math.max(1, parseInt(billingDay, 10) || 0)) || null;
    const client = await prisma.client.update({ where: { id }, data });
    res.json(client);
  })
);

app.delete(
  "/api/clients/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cli = await prisma.client.findUnique({ where: { id } });
    if (!cli) return res.json({ ok: true });
    // remove as aulas futuras e a lista de espera da pessoa; o histórico passado é mantido
    await prisma.booking.deleteMany({ where: { clientName: cli.name, date: { gte: todayISO() } } });
    await prisma.waitlist.deleteMany({ where: { name: cli.name } });
    await prisma.client.delete({ where: { id } }); // mensalidades caem junto (cascade)
    res.json({ ok: true });
  })
);

/* ---------- WAITLIST ---------- */
app.post(
  "/api/slots/:id/waitlist",
  wrap(async (req, res) => {
    const slotId = Number(req.params.id);
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: "name é obrigatório" });
    const entry = await prisma.waitlist.create({ data: { slotId, name, phone: phone || "" } });
    res.json(entry);
  })
);

app.delete(
  "/api/waitlist/:id",
  wrap(async (req, res) => {
    await prisma.waitlist.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  })
);

app.post(
  "/api/waitlist/:id/promote",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const w = await prisma.waitlist.findUnique({ where: { id }, include: { slot: true } });
    if (!w) return res.status(404).json({ error: "Entrada não encontrada" });
    const occ = await occupancy(w.slotId);
    if (occ >= w.slot.capacity) return res.status(409).json({ error: "Turma ainda está lotada." });
    const booking = await prisma.booking.create({
      data: {
        clientName: w.name,
        phone: w.phone || "",
        unit: w.slot.unit,
        date: w.slot.date,
        time: w.slot.time,
        prof: w.slot.prof,
        slotId: w.slotId,
        status: "aguardando",
        value: SETTINGS.valorPadrao,
      },
    });
    await ensureClient(w.name, w.phone, w.slot.unit, []);
    await prisma.waitlist.delete({ where: { id } });
    res.json(booking);
  })
);

/* ---------- PORTAL DO ALUNO (identificado pelo WhatsApp) ---------- */
app.get(
  "/api/portal/:phone",
  wrap(async (req, res) => {
    const phone = onlyDigits(req.params.phone);
    if (phone.length < 8) return res.status(400).json({ error: "Número de WhatsApp inválido." });
    const [allBookings, clients, slots] = await Promise.all([
      prisma.booking.findMany({ orderBy: [{ date: "asc" }, { time: "asc" }] }),
      prisma.client.findMany(),
      prisma.slot.findMany(),
    ]);
    const mine = allBookings.filter((b) => onlyDigits(b.phone) === phone);
    const cli = clients.find((c) => onlyDigits(c.phone) === phone) || null;
    const t = todayISO();
    const occ = {};
    allBookings.filter((b) => b.status !== "cancelada").forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });
    const available = slots
      .filter((s) => s.date >= t && (occ[s.id] || 0) < s.capacity)
      .map((s) => ({ id: s.id, date: s.date, time: s.time, unit: s.unit, prof: s.prof, vagas: s.capacity - (occ[s.id] || 0) }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    res.json({
      found: !!cli || mine.length > 0,
      client: cli
        ? { name: cli.name, phone: cli.phone, unit: cli.unit }
        : (mine[0] ? { name: mine[0].clientName, phone: mine[0].phone, unit: mine[0].unit } : null),
      bookings: mine,
      available,
      meta: { units: SETTINGS.units, valorPadrao: SETTINGS.valorPadrao, pixKey: SETTINGS.pixKey, pixName: SETTINGS.pixName },
    });
  })
);

app.post(
  "/api/portal/:phone/book",
  wrap(async (req, res) => {
    const rawPhone = req.params.phone;
    const phone = onlyDigits(rawPhone);
    const slot = await prisma.slot.findUnique({ where: { id: Number(req.body.slotId) } });
    if (!slot) return res.status(404).json({ error: "Horário não encontrado." });
    if ((await occupancy(slot.id)) >= slot.capacity) return res.status(409).json({ error: "Esta turma acabou de lotar. Escolha outro horário." });
    const cli = (await prisma.client.findMany()).find((c) => onlyDigits(c.phone) === phone);
    const clientName = (cli && cli.name) || (req.body.name || "").trim();
    if (!clientName) return res.status(400).json({ error: "Informe seu nome." });
    const booking = await prisma.booking.create({
      data: { clientName, phone: rawPhone, unit: slot.unit, date: slot.date, time: slot.time, prof: slot.prof, slotId: slot.id, status: "aguardando", value: SETTINGS.valorPadrao },
    });
    if (!cli) await prisma.client.create({ data: { name: clientName, phone: rawPhone, unit: slot.unit, tags: JSON.stringify(["Lead"]), notes: "Cadastrou-se pelo portal do aluno." } });
    res.json(booking);
  })
);

async function ownedBooking(phone, bookingId) {
  const b = await prisma.booking.findUnique({ where: { id: Number(bookingId) } });
  if (!b || onlyDigits(b.phone) !== onlyDigits(phone)) return null;
  return b;
}

app.post(
  "/api/portal/:phone/cancel/:bookingId",
  wrap(async (req, res) => {
    const b = await ownedBooking(req.params.phone, req.params.bookingId);
    if (!b) return res.status(403).json({ error: "Marcação não encontrada para este WhatsApp." });
    res.json(await prisma.booking.update({ where: { id: b.id }, data: { status: "cancelada" } }));
  })
);

app.post(
  "/api/portal/:phone/absence/:bookingId",
  wrap(async (req, res) => {
    const b = await ownedBooking(req.params.phone, req.params.bookingId);
    if (!b) return res.status(403).json({ error: "Marcação não encontrada para este WhatsApp." });
    res.json(await prisma.booking.update({ where: { id: b.id }, data: { attendance: "falta", absenceReason: (req.body.reason || "").slice(0, 500) } }));
  })
);

/* ---------- SETTINGS ---------- */
app.get("/api/settings", wrap(async (req, res) => res.json(SETTINGS)));

app.put(
  "/api/settings",
  wrap(async (req, res) => {
    const b = req.body;
    const data = {};
    if (b.valorPadrao !== undefined) data.valorPadrao = Number(b.valorPadrao) || SETTINGS.valorPadrao;
    if (b.capacidadePadrao !== undefined) data.capacidadePadrao = Math.max(1, parseInt(b.capacidadePadrao, 10) || SETTINGS.capacidadePadrao);
    if (Array.isArray(b.units)) data.units = JSON.stringify(b.units.filter((u) => u && u.trim()));
    if (Array.isArray(b.profs)) data.profs = JSON.stringify(b.profs.filter((p) => p && p.trim()));
    if (b.horarioFunc !== undefined) data.horarioFunc = String(b.horarioFunc);
    if (b.pixKey !== undefined) data.pixKey = String(b.pixKey);
    if (b.pixName !== undefined) data.pixName = String(b.pixName);
    if (b.mensalidadeValor !== undefined) data.mensalidadeValor = Number(b.mensalidadeValor) || 0;
    if (b.vencimentoDia !== undefined) data.vencimentoDia = Math.min(28, Math.max(1, parseInt(b.vencimentoDia, 10) || 10));
    // tabela de preços — 0 é valor válido (ex.: matrícula isenta), por isso não usa ||
    for (const k of ["taxaMatricula", "valorPlano1x", "valorPlano2x", "valorAvulsa"]) {
      if (b[k] !== undefined) { const n = Number(b[k]); data[k] = Number.isFinite(n) && n >= 0 ? n : SETTINGS[k]; }
    }
    if (b.duracaoAulaMin !== undefined) data.duracaoAulaMin = Math.min(600, Math.max(15, parseInt(b.duracaoAulaMin, 10) || SETTINGS.duracaoAulaMin));
    await prisma.settings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    await loadSettings();
    res.json(SETTINGS);
  })
);

/* ---------- AUTH DO PAINEL ADMIN (usuário + senha) ---------- */

// Existe algum administrador cadastrado? (define se mostra "criar 1º acesso" ou "login")
app.get("/api/admin/exists", wrap(async (_req, res) => {
  const n = await prisma.adminUser.count();
  res.json({ exists: n > 0 });
}));

// Criar o PRIMEIRO administrador (só funciona enquanto não houver nenhum)
app.post("/api/admin/setup", wrap(async (req, res) => {
  if ((await prisma.adminUser.count()) > 0) return res.status(409).json({ error: "Já existe um administrador. Use o login." });
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (username.length < 3) return res.status(400).json({ error: "Usuário deve ter ao menos 3 caracteres." });
  if (password.length < 6) return res.status(400).json({ error: "Senha deve ter ao menos 6 caracteres." });
  await prisma.adminUser.create({ data: { username, pass: await bcrypt.hash(password, 10) } });
  hasAdmin = true;
  const token = genToken(); adminTokens.add(token);
  res.json({ ok: true, token, username });
}));

// Cadastro de novo acesso pela própria tela de login (equipe da Inêz)
// Por enquanto: permite apenas 1 único usuário no sistema.
app.post("/api/admin/register", wrap(async (req, res) => {
  if ((await prisma.adminUser.count()) > 0) return res.status(409).json({ error: "Já existe um acesso cadastrado. Use o login." });
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (username.length < 3) return res.status(400).json({ error: "Usuário deve ter ao menos 3 caracteres." });
  if (password.length < 6) return res.status(400).json({ error: "Senha deve ter ao menos 6 caracteres." });
  if (await prisma.adminUser.findFirst({ where: { username } })) return res.status(409).json({ error: "Usuário já existe. Use o login." });
  await prisma.adminUser.create({ data: { username, pass: await bcrypt.hash(password, 10) } });
  hasAdmin = true;
  const token = genToken(); adminTokens.add(token);
  res.json({ ok: true, token, username });
}));

// Login
app.post("/api/admin/login", wrap(async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await prisma.adminUser.findFirst({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.pass))) return res.status(401).json({ error: "Usuário ou senha inválidos." });
  const token = genToken(); adminTokens.add(token);
  res.json({ ok: true, token, username });
}));

// Logout (invalida o token da sessão)
app.post("/api/admin/logout", wrap(async (req, res) => {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  adminTokens.delete(tok);
  res.json({ ok: true });
}));

// Adicionar novo usuário do painel (protegido — só admin logado) — equipe da Inêz
app.post("/api/admin/users", wrap(async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (username.length < 3) return res.status(400).json({ error: "Usuário deve ter ao menos 3 caracteres." });
  if (password.length < 6) return res.status(400).json({ error: "Senha deve ter ao menos 6 caracteres." });
  if (await prisma.adminUser.findFirst({ where: { username } })) return res.status(409).json({ error: "Usuário já existe." });
  await prisma.adminUser.create({ data: { username, pass: await bcrypt.hash(password, 10) } });
  res.json({ ok: true, username });
}));

// Listar usuários do painel (protegido)
app.get("/api/admin/users", wrap(async (_req, res) => {
  const list = await prisma.adminUser.findMany({ select: { id: true, username: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  res.json(list);
}));

/* ---------- AUTH (PIN de 4 dígitos) ---------- */

// Localiza o aluno(a) pelo CPF (somente dígitos)
async function clientByCpf(cpfRaw) {
  const cpf = onlyDigits(cpfRaw);
  if (cpf.length !== 11) return null;
  return prisma.client.findFirst({ where: { cpf } });
}

// Verifica se o CPF está cadastrado e se já tem PIN
app.post("/api/auth/check", wrap(async (req, res) => {
  if (onlyDigits(req.body.cpf).length !== 11) return res.status(400).json({ error: "Informe um CPF válido (11 dígitos)." });
  const client = await clientByCpf(req.body.cpf);
  if (!client) return res.json({ exists: false, hasPin: false });
  res.json({ exists: true, hasPin: !!client.pin, clientId: client.id });
}));

// Define PIN pela primeira vez (aluno(a) já cadastrado, sem PIN)
app.post("/api/auth/set-pin", wrap(async (req, res) => {
  const pin = String(req.body.pin || "");
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: "PIN de 4 dígitos é obrigatório." });
  const client = await clientByCpf(req.body.cpf);
  if (!client) return res.status(404).json({ error: "CPF não encontrado." });
  if (client.pin) return res.status(409).json({ error: "PIN já cadastrado. Use o login normal." });
  const hash = await bcrypt.hash(pin, 10);
  const updated = await prisma.client.update({ where: { id: client.id }, data: { pin: hash } });
  const { pin: _p, ...safe } = updated;
  res.json({ ok: true, client: { ...safe, tags: parseTags(safe.tags), hasPin: true } });
}));

// Login com CPF + PIN
app.post("/api/auth/login", wrap(async (req, res) => {
  const pin = String(req.body.pin || "");
  if (!pin) return res.status(400).json({ error: "PIN obrigatório." });
  const client = await clientByCpf(req.body.cpf);
  if (!client || !client.pin) return res.status(401).json({ error: "Credenciais inválidas." });
  const ok = await bcrypt.compare(pin, client.pin);
  if (!ok) return res.status(401).json({ error: "PIN incorreto." });
  const { pin: _p, ...safe } = client;
  res.json({ ok: true, client: { ...safe, tags: parseTags(safe.tags), hasPin: true } });
}));

// Resetar PIN (admin — apaga o hash, cliente volta ao fluxo de primeiro acesso)
app.delete("/api/clients/:id/pin", wrap(async (req, res) => {
  await prisma.client.update({ where: { id: Number(req.params.id) }, data: { pin: null } });
  res.json({ ok: true });
}));

/* ===================== DEPOIMENTOS ===================== */

// Servir fotos de depoimentos (fallback caso Vite não esteja rodando)
app.use("/depoimentos", express.static(DEPO_DIR));

// Listar depoimentos (público — usado pela landing page)
app.get("/api/testimonials", wrap(async (_req, res) => {
  const list = await prisma.testimonial.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  res.json(list);
}));

// Criar depoimento
app.post("/api/testimonials", wrap(async (req, res) => {
  const { name, role = "", text, active = true, order = 0 } = req.body;
  if (!name || !text) return res.status(400).json({ error: "name e text são obrigatórios." });
  const t = await prisma.testimonial.create({ data: { name, role, text, active, order } });
  res.status(201).json(t);
}));

// Atualizar depoimento
app.patch("/api/testimonials/:id", wrap(async (req, res) => {
  const { name, role, text, active, order } = req.body;
  const t = await prisma.testimonial.update({
    where: { id: Number(req.params.id) },
    data: { ...(name !== undefined && { name }), ...(role !== undefined && { role }), ...(text !== undefined && { text }), ...(active !== undefined && { active }), ...(order !== undefined && { order }) },
  });
  res.json(t);
}));

// Upload de foto
app.post("/api/testimonials/:id/photo", depoUpload.single("photo"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhuma imagem enviada." });
  const t = await prisma.testimonial.update({
    where: { id: Number(req.params.id) },
    data: { photo: req.file.filename },
  });
  res.json(t);
}));

// Excluir depoimento
app.delete("/api/testimonials/:id", wrap(async (req, res) => {
  await prisma.testimonial.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
}));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Migração leve e idempotente: garante a coluna Slot.seriesId (replicação) sem depender de migration manual
async function ensureSchema() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Slot' AND COLUMN_NAME = 'seriesId'"
  );
  if (!Number(rows?.[0]?.n)) {
    await prisma.$executeRawUnsafe("ALTER TABLE Slot ADD COLUMN seriesId VARCHAR(40) NULL");
    console.log("Migração aplicada: coluna Slot.seriesId criada.");
  }
}

const PORT = process.env.PORT || 4000;
ensureSchema()
  .catch((e) => console.error("Falha ao garantir schema (Slot.seriesId):", e.message))
  .then(() => loadSettings())
  .catch((e) => console.error("Falha ao carregar configurações:", e.message))
  .finally(() => app.listen(PORT, () => console.log(`API Fios que Curam rodando em http://localhost:${PORT}`)));
