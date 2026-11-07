import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { can } from "./accessPolicy.js";

const context = new AsyncLocalStorage();
// Somente estes campos entram no histórico. Nunca guardar CPF, PIN, tokens,
// códigos Pix, dados de contato, observações livres ou corpos de requisição.
export const AUDIT_FIELDS = {
  client: ["id", "name", "unit", "plan", "status", "weeklyFreq", "mensalistaTipo", "monthlyValue", "billingDay", "weeklyFreqAnterior", "weeklyFreqDesde", "matriculaStatus", "matriculaAt", "matriculaRefundAt", "matriculaPainelAt"],
  invoice: ["id", "clientId", "competencia", "amountCents", "dueDate", "status", "paidAt", "baixaManual", "semPix"],
  monthlyPrice: ["id", "clientId", "competencia", "amountCents", "origem"],
  settings: ["id", "mensalidadeValor", "vencimentoDia", "valorPlano1x", "valorPlano2x", "valorPlano3x", "valorPlano4x", "taxaMatricula", "geracaoAuto", "cobrarEncargos", "pixExpira", "travaAtraso"],
};
const MUTATIONS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const CLIENT_REASON_FIELDS = ["billingDay", "monthlyValue", "plan", "status", "weeklyFreq", "mensalistaTipo"];
const selectFor = model => Object.fromEntries(AUDIT_FIELDS[model].map(key => [key, true]));
const fail = (status, message) => Object.assign(new Error(message), { status });

export const DATA_AUDIT_TABLE_SQL = readFileSync(new URL("../prisma/migrations/20261107000000_data_audit/migration.sql", import.meta.url), "utf8")
  .replace("CREATE TABLE `DataAudit`", "CREATE TABLE IF NOT EXISTS `DataAudit`");

export function auditRequestContext(req, _res, next) {
  context.run({ req, requestId: randomUUID() }, next);
}

// Útil para jobs/integrações que precisam nomear explicitamente a origem.
export function withAuditContext(identity, callback) {
  return context.run({ requestId: randomUUID(), ...identity }, callback);
}

function identity() {
  const state = context.getStore() || {};
  const req = state.req;
  const reason = typeof req?.body?.motivo === "string" ? req.body.motivo.trim() : state.reason;
  const common = { requestId: state.requestId || randomUUID(), reason: reason?.slice(0, 500) || null, route: req ? `${req.method} ${req.path.replace(/\/+$/, "")}`.slice(0, 160) : null };
  if (req?.admin) return { ...common, actorId: req.admin.id, actor: req.admin.username, actorName: req.admin.nome || null, source: "painel" };
  if (req?.portalClient) return { ...common, actorId: null, actor: `aluna:${req.portalClient.id}`, actorName: req.portalClient.name.slice(0, 120), source: "portal" };
  if (req?.path.startsWith("/api/sicredi/webhook")) return { ...common, actorId: null, actor: "Sicredi", actorName: null, source: "sicredi" };
  if (req?.path.startsWith("/api/wa/")) return { ...common, actorId: null, actor: "WhatsApp (automático)", actorName: null, source: "whatsapp" };
  if (req) return { ...common, actorId: null, actor: "Visitante não identificado", actorName: null, source: "site" };
  return { ...common, actorId: null, actor: state.actor || "Rotina automática", actorName: null, source: state.source || "sistema" };
}

async function record(db, model, before, after, who) {
  const changes = {};
  for (const key of AUDIT_FIELDS[model]) {
    if (key === "id") continue;
    const oldValue = before?.[key] ?? null, newValue = after?.[key] ?? null;
    if (oldValue !== newValue) changes[key] = { before: oldValue, after: newValue };
  }
  if (before && after && !Object.keys(changes).length) return;
  // Revalida na transação, com os valores efetivos. Outro usuário pode ter
  // mudado os dados entre a validação HTTP e a aquisição do bloqueio do banco.
  const manualRoute = /^(PATCH \/api\/(clients|invoices)\/\d+|POST \/api\/invoices\/\d+\/(pay|cancel)|DELETE \/api\/clients\/\d+)$/.test(who.route || "");
  const critical = model === "client" ? CLIENT_REASON_FIELDS : ["dueDate", "amountCents", "status", "paidAt", "baixaManual"];
  if (who.source === "painel" && manualRoute && (before && !after || critical.some(field => Object.hasOwn(changes, field))) && (!who.reason || who.reason.length < 3)) {
    throw Object.assign(fail(400, "Informe o motivo da alteração (de 3 a 500 caracteres)."), { code: "AUDIT_REASON_REQUIRED" });
  }
  const row = after || before;
  const clientId = model === "client" ? row.id : row.clientId ?? null;
  const clientName = model === "client" ? row.name : clientId ? (await db.client.findUnique({ where: { id: clientId }, select: { name: true } }))?.name : null;
  await db.dataAudit.create({ data: {
    ...who, entity: model, entityId: row.id, clientId, clientName: clientName || null,
    competencia: row.competencia || null, action: !before ? "criado" : !after ? "excluido" : "alterado", changes,
  } });
}

