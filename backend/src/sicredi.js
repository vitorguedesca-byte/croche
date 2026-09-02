// Integração com a API Pix do Sicredi (padrão BACEN) — recebimentos via Pix.
// Docs: https://developers.sicredi.com.br/public/docs/getting-started-pix
//       https://developers.sicredi.com.br/public/reference/put_cob-txid
//       https://developers.sicredi.com.br/public/reference/put_webhook-chave
//
// Diferenças em relação à Cora (que este módulo substitui):
//  - autenticação é OAuth2 client_credentials com Basic (id:secret) POR CIMA de mTLS;
//  - a cobrança é criada com PUT /cob/{txid} — o txid é NOSSO e o PUT é idempotente,
//    então repetir a chamada devolve a mesma cobrança em vez de duplicar;
//  - não existe boleto: o retorno traz `pixCopiaECola` (o EMV) e nada de PDF.
import fs from "fs";
import https from "https";

const ENV = (process.env.SICREDI_ENV || "prod").toLowerCase();
// Em produção o host é fixo. O de homologação é informado pelo Sicredi na
// liberação do acesso, por isso vem de env em vez de estar chumbado aqui.
const HOST = process.env.SICREDI_HOST || (ENV === "prod" ? "api-pix.sicredi.com.br" : "");
const BASE = "/api/v2";
const CLIENT_ID = process.env.SICREDI_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SICREDI_CLIENT_SECRET || "";
const CERT_PATH = process.env.SICREDI_CERT_PATH || "";
const KEY_PATH = process.env.SICREDI_KEY_PATH || "";
// Chave Pix da conta recebedora, já cadastrada no Sicredi. Fica em env (e não nas
// Configurações do painel) de propósito: uma chave digitada errada na UI faria
// toda cobrança falhar, e ela precisa bater com a conta dona do certificado.
const PIX_KEY = process.env.SICREDI_PIX_KEY || "";

const SCOPES = "cob.write cob.read webhook.write webhook.read";

export const sicrediConfigured = () =>
  !!(HOST && CLIENT_ID && CLIENT_SECRET && PIX_KEY && CERT_PATH && KEY_PATH &&
     fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH));

// Explica o que falta — sem isso o erro na tela vira "não configurada" e você
// fica adivinhando qual das seis variáveis ficou de fora.
export function sicrediMissing() {
  const faltando = [];
  if (!HOST) faltando.push("SICREDI_HOST (ou SICREDI_ENV=prod)");
  if (!CLIENT_ID) faltando.push("SICREDI_CLIENT_ID");
  if (!CLIENT_SECRET) faltando.push("SICREDI_CLIENT_SECRET");
  if (!PIX_KEY) faltando.push("SICREDI_PIX_KEY");
  if (!CERT_PATH) faltando.push("SICREDI_CERT_PATH");
  else if (!fs.existsSync(CERT_PATH)) faltando.push(`certificado não encontrado em ${CERT_PATH}`);
  if (!KEY_PATH) faltando.push("SICREDI_KEY_PATH");
  else if (!fs.existsSync(KEY_PATH)) faltando.push(`chave privada não encontrada em ${KEY_PATH}`);
  return faltando;
}

