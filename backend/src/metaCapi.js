// API de Conversões da Meta (anúncios) — o lado servidor do Pixel.
// O navegador dispara o evento pelo Pixel e o backend manda o MESMO evento
// (mesmo event_name + event_id) para a Meta; ela junta os dois e conta uma vez.
// Isso recupera as conversões que o Pixel perde para bloqueador e iOS.
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
import https from "https";
import crypto from "crypto";

const PIXEL_ID = process.env.META_PIXEL_ID || "";
const TOKEN = process.env.META_CAPI_TOKEN || "";
const GRAPH_VERSION = process.env.WA_GRAPH_VERSION || "v26.0";
// Código da aba "Eventos de teste" do Gerenciador de Eventos. Só para validar;
// em produção deixe vazio, senão os eventos não contam para as campanhas.
const TEST_CODE = process.env.META_CAPI_TEST_CODE || "";

export const capiConfigured = () => !!(PIXEL_ID && TOKEN);

const sha = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? crypto.createHash("sha256").update(s).digest("hex") : undefined;
};
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const telefone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (!d) return "";
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
};

/* Dados de navegador (cookies _fbp/_fbc, IP, user agent) só existem na hora em
   que a aluna está no site. O pagamento é confirmado depois — às vezes pelo
   webhook do Sicredi, sem navegador nenhum — então guardamos esses dados por
   reserva quando o Lead nasce e reaproveitamos no Purchase. Memória basta:
   se o servidor reiniciar, o Purchase sai só com telefone/email, o que ainda casa. */
const contextoPorReserva = new Map();
const CONTEXTO_TTL = 48 * 3600_000;

function cookie(req, nome) {
  const m = String(req?.headers?.cookie || "").match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export function contextoDoNavegador(req) {
  if (!req) return {};
  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "")
    .split(",")[0].trim();
  return {
    ip: ip || undefined,
    ua: req.headers["user-agent"] || undefined,
    fbp: cookie(req, "_fbp"),
    fbc: cookie(req, "_fbc"),
    url: req.headers.referer || undefined,
  };
}

export function guardarContexto(bookingId, ctx) {
  if (!bookingId || !ctx) return;
  contextoPorReserva.set(bookingId, { ...ctx, em: Date.now() });
  for (const [k, v] of contextoPorReserva) if (Date.now() - v.em > CONTEXTO_TTL) contextoPorReserva.delete(k);
}
export const contextoGuardado = (bookingId) => contextoPorReserva.get(bookingId) || {};

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        host: "graph.facebook.com",
        path: `/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(raw);
          else reject(new Error(`Meta CAPI ${res.statusCode}: ${raw.slice(0, 300)}`));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/* Envia um evento. Nunca lança: anúncio é acessório, a matrícula não pode
   falhar porque a Meta está fora do ar. */
export async function enviarEventoMeta({ eventName, eventId, pessoa = {}, ctx = {}, custom }) {
  if (!capiConfigured()) return;
  const [primeiro, ...resto] = semAcento(pessoa.nome).trim().split(/\s+/);
  const user_data = {
    ph: sha(telefone(pessoa.telefone)),
    em: sha(pessoa.email),
    fn: sha(primeiro),
    ln: sha(resto.join("")),
    db: sha(String(pessoa.nascimento || "").replace(/\D/g, "")), // AAAAMMDD
    ct: sha(semAcento(pessoa.cidade).replace(/\s+/g, "")),
    st: pessoa.cidade ? sha("mg") : undefined,
    country: sha("br"),
    external_id: sha(pessoa.id),
    client_ip_address: ctx.ip,
    client_user_agent: ctx.ua,
    fbp: ctx.fbp,
    fbc: ctx.fbc,
  };
  for (const k of Object.keys(user_data)) if (!user_data[k]) delete user_data[k];
  const evento = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: ctx.url || "https://fiosquecuram.com.br/agendar",
    user_data,
    ...(custom ? { custom_data: custom } : {}),
  };
  try {
    await post({ data: [evento], ...(TEST_CODE ? { test_event_code: TEST_CODE } : {}) });
  } catch (e) {
    console.warn(`[meta-capi] ${eventName} ${eventId} não saiu: ${e.message}`);
  }
}
