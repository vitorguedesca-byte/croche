import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PrismaClient } from "../.qa/data-audit-db/client/index.js";
import { createAuditedPrisma, withAuditContext, auditRequestContext, createDataAuditRoutes } from "../src/dataAudit.js";
import { allowed } from "../src/accessPolicy.js";

const base = new PrismaClient();
const prisma = createAuditedPrisma(base);
test.after(() => base.$disconnect());
async function reset() {
  await base.dataAudit.deleteMany();
  await base.invoice.deleteMany();
  await base.monthlyPrice.deleteMany();
  await base.client.deleteMany();
  await base.settings.deleteMany();
  return base.client.create({ data: { name: "Aluna de teste", unit: "Timóteo", billingDay: 28, plan: "mensalista", pin: "PIN-segredo", cpf: "CPF-segredo", phone: "telefone-segredo", notes: "observacao-segredo" } });
}
const invoice = (clientId, competencia = "2026-10") => base.invoice.create({ data: { clientId, competencia, amountCents: 12000, dueDate: `${competencia}-28`, status: "pendente" } });
const asAdmin = callback => withAuditContext({ req: { admin: { id: 7, username: "inez", nome: "Inêz" }, method: "PATCH", path: "/api/invoices/1", body: { motivo: "Prazo combinado", actor: "intruso" } } }, callback);

test("alteração grava usuário autenticado, motivo e valores anteriores; sem segredos", async () => {
  const client = await reset(); const inv = await invoice(client.id);
  await asAdmin(() => prisma.invoice.update({ where: { id: inv.id }, data: { dueDate: "2026-11-02" } }));
  const entry = await base.dataAudit.findFirst();
  assert.equal(entry.actor, "inez"); assert.equal(entry.actorId, 7); assert.equal(entry.actorName, "Inêz");
  assert.equal(entry.reason, "Prazo combinado"); assert.equal(entry.clientId, client.id); assert.equal(entry.competencia, "2026-10");
  assert.deepEqual(entry.changes, { dueDate: { before: "2026-10-28", after: "2026-11-02" } });
  assert.ok(entry.createdAt instanceof Date); assert.ok(entry.requestId);
  const json = JSON.stringify(entry);
  for (const secret of ["PIN-segredo", "CPF-segredo", "telefone-segredo", "observacao-segredo", "intruso"]) assert.equal(json.includes(secret), false);
});