async function mutate(db, model, operation, args, who) {
  const delegate = db[model];
  // Captura por id depois da escrita: updateMany pode mudar a própria condição
  // do filtro (por exemplo, pendente -> cancelado).
  const before = operation === "create" || operation === "createMany" ? []
    : operation === "upsert" ? [await delegate.findUnique({ where: args.where, select: selectFor(model) })].filter(Boolean)
      : await delegate.findMany({ where: args.where, select: selectFor(model) });
  const deleting = operation === "delete" || operation === "deleteMany";
  // O histórico não tem FK com Client: sobrevive à exclusão e registra também
  // as mensalidades/preços que o MySQL removerá por cascata.
  if (model === "client" && deleting) {
    for (const client of before) for (const child of ["invoice", "monthlyPrice"]) {
      const rows = await db[child].findMany({ where: { clientId: client.id }, select: selectFor(child) });
      for (const row of rows) await record(db, child, row, null, who);
    }
  }
  // Nenhum caminho atual usa createMany nos modelos auditados. Recusar evita
  // inserir em lote sem conseguir relacionar cada id ao seu evento.
  if (operation === "createMany") throw fail(400, "Use criação individual para preservar a auditoria dos dados financeiros.");
  const addedId = args.select && !args.select.id;
  const query = addedId ? { ...args, select: { ...args.select, id: true } } : args;
  const result = await delegate[operation](query);
  if (deleting) {
    for (const row of before) await record(db, model, row, null, who);
  } else {
    const ids = before.length ? before.map(row => row.id) : result.id ? [result.id] : [];
    for (const id of ids) {
      const after = await delegate.findUnique({ where: { id }, select: selectFor(model) });
      await record(db, model, before.find(row => row.id === id) || null, after, who);
    }
  }
  if (addedId && result && !Array.isArray(result)) { const { id, ...rest } = result; return rest; }
  return result;
}

// Camada central: cobre painel, portal, webhooks e jobs que usam este cliente.
// A escrita e o evento usam a MESMA transação. A auditoria não é best-effort.
export function createAuditedPrisma(base, inTransaction = false) {
  const cache = new Map();
  return new Proxy(base, { get(target, key) {
    if (key === "$transaction" && !inTransaction) return (callback, options = {}) => {
      if (typeof callback !== "function") throw new TypeError("Use transação por callback para preservar a auditoria.");
      return target.$transaction(tx => callback(createAuditedPrisma(tx, true)), { ...options, isolationLevel: "Serializable" });
    };
    if (key === "dataAudit") {
      if (!cache.has(key)) cache.set(key, new Proxy(target[key], { get(delegate, op) {
        if (MUTATIONS.has(op)) return () => { throw fail(403, "O histórico de auditoria não pode ser alterado ou excluído."); };
        return typeof delegate[op] === "function" ? delegate[op].bind(delegate) : delegate[op];
      } }));
      return cache.get(key);
    }
    if (Object.hasOwn(AUDIT_FIELDS, key)) {
      if (!cache.has(key)) cache.set(key, new Proxy(target[key], { get(delegate, operation) {
        if (!MUTATIONS.has(operation)) return typeof delegate[operation] === "function" ? delegate[operation].bind(delegate) : delegate[operation];
        return async (args = {}) => {
          // PIN, avisos de WhatsApp e QR não produzem eventos nem abrem uma
          // transação desnecessária quando nenhum campo auditado foi enviado.
          if (["update", "updateMany"].includes(operation) && !AUDIT_FIELDS[key].some(field => Object.hasOwn(args.data || {}, field))) return delegate[operation](args);
          const who = identity();
          if (inTransaction) return mutate(target, key, operation, args, who);
          for (let attempt = 0; ; attempt++) {
            try { return await target.$transaction(tx => mutate(tx, key, operation, args, who), { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 }); }
            catch (error) { if (error.code !== "P2034" || attempt >= 2) throw error; }
          }
        };
      } }));
      return cache.get(key);
    }
    return typeof target[key] === "function" ? target[key].bind(target) : target[key];
  } });
}

