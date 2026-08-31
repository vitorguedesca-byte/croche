import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";
import { mkdirSync } from "fs";
import {
  prisma,
  UNITS,
  PROFS,
  VALOR_PADRAO,
  CAPACITY_PADRAO,
  profFor,
} from "./prismaClient.js";
import {
  PGTO_PLANO,
  JUROS_DIA_PERCENTUAL,
  MULTA_ATRASO_REAIS,
  checarRegras,
  diaDoMes,
  encargosDaMensalidade,
  hhmm,
  janelaEscala,
  mesmaSemana,
  REPO_MAX_MES,
  REPO_HORAS_MIN,
  REPO_MANHA_ATE,
  segundaDaSemana,
  somarComp,
  tetoSemanal,
  tipoMensalista,
} from "./regrasAula.js";
import { padronizarNome } from "./nomes.js";
import {
  PENDENCIA_POR_PASSO,
  WA_ATENDENTE,
  WA_PORTAL_URL,
  textoConversaParada,
  textoLembreteAula,
  textoAtendenteHumano,
  textoCobrancaReserva,
  textoHoldExpirado,
  textoLembreteHold,
  textoMatriculaConfirmada,
  textoMensalidadeAVencer,
  textoMensalidadeEmAtraso,
} from "./textosEscola.js";
import { sicrediConfigured, sicrediMissing, createCharge, getCharge, isPaidStatus, extractPix } from "./sicredi.js";
import { waConfigured, waVerify, sendWaText, sendWaTextOrTemplate, sendWaButtons, sendWaList, parseIncoming, normalizePhone } from "./wa.js";

// pasta de fotos de depoimentos (servida estaticamente pelo Vite via frontend/public)
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPO_DIR = process.env.DEPO_DIR || join(__dirname, "../../frontend/public/depoimentos");
mkdirSync(DEPO_DIR, { recursive: true });

const depoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DEPO_DIR),
    filename: (_req, file, cb) => {
      const safe = Date.now() + extname(file.originalname).toLowerCase();
      cb(null, safe);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
  },
});

const app = express();
app.use(cors());
app.use(express.json());
// Garantir UTF-8 em todas as respostas JSON
app.use((_req, res, next) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); next(); });

/* ===================== AUTENTICAÇÃO DO PAINEL ADMIN =====================
   Protege as rotas do painel. Só quem tem conta (usuário+senha) acessa.
   Rotas públicas (site, portal do aluno, webhook) ficam liberadas. */
const adminTokens = new Map(); // token -> { username, role } (sessões em memória)
const genToken = () => crypto.randomBytes(24).toString("hex");
// Enquanto não houver NENHUM admin cadastrado, o painel fica aberto (primeiro uso),
// para não travar o sistema antes de você criar o acesso. Depois de criar, passa a exigir login.
let hasAdmin = false;
prisma.adminUser.count().then((n) => { hasAdmin = n > 0; }).catch(() => {});
// rotas que NÃO exigem login (site público, portal do aluno, webhooks)
const PUBLIC_API = [
  ["GET", /^\/api\/health$/],
  ["GET", /^\/api\/admin\/exists$/],
  ["POST", /^\/api\/admin\/(login|setup|register)$/],
  ["GET", /^\/api\/slots\/available$/],
  ["POST", /^\/api\/bookings$/],
  ["POST", /^\/api\/bookings\/\d+\/(invoice|pay)$/],
  ["PATCH", /^\/api\/bookings\/\d+$/],
  ["POST", /^\/api\/auth\/(check|set-pin|login)$/],
  [null, /^\/api\/portal\//],
  ["GET", /^\/api\/testimonials$/],
  ["GET", /^\/api\/settings$/],
  [null, /^\/api\/wa\/webhook$/],
  // o Sicredi acrescenta "/pix" à URL cadastrada na hora de notificar
  [null, /^\/api\/sicredi\/webhook(\/pix)?$/],
];
const isPublicApi = (req) => PUBLIC_API.some(([m, re]) => (!m || m === req.method) && re.test(req.path));

/* O que a INSTRUTORA pode chamar. É uma lista fechada e só de leitura: a agenda
   dela é para consultar, não para operar. Qualquer outra rota — inclusive
   qualquer POST/PATCH/DELETE — cai no 403 abaixo, mesmo que alguém monte a
   chamada na mão fora da tela. A permissão mora aqui, não no botão. */
const INSTRUTORA_API = [
  ["GET", /^\/api\/state$/],
  ["GET", /^\/api\/settings$/],
  ["GET", /^\/api\/slots\/available$/],
  ["GET", /^\/api\/testimonials$/],
  ["POST", /^\/api\/admin\/logout$/],
];
const isInstrutoraApi = (req) => INSTRUTORA_API.some(([m, re]) => m === req.method && re.test(req.path));

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next(); // arquivos estáticos etc.
  if (!hasAdmin) return next(); // primeiro uso: sem admin cadastrado, tudo liberado
  if (isPublicApi(req)) return next();
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const sess = tok ? adminTokens.get(tok) : null;
  if (!sess) return res.status(401).json({ error: "Acesso restrito ao painel. Faça login." });
  req.admin = sess;
  if (sess.role === "instrutora" && !isInstrutoraApi(req)) {
    return res.status(403).json({ error: "Seu acesso é apenas de consulta à Agenda." });
  }
  return next();
});

// "hoje" pelo relógio de Brasília (o servidor pode rodar em UTC): com
// toISOString, das 21h à meia-noite o dia já virava e as aulas da noite eram
// tratadas como passadas. ('sv-SE' formata como YYYY-MM-DD.)
const todayISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
function addDays(iso, n) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const onlyDigits = (s) => (s || "").replace(/\D/g, "");
/* Etiquetas válidas: nenhuma. A única que existia ("Lead") saiu do sistema em
   22/08/2026 — quem entra pelo site já marca a experimental, então "cadastrou e
   não prosseguiu" deixou de ser um estado real.
   A coluna `tags` continua no banco e o filtro abaixo simplesmente ignora o que
   houver lá: nada é apagado, e nada antigo volta a aparecer na tela. */
const VALID_TAGS = [];
const parseTags = (t) => {
  try {
    const a = JSON.parse(t || "[]");
    return Array.isArray(a) ? a.filter((x) => VALID_TAGS.includes(x)) : [];
  } catch {
    return [];
  }
};

// quantas reservas ativas (não canceladas) um slot tem
async function occupancy(slotId) {
  return prisma.booking.count({
    where: { slotId, status: { not: "cancelada" } },
  });
}

/* Multa e juros só entram com SETTINGS.cobrarEncargos LIGADA. Desligada (o
   padrão), toda mensalidade custa o valor original — mesma ideia das outras
   travas de cobrança: a regra existe no código e a Inêz decide quando passa a
   valer. Sem esta chave, subir os encargos jogaria a multa de uma vez sobre
   todas as mensalidades já vencidas. */
const semEncargos = (inv) => ({ dias: 0, multaCents: 0, jurosCents: 0, totalCents: inv.amountCents, atrasada: false });
const encargosDe = (inv, data) =>
  SETTINGS.cobrarEncargos ? encargosDaMensalidade(inv, data) : semEncargos(inv);

/* Acrescenta a conta do atraso a uma mensalidade, para a tela não precisar
   repetir o cálculo. Só faz sentido em cobrança ainda em aberto: paga ou
   cancelada não acumula nada. Valores em reais, já prontos para exibir. */
const comEncargos = (inv) => {
  if (!inv) return inv;
  const e = inv.status === "pendente" ? encargosDe(inv, todayISO()) : semEncargos(inv);
  /* O QR guardado pode estar cobrando um valor antigo — foi emitido antes de a
     multa entrar. A tela precisa saber disso para oferecer um código novo em
     vez de mostrar um QR que cobra menos do que a conta ao lado dele. */
  const pixAtualizado = !inv.pixCode
    ? false
    : encargosDaMensalidade(inv, inv.encargosAte || inv.dueDate).totalCents === e.totalCents;
  return {
    ...inv,
    pixAtualizado,
    encargos: {
      dias: e.dias,
      multa: e.multaCents / 100,
      juros: e.jurosCents / 100,
      total: e.totalCents / 100,
      atrasada: e.atrasada,
    },
  };
};

/* ---------- regras de marcação do mensalista (ver src/regrasAula.js) ---------- */

/* Aulas ativas da aluna a partir de `desde`. Alimenta duas regras: a janela da
   escala (precisa das aulas de hoje em diante) e o teto semanal (precisa da
   semana INTEIRA da data escolhida, cuja segunda pode já ter passado). */
async function aulasAtivasDe(client, desde = todayISO()) {
  return prisma.booking.findMany({
    where: { clientName: client.name, status: { not: "cancelada" }, date: { gte: desde } },
    select: { id: true, date: true, time: true, status: true, paymentMethod: true },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });
}

/* Aplica as regras antes de criar a aula. Lança { code: 409 } quando barra.
   `forcar` existe só para o painel: a Inêz vê o aviso na tela e decide passar
   por cima (ela é a dona da agenda). O portal da aluna nunca manda `forcar`. */
async function exigirRegras(client, alvo, { forcar = false, ignorarJanela = false, ignorarTeto = false } = {}) {
  if (forcar) return { ok: true, codigo: "", motivo: "" };
  const hoje = todayISO();
  const precisaJanela = !ignorarJanela && tipoMensalista(client) === "escala";
  const precisaTeto = !ignorarTeto && !!Number(client?.weeklyFreq);
  // O teto olha a semana do alvo, que pode ter começado antes de hoje.
  const desde = precisaTeto
    ? [hoje, segundaDaSemana(alvo?.date)].sort()[0]
    : hoje;
  const r = checarRegras(client, alvo, {
    hoje,
    aulasAtivas: precisaJanela || precisaTeto ? await aulasAtivasDe(client, desde) : [],
    ignorarJanela,
    ignorarTeto,
  });
  if (!r.ok) throw Object.assign(new Error(r.motivo), { code: 409, codigo: r.codigo });
  return r;
}

/* ===================== REPOSIÇÃO (mensalistas) =====================
   Regras combinadas com a Inêz:
   1. Reposição não é obrigatória e não há vaga reservada — só entra em turma
      que já tem vaga livre, aberta por outra aluna que liberou a aula.
   2. A vaga só conta como liberada se o aviso vier com antecedência:
      - aula antes das 10:00 → até 23:59 do dia anterior;
      - demais horários      → no mínimo 6 horas antes.
   3. No máximo 2 créditos por mês (competência da aula liberada), mesmo que
      a aluna libere 3 ou mais — e, do outro lado, no máximo 2 aulas de
      reposição MARCADAS dentro do mesmo mês. Sem esse segundo teto, quem
      juntasse créditos do mês anterior (que valem até o fim do mês seguinte)
      conseguiria repor 4 vezes num mês só.
   4. O crédito vale até o fim do mês seguinte ao da aula liberada.
   5. Só para mensalista ativa e com mensalidade em dia — esta última só vale
      com SETTINGS.travaAtraso ligada (hoje desligada, até a Inêz confirmar).
   6. Quem rompe com o curso (status "cancelado") não ganha nem usa crédito.
   7. O crédito só fica USÁVEL depois que a data da aula liberada passa: repor é
      remarcar uma aula que já deixou de acontecer, não adiantar a próxima.
   8. Não se repõe a reposição: liberar a aula de reposição encerra o crédito.
      (A Inêz desfazendo pelo painel — excluir a aula — ainda devolve.) */
// REPO_MAX_MES, REPO_HORAS_MIN e REPO_MANHA_ATE vêm de regrasAula.js (ver import).

// O prazo é do relógio da aluna, não do UTC do servidor. 'sv-SE' formata ISO.
const agoraBR = () =>
  new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T");

