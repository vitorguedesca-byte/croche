// Integração com a WhatsApp Cloud API (Meta) — envio e recebimento de mensagens.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
import https from "https";

const TOKEN = process.env.WA_TOKEN || "";
const PHONE_ID = process.env.WA_PHONE_ID || "";
const WABA_ID = process.env.WA_WABA_ID || ""; // conta do WhatsApp — só para gerenciar templates
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "";
const GRAPH_VERSION = process.env.WA_GRAPH_VERSION || "v26.0";

export const waConfigured = () => !!(TOKEN && PHONE_ID);
// Templates são criados/listados na WABA, não no número.
export const waTemplatesConfigured = () => !!(TOKEN && WABA_ID);

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

// Normaliza número brasileiro: a Meta às vezes entrega o wa_id SEM o 9º dígito
// (ex.: 553199979436). Para enviar, o WhatsApp espera com o 9 (5531999979436).
export function normalizePhone(to) {
  const d = String(to || "").replace(/\D/g, "");
  // 55 (país) + DDD (2) + 8 dígitos = falta o 9 do celular → insere
  if (d.startsWith("55") && d.length === 12) return d.slice(0, 4) + "9" + d.slice(4);
  return d;
}

// Envia uma mensagem de texto simples para um número (formato internacional, só dígitos).
export function sendWaText(to, text) {
  return graph("POST", `/${PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "text",
    text: { body: text, preview_url: false },
  });
}

// Botões de resposta (até 3). buttons = [{ id, title }]. title máx 20 chars.
export function sendWaButtons(to, body, buttons) {
  return graph("POST", `/${PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  });
}

// Lista tocável (até 10 itens). rows = [{ id, title, description }]. title máx 24, description máx 72.
export function sendWaList(to, body, buttonText, rows, header) {
  return graph("POST", `/${PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "interactive",
    interactive: {
      type: "list",
      ...(header ? { header: { type: "text", text: header.slice(0, 60) } } : {}),
      body: { text: body },
      action: {
        button: buttonText.slice(0, 20),
        sections: [{ rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24), description: (r.description || "").slice(0, 72) })) }],
      },
    },
  });
}

/* ===================== TEMPLATES (mensagens fora da janela de 24h) =====================
   Regra da Meta: mensagem livre (texto, botões, lista) só sai DENTRO da janela de 24h
   aberta pela última mensagem da aluna. Fora dela, só template aprovado.

   Por isso lembrete de aula, cobrança e confirmação proativa precisam passar por aqui —
   as funções acima falham com o erro 131047 ("Re-engagement message") fora da janela. */

// A Meta rejeita parâmetro com quebra de linha, tab ou 4+ espaços seguidos (erro 132000).
// Normaliza em vez de deixar o envio quebrar em produção.
export function sanitizeParam(v) {
  return String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{4,}/g, "   ").trim();
}

const textParams = (arr) => arr.map((v) => ({ type: "text", text: sanitizeParam(v) }));

/* Envia um template aprovado.
     sendWaTemplate(to, "lembrete_aula", { body: ["Maria", "sex 15/08 às 14:00", "Timóteo"] })

   Opções:
     lang    código do idioma do template (padrão pt_BR)
     header  variáveis do cabeçalho, quando o template tiver {{1}} no header
     body    variáveis do corpo, na ordem em que aparecem ({{1}}, {{2}}, ...)
     buttons [{ index, payload }] — só para botões de resposta rápida com variável   */
export function sendWaTemplate(to, name, { lang = "pt_BR", header = [], body = [], buttons = [] } = {}) {
  const components = [];
  if (header.length) components.push({ type: "header", parameters: textParams(header) });
  if (body.length) components.push({ type: "body", parameters: textParams(body) });
  for (const b of buttons) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(b.index ?? 0),
      parameters: [{ type: "payload", payload: sanitizeParam(b.payload) }],
    });
  }
  return graph("POST", `/${PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "template",
    template: {
      name,
      language: { code: lang },
      ...(components.length ? { components } : {}),
    },
  });
}

/* NÃO EXISTE MAIS: `sendWaTextOrTemplate` — removida em 08/09/2026.

   Ela tentava o texto livre e só caía para o template dentro do `catch`,
   apostando que a Meta devolveria 131047 na hora quando a janela estivesse
   fechada. **Não devolve.** A Meta responde 200, entrega um id de mensagem e
   descarta o envio depois, de forma assíncrona — o erro só aparece no webhook
   de status, que ninguém lia. Resultado: o `catch` nunca rodava, o template
   nunca era usado, e a cobrança sumia sem deixar rastro.

   Custou 88 mensalidades de setembro/2026 marcadas como avisadas sem uma única
   aluna ter recebido. Quem a escola inicia MANDA TEMPLATE, ponto — é o que
   `sendWaTemplate` faz. Não reintroduzir o "tenta texto primeiro". */

// Lista os templates da conta e o status de aprovação de cada um.
export function listWaTemplates() {
  if (!WABA_ID) return Promise.reject(new Error("WA_WABA_ID não configurado"));
  return graph("GET", `/${WABA_ID}/message_templates?limit=100&fields=name,status,language,category,components,rejected_reason`);
}

/* Submete um template para aprovação.
     createWaTemplate({ name, category: "UTILITY", language: "pt_BR", components: [...] })
   category: UTILITY (confirmação, lembrete, cobrança) | MARKETING | AUTHENTICATION.
   Classificar como UTILITY é o que mantém o custo baixo — ver a política de preços. */
export function createWaTemplate({ name, category = "UTILITY", language = "pt_BR", components }) {
  if (!WABA_ID) return Promise.reject(new Error("WA_WABA_ID não configurado"));
  return graph("POST", `/${WABA_ID}/message_templates`, { name, category, language, components });
}

/* Extrai os avisos de ENTREGA do payload do webhook.

   É a única fonte de verdade sobre a mensagem ter chegado: a resposta do envio
   só diz que a Meta aceitou. Cada item traz o `wamid` que o envio devolveu, o
   estado novo (sent → delivered → read, ou failed) e, quando falha, o código do
   erro — 131047 "Re-engagement message" é o de fora da janela de 24h.

   Um mesmo POST pode trazer status de várias mensagens, por isso devolve lista. */
export function parseStatuses(body) {
  try {
    const sts = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
    if (!Array.isArray(sts)) return [];
    return sts.map((s) => {
      const err = s.errors?.[0];
      return {
        wamid: s.id,
        status: s.status, // sent | delivered | read | failed
        to: s.recipient_id || "",
        errorCode: err?.code ?? null,
        errorMsg: err ? String(err.title || err.message || "").slice(0, 400) : null,
      };
    });
  } catch {
    return [];
  }
}

// Extrai a primeira mensagem recebida de um payload de webhook do WhatsApp.
export function parseIncoming(body) {
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return null; // pode ser um evento de status de entrega, ignoramos
    const name = value?.contacts?.[0]?.profile?.name || "";
    const inter = msg.interactive;
    const replyId = inter?.button_reply?.id || inter?.list_reply?.id || msg.button?.payload || "";
    const text =
      msg.text?.body ||
      inter?.button_reply?.title ||
      inter?.list_reply?.title ||
      msg.button?.text ||
      "";
    return { id: msg.id, from: msg.from, name, text, replyId, type: msg.type };
  } catch {
    return null;
  }
}