test("falha ao gravar auditoria desfaz a alteração no banco", async () => {
  const client = await reset(); const inv = await invoice(client.id);
  await base.$executeRawUnsafe("CREATE TRIGGER fail_audit BEFORE INSERT ON DataAudit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
  try {
    await assert.rejects(() => asAdmin(() => prisma.invoice.update({ where: { id: inv.id }, data: { dueDate: "2026-11-02" } })));
    assert.equal((await base.invoice.findUnique({ where: { id: inv.id } })).dueDate, "2026-10-28");
    assert.equal(await base.dataAudit.count(), 0);
  } finally { await base.$executeRawUnsafe("DROP TRIGGER fail_audit"); }
});

test("transação existente desfaz dados e auditoria quando outra etapa falha", async () => {
  const client = await reset();
  await assert.rejects(() => asAdmin(() => prisma.$transaction(async tx => {
    await tx.client.update({ where: { id: client.id }, data: { billingDay: 2 } });
    throw new Error("outra etapa falhou");
  })), /outra etapa/);
  assert.equal((await base.client.findUnique({ where: { id: client.id } })).billingDay, 28);
  assert.equal(await base.dataAudit.count(), 0);
});

test("motivo é revalidado com os dados efetivos dentro da transação", async () => {
  const client = await reset(); const inv = await invoice(client.id);
  await assert.rejects(() => withAuditContext({ req: { admin: { id: 7, username: "inez" }, method: "PATCH", path: `/api/invoices/${inv.id}`, body: {} } }, () => prisma.invoice.update({ where: { id: inv.id }, data: { dueDate: "2026-11-02" } })), error => error.code === "AUDIT_REASON_REQUIRED");
  assert.equal((await base.invoice.findUnique({ where: { id: inv.id } })).dueDate, "2026-10-28");
  assert.equal(await base.dataAudit.count(), 0);
});

test("updateMany registra cada cobrança, inclusive quando o filtro muda", async () => {
  const client = await reset(); const one = await invoice(client.id); const two = await invoice(client.id, "2026-11");
  await asAdmin(() => prisma.invoice.updateMany({ where: { clientId: client.id, status: "pendente" }, data: { status: "cancelado" } }));
  const events = await base.dataAudit.findMany({ orderBy: { entityId: "asc" } });
  assert.deepEqual(events.map(row => row.entityId), [one.id, two.id]);
  for (const row of events) assert.deepEqual(row.changes.status, { before: "pendente", after: "cancelado" });
});

test("excluir cadastro preserva auditoria e registra as cobranças removidas por cascata", async () => {
  const client = await reset(); await invoice(client.id);
  await base.monthlyPrice.create({ data: { clientId: client.id, competencia: "2026-11", amountCents: 10000 } });
  await asAdmin(() => prisma.client.delete({ where: { id: client.id } }));
  assert.equal(await base.client.count(), 0); assert.equal(await base.invoice.count(), 0); assert.equal(await base.monthlyPrice.count(), 0);
  const entries = await base.dataAudit.findMany();
  assert.deepEqual(entries.map(row => row.entity).sort(), ["client", "invoice", "monthlyPrice"]);
  assert.ok(entries.every(row => row.action === "excluido" && row.clientName === "Aluna de teste" && row.clientId === client.id));
});

test("criação, upsert e remoção de preço combinado preservam antes/depois", async () => {
  const client = await reset();
  await withAuditContext({ source: "sistema", actor: "Emissão automática" }, () => prisma.invoice.create({ data: { clientId: client.id, competencia: "2026-11", amountCents: 12000, dueDate: "2026-11-28" } }));
  const where = { clientId_competencia: { clientId: client.id, competencia: "2026-12" } };
  await asAdmin(() => prisma.monthlyPrice.upsert({ where, create: { clientId: client.id, competencia: "2026-12", amountCents: 10000 }, update: { amountCents: 10000 } }));
  await asAdmin(() => prisma.monthlyPrice.upsert({ where, create: { clientId: client.id, competencia: "2026-12", amountCents: 9000 }, update: { amountCents: 9000 } }));
  await asAdmin(() => prisma.monthlyPrice.deleteMany({ where: { clientId: client.id } }));
  const entries = await base.dataAudit.findMany({ orderBy: { id: "asc" } });
  assert.equal(entries.length, 4); assert.equal(entries[0].source, "sistema"); assert.equal(entries[0].actor, "Emissão automática");
  assert.deepEqual(entries[2].changes.amountCents, { before: 10000, after: 9000 });
  assert.equal(entries[3].action, "excluido");
});

test("atualização sem mudança e alteração de PIN não criam eventos nem vazam PIN", async () => {
  const client = await reset();
  await asAdmin(() => prisma.client.update({ where: { id: client.id }, data: { billingDay: 28 } }));
  await prisma.client.update({ where: { id: client.id }, data: { pin: "outro-pin" } });
  assert.equal(await base.dataAudit.count(), 0);
  await asAdmin(() => prisma.client.update({ where: { id: client.id }, data: { monthlyValue: 100, pin: "terceiro-pin" } }));
  assert.deepEqual((await base.dataAudit.findFirst()).changes, { monthlyValue: { before: null, after: 100 } });
});

test("histórico é imutável pela camada de aplicação e respeita select", async () => {
  const client = await reset();
  const result = await asAdmin(() => prisma.client.update({ where: { id: client.id }, data: { billingDay: 2 }, select: { name: true } }));
  assert.deepEqual(result, { name: "Aluna de teste" });
  for (const method of ["create", "update", "delete", "deleteMany", "updateMany", "upsert"]) assert.throws(() => prisma.dataAudit[method]({}), /não pode ser alterado/);
  assert.equal(await base.dataAudit.count(), 1);
});

test("webhook, portal e rotina automática têm origens distintas", async () => {
  const client = await reset(); const inv = await invoice(client.id);
  await withAuditContext({ req: { method: "POST", path: "/api/sicredi/webhook/pix", body: {} } }, () => prisma.invoice.update({ where: { id: inv.id }, data: { status: "pago", paidAt: "2026-11-06" } }));
  await withAuditContext({ req: { method: "POST", path: "/api/portal/key/volta", portalClient: { id: client.id, name: client.name }, body: {} } }, () => prisma.client.update({ where: { id: client.id }, data: { plan: "avulso" } }));
  await prisma.client.update({ where: { id: client.id }, data: { plan: "mensalista" } });
  assert.deepEqual((await base.dataAudit.findMany({ orderBy: { id: "asc" } })).map(row => row.source), ["sicredi", "portal", "sistema"]);
});

test("configuração financeira é auditada sem copiar outros dados das configurações", async () => {
  await reset();
  await base.settings.create({ data: { id: 1 } });
  await asAdmin(() => prisma.settings.update({ where: { id: 1 }, data: { valorPlano1x: 140 } }));
  const entry = await base.dataAudit.findFirst();
  assert.equal(entry.entity, "settings"); assert.equal(entry.clientId, null);
  assert.deepEqual(entry.changes.valorPlano1x, { before: 120, after: 140 });
});

test("HTTP: motivo obrigatório, nenhuma escrita antes do motivo, permissões e histórico paginado", async t => {
  const client = await reset(); const inv = await invoice(client.id);
  const app = express(); app.use(express.json()); app.use(auditRequestContext);
  const users = { admin: { id: 7, username: "inez", role: "admin" }, finance: { id: 8, username: "financeiro", role: "equipe", permissions: JSON.stringify({ financeiro: 1 }) }, teacher: { role: "instrutora", username: "professora" } };
  app.use((req, res, next) => {
    req.admin = users[req.headers.authorization];
    if (!req.admin) return res.status(401).json({ error: "restrito" });
    if (!allowed(req.admin, req.method, req.path)) return res.status(403).json({ error: "negado" });
    next();
  });
  app.use(createDataAuditRoutes(prisma));
  app.patch("/api/invoices/:id", async (req, res, next) => { try { res.json(await prisma.invoice.update({ where: { id: Number(req.params.id) }, data: { dueDate: req.body.dueDate } })); } catch (e) { next(e); } });
  app.patch("/api/clients/:id", async (req, res, next) => { try { res.json(await prisma.client.update({ where: { id: Number(req.params.id) }, data: { billingDay: req.body.billingDay } })); } catch (e) { next(e); } });
  app.use((e, _req, res, _next) => res.status(e.status || 500).json({ error: e.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (method, path, user = "admin", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { authorization: user, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text() };
  };
  assert.equal((await request("PATCH", `/api/invoices/${inv.id}`, "admin", { dueDate: "2026-11-02" })).data.code, "AUDIT_REASON_REQUIRED");
  assert.equal((await request("PATCH", `/api/invoices/${inv.id}/`, "admin", { dueDate: "2026-11-02" })).data.code, "AUDIT_REASON_REQUIRED");
  assert.equal((await base.invoice.findUnique({ where: { id: inv.id } })).dueDate, "2026-10-28");
  assert.equal(await base.dataAudit.count(), 0);
  for (const motivo of [" ", "ab", "x".repeat(501), { text: "invalido" }]) assert.equal((await request("PATCH", `/api/invoices/${inv.id}`, "admin", { dueDate: "2026-11-02", motivo })).status, 400);
  assert.equal((await request("PATCH", `/api/clients/${client.id}`, "admin", { billingDay: 2 })).data.code, "AUDIT_REASON_REQUIRED");
  assert.equal((await request("PATCH", `/api/invoices/${inv.id}`, "finance", { dueDate: "2026-11-02", motivo: "Autorizado" })).status, 403);
  assert.equal((await request("PATCH", `/api/invoices/${inv.id}`, "admin", { dueDate: "2026-11-02", motivo: "Novo prazo", actor: "outra pessoa" })).status, 200);
  assert.equal((await request("GET", `/api/clients/${client.id}/audit`, "teacher")).status, 403);
  assert.equal((await request("GET", "/api/data-audit", "anonimo")).status, 401);
  assert.equal((await request("DELETE", "/api/data-audit", "admin")).status, 404);
  assert.equal((await request("DELETE", "/api/data-audit", "finance")).status, 403);
  const history = await request("GET", `/api/clients/${client.id}/audit`, "finance");
  assert.equal(history.status, 200); assert.equal(history.data.items[0].actor, "inez"); assert.equal(history.data.items[0].reason, "Novo prazo");
  const other = await base.client.create({ data: { name: "Outra aluna" } }); await invoice(other.id);
  await prisma.client.update({ where: { id: other.id }, data: { billingDay: 12 } });
  assert.equal((await request("GET", `/api/clients/${client.id}/audit`, "finance")).data.items.length, 1);
  assert.equal((await request("GET", "/api/data-audit?entity=invoice&search=Novo", "finance")).data.items.length, 1);
  assert.equal((await request("GET", "/api/data-audit?before=abc", "finance")).status, 400);
  assert.equal((await request("GET", "/api/data-audit?entity=adminUser", "finance")).status, 400);
  await base.dataAudit.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ actor: "teste", source: "sistema", requestId: "paginacao", entity: "invoice", entityId: i + 1, clientId: client.id, action: "alterado", changes: { status: { before: "pendente", after: "pago" } } })) });
  const page1 = await request("GET", `/api/clients/${client.id}/audit`, "finance");
  assert.equal(page1.data.items.length, 50); assert.ok(page1.data.nextCursor);
  const page2 = await request("GET", `/api/clients/${client.id}/audit?before=${page1.data.nextCursor}`, "finance");
  assert.equal(page2.data.items.length, 6); assert.equal(page2.data.nextCursor, null);
  const ids = [...page1.data.items, ...page2.data.items].map(row => row.id); assert.equal(new Set(ids).size, ids.length);
});
