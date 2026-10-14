/* ============================================================
   FUNIL DE LEADS — regras puras (Vitor, 14/10/2026)

   Sem banco aqui: o server.js busca a lead, a ficha, as reservas e a conversa
   do robô e pergunta a estas funções em que ponto do caminho ela está. É o
   que deixa testar sem MySQL (test-funil.mjs).

   O caminho de quem chega até virar aluna:

     💬 contato      falou com o robô ou foi anotada pela equipe — sem ficha
     📝 cadastro     tem ficha, mas nenhuma 1ª aula em pé
     🗓️ marcada      reserva de entrada (avulsa ou matrícula) com aula por vir
     🧶 aula         a aula avulsa já passou e ela ainda não fechou o plano
     🎓 matriculada  pagou a matrícula — virou aluna
     ✖ perdida      a equipe deu como perdida (com motivo), ou a ficha foi inativada

   A etapa é calculada, nunca escolhida: ninguém arrasta a lead para
   "matriculada" sem o pagamento existir. O que a equipe decide (perdida,
   origem, próximo contato) vem da própria lead.
   ============================================================ */
import { chaveTelefone } from "./waFluxo.js";

export const ETAPAS = ["contato", "cadastro", "marcada", "aula", "matriculada", "perdida"];

export const ETAPA_TEXTO = {
  contato: "💬 Primeiro contato",
  cadastro: "📝 Cadastro feito",
  marcada: "🗓️ 1ª aula marcada",
  aula: "🧶 Depois da aula avulsa",
  matriculada: "🎓 Matriculada",
  perdida: "✖ Perdida",
};

// Por que a lead foi perdida. `nao_lead` (engano, spam, aluna de outro curso)
// sai das contas do relatório: não era interessada, então não é perda.
export const MOTIVOS_PERDA = {
  preco: "Achou caro",
  horario: "Horário não serve",
  distancia: "Longe / mudou de cidade",
  sem_tempo: "Sem tempo agora",
  sem_resposta: "Parou de responder",
  outra_escola: "Foi para outra escola",
  nao_lead: "Não era lead (engano/spam)",
  outro: "Outro motivo",
};

// De onde ela veio (marketing). null = ninguém sabe ainda — a ficha pede para perguntar.
export const ORIGENS = ["anuncio", "redes", "indicacao", "google", "porta", "evento", "outro"];
export const CANAIS = ["whatsapp", "site", "escola"];

/* A partir de quando as fichas que já existiam entram no funil sozinhas.
   1º/09/2026 é quando a entrada nova (cadastro pelo CPF no robô, taxa de
   matrícula de volta) começou a valer — antes disso a ficha não carregava as
   marcas que contam a história (trialDate, matriculaAt). Lead em aberto
   (status "lead") entra de qualquer data: ela continua sendo lead hoje. */
export const FUNIL_DESDE = "2026-09-01";

const MARCAS_MATRICULA = ["1ª mensalidade", "Matrícula"];
// Marcas de aula que NÃO são entrada: do plano, reposição, aula extra, presente.
const MARCAS_DO_PLANO = ["Mensalista", "Reposição", "Avulsa", "Presente"];

// Dia no relógio de Brasília. `createdAt` vem em UTC: cortar com slice(0, 10)
// joga para o dia seguinte o que aconteceu depois das 21h.
export const diaBR = (d) => (d ? new Date(d).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : null);
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const menor = (...ds) => ds.filter(Boolean).sort()[0] || null;

/* Telefone como a lead guarda: só dígitos, sem o 55 do país. O WhatsApp manda
   "5531999998888"; a ficha tem "(31) 99999-8888". Os dois viram "31999998888",
   que é o que o botão de WhatsApp do painel espera (ele põe o 55 de volta). */