// Agente HTTPS com certificado + chave (autenticação mútua / mTLS)
let agent = null;
function getAgent() {
  if (agent) return agent;
  if (!CERT_PATH || !KEY_PATH) throw new Error("Sicredi: configure SICREDI_CERT_PATH e SICREDI_KEY_PATH no .env");
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
        else {
          // O padrão BACEN devolve erro em { title, detail, violacoes[] } — priorizar
          // as violações específicas (ex: CPF inválido) deixa o motivo real visível.
          const violacoes = Array.isArray(parsed?.violacoes) && parsed.violacoes.length
            ? parsed.violacoes.map((v) => `${v.propriedade ? v.propriedade + ": " : ""}${v.razao}`).join("; ")
            : null;
          const detalhe = violacoes || parsed?.detail || parsed?.title || "";
          reject(Object.assign(new Error(`Sicredi ${res.statusCode}${detalhe ? `: ${detalhe}` : ""}`), {
            status: res.statusCode, body: parsed,
          }));
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Token de acesso (client_credentials sobre mTLS). Dura ~1h; guardamos em cache.
let tokenCache = { token: null, exp: 0 };
export async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("Sicredi: configure SICREDI_CLIENT_ID e SICREDI_CLIENT_SECRET no .env");
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = `grant_type=client_credentials&scope=${encodeURIComponent(SCOPES)}`;
  const r = await request("POST", "/oauth/token", {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body,
  });
  const ttl = Math.max(60, (r.expires_in || 3600) - 60); // renova 1 min antes de expirar
  tokenCache = { token: r.access_token, exp: Date.now() + ttl * 1000 };
  return tokenCache.token;
}

async function api(method, path, body) {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (body != null) headers["Content-Type"] = "application/json";
  return request(method, `${BASE}${path}`, { headers, body });
}

// Segundos até o fim do dia do vencimento, no fuso de Brasília (UTC-3). O servidor
// roda em UTC, então somar o offset explicitamente evita a cobrança expirar um dia
// antes para quem gera à noite.
export function expiracaoAte(dueDate) {
  const fim = Date.parse(`${dueDate}T23:59:59-03:00`);
  if (Number.isNaN(fim)) return 86400;
  const segs = Math.floor((fim - Date.now()) / 1000);
  return Math.min(Math.max(segs, 3600), 60 * 60 * 24 * 365); // entre 1h e 1 ano
}

/**
 * Cria (ou reaproveita) uma cobrança Pix imediata.
 * PUT /cob/{txid} é idempotente: chamar de novo com o mesmo txid devolve a cobrança
 * existente em vez de criar outra — é o que protege contra cobrança duplicada.
 * @param {object} p
 * @param {string} p.txid        - identificador nosso, [a-zA-Z0-9]{26,35}
 * @param {string} p.name        - nome do pagador
 * @param {string} p.cpf         - CPF do pagador (só dígitos)
 * @param {number} p.amountCents - valor em centavos (ex.: 8000 = R$ 80,00)
 * @param {string} p.dueDate     - vencimento 'YYYY-MM-DD' (vira calendario.expiracao)
 * @param {string} p.description - texto mostrado ao pagador no app do banco
 */
export async function createCharge({ txid, name, cpf, amountCents, dueDate, description }) {
  if (!/^[a-zA-Z0-9]{26,35}$/.test(txid || "")) {
    throw new Error(`Sicredi: txid inválido (${txid}) — precisa ser 26 a 35 caracteres alfanuméricos.`);
  }
  const payload = {
    calendario: { expiracao: expiracaoAte(dueDate) },
    valor: { original: (amountCents / 100).toFixed(2) },
    chave: PIX_KEY,
  };
  const doc = (cpf || "").replace(/\D/g, "");
  // devedor é opcional no padrão, mas quando enviado o CPF precisa ter 11 dígitos —
  // mandar um CPF pela metade derruba a cobrança inteira com 400.
  if (doc.length === 11 && name) payload.devedor = { cpf: doc, nome: String(name).slice(0, 200) };
  if (description) payload.solicitacaoPagador = String(description).slice(0, 140);
  return api("PUT", `/cob/${encodeURIComponent(txid)}`, payload);
}

// Consulta a situação de uma cobrança. É esta chamada (autenticada, com mTLS) que
// vale como prova de pagamento — nunca o corpo do webhook.
export async function getCharge(txid) {
  return api("GET", `/cob/${encodeURIComponent(txid)}`);
}

// Uma cobrança paga fica com status CONCLUIDA no padrão BACEN.
export const isPaidStatus = (s) => String(s || "").toUpperCase() === "CONCLUIDA";

// O Pix copia-e-cola (EMV) que vira QR Code na tela do aluno.
export const extractPix = (cob) => cob?.pixCopiaECola || null;

/* ---------- webhook (cadastro único, via scripts/registrar-webhook-sicredi.mjs) ---------- */

// Registra a URL que o Sicredi vai chamar quando cair um Pix. Atenção: o banco
// acrescenta "/pix" ao final da URL cadastrada na hora de notificar.
export async function registerWebhook(webhookUrl) {
  return api("PUT", `/webhook/${encodeURIComponent(PIX_KEY)}`, { webhookUrl });
}

export async function getWebhook() {
  return api("GET", `/webhook/${encodeURIComponent(PIX_KEY)}`);
}

export const pixKey = () => PIX_KEY;
