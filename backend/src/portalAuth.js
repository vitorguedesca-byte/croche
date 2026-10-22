import express from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { can } from "./accessPolicy.js";
import { bindPortalBookingScope } from "./portalBookingScope.js";

const SESSION_MS = 12 * 60 * 60 * 1000;
const ACTIVATION_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 20000;
const digits = value => typeof value === "string" ? value.replace(/\D/g, "") : "";
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// Como as sessões administrativas, estas credenciais ficam na memória do
// processo. Reiniciar encerra sessões e códigos; a escola pode gerar outro.
export function createPortalAuth({ prisma, clientByCpf, canEnter, safeClient, now = Date.now }) {
  const sessions = new Map(), activations = new Map(), attempts = new Map(), locks = new Map();
  const router = express.Router();
  const cleanup = map => { for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key); };
  const room = map => { cleanup(map); if (map.size >= MAX_ENTRIES) fail(503, "Acesso temporariamente indisponível. Tente novamente em alguns minutos."); };
  const route = fn => async (req, res, next) => {
    try { await fn(req, res); } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };
  const eligible = client => {
    const result = canEnter(client);
    if (!result.ok) fail(403, result.motivo);
  };
  const tokenOf = req => typeof req.headers["x-portal-token"] === "string" ? req.headers["x-portal-token"] : "";
  const issue = client => {
    room(sessions);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(digest(token), { clientId: client.id, pin: client.pin, expiresAt: now() + SESSION_MS });
    return { ok: true, portalToken: token, client: safeClient(client) };
  };
  // Reserva a tentativa ANTES de qualquer await, inclusive bcrypt. Assim duas
  // chamadas simultâneas não contornam o teto por conta nem por IP.
  const reserve = (key, maximum = 5) => {
    cleanup(attempts);
    let entry = attempts.get(key);
    if (!entry) { room(attempts); entry = { count: 0, expiresAt: now() + ATTEMPT_MS }; attempts.set(key, entry); }
    if (entry.count >= maximum) fail(429, "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
    entry.count++;
    return entry;
  };
  const invalidate = id => {
    activations.delete(id);
    for (const [key, session] of sessions) if (session.clientId === id) sessions.delete(key);
  };
  const withClientLock = async (id, fn) => {
    const previous = locks.get(id) || Promise.resolve();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    locks.set(id, held);
    await previous;
    try { return await fn(); } finally {
      release();
      if (locks.get(id) === held) locks.delete(id);
    }
  };

  router.post("/api/auth/set-pin", route(async (req, res) => {
    const ipAttempt = reserve(`ip:${req.ip}`, 30);
    const { pin, activationCode } = req.body || {};
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) fail(400, "PIN de 4 dígitos é obrigatório.");
    const client = await clientByCpf(req.body.cpf);
    if (!client) fail(401, "Código de acesso inválido ou expirado. Solicite outro à escola.");
    reserve(`client:${client.id}`);
    await withClientLock(client.id, async () => {
      const current = await prisma.client.findUnique({ where: { id: client.id } });
      eligible(current);
      if (current.pin) fail(409, "PIN já cadastrado. Use o login normal.");
      cleanup(activations);
      const activation = activations.get(client.id);
      if (!activation || typeof activationCode !== "string" || !/^\d{8}$/.test(activationCode) ||
          !crypto.timingSafeEqual(Buffer.from(activation.hash, "hex"), Buffer.from(digest(activationCode), "hex"))) {
        fail(401, "Código de acesso inválido ou expirado. Solicite outro à escola.");
      }
      // Consumo antes do hash; updateMany também impede sobrescrita concorrente.
      activations.delete(client.id);
      const hash = await bcrypt.hash(pin, 10);
      const result = await prisma.client.updateMany({ where: { id: client.id, pin: null }, data: { pin: hash } });
      if (result.count !== 1) fail(409, "O acesso foi alterado. Solicite outro código à escola.");
      const updated = await prisma.client.findUnique({ where: { id: client.id } });
      if (!updated || updated.pin !== hash) fail(409, "O acesso foi alterado. Solicite outro código à escola.");
      eligible(updated);
      ipAttempt.count--;
      attempts.delete(`client:${client.id}`);
      res.set("Cache-Control", "no-store");
      res.json(issue(updated));
    });
  }));

  router.post("/api/auth/login", route(async (req, res) => {
    const ipAttempt = reserve(`ip:${req.ip}`, 30);
    const { pin } = req.body || {};
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) fail(400, "Digite os 4 números do seu PIN.");
    const client = await clientByCpf(req.body.cpf);
    if (!client) fail(401, "Credenciais inválidas.");
    reserve(`client:${client.id}`);
    if (!client.pin || !await bcrypt.compare(pin, client.pin)) fail(401, "Credenciais inválidas.");
    const current = await prisma.client.findUnique({ where: { id: client.id } });
    if (!current || current.pin !== client.pin) fail(401, "Acesso alterado. Faça login novamente.");
    eligible(current);
    // Um login legítimo não penaliza as outras alunas no tablet da sala.
    ipAttempt.count--;
    attempts.delete(`client:${client.id}`);
    res.set("Cache-Control", "no-store");
    res.json(issue(current));
  }));

  router.post("/api/auth/logout", route(async (req, res) => {
    sessions.delete(digest(tokenOf(req)));
    res.json({ ok: true });
  }));

  router.delete("/api/clients/:id/pin", route(async (req, res) => {
    if (!req.admin || !can(req.admin, "alunos", 2)) fail(403, "Sem permissão para redefinir o acesso de alunos.");
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) fail(400, "Aluno inválido.");
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) fail(404, "Aluno não encontrado.");
    await withClientLock(id, async () => {
      room(activations);
      const activationCode = String(crypto.randomInt(10000000, 100000000));
      await prisma.client.update({ where: { id }, data: { pin: null } });
      invalidate(id);
      activations.set(id, { hash: digest(activationCode), expiresAt: now() + ACTIVATION_MS });
      attempts.delete(`client:${id}`);
      res.set("Cache-Control", "no-store");
      res.json({ ok: true, activationCode, expiresAt: new Date(now() + ACTIVATION_MS).toISOString() });
    });
  }));

  const requireSession = async (req, res, next) => {
    try {
      cleanup(sessions);
      const token = tokenOf(req);
      const session = /^[a-f0-9]{64}$/.test(token) ? sessions.get(digest(token)) : null;
      if (!session) fail(401, "Entre com seu CPF e PIN para acessar o portal.");
      const client = await prisma.client.findUnique({ where: { id: session.clientId } });
      if (!client?.pin || client.pin !== session.pin) {
        sessions.delete(digest(token));
        fail(401, "Sessão encerrada. Faça login novamente.");
      }
      eligible(client);
      const key = req.params.key;
      if (![digits(client.cpf), digits(client.phone), String(client.id)].filter(Boolean).includes(digits(key))) {
        fail(403, "Este acesso pertence a outro aluno.");
      }
      await bindPortalBookingScope(prisma, client);
      req.portalClient = client;
      res.set("Cache-Control", "no-store");
      next();
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };
  return { router, requireSession };
}
