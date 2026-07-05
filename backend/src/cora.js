// Integração com a Cora (Integração Direta / mTLS) — recebimentos.
// Docs: https://developers.cora.com.br/docs/client-credentials-int-direta
//       https://developers.cora.com.br/reference/emissão-de-boleto-registrado-v2
import fs from "fs";
import https from "https";
import crypto from "crypto";

const ENV = (process.env.CORA_ENV || "stage").toLowerCase();
const HOST = ENV === "prod" ? "matls-clients.api.cora.com.br" : "matls-clients.api.stage.cora.com.br";
const CLIENT_ID = process.env.CORA_CLIENT_ID || "";
const CERT_PATH = process.env.CORA_CERT_PATH || "";
const KEY_PATH = process.env.CORA_KEY_PATH || "";

export const coraConfigured = () => !!(CLIENT_ID && CERT_PATH && KEY_PATH && fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH));

// Agente HTTPS com certificado + chave (autenticação mútua / mTLS)
let agent = null;
function getAgent() {
  if (agent) return agent;
  if (!CERT_PATH || !KEY_PATH) throw new Error("Cora: configure CORA_CERT_PATH e CORA_KEY_PATH no .env");
  agent = new https.Agent({ cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) });
  return agent;
}

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    const req = https.request({ host: HOST, path, method, agent: getAgent(), headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(Object.assign(new Error(`Cora ${res.statusCode}`), { status: res.statusCode, body: parsed }));
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Token de acesso (client_credentials via mTLS). Dura ~24h; guardamos em cache.
let tokenCache = { token: null, exp: 0 };
export async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  if (!CLIENT_ID) throw new Error("Cora: configure CORA_CLIENT_ID no .env");
  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(CLIENT_ID)}`;
  const r = await request("POST", "/token", { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const ttl = Math.max(60, (r.expires_in || 3600) - 60); // renova 1 min antes de expirar
  tokenCache = { token: r.access_token, exp: Date.now() + ttl * 1000 };
  return tokenCache.token;
}

async function api(method, path, body) {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (body != null) {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = crypto.randomUUID(); // evita cobrança duplicada
  }
  return request(method, path, { headers, body });
}

/**
 * Cria uma cobrança (boleto registrado que já vem com QR-Code Pix).
 * @param {object} p
 * @param {string} p.code        - identificador seu (ex.: "fqc-booking-12")
 * @param {string} p.name        - nome do pagador
 * @param {string} p.cpf         - CPF do pagador (só dígitos)
 * @param {string} [p.email]     - e-mail do pagador (para notificação/boleto)
 * @param {object} [p.address]   - endereço do pagador { street, number, district, city, state, complement, zip_code }
 * @param {number} p.amountCents - valor em centavos (ex.: 8000 = R$ 80,00)
 * @param {string} p.dueDate     - vencimento "YYYY-MM-DD"
 * @param {string} p.description - descrição do serviço
 * Formato validado na doc oficial (Emissão de boleto registrado v2).
 */
export async function createInvoice({ code, name, cpf, email, address, amountCents, dueDate, description }) {
  const customer = {
    name,
    document: { identity: (cpf || "").replace(/\D/g, ""), type: "CPF" },
  };
  if (email) customer.email = email;
  if (address) customer.address = address;
  const payload = {
    code: code || `fqc-${Date.now()}`,
    customer,
    services: [{ name: description || "Aula de crochê — Fios que Curam", amount: amountCents }],
    payment_terms: { due_date: dueDate },
    payment_forms: ["BANK_SLIP", "PIX"],
  };
  return api("POST", "/v2/invoices", payload);
}

// Consulta os detalhes/situação de uma cobrança
export async function getInvoice(id) {
  return api("GET", `/v2/invoices/${encodeURIComponent(id)}`);
}