// Valida ANTES de executar a rota ou provocar efeitos externos. A identidade
// vem da sessão autenticada; campos "actor" enviados pelo navegador não contam.
export function createDataAuditRoutes(prisma) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      if (!req.admin) return next();
      const path = req.path.replace(/\/+$/, "");
      let required = (req.method === "POST" && (/^\/api\/invoices\/\d+\/(pay|cancel)$/.test(path) || /^\/api\/clients\/\d+\/(mensalidade-valor|matricula\/refund|baixa-lead|reativar)$/.test(path) || path === "/api/mensalidades/reajuste"))
        || (req.method === "DELETE" && /^\/api\/clients\/\d+$/.test(path))
        || (req.method === "PATCH" && /^\/api\/invoices\/\d+$/.test(path) && ["dueDate", "amountCents"].some(key => Object.hasOwn(req.body || {}, key)));
      if (req.method === "PATCH" && /^\/api\/clients\/\d+$/.test(path)) {
        const old = await prisma.client.findUnique({ where: { id: Number(path.split("/").pop()) } });
        required = !!old && CLIENT_REASON_FIELDS.some(key => Object.hasOwn(req.body || {}, key) && (req.body[key] ?? null) !== (old[key] ?? null));
      }
      if (req.method === "PUT" && path === "/api/settings") {
        const old = await prisma.settings.findUnique({ where: { id: 1 } });
        required = !!old && AUDIT_FIELDS.settings.some(key => key !== "id" && Object.hasOwn(req.body || {}, key) && req.body[key] !== old[key]);
      }
      if (required && (typeof req.body?.motivo !== "string" || req.body.motivo.trim().length < 3 || req.body.motivo.trim().length > 500)) {
        return res.status(400).json({ code: "AUDIT_REASON_REQUIRED", error: "Informe o motivo da alteração (de 3 a 500 caracteres)." });
      }
      next();
    } catch (error) { next(error); }
  });
  const history = async (req, res, next) => {
    try {
      if (!can(req.admin, "financeiro")) return res.status(403).json({ error: "Consultar a auditoria exige acesso ao Financeiro." });
      const clientId = req.params.id == null ? null : Number(req.params.id);
      const rawCursor = req.query.before;
      const before = rawCursor == null ? null : Number(rawCursor);
      const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
      const entity = req.query.entity;
      if ((clientId !== null && (!Number.isSafeInteger(clientId) || clientId < 1)) || (before !== null && (!Number.isSafeInteger(before) || before < 1))) return res.status(400).json({ error: "Filtro de auditoria inválido." });
      if (entity && !Object.hasOwn(AUDIT_FIELDS, entity)) return res.status(400).json({ error: "Tipo de registro inválido." });
      const conditions = [
        ...(clientId ? [{ OR: [{ clientId }, { entity: "settings" }] }] : []),
        ...(before ? [{ id: { lt: before } }] : []),
        ...(entity ? [{ entity }] : []),
        ...(search ? [{ OR: ["clientName", "actor", "actorName", "reason"].map(field => ({ [field]: { contains: search } })) }] : []),
      ];
      const rows = await prisma.dataAudit.findMany({
        where: conditions.length ? { AND: conditions } : {},
        orderBy: { id: "desc" }, take: 51,
      });
      res.set("Cache-Control", "no-store");
      const items = rows.slice(0, 50);
      res.json({ items, nextCursor: rows.length > 50 ? items.at(-1).id : null });
    } catch (error) { next(error); }
  };
  router.get("/api/clients/:id/audit", history);
  router.get("/api/data-audit", history);
  return router;
}