export function telefoneDaLead(numero) {
  let d = String(numero || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d : null;
}
export { chaveTelefone };

/* Reserva de ENTRADA: a 1ª aula de quem chega — a avulsa (R$ 40) ou a da
   matrícula. A avulsa que recebeu baixa no painel troca a marca pela forma de
   pagamento ("Pix", "Dinheiro"…), então também vale a reserva com valor próprio
   que não é aula do plano. Mesma leitura de `aulaAvulsaDe` no painel. */
export function ehReservaDeEntrada(b) {
  const pm = b?.paymentMethod || "";
  if (MARCAS_MATRICULA.includes(pm) || pm === "Aula Avulsa") return true;
  return Number(b?.value) > 0 && !MARCAS_DO_PLANO.includes(pm);
}

// Plano pago: mensalista, ou matrícula paga/convertida (a "matrícula a concluir" também — o dinheiro entrou).
export const virouAluna = (c) =>
  !!c && (c.plan === "mensalista" || c.matriculaStatus === "paga" || c.matriculaStatus === "convertida");

/* A ficha entra no funil sozinha? Lead em aberto sempre; quem passou pela
   entrada (1ª aula, matrícula) só se a ficha nasceu depois de FUNIL_DESDE —
   senão as 181 mensalistas antigas virariam "matrículas" de outubro.
   Mensalista com status "lead" é aluna que caiu de status (caso Camila,
   23/09/2026), não lead. */
export function entraNoFunil(c, desde = FUNIL_DESDE) {
  if (!c) return false;
  if (c.status === "lead") return c.plan !== "mensalista";
  if (c.status === "cancelado" || c.status === "inativo") return false;
  const passouPelaEntrada = !!(c.trialDate || c.matriculaAt || c.matriculaPainelAt || c.firstClass);
  return passouPelaEntrada && diaBR(c.createdAt) >= desde;
}

// Passo do robô em que a conversa parou, em poucas palavras (o cartão é pequeno).
const PASSO_CURTO = {
  start: "só mandou mensagem",
  unit: "escolha da unidade",
  slot: "escolha do horário",
  slot2: "escolha dos outros horários",
  confirm: "confirmação do horário",
  cpf: "CPF",
  name: "nome",
  nameok: "confirmação do nome",
  wpp: "WhatsApp de contato",
  email: "e-mail",
  nasc: "data de nascimento",
  plano: "escolha do plano",
  avulsaok: "confirmação da avulsa",
  cupom: "código de promoção",
  cupomcod: "código de promoção",
  cobranca: "Pix",
};
export function descreverConversa(conv) {
  if (!conv) return null;
  const passo = PASSO_CURTO[conv.step];
  if (!passo) return null;
  return conv.step === "start" ? passo : `parou em: ${passo}`;
}

/* ----- /agendar: quem deixou o WhatsApp e não chegou ao Pix (fase 2, 14/10/2026) -----
   Os passos de uma visita ao /agendar, na ordem. A visita guarda o mais
   longe que chegou — é o que o relatório "onde param no site" conta. */
export const PASSOS_SITE = ["inicio", "unidade", "horario", "dados", "pix", "pago"];
export const passoMaisLonge = (a, b) =>
  (PASSOS_SITE.indexOf(b) > PASSOS_SITE.indexOf(a) ? b : a);

// Quanto tempo ela pode estar AINDA no site, no meio do pagamento, sem ser chamada de desistente.
export const SITE_AGORA_MIN = 30;

const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
// "qui 16/10 às 14:00 · Ipatinga" — a aula que ela escolheu no site
export function descreverAulaSite(slot) {
  if (!slot?.date) return null;
  const [y, m, d] = slot.date.split("-").map(Number);
  const dow = DIA_SEMANA.at(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  return `${dow} ${dm(slot.date)}${slot.time ? ` às ${slot.time}` : ""}${slot.unit ? ` · ${slot.unit}` : ""}`.slice(0, 80);
}

/* Ela deixou nome e WhatsApp no /agendar e não gerou o Pix. Nos primeiros
   30 minutos pode estar só preenchendo o pagamento — o cartão diz "agora"
   para a equipe não chamar quem está no meio da compra. */
export function descreverSite(lead, agora = Date.now()) {
  if (!lead?.siteEm) return null;
  const min = (agora - new Date(lead.siteEm).getTime()) / 60000;
  if (min < SITE_AGORA_MIN) return "marcando pelo site agora";
  return `parou no site, no plano e pagamento${lead.siteAula ? ` · aula ${lead.siteAula}` : ""}`;
}

const tempo = (d) => (d ? new Date(d).getTime() : 0);

/* Onde a lead está agora e até onde ela já chegou.

   `marcouAt` / `pagouAt` / `ganhaAt` são os marcos do relatório. Eles só
   andam para a frente — quem pagou também marcou, mesmo que a Inêz a tenha
   matriculado na hora, sem reserva de 1ª aula — e nunca ficam antes do dia em
   que ela entrou no funil. O menor entre o que já estava gravado e o que os
   fatos mostram hoje vence: a reserva que caiu sem Pix pode sumir da agenda,
   mas ela chegou a marcar.

   `ganhaAt` é o único que pode voltar a null: se a matrícula foi devolvida, ela
   não é aluna. */
export function situacaoDaLead({ lead, client = null, reservas = [], conversa = null, hoje, agora = Date.now() }) {
  const entrou = diaBR(lead.createdAt) || hoje;
  const naoAntes = (d) => (d && d < entrou ? entrou : d);

  const entrada = reservas.filter(ehReservaDeEntrada).sort((a, b) => tempo(a.createdAt) - tempo(b.createdAt));
  const vivas = entrada.filter((b) => b.status !== "cancelada");
  const ganhou = virouAluna(client);

  const pagas = entrada.filter((b) => b.paid);
  const pagouReal = menor(...pagas.map((b) => (/^\d{4}-\d{2}-\d{2}/.test(b.paymentDate || "") ? b.paymentDate.slice(0, 10) : diaBR(b.createdAt))));
  const ganhaAt = ganhou ? naoAntes(client.matriculaAt || client.matriculaPainelAt || lead.ganhaAt || hoje) : null;
  const pagouAt = naoAntes(menor(pagouReal, lead.pagouAt)) || ganhaAt;
  const marcouAt = naoAntes(menor(entrada.length ? diaBR(entrada[0].createdAt) : null, lead.marcouAt)) || pagouAt;

  let etapa;
  let detalhe = null;
  if (ganhou) {
    etapa = "matriculada";
    detalhe = client.weeklyFreq ? `plano ${client.weeklyFreq}x por semana` : "mensalista";
  } else if (lead.perdidaAt) {
    etapa = "perdida";
    detalhe = MOTIVOS_PERDA[lead.motivoPerda] || null;
  } else if (client && (client.status === "cancelado" || client.status === "inativo")) {
    etapa = "perdida";
    detalhe = "ficha inativada";
  } else {
    const porData = (a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""));
    const futuras = vivas.filter((b) => b.date >= hoje).sort(porData);
    const passadas = vivas.filter((b) => b.date < hoje).sort(porData).reverse();
    const veio = (b) => b.paid || b.attendance === "presente" || b.status === "concluida";
    if (futuras.length) {
      // a reserva "de verdade" é a que tem valor (os outros horários da matrícula vão com 0)
      const b = futuras.find((x) => Number(x.value) > 0) || futuras[0];
      const tipo = MARCAS_MATRICULA.includes(b.paymentMethod) ? "matrícula" : "avulsa";
      etapa = "marcada";
      detalhe = `${tipo} · ${b.paid ? "paga" : "Pix pendente"} · aula ${b.date === hoje ? "hoje" : dm(b.date)}`;
    } else if (passadas.some(veio)) {
      const b = passadas.find(veio);
      etapa = "aula";
      detalhe = b.attendance === "falta" ? `faltou na aula de ${dm(b.date)}`
        : !b.paid ? `aula de ${dm(b.date)} · falta pagar`
        : `aula de ${dm(b.date)}`;
    } else if (client) {
      etapa = "cadastro";
      detalhe = passadas.length ? `não veio nem pagou a aula de ${dm(passadas[0].date)}`
        : entrada.length ? "reserva caiu sem pagamento"
        : "sem aula marcada";
    } else {
      etapa = "contato";
      // o que ela fez por último: a conversa no robô ou a tentativa no site
      const noSite = lead.siteEm && (!conversa?.lastInboundAt || new Date(lead.siteEm) >= new Date(conversa.lastInboundAt));
      detalhe = (noSite ? descreverSite(lead, agora) : null) || descreverConversa(conversa) || descreverSite(lead, agora);
    }
  }
  return { etapa, detalhe, marcouAt, pagouAt, ganhaAt };
}

/* ----- origem (marketing) ----- */

const FONTES_META = ["facebook", "fb", "instagram", "ig", "meta", "an", "msg", "messenger", "threads"];
const MEIO_PAGO = /(cpc|ppc|cpm|paid|pago|ads?|anuncio|anúncio|patrocinado)/;

/* Origem a partir do que o site guardou da visita (utm_*, fbclid, gclid,
   referrer). Sem UTM o fbclid sozinho NÃO diz anúncio: o Instagram põe fbclid
   em qualquer link, até o da bio — por isso vira "redes". Para o anúncio
   aparecer como anúncio, a campanha precisa levar utm_medium=paid (ou cpc). */
export function origemDaUtm(u) {
  if (!u || typeof u !== "object") return null;
  const src = String(u.utm_source || "").toLowerCase().trim();
  const med = String(u.utm_medium || "").toLowerCase().trim();
  const ref = String(u.referrer || "").toLowerCase();
  if (u.gclid || src.includes("google")) return MEIO_PAGO.test(med) || u.gclid ? "anuncio" : "google";
  if (FONTES_META.includes(src)) return MEIO_PAGO.test(med) || src === "meta" ? "anuncio" : "redes";
  if (src.includes("indica") || med.includes("indica")) return "indicacao";
  if (src) return MEIO_PAGO.test(med) ? "anuncio" : "outro";
  if (u.fbclid || /instagram|facebook|threads|fb\.me/.test(ref)) return "redes";
  if (/google\./.test(ref)) return "google";
  return null;
}

/* Anúncio de clique para o WhatsApp: a Meta manda junto da 1ª mensagem um
   `referral` com o anúncio (ou a publicação) de onde ela veio. */
export function origemDoAnuncioWa(ref) {
  if (!ref || typeof ref !== "object") return null;
  const tipo = String(ref.source_type || "").toLowerCase();
  return {
    origem: tipo === "ad" ? "anuncio" : "redes",
    detalhe: String(ref.headline || "").trim().slice(0, 200) || null,
    utm: {
      fonte: "whatsapp_anuncio",
      source_type: ref.source_type || null,
      source_id: ref.source_id || null,
      source_url: ref.source_url || null,
      headline: ref.headline || null,
      ctwa_clid: ref.ctwa_clid || null,
    },
  };
}

// O que o site manda é dado de fora: só as chaves conhecidas, texto curto.
const CHAVES_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "referrer", "landing", "em"];
export function limparUtm(u) {
  if (!u || typeof u !== "object") return null;
  const out = {};
  for (const k of CHAVES_UTM) {
    const v = u[k];
    if (v != null && String(v).trim()) out[k] = String(v).trim().slice(0, k === "fbclid" || k === "gclid" ? 120 : 150);
  }
  return Object.keys(out).length ? out : null;
}

// JSON para a coluna `utm` (1000 caracteres). Se não couber, larga primeiro o
// que menos diz (os ids de clique), nunca corta o JSON no meio.
export function utmParaGravar(u) {
  if (!u) return null;
  const o = { ...u };
  for (const k of ["gclid", "fbclid", "ctwa_clid", "source_url", "landing", "referrer"]) {
    if (JSON.stringify(o).length <= 1000) break;
    delete o[k];
  }
  const s = JSON.stringify(o);
  return s.length <= 1000 ? s : null;
}
