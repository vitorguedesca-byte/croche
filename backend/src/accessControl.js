import express from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { MODULES, BUILTIN_PROFILES, permissionsFor, allowed, can, validatePermissions } from "./accessPolicy.js";

const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const usernameOf = value => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const safeUser = user => ({
  id: user.id, username: user.username, nome: user.nome, role: user.role,
  active: user.active, profileId: user.profileId, custom: user.role === "equipe" && !user.profileId && !!user.permissions,
  profileName: user.role === "admin" ? "Admin" : user.role === "instrutora" ? "Instrutora" : user.profile?.name || (user.permissions ? "Personalizado" : "Sem perfil"),
  permissions: permissionsFor(user), createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
});
const serializeProfile = p => ({ ...p, permissions: JSON.parse(p.permissions), userCount: p._count?.users || 0, _count: undefined });

export function createAccessControl({ prisma, isPublicApi, now = Date.now }) {
  const sessions = new Map();
  const router = express.Router();
  const route = fn => async (req, res, next) => {
    try { await fn(req, res); } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      if (e.code === "P2002") return res.status(409).json({ error: "Esse usuário ou nome de perfil já existe." });
      if (e.code === "P2034") return res.status(409).json({ error: "Outro acesso foi alterado ao mesmo tempo. Atualize a lista e tente novamente." });
      if (e.code === "P2003") return res.status(409).json({ error: "O perfil está vinculado a usuários e não pode ser excluído." });
      console.error("[acessos]", e.code || e.name);
      res.status(500).json({ error: "Não foi possível concluir a gestão de acessos. Tente novamente." });
    }
  };
  const tokenOf = req => (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const audit = (db, req, action, target, detail = {}) => db.accessAudit.create({ data: { actor: req.admin?.username || target, action, target: String(target), detail: JSON.stringify(detail) } });
  const transaction = fn => prisma.$transaction(fn, { isolationLevel: "Serializable" });
  const issue = user => {
    const token = crypto.randomBytes(32).toString("hex");
    for (const [key, s] of sessions) if (now() - s.issuedAt >= MAX_SESSION_MS) sessions.delete(key);
    sessions.set(token, { userId: user.id, version: user.sessionVersion, issuedAt: now() });
    return { ok: true, token, ...safeUser(user) };
  };
  const requireAdmin = (req, _res, next) => {
    if (req.admin?.role !== "admin") return _res.status(403).json({ error: "Somente Admin pode gerenciar usuários e perfis." });
    next();
  };
  const parseIdentity = body => {
    const username = usernameOf(body.username);
    const nome = String(body.nome || "").trim();
    if (!/^[a-z0-9._@-]{3,60}$/.test(username)) fail(400, "Usuário deve ter de 3 a 60 caracteres: letras, números, ponto, @, hífen ou sublinhado.");
    if (nome.length > 120) fail(400, "Nome deve ter até 120 caracteres.");
    return { username, nome: nome || null };
  };
  const passwordHash = async password => {
    if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) fail(400, "Senha deve ter ao menos 8 caracteres e no máximo 72 bytes.");
    return bcrypt.hash(password, 10);
  };
  const assignment = async (db, body) => {
    if (["admin", "instrutora"].includes(body.role)) return { role: body.role, profileId: null, permissions: null };
    if (body.role === "equipe" && body.profileId == null && body.permissions) {
      // Personalizado: módulos escolhidos na ficha do próprio usuário.
      let permissions;
      try { permissions = validatePermissions(typeof body.permissions === "string" ? JSON.parse(body.permissions) : body.permissions); } catch (e) { fail(400, e.message); }
      return { role: "equipe", profileId: null, permissions: JSON.stringify(permissions) };
    }
    if (body.role !== "equipe" || !Number.isInteger(body.profileId) || body.profileId < 1) fail(400, "Escolha um perfil válido.");
    if (!await db.accessProfile.findUnique({ where: { id: body.profileId } })) fail(400, "Perfil não encontrado.");
    return { role: "equipe", profileId: body.profileId, permissions: null };
  };
  const auditAccess = u => ({ username: u.username, nome: u.nome, role: u.role, profileId: u.profileId, ...(u.permissions ? { permissions: JSON.parse(u.permissions) } : {}), active: u.active });
  const getUser = async (db, id) => {
    if (!Number.isSafeInteger(id) || id < 1) fail(400, "Usuário inválido.");
    const user = await db.adminUser.findUnique({ where: { id }, include: { profile: true } });
    if (!user) fail(404, "Usuário não encontrado.");
    return user;
  };

  const authenticate = async (req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    try {
      const token = tokenOf(req);
      const session = sessions.get(token);
      if (token && (!session || now() - session.issuedAt >= MAX_SESSION_MS)) {
        sessions.delete(token);
        // Login e páginas públicas continuam acessíveis após expirar a sessão.
        if (!/^\/api\/admin\/(login|exists|setup|register)$/.test(req.path)) return res.status(401).json({ error: "Sessão encerrada. Faça login novamente." });
      }
      if (session && now() - session.issuedAt < MAX_SESSION_MS) {
        const user = await prisma.adminUser.findUnique({ where: { id: session.userId }, include: { profile: true } });
        if (!user || !user.active || user.sessionVersion !== session.version) {
          sessions.delete(token);
          return res.status(401).json({ error: "Sessão encerrada. Faça login novamente." });
        }
        req.admin = user;
      }
      if (isPublicApi(req) && !req.admin) return next();
      // Público continua público, mas um token restrito não pode usar as rotas
      // compartilhadas para operar como se fosse uma matrícula anônima.
      if (isPublicApi(req) && !/^\/api\/(bookings|testimonials|settings)(\/|$)/.test(req.path)) return next();
      if (!req.admin) return res.status(401).json({ error: "Acesso restrito ao painel. Faça login." });
      const universalRead = req.method === "GET" && ["/api/settings", "/api/testimonials", "/api/slots/available"].includes(req.path);
      const path = req.path.replace(/\/+$/, "");
      if (!universalRead && !allowed(req.admin, req.method, path)) return res.status(403).json({ error: "Seu perfil não tem permissão para esta ação." });
      const financialFields = ["paid", "value", "taxaMatricula", "paymentMethod", "paymentDate", "txid", "pixCode", "monthlyValue", "billingDay", "matriculaStatus", "matriculaAt", "matriculaRefundAt"];
      if (["POST", "PATCH", "PUT"].includes(req.method) && /^\/api\/(clients|bookings)(\/\d+)?$/.test(path) && financialFields.some(key => Object.hasOwn(req.body || {}, key)) && !can(req.admin, "financeiro", 2)) return res.status(403).json({ error: "Alterar valores e pagamentos exige permissão de edição no Financeiro." });
      next();
    } catch (e) {
      console.error("[autenticacao]", e.code || e.name);
      res.status(503).json({ error: "Não foi possível validar seu acesso. Tente novamente." });
    } // falha de banco nunca libera o painel
  };

  router.get("/api/admin/exists", route(async (_req, res) => res.json({ exists: await prisma.adminUser.count() > 0 })));
  const setup = route(async (req, res) => {
    const identity = parseIdentity(req.body);
    const pass = await passwordHash(req.body.password);
    const user = await transaction(async db => {
      if (await db.adminUser.count() > 0) fail(409, "Já existe um administrador. Use o login.");
      const u = await db.adminUser.create({ data: { ...identity, pass, role: "admin" }, include: { profile: true } });
      await audit(db, req, "primeiro_admin", u.username);
      return u;
    });
    res.status(201).json(issue(user));
  });
  router.post("/api/admin/setup", setup);
  router.post("/api/admin/register", setup);
  router.post("/api/admin/login", route(async (req, res) => {
    const updated = await transaction(async db => {
      const user = await db.adminUser.findUnique({ where: { username: usernameOf(req.body.username) }, include: { profile: true } });
      if (!user || !user.active || typeof req.body.password !== "string" || !await bcrypt.compare(req.body.password, user.pass)) fail(401, "Usuário ou senha inválidos.");
      return db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date(now()) }, include: { profile: true } });
    });
    res.json(issue(updated));
  }));
  router.get("/api/admin/me", route(async (req, res) => res.json(safeUser(req.admin))));
  router.post("/api/admin/logout", route(async (req, res) => { sessions.delete(tokenOf(req)); res.json({ ok: true }); }));
  router.use(["/api/admin/users", "/api/admin/profiles", "/api/admin/access-audit", "/api/admin/access-catalog"], requireAdmin);
  router.get("/api/admin/access-catalog", (_req, res) => res.json({ modules: MODULES, builtinProfiles: BUILTIN_PROFILES }));
  router.get("/api/admin/users", route(async (_req, res) => {
    const list = await prisma.adminUser.findMany({ include: { profile: true }, orderBy: { createdAt: "asc" } });
    res.json(list.map(u => ({ ...safeUser(u), sessions: [...sessions.values()].filter(s => s.userId === u.id && s.version === u.sessionVersion && now() - s.issuedAt < MAX_SESSION_MS).length })));
  }));
  router.post("/api/admin/users", route(async (req, res) => {
    const identity = parseIdentity(req.body);
    const pass = await passwordHash(req.body.password);
    const user = await transaction(async db => {
      const access = await assignment(db, req.body);
      const u = await db.adminUser.create({ data: { ...identity, ...access, pass }, include: { profile: true } });
      await audit(db, req, "usuario_criado", u.username, auditAccess(u));
      return u;
    });
    res.status(201).json(safeUser(user));
  }));
  router.patch("/api/admin/users/:id", route(async (req, res) => {
    const id = Number(req.params.id);
    const pass = req.body.password === undefined ? undefined : await passwordHash(req.body.password);
    const user = await transaction(async db => {
      const before = await getUser(db, id);
      const identity = parseIdentity({ ...before, ...req.body });
      const access = await assignment(db, { ...before, ...req.body });
      if (req.body.active !== undefined && typeof req.body.active !== "boolean") fail(400, "Status de usuário inválido.");
      const active = req.body.active ?? before.active;
      if (before.role === "admin" && before.active && (!active || access.role !== "admin")) {
        if (await db.adminUser.count({ where: { role: "admin", active: true } }) <= 1) fail(409, "Mantenha ao menos um Admin ativo no sistema.");
      }
      const u = await db.adminUser.update({ where: { id }, data: { ...identity, ...access, active, ...(pass ? { pass } : {}), ...(pass || active !== before.active ? { sessionVersion: { increment: 1 } } : {}) }, include: { profile: true } });
      await audit(db, req, "usuario_alterado", u.username, { anterior: auditAccess(before), atual: auditAccess(u), senhaAlterada: !!pass });
      return u;
    });
    res.json(safeUser(user));
  }));
  router.post("/api/admin/users/:id/revoke", route(async (req, res) => {
    const id = Number(req.params.id);
    await transaction(async db => {
      const u = await getUser(db, id);
      await db.adminUser.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
      await audit(db, req, "sessoes_encerradas", u.username);
    });
    for (const [token, session] of sessions) if (session.userId === id) sessions.delete(token);
    res.json({ ok: true });
  }));
  router.get("/api/admin/profiles", route(async (_req, res) => res.json((await prisma.accessProfile.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } })).map(serializeProfile))));
  const profileData = async body => {
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    if (name.length < 3 || name.length > 80 || description.length > 250) fail(400, "Perfil: nome de 3 a 80 caracteres e descrição de até 250.");
    if (["admin", "administrador", "instrutora"].includes(usernameOf(name))) fail(400, "Esse nome é reservado a um perfil do sistema.");
    let permissions;
    try { permissions = validatePermissions(body.permissions); } catch (e) { fail(400, e.message); }
    return { name, description, permissions: JSON.stringify(permissions) };
  };
  router.post("/api/admin/profiles", route(async (req, res) => {
    const data = await profileData(req.body);
    const p = await transaction(async db => {
      const created = await db.accessProfile.create({ data });
      await audit(db, req, "perfil_criado", created.name, { permissions: req.body.permissions });
      return created;
    });
    res.status(201).json(serializeProfile(p));
  }));
  router.patch("/api/admin/profiles/:id", route(async (req, res) => {
    const id = Number(req.params.id);
    const data = await profileData(req.body);
    const p = await transaction(async db => {
      const before = Number.isSafeInteger(id) ? await db.accessProfile.findUnique({ where: { id } }) : null;
      if (!before) fail(404, "Perfil não encontrado.");
      const updated = await db.accessProfile.update({ where: { id }, data });
      await audit(db, req, "perfil_alterado", updated.name, { anterior: { name: before.name, permissions: JSON.parse(before.permissions) }, permissions: req.body.permissions });
      return updated;
    });
    res.json(serializeProfile(p));
  }));
  router.delete("/api/admin/profiles/:id", route(async (req, res) => {
    const id = Number(req.params.id);
    await transaction(async db => {
      const p = Number.isSafeInteger(id) ? await db.accessProfile.findUnique({ where: { id } }) : null;
      if (!p) fail(404, "Perfil não encontrado.");
      if (await db.adminUser.count({ where: { profileId: id } })) fail(409, "Troque o perfil dos usuários vinculados antes de excluir.");
      await db.accessProfile.delete({ where: { id } });
      await audit(db, req, "perfil_excluido", p.name);
    });
    res.json({ ok: true });
  }));
  router.get("/api/admin/access-audit", route(async (_req, res) => res.json(await prisma.accessAudit.findMany({ orderBy: { id: "desc" }, take: 100 }))));
  return { middleware: authenticate, router, safeUser };
}
