// Integração com a WhatsApp Cloud API (Meta) — envio e recebimento de mensagens.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
import https from "https";

const TOKEN = process.env.WA_TOKEN || "";
const PHONE_ID = process.env.WA_PHONE_ID || "";
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "";
const GRAPH_VERSION = process.env.WA_GRAPH_VERSION || "v21.0";

export const waConfigured = () => !!(TOKEN && PHONE_ID);

// Verificação do webhook (GET) exigida pela Meta ao registrar a URL.
export function waVerify(mode, token, challenge) {
  if (mode === "subscribe" && token && token === VERIFY_TOKEN) return challenge;
  return null;
}

function graph(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host: "graph.facebook.com",
        path: `/${GRAPH_VERSION}${path}`,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(Object.assign(new Error(`WhatsApp ${res.statusCode}`), { status: res.statusCode, body: parsed }));
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Envia uma mensagem de texto simples para um número (formato internacional, só dígitos).
export function sendWaText(to, text) {
  return graph("POST", `/${PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text, preview_url: false },
  });
}

// Extrai a primeira mensagem recebida de um payload de webhook do WhatsApp.
export function parseIncoming(body) {
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return null; // pode ser um evento de status de entrega, ignoramos
    const name = value?.contacts?.[0]?.profile?.name || "";
    const text =
      msg.text?.body ||
      msg.button?.text ||
      msg.interactive?.button_reply?.title ||
      msg.interactive?.list_reply?.title ||
      "";
    return { id: msg.id, from: msg.from, name, text, type: msg.type };
  } catch {
    return null;
  }
}
