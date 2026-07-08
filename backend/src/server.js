import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
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

const todayISO = () => new Date().toISOString().slice(0, 10);
function addDays(iso, n) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const onlyDigits = (s) => (s || "").replace(/\D/g, "");
const parseTags = (t) => {
  try {
    const a = JSON.parse(t || "[]");
    return Array.isArray(a) ? a : [];
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

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

/* ---------- configurações (linha única id=1, cache em memória) ---------- */
let SETTINGS = { valorPadrao: VALOR_PADRAO, capacidadePadrao: CAPACITY_PADRAO, units: UNITS, profs: PROFS, horarioFunc: "", pixKey: "", pixName: "" };
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
  };
  return SETTINGS;
}

/* ---------- estado completo (usado pelo frontend) ---------- */
app.get(
  "/api/state",
  wrap(async (req, res) => {
    const [clients, slots, bookings] = await Promise.all([
      prisma.client.findMany({ orderBy: { name: "asc" } }),
      prisma.slot.findMany({ include: { waitlist: true }, orderBy: [{ date: "asc" }, { time: "asc" }] }),
      prisma.booking.findMany({ orderBy: [{ date: "asc" }, { time: "asc" }] }),
    ]);
    res.json({
      meta: { units: SETTINGS.units, profs: SETTINGS.profs, valorPadrao: SETTINGS.valorPadrao, capacidadePadrao: SETTINGS.capacidadePadrao, horarioFunc: SETTINGS.horarioFunc, pixKey: SETTINGS.pixKey, pixName: SETTINGS.pixName },
      clients: clients.map(({ pin, ...c }) => ({ ...c, tags: parseTags(c.tags), hasPin: !!pin })),
      slots,
      bookings,
    });
  })
);

/* ---------- SLOTS ---------- */
app.post(
  "/api/slots",
  wrap(async (req, res) => {
    const { unit, prof, date, time, capacity, weeks, dates } = req.body;
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
    const created = [];
    for (const d of targets) {
      const existing = await prisma.slot.findFirst({ where: { date: d, time, unit } });
      if (existing) continue; // evita duplicado
      const slot = await prisma.slot.create({
        data: { unit, prof: prof || profFor(unit), date: d, time, capacity: cap },
      });
      created.push(slot);
    }
    res.json({ created });
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
    await prisma.slot.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
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
async function ensureClient(name, phone, unit, tags, cpf) {
  const found = await prisma.client.findFirst({ where: { name } });
  if (found) {
    // se o cliente já existe mas ainda não tem CPF, completa com o informado
    if (cpf && !found.cpf) return prisma.client.update({ where: { id: found.id }, data: { cpf: onlyDigits(cpf) } });
    return found;
  }
  return prisma.client.create({
    data: { name, phone: phone || "", cpf: onlyDigits(cpf) || null, unit, tags: JSON.stringify(tags || ["Em marcação"]) },
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
        value: Number(b.value) || SETTINGS.valorPadrao,
      },
    });
    await ensureClient(b.clientName, b.phone, unit, ["Em marcação"], b.cpf);
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
    // presente → conclui a aula
    if (data.attendance === "presente" && (data.status || cur.status) !== "cancelada") data.status = "concluida";
    // confirmada sem pagamento → marca paga
    if ((data.status || cur.status) === "confirmada" && !(data.paid ?? cur.paid)) {
      data.paid = true;
      data.paymentMethod = data.paymentMethod || cur.paymentMethod || "Pix";
      data.paymentDate = data.paymentDate || cur.paymentDate || todayISO();
    }
    const booking = await prisma.booking.update({ where: { id }, data });
    res.json(booking);
  })
);

app.post(
  "/api/bookings/:id/pay",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const booking = await prisma.booking.update({
      where: { id },
      data: {
        paid: true,
        status: "confirmada",
        paymentMethod: req.body.paymentMethod || "Pix",
        paymentDate: req.body.paymentDate || todayISO(),
        ...(req.body.value !== undefined ? { value: Number(req.body.value) } : {}),
      },
    });
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
            data: { paid: true, status: "confirmada", paymentMethod: "Pix", paymentDate: todayISO() },
          });
          console.log(`[cora] pagamento confirmado — reserva ${booking.id}`);
        }
      }
    }
    res.json({ ok: true });
  })
);

/* ---------- CLIENTS ---------- */
app.post(
  "/api/clients",
  wrap(async (req, res) => {
    const { name, phone, cpf, unit, tags, notes, birthday, level, firstClass } = req.body;
    if (!name) return res.status(400).json({ error: "name é obrigatório" });
    const client = await prisma.client.create({
      data: {
        name, phone: phone || "", cpf: onlyDigits(cpf) || null, unit: unit || UNITS[0], tags: JSON.stringify(tags || []), notes: notes || "",
        birthday: birthday || null, level: level || null, firstClass: !!firstClass,
      },
    });
    res.json(client);
  })
);

app.patch(
  "/api/clients/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { name, phone, cpf, unit, tags, notes, birthday, level, firstClass } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (cpf !== undefined) data.cpf = onlyDigits(cpf) || null;
    if (unit !== undefined) data.unit = unit;
    if (tags !== undefined) data.tags = JSON.stringify(tags);
    if (notes !== undefined) data.notes = notes;
    if (birthday !== undefined) data.birthday = birthday || null;
    if (level !== undefined) data.level = level || null;
    if (firstClass !== undefined) data.firstClass = !!firstClass;
    const client = await prisma.client.update({ where: { id }, data });
    res.json(client);
  })
);

app.delete(
  "/api/clients/:id",
  wrap(async (req, res) => {
    await prisma.client.delete({ where: { id: Number(req.params.id) } });
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
    await ensureClient(w.name, w.phone, w.slot.unit, ["Em marcação"]);
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
    if (!cli) await prisma.client.create({ data: { name: clientName, phone: rawPhone, unit: slot.unit, tags: JSON.stringify(["Em marcação", "Lead"]), notes: "Cadastrou-se pelo portal do aluno." } });
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
    await prisma.settings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    await loadSettings();
    res.json(SETTINGS);
  })
);

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

const PORT = process.env.PORT || 4000;
loadSettings()
  .catch((e) => console.error("Falha ao carregar configurações:", e.message))
  .finally(() => app.listen(PORT, () => console.log(`API Fios que Curam rodando em http://localhost:${PORT}`)));