// 'YYYY-MM-DDTHH:MM:SS' — instante limite para liberar a aula e ganhar crédito
function prazoLiberacao(date, time) {
  if (time < REPO_MANHA_ATE) return `${addDays(date, -1)}T23:59:59`;
  const [h, m] = time.split(":").map(Number);
  let min = h * 60 + m - REPO_HORAS_MIN * 60;
  let d = date;
  while (min < 0) { min += 1440; d = addDays(d, -1); }
  return `${d}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
}
const liberouATempo = (date, time, agora = agoraBR()) => agora <= prazoLiberacao(date, time);

// 'YYYY-MM-DD' → '27/08', para as mensagens ficarem legíveis
const fmtDiaBR = (d) => {
  const m = String(d || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : d;
};

// 'YYYY-MM' → 'julho de 2026', para as mensagens ficarem legíveis
const compPorExtenso = (comp) => {
  const [y, m] = comp.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
};

// último dia do mês seguinte à competência 'YYYY-MM'
function fimDoMesSeguinte(comp) {
  const [y, m] = comp.split("-").map(Number);
  const fim = new Date(Date.UTC(y, m + 1, 0)); // dia 0 do mês m+2 = último dia de m+1
  return fim.toISOString().slice(0, 10);
}

// A mensalidade está em dia se não há boleto pendente já vencido.
async function mensalidadeEmDia(clientId) {
  const atrasadas = await prisma.invoice.count({
    where: { clientId, status: "pendente", dueDate: { lt: todayISO() } },
  });
  return atrasadas === 0;
}

// { ok, motivo } — se a aluna pode ganhar/usar crédito de reposição agora
async function elegivelReposicao(client) {
  if (client.status === "cancelado")
    return { ok: false, motivo: "Inscrição cancelada — não há direito a reposição." };
  if (client.plan !== "mensalista")
    return { ok: false, motivo: "A reposição é um benefício das alunas mensalistas." };
  // Trava desligada por ora: mensalidade vencida não bloqueia a reposição até a
  // Inêz confirmar que quer cobrar assim. Religa em Configurações.
  if (SETTINGS.travaAtraso && !(await mensalidadeEmDia(client.id)))
    return { ok: false, motivo: "Há mensalidade em atraso. Regularize para poder repor." };
  return { ok: true, motivo: "" };
}

/* Crédito pronto para usar: não gasto, dentro da validade e — a regra nova — com
   a aula de origem JÁ passada. Antes disso ele existe, mas fica "aguardando":
   a aluna vê o crédito na tela e sabe a partir de quando pode marcar. */
const creditoValido = (t) => ({ usedBookingId: null, expiresOn: { gte: t }, originDate: { lt: t } });
// A partir de quando o crédito pode ser usado (dia seguinte ao da aula liberada)
const creditoLiberaEm = (c) => addDays(c.originDate, 1);

// Quantas aulas de reposição a aluna já tem marcadas no mês 'YYYY-MM'.
// Conta pela data da aula reposta (é assim que ela enxerga "duas por mês");
// aula cancelada não conta, então liberar a reposição devolve a vaga do mês.
async function reposicoesNoMes(client, comp) {
  return prisma.booking.count({
    where: {
      clientName: client.name,
      paymentMethod: "Reposição",
      status: { not: "cancelada" },
      date: { gte: `${comp}-01`, lte: `${comp}-31` },
    },
  });
}

// Saldo + histórico, já classificando cada crédito para a tela
async function resumoReposicao(client) {
  const t = todayISO();
  const compAtual = t.slice(0, 7);
  const [eleg, creditos, marcadasNoMes] = await Promise.all([
    elegivelReposicao(client),
    prisma.makeupCredit.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" } }),
    reposicoesNoMes(client, compAtual),
  ]);
  const marcados = creditos.map((c) => ({
    ...c,
    // "aguardando" = a aula liberada ainda não chegou; vira "disponivel" no dia seguinte
    situacao: c.usedBookingId ? "usado"
      : c.expiresOn < t ? "expirado"
      : c.originDate >= t ? "aguardando"
      : "disponivel",
    liberaEm: creditoLiberaEm(c),
  }));
  const aguardando = marcados.filter((c) => c.situacao === "aguardando");
  return {
    elegivel: eleg.ok,
    motivo: eleg.motivo,
    saldo: marcados.filter((c) => c.situacao === "disponivel").length,
    // créditos que existem mas ainda não podem ser usados, e quando o 1º libera
    aguardando: aguardando.length,
    aguardandoDesde: aguardando.map((c) => c.liberaEm).sort()[0] || null,
    creditos: marcados,
    // teto do mês corrente, para a tela avisar antes de a aluna tentar marcar
    mes: {
      competencia: compAtual,
      marcadas: marcadasNoMes,
      restantes: Math.max(0, REPO_MAX_MES - marcadasNoMes),
    },
    regras: {
      maxPorMes: REPO_MAX_MES,
      horasMin: REPO_HORAS_MIN,
      manhaAte: REPO_MANHA_ATE,
    },
  };
}

// Concede o crédito quando a aluna libera a aula. Devolve o crédito ou null
// (com o motivo) — liberar fora do prazo continua valendo, só não gera crédito.
async function concederCredito(client, booking) {
  const eleg = await elegivelReposicao(client);
  if (!eleg.ok) return { credito: null, motivo: eleg.motivo };
  if (!liberouATempo(booking.date, booking.time))
    return {
      credito: null,
      motivo: booking.time < REPO_MANHA_ATE
        ? "Aula da manhã precisa ser liberada até 23:59 do dia anterior para gerar crédito."
        : `Aviso com menos de ${REPO_HORAS_MIN}h de antecedência não gera crédito de reposição.`,
    };
  const competencia = booking.date.slice(0, 7);
  const noMes = await prisma.makeupCredit.count({ where: { clientId: client.id, competencia } });
  if (noMes >= REPO_MAX_MES)
    return { credito: null, motivo: `Você já atingiu o limite de ${REPO_MAX_MES} reposições de ${compPorExtenso(competencia)}.` };
  const credito = await prisma.makeupCredit.create({
    data: {
      clientId: client.id,
      competencia,
      expiresOn: fimDoMesSeguinte(competencia),
      originBookingId: booking.id,
      originDate: booking.date,
      // originTime é VARCHAR(5): hora solta do banco ("09:00:00", faixa
      // inteira) estourava a coluna e derrubava a liberação da vaga.
      originTime: hhmm(booking.time) || String(booking.time || "").slice(0, 5),
    },
  });
  return { credito, motivo: "" };
}

// Marca uma aula de reposição consumindo o crédito mais antigo ainda válido.
// Lança { code, message } para o wrap devolver o status certo.
// A reposição segue as MESMAS regras da marcação normal (teto da semana e a
// janela da escala) — foi assim que a Inêz pediu: remarcar não é porta de fuga.
async function marcarReposicao(client, slotId, { forcar = false } = {}) {
  const eleg = await elegivelReposicao(client);
  if (!eleg.ok) throw Object.assign(new Error(eleg.motivo), { code: 403 });
  const t = todayISO();
  const credito = await prisma.makeupCredit.findFirst({
    where: { clientId: client.id, ...creditoValido(t) },
    orderBy: { expiresOn: "asc" }, // gasta primeiro o que vence antes
  });
  if (!credito) {
    // Distingue "não tem crédito" de "tem, mas a aula liberada ainda não chegou" —
    // são situações bem diferentes para quem está olhando a tela.
    const esperando = await prisma.makeupCredit.findFirst({
      where: { clientId: client.id, usedBookingId: null, expiresOn: { gte: t }, originDate: { gte: t } },
      orderBy: { originDate: "asc" },
    });
    if (esperando)
      throw Object.assign(
        new Error(`Sua aula de ${fmtDiaBR(esperando.originDate)} ainda não aconteceu. A reposição pode ser marcada a partir de ${fmtDiaBR(creditoLiberaEm(esperando))}. 💚`),
        { code: 409 }
      );
    throw Object.assign(new Error("Você não tem crédito de reposição disponível."), { code: 409 });
  }

  const slot = await prisma.slot.findUnique({ where: { id: Number(slotId) } });
  if (!slot) throw Object.assign(new Error("Horário não encontrado."), { code: 404 });
  if (slot.date < t) throw Object.assign(new Error("Não dá para repor em uma aula que já passou."), { code: 400 });
  // A reposição não é aula do plano: não ocupa vaga do teto semanal 1x/2x.
  await exigirRegras(client, slot, { forcar, ignorarTeto: true });
  // Teto de reposições dentro do mês da aula escolhida
  const compAula = slot.date.slice(0, 7);
  if ((await reposicoesNoMes(client, compAula)) >= REPO_MAX_MES)
    throw Object.assign(
      new Error(`Você já tem ${REPO_MAX_MES} aulas de reposição marcadas em ${compPorExtenso(compAula)}. Escolha uma data do mês seguinte ou chame a gente no WhatsApp.`),
      { code: 409 }
    );
  const dup = await prisma.booking.findFirst({
    where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } },
  });
  if (dup) throw Object.assign(new Error("Você já tem essa aula marcada."), { code: 400 });
  // não há vaga reservada para reposição: só entra se a turma tiver vaga livre
  if ((await occupancy(slot.id)) >= (slot.capacity || 1))
    throw Object.assign(new Error("Turma lotada — não há vaga de reposição nesse horário."), { code: 409 });

  const booking = await prisma.booking.create({
    data: {
      clientName: client.name, phone: client.phone || "", unit: slot.unit,
      date: slot.date, time: slot.time, prof: slot.prof || profFor(slot.unit),
      slotId: slot.id, status: "confirmada", value: 0, paid: true, paymentMethod: "Reposição",
      paymentDate: t,
    },
  });
  await prisma.makeupCredit.update({
    where: { id: credito.id },
    data: { usedBookingId: booking.id, usedAt: t },
  });
  return booking;
}

/* Aula extra: caminho separado da reposição — não consome nem gera crédito, e
   não ocupa vaga do teto semanal do plano (é aula ALÉM do plano, comprada).

   Dois caminhos, de propósito:
   • Portal  → `passe: true`. A aluna comprou pelo Pix antes de escolher o
     horário, então precisa ter um ExtraPass "pago" e não usado. É ele que vira
     o valor da aula — nada de aula extra de graça pela porta do portal.
   • Painel  → sem passe. É a cortesia que a Inêz combina no WhatsApp: entra
     confirmada, com valor 0, sem cobrança. */
async function marcarAulaExtra(client, slotId, { forcar = false, passe = false } = {}) {
  if (client.status === "cancelado")
    throw Object.assign(new Error("Inscrição cancelada. Chame a gente no WhatsApp."), { code: 403 });
  const t = todayISO();

  let pass = null;
  if (passe) {
    pass = await passeExtraDisponivel(client.id);
    if (!pass)
      throw Object.assign(new Error("Você não tem aula extra paga para marcar. Compre uma no seu portal."), { code: 409 });
  }

  const slot = await prisma.slot.findUnique({ where: { id: Number(slotId) } });
  if (!slot) throw Object.assign(new Error("Horário não encontrado."), { code: 404 });
  if (slot.date < t) throw Object.assign(new Error("Escolha uma aula futura."), { code: 400 });
  // A janela da escala e o teto semanal não se aplicam: a aula extra é
  // justamente uma aula fora do plano, comprada à parte.
  await exigirRegras(client, slot, { forcar, ignorarJanela: true, ignorarTeto: true });
  const dup = await prisma.booking.findFirst({
    where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } },
  });
  if (dup) throw Object.assign(new Error("Você já tem essa aula marcada."), { code: 400 });
  if ((await occupancy(slot.id)) >= (slot.capacity || 1))
    throw Object.assign(new Error("Turma lotada."), { code: 409 });

  const booking = await prisma.booking.create({
    data: {
      clientName: client.name, phone: client.phone || "", unit: slot.unit,
      date: slot.date, time: slot.time, prof: slot.prof || profFor(slot.unit),
      slotId: slot.id, status: "confirmada", value: pass ? pass.amountCents / 100 : 0, paid: true,
      paymentMethod: "Avulsa", paymentDate: t,
    },
  });
  if (pass) {
    await prisma.extraPass.update({
      where: { id: pass.id },
      data: { status: "usado", usedBookingId: booking.id, usedAt: t },
    });
  }
  return booking;
}

/* ===================== AULA EXTRA COMPRADA (ExtraPass) =====================
   A aluna paga primeiro e escolhe o horário depois. O passe é o comprovante
   dessa compra e só vira aula quando o Sicredi confirmar o Pix — por isso o
   calendário só abre com status "pago".

   Não gera crédito de reposição e não é devolvido: está escrito na tela da
   compra, e liberarAula() repete o aviso se ela cancelar a aula depois. */

// Passe já pago e ainda não usado — o mais antigo primeiro.
const passeExtraDisponivel = (clientId) =>
  prisma.extraPass.findFirst({ where: { clientId, status: "pago" }, orderBy: { createdAt: "asc" } });

// Cobrança pendente ainda esperando o Pix cair
const passeExtraPendente = (clientId) =>
  prisma.extraPass.findFirst({ where: { clientId, status: "pendente" }, orderBy: { createdAt: "desc" } });

// Como o crédito de reposição e a mensalidade, o txid é nosso e derivado do id.
const txidExtra = (id) => `FQCX${String(id).padStart(22, "0")}`;

/* Cria (ou reaproveita) a compra de uma aula extra e devolve o Pix.
   Reaproveitar a pendente é o que impede a aluna de encher o banco de cobranças
   ao tocar duas vezes no botão. */
async function comprarAulaExtra(client) {
  if (client.status === "cancelado")
    throw Object.assign(new Error("Inscrição cancelada. Chame a gente no WhatsApp."), { code: 403 });
  const jaPago = await passeExtraDisponivel(client.id);
  if (jaPago) return { pass: jaPago, jaPago: true };

  const pendente = await passeExtraPendente(client.id);
  if (pendente?.pixCode) return { pass: pendente, jaPago: false };

  const valor = Number(SETTINGS.valorAvulsa) || 0;
  if (!valor) throw Object.assign(new Error("O valor da aula extra ainda não foi configurado. Chame a gente no WhatsApp."), { code: 400 });
  if (!sicrediConfigured())
    throw Object.assign(new Error("Pagamento por Pix indisponível no momento. Chame a gente no WhatsApp. 💚"), { code: 503 });
  const cpf = (client.cpf || "").replace(/\D/g, "");
  if (!cpf) throw Object.assign(new Error("Para gerar o Pix é preciso ter o CPF no cadastro. Chame a gente no WhatsApp. 💚"), { code: 400 });

  const amountCents = Math.round(valor * 100);
  // O registro nasce antes da cobrança porque o txid depende do id dele.
  const pass = pendente || (await prisma.extraPass.create({ data: { clientId: client.id, amountCents } }));
  const txid = txidExtra(pass.id);
  const cob = await createCharge({
    txid,
    name: client.name,
    cpf,
    amountCents: pass.amountCents,
    dueDate: addDays(todayISO(), 2),
    description: `Aula extra — ${client.name}`,
  });
  const atualizado = await prisma.extraPass.update({
    where: { id: pass.id },
    data: { txid, pixCode: extractPix(cob) },
  });
  return { pass: atualizado, jaPago: false };
}

// Se a aula de reposição foi cancelada/excluída, o crédito volta para a aluna
// (desde que ainda esteja na validade).
async function devolverCredito(bookingId) {
  const c = await prisma.makeupCredit.findFirst({ where: { usedBookingId: bookingId } });
  if (!c) return null;
  if (c.expiresOn < todayISO()) return null; // já venceu: não ressuscita
  return prisma.makeupCredit.update({ where: { id: c.id }, data: { usedBookingId: null, usedAt: null } });
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

/* ---------- configurações (linha única id=1, cache em memória) ---------- */
/* Taxa de matrícula: não existe mais desde 28/08/2026. O valor dela foi diluído
   na mensalidade — quem se matricula paga a 1ª mensalidade cheia na tela da
   experimental, e é esse pagamento que a matricula. Não há mais um preço de
   entrada separado nem coluna `taxaMatricula` nas Configurações. */
const PRECOS_PADRAO = { valorPlano1x: 120, valorPlano2x: 200, valorAvulsa: 40, duracaoAulaMin: 120 };
let SETTINGS = { valorPadrao: VALOR_PADRAO, capacidadePadrao: CAPACITY_PADRAO, units: UNITS, profs: PROFS, horarioFunc: "", pixKey: "", pixName: "", mensalidadeValor: 0, vencimentoDia: 10, travaAtraso: false, pixExpira: false, cobrarEncargos: false, geracaoAuto: false, waAvisosAuto: false, ...PRECOS_PADRAO };
async function loadSettings() {
  let s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) s = await prisma.settings.create({ data: { id: 1 } });
  SETTINGS = {
    valorPadrao: s.valorPadrao,
    capacidadePadrao: s.capacidadePadrao,
    units: JSON.parse(s.units || "[]"),
    profs: JSON.parse(s.profs || "[]"),
    horarioFunc: s.horarioFunc || "",
    horarioUnidades: s.horarioUnidades ? (() => { try { return JSON.parse(s.horarioUnidades); } catch { return {}; } })() : {},
    pixKey: s.pixKey || "",
    pixName: s.pixName || "",
    mensalidadeValor: s.mensalidadeValor ?? 0,
    vencimentoDia: s.vencimentoDia ?? 10,
    valorPlano1x: s.valorPlano1x ?? PRECOS_PADRAO.valorPlano1x,
    valorPlano2x: s.valorPlano2x ?? PRECOS_PADRAO.valorPlano2x,
    valorAvulsa: s.valorAvulsa ?? PRECOS_PADRAO.valorAvulsa,
    duracaoAulaMin: s.duracaoAulaMin ?? PRECOS_PADRAO.duracaoAulaMin,
    // Travas de cobrança: ausentes (banco antigo) = desligadas.
    travaAtraso: s.travaAtraso ?? false,
    pixExpira: s.pixExpira ?? false,
    cobrarEncargos: s.cobrarEncargos ?? false,
    geracaoAuto: s.geracaoAuto ?? false,
    waAvisosAuto: s.waAvisosAuto ?? false,
  };
  return SETTINGS;
}

// Preços derivados do plano do aluno
const valorDoPlano = (freq) => (Number(freq) === 2 ? SETTINGS.valorPlano2x : SETTINGS.valorPlano1x);
// "R$ 120,00" — as mensagens do WhatsApp são texto puro, sem componente de tela.
const moedaBR = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// "120,00" — nos templates o "R$" já está escrito no texto aprovado.
const reaisBR = (v) => Number(v || 0).toFixed(2).replace(".", ",");
const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";

/* CPF: dígitos verificadores, não só o tamanho. O Sicredi recusa a cobrança com
   CPF inválido, e recusar aqui é muito melhor do que a aluna descobrir depois de
   digitar tudo e ficar sem Pix. */
function cpfValido(cpf) {
  const d = onlyDigits(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (ate) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/* Marca gravada no `paymentMethod` da reserva da aula experimental. Ela diz que
   aquele dinheiro é a 1ª MENSALIDADE da aluna — o que a matricula — e não o
   pagamento de uma aula avulsa. "Matrícula" é o rótulo antigo, de quando existia
   a taxa de R$20 separada; continua reconhecido para as reservas que já estão
   no banco, mas nenhuma nova nasce com ele. */
const MARCA_MATRICULA = "1ª mensalidade";
const MARCAS_MATRICULA = [MARCA_MATRICULA, "Matrícula"];
const ehPagamentoDeMatricula = (m) => MARCAS_MATRICULA.includes(m);
// Fim da aula ('HH:MM'), a partir do início + duração configurada
function fimDaAula(time, dur = SETTINGS.duracaoAulaMin) {
  const mm = String(time || "").match(/(\d{1,2}):(\d{2})/);
  if (!mm) return "";
  const t = Number(mm[1]) * 60 + Number(mm[2]) + (Number(dur) || 120);
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
// Duas aulas de mesma unidade/dia se sobrepõem? (compara em minutos)
function haChoque(timeA, timeB, dur = SETTINGS.duracaoAulaMin) {
  const min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const a = min(timeA), b = min(timeB);
  return a < b + dur && b < a + dur;
}

/* ---------- estado completo (usado pelo frontend) ---------- */
app.get(
  "/api/state",
  wrap(async (req, res) => {
    const [clients, slots, bookings, invoices, makeups, precos] = await Promise.all([
      prisma.client.findMany({ orderBy: { name: "asc" } }),
      prisma.slot.findMany({ include: { waitlist: true }, orderBy: [{ date: "asc" }, { time: "asc" }] }),
      prisma.booking.findMany({ orderBy: [{ date: "asc" }, { time: "asc" }] }),
      prisma.invoice.findMany({ orderBy: [{ competencia: "desc" }, { createdAt: "desc" }] }),
      prisma.makeupCredit.findMany({ orderBy: { createdAt: "desc" } }),
      // valores combinados mês a mês (desconto/promoção) — a tela precisa deles
      // para mostrar o valor certo de meses que ainda não têm boleto gerado
      prisma.monthlyPrice.findMany({ orderBy: { competencia: "asc" } }),
    ]);
    res.json({
      meta: { ...SETTINGS, multaAtraso: MULTA_ATRASO_REAIS, jurosDia: JUROS_DIA_PERCENTUAL },
      clients: clients.map(({ pin, ...c }) => ({ ...c, tags: parseTags(c.tags), hasPin: !!pin })),
      slots,
      bookings,
      // cada mensalidade já vem com a conta do atraso pronta para a tela
      invoices: invoices.map(comEncargos),
      makeups,
      precos,
    });
  })
);

/* ---------- SLOTS ---------- */
app.post(
  "/api/slots",
  wrap(async (req, res) => {
    const { unit, prof, date, capacity, weeks, dates, baseSlotId } = req.body;
    if (!unit || !req.body.time) return res.status(400).json({ error: "unit e time são obrigatórios" });
    /* Normaliza na porta de entrada, como o PATCH já fazia: o horário guardado
       é sempre 'HH:MM'. Sem isso, um "9:00" ou "09:00:00" entra no banco e volta
       para morder em toda comparação de hora — e na coluna de 5 caracteres do
       crédito de reposição. */
    const time = hhmm(req.body.time);
    if (!time) return res.status(400).json({ error: "Horário inválido — use HH:MM." });
    const cap = Math.max(1, parseInt(capacity, 10) || SETTINGS.capacidadePadrao);
    // O frontend pode mandar uma lista de datas já calculada (criação com dias
    // da semana / replicação). Como fallback, usa date + weeks (repetição semanal).
    let targets = [];
    if (Array.isArray(dates) && dates.length) {
      targets = dates;
    } else {
      if (!date) return res.status(400).json({ error: "date é obrigatório" });
      const n = Math.max(1, parseInt(weeks, 10) || 1);
      for (let i = 0; i < n; i++) targets.push(addDays(date, i * 7));
    }
    // normaliza: só 'YYYY-MM-DD' válidas, sem duplicatas, em ordem
    targets = [...new Set(targets.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    // Cadastro replicado: horários criados juntos ganham um seriesId em comum,
    // para a exclusão poder oferecer "excluir também os demais". Na replicação de
    // um horário existente (baseSlotId), o horário original entra na mesma série.
    const base = baseSlotId ? await prisma.slot.findUnique({ where: { id: Number(baseSlotId) } }) : null;
    let seriesId = base?.seriesId || null;
    if (!seriesId && (targets.length > 1 || base)) {
      seriesId = crypto.randomUUID();
      if (base) await prisma.slot.update({ where: { id: base.id }, data: { seriesId } });
    }
    // As aulas duram SETTINGS.duracaoAulaMin: duas turmas na mesma unidade não
    // podem se sobrepor (ex.: 09:00 e 10:00 com aula de 2h).
    const created = [], conflitos = [];
    for (const d of targets) {
      const doDia = await prisma.slot.findMany({ where: { date: d, unit } });
      if (doDia.some((s) => s.time === time)) continue; // duplicado exato: ignora em silêncio
      const choque = doDia.find((s) => haChoque(s.time, time));
      if (choque) {
        conflitos.push({ date: d, time, conflitaCom: choque.time });
        continue;
      }
      const slot = await prisma.slot.create({
        data: { unit, prof: (prof && String(prof).trim()) || null, date: d, time, capacity: cap, seriesId },
      });
      created.push(slot);
    }
    res.json({ created, conflitos });
  })
);

/* ---------- replicar a TURMA INTEIRA (horário + alunas) ----------
   O "Replicar" antigo (POST /api/slots com baseSlotId) só copia o horário vazio.
   Aqui a Inêz repete a turma como ela está: mesma unidade, hora e capacidade E
   as mesmas alunas, nas próximas N semanas (mesmo dia da semana).

   O que NÃO é copiado, de propósito:
   • reposição — é aula paga com crédito; repetir consumiria créditos da aluna;
   • matrícula (aula experimental) — é uma só na vida da aluna;
   • aluna com cadastro cancelado — saiu do curso.
   Regras do mensalista (teto da semana / janela da escala) continuam valendo:
   quem não pode entra na lista de "pulados", com o motivo.

   As cópias nascem sempre NÃO PAGAS: aula do plano entra `confirmada` (como no
   agendamento em lote do mensalista, já coberta pela mensalidade) e as demais
   entram `aguardando`, para a Inêz cobrar aula a aula. */
app.post(
  "/api/slots/:id/replicate",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const base = await prisma.slot.findUnique({ where: { id } });
    if (!base) return res.status(404).json({ error: "Horário não encontrado." });

    const semanas = Math.min(52, Math.max(1, parseInt(req.body?.weeks, 10) || 1));
    const comAlunas = req.body?.alunas !== false; // padrão: leva as alunas junto
    const hoje = todayISO();

    // uma série em comum para o "excluir todos" continuar enxergando o conjunto
    let seriesId = base.seriesId;
    if (!seriesId) {
      seriesId = crypto.randomUUID();
      await prisma.slot.update({ where: { id: base.id }, data: { seriesId } });
    }

    // quem vai junto: reservas ativas da turma de origem, menos as que por
    // natureza não se repetem (reposição = crédito da aluna, matrícula = a
    // experimental é uma só). Ficam de fora uma vez, não semana a semana.
    const ativas = comAlunas
      ? await prisma.booking.findMany({ where: { slotId: id, status: { not: "cancelada" } } })
      : [];
    const naoReplicavel = (b) => b.paymentMethod === "Reposição" || ehPagamentoDeMatricula(b.paymentMethod);
    const origem = ativas.filter((b) => !naoReplicavel(b));
    const naoReplicadas = ativas.filter(naoReplicavel).map((b) => ({
      clientName: b.clientName,
      motivo: b.paymentMethod === "Reposição" ? "reposição não é replicada" : "aula experimental não é replicada",
    }));
    const nomes = [...new Set(origem.map((b) => b.clientName))];
    const fichas = nomes.length ? await prisma.client.findMany({ where: { name: { in: nomes } } }) : [];
    const fichaDe = (nome) => fichas.find((c) => c.name === nome) || null;
    // aulas já marcadas de todas elas (para o teto semanal enxergar o que vamos criando)
    const agenda = nomes.length
      ? await prisma.booking.findMany({ where: { clientName: { in: nomes }, status: { not: "cancelada" } } })
      : [];

    const slotsCriados = [], aulasCriadas = [], conflitos = [];
    const pulos = []; // { date, clientName, motivo }

    for (let i = 1; i <= semanas; i++) {
      const date = addDays(base.date, i * 7);
      // 1) o horário: reaproveita o que já existe, cria se faltar
      const doDia = await prisma.slot.findMany({ where: { date, unit: base.unit } });
      let alvo = doDia.find((s) => s.time === base.time);
      if (!alvo) {
        const choque = doDia.find((s) => haChoque(s.time, base.time));
        if (choque) { conflitos.push({ date, time: base.time, conflitaCom: choque.time }); continue; }
        alvo = await prisma.slot.create({
          data: { unit: base.unit, prof: base.prof, date, time: base.time, capacity: base.capacity, seriesId },
        });
        slotsCriados.push(alvo);
      } else if (!alvo.seriesId) {
        alvo = await prisma.slot.update({ where: { id: alvo.id }, data: { seriesId } });
      }

      // 2) as alunas
      for (const b of origem) {
        const ficha = fichaDe(b.clientName);
        if (ficha?.status === "cancelado") {
          pulos.push({ date, clientName: b.clientName, motivo: "cadastro cancelado" });
          continue;
        }
        const jaTem = await prisma.booking.findFirst({
          where: { slotId: alvo.id, clientName: b.clientName, status: { not: "cancelada" } },
        });
        if (jaTem) continue; // silencioso: já estava marcada
        if ((await occupancy(alvo.id)) >= alvo.capacity) {
          pulos.push({ date, clientName: b.clientName, motivo: "turma lotada" });
          continue;
        }
        // a janela da escala não se aplica: quem marca aqui é a Inêz, em lote
        const r = checarRegras(ficha, { date, time: alvo.time }, {
          hoje,
          aulasAtivas: agenda,
          ignorarJanela: true,
          ignorarTeto: (b.paymentMethod || "") !== PGTO_PLANO,
        });
        if (!r.ok) { pulos.push({ date, clientName: b.clientName, motivo: r.motivo }); continue; }

        const nova = await prisma.booking.create({
          data: {
            clientName: b.clientName,
            phone: b.phone || "",
            unit: alvo.unit,
            date: alvo.date,
            time: alvo.time,
            prof: alvo.prof,
            slotId: alvo.id,
            seriesId,
            // aula do plano nasce confirmada (é o que o lote do mensalista faz —
            // ela já está paga pela mensalidade); as demais entram aguardando
            status: (b.paymentMethod || "") === PGTO_PLANO ? "confirmada" : "aguardando",
            value: b.value,
            paid: false,
            paymentMethod: b.paymentMethod || null,
          },
        });
        aulasCriadas.push(nova);
        agenda.push(nova); // conta no teto das próximas semanas
      }
    }

    res.json({
      slots: slotsCriados.length,
      aulas: aulasCriadas.length,
      alunasPorSemana: origem.length,
      conflitos,
      pulos,
      naoReplicadas, // reposição / experimental — informado uma vez só
    });
  })
);

app.patch(
  "/api/slots/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const slot = await prisma.slot.findUnique({ where: { id } });
    if (!slot) return res.status(404).json({ error: "Horário não encontrado." });
    const data = {};

    if (req.body.capacity !== undefined) {
      const cap = Math.max(1, parseInt(req.body.capacity, 10) || 1);
      const occ = await occupancy(id);
      if (cap < occ) return res.status(400).json({ error: `Capacidade (${cap}) menor que as ${occ} reservas existentes.` });
      data.capacity = cap;
    }
    if (req.body.time !== undefined) {
      const mm = String(req.body.time).match(/(\d{1,2}):(\d{2})/);
      if (!mm) return res.status(400).json({ error: "Horário inválido." });
      data.time = `${mm[1].padStart(2, "0")}:${mm[2]}`;
    }
    if (req.body.unit !== undefined && req.body.unit) data.unit = String(req.body.unit);
    if (req.body.date !== undefined && req.body.date) data.date = String(req.body.date);
    if (req.body.prof !== undefined) data.prof = String(req.body.prof || "").trim() || null;

    const updated = await prisma.slot.update({ where: { id }, data });

    // As reservas guardam data/hora/unidade/prof copiados do horário; ao editar
    // a turma, movemos junto todas as reservas ativas dela.
    const propag = {};
    for (const k of ["time", "unit", "date", "prof"]) if (data[k] !== undefined) propag[k] = updated[k];
    if (Object.keys(propag).length) {
      await prisma.booking.updateMany({ where: { slotId: id, status: { not: "cancelada" } }, data: propag });
    }
    res.json(updated);
  })
);

app.delete(
  "/api/slots/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const slot = await prisma.slot.findUnique({ where: { id } });
    if (!slot) return res.json({ ok: true, deleted: 0 });
    // ?match=1: exclusão em lote "pega-tudo" — além dos da mesma série, exclui
    // TODOS os horários futuros equivalentes (mesma unidade, hora e dia da
    // semana), mesmo que tenham sido criados em levas separadas ou antes do
    // seriesId existir. Horários passados ficam para preservar o histórico.
    if (req.query.match === "1") {
      const t = todayISO();
      const dow = new Date(slot.date + "T00:00").getDay();
      const cands = await prisma.slot.findMany({
        where: {
          date: { gte: t },
          OR: [
            { unit: slot.unit, time: slot.time },
            ...(slot.seriesId ? [{ seriesId: slot.seriesId }] : []),
          ],
        },
      });
      const ids = new Set(
        cands
          .filter((s) =>
            (slot.seriesId && s.seriesId === slot.seriesId) ||
            (s.unit === slot.unit && s.time === slot.time && new Date(s.date + "T00:00").getDay() === dow)
          )
          .map((s) => s.id)
      );
      ids.add(id); // inclui o próprio, mesmo que esteja no passado
      const r = await prisma.slot.deleteMany({ where: { id: { in: [...ids] } } });
      return res.json({ ok: true, deleted: r.count });
    }
    // ?series=1: exclui também os demais horários da mesma série (replicados),
    // de hoje em diante — horários passados ficam para preservar o histórico.
    if (req.query.series === "1" && slot.seriesId) {
      const r = await prisma.slot.deleteMany({
        where: { seriesId: slot.seriesId, OR: [{ id }, { date: { gte: todayISO() } }] },
      });
      return res.json({ ok: true, deleted: r.count });
    }
    await prisma.slot.delete({ where: { id } });
    res.json({ ok: true, deleted: 1 });
  })
);

/* ---------- horários disponíveis (público, p/ fluxo de primeira aula) ---------- */
app.get(
  "/api/slots/available",
  wrap(async (req, res) => {
    const t = todayISO();
    const unit = req.query.unit;
    const [slots, bookings] = await Promise.all([
      prisma.slot.findMany(),
      prisma.booking.findMany({ where: { status: { not: "cancelada" } } }),
    ]);
    const occ = {};
    bookings.forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });
    const available = slots
      .filter((s) => s.date >= t && (!unit || s.unit === unit) && (occ[s.id] || 0) < s.capacity)
      .map((s) => ({ id: s.id, date: s.date, time: s.time, unit: s.unit, prof: s.prof || profFor(s.unit), vagas: s.capacity - (occ[s.id] || 0) }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    res.json({ available, meta: { units: SETTINGS.units, valorPadrao: SETTINGS.valorPadrao, pixKey: SETTINGS.pixKey, pixName: SETTINGS.pixName } });
  })
);

/* ---------- BOOKINGS ---------- */
async function ensureClient(nomeBruto, phone, unit, tags, cpf, email, firstClass, extra = {}) {
  const name = padronizarNome(nomeBruto);
  const found = await prisma.client.findFirst({ where: { name } });
  if (found) {
    // se o cliente já existe mas ainda não tem CPF/email/nascimento, completa com o informado
    const patch = {};
    if (cpf && !found.cpf) patch.cpf = onlyDigits(cpf);
    if (email && !found.email) patch.email = email.trim();
    if (extra.birthday && !found.birthday) patch.birthday = extra.birthday;
    if (firstClass && !found.firstClass) patch.firstClass = true;
    if (Object.keys(patch).length) return prisma.client.update({ where: { id: found.id }, data: patch });
    return found;
  }
  return prisma.client.create({
    data: {
      name, phone: phone || "", email: (email || "").trim() || null, cpf: onlyDigits(cpf) || null,
      unit, tags: JSON.stringify(tags || []), firstClass: !!firstClass,
      ...(extra.birthday ? { birthday: extra.birthday } : {}),
    },
  });
}

/* Já fez (ou tem marcada) a aula experimental?
   A experimental é uma só na vida da aluna: `trialDate` e `matriculaStatus` são
   a marca de que ela já passou por aqui. Quem faltou também entra nesta conta —
   faltar não devolve o direito de remarcar a experimental (a aula OFICIAL ela
   marca normalmente pelo portal, depois de se matricular). */
const jaTeveExperimental = (c) => !!c && (!!c.trialDate || c.matriculaStatus !== "nao_aplica");

app.post(
  "/api/bookings",
  wrap(async (req, res) => {
    const b = { ...req.body, clientName: padronizarNome(req.body.clientName) };
    if (!b.clientName) return res.status(400).json({ error: "clientName é obrigatório" });
    const unit = b.unit || UNITS[0];
    const time = b.time || "09:00";
    // `dates` (opcional) replica a mesma marcação em várias datas. Sem ele,
    // continua sendo uma marcação única — comportamento de antes.
    const datas = Array.isArray(b.dates) && b.dates.length
      ? [...new Set(b.dates)].sort()
      : [b.date || todayISO()];
    const replicando = datas.length > 1;

    const criadas = [];
    const pulos = { lotada: 0, jaMarcada: 0 };
    let client = null;

    /* Uma aula experimental por aluna. Quem já fez (ou faltou) não remarca a
       experimental — o caminho dela agora é se matricular e marcar a aula
       OFICIAL pelo portal. Este bloqueio é do fluxo público; a Inêz continua
       podendo marcar o que precisar pelo painel (que não manda firstClass). */
    if (b.firstClass && !b.viaPainel) {
      const existente = await prisma.client.findFirst({ where: { name: b.clientName } });
      if (jaTeveExperimental(existente))
        return res.status(409).json({
          error: "Você já tem a sua aula experimental registrada — ela é uma só. " +
            "Para marcar uma aula, entre na área do aluno com o seu CPF. Qualquer dúvida, chame a gente no WhatsApp. 💚",
        });
    }

    for (let i = 0; i < datas.length; i++) {
      const date = datas[i];
      let slot = (b.slotId && !replicando)
        ? await prisma.slot.findUnique({ where: { id: Number(b.slotId) } })
        : await prisma.slot.findFirst({ where: { date, time, unit } });

      if (slot) {
        const occ = await occupancy(slot.id);
        if (occ >= slot.capacity) {
          if (!replicando) return res.status(409).json({ error: "Turma lotada." });
          pulos.lotada++; continue;
        }
        if (replicando) {
          const dup = await prisma.booking.findFirst({
            where: { slotId: slot.id, clientName: b.clientName, status: { not: "cancelada" } },
          });
          if (dup) { pulos.jaMarcada++; continue; }
        }
      } else {
        slot = await prisma.slot.create({
          data: { date, time, unit, prof: b.prof || profFor(unit), capacity: SETTINGS.capacidadePadrao },
        });
      }

      /* Aula experimental: a aula em si é gratuita — o que se cobra na tela é a
         1ª MENSALIDADE do plano que ela acabou de escolher. Não existe mais taxa
         de matrícula à parte: o valor dela está diluído na mensalidade, e é esse
         pagamento que matricula a aluna (ver registrarMatriculaPaga).
         Ao replicar, só a primeira aula é a experimental. */
      const experimental = !!b.firstClass && i === 0;
      const freqEscolhida = Number(b.weeklyFreq) === 2 ? 2 : 1;
      const booking = await prisma.booking.create({
        data: {
          clientName: b.clientName,
          phone: b.phone || "",
          unit,
          date: slot.date,
          time: slot.time,
          prof: slot.prof,
          slotId: slot.id,
          status: "aguardando",
          value: experimental ? valorDoPlano(freqEscolhida) : (Number(b.value) || 0),
          paymentMethod: experimental ? MARCA_MATRICULA : null,
        },
      });
      criadas.push(booking);

      if (!client) client = await ensureClient(b.clientName, b.phone, unit, [], b.cpf, b.email, b.firstClass, { birthday: b.birthday });
      if (experimental && client) {
        /* O plano escolhido na tela da matrícula fica guardado aqui como
           INTENÇÃO (weeklyFreq + mensalistaTipo), mas `plan` continua "avulso":
           ela só vira mensalista de fato quando a 1ª mensalidade é paga. Quem faz
           essa virada é registrarMatriculaPaga(), que roda tanto no "já paguei"
           quanto no webhook do Sicredi. */
        const freq = Number(b.weeklyFreq) === 2 ? 2 : Number(b.weeklyFreq) === 1 ? 1 : null;
        await prisma.client.update({
          where: { id: client.id },
          data: {
            matriculaStatus: "pendente",
            trialDate: slot.date,
            ...(freq ? { weeklyFreq: freq, mensalistaTipo: b.mensalistaTipo === "escala" ? "escala" : "fixo" } : {}),
          },
        });
      }
    }

    // compatibilidade: sem replicação, devolve a marcação criada (como antes)
    if (!replicando) return res.json(criadas[0]);
    res.json({ created: criadas, pulos });
  })
);

app.patch(
  "/api/bookings/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await prisma.booking.findUnique({ where: { id } });
    if (!cur) return res.status(404).json({ error: "Marcação não encontrada" });
    const data = {};
    for (const k of ["status", "attendance", "date", "time", "paymentMethod", "paymentDate"])
      if (req.body[k] !== undefined) data[k] = req.body[k];
    if (req.body.value !== undefined) data.value = Number(req.body.value) || cur.value;
    if (req.body.paid !== undefined) data.paid = !!req.body.paid;
    // mover a reserva para outro horário (usado no fluxo da 1ª aula)
    if (req.body.slotId !== undefined && Number(req.body.slotId) !== cur.slotId) {
      const ns = await prisma.slot.findUnique({ where: { id: Number(req.body.slotId) } });
      if (!ns) return res.status(404).json({ error: "Horário não encontrado" });
      const occ = await occupancy(ns.id);
      if (occ >= ns.capacity) return res.status(409).json({ error: "Turma lotada." });
      data.slotId = ns.id; data.date = ns.date; data.time = ns.time; data.unit = ns.unit; data.prof = ns.prof;
    }
    // presente → conclui a aula
    if (data.attendance === "presente" && (data.status || cur.status) !== "cancelada") data.status = "concluida";
    // confirmada sem pagamento → marca paga
    if ((data.status || cur.status) === "confirmada" && !(data.paid ?? cur.paid)) {
      data.paid = true;
      data.paymentMethod = data.paymentMethod || cur.paymentMethod || "Pix";
      data.paymentDate = data.paymentDate || cur.paymentDate || todayISO();
    }
    const booking = await prisma.booking.update({ where: { id }, data });
    // cancelar uma reposição devolve o crédito para a aluna
    if (data.status === "cancelada" && cur.status !== "cancelada" && cur.paymentMethod === "Reposição")
      await devolverCredito(id);
    res.json(booking);
  })
);

app.delete(
  "/api/bookings/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const bk = await prisma.booking.findUnique({ where: { id } });
    if (!bk) return res.json({ ok: true, deleted: 0 });
    // ?series=1: exclui também as demais aulas da mesma marcação replicada,
    // de hoje em diante — aulas passadas ficam para preservar o histórico.
    if (req.query.series === "1" && bk.seriesId) {
      const where = { seriesId: bk.seriesId, OR: [{ id }, { date: { gte: todayISO() } }] };
      const alvos = await prisma.booking.findMany({ where, select: { id: true } });
      const r = await prisma.booking.deleteMany({ where });
      for (const a of alvos) await devolverCredito(a.id); // reposição excluída devolve o crédito
      return res.json({ ok: true, deleted: r.count });
    }
    await prisma.booking.delete({ where: { id } });
    await devolverCredito(id);
    res.json({ ok: true, deleted: 1 });
  })
);

/* 1ª mensalidade quitada. Roda nos dois caminhos que confirmam pagamento: o
   "JÁ PAGUEI" da tela e o webhook do Sicredi.

   Se a aluna escolheu o plano na hora da matrícula (weeklyFreq guardado como
   intenção em POST /api/bookings), o pagamento também a MATRICULA: ela sai daqui
   mensalista, com o dia do pagamento virando o vencimento dela, o mês corrente
   já quitado e a próxima mensalidade caindo no mês seguinte. Sem plano escolhido,
   o fluxo antigo segue valendo — ela decide depois da aula, pelo portal ou com
   a Inêz. */
async function registrarMatriculaPaga(booking) {
  if (!ehPagamentoDeMatricula(booking.paymentMethod)) return;
  const c = await prisma.client.findFirst({ where: { name: booking.clientName } });
  if (!c || c.matriculaStatus !== "pendente") return;
  const pagoEm = booking.paymentDate || todayISO();
  const atualizado = await prisma.client.update({
    where: { id: c.id },
    data: { matriculaStatus: "paga", matriculaAt: pagoEm },
  });
  if (!atualizado.weeklyFreq || atualizado.plan === "mensalista") return null;
  try {
    const r = await converterEmMensalista(atualizado, {
      weeklyFreq: atualizado.weeklyFreq,
      mensalistaTipo: atualizado.mensalistaTipo,
      billingDay: diaDoMes(pagoEm),
      // o que ela acabou de pagar é a mensalidade do mês corrente
      mensalidadePaga: { valor: booking.value, pagoEm, txid: booking.txid },
    });
    console.log(`[matricula] ${atualizado.name} matriculada no plano ${atualizado.weeklyFreq}x (${atualizado.mensalistaTipo}).`);
    return r;
  } catch (e) {
    // A mensalidade já está paga e registrada; se a matrícula falhar (Sicredi fora
    // do ar, por exemplo), a Inêz conclui pelo painel em vez de a aluna perder o pago.
    console.warn(`[matricula] ${atualizado.name}: 1ª mensalidade paga mas a matrícula falhou — ${e.message}`);
    return null;
  }
}

/* Agradecimento + confirmação + REGRAS, quando a 1ª mensalidade cai.

   É a única vez que a aluna recebe as regras inteiras, e é de propósito: ela
   acabou de pagar, está lendo, e ainda não marcou nada de errado. Manda em duas
   mensagens (confirmação e regras) porque uma parede de texto no WhatsApp não
   é lida — a segunda chega já com o contexto da primeira.

   Só fala com quem veio pelo WhatsApp: sem telefone, ou sem reserva segurada,
   não há conversa aberta e o envio sai em silêncio. */
async function avisarMatriculaConfirmada(booking) {
  if (!waConfigured() || !booking?.phone) return;
  if (!ehPagamentoDeMatricula(booking.paymentMethod)) return;
  try {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { holdUntil: null, holdNudged: false },
    });
    await prisma.waConversation.updateMany({
      where: { bookingId: booking.id },
      data: { step: "done", bookingId: null, slotId: null, pendingName: null },
    });
    await waSend(booking.phone, textoMatriculaConfirmada({
      nome: booking.clientName,
      unidade: booking.unit,
      quando: fmtSlotBR({ date: booking.date, time: booking.time }),
    }));
  } catch (e) {
    console.warn(`[wa] confirmação da matrícula de ${booking.clientName} não saiu: ${e.message}`);
  }
}

app.post(
  "/api/bookings/:id/pay",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await prisma.booking.findUnique({ where: { id } });
    const booking = await prisma.booking.update({
      where: { id },
      data: {
        paid: true,
        status: "confirmada",
        // a experimental mantém a marca da matrícula para o dinheiro não virar aula
        paymentMethod: ehPagamentoDeMatricula(cur?.paymentMethod) ? cur.paymentMethod : (req.body.paymentMethod || "Pix"),
        paymentDate: req.body.paymentDate || todayISO(),
        ...(req.body.value !== undefined ? { value: Number(req.body.value) } : {}),
      },
    });
    // Pagou a 1ª mensalidade com plano escolhido? Sai daqui já matriculada — a
    // tela da aluna nova usa `matricula` para mostrar o plano e o próximo vencimento.
    const matricula = await registrarMatriculaPaga(booking);
    // Baixa dada pelo painel também confirma para a aluna: do lado dela é o
    // mesmo evento, e ela precisa das regras antes da primeira aula.
    await avisarMatriculaConfirmada(booking);
    res.json({ ...booking, matricula });
  })
);

/* ---------- COBRANÇA VIA SICREDI (Pix com confirmação automática) ---------- */
// O txid é o identificador da cobrança no padrão BACEN e ele é NOSSO: precisa
// casar com /^[a-zA-Z0-9]{26,35}$/ — nada de hífen. Como é derivado do id da
// reserva (ou do aluno + competência), o mesmo registro sempre gera o mesmo txid,
// e o PUT /cob/{txid} do Sicredi é idempotente: reenviar não duplica cobrança.
const txidBooking = (id) => `FQCB${String(id).padStart(22, "0")}`;
// `seq` é a via da cobrança: 0 (sem sufixo) é a original; 1, 2, 3… são as
// reemissões, feitas quando a cobrança anterior expirou no vencimento. Precisa
// de txid novo porque o PUT /cob/{txid} é idempotente — reenviar o mesmo txid
// devolveria a cobrança vencida em vez de criar uma válida.
const txidMensalidade = (clientId, comp, seq = 0) =>
  `FQCM${String(clientId).padStart(16, "0")}${comp.replace("-", "")}${seq ? String(seq).padStart(2, "0") : ""}`;
// Caminho inverso: o webhook só nos entrega o txid, então precisamos saber a que
// ele se refere quando a busca direta no banco não acha. É o que salva o caso da
// aluna que pagou pelo QR antigo: o txid dela não está mais na invoice (foi
// substituído pela reemissão), mas cliente + competência ainda identificam a dívida.
const parseTxid = (txid) => {
  let m = /^FQCB(\d{22})$/.exec(txid || "");
  if (m) return { tipo: "booking", id: Number(m[1]) };
  m = /^FQCX(\d{22})$/.exec(txid || "");
  if (m) return { tipo: "extra", id: Number(m[1]) };
  m = /^FQCM(\d{16})(\d{4})(\d{2})(\d{2})?$/.exec(txid || "");
  if (m) {
    return { tipo: "mensalidade", clientId: Number(m[1]), competencia: `${m[2]}-${m[3]}`, seq: Number(m[4] || 0) };
  }
  return null;
};

async function clientCpfByName(name) {
  if (!name) return "";
  const c = await prisma.client.findFirst({ where: { name } });
  return (c?.cpf || "").replace(/\D/g, "");
}

/* Gera (ou reaproveita) a cobrança Pix de UMA reserva.

   Vive fora da rota porque o bot do WhatsApp precisa do mesmo Pix sem passar por
   HTTP: a conversa cria a reserva e manda o código na mesma mensagem. Lança
   erros com `code` para a rota devolver o status certo. */
async function emitirPixDaReserva(booking, { cpf: cpfInformado, name, dueDate } = {}) {
  if (!sicrediConfigured()) {
    throw Object.assign(new Error(`Sicredi não configurado no servidor — falta: ${sicrediMissing().join(", ")}.`), { code: 400 });
  }
  if (booking.txid && booking.pixCode) return { txid: booking.txid, pixCode: booking.pixCode, reused: true };
  const cpf = (cpfInformado || "").replace(/\D/g, "") || (await clientCpfByName(booking.clientName));
  if (!cpf) throw Object.assign(new Error("CPF do pagador é obrigatório. Cadastre o CPF da aluna antes de gerar a cobrança."), { code: 400 });
  /* Sem valor próprio não há o que cobrar: a aula está dentro da mensalidade
     do mês (o Pix dela se gera em /api/invoices, na aba Mensalistas). */
  const amountCents = Math.round((Number(booking.value) || 0) * 100);
  if (amountCents <= 0) {
    throw Object.assign(new Error("Esta aula não tem cobrança própria — o valor está dentro da mensalidade do mês. Gere o Pix da mensalidade na aba Mensalistas."), { code: 400 });
  }
  const txid = txidBooking(booking.id);
  const cob = await createCharge({
    txid,
    name: name || booking.clientName,
    cpf,
    amountCents,
    dueDate: dueDate || addDays(todayISO(), 2),
    description: `Reserva de aula — ${booking.unit} · ${booking.date} ${booking.time}`,
  });
  const pixCode = extractPix(cob);
  await prisma.booking.update({
    where: { id: booking.id },
    data: { txid, pixCode: pixCode || booking.pixCode },
  });
  return { txid, pixCode };
}

app.post(
  "/api/bookings/:id/invoice",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ error: "Marcação não encontrada" });
    try {
      res.json(await emitirPixDaReserva(booking, req.body || {}));
    } catch (e) {
      res.status(e.code || 500).json({ error: e.message });
    }
  })
);

// Confirma (se de fato pago) a reserva ou a mensalidade por trás de um txid.
// Consulta o Sicredi com mTLS antes de dar qualquer baixa — é isso que faz um
// webhook forjado não conseguir marcar nada como pago sozinho.
async function confirmarPagamentoPorTxid(txid) {
  if (!sicrediConfigured() || !txid) return false;
  const cob = await getCharge(txid);
  if (!isPaidStatus(cob?.status)) return false;
  const ref = parseTxid(txid);

  let booking = await prisma.booking.findFirst({ where: { txid } });
  if (!booking && ref?.tipo === "booking") {
    booking = await prisma.booking.findUnique({ where: { id: ref.id } });
  }
  if (booking && !booking.paid) {
    /* Ela pagou depois de o prazo da vaga estourar. O dinheiro entrou, então a
       reserva não pode simplesmente continuar cancelada — mas a vaga pode ter
       sido ocupada por outra aluna nesse meio-tempo. Se ainda há lugar, a aula
       volta; se não há, o pagamento fica registrado e a Inêz remarca com ela.
       Nunca estourar a capacidade da turma: é isso que protege quem chegou antes. */
    if (booking.status === "cancelada") {
      const slot = await prisma.slot.findUnique({ where: { id: booking.slotId } });
      const occ = await occupancy(booking.slotId);
      if (!slot || occ >= slot.capacity) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { paid: true, paymentDate: todayISO(), holdUntil: null },
        });
        console.warn(`[sicredi] reserva ${booking.id} paga fora do prazo e a turma já lotou — remarcar com ${booking.clientName}.`);
        if (booking.phone) {
          await waSend(booking.phone, `${(booking.clientName || "").split(" ")[0]}, recebemos o seu pagamento! 💚\n\nSó que o horário que você tinha escolhido lotou enquanto o Pix não caía. Seu valor está guardado — me chama neste número que a gente escolhe outro dia juntas:\n📞 ${WA_ATENDENTE}`);
        }
        return true;
      }
    }
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paid: true, status: "confirmada", paymentDate: todayISO(),
        holdUntil: null,
        paymentMethod: ehPagamentoDeMatricula(booking.paymentMethod) ? booking.paymentMethod : "Pix",
      },
    });
    await registrarMatriculaPaga({ ...booking, paymentDate: todayISO() });
    console.log(`[sicredi] pagamento confirmado — reserva ${booking.id}`);
    // O agradecimento + regras é o fecho do fluxo do WhatsApp. Fora dele (site,
    // painel) não há conversa aberta, e avisarMatriculaConfirmada sai em silêncio.
    await avisarMatriculaConfirmada(booking);
    return true;
  }

  // Aula extra comprada no portal: pagar o Pix libera o calendário para ela.
  let pass = await prisma.extraPass.findFirst({ where: { txid } });
  if (!pass && ref?.tipo === "extra") pass = await prisma.extraPass.findUnique({ where: { id: ref.id } });
  if (pass && pass.status === "pendente") {
    await prisma.extraPass.update({ where: { id: pass.id }, data: { status: "pago", paidAt: todayISO() } });
    console.log(`[sicredi] aula extra confirmada — passe ${pass.id}`);
    return true;
  }

  let invoice = await prisma.invoice.findFirst({ where: { txid } });
  if (!invoice && ref?.tipo === "mensalidade") {
    invoice = await prisma.invoice.findFirst({ where: { clientId: ref.clientId, competencia: ref.competencia } });
  }
  if (invoice && invoice.status !== "pago") {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "pago", paidAt: todayISO() } });
    console.log(`[sicredi] mensalidade confirmada — invoice ${invoice.id}`);
    return true;
  }
  return false;
}

// Webhook do Sicredi — apenas um GATILHO. O corpo chega como { pix: [ { txid, ... } ] }
// e nada dele é levado em conta além do txid; quem decide é confirmarPagamentoPorTxid.
// O banco chama a URL cadastrada com "/pix" no final, por isso as duas rotas.
app.post(
  ["/api/sicredi/webhook", "/api/sicredi/webhook/pix"],
  wrap(async (req, res) => {
    const b = req.body || {};
    const itens = Array.isArray(b.pix) ? b.pix : b.txid ? [b] : [];
    let falhou = false;
    for (const item of itens) {
      try {
        await confirmarPagamentoPorTxid(item?.txid);
      } catch (e) {
        // Não deixa um txid problemático abortar os outros do mesmo lote.
        falhou = true;
        console.error(`[sicredi] falha ao confirmar txid ${item?.txid}: ${e.message}`);
      }
    }
    // 200 = recebido. Se alguma verificação falhou, devolvemos 500 de propósito para
    // o Sicredi reenviar a notificação mais tarde em vez de dar o Pix por perdido.
    if (falhou) return res.status(500).json({ ok: false });
    res.json({ ok: true });
  })
);

// Rede de segurança: reconsulta o Sicredi sob demanda. Serve para homologação
// (antes do webhook existir) e para destravar um pagamento que não chegou.
app.post(
  "/api/sicredi/verificar/:txid",
  wrap(async (req, res) => {
    if (!sicrediConfigured()) {
      return res.status(400).json({ error: `Sicredi não configurado no servidor — falta: ${sicrediMissing().join(", ")}.` });
    }
    const confirmado = await confirmarPagamentoPorTxid(req.params.txid);
    res.json({ confirmado });
  })
);

/* ---------- MENSALIDADES (mensalistas) ---------- */
const competenciaAtual = () => todayISO().slice(0, 7); // 'YYYY-MM'
// Valor efetivo da mensalidade, na ordem: valor individual → plano 1x/2x →
// valor padrão legado das Configurações (alunos cadastrados antes dos planos).
const mensalidadeValorDe = (c) => {
  if (c.monthlyValue != null) return c.monthlyValue || 0;
  if (c.weeklyFreq) return valorDoPlano(c.weeklyFreq) || 0;
  return SETTINGS.mensalidadeValor || 0;
};

/* Valor de UMA competência. Antes do recorrente vem o valor combinado só para
   aquele mês (desconto pontual, promoção de 2/3 meses): é isso que faz a
   promoção acabar sozinha — passada a competência, não há mais o que consultar
   e o valor volta a ser o de sempre. */
async function valorDaCompetencia(client, comp) {
  const preco = await prisma.monthlyPrice.findUnique({
    where: { clientId_competencia: { clientId: client.id, competencia: comp } },
  });
  if (preco) return preco.amountCents / 100;
  return mensalidadeValorDe(client);
}
// Dia de vencimento da competência, sem ajuste nenhum. É esta data que diz
// QUANDO gerar a mensalidade — por isso não pode ser a versão "empurrada para
// hoje" abaixo, senão a antecedência nunca seria satisfeita.
const vencimentoBruto = (c, comp = competenciaAtual()) => {
  const dia = Math.min(28, Math.max(1, c.billingDay || SETTINGS.vencimentoDia || 10));
  const [y, m] = comp.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
};
// Vencimento do boleto de uma competência. Nunca devolve data no passado: quem
// se matricula depois do dia de vencimento teria a 1ª mensalidade nascendo
// vencida — e entraria em atraso (perdendo a reposição) sem dever nada.
const vencimentoDe = (c, comp = competenciaAtual()) => {
  const venc = vencimentoBruto(c, comp);
  const hoje = todayISO();
  return venc < hoje ? hoje : venc;
};
// Com quantos dias de antecedência a mensalidade do mês é gerada. Antes ela
// nascia no próprio dia do vencimento, o que dava zero prazo para a aluna.
const ANTECEDENCIA_DIAS = 5;

/**
 * Emite a cobrança Pix de uma mensalidade no Sicredi.
 * Fica separada de gerarMensalidade porque a reemissão (QR vencido) precisa
 * exatamente do mesmo trabalho, só que com outra via (seq) e outra expiração.
 * @returns {{txid: string, pixCode: string|null}}
 */
async function emitirCobrancaMensalidade({ client, comp, valorCents, expiraEm, seq = 0 }) {
  const cpf = (client.cpf || "").replace(/\D/g, "");
  if (!cpf) throw Object.assign(new Error("Cadastre o CPF do aluno antes de gerar a cobrança."), { code: 400 });
  const txid = txidMensalidade(client.id, comp, seq);
  const cob = await createCharge({
    txid,
    name: client.name,
    cpf,
    amountCents: valorCents,
    dueDate: expiraEm,
    description: `Mensalidade ${comp} — Fios que Curam`,
  });
  return { txid, pixCode: extractPix(cob) };
}

// Gera (ou reaproveita) o boleto da mensalidade de um aluno para uma competência
async function gerarMensalidade(clientId, competencia) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw Object.assign(new Error("Aluno não encontrado"), { code: 404 });
  if (client.plan !== "mensalista") throw Object.assign(new Error("Aluno não é mensalista"), { code: 400 });
  const comp = competencia || competenciaAtual();
  // já existe para essa competência? reaproveita
  const existing = await prisma.invoice.findFirst({ where: { clientId, competencia: comp } });
  if (existing) return existing;
  // Valor DA COMPETÊNCIA: respeita o desconto/promoção marcada para este mês.
  const valor = await valorDaCompetencia(client, comp);
  if (!valor) throw Object.assign(new Error("Defina o valor da mensalidade (no aluno ou nas Configurações)."), { code: 400 });
  const dueDate = vencimentoDe(client, comp);
  const valorCents = Math.round(valor * 100);
  /* Mês anterior baixado na mão = a aluna acerta fora do sistema. A mensalidade
     seguinte nasce SEM Pix: ela não recebe QR nenhum, nem pelo portal nem pela
     cobrança do painel. É uma marca de um mês só — o mês depois deste volta ao
     normal, a não ser que também leve baixa manual. */
  const anterior = await prisma.invoice.findFirst({
    where: { clientId, competencia: somarComp(comp, -1) },
  });
  const semPix = !!anterior?.baixaManual;
  let txid = null, pixCode = null, pixExpiresOn = null;
  if (semPix) {
    console.log(`[mensalidade] ${client.name} (${comp}): sem Pix — ${anterior.competencia} teve baixa manual.`);
  } else if (sicrediConfigured()) {
    // Se o Sicredi falhar, a mensalidade ainda precisa existir aqui — senão a aluna
    // fica sem cobrança nenhuma. Fica sem Pix e a tela oferece gerar de novo.
    try {
      const validade = validadeDoPix(dueDate);
      ({ txid, pixCode } = await emitirCobrancaMensalidade({ client, comp, valorCents, expiraEm: validade }));
      pixExpiresOn = validade;
    } catch (e) {
      // Falta de CPF é erro de cadastro, não falha do banco: sobe para a tela
      // em vez de criar silenciosamente uma mensalidade sem como pagar.
      if (e.code === 400) throw e;
      console.warn(`[mensalidade] Sicredi falhou para ${client.name} (${comp}): ${e.message}. Mensalidade registrada sem Pix.`);
      txid = null; pixCode = null; pixExpiresOn = null;
    }
  }
  return prisma.invoice.create({
    data: { clientId, competencia: comp, amountCents: valorCents, dueDate, status: "pendente", txid, pixCode, pixExpiresOn, semPix },
  });
}

// Quantos dias a cobrança reemitida fica válida. A mensalidade continua vencida
// para efeito de atraso (dueDate não muda) — o que se renova é só o prazo do QR.
const VALIDADE_REEMISSAO_DIAS = 3;

/* Com SETTINGS.pixExpira DESLIGADA (o padrão hoje), o Pix não morre no
   vencimento: a cobrança nasce com um horizonte longo e continua pagável mesmo
   em atraso. Ligando a chave nas Configurações, volta a expirar no vencimento e
   a reemissão de 3 dias entra em cena de novo.
   Zero não existe no Sicredi — toda cobrança tem prazo — então "sem vencimento"
   é, na prática, este horizonte. */
const PIX_HORIZONTE_DIAS = 90;
const validadeDoPix = (dueDate) =>
  SETTINGS.pixExpira ? dueDate : addDays(todayISO(), PIX_HORIZONTE_DIAS);

// Até quando o Pix guardado é pagável. Mensalidades criadas antes da coluna
// pixExpiresOn existir não têm o campo: nelas a validade era o próprio vencimento.
const pixValidoEm = (inv) => inv.pixExpiresOn || inv.dueDate;

/* ---------- atraso: multa e juros (ver MULTA_ATRASO_REAIS em regrasAula.js) ----------
   O valor ORIGINAL da mensalidade (amountCents) nunca muda. O que muda é quanto
   ela custa HOJE, e isso é recalculado toda vez que alguém pede o Pix. */

// Quanto custa hoje: { dias, multaCents, jurosCents, totalCents, atrasada }
const encargosHoje = (inv, hoje = todayISO()) => encargosDe(inv, hoje);
// Quanto o QR guardado está cobrando — `encargosAte` diz a data em que ele foi calculado
const totalDoPixAtual = (inv) => encargosDaMensalidade(inv, inv.encargosAte || inv.dueDate).totalCents;

/* Depois desta via, paramos de reemitir. O txid comporta `seq` até 99 e cada
   reemissão gasta uma; com uma aluna que atrase muitos meses, é melhor congelar
   o QR (e a Inêz acertar a diferença por fora) do que a tela quebrar. */
const SEQ_LIMITE_REEMISSAO = 90;

/**
 * Devolve um Pix pagável para uma mensalidade em aberto. Reemite quando:
 *   a) não há Pix guardado, ou
 *   b) o anterior expirou (o Sicredi recusa QR vencido), ou
 *   c) o valor mudou — a multa entrou ou os juros do dia subiram um centavo.
 *
 * O caso (c) é o que faz a multa chegar de fato na aluna: sem ele, o QR antigo
 * continuaria cobrando o valor sem acréscimo.
 */
async function pixPagavelDaMensalidade(invoice) {
  const hoje = todayISO();
  /* Mensalidade marcada para não emitir Pix (veio depois de uma baixa manual:
     a aluna acerta fora do sistema). Nada de QR — nem aqui, nem no portal. Quem
     precisar do código passa pelo botão "Gerar Pix" do painel, que limpa a marca
     antes de chamar esta função. */
  if (invoice.semPix) {
    throw Object.assign(
      new Error("Esta mensalidade está marcada para não emitir Pix — a anterior teve baixa manual."),
      { code: 409, codigo: "SEM_PIX" }
    );
  }
  const devido = encargosHoje(invoice, hoje);
  const valorMudou = invoice.pixCode ? totalDoPixAtual(invoice) !== devido.totalCents : false;
  // Reaproveitar enquanto vale E enquanto o valor não muda é o que impede a
  // reemissão a cada clique — sem isso o `seq` estouraria o teto rapidinho.
  if (invoice.pixCode && pixValidoEm(invoice) >= hoje && !valorMudou) return invoice;
  if (!sicrediConfigured()) throw Object.assign(new Error("Pagamento por Pix indisponível no momento."), { code: 503 });
  const client = await prisma.client.findUnique({ where: { id: invoice.clientId } });
  if (!client) throw Object.assign(new Error("Aluno não encontrado"), { code: 404 });
  const seq = (parseTxid(invoice.txid)?.seq || 0) + 1;
  if (seq > SEQ_LIMITE_REEMISSAO) {
    // Sem QR nenhum não dá para seguir; com um QR velho, entregamos o que existe.
    if (invoice.pixCode) {
      console.warn(`[mensalidade] invoice ${invoice.id}: limite de reemissões — mantendo o Pix atual.`);
      return invoice;
    }
    throw Object.assign(new Error("Não consegui gerar o Pix desta mensalidade. Chame a gente no WhatsApp. 💚"), { code: 400 });
  }
  // Com a trava desligada a reemissão já nasce com o horizonte longo, para a
  // aluna não precisar voltar aqui a cada três dias.
  const pixExpiresOn = SETTINGS.pixExpira
    ? addDays(hoje, VALIDADE_REEMISSAO_DIAS)
    : addDays(hoje, PIX_HORIZONTE_DIAS);
  const { txid, pixCode } = await emitirCobrancaMensalidade({
    client,
    comp: invoice.competencia,
    // é AQUI que a multa e os juros entram na cobrança
    valorCents: devido.totalCents,
    expiraEm: pixExpiresOn,
    seq,
  });
  // A cobrança antiga não precisa ser cancelada: ela já expirou sozinha. E se a
  // aluna pagar por um QR antigo que ainda estava aberto, parseTxid encontra a
  // mensalidade por cliente + competência e a baixa acontece do mesmo jeito.
  return prisma.invoice.update({
    where: { id: invoice.id },
    // encargosAte guarda a data da conta embutida neste QR — é o que permite
    // saber, na próxima visita, se ele ainda cobra o valor certo.
    data: { txid, pixCode, pixExpiresOn, encargosAte: devido.atrasada ? hoje : null },
  });
}

// Gerar boleto da mensalidade (manual) — body opcional { competencia: 'YYYY-MM' }
app.post("/api/clients/:id/invoice", wrap(async (req, res) => {
  try {
    const inv = await gerarMensalidade(Number(req.params.id), req.body?.competencia);
    res.json(inv);
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message });
  }
}));

/* Marcar mensalidade como paga (baixa manual).

   Toda baixa dada pelo painel é manual por definição: o Sicredi confirma sozinho
   pelo webhook (confirmarPagamentoPorTxid), sem passar por aqui. Então quem
   clica está dizendo "recebi por fora" — e quem paga por fora não usa Pix.
   Por isso a mensalidade SEGUINTE nasce sem QR (ver gerarMensalidade).

   `manual: false` no corpo existe para conciliação/importação: registra o
   pagamento sem carimbar a marca que suprime o Pix do mês que vem. */
app.post("/api/invoices/:id/pay", wrap(async (req, res) => {
  const manual = req.body?.manual !== false;
  const inv = await prisma.invoice.update({
    where: { id: Number(req.params.id) },
    data: { status: "pago", paidAt: req.body?.paidAt || todayISO(), baixaManual: manual },
  });
  /* Se a mensalidade do mês seguinte JÁ existe, a marca chega tarde para o
     gerarMensalidade — então aplica direto aqui. O QR que ela porventura tenha
     é apagado: continuar oferecendo cobrança a quem paga por fora é o que a
     baixa manual existe para evitar. */
  let proximaSemPix = null;
  if (manual) {
    const prox = await prisma.invoice.findFirst({
      where: { clientId: inv.clientId, competencia: somarComp(inv.competencia, 1), status: "pendente" },
    });
    if (prox) {
      proximaSemPix = await prisma.invoice.update({
        where: { id: prox.id },
        data: { semPix: true, pixCode: null, txid: null, pixExpiresOn: null, encargosAte: null },
      });
    }
  }
  res.json({ ...inv, proximaSemPix: proximaSemPix ? proximaSemPix.competencia : null });
}));

// Cancelar mensalidade
app.post("/api/invoices/:id/cancel", wrap(async (req, res) => {
  const inv = await prisma.invoice.update({ where: { id: Number(req.params.id) }, data: { status: "cancelado" } });
  res.json(inv);
}));

/* Reemitir o Pix de uma mensalidade, pelo painel.
   Existe porque mudar o valor apaga o QR antigo (ele cobrava o preço velho) e a
   Inêz precisa do código novo na mão para mandar pelo WhatsApp — sem depender de
   a aluna abrir o portal primeiro. */
app.post("/api/invoices/:id/pix", wrap(async (req, res) => {
  let inv = await prisma.invoice.findUnique({ where: { id: Number(req.params.id) } });
  if (!inv) return res.status(404).json({ error: "Mensalidade não encontrada." });
  if (inv.status !== "pendente") return res.status(400).json({ error: "Esta mensalidade não está em aberto." });
  /* Saída da supressão: pedir o Pix aqui é a Inêz dizendo que desta vez quer o
     código na mão. A marca da baixa manual sai e a emissão segue normal. */
  if (inv.semPix) {
    inv = await prisma.invoice.update({ where: { id: inv.id }, data: { semPix: false } });
  }
  try {
    res.json(comEncargos(await pixPagavelDaMensalidade(inv)));
  } catch (e) {
    res.status(e.code || 503).json({ error: e.message || "Não consegui gerar o Pix agora." });
  }
}));

/* ---------- VALOR DA MENSALIDADE: alteração pela admin ----------
   Três coisas diferentes que a tela chama de "mudar o valor", e que aqui são
   deliberadamente separadas:

   1. RECORRENTE  → Client.monthlyValue. Vale de agora em diante, para sempre.
   2. UM OU MAIS MESES → MonthlyPrice. Desconto pontual ou promoção de N meses;
      passada a competência o valor volta sozinho ao recorrente. É por isso que a
      promoção não precisa de "data de fim": ela simplesmente deixa de existir.
   3. REAJUSTE GERAL → mexe na tabela de preços (vale para quem entrar depois) e,
      opcionalmente, no valor individual de quem já está matriculada.

   Em todos os casos, mês que JÁ tem mensalidade paga não é tocado: o dinheiro já
   entrou, mudar o valor ali seria reescrever a história. Mensalidade pendente é
   atualizada e o Pix reemitido — senão o QR antigo continuaria cobrando o valor
   velho e o desconto não chegaria na aluna. */

const compValida = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));

// Soma n meses a uma competência 'YYYY-MM'
const addComp = (comp, n) => {
  const [y, m] = comp.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const MESES_PROMO_MAX = 24;

/* Grava o valor de um mês e propaga para a mensalidade daquele mês, se já
   existir. Devolve o que aconteceu, para a tela poder dizer em números.
   `valorReais` null apaga o combinado e o mês volta ao valor recorrente. */
async function aplicarValorNaCompetencia(client, comp, valorReais, { origem = "ajuste", motivo = null } = {}) {
  const inv = await prisma.invoice.findFirst({ where: { clientId: client.id, competencia: comp } });
  if (inv && inv.status === "pago") return { comp, resultado: "pago", valor: inv.amountCents / 100 };

  if (valorReais == null) {
    await prisma.monthlyPrice.deleteMany({ where: { clientId: client.id, competencia: comp } });
  } else {
    const amountCents = Math.round(Number(valorReais) * 100);
    await prisma.monthlyPrice.upsert({
      where: { clientId_competencia: { clientId: client.id, competencia: comp } },
      update: { amountCents, origem, motivo },
      create: { clientId: client.id, competencia: comp, amountCents, origem, motivo },
    });
  }

  // Valor que passa a valer para este mês depois da mudança acima
  const efetivo = await valorDaCompetencia(client, comp);
  if (!inv) return { comp, resultado: "agendado", valor: efetivo }; // ainda sem boleto: nasce já com o valor novo
  if (inv.status === "cancelado") return { comp, resultado: "cancelado", valor: efetivo };

  const novoCents = Math.round(efetivo * 100);
  if (novoCents === inv.amountCents) return { comp, resultado: "sem_mudanca", valor: efetivo };

  /* Zera o Pix guardado junto com o valor. Sem isso o QR antigo continuaria
     pagável cobrando o valor velho — a aluna pagaria o preço de antes e o
     sistema daria a mensalidade por quitada. O novo QR é emitido na próxima vez
     que alguém pedir o Pix (portal da aluna ou botão da tela). */
  const atualizada = await prisma.invoice.update({
    where: { id: inv.id },
    data: { amountCents: novoCents, pixCode: null, pixExpiresOn: null, encargosAte: null },
  });
  return { comp, resultado: "atualizada", valor: efetivo, invoiceId: atualizada.id };
}

/**
 * Altera o valor da mensalidade de uma aluna.
 * body: {
 *   valor: number,                       // R$; obrigatório (exceto escopo "limpar")
 *   escopo: "recorrente" | "mes_atual" | "proximo_mes" | "competencias" | "promocao" | "limpar",
 *   aplicarNoMesAtual?: boolean,         // só no escopo "recorrente"
 *   competencias?: string[],             // escopo "competencias" / "limpar"
 *   meses?: number, inicio?: 'YYYY-MM',  // escopo "promocao"
 *   motivo?: string
 * }
 */
app.post("/api/clients/:id/mensalidade-valor", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).json({ error: "Aluna não encontrada." });

  const { escopo, aplicarNoMesAtual, motivo } = req.body || {};
  const limpando = escopo === "limpar";
  const valor = limpando ? null : Number(req.body?.valor);
  /* Zero é recusado de propósito: não existe cobrança Pix de R$ 0 no Sicredi, e
     uma mensalidade sem como pagar deixaria a aluna presa em "pendente" para
     sempre. Mês de cortesia se resolve cancelando a mensalidade daquele mês
     (botão na aba Mensalidades), não zerando o valor. */
  if (!limpando && (!Number.isFinite(valor) || valor <= 0)) {
    return res.status(400).json({
      error: valor === 0
        ? "Não dá para cobrar R$ 0 — para isentar um mês, cancele a mensalidade dele."
        : "Informe um valor válido.",
    });
  }

  const atual = competenciaAtual();
  const anterior = mensalidadeValorDe(client);
  const nota = (motivo || "").trim().slice(0, 200) || null;
  let alvos = [];
  let origem = "ajuste";
  let recorrente = null;

  switch (escopo) {
    case "recorrente":
      recorrente = valor;
      // O mês corrente só entra se você mandar: a mensalidade dele pode já estar
      // combinada (ou até emitida) no valor antigo, e mudar sem pedir seria
      // alterar uma cobrança que a aluna já viu.
      if (aplicarNoMesAtual) alvos = [atual];
      break;
    case "mes_atual":
      alvos = [atual];
      origem = "desconto";
      break;
    case "proximo_mes":
      alvos = [addComp(atual, 1)];
      origem = "desconto";
      break;
    case "competencias": {
      const lista = (req.body?.competencias || []).filter(compValida);
      if (!lista.length) return res.status(400).json({ error: "Escolha ao menos um mês." });
      alvos = [...new Set(lista)].sort();
      origem = "desconto";
      break;
    }
    case "promocao": {
      const meses = Math.max(1, Math.min(MESES_PROMO_MAX, parseInt(req.body?.meses, 10) || 0));
      if (!meses) return res.status(400).json({ error: "Informe por quantos meses a promoção vale." });
      const inicio = compValida(req.body?.inicio) ? req.body.inicio : atual;
      alvos = Array.from({ length: meses }, (_, i) => addComp(inicio, i));
      origem = "promocao";
      break;
    }
    case "limpar": {
      const lista = (req.body?.competencias || []).filter(compValida);
      if (!lista.length) return res.status(400).json({ error: "Escolha ao menos um mês." });
      alvos = [...new Set(lista)].sort();
      break;
    }
    default:
      return res.status(400).json({ error: "Escopo de alteração inválido." });
  }

  // Escopo recorrente: o valor individual da aluna passa a ser este.
  if (recorrente != null) {
    await prisma.client.update({ where: { id }, data: { monthlyValue: recorrente } });
  }
  // Recarrega: aplicarValorNaCompetencia precisa enxergar o monthlyValue novo
  // para calcular o valor efetivo de cada mês.
  const atualizado = await prisma.client.findUnique({ where: { id } });

  const detalhes = [];
  for (const comp of alvos) {
    // No "aplicar já no mês atual" do recorrente não criamos combinado nenhum:
    // apagamos o que houvesse e deixamos o mês seguir o valor recorrente novo.
    const v = recorrente != null ? null : valor;
    detalhes.push(await aplicarValorNaCompetencia(atualizado, comp, v, { origem, motivo: nota }));
  }

  const bloqueados = detalhes.filter((d) => d.resultado === "pago").map((d) => d.comp);
  res.json({
    client: atualizado,
    escopo,
    valorAnterior: anterior,
    valorNovo: limpando ? mensalidadeValorDe(atualizado) : valor,
    competencias: alvos,
    detalhes,
    atualizadas: detalhes.filter((d) => d.resultado === "atualizada").length,
    bloqueados,
  });
}));

/* Prévia do reajuste geral: quem seria afetado e por quanto. A tela chama isto
   antes de aplicar — reajuste é irreversível na prática (não há "desfazer" que
   saiba qual era o valor de cada uma), então vale ver a conta antes. */
function calcularReajuste(base, { tipo, valor }) {
  const n = Number(valor) || 0;
  const novo = tipo === "percentual" ? base * (1 + n / 100) : base + n;
  return Math.max(0, Math.round(novo * 100) / 100);
}

app.post("/api/mensalidades/reajuste/preview", wrap(async (req, res) => {
  const { tipo = "percentual", valor = 0 } = req.body || {};
  const mensalistas = await prisma.client.findMany({
    where: { plan: "mensalista", status: "ativo" }, orderBy: { name: "asc" },
  });
  res.json({
    tabela: {
      plano1x: { antes: SETTINGS.valorPlano1x, depois: calcularReajuste(SETTINGS.valorPlano1x, { tipo, valor }) },
      plano2x: { antes: SETTINGS.valorPlano2x, depois: calcularReajuste(SETTINGS.valorPlano2x, { tipo, valor }) },
    },
    // Quem tem valor individual não é arrastada junto: a tela lista para você
    // marcar uma a uma quem entra no reajuste (pode haver desconto combinado).
    individuais: mensalistas.filter((c) => c.monthlyValue != null).map((c) => ({
      id: c.id, name: c.name, weeklyFreq: c.weeklyFreq,
      antes: c.monthlyValue, depois: calcularReajuste(c.monthlyValue, { tipo, valor }),
    })),
    naTabela: mensalistas.filter((c) => c.monthlyValue == null).map((c) => ({
      id: c.id, name: c.name, weeklyFreq: c.weeklyFreq, antes: mensalidadeValorDe(c),
    })),
  });
}));

/**
 * Reajuste geral.
 * body: {
 *   tipo: "percentual" | "reais",
 *   valor: number,
 *   atualizarTabela?: boolean,   // sobe plano 1x/2x → vale para quem entrar depois
 *   individuais?: number[]       // ids das alunas com valor próprio que entram
 * }
 * Não mexe em mensalidade já gerada: o reajuste vale do próximo boleto em diante.
 */
app.post("/api/mensalidades/reajuste", wrap(async (req, res) => {
  const { tipo = "percentual", valor = 0, atualizarTabela = true, individuais = [] } = req.body || {};
  const n = Number(valor);
  if (!Number.isFinite(n) || n === 0) return res.status(400).json({ error: "Informe o reajuste." });

  let tabela = null;
  if (atualizarTabela) {
    const plano1x = calcularReajuste(SETTINGS.valorPlano1x, { tipo, valor: n });
    const plano2x = calcularReajuste(SETTINGS.valorPlano2x, { tipo, valor: n });
    const d = { valorPlano1x: plano1x, valorPlano2x: plano2x };
    await prisma.settings.upsert({ where: { id: 1 }, update: d, create: { id: 1, ...d } });
    await loadSettings(); // sem isto, mensalidadeValorDe seguiria com o preço velho
    tabela = { plano1x, plano2x };
  }

  const ids = [...new Set((individuais || []).map(Number).filter(Boolean))];
  const alteradas = [];
  for (const id of ids) {
    const c = await prisma.client.findUnique({ where: { id } });
    if (!c || c.monthlyValue == null) continue;
    const novo = calcularReajuste(c.monthlyValue, { tipo, valor: n });
    await prisma.client.update({ where: { id }, data: { monthlyValue: novo } });
    alteradas.push({ id, name: c.name, antes: c.monthlyValue, depois: novo });
  }

  console.log(`[reajuste] ${tipo} ${n} · tabela ${atualizarTabela ? "sim" : "não"} · ${alteradas.length} valor(es) individual(is).`);
  res.json({ tabela, individuais: alteradas });
}));

/**
 * Gera os boletos dos mensalistas ativos para a competência atual.
 * @param {object} [o]
 * @param {boolean} [o.soNoPrazo] - true (modo automático) gera apenas para quem
 *   já entrou na janela de ANTECEDENCIA_DIAS antes do próprio vencimento; false
 *   (botão "gerar todos" do painel) gera para todo mundo, na hora.
 * @returns {{feitas: object[], novas: object[]}}
 */
async function gerarMensalidadesDoMes({ soNoPrazo = false } = {}) {
  const comp = competenciaAtual();
  const hoje = todayISO();
  // Aluna que rompeu com o curso não recebe cobrança nova.
  const mensalistas = await prisma.client.findMany({ where: { plan: "mensalista", status: "ativo" } });
  // Quem já tinha boleto antes desta rodada — para o log contar só o que nasceu agora.
  const jaTinha = new Set(
    (await prisma.invoice.findMany({ where: { competencia: comp }, select: { clientId: true } })).map((i) => i.clientId)
  );
  const feitas = [];
  for (const c of mensalistas) {
    // O vencimento é por aluna (billingDay), então a janela também é.
    if (soNoPrazo && hoje < addDays(vencimentoBruto(c, comp), -ANTECEDENCIA_DIAS)) continue;
    try { feitas.push(await gerarMensalidade(c.id, comp)); } catch (e) { console.warn(`[mensalidade] ${c.name}: ${e.message}`); }
  }
  return { feitas, novas: feitas.filter((i) => !jaTinha.has(i.clientId)) };
}
app.post("/api/invoices/gerar-mes", wrap(async (_req, res) => {
  const { feitas, novas } = await gerarMensalidadesDoMes();
  res.json({ geradas: feitas.length, novas: novas.length });
}));

/* Automático: uma vez por dia, gera as mensalidades de quem está a
   ANTECEDENCIA_DIAS ou menos do vencimento.

   Antes isto disparava só quando o dia do mês era exatamente o do vencimento —
   se o servidor estivesse fora do ar naquele dia, o mês inteiro era pulado. Agora
   qualquer dia dentro da janela resolve, e a rodada no boot recupera o atraso de
   quem reiniciou depois da hora. gerarMensalidade é idempotente, então repetir
   não duplica nada. */
let ultimoDiaGeracao = null;
async function rodadaMensalidades() {
  /* Chave desligada: ninguém nasce sozinho. Sai ANTES de marcar o dia, de
     propósito — assim, ligar a chave no meio do dia faz a rodada da hora
     seguinte gerar, sem precisar esperar o dia virar. O botão "gerar" do painel
     não passa por aqui e segue funcionando com a chave desligada. */
  if (!SETTINGS.geracaoAuto) return;
  const hoje = todayISO();
  if (ultimoDiaGeracao === hoje) return;
  ultimoDiaGeracao = hoje;
  const { novas } = await gerarMensalidadesDoMes({ soNoPrazo: true });
  if (novas.length) console.log(`[mensalidade] ${novas.length} boleto(s) do mês gerados automaticamente.`);
}
const dispararRodada = () => rodadaMensalidades().catch((e) => {
  ultimoDiaGeracao = null; // falhou: deixa a próxima hora tentar de novo
  console.warn("[mensalidade auto]", e.message);
});
setInterval(dispararRodada, 60 * 60 * 1000); // a cada hora
setTimeout(dispararRodada, 15_000); // e uma vez no boot, já com o banco de pé

/* ---------- AVISOS DE MENSALIDADE PELO WHATSAPP ----------

   Dois envios, e só dois, por mensalidade:

   1. LEMBRETE, AVISO_ANTES dias ANTES do vencimento. É lembrete, não cobrança:
      o tom é de quem avisa para a pessoa não pagar multa à toa. Foi assim que a
      Inêz pediu — "não como se fosse uma cobrança".
   2. COBRANÇA, AVISO_ATRASO dia DEPOIS do vencimento, já com multa e juros na
      conta e o Pix reemitido pelo valor novo.

   As datas de envio ficam gravadas na própria mensalidade (avisoAVencerAt /
   avisoAtrasoAt): é o que impede a rodada de repetir o recado a cada hora, e
   deixa visível no banco quando a escola falou com a aluna.

   Mensalidade marcada como "sem Pix" (baixa manual no mês anterior) fica FORA
   dos dois: quem acerta por fora não recebe cobrança automática. */
const AVISO_ANTES = 2;  // dias antes do vencimento
const AVISO_ATRASO = 1; // dias depois do vencimento

/* ---------- HORÁRIO DAS MENSAGENS QUE O SISTEMA INICIA ----------

   Cobrança às 3 da manhã irrita, e irritação no WhatsApp vira bloqueio — um
   número bloqueado não agenda mais ninguém. Então tudo que o sistema manda DO
   NADA (mensalidade, lembrete de aula, conversa parada) espera a janela.

   O que NÃO passa por aqui, de propósito: as mensagens da vaga segurada. A
   aluna está no meio da conversa dela e o prazo corre em tempo real; segurar o
   aviso até amanhã faria a vaga sumir sem ela entender por quê.

   A hora é a de São Paulo, não a do servidor (que roda em UTC em produção). */
const SILENCIO_DE = 8;  // manhã: só a partir das 8h
const SILENCIO_ATE = 20; // noite: nada depois das 20h
const horaBR = () => Number(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }));
const podeMandarAgora = () => { const h = horaBR(); return h >= SILENCIO_DE && h < SILENCIO_ATE; };

/* `fallback` é o template aprovado equivalente ao texto. Aviso de mensalidade é
   mensagem que a ESCOLA inicia, quase sempre com a janela de 24h fechada — sem
   template a Meta simplesmente não entrega. O Pix vai depois, em mensagem
   separada, e essa só sai se a janela estiver aberta; fora dela, o botão do
   template leva a aluna ao portal, onde o QR está. */
async function avisoComPix(client, inv, texto, fallback) {
  try {
    await sendWaTextOrTemplate(client.phone, texto, fallback);
  } catch (e) {
    console.warn(`[mensalidade wa] ${client.name}: ${e.message}`);
    return;
  }
  /* O QR só vai junto se existir E estiver cobrando o valor certo. Um Pix
     emitido antes da multa cobraria menos do que a conta escrita acima dele —
     mandar isso é pior do que não mandar código nenhum. */
  try {
    const atual = await pixPagavelDaMensalidade(inv);
    if (atual?.pixCode) {
      await waSend(client.phone, "Segue o Pix copia-e-cola 👇");
      await waSend(client.phone, atual.pixCode);
      return;
    }
  } catch (e) {
    console.warn(`[mensalidade wa] Pix de ${client.name} (${inv.competencia}) não saiu: ${e.message}`);
  }
  await waSend(client.phone, "Me avisa por aqui que eu te mando o Pix atualizado. 💚");
}

let ultimoDiaAvisos = null;
async function rodadaAvisosMensalidade() {
  /* Chave desligada: a escola não inicia conversa. Sai ANTES de marcar o dia
     (igual à rodada de mensalidades), para ligar a chave no meio do dia valer
     já na hora seguinte, sem esperar o dia virar. */
  if (!SETTINGS.waAvisosAuto) return;
  if (!waConfigured()) return;
  /* Sai ANTES de marcar o dia: fora da janela a rodada não fez nada, e marcar
     aqui faria o aviso do dia inteiro se perder porque a hora deu 3 da manhã. */
  if (!podeMandarAgora()) return;
  const hoje = todayISO();
  if (ultimoDiaAvisos === hoje) return;
  ultimoDiaAvisos = hoje;

  const abertas = await prisma.invoice.findMany({
    where: { status: "pendente", semPix: false },
  });
  for (const inv of abertas) {
    const client = await prisma.client.findUnique({ where: { id: inv.clientId } });
    if (!client?.phone || client.status === "cancelado") continue;
    const comEnc = comEncargos(inv);
    const mes = compPorExtenso(inv.competencia);
    try {
      if (!inv.avisoAVencerAt && hoje === addDays(inv.dueDate, -AVISO_ANTES)) {
        await avisoComPix(client, inv, textoMensalidadeAVencer({
          nome: client.name, mes,
          valor: moedaBR(inv.amountCents / 100),
          vencimento: fmtDiaBR(inv.dueDate),
        }), {
          name: "mensalidade_a_vencer",
          body: [primeiroNome(client.name), mes, reaisBR(inv.amountCents / 100), fmtDiaBR(inv.dueDate)],
        });
        await prisma.invoice.update({ where: { id: inv.id }, data: { avisoAVencerAt: hoje } });
        continue;
      }
      const dias = comEnc.encargos?.dias || 0;
      if (!inv.avisoAtrasoAt && dias >= AVISO_ATRASO) {
        const total = comEnc.encargos?.total ?? inv.amountCents / 100;
        await avisoComPix(client, inv, textoMensalidadeEmAtraso({
          nome: client.name, mes, dias, valor: moedaBR(total),
        }), {
          name: "mensalidade_em_atraso",
          body: [primeiroNome(client.name), mes, String(dias), reaisBR(total)],
        });
        await prisma.invoice.update({ where: { id: inv.id }, data: { avisoAtrasoAt: hoje } });
      }
    } catch (e) {
      console.warn(`[mensalidade wa] ${client.name} (${inv.competencia}): ${e.message}`);
    }
  }
}
/* ---------- LEMBRETE DA AULA, NA VÉSPERA ----------

   Uma mensagem por aula, um dia antes, com dois botões: confirmar presença ou
   avisar que não vai. O segundo botão é o ponto: ele libera a vaga pelo MESMO
   caminho do portal (`liberarAula`), então as regras de reposição valem iguais —
   crédito só com a antecedência mínima, e nada de repor reposição.

   Só aula ativa, de aluna com telefone, e só uma vez (`lembreteAulaAt`). Respeita
   a janela de silêncio: é mensagem que a escola inicia. */
let ultimoDiaLembretes = null;
async function rodadaLembretesDeAula() {
  if (!SETTINGS.waAvisosAuto) return; // ver rodadaAvisosMensalidade
  if (!waConfigured() || !podeMandarAgora()) return;
  const hoje = todayISO();
  if (ultimoDiaLembretes === hoje) return;
  ultimoDiaLembretes = hoje;

  const amanha = addDays(hoje, 1);
  const aulas = await prisma.booking.findMany({
    where: {
      date: amanha,
      status: { in: ["aguardando", "confirmada"] },
      lembreteAulaAt: null,
      phone: { not: "" },
    },
  });
  for (const b of aulas) {
    if (!b.phone) continue;
    try {
      await prisma.booking.update({ where: { id: b.id }, data: { lembreteAulaAt: hoje } });
      await waSend(b.phone, textoLembreteAula({
        nome: b.clientName,
        unidade: b.unit,
        quando: fmtSlotBR({ date: b.date, time: b.time }),
      }));
      await waButtons(b.phone, "Confirma que você vem?", [
        { id: `presenca:${b.id}`, title: "Sim, estarei lá" },
        { id: `faltarei:${b.id}`, title: "Não vou poder ir" },
      ]);
    } catch (e) {
      console.warn(`[lembrete aula] ${b.clientName}: ${e.message}`);
    }
  }
  if (aulas.length) console.log(`[lembrete aula] ${aulas.length} lembrete(s) de ${amanha} enviados.`);
}
const dispararLembretes = () => rodadaLembretesDeAula().catch((e) => {
  ultimoDiaLembretes = null; // falhou: a próxima hora tenta de novo
  console.warn("[lembrete aula]", e.message);
});
setInterval(dispararLembretes, 60 * 60 * 1000);
setTimeout(dispararLembretes, 75_000);

const dispararAvisos = () => rodadaAvisosMensalidade().catch((e) => {
  ultimoDiaAvisos = null; // falhou: a próxima hora tenta de novo
  console.warn("[mensalidade wa]", e.message);
});
setInterval(dispararAvisos, 60 * 60 * 1000);
setTimeout(dispararAvisos, 45_000);

/* ---------- PORTAL DO ALUNO ---------- */
// Localiza o aluno pela "chave" usada no portal: CPF, telefone (dígitos) ou id.
async function clientByPortalKey(key) {
  const d = onlyDigits(key);
  const clients = await prisma.client.findMany();
  return (
    clients.find((c) => (c.cpf && onlyDigits(c.cpf) === d) || (c.phone && onlyDigits(c.phone) === d)) ||
    (Number(key) ? clients.find((c) => c.id === Number(key)) : null) ||
    null
  );
}
const safeClient = (c) => { const { pin, ...rest } = c; return { ...rest, tags: parseTags(c.tags), hasPin: !!pin }; };

// Dados do aluno: cadastro, aulas e horários disponíveis para marcar
app.get("/api/portal/:key", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const t = todayISO();
  const [bookings, slots, ativas, invoices] = await Promise.all([
    prisma.booking.findMany({ where: { clientName: client.name }, orderBy: [{ date: "asc" }, { time: "asc" }] }),
    prisma.slot.findMany({ where: { date: { gte: t } }, orderBy: [{ date: "asc" }, { time: "asc" }] }),
    prisma.booking.findMany({ where: { status: { not: "cancelada" } } }),
    // Mensalidade cancelada não é dívida nem histórico útil para a aluna — fica de fora.
    prisma.invoice.findMany({
      where: { clientId: client.id, status: { not: "cancelado" } },
      orderBy: { competencia: "desc" },
      take: 12,
    }),
  ]);
  const occ = {}; ativas.forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });
  const available = slots
    .filter((s) => (occ[s.id] || 0) < (s.capacity || 1))
    // Restringe à unidade da aluna, se cadastrada — Inêz pode alterar pelo painel admin
    .filter((s) => !client.unit || s.unit === client.unit)
    /* Toda turma livre da unidade dela aparece. Havia aqui um filtro por data
       (sábado / a partir das 18h); as duas regras saíram, e o que sobrou — o
       teto semanal — não some com a turma: ela aparece e o botão é que fica
       preso, com o motivo escrito. */
    .map((s) => ({ ...s, prof: s.prof || profFor(s.unit), occupancy: occ[s.id] || 0, free: (s.capacity || 1) - (occ[s.id] || 0) }));
  const makeup = await resumoReposicao(client);
  // A janela da escala é um aviso à parte (os horários continuam visíveis, o
  // botão é que fica preso), para a aluna entender por que não dá hoje.
  const tipo = tipoMensalista(client);
  const ativasFuturas = bookings.filter((b) => b.status !== "cancelada" && b.date >= t);
  const janela = tipo === "escala"
    ? janelaEscala(ativasFuturas, t)
    : { aberta: true, proxima: null, motivo: "" };
  // Teto da semana corrente, para a tela mostrar "1 de 2 aulas desta semana".
  // A conta por semana escolhida é refeita no MiniAgenda, com estes mesmos dados.
  const teto = tetoSemanal(client, t, bookings.filter((b) => b.status !== "cancelada"));
  const extra = (await passeExtraDisponivel(client.id)) || (await passeExtraPendente(client.id));
  res.json({
    client: safeClient(client),
    bookings,
    available,
    makeup,
    // com a conta do atraso: a aluna vê de onde vem o valor antes de pagar
    invoices: invoices.map(comEncargos),
    regras: {
      tipo,                                  // "fixo" | "escala" | null
      janela,                                // { aberta, proxima, motivo }
      teto,                                  // { limite, marcadas, restantes } da semana de hoje
    },
    // Aula extra comprada: null, ou { status, valor, pixCode, ... }
    extra: extra ? resumoPasse(extra) : null,
    valorAulaExtra: SETTINGS.valorAvulsa,
    // A tela de matrícula e a de mensalidade leem daqui. Faltavam os preços e a
    // duração da aula, então o portal exibia os valores chumbados do código em
    // vez dos que estão nas Configurações.
    meta: {
      units: SETTINGS.units,
      valorPadrao: SETTINGS.valorPadrao,
      pixKey: SETTINGS.pixKey,
      pixName: SETTINGS.pixName,
      vencimentoDia: client.billingDay || SETTINGS.vencimentoDia,
      valorPlano1x: SETTINGS.valorPlano1x,
      valorPlano2x: SETTINGS.valorPlano2x,
      valorAvulsa: SETTINGS.valorAvulsa,
      duracaoAulaMin: SETTINGS.duracaoAulaMin,
      // regra do atraso, para a tela poder explicar de onde vem o acréscimo
      multaAtraso: MULTA_ATRASO_REAIS,
      jurosDia: JUROS_DIA_PERCENTUAL,
    },
  });
}));

/* Devolve um Pix pagável da mensalidade — reemitindo se o anterior expirou.
   Público como o resto do portal, mas só entrega cobrança de mensalidade que
   pertence à própria aluna e que ainda está em aberto. */
app.post("/api/portal/:key/invoice/:id/pix", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const id = Number(req.params.id);
  const inv = Number.isInteger(id) ? await prisma.invoice.findUnique({ where: { id } }) : null;
  // Mesma resposta para "não existe" e "é de outra pessoa": não confirma ids alheios.
  if (!inv || inv.clientId !== client.id) return res.status(404).json({ error: "Mensalidade não encontrada." });
  if (inv.status !== "pendente") return res.status(400).json({ error: "Esta mensalidade não está em aberto." });
  try {
    res.json(comEncargos(await pixPagavelDaMensalidade(inv)));
  } catch (e) {
    /* Mensalidade sem Pix por decisão da escola (o mês anterior teve baixa
       manual): a aluna não vê um erro técnico, vê o combinado dela. */
    if (e.codigo === "SEM_PIX") {
      return res.status(409).json({
        error: "Esta mensalidade está combinada direto com a escola — não há Pix para ela. Qualquer dúvida, chame a gente no WhatsApp. 💚",
        codigo: "SEM_PIX",
      });
    }
    // O portal é público: erro de configuração vira recado para procurar a Inêz,
    // sem expor qual credencial do banco está faltando.
    const publico = e.code === 400 || e.code === 404;
    if (!publico) console.warn(`[portal] falha ao reemitir Pix da invoice ${inv.id}: ${e.message}`);
    res.status(e.code && publico ? e.code : 503).json({
      error: publico ? e.message : "Não consegui gerar o Pix agora. Tente de novo em instantes ou chame a gente no WhatsApp. 💚",
    });
  }
}));

/* Comprar uma aula extra: devolve o Pix a pagar (ou avisa que já há uma paga
   esperando horário). O calendário só abre depois que o Sicredi confirmar. */
app.post("/api/portal/:key/extra/checkout", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try {
    const { pass, jaPago } = await comprarAulaExtra(client);
    res.json({ ...resumoPasse(pass), jaPago });
  } catch (e) {
    const publico = e.code === 400 || e.code === 403 || e.code === 503;
    if (!publico) console.warn(`[extra] falha ao gerar Pix para ${client.name}: ${e.message}`);
    res.status(publico ? e.code : 503).json({
      error: publico ? e.message : "Não consegui gerar o Pix agora. Tente de novo em instantes ou chame a gente no WhatsApp. 💚",
    });
  }
}));

/* Consulta leve para a tela de espera. Além de ler o banco, pergunta ao Sicredi
   se a cobrança foi paga — o webhook é o caminho normal, mas se ele atrasar (ou
   o servidor estiver atrás de um túnel que caiu) a aluna não fica presa na tela. */
app.get("/api/portal/:key/extra/status", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  let pass = (await passeExtraDisponivel(client.id)) || (await passeExtraPendente(client.id));
  if (pass?.status === "pendente" && pass.txid) {
    try {
      if (await confirmarPagamentoPorTxid(pass.txid)) pass = await prisma.extraPass.findUnique({ where: { id: pass.id } });
    } catch (e) {
      console.warn(`[extra] consulta ao Sicredi falhou (passe ${pass.id}): ${e.message}`);
    }
  }
  res.json(pass ? resumoPasse(pass) : { status: "nenhum" });
}));

// Desistiu antes de pagar: cancela a cobrança pendente e limpa a tela.
app.post("/api/portal/:key/extra/cancelar", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const pendente = await passeExtraPendente(client.id);
  if (pendente) await prisma.extraPass.update({ where: { id: pendente.id }, data: { status: "cancelado" } });
  res.json({ ok: true });
}));

// O que a tela precisa saber do passe (sem expor o resto da linha)
const resumoPasse = (p) => ({
  id: p.id,
  status: p.status,           // pendente | pago | usado | cancelado
  valor: p.amountCents / 100,
  pixCode: p.status === "pendente" ? p.pixCode : null,
  paidAt: p.paidAt || null,
});

// Converter em mensalista pelo portal (usado no tablet da sala, ao fim da experimental)
app.post("/api/portal/:key/enroll", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try { res.json(await converterEmMensalista(client, req.body || {})); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
}));

// Marcar aula. { reposicao: true } consome crédito; { extra: true } é aula
// avulsa paga (não mexe no saldo de reposição — são coisas separadas).
app.post("/api/portal/:key/book", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  if (req.body.reposicao) {
    try {
      return res.json(await marcarReposicao(client, req.body.slotId));
    } catch (e) {
      return res.status(e.code || 500).json({ error: e.message });
    }
  }
  if (req.body.extra) {
    try {
      // Pelo portal a aula extra exige o passe pago — quem marca de cortesia é a Inêz.
      return res.json(await marcarAulaExtra(client, req.body.slotId, { passe: true }));
    } catch (e) {
      return res.status(e.code || 500).json({ error: e.message });
    }
  }
  const slot = await prisma.slot.findUnique({ where: { id: Number(req.body.slotId) } });
  if (!slot) return res.status(404).json({ error: "Horário não encontrado." });
  const dup = await prisma.booking.findFirst({ where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } } });
  if (dup) return res.status(400).json({ error: "Você já tem essa aula marcada." });
  if ((await occupancy(slot.id)) >= (slot.capacity || 1)) return res.status(400).json({ error: "Turma lotada." });
  // Regras do plano (teto da semana, janela da escala). No portal não há exceção.
  try { await exigirRegras(client, slot); }
  catch (e) { return res.status(e.code || 409).json({ error: e.message, codigo: e.codigo }); }
  const mensalista = client.plan === "mensalista";
  const booking = await prisma.booking.create({
    data: {
      clientName: client.name, phone: client.phone || "", unit: slot.unit, date: slot.date, time: slot.time, prof: slot.prof || profFor(slot.unit),
      slotId: slot.id,
      status: mensalista ? "confirmada" : "aguardando",
      // A aula não tem preço próprio: quem se paga é a mensalidade do mês.
      value: 0,
      paid: false,
      paymentMethod: mensalista ? "Mensalista" : null,
    },
  });
  res.json(booking);
}));

/* Libera a vaga da aula e, se couber, gera o crédito de reposição.

   Aula de reposição liberada NÃO gera crédito novo nem devolve o antigo: não se
   repõe a reposição. O crédito já foi gasto e se encerra ali.
   `devolverRepo` é a exceção do painel: quando a Inêz desfaz a marcação (excluir
   a aula, cancelar uma turma), a aluna não pode pagar por isso. */
async function liberarAula(client, b, extra = {}, { devolverRepo = false } = {}) {
  await prisma.booking.update({ where: { id: b.id }, data: { status: "cancelada", ...extra } });
  if (b.paymentMethod === "Reposição") {
    if (devolverRepo) {
      const devolvido = await devolverCredito(b.id);
      return { credito: false, devolvido: !!devolvido, motivo: devolvido ? "Crédito de reposição devolvido para você." : "" };
    }
    return {
      credito: false,
      devolvido: false,
      motivo: "Esta era a sua aula de reposição — liberando, o crédito se encerra. Não é possível repor a reposição.",
    };
  }
  if (b.paymentMethod === "Avulsa") {
    // Aula extra é compra: liberar a vaga não devolve o valor nem gera crédito.
    return { credito: false, devolvido: false, motivo: "Esta era uma aula extra — o valor pago não é devolvido." };
  }
  /* A vaga JÁ foi liberada na linha de cima. Se a concessão do crédito falhar,
     a liberação não pode falhar junto: quem avisou que não vem não fica presa na
     turma por causa de um erro na regra de reposição. O erro vai para o log e a
     tela diz o que aconteceu. (Foi o que quebrou em 29/08/2026: horário fora do
     formato estourando MakeupCredit.originTime, VARCHAR(5).) */
  try {
    const { credito, motivo } = await concederCredito(client, b);
    return { credito: !!credito, devolvido: false, motivo };
  } catch (e) {
    console.error(`[reposição] vaga de ${client.name} liberada, mas o crédito falhou: ${e.message}`);
    return {
      credito: false,
      devolvido: false,
      motivo: "A vaga foi liberada, mas não consegui registrar o crédito de reposição. Confira com a escola.",
    };
  }
}

// Cancelar aula (libera a vaga)
app.post("/api/portal/:key/cancel/:bookingId", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const b = await prisma.booking.findUnique({ where: { id: Number(req.params.bookingId) } });
  if (!b || b.clientName !== client.name) return res.status(404).json({ error: "Aula não encontrada." });
  const r = await liberarAula(client, b);
  res.json({ ok: true, ...r });
}));

// "Não poderei ir" — registra o aviso/motivo e libera a vaga
app.post("/api/portal/:key/absence/:bookingId", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const b = await prisma.booking.findUnique({ where: { id: Number(req.params.bookingId) } });
  if (!b || b.clientName !== client.name) return res.status(404).json({ error: "Aula não encontrada." });
  // Sempre grava um motivo: sem texto, fica o registro de que ela avisou —
  // é isso que diferencia "avisou que não vem" de "cancelou" na tela dela.
  const reason = String(req.body.reason || "").trim().slice(0, 500) || "Avisou que não poderá ir";
  const r = await liberarAula(client, b, { absenceReason: reason });
  res.json({ ok: true, ...r });
}));

/* ===================== MATRÍCULA E CONVERSÃO =====================
   Fluxo combinado com a Inêz (revisto em 28/08/2026 — a taxa de matrícula
   deixou de existir e o valor dela está diluído na mensalidade):
   - Para agendar a experimental, a aluna escolhe o plano e paga a 1ª
     MENSALIDADE cheia. A aula experimental em si continua gratuita.
   - Pagou → está matriculada (status "convertida"), o mês corrente já sai
     quitado e a próxima mensalidade cai no mês seguinte, no mesmo dia.
   - Fez e não gostou → a mensalidade é devolvida por inteiro (status
     "devolvida") e a matrícula é desfeita. */

// Converte a aluna em mensalista: define o plano, registra/gera as mensalidades
// e (se veio slotId) agenda a 1ª aula oficial. Lança { code } em caso de erro.
// `mensalidadePaga` chega quando o pagamento da experimental JÁ é a mensalidade
// do mês corrente — é o caminho da tela pública da aluna nova.
async function converterEmMensalista(client, { weeklyFreq, slotId, billingDay, mensalistaTipo, forcar, mensalidadePaga }) {
  const freq = Number(weeklyFreq) === 2 ? 2 : 1;
  const tipo = mensalistaTipo === "escala" ? "escala" : "fixo";
  if (client.plan === "mensalista" && client.weeklyFreq)
    throw Object.assign(new Error("Esta aluna já é mensalista."), { code: 409 });

  // 1ª aula oficial (opcional aqui — pode ser agendada depois)
  let booking = null;
  if (slotId) {
    const slot = await prisma.slot.findUnique({ where: { id: Number(slotId) } });
    if (!slot) throw Object.assign(new Error("Horário não encontrado."), { code: 404 });
    if (slot.date < todayISO()) throw Object.assign(new Error("Escolha uma aula futura."), { code: 400 });
    if ((await occupancy(slot.id)) >= (slot.capacity || 1))
      throw Object.assign(new Error("Turma lotada — escolha outro horário."), { code: 409 });
    // A 1ª aula oficial já entra nas regras do plano que ela está escolhendo.
    // A janela da escala não vale: é justamente a aula que abre o ciclo dela.
    await exigirRegras({ ...client, plan: "mensalista", mensalistaTipo: tipo }, slot, {
      forcar: !!forcar,
      ignorarJanela: true,
    });
    booking = await prisma.booking.create({
      data: {
        clientName: client.name, phone: client.phone || "", unit: slot.unit,
        date: slot.date, time: slot.time, prof: slot.prof || profFor(slot.unit),
        slotId: slot.id, status: "confirmada", value: 0, paid: true, paymentMethod: "Mensalista",
        paymentDate: todayISO(),
      },
    });
  }

  /* Dia do vencimento: o dia em que ela se matriculou vira o dia dela, todo mês.
     Quem se matricula dia 19 paga todo dia 19. Se a Inêz já tiver definido um
     dia no cadastro, esse manda — é a exceção prevista ("a não ser que a aluna
     peça para trocar"). Dias 29/30/31 caem para 28, que existe em todo mês. */
  const dia = billingDay != null
    ? Math.min(28, Math.max(1, parseInt(billingDay, 10) || 1))
    : client.billingDay || diaDoMes(todayISO());

  // A 1ª mensalidade paga vira matrícula; quem não pagou entra como isenta.
  const virouMatricula = client.matriculaStatus === "paga" || client.matriculaStatus === "convertida";
  const atualizado = await prisma.client.update({
    where: { id: client.id },
    data: {
      plan: "mensalista",
      status: "ativo",
      weeklyFreq: freq,
      mensalistaTipo: tipo,
      firstClass: false, // deixou de ser aluna nova/experimental
      monthlyValue: null, // passa a seguir a tabela do plano
      billingDay: dia,
      ...(virouMatricula ? { matriculaStatus: "convertida" } : {}),
    },
  });

  /* O mês da matrícula JÁ ESTÁ PAGO quando ela pagou pela tela da experimental:
     aquele Pix era a mensalidade do mês corrente, não uma taxa de entrada. Fica
     registrado aqui como mensalidade quitada para o dinheiro aparecer no
     financeiro (Recebimentos e Mensalistas) em vez de sumir dentro da reserva. */
  let mensalidadeDoMes = null;
  if (mensalidadePaga && Number(mensalidadePaga.valor) > 0) {
    const compAtualStr = competenciaAtual();
    const jaExiste = await prisma.invoice.findFirst({
      where: { clientId: atualizado.id, competencia: compAtualStr },
    });
    mensalidadeDoMes = jaExiste || await prisma.invoice.create({
      data: {
        clientId: atualizado.id,
        competencia: compAtualStr,
        amountCents: Math.round(Number(mensalidadePaga.valor) * 100),
        // vence e é paga no mesmo dia: ela pagou à vista para se matricular
        dueDate: mensalidadePaga.pagoEm,
        status: "pago",
        paidAt: mensalidadePaga.pagoEm,
        /* Guarda o txid da cobrança que ela pagou (o da RESERVA, formato FQCB).
           É só rastreabilidade: nasce paga, então nem a reemissão nem o webhook
           mexem nela — confirmarPagamentoPorTxid ignora invoice já paga. */
        txid: mensalidadePaga.txid || null,
      },
    });
  }

  /* Próxima mensalidade: cai no MÊS SEGUINTE ao da matrícula, no mesmo dia.
     Matriculou em 19/08 → a próxima vence 19/09, e daí todo dia 19. */
  let invoice = null;
  const proximaComp = somarComp(competenciaAtual(), 1);
  try { invoice = await gerarMensalidade(atualizado.id, proximaComp); }
  catch (e) { console.warn(`[conversao] ${atualizado.name}: ${e.message}`); }

  return {
    client: safeClient(atualizado),
    booking,
    invoice,
    // mensalidade do mês corrente, já quitada no ato da matrícula (ou null)
    mensalidadeDoMes,
    valorMensal: mensalidadeValorDe(atualizado),
    // a tela precisa dizer à aluna quando cai a PRÓXIMA cobrança
    primeiroVencimento: invoice?.dueDate || null,
  };
}

/* ---------- TROCAR O PLANO DE QUEM JÁ É MENSALISTA ----------

   Isto não existia: `converterEmMensalista` recusava com "Esta aluna já é
   mensalista." e o PATCH /api/clients nem aceitava `weeklyFreq`. O plano era
   imutável depois de definido — o painel tentava trocar e levava 409.

   A troca vale A PARTIR DO MÊS SEGUINTE, nas duas pontas:

   • Dinheiro — o mês corrente é fixado no valor ANTIGO em `MonthlyPrice`. Não
     basta contar com "a mensalidade deste mês já foi gerada, então já tem o
     valor velho": a geração automática está desligada e a Inêz emite à mão,
     às vezes depois do dia. Sem fixar, uma mensalidade de agosto emitida em
     31/08 sairia no preço de setembro.

   • Aulas — `weeklyFreq` já passa a ser o plano novo (é o que a ficha mostra),
     e `weeklyFreqAnterior`/`weeklyFreqDesde` dizem de quando ele vale. O teto
     semanal mede pela data da aula, então a semana que está acabando continua
     medida pelo plano velho.

   Devolve o antes/depois pronto para a tela dizer à Inêz o que aconteceu. */
async function trocarPlanoMensalista(client, { weeklyFreq, mensalistaTipo, billingDay }) {
  const freqAntiga = Number(client.weeklyFreq) || 1;
  const freqNova = Number(weeklyFreq) === 2 ? 2 : 1;
  const tipoAntigo = client.mensalistaTipo === "escala" ? "escala" : "fixo";
  const tipoNovo = mensalistaTipo === undefined
    ? tipoAntigo
    : (mensalistaTipo === "escala" ? "escala" : "fixo");

  const compAtual = competenciaAtual();
  const desde = somarComp(compAtual, 1);
  const mudouFreq = freqNova !== freqAntiga;

  /* Valor individual manda sobre o plano, então trocar de 1x para 2x não muda o
     que ela paga — e não há mês corrente a proteger. A tela precisa dizer isso,
     senão a Inêz troca o plano esperando um reajuste que não vem. */
  const temValorIndividual = client.monthlyValue != null;
  let fixouMesCorrente = null;
  if (mudouFreq && !temValorIndividual) {
    const valorAntigo = valorDoPlano(freqAntiga) || 0;
    if (valorAntigo > 0) {
      await prisma.monthlyPrice.upsert({
        where: { clientId_competencia: { clientId: client.id, competencia: compAtual } },
        update: { amountCents: Math.round(valorAntigo * 100), origem: "ajuste", motivo: `Plano trocado para ${freqNova}x — este mês mantém o valor do plano anterior` },
        create: { clientId: client.id, competencia: compAtual, amountCents: Math.round(valorAntigo * 100), origem: "ajuste", motivo: `Plano trocado para ${freqNova}x — este mês mantém o valor do plano anterior` },
      });
      fixouMesCorrente = valorAntigo;
    }
  }

  const atualizado = await prisma.client.update({
    where: { id: client.id },
    data: {
      weeklyFreq: freqNova,
      mensalistaTipo: tipoNovo,
      ...(mudouFreq ? { weeklyFreqAnterior: freqAntiga, weeklyFreqDesde: desde } : {}),
      ...(billingDay != null && billingDay !== ""
        ? { billingDay: Math.min(28, Math.max(1, parseInt(billingDay, 10) || 1)) }
        : {}),
    },
  });

  console.log(`[plano] ${client.name}: ${freqAntiga}x → ${freqNova}x (${tipoAntigo} → ${tipoNovo}), valendo de ${desde}.`);

  return {
    client: atualizado,
    troca: {
      mudouFreq,
      mudouTipo: tipoNovo !== tipoAntigo,
      freqDe: freqAntiga,
      freqPara: freqNova,
      tipoDe: tipoAntigo,
      tipoPara: tipoNovo,
      valorDe: valorDoPlano(freqAntiga) || 0,
      valorPara: valorDoPlano(freqNova) || 0,
      temValorIndividual,
      valorIndividual: client.monthlyValue ?? null,
      mesCorrente: compAtual,
      valeAPartirDe: desde,
      fixouMesCorrente,
    },
  };
}

/* Matricular OU trocar o plano, pelo painel.
   body { weeklyFreq, slotId?, billingDay?, mensalistaTipo? } */
app.post("/api/clients/:id/enroll", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try {
    // Já é mensalista com plano definido? Então isto é troca, não matrícula.
    const jaEMensalista = client.plan === "mensalista" && !!client.weeklyFreq;
    res.json(jaEMensalista
      ? await trocarPlanoMensalista(client, req.body || {})
      : await converterEmMensalista(client, req.body || {}));
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
}));

/* Devolução INTEGRAL da 1ª mensalidade — a aluna fez a experimental e não quis
   continuar. Como ela já sai matriculada ao pagar, devolver também precisa
   DESFAZER a matrícula: senão ela ficaria com mensalidade e aulas de um plano
   que nunca começou.

   O sistema só registra a devolução; o Pix de volta a Inêz faz por fora. */
app.post("/api/clients/:id/matricula/refund", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  if (client.matriculaStatus === "devolvida")
    return res.status(409).json({ error: "A matrícula já consta como devolvida." });
  if (client.matriculaStatus !== "paga" && client.matriculaStatus !== "convertida")
    return res.status(409).json({ error: "A 1ª mensalidade não consta como paga." });

  const t = todayISO();
  const desfez = { aulas: 0, mensalidades: 0, eraMensalista: client.plan === "mensalista" };

  // Aulas futuras do plano somem — a aula experimental (já realizada) fica no histórico.
  const aulas = await prisma.booking.updateMany({
    where: { clientName: client.name, date: { gte: t }, status: { not: "cancelada" }, paymentMethod: { notIn: MARCAS_MATRICULA } },
    data: { status: "cancelada", absenceReason: "Matrícula devolvida — aluna não continuou" },
  });
  desfez.aulas = aulas.count;

  /* Toda mensalidade em aberto cai: ela não chegou a usar o plano. A do mês da
     matrícula está PAGA — é justamente o dinheiro que está voltando — então ela
     cai junto, senão o financeiro seguiria contando como receita algo devolvido. */
  const compDaMatricula = (client.matriculaAt || t).slice(0, 7);
  const inv = await prisma.invoice.updateMany({
    where: {
      clientId: client.id,
      OR: [{ status: "pendente" }, { status: "pago", competencia: compDaMatricula }],
    },
    data: { status: "cancelado" },
  });
  desfez.mensalidades = inv.count;

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: {
      matriculaStatus: "devolvida",
      matriculaRefundAt: req.body?.date || t,
      // volta ao estado de quem não é aluna: sem plano, sem cobrança recorrente
      plan: "avulso",
      weeklyFreq: null,
      billingDay: null,
    },
  });
  res.json({ ...safeClient(updated), desfez });
}));

// Saldo/histórico de reposição (admin)
app.get("/api/clients/:id/makeup", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  res.json(await resumoReposicao(client));
}));

// Marcar aula extra avulsa pelo painel (admin) — body { slotId, forcar? }
app.post("/api/clients/:id/extra-book", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try { res.json(await marcarAulaExtra(client, req.body?.slotId, { forcar: !!req.body?.forcar })); }
  catch (e) { res.status(e.code || 500).json({ error: e.message, codigo: e.codigo }); }
}));

// Marcar reposição pelo painel (admin) — body { slotId, forcar? }
app.post("/api/clients/:id/makeup-book", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  try {
    res.json(await marcarReposicao(client, req.body?.slotId, { forcar: !!req.body?.forcar }));
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message, codigo: e.codigo });
  }
}));

// Liberar a aula pelo painel, aplicando as mesmas regras de crédito do portal
app.post("/api/bookings/:id/release", wrap(async (req, res) => {
  const b = await prisma.booking.findUnique({ where: { id: Number(req.params.id) } });
  if (!b) return res.status(404).json({ error: "Aula não encontrada." });
  const client = await prisma.client.findFirst({ where: { name: b.clientName } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const r = await liberarAula(client, b, { absenceReason: String(req.body?.reason || "").slice(0, 500) });
  res.json({ ok: true, ...r });
}));

/* ---------- AGENDAMENTO EM LOTE (mensalista) ---------- */
// Agenda o aluno em várias turmas de uma vez, só nos horários JÁ existentes,
// respeitando a capacidade. Body: { unit, time, dates: ['YYYY-MM-DD', ...], forcar? }
// A janela da escala não vale aqui: quem agenda em lote é a Inêz, não a aluna.
app.post("/api/clients/:id/batch-book", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado" });
  const { unit, time } = req.body || {};
  const forcar = !!req.body?.forcar;
  const dates = Array.isArray(req.body?.dates) ? req.body.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  if (!unit || !time || !dates.length) return res.status(400).json({ error: "Informe unidade, horário e ao menos uma data." });

  const alvos = [...new Set(dates)].sort();

  /* Teto semanal do plano (1x ou 2x). Como o lote cria várias aulas de uma vez,
     a conta precisa ser incremental: partimos do que ela já tem em cada semana
     e vamos somando o que este lote acrescenta. Sem isso, marcar 8 datas de uma
     vez passaria pelo teto todo, porque nenhuma delas existia ainda. */
  const limiteSemana = forcar ? 0 : Number(client.weeklyFreq) || 0;
  const naSemana = new Map(); // segunda 'YYYY-MM-DD' → nº de aulas do plano
  if (limiteSemana) {
    const desde = segundaDaSemana(alvos[0]);
    for (const b of await aulasAtivasDe(client, desde)) {
      if (b.paymentMethod !== PGTO_PLANO) continue; // reposição/extra não ocupam vaga
      const k = segundaDaSemana(b.date);
      naSemana.set(k, (naSemana.get(k) || 0) + 1);
    }
  }

  // Marcação replicada: as aulas criadas na mesma leva ganham um seriesId em
  // comum, para a exclusão poder oferecer "excluir também as demais".
  const seriesId = new Set(dates).size > 1 ? crypto.randomUUID() : null;
  const agendadas = [], pulos = { semTurma: 0, cheia: 0, jaAgendado: 0, teto: 0 };
  for (const date of alvos) {
    const semana = segundaDaSemana(date);
    if (limiteSemana && (naSemana.get(semana) || 0) >= limiteSemana) { pulos.teto++; continue; }
    const slot = await prisma.slot.findFirst({ where: { date, time, unit } });
    if (!slot) { pulos.semTurma++; continue; }
    // já agendado nesta turma?
    const jaTem = await prisma.booking.findFirst({ where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } } });
    if (jaTem) { pulos.jaAgendado++; continue; }
    // capacidade
    if ((await occupancy(slot.id)) >= (slot.capacity || 1)) { pulos.cheia++; continue; }
    const b = await prisma.booking.create({
      data: {
        clientName: client.name, phone: client.phone || "", unit, date, time, prof: slot.prof || profFor(unit),
        slotId: slot.id, seriesId, status: "confirmada", value: 0, paid: false, paymentMethod: PGTO_PLANO,
      },
    });
    agendadas.push(b);
    if (limiteSemana) naSemana.set(semana, (naSemana.get(semana) || 0) + 1);
  }
  res.json({ agendadas: agendadas.length, pulos });
}));

/* ---------- WHATSAPP (Cloud API) ---------- */
// Verificação do webhook (a Meta chama com GET ao registrar a URL)
app.get("/api/wa/webhook", (req, res) => {
  const challenge = waVerify(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
  if (challenge) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// Recebe mensagens e conduz o fluxo de agendamento.
const waSeen = new Set(); // dedupe simples de message ids (a Meta reenvia)
app.post("/api/wa/webhook", async (req, res) => {
  res.sendStatus(200); // ACK imediato — a Meta exige resposta rápida
  try {
    const msg = parseIncoming(req.body);
    if (!msg || waSeen.has(msg.id)) return;
    waSeen.add(msg.id);
    if (waSeen.size > 2000) waSeen.clear();
    console.log(`[wa] recebido de ${msg.from} (${msg.name}): "${msg.text}"`);
    if (!waConfigured()) return;
    await handleWaMessage(msg);
  } catch (e) {
    console.error("[wa webhook]", e.message, e.body || "");
  }
});

/* ---------- Fluxo de agendamento pelo WhatsApp ---------- */
const DOW_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function fmtSlotBR(s) {
  const d = new Date(s.date + "T00:00");
  const [, m, day] = s.date.split("-");
  return `${DOW_PT[d.getDay()]} ${day}/${m} às ${s.time}`;
}
// Só o dia — título da lista do WhatsApp tem limite de 24 caracteres,
// então a hora e as vagas vão na descrição.
function fmtSlotDia(s) {
  const d = new Date(s.date + "T00:00");
  const [, m, day] = s.date.split("-");
  return `${DOW_PT[d.getDay()]} ${day}/${m}`;
}
async function waSend(to, text) {
  try { await sendWaText(to, text); console.log(`[wa] respondido para ${to}`); }
  catch (e) { console.error("[wa send]", e.message, e.body || ""); }
}
async function waButtons(to, body, buttons) {
  try { await sendWaButtons(to, body, buttons); console.log(`[wa] botões para ${to}`); }
  catch (e) { console.error("[wa send]", e.message, e.body || ""); }
}
async function waList(to, body, buttonText, rows) {
  try { await sendWaList(to, body, buttonText, rows); console.log(`[wa] lista para ${to}`); }
  catch (e) { console.error("[wa send]", e.message, e.body || ""); }
}
// menu de unidades: botões se couber (≤3), senão lista
async function sendUnitMenu(to, body) {
  const us = SETTINGS.units;
  if (us.length <= 3) return waButtons(to, body, us.map((u) => ({ id: "unit:" + u, title: u })));
  return waList(to, body, "Escolher unidade", us.map((u) => ({ id: "unit:" + u, title: u })));
}
const unitsMenu = () => SETTINGS.units.map((u, i) => `${i + 1}️⃣ ${u}`).join("\n");
function parseUnitChoice(body) {
  const us = SETTINGS.units;
  const n = parseInt(body, 10);
  if (n >= 1 && n <= us.length) return us[n - 1];
  const low = body.toLowerCase();
  return us.find((u) => low.includes(u.toLowerCase())) || null;
}
async function waAvailableSlots(unit) {
  const t = todayISO();
  const [slots, bookings] = await Promise.all([
    prisma.slot.findMany(),
    prisma.booking.findMany({ where: { status: { not: "cancelada" } } }),
  ]);
  const occ = {};
  bookings.forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });
  return slots
    .filter((s) => s.date >= t && s.unit === unit && (occ[s.id] || 0) < s.capacity)
    .map((s) => ({ ...s, vagas: s.capacity - (occ[s.id] || 0) }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
/* Reserva provisória do WhatsApp: a vaga fica SEGURADA por HOLD_MIN minutos
   enquanto a aluna paga a 1ª mensalidade. Combinado com a Inêz em 30/08/2026 —
   antes disso a conversa reservava sem pagar nada, e conversa abandonada tirava
   a vaga de quem ia pagar.

   A meia hora do fim (HOLD_AVISO_MIN), o bot pergunta se ficou dúvida e oferece
   o atendimento humano: é a última chance de destravar antes de a vaga sair. */
const HOLD_MIN = 60;
const HOLD_AVISO_MIN = 30;

/* Cria a reserva da experimental já como pagamento de matrícula: o valor é a 1ª
   MENSALIDADE do plano escolhido (é ela que matricula a aluna — ver
   registrarMatriculaPaga), e o plano fica guardado no cadastro como INTENÇÃO,
   exatamente como faz a tela da matrícula no site. */
async function createWaBooking(nomeBruto, phone, slot, { weeklyFreq, cpf }) {
  const name = padronizarNome(nomeBruto);
  const freq = Number(weeklyFreq) === 2 ? 2 : 1;
  const booking = await prisma.booking.create({
    data: {
      clientName: name, phone: phone || "", unit: slot.unit,
      date: slot.date, time: slot.time, prof: slot.prof, slotId: slot.id,
      status: "aguardando",
      value: valorDoPlano(freq),
      paymentMethod: MARCA_MATRICULA,
      holdUntil: new Date(Date.now() + HOLD_MIN * 60_000),
    },
  });
  // sem etiqueta: "Lead" saiu do sistema (ver VALID_TAGS lá em cima)
  const client = await ensureClient(name, phone, slot.unit, [], cpf, null, true);
  await prisma.client.update({
    where: { id: client.id },
    data: {
      matriculaStatus: "pendente",
      trialDate: slot.date,
      weeklyFreq: freq,
      mensalistaTipo: "fixo",
      ...(cpf && !client.cpf ? { cpf: onlyDigits(cpf) } : {}),
    },
  });
  return { booking, client };
}

/* Libera a vaga de uma reserva cujo prazo estourou. Não é cancelamento de aula:
   é a reserva que nunca chegou a existir de verdade, porque não foi paga. */
async function expirarReservaWa(booking) {
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "cancelada", holdUntil: null, absenceReason: "Reserva não paga no prazo — vaga liberada" },
  });
  await prisma.waConversation.updateMany({
    where: { bookingId: booking.id },
    data: { step: "start", bookingId: null, slotId: null, pendingName: null, weeklyFreq: null },
  });
  if (booking.phone) {
    await waSend(booking.phone, textoHoldExpirado({
      nome: booking.clientName,
      quando: fmtSlotBR({ date: booking.date, time: booking.time }),
    }));
  }
  console.log(`[wa hold] reserva ${booking.id} (${booking.clientName}) expirou — vaga liberada.`);
}

/* Rodada das reservas seguradas. Roda de 5 em 5 minutos: cutuca quem está a
   meia hora do fim e libera quem passou do prazo. Só olha reserva com holdUntil,
   então nada do painel ou do site entra aqui. */
async function rodadaReservasSeguradas() {
  const agora = new Date();
  const pendentes = await prisma.booking.findMany({
    where: { holdUntil: { not: null }, paid: false, status: "aguardando" },
  });
  for (const b of pendentes) {
    const fim = new Date(b.holdUntil);
    /* ANTES de soltar a vaga, pergunta ao banco se o Pix caiu.

       O webhook do Sicredi é o caminho normal, mas ele é um caminho só: se
       estiver fora do ar por vinte minutos — ou se a notificação simplesmente se
       perder — a reserva expiraria com o dinheiro dentro. A aluna teria pago e
       perdido a vaga, que é o pior que este sistema pode fazer com alguém.

       `confirmarPagamentoPorTxid` consulta o Sicredi com mTLS e, se estiver
       pago, faz a baixa inteira: confirma a reserva, matricula e dispara o
       agradecimento com as regras. Custa uma chamada por reserva prestes a
       expirar — raras, e o cenário que evita é caro demais para economizar. */
    if (agora >= fim) {
      if (b.txid && (await confirmarPagamentoPorTxid(b.txid).catch(() => false))) {
        console.log(`[wa hold] reserva ${b.id} estava paga — confirmada na consulta ao Sicredi, não expirou.`);
        continue;
      }
      await expirarReservaWa(b);
      continue;
    }
    const faltam = Math.round((fim - agora) / 60_000);
    if (!b.holdNudged && faltam <= HOLD_AVISO_MIN) {
      // Mesma consulta antes de cutucar: perguntar "ficou alguma dúvida?" para
      // quem já pagou é a mensagem errada na pior hora.
      if (b.txid && (await confirmarPagamentoPorTxid(b.txid).catch(() => false))) continue;
      await prisma.booking.update({ where: { id: b.id }, data: { holdNudged: true } });
      if (b.phone) {
        await waSend(b.phone, textoLembreteHold({ nome: b.clientName, minutos: Math.max(1, faltam) }));
        await waButtons(b.phone, "Posso te ajudar com alguma coisa?", [
          { id: "duvida:pix", title: "💠 Reenviar o Pix" },
          { id: "humano", title: "Falar com atendente" },
        ]);
      }
    }
  }
}
/* Conversa parada no meio: a aluna começou a marcar e sumiu. Depois de
   INATIVIDADE_MIN minutos em silêncio, o bot retoma dizendo o que falta.

   Três cuidados que fazem a diferença entre lembrete e chateação:

   • UMA vez por abandono (`retomadaAt`), limpo assim que ela responde. Insistir
     com quem não respondeu é o caminho curto para o bloqueio — e um número
     bloqueado não agenda mais ninguém.
   • Só conversas paradas há menos de 24h: passada a janela do WhatsApp, texto
     livre não é entregue, e o assunto já esfriou de qualquer jeito.
   • O passo `cobranca` fica FORA: ele já tem o lembrete da vaga segurada, que
     cai mais ou menos na mesma hora. Dois recados seguidos sobre a mesma coisa
     soam como cobrança. */
const INATIVIDADE_MIN = 30;
const PASSOS_RETOMAVEIS = Object.keys(PENDENCIA_POR_PASSO);

async function rodadaConversasParadas() {
  if (!SETTINGS.waAvisosAuto) return; // ver rodadaAvisosMensalidade
  if (!waConfigured() || !podeMandarAgora()) return;
  const agora = Date.now();
  const paradas = await prisma.waConversation.findMany({
    where: {
      step: { in: PASSOS_RETOMAVEIS },
      retomadaAt: null,
      updatedAt: {
        lt: new Date(agora - INATIVIDADE_MIN * 60_000),
        gt: new Date(agora - 24 * 60 * 60_000),
      },
    },
  });
  for (const c of paradas) {
    const nome = c.pendingName || (await prisma.client.findFirst({ where: { phone: c.phone } }))?.name || "";
    await prisma.waConversation.update({ where: { phone: c.phone }, data: { retomadaAt: new Date() } });
    await waSend(c.phone, textoConversaParada({ nome, pendencia: PENDENCIA_POR_PASSO[c.step] }));
    await waButtons(c.phone, "Quer continuar?", [
      // títulos de botão param em 20 caracteres — a wa.js corta em silêncio
      { id: "retomar", title: "Continuar" },
      { id: "new", title: "Recomeçar" },
      { id: "humano", title: "Falar com atendente" },
    ]);
    console.log(`[wa] conversa de ${c.phone} retomada no passo "${c.step}".`);
  }
}

setInterval(() => rodadaReservasSeguradas().catch((e) => console.warn("[wa hold]", e.message)), 5 * 60 * 1000);
setTimeout(() => rodadaReservasSeguradas().catch(() => {}), 30_000);
setInterval(() => rodadaConversasParadas().catch((e) => console.warn("[wa parada]", e.message)), 5 * 60 * 1000);
setTimeout(() => rodadaConversasParadas().catch(() => {}), 60_000);

async function handleWaMessage(msg) {
  const phone = normalizePhone(msg.from);
  const body = (msg.text || "").trim();
  const low = body.toLowerCase();
  const rid = msg.replyId || "";
  let conv = await prisma.waConversation.findUnique({ where: { phone } });
  if (!conv) conv = await prisma.waConversation.create({ data: { phone } });

  /* Ela respondeu: o abandono acabou. Limpar aqui é o que devolve o direito a um
     novo lembrete se ela sumir de novo mais adiante — e só escreve quando há o
     que limpar, para não gravar por gravar a cada mensagem. */
  if (conv.retomadaAt) {
    conv = await prisma.waConversation.update({ where: { phone }, data: { retomadaAt: null } });
  }

  const setConv = (data) => prisma.waConversation.update({ where: { phone }, data });

  /* ----- telas ----- */
  const telaUnidade = async (prefix = "") => {
    // Recomeçar limpa tudo o que a conversa carregava — inclusive o plano, o CPF
    // e a reserva anterior. A reserva em si continua segurada até o prazo dela;
    // quem a solta é a rodada, não o fato de a aluna ter recomeçado o menu.
    await setConv({ step: "unit", unit: null, slotId: null, offered: "[]", pendingName: null, weeklyFreq: null, bookingId: null });
    const nome = msg.name ? " " + msg.name.split(" ")[0] : "";
    return sendUnitMenu(msg.from, `${prefix}Olá${nome}! 💚 Sou o assistente da *Fios que Curam*. Vamos agendar sua aula? Escolha a unidade:`);
  };

  const telaHorarios = async (unit, prefix = "") => {
    const slots = await waAvailableSlots(unit);
    if (!slots.length) {
      await setConv({ step: "unit", pendingName: null });
      return sendUnitMenu(msg.from, `No momento não há horários livres em *${unit}*. 😢 Quer ver a outra unidade?`);
    }
    const top = slots.slice(0, 9); // 9 horários + a linha de voltar = 10 (limite da Meta)
    const rows = top.map((s) => ({ id: "slot:" + s.id, title: fmtSlotDia(s), description: `${s.time} · ${s.vagas} vaga(s)` }));
    rows.push({ id: "back:unit", title: "← Trocar unidade", description: "Escolher outra unidade" });
    await setConv({ step: "slot", unit, slotId: null, pendingName: null, offered: JSON.stringify(top.map((s) => s.id)) });
    return waList(msg.from, `${prefix}📅 Toque para escolher um horário em *${unit}*:`, "Ver horários", rows);
  };

  // Nada é reservado sem passar por aqui.
  const telaConfirmarHorario = async (slot) => {
    await setConv({ step: "confirm", unit: slot.unit, slotId: slot.id });
    return waButtons(
      msg.from,
      `Confere pra mim antes de reservar 👇\n\n📍 *${slot.unit}*\n🗓️ ${fmtSlotBR(slot)}\n\nEstá correto?`,
      [{ id: "ok:slot", title: "✅ Confirmar" }, { id: "back:slot", title: "🔄 Outro horário" }, { id: "back:unit", title: "← Trocar unidade" }]
    );
  };

  const telaNome = async (prefix = "") => {
    await setConv({ step: "name", pendingName: null });
    return waButtons(msg.from, `${prefix}Quase lá! Me diz seu *nome completo* (é só digitar aqui) 💚`, [
      { id: "back:slot", title: "← Voltar" },
    ]);
  };

  // O nome digitado no WhatsApp já entra padronizado ("MARIA DA SILVA" vira
  // "Maria da Silva") — e a aluna confirma exatamente como vai ficar gravado.
  const telaConfirmarNome = async (nomeDigitado) => {
    const name = padronizarNome(nomeDigitado);
    await setConv({ step: "nameok", pendingName: name });
    return waButtons(msg.from, `Confirma o nome da reserva?\n\n👤 *${name}*`, [
      { id: "ok:name", title: "✅ Sim, reservar" },
      { id: "edit:name", title: "✏️ Corrigir nome" },
    ]);
  };

  /* Escolher o plano é o que define o VALOR da 1ª mensalidade — e é ela que
     matricula a aluna. Vem antes do CPF porque é a pergunta agradável (o que
     você quer?) e o CPF é a burocrática; nesta ordem, quem desiste desiste
     antes de digitar documento. */
  const telaPlano = async (name, prefix = "") => {
    await setConv({ step: "plano", pendingName: name });
    return waButtons(
      msg.from,
      `${prefix}Show, ${name.split(" ")[0]}! 💚 Quantas aulas por semana você quer fazer?\n\n` +
      `1️⃣ *1x por semana* — ${moedaBR(valorDoPlano(1))} por mês\n` +
      `2️⃣ *2x por semana* — ${moedaBR(valorDoPlano(2))} por mês\n\n` +
      `A primeira aula já entra nesse valor: você paga a 1ª mensalidade e, se decidir não continuar depois dela, devolvemos tudo.`,
      [
        { id: "plano:1", title: "1x por semana" },
        { id: "plano:2", title: "2x por semana" },
      ]
    );
  };

  // O Sicredi exige CPF do pagador para emitir a cobrança Pix — sem ele não há
  // como cobrar, então a pergunta é obrigatória e explica o porquê.
  const telaCpf = async (prefix = "") => {
    await setConv({ step: "cpf" });
    return waSend(msg.from, `${prefix}Por favor, me manda o seu *CPF* (só os números) 💚\n\nÉ o banco que pede, para emitir o Pix no seu nome.`);
  };

  /* Fecha a reserva: cria a aula segurada, emite o Pix e manda o código. A vaga
     fica de pé por HOLD_MIN minutos — quem confirma a reserva é o pagamento. */
  const cobrar = async (name, slot, freq, cpf) => {
    const occ = await prisma.booking.count({ where: { slotId: slot.id, status: { not: "cancelada" } } });
    if (occ >= slot.capacity) return telaUnidade("Esse horário lotou enquanto conversávamos. 😔 Vamos de novo: ");
    const { booking } = await createWaBooking(name, phone, slot, { weeklyFreq: freq, cpf });
    let pixCode = "";
    try {
      ({ pixCode } = await emitirPixDaReserva(booking, { cpf, name }));
    } catch (e) {
      /* Sem Pix a vaga não pode ficar segurada em silêncio: a aluna não teria
         como pagar e ainda ocuparia o lugar de quem tem. Solta e chama humano. */
      console.warn(`[wa] Pix da reserva ${booking.id} falhou: ${e.message}`);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: "cancelada", holdUntil: null, absenceReason: "Falha ao emitir o Pix da reserva" },
      });
      await setConv({ step: "done", slotId: null, bookingId: null, pendingName: null });
      return waSend(msg.from, `Ops, não consegui gerar o Pix agora. 😞 Me chama neste número que a gente resolve na hora:\n📞 ${WA_ATENDENTE}`);
    }
    await setConv({ step: "cobranca", bookingId: booking.id, cpf, weeklyFreq: freq, pendingName: null });
    await waSend(msg.from, textoCobrancaReserva({
      nome: name,
      unidade: slot.unit,
      quando: fmtSlotBR(slot),
      valor: moedaBR(valorDoPlano(freq)),
      minutos: HOLD_MIN,
    }));
    // O código vai SOZINHO numa mensagem: assim ela copia com um toque, sem
    // arrastar junto o texto acima.
    if (pixCode) await waSend(msg.from, pixCode);
    return waButtons(msg.from, "Assim que o pagamento cair eu te confirmo por aqui. 💚", [
      { id: "duvida:pix", title: "💠 Reenviar o Pix" },
      { id: "humano", title: "Falar com atendente" },
    ]);
  };

  /* ----- atendimento humano: vale em QUALQUER passo, e vem antes de tudo -----
     A Inêz pediu para insistir no automático — o texto tenta uma vez e entrega o
     número. Não trava a conversa: o bot segue respondendo se ela continuar. */
  if (rid === "humano" || /\b(atendente|humano|pessoa real|falar com alguém|falar com alguem)\b/.test(low))
    return waSend(msg.from, textoAtendenteHumano());

  /* ----- respostas ao lembrete da véspera -----
     "Não vou poder ir" libera a vaga pelo MESMO caminho do portal: as regras de
     reposição valem iguais, e o crédito sai (ou não) pelo mesmo cálculo. O bot
     não decide nada — ele só entrega o motivo que `liberarAula` devolveu, que é
     o texto que explica por que houve ou não crédito. */
  if (rid.startsWith("faltarei:")) {
    const b = await prisma.booking.findUnique({ where: { id: parseInt(rid.slice(9), 10) } });
    // Só a dona da aula pode liberá-la: o id vem de um botão, e botão de
    // mensagem antiga pode ser tocado por qualquer um que tenha o histórico.
    if (!b || normalizePhone(b.phone || "") !== phone) {
      return waSend(msg.from, "Não encontrei essa aula no seu nome. Me chama que eu te ajudo. 💚");
    }
    if (b.status === "cancelada") return waSend(msg.from, "Essa aula já está liberada. 💚");
    const client = await prisma.client.findFirst({ where: { name: b.clientName } });
    if (!client) return waSend(msg.from, `Não achei seu cadastro. Me chama neste número:\n📞 ${WA_ATENDENTE}`);
    const r = await liberarAula(client, b, { absenceReason: "Avisou pelo WhatsApp que não poderá ir" });
    return waSend(msg.from,
      r.credito
        ? `Pronto, avisei a escola e liberei a sua vaga. 💚\n\nVocê ganhou *1 crédito de reposição* — marque pelo portal:\n${WA_PORTAL_URL}`
        : `Pronto, avisei a escola e liberei a sua vaga. 💚${r.motivo ? "\n\n" + r.motivo : ""}`);
  }
  if (rid.startsWith("presenca:")) {
    return waSend(msg.from, "Combinado, te espero lá! 🧶💚");
  }

  /* "Continuar de onde parei": repete a tela do passo em que ela estava. Não
     avança nada — só mostra de novo a pergunta que ficou sem resposta. */
  if (rid === "retomar") {
    if (conv.step === "unit") return sendUnitMenu(msg.from, "Vamos lá! Escolha a unidade 👇");
    if (conv.step === "slot") return telaHorarios(conv.unit || SETTINGS.units[0], "Retomando! ");
    if (conv.step === "confirm" && conv.slotId) {
      const s = await prisma.slot.findUnique({ where: { id: conv.slotId } });
      if (s) return telaConfirmarHorario(s);
    }
    if (conv.step === "name") return telaNome("Retomando! ");
    if (conv.step === "nameok" && conv.pendingName) return telaConfirmarNome(conv.pendingName);
    if (conv.step === "plano") return telaPlano(conv.pendingName || "", "Retomando! ");
    if (conv.step === "cpf") return telaCpf("Retomando! ");
    return telaUnidade();
  }

  // Reenviar o Pix da reserva que está segurada agora.
  if (rid === "duvida:pix") {
    const b = conv.bookingId ? await prisma.booking.findUnique({ where: { id: conv.bookingId } }) : null;
    if (b && b.pixCode && !b.paid && b.status === "aguardando") {
      await waSend(msg.from, "Segue o Pix da sua reserva 👇");
      return waSend(msg.from, b.pixCode);
    }
    return waSend(msg.from, "Não encontrei uma reserva aguardando pagamento por aqui. Quer marcar uma aula? É só dizer *menu*. 💚");
  }

  /* ----- navegação por botão: vale em qualquer passo ----- */
  if (rid === "new" || ["menu", "oi", "olá", "ola", "agendar", "começar", "comecar", "início", "inicio"].includes(low))
    return telaUnidade();
  if (rid === "back:unit") return telaUnidade();
  if (rid === "back:slot") return telaHorarios(conv.unit || SETTINGS.units[0]);
  if (rid.startsWith("unit:")) {
    const u = rid.slice(5);
    if (SETTINGS.units.includes(u)) return telaHorarios(u);
  }
  // Tocar num horário (inclusive de mensagem antiga) sempre cai na confirmação,
  // nunca direto na reserva — foi o que criou a reserva com nome "Ipatinga".
  if (rid.startsWith("slot:")) {
    const s = await prisma.slot.findUnique({ where: { id: parseInt(rid.slice(5), 10) } });
    if (s) return telaConfirmarHorario(s);
  }

  if (conv.step === "start" || conv.step === "done") return telaUnidade();

  if (conv.step === "unit") {
    const unit = parseUnitChoice(body);
    if (!unit || !SETTINGS.units.includes(unit)) return sendUnitMenu(msg.from, `Não entendi 🤔. Toque em uma das unidades:`);
    return telaHorarios(unit);
  }

  if (conv.step === "slot") {
    const offered = JSON.parse(conv.offered || "[]");
    const n = parseInt(body, 10);
    if (n >= 1 && n <= offered.length) {
      const s = await prisma.slot.findUnique({ where: { id: offered[n - 1] } });
      if (s) return telaConfirmarHorario(s);
    }
    return waSend(msg.from, `Toque em *Ver horários* e escolha um da lista. 💚`);
  }

  if (conv.step === "confirm") {
    if (rid === "ok:slot") {
      const slot = conv.slotId ? await prisma.slot.findUnique({ where: { id: conv.slotId } }) : null;
      if (!slot) return telaUnidade("Esse horário expirou. ");
      const client = await prisma.client.findFirst({ where: { phone } });
      /* Este fluxo cobra a 1ª MENSALIDADE — é o que matricula quem está
         chegando. Quem já passou pela experimental não pode entrar aqui: a aula
         dela já está paga dentro da mensalidade do mês, e cobrar de novo seria
         vender duas vezes a mesma coisa. Ela marca pelo portal, onde as regras
         do plano (teto da semana, janela da escala) são aplicadas. */
      if (client && jaTeveExperimental(client)) {
        await setConv({ step: "done", slotId: null });
        return waSend(msg.from,
          `${client.name.split(" ")[0]}, você já é nossa aluna! 💚 Suas aulas você marca pelo *portal da aluna* — lá o sistema já conhece o seu plano e o seu saldo de reposição:\n\n` +
          `${WA_PORTAL_URL}\n\n` +
          `Se tiver qualquer dificuldade, me chama neste número:\n📞 ${WA_ATENDENTE}`);
      }
      if (client && client.name) return telaPlano(client.name);
      return telaNome();
    }
    return waButtons(msg.from, `Toque em *Confirmar* para reservar, ou escolha outro horário 👇`, [
      { id: "ok:slot", title: "✅ Confirmar" },
      { id: "back:slot", title: "🔄 Outro horário" },
      { id: "back:unit", title: "← Trocar unidade" },
    ]);
  }

  if (conv.step === "name") {
    const name = body.replace(/\s+/g, " ").trim();
    const pareceUnidade = SETTINGS.units.some((u) => u.toLowerCase() === name.toLowerCase());
    if (name.length < 3 || pareceUnidade || !/\p{L}/u.test(name))
      return waButtons(msg.from, `Preciso do seu *nome completo* para reservar 💚`, [{ id: "back:slot", title: "← Voltar" }]);
    return telaConfirmarNome(name);
  }

  if (conv.step === "nameok") {
    if (rid === "ok:name") {
      const slot = conv.slotId ? await prisma.slot.findUnique({ where: { id: conv.slotId } }) : null;
      if (!slot) return telaUnidade("Esse horário expirou. ");
      if (!conv.pendingName) return telaNome();
      return telaPlano(conv.pendingName);
    }
    if (rid === "edit:name") return telaNome("Sem problema! ");
    // digitou um nome novo em vez de tocar no botão
    const name = body.replace(/\s+/g, " ").trim();
    if (name.length >= 3 && /\p{L}/u.test(name)) return telaConfirmarNome(name);
    return telaConfirmarNome(conv.pendingName || "");
  }

  if (conv.step === "plano") {
    // aceita o botão ("plano:1") ou o número digitado
    const freq = rid === "plano:2" || body.trim() === "2" ? 2
      : rid === "plano:1" || body.trim() === "1" ? 1
      : null;
    if (!freq) return telaPlano(conv.pendingName || "", "Não entendi 🤔. ");
    await setConv({ weeklyFreq: freq });
    return telaCpf();
  }

  if (conv.step === "cpf") {
    const cpf = onlyDigits(body);
    if (!cpfValido(cpf)) return telaCpf("Esse CPF não parece válido 🤔. Confere pra mim? ");
    const slot = conv.slotId ? await prisma.slot.findUnique({ where: { id: conv.slotId } }) : null;
    if (!slot) return telaUnidade("Esse horário expirou. ");
    const name = conv.pendingName || (await prisma.client.findFirst({ where: { phone } }))?.name;
    if (!name) return telaNome();
    return cobrar(name, slot, conv.weeklyFreq || 1, cpf);
  }

  /* Aguardando o Pix. A conversa não avança sozinha: quem move daqui é o
     webhook do Sicredi (avisarMatriculaConfirmada) ou o prazo estourando. */
  if (conv.step === "cobranca") {
    const b = conv.bookingId ? await prisma.booking.findUnique({ where: { id: conv.bookingId } }) : null;
    if (b && b.paid) {
      await setConv({ step: "done", bookingId: null, slotId: null });
      return waButtons(msg.from, "Seu pagamento já está confirmado e sua vaga garantida! 💚", [{ id: "new", title: "🔄 Marcar outra aula" }]);
    }
    return waButtons(msg.from, "Ainda não vi o pagamento cair por aqui. Assim que cair, eu te aviso na hora. 💚", [
      { id: "duvida:pix", title: "💠 Reenviar o Pix" },
      { id: "humano", title: "Falar com atendente" },
    ]);
  }

  return telaUnidade();
}

/* ---------- CLIENTS ---------- */
app.post(
  "/api/clients",
  wrap(async (req, res) => {
    const { phone, email, cpf, unit, tags, notes, birthday, level, firstClass, plan, mensalistaTipo, monthlyValue, billingDay } = req.body;
    const name = padronizarNome(req.body.name);
    if (!name) return res.status(400).json({ error: "name é obrigatório" });
    const cpfDigits = onlyDigits(cpf);
    if (cpfDigits) {
      const existente = await prisma.client.findFirst({ where: { cpf: cpfDigits } });
      if (existente) {
        return res.status(409).json({ error: `Esse CPF já está cadastrado para ${existente.name}. Edite o cadastro dela em vez de criar um novo.` });
      }
    }
    const client = await prisma.client.create({
      data: {
        name, phone: phone || "", email: (email || "").trim() || null, cpf: onlyDigits(cpf) || null, unit: unit || UNITS[0], tags: JSON.stringify(tags || []), notes: notes || "",
        birthday: birthday || null, level: level || null, firstClass: !!firstClass,
        plan: plan === "mensalista" ? "mensalista" : "avulso",
        mensalistaTipo: mensalistaTipo === "escala" ? "escala" : "fixo",
        monthlyValue: monthlyValue === "" || monthlyValue == null ? null : Number(monthlyValue),
        billingDay: billingDay === "" || billingDay == null ? null : Math.min(28, Math.max(1, parseInt(billingDay, 10) || 0)) || null,
      },
    });
    res.json(client);
  })
);

app.patch(
  "/api/clients/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { name, phone, email, cpf, unit, tags, notes, birthday, level, firstClass, plan, mensalistaTipo, status, monthlyValue, billingDay } = req.body;
    const data = {};
    if (name !== undefined) data.name = padronizarNome(name);
    if (phone !== undefined) data.phone = phone;
    if (email !== undefined) data.email = (email || "").trim() || null;
    if (cpf !== undefined) {
      const cpfDigits = onlyDigits(cpf);
      if (cpfDigits) {
        const existente = await prisma.client.findFirst({ where: { cpf: cpfDigits, NOT: { id } } });
        if (existente) {
          return res.status(409).json({ error: `Esse CPF já está cadastrado para ${existente.name}.` });
        }
      }
      data.cpf = cpfDigits || null;
    }
    if (unit !== undefined) data.unit = unit;
    if (tags !== undefined) data.tags = JSON.stringify(tags);
    if (notes !== undefined) data.notes = notes;
    if (birthday !== undefined) data.birthday = birthday || null;
    if (level !== undefined) data.level = level || null;
    if (firstClass !== undefined) data.firstClass = !!firstClass;
    if (plan !== undefined) data.plan = plan === "mensalista" ? "mensalista" : "avulso";
    // fixo = dia e hora fixos (agenda montada pela Inêz) | escala = ela marca durante a semana.
    // podeSabado e podeNoite não entram aqui: continuam na tabela como histórico,
    // mas não governam nada desde que as regras de sábado (30/08) e das 18h
    // (26/08) foram removidas.
    if (mensalistaTipo !== undefined) data.mensalistaTipo = mensalistaTipo === "escala" ? "escala" : "fixo";
    // "cancelado" = rompeu com o curso; perde o direito a reposição
    if (status !== undefined) data.status = status === "cancelado" ? "cancelado" : "ativo";
    if (monthlyValue !== undefined) data.monthlyValue = monthlyValue === "" || monthlyValue == null ? null : Number(monthlyValue);
    if (billingDay !== undefined) data.billingDay = billingDay === "" || billingDay == null ? null : Math.min(28, Math.max(1, parseInt(billingDay, 10) || 0)) || null;

    const antes = await prisma.client.findUnique({ where: { id } });
    if (!antes) return res.status(404).json({ error: "Cadastro não encontrado." });

    /* MUDOU DE NOME: a aula é ligada à aluna pelo NOME (Booking.clientName),
       não pelo id. Trocar só a ficha deixaria todo o histórico órfão — a aluna
       apareceria com zero aula e a agenda com uma pessoa que não existe mais.
       Por isso o nome novo desce junto para as aulas e a lista de espera, tudo
       na mesma transação: ou tudo muda, ou nada muda. */
    const trocouNome = data.name !== undefined && data.name && data.name !== antes.name;
    const [client] = await prisma.$transaction([
      prisma.client.update({ where: { id }, data }),
      ...(trocouNome
        ? [
            prisma.booking.updateMany({ where: { clientName: antes.name }, data: { clientName: data.name } }),
            prisma.waitlist.updateMany({ where: { name: antes.name }, data: { name: data.name } }),
          ]
        : []),
    ]);
    if (trocouNome) console.log(`[nome] "${antes.name}" → "${data.name}" (aulas e lista de espera atualizadas)`);

    /* Virou INATIVA agora: a agenda e a cobrança dela param junto. Sem isso, a
       aluna que sai continua ocupando vaga nas turmas e recebendo boleto todo
       mês. A mensalidade do mês CORRENTE não é cancelada de propósito — é dívida
       do mês que ela cursou; cancelar seria perdoar sem você decidir. */
    let encerrado = null;
    if (data.status === "cancelado" && antes && antes.status !== "cancelado") {
      encerrado = await encerrarAluna(client);
    }
    res.json({ ...client, encerrado });
  })
);

/* Derruba o que estava marcado para a frente quando a aluna sai do curso.
   Devolve a conta do que foi cancelado, para a tela poder dizer em números. */
async function encerrarAluna(client) {
  const t = todayISO();
  const aulas = await prisma.booking.updateMany({
    where: { clientName: client.name, date: { gte: t }, status: { not: "cancelada" } },
    data: { status: "cancelada", absenceReason: "Inscrição encerrada" },
  });
  // Só as competências FUTURAS: a do mês corrente continua em aberto.
  const mensalidades = await prisma.invoice.updateMany({
    where: { clientId: client.id, status: "pendente", competencia: { gt: competenciaAtual() } },
    data: { status: "cancelado" },
  });
  // Aula extra comprada e ainda não usada fica pendurada — o valor foi pago e
  // não é devolvido, então quem decide o que fazer com ela é a Inêz.
  const extrasPagas = await prisma.extraPass.count({ where: { clientId: client.id, status: "pago" } });
  console.log(`[encerramento] ${client.name}: ${aulas.count} aula(s) e ${mensalidades.count} mensalidade(s) canceladas.`);
  return { aulas: aulas.count, mensalidades: mensalidades.count, extrasPagas };
}

app.delete(
  "/api/clients/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cli = await prisma.client.findUnique({ where: { id } });
    if (!cli) return res.json({ ok: true });
    // remove as aulas futuras e a lista de espera da pessoa; o histórico passado é mantido
    await prisma.booking.deleteMany({ where: { clientName: cli.name, date: { gte: todayISO() } } });
    await prisma.waitlist.deleteMany({ where: { name: cli.name } });
    await prisma.client.delete({ where: { id } }); // mensalidades caem junto (cascade)
    res.json({ ok: true });
  })
);

/* ---------- WAITLIST ---------- */
app.post(
  "/api/slots/:id/waitlist",
  wrap(async (req, res) => {
    const slotId = Number(req.params.id);
    const name = padronizarNome(req.body.name);
    const { phone } = req.body;
    if (!name) return res.status(400).json({ error: "name é obrigatório" });
    const entry = await prisma.waitlist.create({ data: { slotId, name, phone: phone || "" } });
    res.json(entry);
  })
);

app.delete(
  "/api/waitlist/:id",
  wrap(async (req, res) => {
    await prisma.waitlist.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  })
);

app.post(
  "/api/waitlist/:id/promote",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const w = await prisma.waitlist.findUnique({ where: { id }, include: { slot: true } });
    if (!w) return res.status(404).json({ error: "Entrada não encontrada" });
    const occ = await occupancy(w.slotId);
    if (occ >= w.slot.capacity) return res.status(409).json({ error: "Turma ainda está lotada." });
    const booking = await prisma.booking.create({
      data: {
        clientName: w.name,
        phone: w.phone || "",
        unit: w.slot.unit,
        date: w.slot.date,
        time: w.slot.time,
        prof: w.slot.prof,
        slotId: w.slotId,
        status: "aguardando",
        value: 0,
      },
    });
    await ensureClient(w.name, w.phone, w.slot.unit, []);
    await prisma.waitlist.delete({ where: { id } });
    res.json(booking);
  })
);

/* ---------- PORTAL DO ALUNO (identificado pelo WhatsApp) ---------- */
app.get(
  "/api/portal/:phone",
  wrap(async (req, res) => {
    const phone = onlyDigits(req.params.phone);
    if (phone.length < 8) return res.status(400).json({ error: "Número de WhatsApp inválido." });
    const [allBookings, clients, slots] = await Promise.all([
      prisma.booking.findMany({ orderBy: [{ date: "asc" }, { time: "asc" }] }),
      prisma.client.findMany(),
      prisma.slot.findMany(),
    ]);
    const mine = allBookings.filter((b) => onlyDigits(b.phone) === phone);
    const cli = clients.find((c) => onlyDigits(c.phone) === phone) || null;
    const t = todayISO();
    const occ = {};
    allBookings.filter((b) => b.status !== "cancelada").forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });
    const available = slots
      .filter((s) => s.date >= t && (occ[s.id] || 0) < s.capacity)
      .map((s) => ({ id: s.id, date: s.date, time: s.time, unit: s.unit, prof: s.prof || profFor(s.unit), vagas: s.capacity - (occ[s.id] || 0) }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    res.json({
      found: !!cli || mine.length > 0,
      client: cli
        ? { name: cli.name, phone: cli.phone, unit: cli.unit }
        : (mine[0] ? { name: mine[0].clientName, phone: mine[0].phone, unit: mine[0].unit } : null),
      bookings: mine,
      available,
      meta: { units: SETTINGS.units, valorPadrao: SETTINGS.valorPadrao, pixKey: SETTINGS.pixKey, pixName: SETTINGS.pixName },
    });
  })
);

app.post(
  "/api/portal/:phone/book",
  wrap(async (req, res) => {
    const rawPhone = req.params.phone;
    const phone = onlyDigits(rawPhone);
    const slot = await prisma.slot.findUnique({ where: { id: Number(req.body.slotId) } });
    if (!slot) return res.status(404).json({ error: "Horário não encontrado." });
    if ((await occupancy(slot.id)) >= slot.capacity) return res.status(409).json({ error: "Esta turma acabou de lotar. Escolha outro horário." });
    const cli = (await prisma.client.findMany()).find((c) => onlyDigits(c.phone) === phone);
    const clientName = (cli && cli.name) || padronizarNome(req.body.name);
    if (!clientName) return res.status(400).json({ error: "Informe seu nome." });
    const booking = await prisma.booking.create({
      data: { clientName, phone: rawPhone, unit: slot.unit, date: slot.date, time: slot.time, prof: slot.prof, slotId: slot.id, status: "aguardando", value: 0 },
    });
    // sem etiqueta: "Lead" saiu do sistema (ver VALID_TAGS lá em cima)
    if (!cli) await prisma.client.create({ data: { name: clientName, phone: rawPhone, unit: slot.unit, tags: "[]", notes: "Cadastrou-se pelo portal do aluno." } });
    res.json(booking);
  })
);

async function ownedBooking(phone, bookingId) {
  const b = await prisma.booking.findUnique({ where: { id: Number(bookingId) } });
  if (!b || onlyDigits(b.phone) !== onlyDigits(phone)) return null;
  return b;
}

app.post(
  "/api/portal/:phone/cancel/:bookingId",
  wrap(async (req, res) => {
    const b = await ownedBooking(req.params.phone, req.params.bookingId);
    if (!b) return res.status(403).json({ error: "Marcação não encontrada para este WhatsApp." });
    res.json(await prisma.booking.update({ where: { id: b.id }, data: { status: "cancelada" } }));
  })
);

app.post(
  "/api/portal/:phone/absence/:bookingId",
  wrap(async (req, res) => {
    const b = await ownedBooking(req.params.phone, req.params.bookingId);
    if (!b) return res.status(403).json({ error: "Marcação não encontrada para este WhatsApp." });
    res.json(await prisma.booking.update({ where: { id: b.id }, data: { attendance: "falta", absenceReason: (req.body.reason || "").slice(0, 500) } }));
  })
);

/* ---------- SETTINGS ---------- */
app.get("/api/settings", wrap(async (req, res) => res.json(SETTINGS)));

app.put(
  "/api/settings",
  wrap(async (req, res) => {
    const b = req.body;
    const data = {};
    if (b.valorPadrao !== undefined) data.valorPadrao = Number(b.valorPadrao) || SETTINGS.valorPadrao;
    if (b.capacidadePadrao !== undefined) data.capacidadePadrao = Math.max(1, parseInt(b.capacidadePadrao, 10) || SETTINGS.capacidadePadrao);
    if (Array.isArray(b.units)) data.units = JSON.stringify(b.units.filter((u) => u && u.trim()));
    if (Array.isArray(b.profs)) data.profs = JSON.stringify(b.profs.filter((p) => p && p.trim()));
    if (b.horarioFunc !== undefined) data.horarioFunc = String(b.horarioFunc);
    if (b.horarioUnidades !== undefined && b.horarioUnidades !== null && typeof b.horarioUnidades === "object") data.horarioUnidades = JSON.stringify(b.horarioUnidades);
    if (b.pixKey !== undefined) data.pixKey = String(b.pixKey);
    if (b.pixName !== undefined) data.pixName = String(b.pixName);
    if (b.mensalidadeValor !== undefined) data.mensalidadeValor = Number(b.mensalidadeValor) || 0;
    if (b.vencimentoDia !== undefined) data.vencimentoDia = Math.min(28, Math.max(1, parseInt(b.vencimentoDia, 10) || 10));
    // tabela de preços — 0 é valor válido (ex.: mês de cortesia), por isso não usa ||
    for (const k of ["valorPlano1x", "valorPlano2x", "valorAvulsa"]) {
      if (b[k] !== undefined) { const n = Number(b[k]); data[k] = Number.isFinite(n) && n >= 0 ? n : SETTINGS[k]; }
    }
    if (b.duracaoAulaMin !== undefined) data.duracaoAulaMin = Math.min(600, Math.max(15, parseInt(b.duracaoAulaMin, 10) || SETTINGS.duracaoAulaMin));
    // travas de cobrança (desligadas até a Inêz confirmar)
    for (const k of ["travaAtraso", "pixExpira", "cobrarEncargos", "geracaoAuto", "waAvisosAuto"]) if (b[k] !== undefined) data[k] = !!b[k];
    await prisma.settings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    await loadSettings();
    res.json(SETTINGS);
  })
);

/* ---------- AUTH DO PAINEL ADMIN (usuário + senha) ---------- */

// Existe algum administrador cadastrado? (define se mostra "criar 1º acesso" ou "login")
app.get("/api/admin/exists", wrap(async (_req, res) => {
  const n = await prisma.adminUser.count();
  res.json({ exists: n > 0 });
}));

const cleanUsername = (u) => String(u || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Criar o PRIMEIRO administrador (só funciona enquanto não houver nenhum)
app.post("/api/admin/setup", wrap(async (req, res) => {
  if ((await prisma.adminUser.count()) > 0) return res.status(409).json({ error: "Já existe um administrador. Use o login." });
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || "");
  if (username.length < 3) return res.status(400).json({ error: "Usuário deve ter ao menos 3 caracteres." });
  if (password.length < 4) return res.status(400).json({ error: "Senha deve ter ao menos 4 caracteres." });
  await prisma.adminUser.create({ data: { username, pass: await bcrypt.hash(password, 10), role: "admin" } });
  hasAdmin = true;
  const token = genToken(); adminTokens.set(token, { username, role: "admin" });
  res.json({ ok: true, token, username, role: "admin" });
}));

// Cadastro de novo acesso pela própria tela de login (equipe da Inêz)
// Por enquanto: permite apenas 1 único usuário no sistema.
app.post("/api/admin/register", wrap(async (req, res) => {
  if ((await prisma.adminUser.count()) > 0) return res.status(409).json({ error: "Já existe um acesso cadastrado. Use o login." });
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || "");
  if (username.length < 3) return res.status(400).json({ error: "Usuário deve ter ao menos 3 caracteres." });
  if (password.length < 4) return res.status(400).json({ error: "Senha deve ter ao menos 4 caracteres." });
  if (await prisma.adminUser.findFirst({ where: { username } })) return res.status(409).json({ error: "Usuário já existe. Use o login." });
  await prisma.adminUser.create({ data: { username, pass: await bcrypt.hash(password, 10), role: "admin" } });
  hasAdmin = true;
  const token = genToken(); adminTokens.set(token, { username, role: "admin" });
  res.json({ ok: true, token, username, role: "admin" });
}));

// Login
app.post("/api/admin/login", wrap(async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || "");
  const user = await prisma.adminUser.findFirst({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.pass))) return res.status(401).json({ error: "Usuário ou senha inválidos." });
  const role = user.role === "instrutora" ? "instrutora" : "admin";
  const token = genToken(); adminTokens.set(token, { username, role });
  res.json({ ok: true, token, username, role, nome: user.nome || null });
}));

// Logout (invalida o token da sessão)
app.post("/api/admin/logout", wrap(async (req, res) => {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  adminTokens.delete(tok);
  res.json({ ok: true });
}));

// Adicionar novo usuário do painel (protegido — só admin logado) — equipe da Inêz
app.post("/api/admin/users", wrap(async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || "");
  if (username.length < 3) return res.status(400).json({ error: "Usuário deve ter ao menos 3 caracteres." });
  if (password.length < 4) return res.status(400).json({ error: "Senha deve ter ao menos 4 caracteres." });
  if (await prisma.adminUser.findFirst({ where: { username } })) return res.status(409).json({ error: "Usuário já existe." });
  const role = req.body.role === "instrutora" ? "instrutora" : "admin";
  const nome = String(req.body.nome || "").trim() || null;
  await prisma.adminUser.create({ data: { username, pass: await bcrypt.hash(password, 10), role, nome } });
  res.json({ ok: true, username, role });
}));

// Listar usuários do painel (protegido)
app.get("/api/admin/users", wrap(async (_req, res) => {
  const list = await prisma.adminUser.findMany({ select: { id: true, username: true, role: true, nome: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  res.json(list);
}));

/* ---------- AUTH (PIN de 4 dígitos) ---------- */

// Localiza o aluno(a) pelo CPF (somente dígitos)
async function clientByCpf(cpfRaw) {
  const cpf = onlyDigits(cpfRaw);
  if (cpf.length !== 11) return null;
  return prisma.client.findFirst({ where: { cpf } });
}

// Verifica se o CPF está cadastrado e se já tem PIN
app.post("/api/auth/check", wrap(async (req, res) => {
  if (onlyDigits(req.body.cpf).length !== 11) return res.status(400).json({ error: "Informe um CPF válido (11 dígitos)." });
  const client = await clientByCpf(req.body.cpf);
  if (!client) return res.json({ exists: false, hasPin: false });
  res.json({ exists: true, hasPin: !!client.pin, clientId: client.id });
}));

// Define PIN pela primeira vez (aluno(a) já cadastrado, sem PIN)
app.post("/api/auth/set-pin", wrap(async (req, res) => {
  const pin = String(req.body.pin || "");
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: "PIN de 4 dígitos é obrigatório." });
  const client = await clientByCpf(req.body.cpf);
  if (!client) return res.status(404).json({ error: "CPF não encontrado." });
  if (client.pin) return res.status(409).json({ error: "PIN já cadastrado. Use o login normal." });
  const hash = await bcrypt.hash(pin, 10);
  const updated = await prisma.client.update({ where: { id: client.id }, data: { pin: hash } });
  const { pin: _p, ...safe } = updated;
  res.json({ ok: true, client: { ...safe, tags: parseTags(safe.tags), hasPin: true } });
}));

// Login com CPF + PIN
app.post("/api/auth/login", wrap(async (req, res) => {
  const pin = String(req.body.pin || "");
  if (!pin) return res.status(400).json({ error: "PIN obrigatório." });
  const client = await clientByCpf(req.body.cpf);
  if (!client || !client.pin) return res.status(401).json({ error: "Credenciais inválidas." });
  const ok = await bcrypt.compare(pin, client.pin);
  if (!ok) return res.status(401).json({ error: "PIN incorreto." });
  const { pin: _p, ...safe } = client;
  res.json({ ok: true, client: { ...safe, tags: parseTags(safe.tags), hasPin: true } });
}));

// Resetar PIN (admin — apaga o hash, cliente volta ao fluxo de primeiro acesso)
app.delete("/api/clients/:id/pin", wrap(async (req, res) => {
  await prisma.client.update({ where: { id: Number(req.params.id) }, data: { pin: null } });
  res.json({ ok: true });
}));

/* ===================== DEPOIMENTOS ===================== */

// Servir fotos de depoimentos (fallback caso Vite não esteja rodando)
app.use("/depoimentos", express.static(DEPO_DIR));

// Listar depoimentos (público — usado pela landing page)
app.get("/api/testimonials", wrap(async (_req, res) => {
  const list = await prisma.testimonial.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  res.json(list);
}));

// Criar depoimento
app.post("/api/testimonials", wrap(async (req, res) => {
  const { role = "", text, active = true, order = 0 } = req.body;
  const name = padronizarNome(req.body.name);
  if (!name || !text) return res.status(400).json({ error: "name e text são obrigatórios." });
  const t = await prisma.testimonial.create({ data: { name, role, text, active, order } });
  res.status(201).json(t);
}));

// Atualizar depoimento
app.patch("/api/testimonials/:id", wrap(async (req, res) => {
  const { name, role, text, active, order } = req.body;
  const t = await prisma.testimonial.update({
    where: { id: Number(req.params.id) },
    data: { ...(name !== undefined && { name }), ...(role !== undefined && { role }), ...(text !== undefined && { text }), ...(active !== undefined && { active }), ...(order !== undefined && { order }) },
  });
  res.json(t);
}));

// Upload de foto
app.post("/api/testimonials/:id/photo", depoUpload.single("photo"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhuma imagem enviada." });
  const t = await prisma.testimonial.update({
    where: { id: Number(req.params.id) },
    data: { photo: req.file.filename },
  });
  res.json(t);
}));

// Excluir depoimento
app.delete("/api/testimonials/:id", wrap(async (req, res) => {
  await prisma.testimonial.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
}));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Migração leve e idempotente: garante a coluna Slot.seriesId (replicação) sem depender de migration manual
async function ensureSchema() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Slot' AND COLUMN_NAME = 'seriesId'"
  );
  if (!Number(rows?.[0]?.n)) {
    await prisma.$executeRawUnsafe("ALTER TABLE Slot ADD COLUMN seriesId VARCHAR(40) NULL");
    console.log("Migração aplicada: coluna Slot.seriesId criada.");
  }
}

const PORT = process.env.PORT || 4000;
ensureSchema()
  .catch((e) => console.error("Falha ao garantir schema (Slot.seriesId):", e.message))
  .then(() => loadSettings())
  .catch((e) => console.error("Falha ao carregar configurações:", e.message))
  .finally(() => app.listen(PORT, () => console.log(`API Fios que Curam rodando em http://localhost:${PORT}`)));
