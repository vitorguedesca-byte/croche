import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createPortalAuth } from "../src/portalAuth.js";
import { createAccessControl } from "../src/accessControl.js";
import { waWebhookJson } from "../src/waWebhookAuth.js";
import { memoryPrisma } from "./access-fixture.mjs";
import { bindPortalBookingScope, bookingWhere, ownsPortalBooking } from "../src/portalBookingScope.js";

async function listen(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("webhook rejeita falsificação antes de todos os efeitos; aceita bytes assinados e preserva GET", async t => {
  const app = express();
  let effects = 0;
  const secret = "segredo-apenas-do-teste";
  app.post("/api/wa/webhook", ...waWebhookJson({ secret }));
  app.use(express.json());
  app.get("/api/wa/webhook", (req, res) => res.send(req.query["hub.challenge"]));
  app.post("/api/wa/webhook", (_req, res) => { effects++; res.sendStatus(200); });
  const base = await listen(t, app);
  const body = '{ "entry": [], "nome": "In\\u00eas" }';
  const signature = raw => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const post = (raw, header, type = "application/json") => fetch(base + "/api/wa/webhook", { method: "POST", headers: { "Content-Type": type, ...(header ? { "X-Hub-Signature-256": header } : {}) }, body: raw });
  for (const header of [undefined, "sha256=00", "sha256=" + "0".repeat(64), signature(body) + "," + signature(body), "sha1=" + "a".repeat(40)]) {
    assert.equal((await post(body, header)).status, 401);
  }
  assert.equal((await post(JSON.stringify(JSON.parse(body)), signature(body))).status, 401, "JSON equivalente não tem os mesmos bytes");
  assert.equal((await post(body, signature(body), "text/plain")).status, 401);
  assert.equal(effects, 0, "mensagens, status, CRM e cache não podem ser processados");
  assert.equal((await post(body, signature(body))).status, 200);
  assert.equal(effects, 1);
  assert.equal(await (await fetch(base + "/api/wa/webhook?hub.challenge=teste123")).text(), "teste123");
});

test("webhook sem segredo falha fechado", async t => {
  const app = express();
  app.post("/api/wa/webhook", ...waWebhookJson({ secret: "" }), () => assert.fail("Não deve processar"));
  const base = await listen(t, app);
  const response = await fetch(base + "/api/wa/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 503);
});

async function fixture(t) {
  let clock = Date.now();
  const clients = new Map([
    [1, { id: 1, name: "Aluna A", cpf: "12345678901", phone: "31987654321", status: "ativo", pin: null }],
    [2, { id: 2, name: "Aluna B", cpf: "98765432100", phone: "31912345678", status: "ativo", pin: await bcrypt.hash("5678", 10) }],
    [3, { id: 3, name: "Ex aluna", cpf: "11122233344", phone: "31911112222", status: "cancelado", pin: await bcrypt.hash("5678", 10) }],
  ]);
  const prisma = memoryPrisma();
  prisma.client = {
    async findMany({ where }) { return [...clients.values()].filter(c => c.name === where.name).map(c => ({ ...c })); },
    async findUnique({ where }) { const value = clients.get(where.id); return value ? { ...value } : null; },
    async update({ where, data }) { Object.assign(clients.get(where.id), data); return { ...clients.get(where.id) }; },
    async updateMany({ where, data }) {
      const value = clients.get(where.id);
      if (!value || value.pin !== where.pin) return { count: 0 };
      Object.assign(value, data); return { count: 1 };
    },
  };
  prisma.booking = { async findMany() { return []; } };
  const clientByCpf = async cpf => [...clients.values()].find(c => c.cpf === (typeof cpf === "string" ? cpf.replace(/\D/g, "") : ""));
  const app = express(); app.use(express.json());
  const access = createAccessControl({ prisma, now: () => clock, isPublicApi: req => /^\/api\/(auth\/|portal\/|admin\/(setup|login|exists|register)$)/.test(req.path) });
  app.use(access.middleware); app.use(access.router);
  const portal = createPortalAuth({ prisma, clientByCpf, now: () => clock, canEnter: client => ({ ok: !!client && client.status === "ativo", motivo: "Matrícula inativa." }), safeClient: ({ pin, ...client }) => ({ ...client, hasPin: !!pin }) });
  app.use(portal.router);
  app.use("/api/portal/:key", portal.requireSession);
  let mutations = 0;
  app.get("/api/portal/:key", (req, res) => res.json({ id: req.portalClient.id }));
  app.post("/api/portal/:key/:action/:id?", (req, res) => { mutations++; res.json({ id: req.portalClient.id }); });
  // Caminhos legados são cobertos pelo mesmo limite, independentemente do nome do parâmetro.
  app.post("/api/portal/:phone/legacy/:id/action", (req, res) => { mutations++; res.json({ ok: true }); });
  app.use((e, _req, res, _next) => res.status(e.status || 500).json({ error: e.message }));
  const base = await listen(t, app);
  const request = async (method, path, body, token, admin) => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { "X-Portal-Token": token } : {}), ...(admin ? { Authorization: `Bearer ${admin}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const setup = await request("POST", "/api/admin/setup", { username: "admin", password: "SenhaTeste123" });
  const admin = setup.data.token;
  const code = async (id = 1) => {
    const result = await request("DELETE", `/api/clients/${id}/pin`, null, null, admin);
    assert.equal(result.status, 200); assert.match(result.data.activationCode, /^\d{8}$/);
    return result.data.activationCode;
  };
  return { request, clients, admin, code, advance: ms => { clock += ms; }, mutations: () => mutations };
}

test("CPF sozinho não cadastra PIN; somente escola autorizada emite código", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("POST", "/api/auth/set-pin", { cpf: "12345678901", pin: "1234" })).status, 401);
  assert.equal(f.clients.get(1).pin, null);
  assert.equal((await f.request("DELETE", "/api/clients/1/pin")).status, 401);
  const user = await f.request("POST", "/api/admin/users", { username: "instrutora", password: "SenhaTeste123", role: "instrutora" }, null, f.admin);
  assert.equal(user.status, 201);
  const login = await f.request("POST", "/api/admin/login", { username: "instrutora", password: "SenhaTeste123" });
  assert.equal((await f.request("DELETE", "/api/clients/1/pin", null, null, login.data.token)).status, 403);
  const activationCode = await f.code();
  assert.equal((await f.request("POST", "/api/auth/set-pin", { cpf: "12345678901", pin: "1234", activationCode: [activationCode] })).status, 401);
  const created = await f.request("POST", "/api/auth/set-pin", { cpf: "123.456.789-01", pin: "1234", activationCode });
  assert.equal(created.status, 200);
  assert.equal(created.data.client.pin, undefined);
  assert.equal(await bcrypt.compare("1234", f.clients.get(1).pin), true);
  assert.equal((await f.request("GET", "/api/portal/12345678901", null, created.data.portalToken)).status, 200);
  assert.equal((await f.request("POST", "/api/auth/set-pin", { cpf: "12345678901", pin: "0000", activationCode })).status, 409);
});

test("sessão vincula conta em todos os aliases e operações; logout revoga", async t => {
  const f = await fixture(t);
  for (const key of ["98765432100", "31912345678", "2"]) {
    assert.equal((await f.request("GET", `/api/portal/${key}`)).status, 401);
    for (const action of ["book", "cancel/1", "absence/1", "extra", "legacy/1/action"]) {
      assert.equal((await f.request("POST", `/api/portal/${key}/${action}`, {})).status, 401);
    }
  }
  assert.equal(f.mutations(), 0);
  const login = await f.request("POST", "/api/auth/login", { cpf: "98765432100", pin: "5678" });
  assert.equal(login.status, 200); const token = login.data.portalToken;
  for (const key of ["98765432100", "31912345678", "2"]) {
    assert.equal((await f.request("GET", `/api/portal/${key}`, null, token)).data.id, 2);
    assert.equal((await f.request("POST", `/api/portal/${key}/book`, {}, token)).status, 200);
  }
  assert.equal((await f.request("GET", "/api/portal/12345678901", null, token)).status, 403);
  assert.equal((await f.request("POST", "/api/portal/1/cancel/1", {}, token)).status, 403);
  assert.equal((await f.request("GET", "/api/portal/2", null, token.slice(1))).status, 401);
  await f.request("POST", "/api/auth/logout", null, token);
  assert.equal((await f.request("GET", "/api/portal/2", null, token)).status, 401);
});

test("reset revoga sessões e códigos anteriores; código expira e é de uso único", async t => {
  const f = await fixture(t);
  const login = await f.request("POST", "/api/auth/login", { cpf: "98765432100", pin: "5678" });
  const old = await f.code(2);
  assert.equal((await f.request("GET", "/api/portal/2", null, login.data.portalToken)).status, 401);
  const fresh = await f.code(2);
  assert.equal((await f.request("POST", "/api/auth/set-pin", { cpf: "98765432100", pin: "1234", activationCode: old })).status, 401);
  const created = await f.request("POST", "/api/auth/set-pin", { cpf: "98765432100", pin: "1234", activationCode: fresh });
  assert.equal(created.status, 200);
  const expiring = await f.code();
  f.advance(12 * 60 * 60 * 1000);
  assert.equal((await f.request("GET", "/api/portal/2", null, created.data.portalToken)).status, 401);
  f.advance(12 * 60 * 60 * 1000);
  assert.equal((await f.request("POST", "/api/auth/set-pin", { cpf: "12345678901", pin: "1234", activationCode: expiring })).status, 401);
  assert.equal(f.clients.get(1).pin, null);
});

test("tentativas de PIN são limitadas pela conta, inclusive com CPF formatado", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    assert.equal((await f.request("POST", "/api/auth/login", { cpf: i % 2 ? "987.654.321-00" : "98765432100", pin: "0000" })).status, 401);
  }
  assert.equal((await f.request("POST", "/api/auth/login", { cpf: "98765432100", pin: "5678" })).status, 429);
  f.advance(15 * 60 * 1000);
  assert.equal((await f.request("POST", "/api/auth/login", { cpf: "98765432100", pin: "5678" })).status, 200);
  assert.equal((await f.request("POST", "/api/auth/login", { cpf: "11122233344", pin: "5678" })).status, 403);
});

test("concorrência não sobrescreve PIN; redefinição durante criação termina revogada", async t => {
  const f = await fixture(t);
  const activationCode = await f.code();
  const results = await Promise.all(["1234", "9876"].map(pin => f.request("POST", "/api/auth/set-pin", { cpf: "12345678901", pin, activationCode })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = results.findIndex(r => r.status === 200);
  assert.equal(await bcrypt.compare(["1234", "9876"][winner], f.clients.get(1).pin), true);
  const nextCode = await f.code();
  const pending = f.request("POST", "/api/auth/set-pin", { cpf: "12345678901", pin: "1234", activationCode: nextCode });
  await new Promise(resolve => setTimeout(resolve, 10));
  const reset = f.code();
  const [created] = await Promise.all([pending, reset]);
  assert.equal(f.clients.get(1).pin, null);
  if (created.status === 200) assert.equal((await f.request("GET", "/api/portal/1", null, created.data.portalToken)).status, 401);
});

test("integração do servidor cobre todas as rotas antes de webhook e portal", () => {
  const source = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.ok(source.indexOf('app.post("/api/wa/webhook", ...waWebhookJson())') < source.indexOf('app.use(express.json())'));
  assert.ok(source.indexOf('app.use("/api/portal/:key", portalAuth.requireSession)') < source.indexOf('app.post("/api/portal/'));
  assert.ok(source.indexOf('app.use(access.middleware)') < source.indexOf('app.use(portalAuth.router)'));
  assert.equal(source.includes("clientByPortalKey"), false, "a rota usa a identidade da sessão, sem nova resolução ambígua");
  assert.equal((source.match(/app\.post\("\/api\/auth\/(set-pin|login)"/g) || []).length, 0, "nenhum caminho antigo contorna a autenticação");
});

test("homônimas não compartilham aulas; formatação do telefone é preservada", async () => {
  const client = { id: 1, name: "Maria Silva", phone: "(31) 98765-4321" };
  const own = { clientName: client.name, phone: "+55 (31) 98765-4321" };
  const foreign = { clientName: client.name, phone: "31911112222" };
  const noPhone = { clientName: client.name, phone: null };
  const peers = [{ ...client }, { id: 2, name: client.name, phone: foreign.phone }];
  const prisma = { client: { async findMany() { return peers; } }, booking: { async findMany() { return [own, foreign, noPhone]; } } };
  await bindPortalBookingScope(prisma, client);
  assert.equal(ownsPortalBooking(client, own), true);
  assert.equal(ownsPortalBooking(client, foreign), false);
  assert.equal(ownsPortalBooking(client, noPhone), false);
  const where = bookingWhere(client);
  assert.equal(where.phone.in.includes(own.phone), true);
  assert.equal(where.phone.in.includes(foreign.phone), false);
  assert.equal(where.phone.in.includes(null), false);
  peers.push({ id: 3, name: client.name, phone: "5531987654321" });
  await assert.rejects(bindPortalBookingScope(prisma, client), { status: 403 });
  await assert.rejects(bindPortalBookingScope(prisma, { id: 4, name: "Sem telefone", phone: null }), { status: 403 });
});

test("troca de conta ignora login atrasado e 401 de sessão anterior", async t => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const events = new EventTarget();
  globalThis.window = events;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; });
  const { api } = await import(new URL(`../../frontend/src/api.js?test=${crypto.randomUUID()}`, import.meta.url));
  let releaseA, releaseGet;
  let expired = 0;
  events.addEventListener("fqc-portal-expired", () => expired++);
  const sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push({ url, headers: options.headers });
    if (url.endsWith("/login")) {
      const { cpf } = JSON.parse(options.body);
      if (cpf === "A") return new Promise(resolve => { releaseA = () => resolve(Response.json({ portalToken: "token-A", client: { id: 1 } })); });
      return Response.json({ portalToken: "token-B", client: { id: 2 } });
    }
    if (url === "/api/portal/A") return new Promise(resolve => { releaseGet = () => resolve(Response.json({ error: "expirada" }, { status: 401 })); });
    return Response.json({ ok: true });
  };
  const pendingLogin = api.auth.login("A", "1234");
  const staleLogin = assert.rejects(pendingLogin, /Acesso cancelado/);
  await api.auth.logout();
  await api.auth.login("B", "5678");
  releaseA(); await staleLogin;
  await api.portal.get("B");
  assert.equal(sent.at(-1).headers["X-Portal-Token"], "token-B");
  const oldGet = api.portal.get("A");
  const staleGet = assert.rejects(oldGet, /expirada/);
  await api.auth.logout();
  // Outro login deve emitir outro token, inclusive para a mesma conta.
  globalThis.fetch = async (url, options) => {
    sent.push({ url, headers: options.headers });
    return url.endsWith("/login") ? Response.json({ portalToken: "token-B-novo", client: { id: 2 } }) : Response.json({ ok: true });
  };
  await api.auth.login("B", "5678");
  releaseGet(); await staleGet;
  assert.equal(expired, 0);
  await api.portal.get("B");
  assert.equal(sent.at(-1).headers["X-Portal-Token"], "token-B-novo");
});
