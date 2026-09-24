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
  PGTO_REPOSICAO,
  PGTO_EXTRA,
  primeiroPagamento,
  mensalidadeDoPagamento,
  JUROS_DIA_PERCENTUAL,
  MULTA_ATRASO_REAIS,
  checarRegras,
  diaDoMes,
  encargosDaMensalidade,
  hhmm,
  janelaEscala,
  tetoMensalEscala,
  limiteMensalEscala,
  compPorExtenso,
  liberouATempo as liberouATempoPuro,
  motivoSemCredito,
  REPO_MAX_MES,
  REPO_HORAS_MIN,
  REPO_MANHA_ATE,
  somarComp,
  tipoMensalista,
  podeReplicarMensalista,
  mesmaSemana,
  diasEntreISO,
} from "./regrasAula.js";
import {
  anosDoCalendario,
  calendarioFeriados,
  feriadoDe,
  recusaFeriado,
} from "./feriados.js";
import { padronizarNome } from "./nomes.js";
import { undoManager } from "./undo.js";
import {
  PENDENCIA_POR_PASSO,
  WA_ATENDENTE,
  WA_PORTAL_URL,
  textoConversaParada,
  textoLembreteAula,
  textoAtendenteHumano,
  textoBoasVindas,
  textoCobrancaReserva,
  textoHoldExpirado,
  textoLembreteHold,
  textoMatriculaConfirmada,
  textoMensalidadeAVencer,
  textoMensalidadeEmAtraso,
  textoMensalidadePaga,
  textoAulaExtraPaga,
  textoAniversario,
  textoMaterialPrimeiraAula,
  enderecoDaUnidade,
} from "./textosEscola.js";
import { sicrediConfigured, sicrediMissing, createCharge, getCharge, isPaidStatus, extractPix } from "./sicredi.js";
import { enviarEventoMeta, contextoDoNavegador, guardarContexto, contextoGuardado } from "./metaCapi.js";
import { waConfigured, waTemplatesConfigured, waVerify, sendWaText, sendWaTemplate, sendWaButtons, sendWaList, parseIncoming, parseStatuses, parseTemplateStatuses, normalizePhone, listWaTemplates } from "./wa.js";
import {
  CONVERSA_EXPIRA_H,
  conversaExpirou,
  descricaoDaTurma,
  emailValido,
  horaDeCorte,
  lotacaoDaTurma,
  parseNascimento,
  slotAindaDaTempo,
  telefoneBR,
  acaoDaReserva,
  HOLD_MIN,
  HOLD_AVISO_MIN,
  RODADA_HOLD_MIN,
  FREQS_WA,
  planoEscolhido,
  ordinal,
  horariosExtrasPossiveis,
  listaComE,
} from "./waFluxo.js";

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
// Garantir UTF-8 em todas as respostas JSON da API
app.use("/api", (_req, res, next) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); next(); });

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
  /* A tela pública da aluna nova gera o Pix da matrícula e declara o "já
     paguei" — por isso estas duas continuam abertas. O que elas aceitam de
     quem não está logado é limitado dentro da própria rota: só a reserva da
     MATRÍCULA, e só enquanto ela não foi paga (ver `soMatriculaPelaPortaPublica`).
     O PATCH saiu daqui em 01/09/2026: ele mexe em status, valor, forma de
     pagamento e `paid` de QUALQUER reserva, e nenhuma tela pública o usa —
     quem o chama é o painel, que já entra logado. */
  ["POST", /^\/api\/bookings\/\d+\/(invoice|pay)$/],
  ["POST", /^\/api\/auth\/(check|set-pin|login)$/],
  [null, /^\/api\/portal\//],
  ["GET", /^\/api\/testimonials$/],
  ["GET", /^\/api\/settings$/],
  [null, /^\/api\/wa\/webhook$/],
  // o Sicredi acrescenta "/pix" à URL cadastrada na hora de notificar
  [null, /^\/api\/sicredi\/webhook(\/pix)?$/],
];
const isPublicApi = (req) => PUBLIC_API.some(([m, re]) => (!m || m === req.method) && re.test(req.path));

/* Esta chamada veio do PAINEL (alguém logado), e não da aluna?
   Várias rotas são compartilhadas: a mesma `POST /api/bookings` serve à tela
   pública de matrícula e à marcação replicada da Inêz. O que separa as duas
   não é o corpo da requisição — que qualquer um monta na mão — é quem está
   assinando a chamada. Operação em LOTE, marcação forçada e criação de horário
   novo são do painel; pelo portal e pelo WhatsApp, uma aula de cada vez.
   `!hasAdmin` é o primeiro uso do sistema, quando ainda não há login nenhum. */
const doPainel = (req) => !!req.admin || !hasAdmin;

/* Pela porta pública só se mexe na reserva da MATRÍCULA, e só enquanto ela não
   foi paga. É o alcance real da tela da aluna nova: gerar o Pix da matrícula e
   declarar "já paguei". Sem este cerco, as rotas de pagar e de gerar cobrança —
   públicas porque essa tela precisa delas — aceitavam qualquer id de reserva
   vindo de fora: dava para marcar uma aula como paga sem Pix nenhum.
   Devolve true quando já respondeu 403. */
function soMatriculaPelaPortaPublica(req, res, booking) {
  if (doPainel(req)) return false;
  if (booking && ehPagamentoDeMatricula(booking.paymentMethod) && !booking.paid) return false;
  res.status(403).json({ error: "Essa operação é da escola. Se você já pagou, chame a gente no WhatsApp. 💚" });
  return true;
}

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

  // Extrai a sessão se houver token de autorização (necessário para rotas compartilhadas como POST /api/bookings)
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const sess = tok ? adminTokens.get(tok) : null;
  if (sess) req.admin = sess;

  if (isPublicApi(req)) return next();

  if (!sess) return res.status(401).json({ error: "Acesso restrito ao painel. Faça login." });
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
function addMonthsISO(iso, n) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const y = Number(m[1]), mo = Number(m[2]) - 1, day = Number(m[3]);
  const first = new Date(Date.UTC(y, mo + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10);
}
const onlyDigits = (s) => (s || "").replace(/\D/g, "");

function validarCPF(cpf) {
  const limpo = onlyDigits(cpf);
  if (limpo.length !== 11 || /^(\d)\1{10}$/.test(limpo)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(limpo[i], 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(limpo[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(limpo[i], 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(limpo[10], 10)) return false;
  return true;
}
/* Etiquetas válidas: nenhuma. A única que existia ("Lead") saiu do sistema em
   22/08/2026 — quem entra pelo site já marca a 1ª aula, então "cadastrou e
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

/* ---------- A ALUNA JÁ RESOLVEU ESTA TURMA? ----------
   Para o LOTE, "já resolvida" tem dois sentidos, e os dois impedem criar aula:

   · reserva ativa  → ela já está marcada; criar de novo duplicaria a aula;
   · reserva CANCELADA → ela SAIU desta data de propósito (liberou a aula,
     viajou, a escola desmarcou em lote). O lote não pode desfazer isso.

   Esta é a diferença entre LIBERAR e EXCLUIR, que o painel já assume no
   batch-unbook: excluir apaga a linha (marcação errada — pode voltar), liberar
   deixa a linha cancelada no histórico (saída intencional — não volta). Sem
   olhar a cancelada, replicar a turma ressuscitava a aula que a aluna tinha
   liberado, e ela reaparecia `confirmada` ao lado da própria linha cancelada.

   Vale SÓ para as rotas de lote/replicação. Na marcação de UMA aula (portal,
   reposição, aula extra) a cancelada continua sendo ignorada de propósito: é
   assim que a aluna consegue remarcar a aula que ela mesma liberou. */
async function situacaoNaTurma(slotId, clientName) {
  // a ativa vem primeiro: se ela liberou e depois voltou, quem vale é a de pé
  const ativa = await prisma.booking.findFirst({
    where: { slotId, clientName, status: { not: "cancelada" } },
  });
  if (ativa) return { tipo: "ativa", motivo: "já marcada", booking: ativa };
  const liberada = await prisma.booking.findFirst({
    where: { slotId, clientName, status: "cancelada" },
  });
  if (liberada) return { tipo: "liberada", motivo: "aula liberada — o lote não remarca", booking: liberada };
  return null;
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
     multa entrar, ou foi emitido quando a fatura estava em atraso e o vencimento
     foi prorrogado para hoje/futuro. A tela precisa saber disso para oferecer um
     código novo em vez de mostrar um QR que cobra valor diferente da conta. */
  const pixAtualizado = !inv.pixCode
    ? false
    : (inv.encargosAte && !e.atrasada)
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

/* Aulas ativas da aluna. Alimentam apenas a janela da mensalista em escala.
   A frequência 1x/2x define a grade inicial; não existe mais teto semanal que
   transforme feriado sem aula em consumo fictício do plano. */
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
  /* Feriado vem ANTES do `forcar`, e de propósito: as outras regras deste
     módulo são do plano da aluna, e a Inêz pode passar por cima delas porque a
     agenda é dela. Feriado não é regra de plano — é o dia em que a escola não
     abre. Não há aula para forçar. */
  const nomeFeriado = feriadoNoDia(alvo?.date, alvo?.unit);
  if (nomeFeriado)
    throw Object.assign(new Error(recusaFeriado(nomeFeriado, alvo?.date)), { code: 409, codigo: "feriado" });
  if (forcar) return { ok: true, codigo: "", motivo: "" };
  const hoje = todayISO();
  const isEscala = tipoMensalista(client) === "escala";
  const todasAulas = isEscala
    ? await prisma.booking.findMany({ where: { clientName: client.name, status: { not: "cancelada" } } })
    : [];
  const r = checarRegras(client, alvo, {
    hoje,
    aulasAtivas: todasAulas.filter((b) => b.date >= hoje),
    todasAulas,
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

/* `prazoLiberacao` e `liberouATempo` moraram aqui até 01/09/2026. Foram para
   regrasAula.js junto com REPO_HORAS_MIN e REPO_MANHA_ATE: é a regra que a
   escola promete por escrito no WhatsApp e no portal, e lá ela tem teste. */
const liberouATempo = (date, time, agora = agoraBR()) => liberouATempoPuro(date, time, agora);

// 'YYYY-MM-DD' → '27/08', para as mensagens ficarem legíveis
const fmtDiaBR = (d) => {
  const m = String(d || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : d;
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

/* ============ O CRÉDITO MORRE SE A AULA DE ORIGEM VOLTAR ============
   Vitor, 15/09/2026.

   O crédito é a troca por uma aula que deixou de acontecer. Se a aula volta a
   existir na agenda da aluna, não há o que repor: ela ficaria com a aula E com
   o direito de marcar outra — foi o que aconteceu com 5 alunas até aqui (6
   créditos, 2 deles já gastos em reposições que ela não tinha para gastar).

   A aula volta por dois caminhos, e os dois são legítimos vistos de perto:

   · a aluna remarca a MESMA aula que liberou. Marcar uma aula sozinha ignora a
     linha cancelada de propósito (ver situacaoNaTurma) — é assim que ela se
     arrepende. Só que ninguém olhava o crédito que a liberação tinha gerado.
   · a grade dela é reconstruída em lote. O lote sabe não remarcar o que foi
     liberado, mas lê isso da linha CANCELADA; quando a série é excluída, a
     linha cancelada ia junto e a prova da liberação sumia.

   Por isso a regra não mora em nenhum dos caminhos que criam aula: mora AQUI,
   onde o crédito é lido e gasto. Não há como criar aula por uma porta nova e
   escapar dela. `varrerCreditosRessuscitados` apaga o que a regra já esconde —
   a tela para de oferecer na hora, o banco limpa na varredura. */
const chaveAula = (date, time) => `${date} ${hhmm(time) || String(time || "").slice(0, 5)}`;

/* Dos créditos EM ABERTO desta aluna, quais têm a aula de origem de pé de novo.
   Devolve um Set de ids — quem chama decide se esconde ou se apaga. */
async function creditosComAulaDeVolta(clientName, creditos) {
  const abertos = (creditos || []).filter((c) => !c.usedBookingId);
  if (!abertos.length) return new Set();
  const bks = await prisma.booking.findMany({
    where: {
      clientName,
      date: { in: [...new Set(abertos.map((c) => c.originDate))] },
      status: { not: "cancelada" },
    },
    select: { date: true, time: true },
  });
  const ativas = new Set(bks.map((b) => chaveAula(b.date, b.time)));
  return new Set(abertos.filter((c) => ativas.has(chaveAula(c.originDate, c.originTime))).map((c) => c.id));
}

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
  // A aula de origem voltou para a agenda? Então não há o que repor.
  const voltaram = await creditosComAulaDeVolta(client.name, creditos);
  const marcados = creditos.map((c) => ({
    ...c,
    // "aguardando" = a aula liberada ainda não chegou; vira "disponivel" no dia seguinte
    situacao: c.usedBookingId ? "usado"
      : voltaram.has(c.id) ? "revogado"
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
  /* Feriado e antecedência: as duas recusas que não dependem do banco, e nesta
     ordem — feriado primeiro. Ver motivoSemCredito() e o bloco FERIADO NÃO GERA
     CRÉDITO em regrasAula.js, que é onde a regra tem teste. */
  const motivo = motivoSemCredito({
    nomeFeriado: feriadoNoDia(booking.date, booking.unit),
    date: booking.date,
    time: booking.time,
    agora: agoraBR(),
    diaBR: fmtDiaBR,
  });
  if (motivo) return { credito: null, motivo };
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
  const candidatos = await prisma.makeupCredit.findMany({
    where: { clientId: client.id, ...creditoValido(t) },
    orderBy: { expiresOn: "asc" }, // gasta primeiro o que vence antes
  });
  /* Crédito cuja aula de origem voltou não é crédito: a aluna tem a aula.
     Filtrar aqui, e não na cláusula acima, é o que garante que nenhuma porta
     nova de criação de aula escape da regra — ver creditosComAulaDeVolta. */
  const revogados = await creditosComAulaDeVolta(client.name, candidatos);
  const credito = candidatos.find((c) => !revogados.has(c.id)) || null;
  if (!credito) {
    // Distingue "não tem crédito" de "tem, mas a aula liberada ainda não chegou" —
    // são situações bem diferentes para quem está olhando a tela.
    const futuros = await prisma.makeupCredit.findMany({
      where: { clientId: client.id, usedBookingId: null, expiresOn: { gte: t }, originDate: { gte: t } },
      orderBy: { originDate: "asc" },
    });
    const futurosRevogados = await creditosComAulaDeVolta(client.name, futuros);
    const esperando = futuros.find((c) => !futurosRevogados.has(c.id)) || null;
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

  /* A REPOSIÇÃO VEM SEMPRE DEPOIS DA AULA LIBERADA — nunca antes.
     Repor é remarcar uma aula que deixou de acontecer; escolher uma data
     anterior à da aula cancelada seria adiantar a próxima e ainda ficar com o
     direito de faltar na original. O filtro `creditoValido` já não entrega
     crédito de aula futura, então na prática isto nunca dispara — está escrito
     aqui porque a regra tem que estar visível no lugar onde a aula nasce, e não
     só implícita numa cláusula de busca três funções acima. */
  if (slot.date <= credito.originDate)
    throw Object.assign(
      new Error(
        `A reposição precisa ser em uma data POSTERIOR à aula que você liberou (${fmtDiaBR(credito.originDate)}). ` +
        `Escolha um horário a partir de ${fmtDiaBR(creditoLiberaEm(credito))}. 💚`
      ),
      { code: 409 }
    );

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
      // A reposição é aula ÚNICA: nunca entra numa série. Sem seriesId, nenhum
      // "excluir/replicar os demais desta série" a alcança. Ver ehReposicao().
      seriesId: null,
    },
  });
  await prisma.makeupCredit.update({
    where: { id: credito.id },
    data: { usedBookingId: booking.id, usedAt: t },
  });
  return booking;
}

/* ===================== A REPOSIÇÃO É AULA ÚNICA =====================
   Uma aula de reposição existe porque um CRÉDITO foi gasto nela: o vínculo é
   `MakeupCredit.usedBookingId`. Toda reposição legítima nasce em
   marcarReposicao(), uma por crédito, e nunca em lote.

   Daí a invariante que o sistema inteiro respeita: nenhum caminho que copia
   aula (replicar turma, agendar em lote, marcação replicada por datas) pode
   produzir uma aula com paymentMethod "Reposição". Copiar uma seria dar à aluna
   uma reposição que ela não pagou com crédito nenhum — e é exatamente o que
   fazia a reposição se espalhar pelas semanas seguintes.

   `ehReposicao` é o teste único usado por todos esses caminhos; `varrerReposicoesOrfas`
   é o detector: reposição ativa que nenhum crédito reivindica só pode ter vindo
   de uma cópia. */
const ehReposicao = (b) => (b?.paymentMethod || "") === PGTO_REPOSICAO;

async function varrerReposicoesOrfas({ corrigir = false } = {}) {
  const repos = await prisma.booking.findMany({
    where: { paymentMethod: PGTO_REPOSICAO, status: { not: "cancelada" }, date: { gte: todayISO() } },
    orderBy: [{ clientName: "asc" }, { date: "asc" }],
  });
  if (!repos.length) return { orfas: [], removidas: 0 };
  const creditos = await prisma.makeupCredit.findMany({
    where: { usedBookingId: { in: repos.map((b) => b.id) } },
    select: { usedBookingId: true },
  });
  const comCredito = new Set(creditos.map((c) => c.usedBookingId));
  const orfas = repos.filter((b) => !comCredito.has(b.id));
  let removidas = 0;
  for (const b of orfas) {
    console.warn(`[reposição órfã] ${b.clientName} · ${b.date} ${b.time} (booking ${b.id}) — nenhum crédito aponta para esta aula.`);
    if (corrigir) {
      await prisma.booking.update({
        where: { id: b.id },
        data: { status: "cancelada", absenceReason: "Reposição duplicada — a reposição é aula única" },
      });
      removidas++;
    }
  }
  return { orfas, removidas };
}

/* Detector do outro lado da mesma moeda: crédito em aberto cuja aula de origem
   está de pé na agenda (ver creditosComAulaDeVolta). A regra de leitura já não
   entrega esse crédito para ninguém; esta varredura existe para o banco não
   guardar em silêncio um direito que a tela não mostra mais — e porque o teto
   de 2 créditos por mês conta as linhas, então crédito revogado que fica na
   tabela rouba a vaga de um crédito legítimo do mesmo mês.

   Apaga, e não marca como usado: é o mesmo desfecho do crédito de feriado
   (scripts/revogar-creditos-feriado.mjs), e crédito gasto NUNCA é tocado — a
   aula de reposição dele existe, e apagá-lo deixaria essa aula órfã. */
async function varrerCreditosRessuscitados({ corrigir = false } = {}) {
  const t = todayISO();
  const abertos = await prisma.makeupCredit.findMany({
    where: { usedBookingId: null, expiresOn: { gte: t } },
    orderBy: [{ clientId: "asc" }, { originDate: "asc" }],
  });
  if (!abertos.length) return { creditos: [], removidos: 0 };
  const nomes = new Map(
    (await prisma.client.findMany({
      where: { id: { in: [...new Set(abertos.map((c) => c.clientId))] } },
      select: { id: true, name: true },
    })).map((c) => [c.id, c.name])
  );
  const achados = [];
  for (const [clientId, nome] of nomes) {
    const meus = abertos.filter((c) => c.clientId === clientId);
    const voltaram = await creditosComAulaDeVolta(nome, meus);
    for (const c of meus) if (voltaram.has(c.id)) achados.push({ ...c, clientName: nome });
  }
  let removidos = 0;
  for (const c of achados) {
    console.warn(`[reposição] crédito ${c.id} de ${c.clientName} — a aula de ${c.originDate} ${c.originTime} está de volta na agenda.`);
    if (corrigir) {
      await prisma.makeupCredit.delete({ where: { id: c.id } });
      removidos++;
    }
  }
  return { creditos: achados, removidos };
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
      /* Aula extra é aula ÚNICA, como a reposição: nasce fora de qualquer série
         para que nenhum "replicar/excluir os demais desta série" a alcance.
         Ela é comprada uma a uma — copiar seria dar aula que ninguém pagou. */
      seriesId: null,
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
/* Taxa de matrícula: saiu em 28/08/2026 (diluída na mensalidade) e VOLTOU em
   01/09/2026, agora como parcela separada e visível — R$ 20 somados à 1ª
   mensalidade da aluna nova, uma vez só. Zerar o campo desliga a taxa. */
const PRECOS_PADRAO = { valorPlano1x: 120, valorPlano2x: 200, valorPlano3x: 320, valorPlano4x: 400, valorAvulsa: 40, duracaoAulaMin: 120, taxaMatricula: 20 };
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
    valorPlano3x: s.valorPlano3x ?? PRECOS_PADRAO.valorPlano3x,
    valorPlano4x: s.valorPlano4x ?? PRECOS_PADRAO.valorPlano4x,
    valorAvulsa: s.valorAvulsa ?? PRECOS_PADRAO.valorAvulsa,
    duracaoAulaMin: s.duracaoAulaMin ?? PRECOS_PADRAO.duracaoAulaMin,
    /* `?? padrão` só cobre a coluna AUSENTE (banco antigo). Taxa gravada como 0
       é escolha da Inêz — "desligar a taxa" — e tem que sobreviver ao reload. */
    taxaMatricula: s.taxaMatricula ?? PRECOS_PADRAO.taxaMatricula,
    // Travas de cobrança: ausentes (banco antigo) = desligadas.
    travaAtraso: s.travaAtraso ?? false,
    pixExpira: s.pixExpira ?? false,
    cobrarEncargos: s.cobrarEncargos ?? false,
    geracaoAuto: s.geracaoAuto ?? false,
    waAvisosAuto: s.waAvisosAuto ?? false,
  };
  return SETTINGS;
}

/* ---------- feriados (cache em memória, como as configurações) ----------
   EM FERIADO NÃO HÁ AULA. É regra da escola, não preferência: nenhum horário é
   criado na data, nenhuma reserva é aceita — painel, portal e WhatsApp — e a
   replicação semanal pula o dia.

   O cache existe porque a checagem roda em todo caminho de marcação. Ele é
   recarregado sempre que a Inêz mexe na lista, e o calendário cobre o ano
   passado, o atual e os dois seguintes: a replicação de 52 semanas atravessa a
   virada do ano. */
let FERIADOS = {}; // nacionais + manuais globais (compatibilidade)
let FERIADOS_POR_UNIDADE = {};
let FERIADOS_BASE_POR_UNIDADE = {};
let ABERTURAS_FERIADO = [];
async function loadFeriados() {
  const [manuais, aberturas] = await Promise.all([
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    prisma.holidayOverride.findMany({ where: { hasClasses: true }, orderBy: { date: "asc" } }),
  ]);
  const anos = anosDoCalendario(todayISO());
  const unidades = SETTINGS.units?.length ? SETTINGS.units : UNITS;
  FERIADOS = calendarioFeriados(anos, manuais);
  FERIADOS_POR_UNIDADE = {};
  FERIADOS_BASE_POR_UNIDADE = {};
  ABERTURAS_FERIADO = aberturas;
  for (const unidade of unidades) {
    const cal = calendarioFeriados(anos, manuais, unidade);
    FERIADOS_BASE_POR_UNIDADE[unidade] = { ...cal };
    for (const a of aberturas) if (a.unit === unidade) delete cal[a.date];
    FERIADOS_POR_UNIDADE[unidade] = cal;
  }
  return FERIADOS_POR_UNIDADE;
}
// "Natal" | "" — o nome do feriado naquele dia
const feriadoNoDia = (date, unit) => feriadoDe(unit ? FERIADOS_POR_UNIDADE[unit] : FERIADOS, date);
/* Recusa pronta para as rotas: devolve true quando já respondeu 409.
   Uso: `if (barrarFeriado(res, date)) return;` */
function barrarFeriado(res, date, unit) {
  const nome = feriadoNoDia(date, unit);
  if (!nome) return false;
  res.status(409).json({ error: recusaFeriado(nome, date), feriado: nome, date });
  return true;
}

/* Planos de mensalista: 1x a 4x por semana (Vitor, 23/09/2026 — 3x e 4x
   entraram nesse dia). 3x e 4x são SÓ para mensalista fixo: a escala continua
   com 1x e 2x, porque as regras dela (janela de marcação, teto de 4/8 aulas no
   mês) só foram desenhadas para esses dois. As telas públicas (/agendar,
   WhatsApp, portal) também seguem oferecendo só 1x e 2x — 3x e 4x a Inêz
   matricula pelo painel. */
const FREQS_PLANO = [1, 2, 3, 4];
const FREQ_MAX_ESCALA = 2;
// Frequência válida do plano; qualquer outra coisa vira 1x (como sempre foi).
const freqDoPlano = (v) => (FREQS_PLANO.includes(Number(v)) ? Number(v) : 1);
const erroEscalaSoAte2x = (freq, tipo) =>
  tipo === "escala" && freq > FREQ_MAX_ESCALA
    ? Object.assign(new Error(`O plano de ${freq}x por semana é só para mensalista fixo. Na escala, os planos são 1x ou 2x por semana.`), { code: 400 })
    : null;

// Preços derivados do plano do aluno
const valorDoPlano = (freq) => SETTINGS[`valorPlano${freqDoPlano(freq)}x`];

/* ===================== O PRIMEIRO PAGAMENTO DA ALUNA NOVA =====================
   Vitor, 01/09/2026: toda aluna nova paga a taxa de matrícula ALÉM da
   mensalidade, uma vez só. Da segunda cobrança em diante é só a mensalidade.

   Três funções em vez de uma soma solta pelo código porque as três partes têm
   destinos diferentes e não podem se misturar:

   • `valorDoPlano(freq)` — a MENSALIDADE. É o que vira a fatura do mês no
     financeiro, e é o que a aluna recebe de volta se desistir depois da 1ª aula.
   • `taxaMatriculaAtual()` — a TAXA. Não entra na fatura e NÃO é devolvida
     (decisão do Vitor em 01/09/2026); o texto avisa isso antes do pagamento.
   • `valorPrimeiroPagamento(freq)` — a soma, que é o que o Pix cobra.

   Somar "+20" na hora de criar a cobrança e depois esquecer de descontar na hora
   de registrar a mensalidade é exatamente o erro que faria o financeiro da
   escola inflar R$ 20 por aluna nova, todo mês, para sempre. Por isso a reserva
   guarda o que cobrou (Booking.taxaMatricula) e `mensalidadeDaReserva()` é o
   único caminho para voltar da soma à mensalidade.

   As contas em si vivem em regrasAula.js (`primeiroPagamento` e
   `mensalidadeDoPagamento`), com o teste que prende o par. */
const taxaMatriculaAtual = () => Math.max(0, Number(SETTINGS.taxaMatricula) || 0);
const valorPrimeiroPagamento = (freq) =>
  primeiroPagamento({ mensalidade: valorDoPlano(freq), taxa: taxaMatriculaAtual() });
/* Quanto daquele pagamento foi MENSALIDADE. Lê a taxa gravada NA RESERVA, nunca
   a das Configurações: mudar a taxa hoje não pode reescrever o que uma aluna
   pagou no mês passado. Reserva antiga (taxa null) é toda mensalidade — é o que
   mantém certo o histórico de quem se matriculou entre 28/08 e 01/09. */
const mensalidadeDaReserva = (b) =>
  mensalidadeDoPagamento({ pago: b?.value, taxa: b?.taxaMatricula });
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

/* Marca gravada no `paymentMethod` da reserva da aula de matrícula. Ela diz que
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
      /* `feriados` é o calendário já resolvido ({ 'YYYY-MM-DD': nome }): a tela
         não recalcula Páscoa nem junta lista manual, só consulta o dia. */
      meta: {
        ...SETTINGS,
        multaAtraso: MULTA_ATRASO_REAIS,
        jurosDia: JUROS_DIA_PERCENTUAL,
        feriados: FERIADOS,
        feriadosPorUnidade: FERIADOS_POR_UNIDADE,
        feriadosBasePorUnidade: FERIADOS_BASE_POR_UNIDADE,
        aberturasFeriado: ABERTURAS_FERIADO.map(({ date, unit }) => ({ date, unit })),
      },
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
    const created = [], conflitos = [], feriados = [];
    for (const d of targets) {
      /* Feriado: a escola não abre, então o horário nem nasce. Numa criação de
         uma data só isso vira recusa; num cadastro de várias semanas o dia é
         pulado e volta em `feriados`, para a tela dizer quais ficaram de fora —
         pular em silêncio é como a regra do sábado sumiu da vista em agosto. */
      const nomeFeriado = feriadoNoDia(d, unit);
      if (nomeFeriado) { feriados.push({ date: d, nome: nomeFeriado }); continue; }
      const doDia = await prisma.slot.findMany({ where: { date: d, unit } });
      const existente = doDia.find((s) => s.time === time);
      if (existente) {
        /* Numa replicação, o horário de destino pode já existir. Ele continua
           sendo a mesma turma, mas precisa receber a CAPACIDADE TOTAL da turma
           base — usar a ocupação atual (ou conservar um limite antigo) produz
           exatamente o 8/8, 9/9 visto na agenda quando a origem era 16. */
        if (base && existente.capacity !== cap) {
          await prisma.slot.update({ where: { id: existente.id }, data: { capacity: cap } });
        }
        continue;
      }
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
    // Pediu UM dia só, e ele é feriado: recusa explícita, não uma lista vazia.
    if (!created.length && feriados.length === 1 && targets.length === 1)
      return res.status(409).json({
        error: recusaFeriado(feriados[0].nome, feriados[0].date),
        feriado: feriados[0].nome, date: feriados[0].date,
      });
    res.json({ created, conflitos, feriados });
  })
);

/* ---------- replicar a TURMA INTEIRA (horário + alunas) ----------
   O "Replicar" antigo (POST /api/slots com baseSlotId) só copia o horário vazio.
   Aqui a Inêz repete a turma como ela está: mesma unidade, hora e capacidade E
   as mesmas alunas, nas próximas N semanas (mesmo dia da semana).

   O que NÃO é copiado, de propósito:
   • reposição — é aula paga com crédito; repetir consumiria créditos da aluna;
   • matrícula (a 1ª aula) — é uma só na vida da aluna;
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
    // natureza não se repetem (reposição = crédito da aluna, matrícula = a 1ª
    // aula é uma só). Ficam de fora uma vez, não semana a semana.
    const ativas = comAlunas
      ? await prisma.booking.findMany({ where: { slotId: id, status: { not: "cancelada" } } })
      : [];
    const nomesAtivos = [...new Set(ativas.map((b) => b.clientName))];
    const fichas = nomesAtivos.length ? await prisma.client.findMany({ where: { name: { in: nomesAtivos } } }) : [];
    const fichaDe = (nome) => fichas.find((c) => c.name === nome) || null;
    const naoReplicavel = (b) => ehReposicao(b) || b.paymentMethod === PGTO_EXTRA ||
      ehPagamentoDeMatricula(b.paymentMethod) || !podeReplicarMensalista(fichaDe(b.clientName));
    const origem = ativas.filter((b) => !naoReplicavel(b));
    const naoReplicadas = ativas.filter(naoReplicavel).map((b) => ({
      clientName: b.clientName,
      motivo: ehReposicao(b)
        ? "reposição não é replicada (aula única)"
        : b.paymentMethod === PGTO_EXTRA
          ? "aula extra não é replicada (aula única)"
          : ehPagamentoDeMatricula(b.paymentMethod)
            ? "aula de matrícula não é replicada (aula única)"
            : !podeReplicarMensalista(fichaDe(b.clientName))
              ? "mensalista de escala marca cada aula individualmente"
              : "não replicável",
    }));
    const nomes = [...new Set(origem.map((b) => b.clientName))];
    // aulas já marcadas de todas elas (para o teto semanal enxergar o que vamos criando)
    const agenda = nomes.length
      ? await prisma.booking.findMany({ where: { clientName: { in: nomes }, status: { not: "cancelada" } } })
      : [];

    const slotsCriados = [], aulasCriadas = [], conflitos = [];
    const pulos = []; // { date, clientName, motivo }

    for (let i = 1; i <= semanas; i++) {
      const date = addDays(base.date, i * 7);
      /* Feriado: a semana é pulada inteira — nem o horário, nem as alunas. Entra
         em `pulos` com o nome do feriado, para a Inêz ver por que aquela semana
         não veio e remarcar a turma noutro dia se quiser. */
      const nomeFeriado = feriadoNoDia(date, base.unit);
      if (nomeFeriado) {
        pulos.push({ date, clientName: "", motivo: `feriado (${nomeFeriado}) — a escola não abre` });
        continue;
      }
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
      } else {
        const patch = {};
        if (!alvo.seriesId) patch.seriesId = seriesId;
        if (alvo.capacity !== base.capacity) patch.capacity = base.capacity;
        if (Object.keys(patch).length) {
          alvo = await prisma.slot.update({ where: { id: alvo.id }, data: patch });
        }
      }

      // 2) as alunas
      for (const b of origem) {
        const ficha = fichaDe(b.clientName);
        if (ficha?.status === "cancelado") {
          pulos.push({ date, clientName: b.clientName, motivo: "cadastro cancelado" });
          continue;
        }
        const sit = await situacaoNaTurma(alvo.id, b.clientName);
        if (sit?.tipo === "ativa") continue; // silencioso: já estava marcada
        /* Liberada NÃO é silencioso: a Inêz precisa ver que aquela semana ficou
           de fora porque a aluna desmarcou, e não por falha da replicação. */
        if (sit?.tipo === "liberada") {
          pulos.push({ date, clientName: b.clientName, motivo: sit.motivo });
          continue;
        }
        if ((await occupancy(alvo.id)) >= alvo.capacity) {
          pulos.push({ date, clientName: b.clientName, motivo: "turma lotada" });
          continue;
        }
        // a janela da escala não se aplica: quem marca aqui é a Inêz, em lote
        const r = checarRegras(ficha, { date, time: alvo.time, unit: alvo.unit }, {
          hoje,
          aulasAtivas: agenda,
          ignorarJanela: true,
          ignorarTeto: true,
        });
        if (!r.ok) { pulos.push({ date, clientName: b.clientName, motivo: r.motivo }); continue; }

        /* Rede de segurança da invariante: `origem` já tirou as reposições lá em
           cima, mas quem alterar o filtro um dia não vai reler este laço. Uma
           reposição copiada é uma aula que nenhum crédito pagou. */
        if (ehReposicao(b)) {
          pulos.push({ date, clientName: b.clientName, motivo: "reposição é aula única — não se replica" });
          continue;
        }

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
      naoReplicadas, // reposição / matrícula — informado uma vez só
    });
  })
);

/* ---------- REPLICAÇÃO ÚNICA DA AGENDA ----------
   Um endpoint para os quatro alcances do botão da ADMIN: turma, dia, semana e
   mês. Turma/dia/semana avançam semanalmente; mês preserva o ordinal do dia da
   semana (ex.: 2ª terça do mês vira a 2ª terça do mês seguinte).

   Só aulas REGULARES de mensalistas FIXAS acompanham a turma. Mensalistas de
   escala, reposição, extra, matrícula e avulsa são sempre unitárias. */
function inicioDaSemanaISO(date) {
  const d = new Date(date + "T00:00Z");
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}
function mesmaPosicaoNoMes(date, meses) {
  const d = new Date(date + "T00:00Z");
  const dow = d.getUTCDay();
  const ordinal = Math.ceil(d.getUTCDate() / 7);
  const alvoMes = addMonthsISO(date.slice(0, 7) + "-01", meses);
  const primeiro = new Date(alvoMes + "T00:00Z");
  const dia = 1 + ((dow - primeiro.getUTCDay() + 7) % 7) + (ordinal - 1) * 7;
  const ultimo = new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth() + 1, 0)).getUTCDate();
  return dia <= ultimo ? `${alvoMes.slice(0, 8)}${String(dia).padStart(2, "0")}` : null;
}

app.post("/api/agenda/replicate", wrap(async (req, res) => {
  const scope = ["class", "day", "week", "month"].includes(req.body?.scope) ? req.body.scope : "class";
  const repetitions = Math.min(scope === "month" ? 24 : 52, Math.max(1, parseInt(req.body?.repetitions, 10) || 1));
  const sourceDate = String(req.body?.date || "").slice(0, 10);
  const unit = String(req.body?.unit || "");
  const slotId = Number(req.body?.slotId);
  const withStudents = req.body?.withStudents !== false;
  const filtroUnidade = unit && unit !== "Todas" ? { unit } : {};

  let fontes = [];
  if (scope === "class") {
    if (!Number.isInteger(slotId)) return res.status(400).json({ error: "Escolha a turma que será replicada." });
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (slot) fontes = [slot];
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) {
    return res.status(400).json({ error: "Informe a data-base da replicação." });
  } else if (scope === "day") {
    fontes = await prisma.slot.findMany({ where: { date: sourceDate, ...filtroUnidade }, orderBy: { time: "asc" } });
  } else if (scope === "week") {
    const ini = inicioDaSemanaISO(sourceDate);
    fontes = await prisma.slot.findMany({
      where: { date: { gte: ini, lte: addDays(ini, 6) }, ...filtroUnidade },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });
  } else {
    fontes = await prisma.slot.findMany({
      where: { date: { startsWith: sourceDate.slice(0, 7) }, ...filtroUnidade },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });
  }
  if (!fontes.length) return res.status(404).json({ error: "Não há horários no período escolhido para replicar." });

  const seriesSlot = new Map();
  const seriesBooking = new Map();
  const capacidadesAlteradas = new Set();
  const resultado = { scope, repetitions, fontes: fontes.length, slots: 0, aulas: 0, capacidades: 0, pulos: [], feriados: [] };
  const reservasOrigem = withStudents ? await prisma.booking.findMany({
    where: { slotId: { in: fontes.map((s) => s.id) }, status: { not: "cancelada" }, paymentMethod: PGTO_PLANO },
  }) : [];
  const nomesOrigem = [...new Set(reservasOrigem.map((b) => b.clientName))];
  const clientesOrigem = nomesOrigem.length
    ? await prisma.client.findMany({ where: { name: { in: nomesOrigem } } })
    : [];
  const clienteOrigemDe = (nome) => clientesOrigem.find((c) => c.name === nome) || null;

  for (let n = 1; n <= repetitions; n++) {
    for (const fonte of fontes) {
      const date = scope === "month" ? mesmaPosicaoNoMes(fonte.date, n) : addDays(fonte.date, n * 7);
      if (!date) {
        resultado.pulos.push({ date: "", unit: fonte.unit, motivo: "esta ocorrência não existe no mês de destino" });
        continue;
      }
      const nomeFeriado = feriadoNoDia(date, fonte.unit);
      if (nomeFeriado) {
        resultado.feriados.push({ date, unit: fonte.unit, nome: nomeFeriado });
        continue;
      }
      const capacidadeFonte = fonte.capacity || SETTINGS.capacidadePadrao;
      const doDia = await prisma.slot.findMany({ where: { date, unit: fonte.unit } });
      let alvo = doDia.find((s) => hhmm(s.time) === hhmm(fonte.time));
      if (!alvo) {
        const choque = doDia.find((s) => haChoque(hhmm(s.time), hhmm(fonte.time)));
        if (choque) {
          resultado.pulos.push({ date, unit: fonte.unit, motivo: `conflito com ${hhmm(choque.time)}` });
          continue;
        }
        let sid = fonte.seriesId || seriesSlot.get(fonte.id);
        if (!sid) { sid = crypto.randomUUID(); seriesSlot.set(fonte.id, sid); }
        alvo = await prisma.slot.create({
          data: {
            date,
            time: hhmm(fonte.time),
            unit: fonte.unit,
            prof: fonte.prof || null,
            capacity: capacidadeFonte,
            seriesId: sid,
          },
        });
        resultado.slots++;
      } else if (alvo.capacity !== capacidadeFonte) {
        /* Replicar substitui a configuração da turma de destino pela turma-base.
           A capacidade é o total de vagas da turma, nunca a quantidade de alunas
           que já estão nela. */
        alvo = await prisma.slot.update({
          where: { id: alvo.id },
          data: { capacity: capacidadeFonte },
        });
        capacidadesAlteradas.add(alvo.id);
      }
      if (!withStudents) continue;
      const reservas = reservasOrigem.filter((b) => b.slotId === fonte.id);
      for (const b of reservas) {
        if (!podeReplicarMensalista(clienteOrigemDe(b.clientName))) {
          resultado.pulos.push({
            date,
            unit: fonte.unit,
            clientName: b.clientName,
            motivo: "mensalista de escala marca cada aula individualmente",
          });
          continue;
        }
        const sit = await situacaoNaTurma(alvo.id, b.clientName);
        if (sit?.tipo === "ativa") continue;
        if (sit?.tipo === "liberada") {
          resultado.pulos.push({ date, unit: fonte.unit, clientName: b.clientName, motivo: sit.motivo });
          continue;
        }
        if ((await occupancy(alvo.id)) >= (alvo.capacity || 1)) {
          resultado.pulos.push({ date, unit: fonte.unit, clientName: b.clientName, motivo: "turma lotada" });
          continue;
        }
        const chaveSerie = `${b.seriesId || b.id}|${b.clientName}`;
        if (!seriesBooking.has(chaveSerie)) seriesBooking.set(chaveSerie, b.seriesId || crypto.randomUUID());
        await prisma.booking.create({
          data: {
            clientName: b.clientName,
            phone: b.phone || "",
            unit: alvo.unit,
            date: alvo.date,
            time: alvo.time,
            prof: alvo.prof || profFor(alvo.unit),
            slotId: alvo.id,
            seriesId: seriesBooking.get(chaveSerie),
            status: "confirmada",
            value: 0,
            paid: false,
            paymentMethod: PGTO_PLANO,
          },
        });
        resultado.aulas++;
      }
    }
  }

  /* A capacidade do DIA CLICADO é o modelo fixo dos horários equivalentes.
     Isso é separado da cópia de alunas e do escopo mensal: se 05/09 tem as
     turmas 07h, 09h e 11h com 16 vagas, todos os sábados equivalentes do
     período recebem 16, mesmo que já existam com 8/9 vagas e reservas.

     No escopo mensal, inclui também as semanas restantes do mês-base. Antes,
     cada sábado do mês virava um modelo diferente e só o primeiro sábado do
     mês seguinte herdava o 16 — exatamente o resultado incorreto observado. */
  const modelosCapacidade = fontes.filter((fonte) => fonte.date === sourceDate);
  const limiteExclusivo = scope === "month"
    ? addMonthsISO(sourceDate.slice(0, 7) + "-01", repetitions + 1)
    : addDays(sourceDate, repetitions * 7 + 1);
  for (const modelo of modelosCapacidade) {
    const dowModelo = new Date(modelo.date + "T00:00Z").getUTCDay();
    const capacidadeModelo = modelo.capacity || SETTINGS.capacidadePadrao;
    const equivalentes = await prisma.slot.findMany({
      where: {
        date: { gt: sourceDate, lt: limiteExclusivo },
        unit: modelo.unit,
        time: modelo.time,
      },
    });
    const ids = equivalentes
      .filter((alvo) =>
        new Date(alvo.date + "T00:00Z").getUTCDay() === dowModelo &&
        !feriadoNoDia(alvo.date, alvo.unit) &&
        alvo.capacity !== capacidadeModelo
      )
      .map((alvo) => alvo.id);
    if (ids.length) {
      await prisma.slot.updateMany({ where: { id: { in: ids } }, data: { capacity: capacidadeModelo } });
      ids.forEach((id) => capacidadesAlteradas.add(id));
    }
  }
  resultado.capacidades = capacidadesAlteradas.size;
  res.json(resultado);
}));

/* ---------- irmãs de uma turma: as ocorrências futuras equivalentes ----------
   Mesmo critério "pega-tudo" que a exclusão em lote já usava: mesma unidade,
   mesma hora e mesmo dia da semana, de hoje em diante — mais as da mesma série,
   caso tenham sido criadas juntas. Os dois critérios somam porque nenhum basta
   sozinho: o seriesId perde as turmas criadas em levas separadas (e as
   anteriores à coluna existir), e unidade+hora+dia perde as que já foram
   movidas para outro horário mas continuam sendo a mesma turma.

   Passado fica de fora sempre. Ele é histórico: quem já teve aula às 09:00 na
   terça passada teve aula às 09:00, e reescrever isso apaga o registro do que
   de fato aconteceu. */
async function irmasDaTurma(slot) {
  const t = todayISO();
  const dow = new Date(slot.date + "T00:00").getDay();
  const hora = hhmm(slot.time);
  /* A busca filtra por UNIDADE, não por hora: `time` é texto livre no banco
     (ver a migration de horários HH:MM) e "9:00" é a mesma turma que "09:00" —
     um `where` por hora exata deixaria essas linhas de fora sem avisar. A
     comparação normalizada é feita aqui embaixo, igual à do espelho
     irmasNaAgenda() em frontend/src/helpers.js. Mexeu num, mexa no outro. */
  const cands = await prisma.slot.findMany({
    where: {
      date: { gte: t },
      OR: [
        { unit: slot.unit },
        ...(slot.seriesId ? [{ seriesId: slot.seriesId }] : []),
      ],
    },
  });
  return cands.filter(
    (s) =>
      s.id !== slot.id &&
      ((slot.seriesId && s.seriesId === slot.seriesId) ||
        (s.unit === slot.unit &&
          hhmm(s.time) === hora &&
          new Date(s.date + "T00:00").getDay() === dow))
  );
}

app.patch(
  "/api/slots/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const slot = await prisma.slot.findUnique({ where: { id } });
    if (!slot) return res.status(404).json({ error: "Horário não encontrado." });
    const data = {};

    /* ?match=1: alteração EM LOTE — o padrão do painel. O que a Inêz muda numa
       turma vale para as ocorrências futuras dela, porque no dia a dia da
       escola "mudar a turma das 09:00 de terça" quer dizer a turma inteira, não
       aquela terça. A alteração de uma ocorrência só continua existindo: é esta
       mesma rota sem o ?match=1 (o "só esta" do painel). */
    const emLote = req.query.match === "1";

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

    /* Mudar a DATA é sempre de uma ocorrência só, e o lote precisa recusar em
       vez de adivinhar. Uma data nova é um dia da semana novo, e aplicá-la às
       irmãs empilharia as 52 ocorrências futuras todas no mesmo dia — o lote
       apagaria a agenda em vez de deslocá-la. */
    if (emLote && data.date !== undefined && data.date !== slot.date)
      return res.status(400).json({
        error: "Mudar a data move só esta aula. Para deslocar a turma inteira, altere o horário ou refaça a grade.",
      });

    // As irmãs são calculadas ANTES do update: depois dele o horário antigo
    // (que é a chave da busca) já não existe mais no próprio slot.
    const irmas = emLote ? await irmasDaTurma(slot) : [];

    const updated = await prisma.slot.update({ where: { id }, data });

    /* A capacidade não pode encolher abaixo do que já foi reservado, e cada
       irmã tem a sua própria lotação. Em vez de derrubar a alteração inteira
       por causa de uma turma cheia, a irmã apertada fica de fora e volta no
       relatório: o resto da grade muda e a Inêz vê exatamente qual data ficou
       para trás. */
    const apertadas = [];
    let alteradas = 0;
    for (const irma of irmas) {
      const dataIrma = { ...data };
      delete dataIrma.date; // cada irmã mantém a data dela
      if (dataIrma.capacity !== undefined) {
        const occ = await occupancy(irma.id);
        if (dataIrma.capacity < occ) {
          apertadas.push({ date: irma.date, reservas: occ });
          delete dataIrma.capacity;
        }
      }
      if (!Object.keys(dataIrma).length) continue;
      await prisma.slot.update({ where: { id: irma.id }, data: dataIrma });
      alteradas++;
      const propagIrma = {};
      for (const k of ["time", "unit", "prof"]) if (dataIrma[k] !== undefined) propagIrma[k] = dataIrma[k];
      if (Object.keys(propagIrma).length)
        await prisma.booking.updateMany({
          where: { slotId: irma.id, status: { not: "cancelada" } },
          data: propagIrma,
        });
    }

    // As reservas guardam data/hora/unidade/prof copiados do horário; ao editar
    // a turma, movemos junto todas as reservas ativas dela.
    const propag = {};
    for (const k of ["time", "unit", "date", "prof"]) if (data[k] !== undefined) propag[k] = updated[k];
    if (Object.keys(propag).length) {
      await prisma.booking.updateMany({ where: { slotId: id, status: { not: "cancelada" } }, data: propag });
    }
    res.json({ ...updated, emLote, alteradas: alteradas + 1, apertadas });
  })
);

app.delete(
  "/api/slots/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const slot = await prisma.slot.findUnique({ where: { id } });
    if (!slot) return res.json({ ok: true, deleted: 0 });

    let idsToDelete = [id];
    if (req.query.match === "1" || req.query.series === "1") {
      const irmas = await irmasDaTurma(slot);
      idsToDelete = [...new Set([id, ...irmas.map((s) => s.id)])];
    }

    // Devolve créditos de reposição se houver alguma aluna repondo nos horários excluídos
    const repos = await prisma.booking.findMany({
      where: { slotId: { in: idsToDelete }, paymentMethod: "Reposição" },
      select: { id: true },
    });
    for (const r of repos) await devolverCredito(r.id);

    const r = await prisma.slot.deleteMany({ where: { id: { in: idsToDelete } } });
    res.json({ ok: true, deleted: r.count });
  })
);

// Exclusão de dia: individual (só esta data) ou em lote (todas as semanas do mesmo dia da semana)
app.post(
  "/api/slots/delete-day",
  wrap(async (req, res) => {
    const { date, unit, batch } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Data inválida." });
    }
    const hoje = todayISO();
    let slotWhere = {};
    if (batch) {
      const dow = new Date(date + "T00:00").getDay();
      const futureSlots = await prisma.slot.findMany({
        where: {
          date: { gte: hoje },
          ...(unit && unit !== "Todas" ? { unit } : {}),
        },
      });
      const matchingSlots = futureSlots.filter((s) => {
        const sDow = new Date(s.date + "T00:00").getDay();
        return sDow === dow;
      });
      slotWhere = { id: { in: matchingSlots.map((s) => s.id) } };
    } else {
      slotWhere = {
        date,
        ...(unit && unit !== "Todas" ? { unit } : {}),
      };
    }

    const slotsToDelete = await prisma.slot.findMany({ where: slotWhere, select: { id: true } });
    const slotIds = slotsToDelete.map((s) => s.id);
    if (!slotIds.length) return res.json({ ok: true, deleted: 0 });

    const repos = await prisma.booking.findMany({
      where: { slotId: { in: slotIds }, paymentMethod: "Reposição" },
      select: { id: true },
    });
    for (const r of repos) await devolverCredito(r.id);

    const delRes = await prisma.slot.deleteMany({ where: { id: { in: slotIds } } });
    res.json({ ok: true, deleted: delRes.count });
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
      prisma.booking.findMany(),
    ]);
    const occ = {};
    const totalReservas = {};
    bookings.forEach((b) => {
      if (b.status !== "cancelada") {
        occ[b.slotId] = (occ[b.slotId] || 0) + 1;
      }
      totalReservas[b.slotId] = (totalReservas[b.slotId] || 0) + 1;
    });
    /* Feriado não aparece como opção: um horário criado antes de a data virar
       feriado continua no banco, mas some das telas de escolha.
       Regra 6: Vagas liberadas por falta/cancelamento só ficam livres para reposição,
       aulas extras e alunas de escala. Alunos novos (1ª aula) não podem marcar nessas vagas.
       Logo, para novos alunos, a turma precisa ter totalReservas < s.capacity. */
    const available = slots
      .filter((s) => s.date >= t && !feriadoNoDia(s.date, s.unit) && (!unit || s.unit === unit) && (occ[s.id] || 0) < s.capacity && (totalReservas[s.id] || 0) < s.capacity)
      .map((s) => ({
        id: s.id,
        date: s.date,
        time: s.time,
        unit: s.unit,
        prof: s.prof || profFor(s.unit),
        vagas: s.capacity - (totalReservas[s.id] || 0),
      }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    /* A tela pública da aluna nova lê os preços daqui.
       Antes ela caía nos valores chumbados do código (120/200) quando o meta não os trazia — e o Pix, que
       é montado no servidor, vinha com o valor certo: a tela dizia um número e
       o banco cobrava outro. Preço mostrado é preço prometido, então ele sai da
       mesma fonte que a cobrança. */
    res.json({
      available,
      meta: {
        units: SETTINGS.units,
        valorPadrao: SETTINGS.valorPadrao,
        pixKey: SETTINGS.pixKey,
        pixName: SETTINGS.pixName,
        valorPlano1x: SETTINGS.valorPlano1x,
        valorPlano2x: SETTINGS.valorPlano2x,
        valorPlano3x: SETTINGS.valorPlano3x,
        valorPlano4x: SETTINGS.valorPlano4x,
        // a tela tira da grade da semana os horários que se sobrepõem
        duracaoAulaMin: SETTINGS.duracaoAulaMin,
        // taxa somada ao 1º pagamento da aluna nova (0 = desligada)
        taxaMatricula: SETTINGS.taxaMatricula,
      },
    });
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
      status: firstClass ? "lead" : (extra.status || "ativo"),
      ...(extra.birthday ? { birthday: extra.birthday } : {}),
    },
  });
}

/* Já passou pela matrícula (ou tem a 1ª aula marcada)?
   A matrícula é uma só na vida da aluna: `trialDate` (data da 1ª aula) e
   `matriculaStatus` são a marca de que ela já passou por aqui. Quem faltou
   também entra nesta conta — faltar não devolve o direito de refazer a
   matrícula (as aulas seguintes ela marca normalmente pelo portal).
   Os nomes das colunas são herança do fluxo antigo de aula experimental; o
   significado hoje é "primeira aula / matrícula". */
/* MENSALISTA ATIVA também já é aluna, mesmo sem nenhuma das duas marcas: as
   alunas cadastradas antes do fluxo de matrícula existir (181 em 23/09/2026)
   têm `trialDate` vazio e `matriculaStatus` "nao_aplica". Sem esta linha, a
   Camila Marcelina (2x, ativa) entrou pelo robô para marcar uma aula a mais, foi
   tratada como aluna nova — cobrança de R$ 140 de matrícula — e a ficha dela
   caiu para "lead". Ex-aluna (cancelado) continua podendo se matricular de novo. */
const jaFezMatricula = (c) => !!c && (
  !!c.trialDate || c.matriculaStatus !== "nao_aplica" ||
  (c.plan === "mensalista" && c.status !== "cancelado"));

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
    const pulos = { lotada: 0, jaMarcada: 0, teto: 0, liberada: 0 };
    const painel = doPainel(req);

    /* Fora do painel esta rota só existe para a 1ª aula (a matrícula). A aluna
       já matriculada usa exclusivamente o portal: grade inicial de 12 meses,
       reposição ou extra, sempre pelos fluxos próprios. */
    if (!painel && !b.firstClass)
      return res.status(403).json({ error: "Marcações comuns são feitas pela ADMIN. Use o portal para reposição ou aula extra. 💚" });

    /* LOTE É DO PAINEL — NUNCA DA ALUNA.
       Marcar várias datas de uma vez é operação de quem monta a agenda. Pelo
       portal e pelo WhatsApp a marcação é sempre UMA aula, numa turma que já
       existe: é assim que cada aula aparece na agenda uma a uma, com vaga
       conferida e teto do plano medido no ato. A rota é pública (a tela de
       matrícula usa) e o corpo da requisição qualquer um monta — então quem
       decide é o login, não o `dates` que chegou. */
    if (replicando && !painel)
      return res.status(403).json({
        error: "Marcação em lote é do painel. Aqui a marcação é de uma aula por vez. 💚",
      });

    /* A ficha ANTES do laço: é ela que diz o plano da aluna, e o plano é que
       diz quantas aulas por semana ela pode ter. Antes a ficha só era buscada
       depois de a reserva já existir — e o teto ficava sem quem o medisse. */
    let client = await prisma.client.findFirst({ where: { name: b.clientName } });

    /* Uma matrícula por aluna. Quem já passou por ela (ou faltou na 1ª aula)
       não refaz o fluxo — o caminho dela agora é marcar pelo portal. Este
       bloqueio é do fluxo público; a Inêz continua podendo marcar o que
       precisar pelo painel (que não manda firstClass). */
    if (b.firstClass && !b.viaPainel) {
      const existente = await prisma.client.findFirst({ where: { name: b.clientName } });
      if (jaFezMatricula(existente))
        return res.status(409).json({
          error: "Você já tem a sua matrícula registrada — ela é uma só. " +
            "Para marcar uma aula, entre na área do aluno com o seu CPF. Qualquer dúvida, chame a gente no WhatsApp. 💚",
        });
    }

    // Feriado numa marcação de data única: recusa, com o motivo escrito.
    if (!replicando && barrarFeriado(res, datas[0], unit)) return;

    const feriadosPulados = [];
    for (let i = 0; i < datas.length; i++) {
      const date = datas[i];
      const nomeFeriado = feriadoNoDia(date, unit);
      if (nomeFeriado) { feriadosPulados.push({ date, nome: nomeFeriado }); continue; }
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
          const sit = await situacaoNaTurma(slot.id, b.clientName);
          if (sit?.tipo === "ativa") { pulos.jaMarcada++; continue; }
          if (sit?.tipo === "liberada") { pulos.liberada++; continue; }
        }
      } else {
        /* Horário que ainda não existe na grade só nasce pelo painel. Pela
           porta pública, marcar é ENTRAR numa turma que a escola abriu — não
           abrir uma. Sem isto, uma data e uma hora quaisquer no corpo da
           requisição criavam turma nova na agenda da Inêz. */
        if (!painel)
          return res.status(404).json({ error: "Esse horário não está mais disponível. Escolha um dos horários da lista. 💚" });
        slot = await prisma.slot.create({
          data: { date, time, unit, prof: b.prof || profFor(unit), capacity: SETTINGS.capacidadePadrao },
        });
      }

      /* Aula de matrícula (a 1ª da aluna) ou Aula Avulsa:
         Se for mensalista, o que se cobra na tela é a 1ª MENSALIDADE do plano escolhido
         MAIS a taxa de matrícula (uma vez só). Se for aula avulsa, cobra apenas o valor da aula
         avulsa, sem taxa de matrícula e sem gerar grade de 52 semanas. */
      const isAvulso = b.plan === "avulso" || b.modalidade === "avulso" || b.weeklyFreq === "avulso";
      const ehMatricula = !isAvulso && !!b.firstClass && i === 0;
      const freqEscolhida = freqDoPlano(b.weeklyFreq);
      const taxa = ehMatricula ? taxaMatriculaAtual() : 0;
      // 3x e 4x só no fixo — recusa antes de segurar vaga e emitir cobrança
      if (ehMatricula) {
        const erroEscala = erroEscalaSoAte2x(freqEscolhida, b.mensalistaTipo === "fixo" ? "fixo" : "escala");
        if (erroEscala) return res.status(400).json({ error: erroEscala.message });
      }

      /* Regra 6: Vagas liberadas por falta/cancelamento só ficam livres para reposição,
         aula extra e escala. Alunas novas (1ª aula) não podem ocupar vaga decorrente
         de cancelamento de aluna regular. */
      if (!painel && (ehMatricula || isAvulso || b.firstClass || client?.firstClass)) {
        const totalNoSlot = await prisma.booking.count({ where: { slotId: slot.id } });
        if (totalNoSlot >= (slot.capacity || 1)) {
          return res.status(409).json({
            error: "Este horário possui apenas vagas liberadas por alunas ausentes (reservadas para reposição, extra e escala). Por favor, escolha um horário com vaga regular para sua primeira aula. 💚",
          });
        }
      }

      /* AULA DE MENSALISTA É AULA DO PLANO — e o plano tem teto.
         A marcação da mensalista nasce marcada como `Mensalista`: é essa marca
         que a faz contar no teto de 1x ou 2x por semana (ver contaNoTeto). Sem
         ela, esta rota criava aulas invisíveis para o teto, e a aluna de 1x
         acumulava quantas quisesse por aqui enquanto o portal a barrava.

         Quem NÃO é mensalista não tem teto nenhum: paga por aula e marca
         quantas quiser, desde que haja vaga na turma. A aula de matrícula
         também fica de fora — é aula única, anterior ao plano. */
      const doPlano = !ehMatricula && !isAvulso && tipoMensalista(client) !== null;
      if (doPlano) {
        try {
          await exigirRegras(client, { date: slot.date, time: slot.time }, {
            // O painel pode passar por cima do teto (a agenda é da Inêz); a
            // janela da escala não se aplica a quem marca pelo painel.
            forcar: painel && !!b.forcar,
            ignorarJanela: painel,
          });
        } catch (e) {
          if (!replicando) return res.status(e.code || 409).json({ error: e.message, codigo: e.codigo });
          pulos.teto++; continue;
        }
      }

      const statusInicial = doPlano ? "confirmada" : "aguardando";
      const valorBooking = ehMatricula
        ? valorPrimeiroPagamento(freqEscolhida)
        : isAvulso
        ? (Number(b.value) || Number(SETTINGS.valorAvulsa) || 40)
        : (Number(b.value) || 0);

      const booking = await prisma.booking.create({
        data: {
          clientName: b.clientName,
          phone: b.phone || "",
          unit,
          date: slot.date,
          time: slot.time,
          prof: slot.prof,
          slotId: slot.id,
          // aula do plano já está paga pela mensalidade — nasce confirmada,
          // como no agendamento em lote e na replicação da turma
          status: statusInicial,
          value: valorBooking,
          taxaMatricula: taxa || null,
          paymentMethod: ehMatricula ? MARCA_MATRICULA : isAvulso ? "Aula Avulsa" : doPlano ? PGTO_PLANO : null,
          // Reservas pendentes de pagamento (portal, site, 1ª aula) recebem hold de 10 min
          holdUntil: (!painel && statusInicial === "aguardando") || ((ehMatricula || isAvulso) && statusInicial === "aguardando")
            ? new Date(Date.now() + HOLD_MIN * 60_000)
            : null,
        },
      });
      criadas.push(booking);

      if (!client) client = await ensureClient(b.clientName, b.phone, unit, [], b.cpf, b.email, b.firstClass, { birthday: b.birthday });
      if (isAvulso && client) {
        /* Aluna avulsa de primeira aula: entra como LEAD dentro de ALUNOS,
           com plano "avulso" para exibir a legenda de aula avulsa. */
        await prisma.client.update({
          where: { id: client.id },
          data: {
            status: "lead",
            matriculaStatus: "nao_aplica",
            trialDate: slot.date,
            plan: "avulso",
            weeklyFreq: null,
            firstClass: false,
            unit: client.unit || slot.unit,
          },
        });
      } else if (ehMatricula && client) {
        /* O plano escolhido na tela da matrícula fica guardado aqui como
           INTENÇÃO (weeklyFreq + mensalistaTipo), mas `plan` continua "avulso" e status continua "lead":
           ela só vira mensalista/aluna ativa de fato quando a 1ª mensalidade é paga. Quem faz
           essa virada é registrarMatriculaPaga(), que roda tanto no "já paguei"
           quanto no webhook do Sicredi. */
        const freq = FREQS_PLANO.includes(Number(b.weeklyFreq)) ? Number(b.weeklyFreq) : null;
        const tipoEntrada = b.mensalistaTipo === "fixo" ? "fixo" : "escala";
        await prisma.client.update({
          where: { id: client.id },
          data: {
            status: "lead",
            matriculaStatus: "pendente",
            trialDate: slot.date,
            ...(freq ? { weeklyFreq: freq, mensalistaTipo: tipoEntrada } : {}),
          },
        });

        /* Demais horários da semana (2x a 4x): `extraSlotIds`, ou o campo antigo
           `secondSlotId`/`slot2Id` de quando só existia o 2x. */
        if (freq && freq > 1) {
          const pedidos = Array.isArray(b.extraSlotIds) ? b.extraSlotIds : [b.secondSlotId || b.slot2Id];
          const { extras } = await segurarHorariosExtras({ clientName: b.clientName, phone: b.phone }, slot, pedidos, freq);
          criadas.push(...extras);
        }
      }
    }

    /* Anúncios: a 1ª aula marcada pelo site é o "Lead" da campanha. O mesmo
       event_id sai do navegador (Pixel) em FirstClassBooking.jsx. */
    if (!painel && b.firstClass && criadas[0]) {
      const ctx = contextoDoNavegador(req);
      guardarContexto(criadas[0].id, ctx);
      enviarEventoMeta({
        eventName: "Lead",
        eventId: `lead-${criadas[0].id}`,
        pessoa: { nome: b.clientName, telefone: b.phone, email: b.email, nascimento: b.birthday, cidade: unit, id: String(b.phone || "").replace(/\D/g, "") },
        ctx,
        custom: { content_name: b.plan === "avulso" ? "aula avulsa" : "matricula", currency: "BRL" },
      });
    }

    // compatibilidade: sem replicação, devolve a marcação criada (como antes)
    if (!replicando) return res.json(criadas[0]);
    res.json({ created: criadas, pulos, feriados: feriadosPulados });
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
    // Mudar a aula PARA um feriado é a mesma coisa que marcar num feriado.
    if (data.date !== undefined && data.date !== cur.date && barrarFeriado(res, data.date, data.unit || cur.unit)) return;
    if (req.body.value !== undefined) data.value = Number(req.body.value) || cur.value;
    if (req.body.paid !== undefined) data.paid = !!req.body.paid;
    // mover a reserva para outro horário (usado no fluxo da 1ª aula)
    if (req.body.slotId !== undefined && Number(req.body.slotId) !== cur.slotId) {
      const ns = await prisma.slot.findUnique({ where: { id: Number(req.body.slotId) } });
      if (!ns) return res.status(404).json({ error: "Horário não encontrado" });
      if (barrarFeriado(res, ns.date, ns.unit)) return;
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
    // ?series=1 ou ?match=1: exclui também as demais aulas da aluna neste mesmo dia da semana e horário, de hoje em diante
    if (req.query.series === "1" || req.query.match === "1") {
      const dow = new Date(bk.date + "T00:00").getDay();
      /* A CANCELADA NÃO VAI JUNTO.

         Excluir a série apaga as aulas que a escola montou errado. A linha
         cancelada não é uma delas: é a aula que a ALUNA liberou, e é nela que
         o lote lê "não remarque esta data" (ver situacaoNaTurma) e que o
         crédito de reposição se apoia. Apagando a cancelada, a prova da
         liberação sumia, o próximo agendamento em lote recriava a aula e a
         aluna ficava com a aula e com o crédito — 15/09/2026, 6 créditos
         assim. Quem quiser mesmo tirar a linha cancelada do caminho apaga
         aquela aula sozinha, olhando para ela. */
      const futuras = await prisma.booking.findMany({
        where: {
          clientName: bk.clientName,
          unit: bk.unit,
          time: bk.time,
          date: { gte: todayISO() },
          status: { not: "cancelada" },
        },
      });
      const matching = futuras.filter((b) => {
        if (bk.seriesId && b.seriesId === bk.seriesId) return true;
        return new Date(b.date + "T00:00").getDay() === dow;
      });
      const ids = [...new Set([id, ...matching.map((b) => b.id)])];
      for (const bId of ids) await devolverCredito(bId);
      const r = await prisma.booking.deleteMany({ where: { id: { in: ids } } });
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

  // Se houver uma 2ª reserva de matrícula (ex.: plano 2x por semana) aguardando hold, confirma-a também:
  const outrasMatricula = await prisma.booking.findMany({
    where: {
      clientName: booking.clientName,
      paymentMethod: MARCA_MATRICULA,
      status: "aguardando",
      id: { not: booking.id },
    },
  });
  for (const om of outrasMatricula) {
    await prisma.booking.update({
      where: { id: om.id },
      data: {
        status: "confirmada",
        paid: true,
        paymentDate: pagoEm,
        paymentMethod: PGTO_PLANO,
        holdUntil: null,
      },
    });
  }

  const atualizado = await prisma.client.update({
    where: { id: c.id },
    data: { matriculaStatus: "paga", matriculaAt: pagoEm, status: "ativo" },
  });
  if (!atualizado.weeklyFreq || (atualizado.plan === "mensalista" && atualizado.matriculaStatus === "convertida")) return null;
  /* A grade de 12 meses sai de TODOS os horários desta matrícula — o da 1ª
     aula e os demais da semana (2x a 4x) — passados explicitamente. Antes só ia
     o da 1ª aula, e os outros eram "achados" pelas marcações futuras dela, o que
     só acontecia com ficha de aluna nova (firstClass): a ex-aluna que voltava
     pelo WhatsApp saía com a grade de um horário só. */
  const slotIdsMatricula = [booking.slotId, ...outrasMatricula.map((om) => om.slotId)].filter(Boolean);
  try {
    const r = await converterEmMensalista(atualizado, {
      weeklyFreq: atualizado.weeklyFreq,
      mensalistaTipo: atualizado.mensalistaTipo,
      billingDay: diaDoMes(pagoEm),
      slotIds: slotIdsMatricula,
      /* O que vira mensalidade do mês corrente é o PAGAMENTO MENOS A TAXA DE
         MATRÍCULA. `booking.value` é o que ela pagou (mensalidade + taxa); a
         fatura do mês tem que nascer com o valor da mensalidade, senão o
         financeiro da escola passa a mostrar R$ 20 a mais por aluna nova — e a
         devolução de quem desistir sairia errada junto. */
      mensalidadePaga: { valor: mensalidadeDaReserva(booking), pagoEm, txid: booking.txid },
    });
    console.log(`[matricula] ${atualizado.name} matriculada no plano ${atualizado.weeklyFreq}x (${atualizado.mensalistaTipo}). Aulas criadas na grade: ${r?.grade?.total || 0}.`);
    /* Plano de N aulas com menos de N horários na grade (ela tocou em "definir
       depois", ou a semana não tinha vaga): fica escrito na ficha, que é onde a
       Inêz olha. Sem isso, ninguém fica sabendo que falta horário na agenda
       dela — e a aluna pagou pelo plano inteiro. */
    const faltam = (Number(atualizado.weeklyFreq) || 0) - slotIdsMatricula.length;
    if (faltam > 0 && atualizado.mensalistaTipo !== "escala") {
      const aviso = `⚠️ ${fmtDiaBR(pagoEm)}: matrícula no plano ${atualizado.weeklyFreq}x com ${slotIdsMatricula.length} horário(s) na grade — ` +
        `falta${faltam > 1 ? "m" : ""} ${faltam}. Combinar com ela e marcar na agenda.`;
      await prisma.client.update({
        where: { id: atualizado.id },
        data: { notes: [aviso, atualizado.notes].filter(Boolean).join("\n") },
      });
      console.log(`[matricula] ${atualizado.name}: ${aviso}`);
    }
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
/* O texto não tem variável nenhuma, então o template é idêntico ao texto livre
   — a aluna recebe a mesma coisa dentro ou fora da janela de 24h. */
/* Desde 21/09/2026 a mensagem leva o endereço da unidade. Fora da janela isso
   exige o template NOVO `material_primeira_aula_endereco` ({{1}} unidade,
   {{2}} endereço) — o antigo não tem variável e não dá para editar sem tirá-lo
   do ar (ver memória do WhatsApp). Enquanto o novo não estiver aprovado, a Meta
   recusa na hora (132001) e cai no antigo, sem endereço: melhor o material
   sem endereço do que nenhuma mensagem. */
const TEMPLATE_MATERIAL_COM_ENDERECO = "material_primeira_aula_endereco";
async function enviarMaterialPrimeiraAula(phone, unidade) {
  if (!phone) return;
  try {
    if (await janelaAbertaPara(phone)) {
      await waSend(phone, textoMaterialPrimeiraAula({ unidade }), { kind: "material" });
      return;
    }
    const end = enderecoDaUnidade(unidade);
    if (end) {
      try {
        const r = await sendWaTemplate(phone, TEMPLATE_MATERIAL_COM_ENDERECO, { body: [unidade, end.endereco] });
        await registrarWaEnvio(r, { phone, kind: TEMPLATE_MATERIAL_COM_ENDERECO });
        return;
      } catch (e) {
        console.warn(`[wa] ${TEMPLATE_MATERIAL_COM_ENDERECO} indisponível (${e.body?.error?.code || e.message}) — mandando o material sem endereço`);
      }
    }
    const r = await sendWaTemplate(phone, "material_primeira_aula", {});
    await registrarWaEnvio(r, { phone, kind: "material_primeira_aula" });
  } catch (e) {
    console.warn(`[wa] material da primeira aula não saiu para ${phone}: ${e.message}`, e.body?.error?.message || "");
  }
}

async function avisarMatriculaConfirmada(booking) {
  if (!waConfigured() || !booking?.phone) return;
  const isMatricula = ehPagamentoDeMatricula(booking.paymentMethod);
  const isAvulso = booking.paymentMethod === "Aula Avulsa";
  if (!isMatricula && !isAvulso) return;
  try {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { holdUntil: null, holdNudged: false },
    });
    await prisma.waConversation.updateMany({
      where: { bookingId: booking.id },
      data: { step: "done", bookingId: null, slotId: null, pendingName: null },
    });
    const client = await prisma.client.findFirst({ where: { name: booking.clientName } });
    const portalUrl = client?.cpf ? `${WA_PORTAL_URL}?cpf=${client.cpf}` : WA_PORTAL_URL;
    const quando = fmtSlotBR({ date: booking.date, time: booking.time });
    /* Plano 2x a 4x: a matrícula tem mais de um horário na semana, e a
       confirmação cita todos. Roda depois de registrarMatriculaPaga, que já
       confirmou os demais horários (marcados como aula do plano). Na 1ª semana
       só existem esses: a grade de 12 meses pula o que ela já tem. */
    const daSemana = isMatricula
      ? (await prisma.booking.findMany({
          where: {
            clientName: booking.clientName, status: { not: "cancelada" }, id: { not: booking.id },
            date: { gte: booking.date }, paymentMethod: { in: [PGTO_PLANO, MARCA_MATRICULA] },
          },
        })).filter((b) => mesmaSemana(b.date, booking.date))
      : [];
    const aulas = [booking, ...daSemana]
      .sort((a, b) => (a.date + hhmm(a.time)).localeCompare(b.date + hhmm(b.time)))
      .map((b) => fmtSlotBR({ date: b.date, time: b.time }));
    /* Quase sempre a janela está aberta aqui: ela acabou de conversar com o bot
       para escolher unidade, horário e CPF. Mas quem paga pelo portal horas
       depois cai fora dela — e aí, sem template, a primeira mensagem que uma
       aluna nova receberia da escola simplesmente não chegaria.

       ATENÇÃO ao texto completo: ele tem 2189 caracteres e o limite de um
       template é 1024. As REGRAS não cabem. Fora da janela sai a confirmação
       curta, com o botão do portal e um convite para ela responder — e é a
       resposta dela que abre a janela para as regras irem depois. Quem não
       responder fica sem elas; está registrado em WaMessage para a Inêz ver. */
    if (await janelaAbertaPara(booking.phone)) {
      await waSend(booking.phone, textoMatriculaConfirmada({
        nome: booking.clientName,
        unidade: booking.unit,
        quando,
        aulas,
        repetem: client?.mensalistaTipo === "fixo",
        // a taxa gravada NA RESERVA: é o que ela pagou, não o que a tabela diz hoje
        taxa: booking.taxaMatricula ? moedaBR(booking.taxaMatricula) : "",
        portalUrl,
        isAvulso,
      }), { kind: "matricula" });
    } else {
      const nome = isAvulso ? "pagamento_aula_avulsa" : "matricula_confirmada";
      const r = await sendWaTemplate(booking.phone, nome, {
        // o template tem um campo só para "quando": vai a lista numa linha
        body: [primeiroNome(booking.clientName) || "aluna", booking.unit, listaComE(aulas)],
      });
      await registrarWaEnvio(r, { phone: booking.phone, kind: nome });
    }
    /* Material da primeira aula, em mensagem separada.

       Sai DEPOIS do pagamento, e não no fim do cadastro (Vitor, 08/09/2026):
       no fim do cadastro ela ainda tem uma reserva correndo contra o relógio, e
       o código do Pix é mandado sozinho de propósito, para ela copiar com um
       toque — qualquer mensagem depois dele empurra o código para cima.

       Vale para a avulsa também: ela também tem uma primeira aula para a qual
       precisa levar material. */
    await enviarMaterialPrimeiraAula(booking.phone, booking.unit);
  } catch (e) {
    console.warn(`[wa] confirmação da matrícula/aula de ${booking.clientName} não saiu: ${e.message}`);
  }
}

app.post(
  "/api/bookings/:id/pay",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await prisma.booking.findUnique({ where: { id } });
    if (!cur) return res.status(404).json({ error: "Marcação não encontrada" });

    // Chamada vinda de fora do painel admin (aluna na tela de matrícula ou portal):
    // NUNCA dar baixa cega ou manual! É obrigatório consultar a API Pix do Sicredi.
    if (!doPainel(req)) {
      if (soMatriculaPelaPortaPublica(req, res, cur)) return;

      // Se já foi compensado e confirmado anteriormente:
      if (cur.paid) {
        const c = await prisma.client.findFirst({ where: { name: cur.clientName } });
        return res.json({ ...cur, matricula: c, pago: true });
      }

      const txid = cur.txid || txidBooking(cur.id);
      if (!sicrediConfigured() || !txid) {
        return res.status(400).json({
          error: "A confirmação automática via Pix não está disponível para esta reserva. Por favor, envie o comprovante no WhatsApp da escola para liberarmos a sua vaga. 💚",
          pago: false,
        });
      }

      let confirmado = false;
      try {
        confirmado = await confirmarPagamentoPorTxid(txid);
      } catch (e) {
        console.warn(`[pay] consulta ao Sicredi falhou para booking ${id}: ${e.message}`);
      }

      if (!confirmado) {
        return res.status(400).json({
          error: "Pagamento Pix ainda não identificado pelo banco. Se você acabou de transferir, aguarde alguns instantes e tente novamente. 💚",
          pago: false,
        });
      }

      const updated = await prisma.booking.findUnique({ where: { id } });
      const c = await prisma.client.findFirst({ where: { name: updated?.clientName } });
      return res.json({ ...updated, matricula: c, pago: true });
    }

    // Baixa manual executada pelo painel administrativo (Inêz / atendente logada):
    const booking = await prisma.booking.update({
      where: { id },
      data: {
        paid: true,
        status: "confirmada",
        paymentMethod: ehPagamentoDeMatricula(cur?.paymentMethod) ? cur.paymentMethod : (req.body.paymentMethod || "Pix"),
        paymentDate: req.body.paymentDate || todayISO(),
        ...(req.body.value !== undefined && !ehPagamentoDeMatricula(cur?.paymentMethod)
          ? { value: Number(req.body.value) }
          : {}),
      },
    });
    const matricula = await registrarMatriculaPaga(booking);
    await avisarMatriculaConfirmada(booking);
    res.json({ ...booking, matricula, pago: true });
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
    // Pela porta pública, só o Pix da própria matrícula: emitir cobrança é uma
    // chamada ao Sicredi, e id de reserva alheia não pode virar cobrança nova.
    if (soMatriculaPelaPortaPublica(req, res, booking)) return;
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
    // Anúncios: a venda confirmada pelo banco. Dedup com o Pixel pelo event_id.
    if (booking.paymentMethod === "Aula Avulsa" || ehPagamentoDeMatricula(booking.paymentMethod)) {
      const cli = await prisma.client.findFirst({ where: { name: booking.clientName } });
      enviarEventoMeta({
        eventName: "Purchase",
        eventId: `purchase-${booking.id}`,
        pessoa: { nome: booking.clientName, telefone: booking.phone, email: cli?.email, nascimento: cli?.birthday, cidade: booking.unit, id: String(booking.phone || "").replace(/\D/g, "") },
        ctx: contextoGuardado(booking.id),
        custom: { value: Number(booking.value) || 0, currency: "BRL" },
      });
    }
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
    const dona = await prisma.client.findUnique({ where: { id: pass.clientId } });
    await avisarPagamento(dona, textoAulaExtraPaga({
      nome: dona?.name,
      valor: moedaBR((pass.amountCents || 0) / 100),
    }), {
      /* Nome novo (08/09/2026): a Meta reclassificou `aula_extra_confirmada`
         para MARKETING por causa do convite para marcar, e depois de apagado
         o nome fica preso — não aceita voltar para UTILITY. Nome novo, texto
         neutro, categoria certa. Não renomear de volta. */
      name: "pagamento_aula_extra",
      // sem "R$": o cifrao mora no corpo do template, igual aos de mensalidade
      body: [primeiroNome(dona?.name) || "aluna", reaisBR((pass.amountCents || 0) / 100)],
    });
    return true;
  }

  let invoice = await prisma.invoice.findFirst({ where: { txid } });
  if (!invoice && ref?.tipo === "mensalidade") {
    invoice = await prisma.invoice.findFirst({ where: { clientId: ref.clientId, competencia: ref.competencia } });
  }
  if (invoice && invoice.status !== "pago") {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "pago", paidAt: todayISO() } });
    console.log(`[sicredi] mensalidade confirmada — invoice ${invoice.id}`);
    /* O valor avisado é o que o QR COBROU, não o `amountCents` original nem a
       conta de hoje. `encargosAte` é a data em que o pixCode foi precificado:
       usá-la devolve exatamente o número que apareceu no app do banco dela.
       Recalcular por `todayISO()` daria alguns centavos de juros a mais se o
       QR foi emitido ontem — e confirmar um valor diferente do que ela acabou
       de pagar é o tipo de diferença que vira desconfiança. `encargosAte` nulo
       quer dizer QR emitido sem acréscimo: aí o valor é o original mesmo. */
    const dona = await prisma.client.findUnique({ where: { id: invoice.clientId } });
    const pagoCents = invoice.encargosAte
      ? encargosDe(invoice, invoice.encargosAte).totalCents
      : invoice.amountCents;
    await avisarPagamento(dona, textoMensalidadePaga({
      nome: dona?.name,
      mes: compPorExtenso(invoice.competencia),
      valor: moedaBR(pagoCents / 100),
    }), {
      name: "pagamento_confirmado",
      body: [primeiroNome(dona?.name) || "aluna", compPorExtenso(invoice.competencia), reaisBR(pagoCents / 100)],
    });
    return true;
  }
  return false;
}

/* Manda uma confirmação de pagamento para a aluna. Sai em silêncio quando o
   WhatsApp não está configurado ou a ficha não tem telefone — e NUNCA derruba
   quem chamou: a baixa do pagamento já aconteceu no banco quando chegamos aqui,
   e uma falha de mensagem não pode desfazer dinheiro que entrou. Foi por isso
   que a confirmação da matrícula ganhou try/catch, e vale igual para estas. */
async function avisarPagamento(client, texto, template) {
  if (!waConfigured() || !client?.phone) return;
  try {
    /* Mesma regra da cobrança: quem paga por Pix quase nunca está com a janela
       de 24h aberta — ela pagou pelo portal, não conversando aqui. Em 08/09/2026
       as duas únicas confirmações do dia falharam com 131047 e ninguém soube.
       Com a janela fechada vai template; sem template, não vai nada. */
    if (await janelaAbertaPara(client.phone)) {
      await waSend(client.phone, texto, { kind: "pagamento" });
      return;
    }
    const r = await sendWaTemplate(client.phone, template.name, { body: template.body });
    await registrarWaEnvio(r, { phone: client.phone, kind: template.name });
  } catch (e) {
    console.warn(`[wa] confirmação de pagamento de ${client.name} não saiu: ${e.message}`, e.body?.error?.message || "");
  }
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
// Valor efetivo da mensalidade, na ordem: valor individual → plano 1x a 4x →
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

/* QUANDO nasce a próxima mensalidade desta aluna.
   A rodada automática gera o boleto de uma competência assim que faltam
   ANTECEDENCIA_DIAS para o vencimento — então a data em que ele nasce é o
   vencimento menos essa antecedência. Se a competência corrente já tem boleto,
   a próxima é a do mês que vem; se a janela já abriu, é a primeira rodada
   (hoje).

   Serve às telas de inativar/reativar: a pergunta que vem logo depois de mexer
   no status é "e a cobrança dela, para quando fica?". Devolve null para quem
   não é mensalista — não há cobrança recorrente a prever. */
// 'YYYY-MM-DD' → 'DD/MM', para as mensagens que a tela mostra sem reformatar.
const dataBR = (iso) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
async function proximaCobranca(client, hoje = todayISO()) {
  if (!client || client.plan !== "mensalista") return null;
  let comp = competenciaAtual();
  const jaTem = await prisma.invoice.findFirst({
    where: { clientId: client.id, competencia: comp, status: { not: "cancelado" } },
  });
  if (jaTem) comp = somarComp(comp, 1);
  const vencimento = vencimentoBruto(client, comp);
  const nasceEm = addDays(vencimento, -ANTECEDENCIA_DIAS);
  return {
    competencia: comp,
    vencimento,
    geraEm: nasceEm < hoje ? hoje : nasceEm,
    naProximaRodada: nasceEm <= hoje,
    // Com a geração automática desligada, a data acima é quando ELA pode gerar
    // pelo painel — nada nasce sozinho.
    automatica: !!SETTINGS.geracaoAuto,
  };
}

/**
 * Emite a cobrança Pix de uma mensalidade no Sicredi.
 * Fica separada de gerarMensalidade porque a reemissão (QR vencido) precisa
 * exatamente do mesmo trabalho, só que com outra via (seq) e outra expiração.
 * @returns {{txid: string, pixCode: string|null}}
 */
async function emitirCobrancaMensalidade({ client, comp, valorCents, expiraEm, seq = 0 }) {
  const cpf = (client.cpf || "").replace(/\D/g, "");
  if (!cpf) throw Object.assign(new Error("Cadastre o CPF do aluno antes de gerar a cobrança."), { code: 400 });
  if (!validarCPF(cpf)) {
    throw Object.assign(new Error(`O CPF cadastrado para ${client.name} (${client.cpf}) é inválido. Corrija o CPF no cadastro da aluna para gerar o Pix.`), { code: 400 });
  }
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
  /* Ex-aluna (inscrição cancelada) não gera cobrança nova. A rodada automática
     já pula quem está assim; sem esta trava, o botão "gerar boleto" do painel
     ainda emitia Pix para quem saiu do curso — e a aluna recebia cobrança pelo
     portal de um mês que ela não vai cursar. A mensalidade volta a nascer quando
     a inscrição for reativada. */
  if (client.status === "cancelado")
    throw Object.assign(
      new Error(`${client.name} está inativa (ex-aluna) — reative a inscrição para gerar a mensalidade.`),
      { code: 409, codigo: "ALUNA_INATIVA" }
    );
  const comp = competencia || competenciaAtual();
  // já existe para essa competência? reaproveita
  const existing = await prisma.invoice.findFirst({ where: { clientId, competencia: comp } });
  if (existing) return existing;
  // Valor DA COMPETÊNCIA: respeita o desconto/promoção marcada para este mês.
  const valor = await valorDaCompetencia(client, comp);
  if (!valor) throw Object.assign(new Error("Defina o valor da mensalidade (no aluno ou nas Configurações)."), { code: 400 });
  const dueDate = vencimentoDe(client, comp);
  const valorCents = Math.round(valor * 100);
  let txid = null, pixCode = null, pixExpiresOn = null;
  if (sicrediConfigured()) {
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
    data: { clientId, competencia: comp, amountCents: valorCents, dueDate, status: "pendente", txid, pixCode, pixExpiresOn, semPix: false },
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

  const devido = encargosHoje(invoice, hoje);
  const valorMudou = invoice.pixCode
    ? (totalDoPixAtual(invoice) !== devido.totalCents || (invoice.encargosAte && !devido.atrasada))
    : false;
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
   Registra o pagamento manual da mensalidade (dinheiro, transferência, etc).
   Não afeta de forma alguma o Pix ou as cobranças dos meses seguintes. */
app.post("/api/invoices/:id/pay", wrap(async (req, res) => {
  const manual = req.body?.manual !== false;
  const inv = await prisma.invoice.update({
    where: { id: Number(req.params.id) },
    data: { status: "pago", paidAt: req.body?.paidAt || todayISO(), baixaManual: manual },
  });
  res.json(inv);
}));

// Cancelar mensalidade
app.post("/api/invoices/:id/cancel", wrap(async (req, res) => {
  const inv = await prisma.invoice.update({ where: { id: Number(req.params.id) }, data: { status: "cancelado" } });
  res.json(inv);
}));

/* Alterar data de vencimento e dados da mensalidade (mesmo que esteja em atraso) */
app.patch("/api/invoices/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await prisma.invoice.findUnique({ where: { id } });
  if (!cur) return res.status(404).json({ error: "Mensalidade não encontrada." });

  const data = {};
  if (req.body.dueDate !== undefined) {
    const dd = String(req.body.dueDate).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dd)) return res.status(400).json({ error: "Data de vencimento inválida (formato AAAA-MM-DD)." });
    if (dd !== cur.dueDate) {
      data.dueDate = dd;
      // Ao alterar o vencimento para data futura/hoje, zera marcadores de avisos já disparados
      if (dd >= todayISO()) {
        data.avisoAVencerAt = null;
        data.avisoAtrasoAt = null;
        data.avisoAtraso2At = null;
      }
      // Se a data de vencimento mudou, anula o Pix anterior para que um novo seja gerado com a data e encargos corretos
      if (cur.pixCode || cur.encargosAte) {
        data.encargosAte = null;
        data.pixCode = null;
        data.txid = null;
        data.pixExpiresOn = null;
      }
    }
  }
  if (req.body.amountCents !== undefined) {
    const val = Math.round(Number(req.body.amountCents));
    if (val && val !== cur.amountCents) {
      data.amountCents = val;
      data.pixCode = null;
      data.txid = null;
      data.pixExpiresOn = null;
      data.encargosAte = null;
    }
  }
  if (req.body.semPix !== undefined) {
    data.semPix = !!req.body.semPix;
  }

  const updated = await prisma.invoice.update({ where: { id }, data });
  res.json(comEncargos(updated));
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
      ...Object.fromEntries(FREQS_PLANO.map((f) => {
        const antes = SETTINGS[`valorPlano${f}x`];
        return [`plano${f}x`, { antes, depois: calcularReajuste(antes, { tipo, valor }) }];
      })),
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
 *   atualizarTabela?: boolean,   // sobe planos 1x a 4x → vale para quem entrar depois
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
    const d = Object.fromEntries(FREQS_PLANO.map((f) =>
      [`valorPlano${f}x`, calcularReajuste(SETTINGS[`valorPlano${f}x`], { tipo, valor: n })]));
    await prisma.settings.upsert({ where: { id: 1 }, update: d, create: { id: 1, ...d } });
    await loadSettings(); // sem isto, mensalidadeValorDe seguiria com o preço velho
    tabela = Object.fromEntries(FREQS_PLANO.map((f) => [`plano${f}x`, d[`valorPlano${f}x`]]));
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

   Três envios possíveis por mensalidade:

   1. LEMBRETE, no dia EXATO de AVISO_ANTES dias antes do vencimento. É
      lembrete, não cobrança: o tom é de quem avisa para a pessoa não pagar
      multa à toa. Foi assim que a Inêz pediu — "não como se fosse uma cobrança".
   2. 1ª COBRANÇA, A PARTIR de AVISO_ATRASO_1 dias de atraso, já com multa e
      juros na conta e o Pix reemitido pelo valor novo.
   3. 2ª COBRANÇA, A PARTIR de AVISO_ATRASO_2 dias de atraso — só dispara se a
      1ª já saiu e a mensalidade CONTINUA sem pagar (Vitor, 13/09/2026: "avisar
      1 dia depois e, se não houver pagamento, de novo 5 dias depois").

   O lembrete tem data única (`hoje === vencimento - AVISO_ANTES`): se a rodada
   não rodar naquele dia — servidor fora do ar, chave desligada, dia inteiro
   fora da janela de silêncio — aquele lembrete se perde, porque no dia
   seguinte a condição já é falsa. Avisar "faltam 3 dias" com 2 dias de
   antecedência seria mentira, então perder é melhor do que corrigir.

   As duas cobranças usam `dias >= AVISO_ATRASO_N` (não `===`) e por isso se
   recuperam sozinhas: cada uma sai na primeira rodada que encontrar o atraso
   correspondente, mesmo que a rodada tenha ficado parada alguns dias.

   Os TRÊS templates de WhatsApp compartilham só dois nomes — `cobranca_mensalidade`
   serve tanto a 1ª quanto a 2ª cobrança, porque o texto já é dinâmico em
   "dias" e não precisa saber qual das duas é. O que diferencia uma da outra é
   só o CAMPO gravado na mensalidade (avisoAtrasoAt / avisoAtraso2At) e o `kind`
   interno em WaMessage — ver `avisoComPix` e `liberarReenvioDaCobranca`.

   As datas de envio ficam gravadas na própria mensalidade: é o que impede a
   rodada de repetir o recado a cada hora, e deixa visível no banco quando a
   escola falou com a aluna. */
const AVISO_ANTES = 3;    // dias antes do vencimento (dia exato)
const AVISO_ATRASO_1 = 1; // 1ª cobrança: a partir de quantos dias de atraso
const AVISO_ATRASO_2 = 5; // 2ª cobrança: a partir de quantos dias de atraso, se a 1ª não resolveu

/* Dias de atraso da mensalidade, contados no calendário e SEM passar pela conta
   de multa e juros.

   Existe separado de propósito. O atraso vinha de `comEncargos().encargos.dias`,
   que cai em `semEncargos` — e devolve `dias: 0` fixo — quando a chave
   `cobrarEncargos` está desligada. Com `dias` sempre 0, `dias >= AVISO_ATRASO_1`
   nunca era verdade: desligar multa e juros DESLIGAVA a cobrança de atraso
   inteira, em silêncio. São duas decisões diferentes (quanto se cobra × quando
   se fala com a aluna) e agora são dois cálculos diferentes. */
const diasDeAtraso = (inv, hoje = todayISO()) => Math.max(0, diasEntreISO(inv.dueDate, hoje));

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

/* ---------- A JANELA DE 24h, MEDIDA EM VEZ DE ADIVINHADA ----------

   Texto livre só é entregue dentro da janela de 24h aberta pela última mensagem
   DELA. Fora dela, a Meta responde 200, devolve um id e **descarta o envio em
   silêncio** — não existe erro para capturar. Por isso a decisão "texto ou
   template" é tomada ANTES de mandar, olhando o relógio, e não depois, no
   `catch` de um erro que nunca chega. Ver wa.js, no lugar onde morava
   `sendWaTextOrTemplate`.

   O relógio é o `lastInboundAt` da conversa, o mesmo que a Meta usa.

   O telefone da ficha e o wa_id quase nunca são iguais: a ficha guarda o que a
   Inêz digitou ("(31) 99966-2684") e a Meta entrega "5531999662684", às vezes
   sem o 9. A comparação é pela CHAVE — DDD + os 8 últimos dígitos, que é o que
   os dois formatos sempre têm em comum. */
const chaveTelefone = (t) => {
  let d = String(t || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : "";
};
async function janelaAbertaPara(phone) {
  const chave = chaveTelefone(phone);
  if (!chave) return false;
  const convs = await prisma.waConversation.findMany({
    where: { lastInboundAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    select: { phone: true },
  });
  return convs.some((c) => chaveTelefone(c.phone) === chave);
}

/* Guarda o envio para o webhook de status poder dizer, depois, se chegou.
   Nunca derruba quem chamou: perder o registro é ruim, perder a mensagem é
   pior — e a mensagem já saiu quando chegamos aqui. */
async function registrarWaEnvio(resp, { phone, kind, invoiceId = null }) {
  const wamid = resp?.messages?.[0]?.id;
  if (!wamid) return null;
  try {
    return await prisma.waMessage.create({
      data: { wamid, phone: String(phone || "").slice(0, 20), kind, invoiceId },
    });
  } catch (e) {
    console.warn(`[wa registro] ${kind} para ${phone}: ${e.message}`);
    return null;
  }
}

/* `template` é o template aprovado equivalente ao texto: { name, body, kind? }.

   `kind` é opcional e serve para as duas cobranças de atraso (13/09/2026): as
   duas usam o MESMO template na Meta (`cobranca_mensalidade`, já dinâmico em
   "dias") mas precisam de registros DIFERENTES em WaMessage — senão
   `liberarReenvioDaCobranca` não sabe se uma falha de entrega é da 1ª ou da 2ª
   cobrança, e desmarca o campo errado. Sem `kind`, cai no nome do template
   (era o comportamento de sempre, para lembrete/matrícula/etc, que continuam
   1 kind = 1 template).

   Aviso de mensalidade é mensagem que a ESCOLA inicia, quase sempre com a
   janela fechada — e fora dela só template é entregue. Com a janela aberta o
   texto livre é melhor (mais natural, e não gasta template), então a escolha é
   feita pelo relógio, uma vez, aqui em cima. */
async function avisoComPix(client, inv, texto, template) {
  const aberta = await janelaAbertaPara(client.phone);
  try {
    const r = aberta
      ? await sendWaText(client.phone, texto)
      : await sendWaTemplate(client.phone, template.name, { body: template.body });
    await registrarWaEnvio(r, { phone: client.phone, kind: template.kind || template.name, invoiceId: inv.id });
  } catch (e) {
    console.warn(`[mensalidade wa] ${client.name} (${inv.competencia}): ${e.message}`, e.body?.error?.message || "");
    return false; // não saiu: quem chamou NÃO pode marcar a mensalidade como avisada
  }
  /* Daqui para baixo é texto livre e não cabe em template: com a janela fechada
     seria descartado em silêncio, igual ao resto. Fora dela a aluna alcança o
     QR pelo botão do template, que leva ao portal. */
  if (!aberta) return true;
  /* O QR só vai junto se existir E estiver cobrando o valor certo. Um Pix
     emitido antes da multa cobraria menos do que a conta escrita acima dele —
     mandar isso é pior do que não mandar código nenhum. */
  try {
    const atual = await pixPagavelDaMensalidade(inv);
    if (atual?.pixCode) {
      await waSend(client.phone, "Segue o Pix copia-e-cola 👇", { kind: "pix", invoiceId: inv.id });
      await waSend(client.phone, atual.pixCode, { kind: "pix", invoiceId: inv.id });
      return true;
    }
  } catch (e) {
    console.warn(`[mensalidade wa] Pix de ${client.name} (${inv.competencia}) não saiu: ${e.message}`);
  }
  await waSend(client.phone, "Me avisa por aqui que eu te mando o Pix atualizado. 💚", { kind: "pix", invoiceId: inv.id });
  return true;
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
    where: { status: "pendente" },
  });
  for (const inv of abertas) {
    const client = await prisma.client.findUnique({ where: { id: inv.clientId } });
    if (!client?.phone || client.status === "cancelado") continue;
    const comEnc = comEncargos(inv);
    const mes = compPorExtenso(inv.competencia);
    try {
      if (!inv.avisoAVencerAt && hoje === addDays(inv.dueDate, -AVISO_ANTES)) {
        const saiu = await avisoComPix(client, inv, textoMensalidadeAVencer({
          nome: client.name, mes,
          valor: moedaBR(inv.amountCents / 100),
          vencimento: fmtDiaBR(inv.dueDate),
        }), {
          /* Nome novo (08/09/2026): template pendente não aceita edição
             ("só podem ser editados se tiverem sido rejeitados"), e a frase do
             atendente precisava entrar. `mensalidade_a_vencer` ficou órfão. */
          name: "lembrete_mensalidade",
          body: [primeiroNome(client.name), mes, reaisBR(inv.amountCents / 100), fmtDiaBR(inv.dueDate)],
        });
        /* Só marca se a mensagem saiu de fato. E a marca é provisória: se o
           webhook de status disser que não foi entregue, liberarReenvioDaCobranca
           apaga isto e a rodada de amanhã tenta de novo. */
        if (saiu) await prisma.invoice.update({ where: { id: inv.id }, data: { avisoAVencerAt: hoje } });
        continue;
      }
      /* O atraso decide SE fala; os encargos decidem QUANTO cobra. Com a chave
         de encargos desligada o total é o valor original — mas a aluna continua
         sendo avisada de que a mensalidade venceu. */
      const dias = diasDeAtraso(inv, hoje);
      const total = comEnc.encargos?.total ?? inv.amountCents / 100;
      /* 1ª cobrança. Mesmo template da 2ª (`cobranca_mensalidade`) — só o
         `kind` interno muda, para o reenvio saber qual campo desmarcar se
         falhar (ver `avisoComPix` e `liberarReenvioDaCobranca`). */
      if (!inv.avisoAtrasoAt && dias >= AVISO_ATRASO_1) {
        const saiu = await avisoComPix(client, inv, textoMensalidadeEmAtraso({
          nome: client.name, mes, dias, valor: moedaBR(total),
        }), {
          name: "cobranca_mensalidade",
          kind: "cobranca_mensalidade_1",
          body: [primeiroNome(client.name), mes, String(dias), reaisBR(total)],
        });
        if (saiu) await prisma.invoice.update({ where: { id: inv.id }, data: { avisoAtrasoAt: hoje } });
        continue;
      }
      /* 2ª cobrança: só existe se a 1ª já saiu e a mensalidade CONTINUA sem
         pagar até aqui — chegar a este ponto do loop já garante "pendente". */
      if (inv.avisoAtrasoAt && !inv.avisoAtraso2At && dias >= AVISO_ATRASO_2) {
        const saiu = await avisoComPix(client, inv, textoMensalidadeEmAtraso({
          nome: client.name, mes, dias, valor: moedaBR(total),
        }), {
          name: "cobranca_mensalidade",
          kind: "cobranca_mensalidade_2",
          body: [primeiroNome(client.name), mes, String(dias), reaisBR(total)],
        });
        if (saiu) await prisma.invoice.update({ where: { id: inv.id }, data: { avisoAtraso2At: hoje } });
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
// Lembrete de véspera desativado para economizar custos de templates pagos do WhatsApp.
// const dispararLembretes = () => rodadaLembretesDeAula().catch((e) => {
//   ultimoDiaLembretes = null;
//   console.warn("[lembrete aula]", e.message);
// });
// setInterval(dispararLembretes, 60 * 60 * 1000);
// setTimeout(dispararLembretes, 75_000);

const dispararAvisos = () => rodadaAvisosMensalidade().catch((e) => {
  ultimoDiaAvisos = null; // falhou: a próxima hora tenta de novo
  console.warn("[mensalidade wa]", e.message);
});
setInterval(dispararAvisos, 60 * 60 * 1000);
setTimeout(dispararAvisos, 45_000);

/* ---------- MENSAGEM AUTOMÁTICA DE ANIVERSÁRIO ----------
   Disparada uma vez por dia, dentro da janela permitida (8h às 20h),
   para alunas ativas que fazem aniversário na data de hoje.
   Grava `aniversarioMsgAt` com a data do envio para nunca reenviar no mesmo ano. */
let ultimoDiaAniversarios = null;
async function rodadaAniversariantes() {
  if (!SETTINGS.waAvisosAuto) return;
  if (!waConfigured() || !podeMandarAgora()) return;
  const hoje = todayISO();
  if (ultimoDiaAniversarios === hoje) return;
  ultimoDiaAniversarios = hoje;

  const mmddHoje = hoje.slice(5); // "MM-DD"
  const anoHoje = hoje.slice(0, 4);

  const clients = await prisma.client.findMany({
    where: {
      status: { not: "cancelado" },
      birthday: { not: null },
      phone: { not: null },
    },
  });

  const aniversariantesHoje = clients.filter((c) => {
    if (!c.birthday || !c.phone) return false;
    const bmmdd = c.birthday.slice(5);
    if (bmmdd !== mmddHoje) return false;
    // se já enviou mensagem este ano, não repete
    if (c.aniversarioMsgAt && c.aniversarioMsgAt.startsWith(anoHoje)) return false;
    return true;
  });

  for (const c of aniversariantesHoje) {
    try {
      /* Parabéns é a mensagem MAIS provável de pegar a janela fechada: não há
         nenhuma transação por trás, é a escola falando do nada. Por isso o
         template `aniversario` foi submetido como MARKETING, e não UTILITY —
         felicitação não é transacional, e classificar errado é pedir recusa. */
      if (await janelaAbertaPara(c.phone)) {
        await waSend(c.phone, textoAniversario({ nome: c.name }), { kind: "aniversario" });
      } else {
        const r = await sendWaTemplate(c.phone, "aniversario", {
          body: [primeiroNome(c.name) || "aluna"],
        });
        await registrarWaEnvio(r, { phone: c.phone, kind: "aniversario" });
      }
      await prisma.client.update({
        where: { id: c.id },
        data: { aniversarioMsgAt: hoje },
      });
      console.log(`[aniversário wa] Mensagem de parabéns enviada para ${c.name} (${c.phone}).`);
    } catch (e) {
      console.warn(`[aniversário wa] Falha ao enviar para ${c.name}: ${e.message}`);
    }
  }
  if (aniversariantesHoje.length) {
    console.log(`[aniversário wa] ${aniversariantesHoje.length} mensagem(ns) de aniversário enviadas hoje.`);
  }
}

const dispararAniversarios = () => rodadaAniversariantes().catch((e) => {
  ultimoDiaAniversarios = null;
  console.warn("[aniversario wa]", e.message);
});
setInterval(dispararAniversarios, 60 * 60 * 1000);
setTimeout(dispararAniversarios, 60_000);


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
  const pode = clientPodeAcessarPortal(client);
  if (!pode.ok) return res.status(403).json({ error: pode.motivo, leadPendente: pode.leadPendente || false });
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
    // Feriado: a escola não abre, então o dia não é oferecido para marcar.
    .filter((s) => !feriadoNoDia(s.date, s.unit))
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
    ? janelaEscala(ativasFuturas, t, { weeklyFreq: client.weeklyFreq, alvoDate: t, todasAulas: bookings })
    : { aberta: true, proxima: null, motivo: "" };
  const tetoEscala = tipo === "escala"
    ? tetoMensalEscala(client, t, bookings)
    : null;
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
      tetoEscala,                            // { competencia, limite, marcadas, restantes, atingido }
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
      // 3x/4x não são oferecidos no portal, mas a aluna já matriculada neles
      // pelo painel precisa ver o valor do plano dela ao montar a grade
      valorPlano3x: SETTINGS.valorPlano3x,
      valorPlano4x: SETTINGS.valorPlano4x,
      valorAvulsa: SETTINGS.valorAvulsa,
      duracaoAulaMin: SETTINGS.duracaoAulaMin,
      // taxa somada ao 1º pagamento da aluna nova (0 = desligada)
      taxaMatricula: SETTINGS.taxaMatricula,
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

/* Consulta e confirma (se de fato pago no Sicredi) a reserva de aula de uma aluna.
   Nunca dá baixa manual: pergunta ao Sicredi se o Pix foi pago. */
app.post("/api/portal/:key/booking/:id/check-pay", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const id = Number(req.params.id);
  const booking = Number.isInteger(id) ? await prisma.booking.findUnique({ where: { id } }) : null;
  if (!booking || booking.clientName !== client.name) {
    return res.status(404).json({ error: "Marcação não encontrada." });
  }
  if (booking.paid) return res.json({ ok: true, pago: true, booking });

  const txid = booking.txid || txidBooking(booking.id);
  if (!sicrediConfigured() || !txid) {
    return res.status(400).json({
      ok: false,
      pago: false,
      error: "A confirmação automática via Pix não está disponível para esta reserva. Envie o comprovante no WhatsApp da escola. 💚",
    });
  }

  let confirmado = false;
  try {
    confirmado = await confirmarPagamentoPorTxid(txid);
  } catch (e) {
    console.warn(`[portal check-pay] consulta ao Sicredi falhou para booking ${id}: ${e.message}`);
  }

  if (!confirmado) {
    return res.status(400).json({
      ok: false,
      pago: false,
      error: "Pagamento Pix ainda não identificado pelo banco. Se você acabou de pagar, aguarde alguns instantes e tente novamente. 💚",
    });
  }

  const updated = await prisma.booking.findUnique({ where: { id } });
  return res.json({ ok: true, pago: true, booking: updated });
}));

/* Consulta e confirma (se de fato pago no Sicredi) a mensalidade de uma aluna.
   Nunca dá baixa manual: pergunta ao Sicredi se o Pix foi pago. */
app.post("/api/portal/:key/invoice/:id/check-pay", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const id = Number(req.params.id);
  const inv = Number.isInteger(id) ? await prisma.invoice.findUnique({ where: { id } }) : null;
  if (!inv || inv.clientId !== client.id) {
    return res.status(404).json({ error: "Mensalidade não encontrada." });
  }
  if (inv.status === "pago") return res.json({ ok: true, pago: true, invoice: comEncargos(inv) });

  if (!inv.txid) {
    return res.status(400).json({
      ok: false,
      pago: false,
      error: "Esta mensalidade não possui código Pix emitido. Gere o Pix antes de verificar. 💚",
    });
  }

  if (!sicrediConfigured()) {
    return res.status(400).json({
      ok: false,
      pago: false,
      error: "A confirmação automática via Pix não está disponível no momento. Envie o comprovante no WhatsApp da escola. 💚",
    });
  }

  let confirmado = false;
  try {
    confirmado = await confirmarPagamentoPorTxid(inv.txid);
  } catch (e) {
    console.warn(`[portal check-pay] consulta ao Sicredi falhou para invoice ${id}: ${e.message}`);
  }

  if (!confirmado) {
    return res.status(400).json({
      ok: false,
      pago: false,
      error: "Pagamento Pix ainda não identificado pelo banco. Se você acabou de pagar, aguarde alguns instantes e tente novamente. 💚",
    });
  }

  const updated = await prisma.invoice.findUnique({ where: { id } });
  return res.json({ ok: true, pago: true, invoice: comEncargos(updated) });
}));

// O que a tela precisa saber do passe (sem expor o resto da linha)
const resumoPasse = (p) => ({
  id: p.id,
  status: p.status,           // pendente | pago | usado | cancelado
  valor: p.amountCents / 100,
  pixCode: p.status === "pendente" ? p.pixCode : null,
  paidAt: p.paidAt || null,
});

// Converter em mensalista pelo portal (usado no tablet da sala)
app.post("/api/portal/:key/enroll", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const pode = clientPodeAcessarPortal(client);
  if (!pode.ok) return res.status(403).json({ error: pode.motivo });
  try { res.json(await converterEmMensalista(client, { ...(req.body || {}), exigirGrade: true })); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
}));

// Marcar aula. { reposicao: true } consome crédito; { extra: true } é aula
// avulsa paga (não mexe no saldo de reposição — são coisas separadas).
app.post("/api/portal/:key/book", wrap(async (req, res) => {
  const client = await clientByPortalKey(req.params.key);
  if (!client) return res.status(404).json({ error: "Aluno não encontrado." });
  const pode = clientPodeAcessarPortal(client);
  if (!pode.ok) return res.status(403).json({ error: pode.motivo });
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
  if (client.plan === "mensalista" && client.mensalistaTipo !== "escala")
    return res.status(403).json({
      error: "Sua grade regular já é reservada automaticamente por 12 meses. Para alterar uma data, cancele aquela aula e use a reposição individual. 💚",
    });
  const slot = await prisma.slot.findUnique({ where: { id: Number(req.body.slotId) } });
  if (!slot) return res.status(404).json({ error: "Horário não encontrado." });
  const dup = await prisma.booking.findFirst({ where: { slotId: slot.id, clientName: client.name, status: { not: "cancelada" } } });
  if (dup) return res.status(400).json({ error: "Você já tem essa aula marcada." });
  if ((await occupancy(slot.id)) >= (slot.capacity || 1)) return res.status(400).json({ error: "Turma lotada." });
  // Na escala, a janela de marcação continua valendo. A reserva criada aqui é
  // somente desta ocorrência e nunca entra em replicação.
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
   - Para agendar a PRIMEIRA aula, a aluna escolhe o plano e paga a 1ª
     MENSALIDADE cheia. É esse pagamento que garante a vaga.
   - Pagou → está matriculada (status "convertida"), o mês corrente já sai
     quitado e a próxima mensalidade cai no mês seguinte, no mesmo dia.
   - Fez e não gostou → a mensalidade é devolvida por inteiro (status
     "devolvida") e a matrícula é desfeita. */

/* Cria a grade regular da aluna por 12 meses. Cada horário escolhido vira um
   padrão semanal independente. Feriado fechado é pulado e não gera Booking;
   reposição, cancelamento e extra continuam fora desta série. */
async function criarGradeInicial12Meses(client, slotsBase) {
  if (!podeReplicarMensalista(client)) {
    console.warn(`[grade] ${client?.name} é mensalista de escala ou não-mensalista — grade recorrente não se aplica.`);
    return { criadas: [], slotsCriados: [], feriados: [], pulos: [], total: 0 };
  }
  const criadas = [], slotsCriados = [], feriados = [], pulos = [];
  for (const base of slotsBase) {
    let slotSeriesId = base.seriesId;
    if (!slotSeriesId) {
      slotSeriesId = crypto.randomUUID();
      await prisma.slot.update({ where: { id: base.id }, data: { seriesId: slotSeriesId } });
    }
    const bookingSeriesId = crypto.randomUUID();
    const fim = addMonthsISO(base.date, 12); // exclusivo: exatamente 12 meses
    for (let date = base.date; date < fim; date = addDays(date, 7)) {
      const nomeFeriado = feriadoNoDia(date, base.unit);
      if (nomeFeriado) {
        feriados.push({ date, unit: base.unit, nome: nomeFeriado });
        continue;
      }
      const doDia = await prisma.slot.findMany({ where: { date, unit: base.unit } });
      let alvo = doDia.find((s) => hhmm(s.time) === hhmm(base.time));
      if (!alvo) {
        const choque = doDia.find((s) => haChoque(hhmm(s.time), hhmm(base.time)));
        if (choque) {
          pulos.push({ date, unit: base.unit, motivo: `conflito com ${hhmm(choque.time)}` });
          continue;
        }
        alvo = await prisma.slot.create({
          data: {
            date,
            time: hhmm(base.time),
            unit: base.unit,
            prof: base.prof || null,
            capacity: base.capacity || SETTINGS.capacidadePadrao,
            seriesId: slotSeriesId,
          },
        });
        slotsCriados.push(alvo);
      }
      const sit = await situacaoNaTurma(alvo.id, client.name);
      if (sit?.tipo === "ativa") continue;
      /* Remontar a grade (troca de plano, novo horário) não pode ressuscitar as
         datas que a aluna já tinha liberado nesta mesma turma. */
      if (sit?.tipo === "liberada") {
        pulos.push({ date, unit: base.unit, motivo: sit.motivo });
        continue;
      }
      if ((await occupancy(alvo.id)) >= (alvo.capacity || 1)) {
        pulos.push({ date, unit: base.unit, motivo: "turma lotada" });
        continue;
      }
      criadas.push(await prisma.booking.create({
        data: {
          clientName: client.name,
          phone: client.phone || "",
          unit: alvo.unit,
          date: alvo.date,
          time: alvo.time,
          prof: alvo.prof || profFor(alvo.unit),
          slotId: alvo.id,
          seriesId: bookingSeriesId,
          status: "confirmada",
          value: 0,
          paid: false,
          paymentMethod: PGTO_PLANO,
        },
      }));
    }
  }
  return {
    booking: criadas[0] || null,
    bookings: criadas,
    total: criadas.length,
    slotsCriados: slotsCriados.length,
    feriados,
    pulos,
    meses: 12,
  };
}

// Converte a aluna em mensalista: define o plano, registra/gera as mensalidades
// e, quando ela escolhe a grade, replica os padrões por 12 meses. Lança { code }.
// `mensalidadePaga` chega quando o pagamento da matrícula JÁ é a mensalidade
// do mês corrente — é o caminho da tela pública da aluna nova.
async function converterEmMensalista(client, { weeklyFreq, slotId, slotIds, billingDay, mensalistaTipo, mensalidadePaga, exigirGrade = false, monthlyValue }) {
  const jaMensalista = client.plan === "mensalista" && !!client.weeklyFreq;
  const freq = freqDoPlano(jaMensalista ? client.weeklyFreq : weeklyFreq);
  const tipo = mensalistaTipo === "escala" ? "escala" : "fixo";
  const tipoEfetivo = jaMensalista ? (client.mensalistaTipo === "escala" ? "escala" : "fixo") : tipo;
  const erroEscala = erroEscalaSoAte2x(freq, tipoEfetivo);
  if (erroEscala) throw erroEscala;
  const jaTemGrade = jaMensalista ? await prisma.booking.count({
    where: { clientName: client.name, date: { gte: todayISO() }, status: { not: "cancelada" }, paymentMethod: PGTO_PLANO },
  }) > 0 : false;
  if (jaMensalista && jaTemGrade) {
    throw Object.assign(new Error("Esta aluna já é mensalista. Para alterar o plano dela, use a troca de plano."), { code: 409 });
  }

  const ids = Array.isArray(slotIds) && slotIds.length
    ? slotIds.map(Number).filter(Boolean)
    : slotId ? [Number(slotId)] : [];

  // Se for fixo e não passou horários suficientes, tenta reaproveitar marcações futuras já existentes dela
  // APENAS se for aluna nova na 1ª aula e a aula for futura (não tenta replicar aulas passadas de alunas antigas)
  if (tipoEfetivo === "fixo" && ids.length < freq && client.firstClass) {
    const bookings = await prisma.booking.findMany({
      where: { clientName: client.name, status: { not: "cancelada" }, date: { gte: todayISO() } },
      orderBy: { date: "asc" },
      take: freq,
    });
    for (const b of bookings) {
      if (b.slotId && !ids.includes(b.slotId)) ids.push(b.slotId);
    }
  }

  if (tipoEfetivo === "escala" && ids.length)
    throw Object.assign(new Error("Mensalista de escala não pode receber horários replicados. Marque cada aula individualmente."), { code: 400 });
  if (tipoEfetivo === "fixo" && exigirGrade && ids.length !== freq)
    throw Object.assign(new Error(`Escolha ${freq} horário${freq > 1 ? "s" : ""} semanal${freq > 1 ? "is" : ""} para montar a grade de 12 meses.`), { code: 400 });
  const slotsBase = ids.length ? await prisma.slot.findMany({ where: { id: { in: ids } } }) : [];
  if (slotsBase.length !== ids.length) throw Object.assign(new Error("Um dos horários escolhidos não existe mais."), { code: 404 });
  const padroes = new Set(slotsBase.map((s) => `${s.unit}|${new Date(s.date + "T00:00Z").getUTCDay()}|${hhmm(s.time)}`));
  if (padroes.size !== slotsBase.length)
    throw Object.assign(new Error("Escolha dias ou horários semanais diferentes para a grade."), { code: 400 });
  /* Dois horários no MESMO dia da semana que se sobrepõem (09:00 e 10:00, com
     aula de 2h) viram 12 meses de aulas encavaladas. Com 3x e 4x (23/09/2026)
     escolher dois no mesmo dia ficou comum — manhã e tarde vale, sobreposto não. */
  const diaDaSemana = (s) => new Date(s.date + "T00:00Z").getUTCDay();
  for (let i = 0; i < slotsBase.length; i++) {
    for (let j = i + 1; j < slotsBase.length; j++) {
      const a = slotsBase[i], b = slotsBase[j];
      if (a.unit === b.unit && diaDaSemana(a) === diaDaSemana(b) && haChoque(hhmm(a.time), hhmm(b.time)))
        throw Object.assign(new Error(`Os horários ${hhmm(a.time)} e ${hhmm(b.time)} caem no mesmo dia da semana e se sobrepõem. Escolha horários que não se cruzem.`), { code: 400 });
    }
  }
  for (const slot of slotsBase) {
    if (slot.date < todayISO()) throw Object.assign(new Error("Escolha somente aulas futuras."), { code: 400 });
    if (feriadoNoDia(slot.date, slot.unit)) throw Object.assign(new Error(recusaFeriado(feriadoNoDia(slot.date, slot.unit), slot.date)), { code: 409 });
    if ((await occupancy(slot.id)) >= (slot.capacity || 1)) {
      const sit = await situacaoNaTurma(slot.id, client.name);
      if (sit?.tipo !== "ativa") {
        throw Object.assign(new Error(`A turma de ${slot.date} às ${slot.time} acabou de lotar.`), { code: 409 });
      }
    }
  }
  const grade = tipoEfetivo === "fixo" && slotsBase.length
    ? await criarGradeInicial12Meses({ ...client, plan: "mensalista", mensalistaTipo: tipoEfetivo }, slotsBase)
    : {
        booking: null, bookings: [], total: 0, slotsCriados: 0, feriados: [], pulos: [], meses: 0, individual: tipoEfetivo === "escala",
      };
  const booking = grade.booking;

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
      mensalistaTipo: tipoEfetivo,
      firstClass: false, // deixou de ser aluna nova
      monthlyValue: monthlyValue !== undefined
        ? (monthlyValue === "" || monthlyValue == null ? null : Number(monthlyValue))
        : client.monthlyValue,
      billingDay: dia,
      ...(virouMatricula ? { matriculaStatus: "convertida" } : {}),
    },
  });

  /* O mês da matrícula JÁ ESTÁ PAGO quando ela pagou pela tela de matrícula:
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
    grade,
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
async function trocarPlanoMensalista(client, { weeklyFreq, mensalistaTipo, billingDay, monthlyValue }) {
  const freqAntiga = Number(client.weeklyFreq) || 1;
  const freqNova = freqDoPlano(weeklyFreq);
  const tipoAntigo = client.mensalistaTipo === "escala" ? "escala" : "fixo";
  const tipoNovo = mensalistaTipo === undefined
    ? tipoAntigo
    : (mensalistaTipo === "escala" ? "escala" : "fixo");
  const erroEscala = erroEscalaSoAte2x(freqNova, tipoNovo);
  if (erroEscala) throw erroEscala;

  const compAtual = competenciaAtual();
  const desde = somarComp(compAtual, 1);
  const mudouFreq = freqNova !== freqAntiga;

  /* Valor individual manda sobre o plano, então trocar de 1x para 2x não muda o
     que ela paga — e não há mês corrente a proteger. A tela precisa dizer isso,
     senão a Inêz troca o plano esperando um reajuste que não vem. */
  const novoValorIndividual = monthlyValue !== undefined
    ? (monthlyValue === "" || monthlyValue == null ? null : Number(monthlyValue))
    : client.monthlyValue;
  const temValorIndividual = novoValorIndividual != null;
  let fixouMesCorrente = null;
  if (mudouFreq && !temValorIndividual) {
    /* O mês corrente já tem valor combinado? Ele manda. Pode ser uma troca
       anterior neste mesmo mês (4x→2x e depois 2x→3x: o mês continua no preço
       de 4x, que era o plano de quando ele começou) ou um desconto que a Inêz
       combinou. Sobrescrever com o preço do plano "antigo" apagaria os dois. */
    const jaCombinado = await prisma.monthlyPrice.findUnique({
      where: { clientId_competencia: { clientId: client.id, competencia: compAtual } },
    });
    const valorAntigo = valorDoPlano(freqAntiga) || 0;
    if (jaCombinado) {
      fixouMesCorrente = jaCombinado.amountCents / 100;
    } else if (valorAntigo > 0) {
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
      ...(monthlyValue !== undefined ? { monthlyValue: novoValorIndividual } : {}),
      /* Segunda troca no mesmo mês: o "de antes" continua sendo o plano com que
         o mês começou, não o intermediário que durou alguns dias. */
      ...(mudouFreq ? {
        weeklyFreqAnterior: client.weeklyFreqDesde === desde && client.weeklyFreqAnterior ? client.weeklyFreqAnterior : freqAntiga,
        weeklyFreqDesde: desde,
      } : {}),
      ...(billingDay != null && billingDay !== ""
        ? { billingDay: Math.min(28, Math.max(1, parseInt(billingDay, 10) || 1)) }
        : {}),
    },
  });

  if (tipoNovo === "escala" && tipoAntigo !== "escala") {
    await limparGradeRecorrenteAoVirarEscala(atualizado);
  }

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
      valorIndividual: novoValorIndividual,
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

/* Devolução da 1ª MENSALIDADE — a aluna se matriculou e não quis
   continuar. Como ela já sai matriculada ao pagar, devolver também precisa
   DESFAZER a matrícula: senão ela ficaria com mensalidade e aulas de um plano
   que nunca começou.

   A TAXA DE MATRÍCULA NÃO VOLTA (Vitor, 01/09/2026): volta a mensalidade, fica
   a taxa. Por isso a resposta diz quanto devolver e quanto reter, em vez de
   deixar a conta para a Inêz fazer de cabeça na frente da aluna.

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

  /* Quanto devolver: a mensalidade que estava dentro daquele pagamento. Lê a
     taxa GRAVADA na reserva, então uma aluna que se matriculou quando a taxa era
     outra (ou não existia) recebe de volta o que é dela, não o que a tabela de
     hoje diria. */
  const reservaMatricula = await prisma.booking.findFirst({
    where: { clientName: client.name, paymentMethod: { in: MARCAS_MATRICULA }, paid: true },
    orderBy: { paymentDate: "desc" },
  });
  desfez.pago = Number(reservaMatricula?.value || 0);
  desfez.taxaRetida = Number(reservaMatricula?.taxaMatricula || 0);
  desfez.devolver = reservaMatricula ? mensalidadeDaReserva(reservaMatricula) : 0;

  // Aulas futuras do plano somem — a aula de matrícula (já realizada) fica no histórico.
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

/* Reposições duplicadas: lista (GET) e limpa (POST) as aulas de reposição
   futuras que nenhum crédito reivindica — ver varrerReposicoesOrfas. É a
   ferramenta para arrumar o que uma replicação antiga tenha espalhado pelas
   semanas: o GET mostra antes de mexer, o POST cancela (não apaga, para o
   histórico continuar contando a verdade). */
app.get("/api/makeup/duplicadas", wrap(async (req, res) => {
  const { orfas } = await varrerReposicoesOrfas();
  res.json({ total: orfas.length, aulas: orfas });
}));

app.post("/api/makeup/duplicadas/limpar", wrap(async (req, res) => {
  const { orfas, removidas } = await varrerReposicoesOrfas({ corrigir: true });
  res.json({ total: orfas.length, removidas });
}));

/* Créditos revogados pela volta da aula: lista (GET) e apaga (POST). Mesma
   dupla da rota acima, e pelo mesmo motivo — a Inêz vê a lista antes de mexer,
   porque são créditos que algumas alunas já viram no portal delas. */
app.get("/api/makeup/aula-de-volta", wrap(async (_req, res) => {
  const { creditos } = await varrerCreditosRessuscitados();
  res.json({ total: creditos.length, creditos });
}));

app.post("/api/makeup/aula-de-volta/limpar", wrap(async (_req, res) => {
  const { creditos, removidos } = await varrerCreditosRessuscitados({ corrigir: true });
  res.json({ total: creditos.length, removidos });
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
  const dates = Array.isArray(req.body?.dates) ? req.body.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  if (!unit || !time || !dates.length) return res.status(400).json({ error: "Informe unidade, horário e ao menos uma data." });

  const alvos = [...new Set(dates)].sort();

  // Marcação replicada: as aulas criadas na mesma leva ganham um seriesId em
  // comum, para a exclusão poder oferecer "excluir também as demais".
  const seriesId = new Set(dates).size > 1 ? crypto.randomUUID() : null;
  const agendadas = [], pulos = { semTurma: 0, cheia: 0, jaAgendado: 0, feriado: 0, liberada: 0 };
  for (const date of alvos) {
    // Feriado fechado: não cria aula e, portanto, não conta como aula do plano.
    if (feriadoNoDia(date, unit)) { pulos.feriado++; continue; }
    const slot = await prisma.slot.findFirst({ where: { date, time, unit } });
    if (!slot) { pulos.semTurma++; continue; }
    // já agendado nesta turma? (ou liberado de propósito — o lote não remarca)
    const sit = await situacaoNaTurma(slot.id, client.name);
    if (sit?.tipo === "ativa") { pulos.jaAgendado++; continue; }
    if (sit?.tipo === "liberada") { pulos.liberada++; continue; }
    // capacidade
    if ((await occupancy(slot.id)) >= (slot.capacity || 1)) { pulos.cheia++; continue; }
    const b = await prisma.booking.create({
      data: {
        clientName: client.name, phone: client.phone || "", unit, date, time, prof: slot.prof || profFor(unit),
        slotId: slot.id, seriesId, status: "confirmada", value: 0, paid: false, paymentMethod: PGTO_PLANO,
      },
    });
    agendadas.push(b);
  }
  res.json({ agendadas: agendadas.length, pulos });
}));

/* ---------- EXCLUSÃO EM LOTE (mensalista) ----------
   O espelho do batch-book: tira o aluno de várias aulas de uma turma de uma vez.
   Body: { unit, time, dates: ['YYYY-MM-DD', ...], credito? }

   Duas saídas bem diferentes, e é por isso que `credito` é obrigatório na tela:
   · credito=false → a aula é APAGADA (troca de turma, marcação errada). É o
     mesmo efeito do excluir de uma aula só.
   · credito=true  → a aula é LIBERADA como no portal: fica cancelada no
     histórico e gera crédito de reposição onde as regras deixarem (janela de
     antecedência e teto do mês continuam valendo — por isso a resposta diz
     quantos créditos saíram de fato).

   Aula passada nunca é tocada: o histórico da aluna não se reescreve. */
app.post("/api/clients/:id/batch-unbook", wrap(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
  if (!client) return res.status(404).json({ error: "Aluno não encontrado" });
  const { unit, time } = req.body || {};
  const comCredito = !!req.body?.credito;
  const dates = Array.isArray(req.body?.dates) ? req.body.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  if (!unit || !time || !dates.length) return res.status(400).json({ error: "Informe unidade, horário e ao menos uma data." });

  const alvos = await prisma.booking.findMany({
    where: {
      clientName: client.name, unit, time,
      date: { in: [...new Set(dates)], gte: todayISO() },
      status: { not: "cancelada" },
    },
    orderBy: { date: "asc" },
  });

  let removidas = 0, creditos = 0, semCredito = 0;
  for (const b of alvos) {
    if (comCredito) {
      // devolverRepo: quem desmarcou foi a escola, então a aluna não perde o
      // crédito que ela já tinha gasto naquela reposição.
      const r = await liberarAula(client, b, { absenceReason: "Aula desmarcada em lote pela escola" }, { devolverRepo: true });
      r.credito ? creditos++ : semCredito++;
    } else {
      await prisma.booking.delete({ where: { id: b.id } });
      await devolverCredito(b.id);
    }
    removidas++;
  }
  res.json({ removidas, creditos, semCredito });
}));

/* ---------- WHATSAPP (Cloud API) ---------- */
// Verificação do webhook (a Meta chama com GET ao registrar a URL)
app.get("/api/wa/webhook", (req, res) => {
  const challenge = waVerify(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
  if (challenge) return res.status(200).send(challenge);
  res.sendStatus(403);
});

/* ---------- ENTREGA: o que a Meta conta DEPOIS ----------

   A resposta do envio só diz que a chamada foi aceita. Se a mensagem chegou,
   quem conta é este webhook, minutos depois. Até 08/09/2026 esses avisos eram
   descartados aqui sem uma linha de log — foi por isso que 88 cobranças de
   setembro passaram por entregues sem nunca terem saído.

   `sent` → `delivered` → `read` é a escada normal; `failed` traz o código do
   erro (131047 = fora da janela de 24h). */
const ORDEM_ENTREGA = { enviado: 0, entregue: 1, lido: 2, falhou: 3 };
const NOME_ENTREGA = { sent: "enviado", delivered: "entregue", read: "lido", failed: "falhou" };

async function processarStatusWa(statuses) {
  for (const s of statuses) {
    if (!s.wamid) continue;
    const reg = await prisma.waMessage.findUnique({ where: { wamid: s.wamid } });
    if (!reg) continue; // resposta dentro da conversa: não acompanhamos
    const novo = NOME_ENTREGA[s.status] || s.status;
    /* Os avisos chegam fora de ordem e repetidos. "Entregue" não pode voltar
       para "enviado" — mas "falhou" sempre vale, venha quando vier. */
    if (novo !== "falhou" && (ORDEM_ENTREGA[novo] ?? 0) <= (ORDEM_ENTREGA[reg.status] ?? 0)) continue;
    await prisma.waMessage.update({
      where: { wamid: s.wamid },
      data: { status: novo, errorCode: s.errorCode, errorMsg: s.errorMsg },
    });
    if (novo === "falhou") {
      console.warn(`[wa entrega] FALHOU ${reg.kind} para ${reg.phone} — ${s.errorCode || "?"} ${s.errorMsg || ""}`);
      await liberarReenvioDaCobranca(reg);
    } else if (novo === "entregue") {
      console.log(`[wa entrega] ${reg.kind} para ${reg.phone}: entregue.`);
    }
  }
}

/* A cobrança não chegou: apaga a marca de "avisada" na mensalidade para a
   rodada de amanhã tentar de novo. A marca existe para a escola não repetir o
   recado — e repetir um recado que ninguém recebeu não é repetir.

   Para na 3ª tentativa. Número errado não pode virar cobrança diária, e cada
   template é pago; passado esse ponto a falha fica registrada em WaMessage,
   para a escola resolver na mão. */
const MAX_TENTATIVAS_AVISO = 3;
async function liberarReenvioDaCobranca(reg) {
  const campo =
    reg.kind === "lembrete_mensalidade" ? "avisoAVencerAt" :
    // as duas cobranças de atraso usam o mesmo template na Meta
    // (cobranca_mensalidade) mas têm `kind` interno distinto — ver avisoComPix
    reg.kind === "cobranca_mensalidade_1" ? "avisoAtrasoAt" :
    reg.kind === "cobranca_mensalidade_2" ? "avisoAtraso2At" : null;
  if (!campo || !reg.invoiceId) return;
  const tentativas = await prisma.waMessage.count({ where: { invoiceId: reg.invoiceId, kind: reg.kind } });
  if (tentativas >= MAX_TENTATIVAS_AVISO) {
    console.warn(`[wa entrega] mensalidade ${reg.invoiceId}: ${tentativas} tentativas de ${reg.kind} sem entrega — parei de tentar.`);
    return;
  }
  await prisma.invoice.update({ where: { id: reg.invoiceId }, data: { [campo]: null } });
  console.warn(`[wa entrega] mensalidade ${reg.invoiceId}: ${reg.kind} desmarcado para nova tentativa (${tentativas}/${MAX_TENTATIVAS_AVISO}).`);
}

// Recebe mensagens e conduz o fluxo de agendamento.
const waSeen = new Set(); // dedupe simples de message ids (a Meta reenvia)
app.post("/api/wa/webhook", async (req, res) => {
  res.sendStatus(200); // ACK imediato — a Meta exige resposta rápida
  try {
    const sts = parseStatuses(req.body);
    if (sts.length) await processarStatusWa(sts);
    /* A Meta avisa quando aprova, recusa ou pausa um template. Invalidar o
       cache aqui é o que faz a tela do disparo mostrar "aprovado" minutos
       depois da submissão sem ninguém apertar nada. */
    for (const t of parseTemplateStatuses(req.body)) {
      cacheTemplates.em = 0;
      console.log(`[wa templates] a Meta mudou ${t.name} para ${t.status}${t.reason ? ` (${t.reason})` : ""}.`);
    }
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

/* ---------- DISPARO EM MASSA (Inêz escolhe as alunas e manda) ----------

   A mesma regra de tudo que a escola inicia vale aqui, e com mais força: fora
   da janela de 24h só TEMPLATE APROVADO chega. Texto livre com a janela
   fechada volta 200 e some — ver `janelaAbertaPara`. Por isso a tela oferece
   dois modos, e nenhum deles "tenta texto e vê no que dá":

     template → chega para todas (é pago por mensagem);
     texto    → só sai para quem falou com a escola nas últimas 24h; as demais
                são PULADAS e aparecem no resultado como "conversa fechada".

   O envio roda em segundo plano (180 alunas não cabem numa requisição HTTP) e
   cada mensagem fica em WaMessage com kind "disparo...", então a tela mostra a
   entrega de verdade — entregue, lida, falhou — e não só "a Meta aceitou". */

/* Templates das rotinas automáticas: recibo, cobrança e matrícula levam dados
   de UMA aluna e não fazem sentido em massa — ficam fora da lista do disparo.
   O STATUS deles, porém, aparece na tela: se a Meta recusar ou pausar
   `cobranca_mensalidade`, quem descobre é esta tela, e não a escola estranhando
   que ninguém respondeu a cobrança do mês. */
const TEMPLATES_SO_DO_SISTEMA = new Set([
  "lembrete_mensalidade", "cobranca_mensalidade", "cobranca_mensalidade_v2",
  "mensalidade_a_vencer", "mensalidade_em_atraso",
  "pagamento_confirmado", "pagamento_aula_extra", "pagamento_aula_avulsa",
  "aula_extra_confirmada", "aula_avulsa_confirmada",
  "matricula_confirmada", "confirmacao_reserva",
]);

/* ---------- SINCRONIZAÇÃO DOS TEMPLATES COM A META ----------

   A lista de templates não mora aqui: mora na conta do WhatsApp na Meta, que é
   quem cria, aprova, recusa e pausa. Toda vez que a tela do disparo abre ela
   pergunta para lá — inclusive pelos que ainda estão PENDING, que antes eram
   filtrados fora e simplesmente sumiam, sem a escola entender por quê.

   O cache de 5 minutos existe para a tela poder recarregar à vontade sem gastar
   o rate limit da Graph API. Duas coisas furam o cache: o botão "sincronizar
   agora" da tela (?sync=1) e o webhook `message_template_status_update`, que a
   Meta manda no instante em que aprova ou recusa algo.

   Quando a Meta está fora do ar, a lista antiga continua valendo, com a data da
   última sincronização à vista — é melhor um template de dez minutos atrás do
   que uma tela vazia dizendo que a escola não tem template nenhum. */
const TEMPLATES_TTL_MS = 5 * 60_000;
const cacheTemplates = { em: 0, lista: [], erro: null };

async function sincronizarTemplates({ forcar = false } = {}) {
  if (!waTemplatesConfigured()) {
    return { em: 0, lista: [], erro: "WA_WABA_ID/WA_TOKEN não configurados no servidor." };
  }
  const fresco = cacheTemplates.em && !cacheTemplates.erro && Date.now() - cacheTemplates.em < TEMPLATES_TTL_MS;
  if (fresco && !forcar) return cacheTemplates;
  try {
    const r = await listWaTemplates();
    cacheTemplates.lista = r.data || [];
    cacheTemplates.em = Date.now();
    cacheTemplates.erro = null;
    const aprovados = cacheTemplates.lista.filter((t) => t.status === "APPROVED").length;
    console.log(`[wa templates] sincronizados com a Meta: ${cacheTemplates.lista.length} (${aprovados} aprovados).`);
  } catch (e) {
    cacheTemplates.erro = String(e?.body?.error?.message || e.message).slice(0, 300);
    console.warn(`[wa templates] falha ao sincronizar: ${cacheTemplates.erro}`);
  }
  return cacheTemplates;
}

/* Traduz o template da Meta para o que a tela precisa: o texto do corpo, quantas
   variáveis ele pede e em que pé está a aprovação. O disparo só preenche
   variáveis de texto do cabeçalho e do corpo — template com mídia no cabeçalho,
   botão com URL variável ou variável com nome ({{nome}} em vez de {{1}}) aparece
   na lista marcado como não usável, em vez de falhar na hora de mandar.

   `usavel` junta as duas perguntas que a tela faz: a Meta já liberou (APPROVED)
   e o disparo dá conta do formato? Só quem responde sim às duas pode ser
   escolhido; o resto aparece na mesma lista, apagado, com o motivo escrito. */
const MOTIVO_STATUS = {
  PENDING: "aguardando a aprovação da Meta",
  IN_APPEAL: "em recurso na Meta",
  REJECTED: "recusado pela Meta",
  PAUSED: "pausado pela Meta por baixa qualidade",
  DISABLED: "desativado pela Meta",
  PENDING_DELETION: "marcado para exclusão",
};
function descreverTemplateDisparo(t) {
  const comp = (tipo) => (t.components || []).find((c) => c.type === tipo);
  const header = comp("HEADER"), body = comp("BODY"), footer = comp("FOOTER"), botoes = comp("BUTTONS");
  const varsDe = (txt) => [...String(txt || "").matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]);
  const bodyVars = [...new Set(varsDe(body?.text))];
  const headerVars = header?.format === "TEXT" ? [...new Set(varsDe(header.text))] : [];
  const status = t.status || "UNKNOWN";
  let motivo = null;
  if ([...bodyVars, ...headerVars].some((v) => !/^\d+$/.test(v))) motivo = "usa variáveis com nome";
  else if (header && header.format && header.format !== "TEXT") motivo = "tem imagem/arquivo no cabeçalho";
  else if ((botoes?.buttons || []).some((b) => b.type === "URL" && /\{\{/.test(b.url || ""))) motivo = "tem botão com link variável";
  // O status vem antes do formato: "ainda não aprovado" é a resposta mais útil.
  const motivoStatus = status === "APPROVED" ? null : (MOTIVO_STATUS[status] || `status ${status} na Meta`);
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    status,
    motivoRecusa: t.rejected_reason && t.rejected_reason !== "NONE" ? String(t.rejected_reason) : null,
    doSistema: TEMPLATES_SO_DO_SISTEMA.has(t.name),
    header: header?.format === "TEXT" ? header.text : null,
    body: body?.text || "",
    footer: footer?.text || null,
    buttons: (botoes?.buttons || []).map((b) => b.text),
    headerVars: headerVars.length,
    bodyVars: bodyVars.length,
    suportado: !motivo, // o disparo dá conta do formato
    usavel: status === "APPROVED" && !motivo,
    motivo: motivoStatus || motivo,
  };
}

// {nome} = primeiro nome, {nome_completo} = como está na ficha.
function preencherDisparo(txt, cli) {
  const nome = String(cli.name || "").trim();
  return String(txt ?? "")
    .replace(/\{nome_completo\}/gi, nome)
    .replace(/\{nome\}/gi, nome.split(/\s+/)[0] || nome);
}

const PAUSA_ENTRE_ENVIOS_MS = 350;

/* Quem está com a janela de 24h aberta AGORA, e até que horas.

   A janela é contada do lado de cá porque é do lado de cá que ela é conhecida:
   quem abre é a aluna, mandando mensagem, e isso chega pelo webhook e fica em
   WaConversation.lastInboundAt. A Meta não tem endpoint de "essa conversa está
   aberta?" — o que ela faz é aceitar o envio e descartar depois, em silêncio,
   que foi exatamente o buraco de setembro.

   Devolve a hora em que cada janela FECHA, e não um sim/não, para a tela poder
   avisar "fecha em 40 min" — a diferença entre mandar de graça agora e pagar um
   template daqui a pouco. */
async function janelasAbertas() {
  const desde = new Date(Date.now() - 24 * 3600_000);
  const convs = await prisma.waConversation.findMany({
    where: { lastInboundAt: { gte: desde } },
    select: { phone: true, lastInboundAt: true },
  });
  const ultima = new Map(); // chave do telefone → última entrada dela
  for (const c of convs) {
    const k = chaveTelefone(c.phone);
    if (!k || !c.lastInboundAt) continue;
    const t = c.lastInboundAt.getTime();
    if (t > (ultima.get(k) || 0)) ultima.set(k, t);
  }
  const clients = await prisma.client.findMany({ select: { id: true, phone: true } });
  const janelas = [];
  for (const c of clients) {
    const t = ultima.get(chaveTelefone(c.phone));
    if (t) janelas.push({ id: c.id, fechaEm: new Date(t + 24 * 3600_000).toISOString() });
  }
  return janelas;
}

/* Resumo dos últimos disparos: quantas saíram, quantas chegaram e quantas ainda
   estão pendentes de confirmação da Meta. A entrega mora em WaMessage (é lá que
   o webhook escreve), então vem pelo `wamid`. */
async function resumirDisparos(quantos = 6) {
  const ds = await prisma.waDisparo.findMany({
    orderBy: { inicioEm: "desc" },
    take: quantos,
    include: { itens: { select: { situacao: true, wamid: true } } },
  });
  const wamids = ds.flatMap((d) => d.itens.map((i) => i.wamid).filter(Boolean));
  const regs = wamids.length
    ? await prisma.waMessage.findMany({ where: { wamid: { in: wamids } }, select: { wamid: true, status: true } })
    : [];
  const porWamid = new Map(regs.map((r) => [r.wamid, r.status]));
  // sem registro ainda é "enviado": a Meta aceitou, a confirmação vem depois
  const entregaDe = (i) => (i.wamid ? porWamid.get(i.wamid) || "enviado" : null);
  return ds.map((d) => {
    const conta = (f) => d.itens.filter(f).length;
    return {
      id: d.id,
      por: d.por,
      modo: d.modo,
      template: d.template,
      inicioEm: d.inicioEm,
      fimEm: d.fimEm,
      total: d.itens.length,
      enviadas: conta((i) => i.situacao === "enviado"),
      puladas: conta((i) => i.situacao === "pulada"),
      erros: conta((i) => i.situacao === "erro"),
      entregues: conta((i) => ["entregue", "lido"].includes(entregaDe(i))),
      aguardando: conta((i) => i.situacao === "na fila" || entregaDe(i) === "enviado"),
      naoChegaram: conta((i) => i.situacao === "erro" || entregaDe(i) === "falhou"),
    };
  });
}

/* O servidor reiniciou no meio de um disparo: o laço de envio morreu junto com o
   processo. Sem fechar o registro, a tela ficaria para sempre em "já existe um
   disparo em andamento" — e, pior, quem não chegou a receber ficaria
   eternamente "na fila", que é mentira. Vira erro com o motivo escrito, para a
   escola poder selecionar essas alunas e mandar de novo. */
async function fecharDisparosInterrompidos() {
  const abertos = await prisma.waDisparo.findMany({ where: { fimEm: null }, select: { id: true } });
  if (!abertos.length) return;
  const ids = abertos.map((d) => d.id);
  const r = await prisma.waDisparoItem.updateMany({
    where: { disparoId: { in: ids }, situacao: "na fila" },
    data: { situacao: "erro", motivo: "o servidor reiniciou antes de enviar — não recebeu nada" },
  });
  await prisma.waDisparo.updateMany({ where: { id: { in: ids } }, data: { fimEm: new Date() } });
  console.warn(`[wa disparo] ${ids.length} disparo(s) interrompido(s) por reinício — ${r.count} aluna(s) ficaram sem mensagem.`);
}

app.get("/api/wa/disparo/opcoes", wrap(async (req, res) => {
  const cache = await sincronizarTemplates({ forcar: req.query.sync === "1" });
  const todos = cache.lista
    .map(descreverTemplateDisparo)
    .sort((a, b) => Number(b.usavel) - Number(a.usavel) || a.name.localeCompare(b.name));
  const emAndamento = await prisma.waDisparo.findFirst({ where: { fimEm: null }, orderBy: { inicioEm: "desc" }, select: { id: true } });
  res.json({
    waConfigurado: waConfigured(),
    wabaConfigurada: waTemplatesConfigured(),
    // o que dá para disparar — e o que está esperando a Meta, apagado na lista
    templates: todos.filter((t) => !t.doSistema),
    // as automações: não entram no disparo, mas a escola precisa ver se estão de pé
    templatesSistema: todos.filter((t) => t.doSistema).map((t) => ({
      name: t.name, status: t.status, category: t.category, motivoRecusa: t.motivoRecusa,
    })),
    sincronizadoEm: cache.em ? new Date(cache.em).toISOString() : null,
    erroTemplates: cache.erro,
    janelas: await janelasAbertas(),
    agora: new Date().toISOString(),
    horarioBom: podeMandarAgora(),
    emAndamento: emAndamento?.id || null,
    ultimos: await resumirDisparos(),
  });
}));

app.post("/api/wa/disparo", wrap(async (req, res) => {
  if (!waConfigured()) return res.status(400).json({ error: "WhatsApp não configurado no servidor." });
  const aberto = await prisma.waDisparo.findFirst({ where: { fimEm: null }, select: { id: true } });
  if (aberto) return res.status(409).json({ error: "Já existe um disparo em andamento. Espere terminar.", id: aberto.id });

  const { modo, template, texto } = req.body || {};
  const ids = [...new Set((req.body?.clientIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: "Escolha pelo menos uma aluna." });
  if (!["template", "texto"].includes(modo)) return res.status(400).json({ error: "Modo inválido." });

  let tpl = null;
  if (modo === "template") {
    // sincroniza na hora: um template pausado pela Meta há 3 minutos não sai daqui
    const { lista, erro } = await sincronizarTemplates({ forcar: true });
    if (erro && !lista.length) return res.status(502).json({ error: `Não consegui falar com a Meta para conferir o template: ${erro}` });
    const achado = lista.find((t) => t.name === template?.name);
    if (!achado || TEMPLATES_SO_DO_SISTEMA.has(achado.name)) {
      return res.status(400).json({ error: "Template não encontrado na conta do WhatsApp." });
    }
    tpl = descreverTemplateDisparo(achado);
    if (!tpl.usavel) return res.status(400).json({ error: `Este template não pode ser usado no disparo: ${tpl.motivo}.` });
    const hv = template.header || [], bv = template.body || [];
    if (hv.length !== tpl.headerVars || bv.length !== tpl.bodyVars || [...hv, ...bv].some((v) => !String(v || "").trim())) {
      return res.status(400).json({ error: "Preencha todas as variáveis do template." });
    }
    tpl.valoresHeader = hv;
    tpl.valoresBody = bv;
  } else if (!String(texto || "").trim()) {
    return res.status(400).json({ error: "Escreva a mensagem." });
  }

  const clients = await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } });
  if (!clients.length) return res.status(400).json({ error: "Nenhuma das alunas escolhidas existe mais." });
  const id = crypto.randomUUID();
  const por = req.admin?.username || "painel";
  await prisma.waDisparo.create({
    data: {
      id,
      por,
      modo,
      template: tpl ? tpl.name : null,
      texto: modo === "texto" ? String(texto).slice(0, 4000) : null,
      itens: {
        create: clients
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ clientId: c.id, nome: c.name.slice(0, 120), phone: String(c.phone || "").slice(0, 30) })),
      },
    },
  });
  console.log(`[wa disparo] ${id} por ${por}: ${modo}${tpl ? " " + tpl.name : ""} para ${clients.length} aluna(s)`);
  res.json({ id });

  // Daqui em diante a requisição já respondeu: o envio segue sozinho, gravando
  // aluna por aluna — quem acompanha (e quem abrir a tela depois) lê do banco.
  rodarDisparo(id, { modo, texto, tpl }).catch((e) => console.error("[wa disparo]", e));
}));

async function rodarDisparo(id, { modo, texto, tpl }) {
  try {
    const itens = await prisma.waDisparoItem.findMany({ where: { disparoId: id }, orderBy: { id: "asc" } });
    for (const it of itens) {
      const cli = { name: it.nome };
      let dados;
      try {
        if (!chaveTelefone(it.phone)) {
          dados = { situacao: "pulada", motivo: "sem telefone válido" };
        } else if (modo === "texto" && !(await janelaAbertaPara(it.phone))) {
          dados = { situacao: "pulada", motivo: "conversa fechada (só template chega)" };
        } else {
          const r = modo === "texto"
            ? await sendWaText(it.phone, preencherDisparo(texto, cli))
            : await sendWaTemplate(it.phone, tpl.name, {
                lang: tpl.language,
                header: tpl.valoresHeader.map((v) => preencherDisparo(v, cli)),
                body: tpl.valoresBody.map((v) => preencherDisparo(v, cli)),
              });
          const kind = modo === "texto" ? "disparo_texto" : `disparo:${tpl.name}`.slice(0, 40);
          await registrarWaEnvio(r, { phone: it.phone, kind });
          dados = { situacao: "enviado", wamid: r?.messages?.[0]?.id || null };
          await new Promise((ok) => setTimeout(ok, PAUSA_ENTRE_ENVIOS_MS));
        }
      } catch (e) {
        dados = {
          situacao: "erro",
          motivo: String(e?.body?.error?.error_data?.details || e?.body?.error?.message || e.message).slice(0, 200),
        };
        console.warn(`[wa disparo] ${it.nome} (${it.phone}): ${dados.motivo}`);
      }
      await prisma.waDisparoItem.update({ where: { id: it.id }, data: dados });
    }
  } finally {
    await prisma.waDisparo.update({ where: { id }, data: { fimEm: new Date() } }).catch(() => {});
    const r = (await resumirDisparos(3).catch(() => [])).find((d) => d.id === id);
    if (r) console.log(`[wa disparo] ${id} terminou: ${r.enviadas} enviadas, ${r.puladas} puladas, ${r.erros} com erro`);
  }
}

/* Andamento + ENTREGA de verdade.

   `situacao` é o que o servidor fez (mandou, pulou, deu erro) e sai do próprio
   registro do disparo; `entrega` é o que a Meta confirmou depois, e vem de
   WaMessage, que o webhook de status atualiza. "Aceita pela Meta" não é
   "chegou": a tela mostra os dois separados justamente porque confundir um com
   o outro foi o que deixou 88 cobranças invisíveis em setembro. */
app.get("/api/wa/disparo/:id", wrap(async (req, res) => {
  const d = await prisma.waDisparo.findUnique({
    where: { id: req.params.id },
    include: { itens: { orderBy: { id: "asc" } } },
  });
  if (!d) return res.status(404).json({ error: "Disparo não encontrado." });
  const wamids = d.itens.map((i) => i.wamid).filter(Boolean);
  const regs = wamids.length
    ? await prisma.waMessage.findMany({ where: { wamid: { in: wamids } }, select: { wamid: true, status: true, errorCode: true, errorMsg: true } })
    : [];
  const porWamid = new Map(regs.map((r) => [r.wamid, r]));
  res.json({
    id: d.id,
    por: d.por,
    modo: d.modo,
    template: d.template,
    texto: d.texto,
    inicioEm: d.inicioEm,
    fimEm: d.fimEm,
    sincronizadoEm: new Date().toISOString(),
    itens: d.itens.map((i) => {
      const r = i.wamid ? porWamid.get(i.wamid) : null;
      return {
        clientId: i.clientId,
        nome: i.nome,
        phone: i.phone,
        situacao: i.situacao,
        motivo: i.motivo,
        // sem registro ainda é "enviado": a Meta aceitou, a confirmação vem depois
        entrega: i.wamid ? (r?.status || "enviado") : null,
        erroEntrega: r?.errorCode ? `${r.errorCode} ${r.errorMsg || ""}`.trim() : null,
      };
    }),
  });
}));

// Histórico: os últimos disparos, para reabrir o de ontem e ver quem ficou faltando.
app.get("/api/wa/disparos", wrap(async (_req, res) => {
  res.json({ disparos: await resumirDisparos(12) });
}));

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
/* `registro` só é passado quando a mensagem parte da ESCOLA ({ kind, invoiceId }).
   Resposta dentro da conversa não entra em WaMessage: aquilo a Meta entrega
   sempre, e encher a tabela com isso esconderia a falha que interessa.

   Atenção ao ler o log: "[wa] respondido para X" significa que a Meta ACEITOU a
   chamada, não que a aluna recebeu. Quem sabe da entrega é o webhook de status. */
async function waSend(to, text, registro) {
  try {
    const r = await sendWaText(to, text);
    console.log(`[wa] respondido para ${to}`);
    if (registro) await registrarWaEnvio(r, { phone: to, ...registro });
    return r;
  } catch (e) { console.error("[wa send]", e.message, e.body || ""); return null; }
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
/* Horários da unidade, com a lotação de cada turma.

   Duas coisas mudaram aqui em 01/09/2026:

   1. HORÁRIO QUE JÁ PASSOU NÃO APARECE. A lista era filtrada só por data, então
      quem escrevia às 15h continuava vendo a turma das 9h de HOJE — escolhia,
      confirmava, pagava e só depois descobria que a aula tinha sido de manhã.
      Agora o corte de hoje é pelo RELÓGIO (de Brasília, não o do servidor), com
      uma folga de ANTECEDENCIA_MIN para ninguém reservar uma aula que começa em
      dez minutos do outro lado da cidade. Amanhã em diante nada é cortado: a
      regra é sobre a hora do contato, e só vale para o dia de hoje.

   2. A LOTAÇÃO VAI JUNTO. Antes a turma cheia simplesmente sumia da lista, o
      que faz a escola parecer vazia quando é o contrário. Devolvemos todas —
      inclusive as esgotadas, marcadas — para o bot poder dizer quantas alunas
      já há em cada turma e quais estão na última vaga. */
async function waAvailableSlots(unit) {
  const agora = agoraBR();                 // 'YYYY-MM-DDTHH:MM:SS' no fuso da aluna
  const t = agora.slice(0, 10);
  const corte = horaDeCorte(agora.slice(11, 16));

  const [slots, bookings] = await Promise.all([
    prisma.slot.findMany({ where: { unit, date: { gte: t } } }),
    prisma.booking.findMany({ where: { status: { not: "cancelada" }, date: { gte: t } } }),
  ]);
  const occ = {};
  bookings.forEach((b) => { occ[b.slotId] = (occ[b.slotId] || 0) + 1; });

  return slots
    .map((s) => ({ ...s, time: hhmm(s.time) || String(s.time || "").slice(0, 5) }))
    // feriado não é oferecido no WhatsApp: a escola não abre naquele dia
    .filter((s) => !feriadoNoDia(s.date, s.unit))
    .filter((s) => slotAindaDaTempo(s, t, corte))
    .map((s) => {
      const capacidade = s.capacity || 1;
      const alunas = occ[s.id] || 0;
      return { ...s, alunas, capacidade, vagas: Math.max(0, capacidade - alunas), esgotada: alunas >= capacidade };
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// Descrição da linha na lista do WhatsApp (hora + lotação) — ver waFluxo.js
const waDescricaoSlot = (s) => descricaoDaTurma(s);
/* Reserva provisória do WhatsApp: a vaga fica SEGURADA por HOLD_MIN minutos
   enquanto a aluna paga a 1ª mensalidade. Combinado com a Inêz em 30/08/2026 —
   antes disso a conversa reservava sem pagar nada, e conversa abandonada tirava
   a vaga de quem ia pagar.

   O prazo era de 1 HORA até 02/09/2026, quando o Vitor cortou para 10 minutos.
   Pix cai em segundos: o que a hora inteira segurava, na prática, era a vaga
   parada esperando quem já tinha desistido — enquanto a próxima aluna via a
   turma como lotada.

   O prazo curto só é seguro por causa da rede de proteção que já existia, e ela
   não pode ser removida junto com o prazo: quem paga DEPOIS de o prazo estourar
   não perde o dinheiro. `confirmarPagamentoPorTxid` é consultado antes de a
   vaga sair e de novo quando o pagamento chega — se ainda houver lugar na
   turma, a aula volta; se não houver, o pagamento fica registrado e a Inêz
   remarca. Sem isso, 10 minutos seria só um jeito rápido de cobrar de alguém e
   não entregar a vaga.

   A HOLD_AVISO_MIN minutos do fim, o bot dá o último toque e oferece reenviar o
   Pix. Três minutos, não trinta: no prazo de dez, um lembrete cedo demais chega
   colado na mensagem do Pix e vira cobrança.

   Os números e a decisão de "expirar / avisar / esperar" moram em waFluxo.js,
   onde têm teste — a relação entre o prazo, o aviso e o intervalo da varredura
   quebra em silêncio quando um dos três muda sozinho. */

/* Cadastro feito pela conversa do WhatsApp.

   O CPF é a chave: a conversa começa perguntando por ele justamente para não
   criar uma segunda ficha de quem já é da casa (o mesmo nome escrito de dois
   jeitos criava duas alunas, e o histórico ficava partido ao meio). Quem já
   existe é COMPLETADA — os campos vazios da ficha antiga recebem o que ela
   digitou agora, mas nada que já estava preenchido é sobrescrito: a ficha do
   painel foi conferida por gente, a da conversa não.

   `origem: "whatsapp"` é o que faz o painel mostrar "Cadastro via WhatsApp".
   Serve de aviso: esses dados vieram digitados do outro lado, sem revisão. */
async function upsertClienteWa({ nome, phone, cpf, email, birthday, unit }) {
  const name = padronizarNome(nome);
  const cpfDigits = onlyDigits(cpf);
  const existente = cpfDigits ? await prisma.client.findFirst({ where: { cpf: cpfDigits } }) : null;
  if (existente) {
    const patch = {};
    if (phone && !existente.phone) patch.phone = phone;
    if (email && !existente.email) patch.email = email;
    if (birthday && !existente.birthday) patch.birthday = birthday;
    if (unit && !existente.unit) patch.unit = unit;
    if (!existente.origem) patch.origem = "whatsapp";
    if (!Object.keys(patch).length) return existente;
    return prisma.client.update({ where: { id: existente.id }, data: patch });
  }
  // sem etiqueta: "Lead" saiu do sistema (ver VALID_TAGS lá em cima)
  return prisma.client.create({
    data: {
      name, phone: phone || "", email: email || null, cpf: cpfDigits || null,
      unit: unit || UNITS[0], tags: "[]", firstClass: true, origem: "whatsapp",
      status: "lead",
    },
  });
}

/* Cria a reserva da 1ª aula já como pagamento de matrícula: o valor é a 1ª
   MENSALIDADE do plano escolhido (é ela que matricula a aluna — ver
   registrarMatriculaPaga), e o plano fica guardado no cadastro como INTENÇÃO,
   exatamente como faz a tela da matrícula no site.

   A ficha já existe quando chegamos aqui: ela nasceu no passo do cadastro, antes
   da reserva, porque é o CPF DELA que o Sicredi usa para emitir o Pix. */
/* Os demais horários da semana da matrícula (plano 2x a 4x), cada um segurado
   junto com o da 1ª aula. Usado pelo site e pelo WhatsApp — as duas portas de
   matrícula seguram os horários do mesmo jeito.

   Valor 0: o Pix é um só, na reserva da 1ª aula. Quando o pagamento cai,
   registrarMatriculaPaga confirma todos e monta a grade de 12 meses com eles.
   Horário que lotou, virou feriado, é de outra semana ou se sobrepõe a outro
   dela no mesmo dia fica de fora — a cobrança lista só os que entraram, e o
   que faltar vira aviso na ficha quando o pagamento cai. */
async function segurarHorariosExtras({ clientName, phone }, slot, extraSlotIds, freq) {
  const extras = [];
  const extraSlots = [];
  const ids = [...new Set((extraSlotIds || []).map(Number).filter((id) => id && id !== slot.id))].slice(0, Math.max(0, freq - 1));
  for (const id of ids) {
    const s = await prisma.slot.findUnique({ where: { id } });
    if (!s || s.unit !== slot.unit || !mesmaSemana(s.date, slot.date) || feriadoNoDia(s.date, s.unit)) continue;
    if ([slot, ...extraSlots].some((j) => j.date === s.date && haChoque(hhmm(j.time), hhmm(s.time)))) continue;
    if ((await occupancy(s.id)) >= (s.capacity || 1)) continue;
    extras.push(await prisma.booking.create({
      data: {
        clientName,
        phone: phone || "",
        unit: s.unit,
        date: s.date,
        time: s.time,
        prof: s.prof,
        slotId: s.id,
        status: "aguardando",
        value: 0,
        taxaMatricula: null,
        paymentMethod: MARCA_MATRICULA,
        holdUntil: new Date(Date.now() + HOLD_MIN * 60_000),
      },
    }));
    extraSlots.push(s);
  }
  return { extras, extraSlots };
}

async function createWaBooking(client, slot, { weeklyFreq, extraSlotIds = [] }) {
  const isAvulso = weeklyFreq === "avulso";
  // A aluna do WhatsApp entra como FIXO, então os quatro planos valem aqui
  const freq = freqDoPlano(weeklyFreq);
  const booking = await prisma.booking.create({
    data: {
      clientName: client.name, phone: client.phone || "", unit: slot.unit,
      date: slot.date, time: slot.time, prof: slot.prof, slotId: slot.id,
      status: "aguardando",
      // Se avulso, cobra apenas o valor da aula avulsa sem taxa de matrícula
      value: isAvulso ? (Number(SETTINGS.valorAvulsa) || 40) : valorPrimeiroPagamento(freq),
      taxaMatricula: isAvulso ? null : (taxaMatriculaAtual() || null),
      paymentMethod: isAvulso ? "Aula Avulsa" : MARCA_MATRICULA,
      holdUntil: new Date(Date.now() + HOLD_MIN * 60_000),
    },
  });

  const { extras, extraSlots } = isAvulso
    ? { extras: [], extraSlots: [] }
    : await segurarHorariosExtras({ clientName: client.name, phone: client.phone }, slot, extraSlotIds, freq);

  const atualizado = await prisma.client.update({
    where: { id: client.id },
    data: isAvulso ? {
      status: "lead",
      matriculaStatus: "nao_aplica",
      trialDate: slot.date,
      plan: "avulso",
      weeklyFreq: null,
      unit: client.unit || slot.unit,
    } : {
      status: "lead",
      matriculaStatus: "pendente",
      trialDate: slot.date,
      weeklyFreq: freq,
      mensalistaTipo: "fixo",
      unit: client.unit || slot.unit,
    },
  });
  return { booking, extras, extraSlots, client: atualizado };
}

/* Libera a vaga de uma reserva cujo prazo estourou. Não é cancelamento de aula:
   é a reserva que nunca chegou a existir de verdade, porque não foi paga. */
async function expirarReservaWa(booking) {
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "cancelada", holdUntil: null, absenceReason: "Reserva não paga no prazo — vaga liberada" },
  });
  // Cancela também eventuais outras reservas de matrícula aguardando da aluna
  await prisma.booking.updateMany({
    where: {
      clientName: booking.clientName,
      paymentMethod: MARCA_MATRICULA,
      status: "aguardando",
    },
    data: { status: "cancelada", holdUntil: null, absenceReason: "Reserva não paga no prazo — vaga liberada" },
  });
  // Se a reserva expirou sem pagamento concluído, garante status como lead
  const cli = await prisma.client.findFirst({ where: { name: booking.clientName } });
  if (cli && cli.matriculaStatus !== "paga" && cli.matriculaStatus !== "convertida" && cli.plan !== "mensalista") {
    await prisma.client.update({
      where: { id: cli.id },
      data: { status: "lead", firstClass: false },
    });
  }
  await prisma.waConversation.updateMany({
    where: { bookingId: booking.id },
    // A reserva caiu: a conversa volta ao zero inteira (ver CONVERSA_ZERADA).
    // Guardar o cadastro pela metade daqui só serviria para a próxima conversa
    // herdar um horário que já não existe.
    data: { ...CONVERSA_ZERADA },
  });
  if (booking.phone) {
    await waSend(booking.phone, textoHoldExpirado({
      nome: booking.clientName,
      quando: fmtSlotBR({ date: booking.date, time: booking.time }),
    }));
  }
  console.log(`[wa hold] reserva ${booking.id} (${booking.clientName}) expirou — vaga liberada e cliente mantido como lead.`);
}

/* Rodada das reservas seguradas: cutuca quem está a HOLD_AVISO_MIN do fim e
   libera quem passou do prazo. Só olha reserva com holdUntil, então nada do
   painel ou do site entra aqui.

   Roda de MINUTO em minuto. Rodava de 5 em 5 quando o prazo era de uma hora, e
   os dois números andam juntos: num prazo de 10 minutos, uma rodada de 5
   soltaria a vaga com até metade do prazo de atraso e faria o aviso dos 3
   minutos sair ora aos 5, ora nunca. A varredura é uma consulta por minuto num
   índice de holdUntil — barata o bastante para não valer a pena economizar. */
async function rodadaReservasSeguradas() {
  const agora = new Date();
  const pendentes = await prisma.booking.findMany({
    where: { holdUntil: { not: null }, paid: false, status: "aguardando" },
  });
  for (const b of pendentes) {
    // Expirar, avisar ou esperar — a decisão é de acaoDaReserva (waFluxo.js).
    const { acao, faltam } = acaoDaReserva(b, agora.getTime());
    if (acao === "esperar") continue;
    /* ANTES de soltar a vaga, pergunta ao banco se o Pix caiu.

       O webhook do Sicredi é o caminho normal, mas ele é um caminho só: se
       estiver fora do ar por vinte minutos — ou se a notificação simplesmente se
       perder — a reserva expiraria com o dinheiro dentro. A aluna teria pago e
       perdido a vaga, que é o pior que este sistema pode fazer com alguém.

       `confirmarPagamentoPorTxid` consulta o Sicredi com mTLS e, se estiver
       pago, faz a baixa inteira: confirma a reserva, matricula e dispara o
       agradecimento com as regras. Custa uma chamada por reserva prestes a
       expirar — raras, e o cenário que evita é caro demais para economizar. */
    if (acao === "expirar") {
      if (b.txid && (await confirmarPagamentoPorTxid(b.txid).catch(() => false))) {
        console.log(`[wa hold] reserva ${b.id} estava paga — confirmada na consulta ao Sicredi, não expirou.`);
        continue;
      }
      await expirarReservaWa(b);
      continue;
    }
    if (acao === "avisar") {
      // Mesma consulta antes de cutucar: perguntar "ficou alguma dúvida?" para
      // quem já pagou é a mensagem errada na pior hora.
      if (b.txid && (await confirmarPagamentoPorTxid(b.txid).catch(() => false))) continue;
      await prisma.booking.update({ where: { id: b.id }, data: { holdNudged: true } });
      if (b.phone) {
        await waSend(b.phone, textoLembreteHold({ nome: b.clientName, minutos: faltam }));
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

// RODADA_HOLD_MIN vem de waFluxo.js, junto de HOLD_MIN e HOLD_AVISO_MIN: os
// três só fazem sentido juntos, e o teste de lá guarda a relação entre eles.
setInterval(() => rodadaReservasSeguradas().catch((e) => console.warn("[wa hold]", e.message)), RODADA_HOLD_MIN * 60 * 1000);
setTimeout(() => rodadaReservasSeguradas().catch(() => {}), 30_000);
setInterval(() => rodadaConversasParadas().catch((e) => console.warn("[wa parada]", e.message)), 5 * 60 * 1000);
setTimeout(() => rodadaConversasParadas().catch(() => {}), 60_000);

/* ===================== A CONVERSA EXPIRA EM 12 HORAS =====================
   Passadas CONVERSA_EXPIRA_H horas desde a última mensagem DELA, o próximo
   contato começa do zero: sem horário guardado, sem plano escolhido, sem meio
   cadastro de ontem.

   O motivo é o de sempre com bot de agendamento: o horário que ela escolheu de
   manhã pode ter lotado à noite, e retomar do meio faz o sistema confirmar uma
   vaga que não existe mais. Recomeçar custa três toques; confirmar reserva
   fantasma custa a confiança.

   O relógio é `lastInboundAt` (mensagem DELA), não `updatedAt` — este último
   também mexe quando é o bot que escreve, e um lembrete automático reiniciaria
   a contagem sem ela ter dito nada. (CONVERSA_EXPIRA_H e conversaExpirou vivem
   em waFluxo.js, junto do teste que prende o número.) */

/* Tudo o que uma conversa carrega. Recomeçar é apagar este conjunto inteiro —
   listado num lugar só para que um campo novo não fique para trás e vaze de uma
   conversa para a seguinte (foi assim que o nome "Ipatinga" virou reserva). */
const CONVERSA_ZERADA = {
  step: "start", unit: null, slotId: null, offered: "[]",
  pendingName: null, pendingEmail: null, pendingBirthday: null, pendingPhone: null,
  weeklyFreq: null, extraSlots: "[]", cpf: null, clientId: null, bookingId: null,
  humanoPedidos: 0, retomadaAt: null,
};
const NUM_EMOJI = { 1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣" };

/* parseNascimento, emailValido e telefoneBR vêm de waFluxo.js — são regras de
   leitura do que a aluna digita, e estão lá com teste. */

async function handleWaMessage(msg) {
  const phone = normalizePhone(msg.from);
  const body = (msg.text || "").trim();
  const low = body.toLowerCase();
  const rid = msg.replyId || "";
  let conv = await prisma.waConversation.findUnique({ where: { phone } });
  const primeiroContato = !conv;
  if (!conv) conv = await prisma.waConversation.create({ data: { phone } });

  /* ----- 12h de silêncio: a conversa recomeça ----- */
  const silenciosaDesde = conv.lastInboundAt ? Date.now() - new Date(conv.lastInboundAt).getTime() : 0;
  const expirou = conversaExpirou(conv.lastInboundAt);
  if (expirou) {
    console.log(`[wa] conversa de ${phone} expirou (${Math.round(silenciosaDesde / 3600_000)}h em silêncio) — recomeçando.`);
    conv = await prisma.waConversation.update({ where: { phone }, data: { ...CONVERSA_ZERADA } });
  }

  /* Carimba a mensagem DELA e limpa o abandono na mesma escrita.
     `retomadaAt` limpo é o que devolve o direito a um novo lembrete se ela sumir
     de novo mais adiante. */
  conv = await prisma.waConversation.update({
    where: { phone },
    data: { lastInboundAt: new Date(), ...(conv.retomadaAt ? { retomadaAt: null } : {}) },
  });

  const setConv = (data) => prisma.waConversation.update({ where: { phone }, data });
  // quem já é aluna daqui, quando a conversa já sabe o CPF
  const fichaDaConversa = () => (conv.clientId ? prisma.client.findUnique({ where: { id: conv.clientId } }) : null);

  /* ----- telas ----- */

  /* Boas-vindas + menu de unidades. Sai no primeiro contato e depois que a
     conversa expira; nas voltas ao menu durante o papo, só o menu. */
  const telaBoasVindas = async () => {
    await setConv({ ...CONVERSA_ZERADA, step: "unit" });
    await waSend(msg.from, textoBoasVindas({ nome: msg.name || "" }));
    return sendUnitMenu(msg.from, "Vamos começar? Escolha a unidade mais perto de você 👇");
  };

  const telaUnidade = async (prefix = "") => {
    /* Recomeçar limpa tudo o que a conversa carregava — inclusive o plano, o CPF
       e a reserva anterior. A reserva em si continua segurada até o prazo dela;
       quem a solta é a rodada, não o fato de a aluna ter recomeçado o menu. */
    await setConv({ ...CONVERSA_ZERADA, step: "unit" });
    const nome = msg.name ? " " + msg.name.split(" ")[0] : "";
    return sendUnitMenu(msg.from, `${prefix}Olá${nome}! 💚 Vamos agendar sua aula? Escolha a unidade:`);
  };

  /* Lista de horários COM a lotação de cada turma.

     Duas informações que a Inêz pediu e que não existiam aqui:
     • quantas alunas já estão na turma (e quantas cabem);
     • quais estão esgotadas — antes elas simplesmente sumiam da lista, o que
       fazia uma escola cheia parecer uma escola vazia.

     A lista da Meta aceita 10 linhas, e só as turmas COM vaga podem virar
     linha (oferecer uma linha que não dá para escolher é frustração pura). As
     esgotadas viram uma frase acima da lista: mostram movimento sem gastar
     espaço clicável. */
  const telaHorarios = async (unit, prefix = "") => {
    const todos = await waAvailableSlots(unit);
    const livres = todos.filter((s) => !s.esgotada);
    if (!livres.length) {
      await setConv({ step: "unit", pendingName: null });
      const nota = todos.length
        ? `Todas as turmas de *${unit}* daqui para a frente estão com a lotação completa. 😢`
        : `No momento não há horários abertos em *${unit}*. 😢`;
      return sendUnitMenu(msg.from, `${nota} Quer ver a outra unidade?`);
    }

    const top = livres.slice(0, 9); // 9 horários + a linha de voltar = 10 (limite da Meta)
    const rows = top.map((s) => ({
      id: "slot:" + s.id,
      title: fmtSlotDia(s),                 // título para em 24 caracteres
      description: waDescricaoSlot(s),      // hora + lotação, em até 72
    }));
    rows.push({ id: "back:unit", title: "← Trocar unidade", description: "Escolher outra unidade" });
    await setConv({ step: "slot", unit, slotId: null, pendingName: null, offered: JSON.stringify(top.map((s) => s.id)) });

    // Panorama antes da lista: o que está fechando e o que já fechou.
    const quase = top.filter((s) => s.vagas <= 2).length;
    const cheias = todos.filter((s) => s.esgotada);
    const panorama = [
      quase ? `🟠 ${quase} ${quase === 1 ? "turma está" : "turmas estão"} nas últimas vagas` : "",
      cheias.length ? `🔴 ${cheias.length} ${cheias.length === 1 ? "turma já esgotou" : "turmas já esgotaram"} (${cheias.slice(0, 3).map((s) => `${fmtSlotDia(s)} ${hhmm(s.time)}`).join(", ")}${cheias.length > 3 ? "…" : ""})` : "",
    ].filter(Boolean).join("\n");

    const corpo =
      `${prefix}📅 Horários com vaga em *${unit}*:` +
      (panorama ? `\n\n${panorama}` : "") +
      `\n\nToque em *Ver horários* para escolher 👇`;
    return waList(msg.from, corpo, "Ver horários", rows);
  };

  // Nada é reservado sem passar por aqui.
  const telaConfirmarHorario = async (slot) => {
    const alunas = await occupancy(slot.id);
    const capacidade = slot.capacity || 1;
    const lot = lotacaoDaTurma({ alunas, capacidade });
    // A lotação é conferida DE NOVO aqui: entre a lista e o toque no botão pode
    // ter entrado outra aluna, e a lista pode ser de uma mensagem de ontem.
    if (lot.nivel === "esgotada") return telaHorarios(slot.unit, "Essa turma acabou de lotar. 😔 ");
    await setConv({ step: "confirm", unit: slot.unit, slotId: slot.id });
    return waButtons(
      msg.from,
      `Confere pra mim antes de reservar 👇\n\n📍 *${slot.unit}*\n🗓️ ${fmtSlotBR(slot)}\n👭 ${alunas} de ${capacidade} vagas ocupadas${lot.nivel === "ultima" ? " — *última vaga!*" : ""}\n\nEstá correto?`,
      [{ id: "ok:slot", title: "✅ Confirmar" }, { id: "back:slot", title: "🔄 Outro horário" }, { id: "back:unit", title: "← Trocar unidade" }]
    );
  };

  /* O CPF É A PORTA DO CADASTRO.

     Ele vem logo depois do horário e antes de qualquer outra pergunta, por um
     motivo prático: é com ele que eu descubro se ela já é da casa. Quem já tem
     ficha não digita nome, e-mail e nascimento de novo — e, principalmente, não
     ganha uma SEGUNDA ficha com o nome escrito diferente, que era o que partia
     o histórico da aluna em duas.

     O mesmo CPF depois vai para o Sicredi: a cobrança Pix sai no nome de quem
     de fato vai pagar. */
  const telaCpf = async (prefix = "") => {
    await setConv({ step: "cpf" });
    return waSend(msg.from,
      `${prefix}Agora me manda o seu *CPF* (só os números) 💚\n\n` +
      `É com ele que eu vejo se você já tem cadastro na escola e é o que o banco pede para emitir o Pix no seu nome.`);
  };

  const telaNome = async (prefix = "") => {
    await setConv({ step: "name", pendingName: null });
    return waButtons(msg.from,
      `${prefix}Não encontrei cadastro com esse CPF, então vou te cadastrar agora — leva menos de um minuto. 🧶\n\n` +
      `Me diz seu *nome completo*:`,
      [{ id: "back:slot", title: "← Voltar" }]);
  };

  /* O nome digitado no WhatsApp já entra padronizado ("MARIA DA SILVA" vira
     "Maria da Silva") — e a aluna confirma exatamente como vai ficar gravado. */
  const telaConfirmarNome = async (nomeDigitado) => {
    const name = padronizarNome(nomeDigitado);
    await setConv({ step: "nameok", pendingName: name });
    return waButtons(msg.from, `Confirma o nome do cadastro?\n\n👤 *${name}*`, [
      { id: "ok:name", title: "✅ Está certo" },
      { id: "edit:name", title: "✏️ Corrigir nome" },
    ]);
  };

  /* WhatsApp de contato. Perguntar o número de alguém que está falando comigo
     POR ele soa bobo, então a pergunta já vem respondida: é só confirmar. O
     campo existe porque nem sempre o telefone do chat é o de contato — mãe
     agendando pela filha, celular emprestado, número de trabalho. */
  const telaWpp = async (prefix = "") => {
    await setConv({ step: "wpp" });
    return waButtons(msg.from,
      `${prefix}Este WhatsApp aqui — *${telefoneBR(phone)}* — é o seu número de contato?`,
      [{ id: "wpp:ok", title: "✅ É este mesmo" }, { id: "wpp:outro", title: "✏️ É outro número" }]);
  };

  const telaEmail = async (prefix = "") => {
    await setConv({ step: "email" });
    return waButtons(msg.from, `${prefix}Qual o seu *e-mail*? 💚`, [{ id: "email:pular", title: "Não tenho e-mail" }]);
  };

  const telaNasc = async (prefix = "") => {
    await setConv({ step: "nasc" });
    return waSend(msg.from,
      `${prefix}Por último: sua *data de nascimento*, no formato DD/MM/AAAA. 🎂\n\n` +
      `(É para a gente lembrar do seu aniversário — a escola manda parabéns.)`);
  };

  /* Escolher o plano é o que define o VALOR da 1ª mensalidade — e é ela que
     matricula a aluna. Os valores são os cadastrados no painel (Configurações →
     Planos), nunca números escritos aqui: o dia em que a Inêz mudar o preço,
     esta mensagem muda junto, sozinha.

     A taxa de matrícula é dita AQUI, antes de ela escolher, e não lá na hora do
     Pix. Valor que aparece só na tela do pagamento é o jeito mais rápido de
     alguém desistir sentindo que foi enganada — e ela teria razão. Pelo mesmo
     motivo o texto já avisa que a taxa não volta se ela desistir. */
  const telaPlano = async (nome, prefix = "") => {
    // Voltar ao plano zera os horários extras: o número deles depende do plano
    await setConv({ step: "plano", extraSlots: "[]", ...(nome ? { pendingName: padronizarNome(nome) } : {}) });
    const primeiro = String(nome || "").split(" ")[0];
    const taxa = taxaMatriculaAtual();
    const vAvulsa = Number(SETTINGS.valorAvulsa) || 40;
    const linhaPlano = (f) => taxa
      ? `*${f}x por semana* — ${moedaBR(valorDoPlano(f))}/mês (1º pagamento: ${moedaBR(valorPrimeiroPagamento(f))})`
      : `*${f}x por semana* — ${moedaBR(valorDoPlano(f))} por mês`;
    const texto =
      `${prefix}Prontinho${primeiro ? ", " + primeiro : ""}! 💚 Como você quer fazer as suas aulas?\n\n` +
      `🧺 *Aula Avulsa* — ${moedaBR(vAvulsa)} (aula única)\n` +
      `_OBS: não devolveremos o valor da aula avulsa em caso de falta._\n\n` +
      FREQS_WA.map((f) => `${NUM_EMOJI[f]} ${linhaPlano(f)}`).join("\n") + "\n\n" +
      (taxa
        ? `No *primeiro pagamento* entra a taxa de matrícula de ${moedaBR(taxa)}, cobrada uma vez só. A partir do mês seguinte é só a mensalidade.\n\n` +
          `A sua primeira aula já está inclusa. Se decidir não continuar depois dela, *devolvemos a mensalidade inteira* — só a taxa de matrícula não volta.`
        : `A sua primeira aula já entra nesse valor: você paga a 1ª mensalidade e, se decidir não continuar depois dela, devolvemos tudo.`);
    /* Eram 3 botões (Avulsa, 1x, 2x) — o máximo que o WhatsApp aceita. Com 3x e
       4x (23/09/2026) são 5 opções, então virou LISTA: um toque a mais, mas
       cabe tudo, e cada linha já diz preço e aulas no mês. */
    return waList(msg.from, texto, "Escolher plano", [
      { id: "plano:avulso", title: "🧺 Aula Avulsa", description: `${moedaBR(vAvulsa)} · aula única` },
      ...FREQS_WA.map((f) => ({
        id: `plano:${f}`,
        title: `${f}x por semana`,
        description: `${moedaBR(valorDoPlano(f))}/mês · ${f * 4} aulas no mês`,
      })),
    ]);
  };

  /* Fecha tudo: grava a ficha no painel (marcada como cadastro via WhatsApp),
     cria a aula segurada, emite o Pix com o CPF DELA e manda o código.
     A vaga fica de pé por HOLD_MIN minutos — quem confirma a reserva é o
     pagamento, não a conversa. */
  const cadastrarECobrar = async (freq, extraSlotIds = []) => {
    const slot = conv.slotId ? await prisma.slot.findUnique({ where: { id: conv.slotId } }) : null;
    if (!slot) return telaUnidade("Esse horário expirou. ");
    if ((await occupancy(slot.id)) >= (slot.capacity || 1))
      return telaHorarios(slot.unit, "Esse horário lotou enquanto conversávamos. 😔 ");

    const cpf = conv.cpf || "";
    const nome = conv.pendingName || (await fichaDaConversa())?.name || "";
    if (!cpf) return telaCpf();
    if (!nome) return telaNome();

    // A ficha entra ANTES da reserva: é o CPF dela que vai no Pix.
    const client = await upsertClienteWa({
      nome,
      phone: conv.pendingPhone || phone,
      cpf,
      email: conv.pendingEmail || null,
      birthday: conv.pendingBirthday || null,
      unit: slot.unit,
    });
    console.log(`[wa] cadastro via WhatsApp: ${client.name} (ficha ${client.id}, CPF ${cpf.slice(0, 3)}***).`);

    const { booking, extras, extraSlots } = await createWaBooking(client, slot, { weeklyFreq: freq, extraSlotIds });
    let pixCode = "";
    try {
      ({ pixCode } = await emitirPixDaReserva(booking, { cpf, name: client.name }));
    } catch (e) {
      /* Sem Pix a vaga não pode ficar segurada em silêncio: a aluna não teria
         como pagar e ainda ocuparia o lugar de quem tem. Solta e chama humano.
         A FICHA FICA — ela preencheu o cadastro, e apagar o trabalho dela por
         causa de uma falha nossa é o pior desfecho possível. */
      console.warn(`[wa] Pix da reserva ${booking.id} falhou: ${e.message}`);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: "cancelada", holdUntil: null, absenceReason: "Falha ao emitir o Pix da reserva" },
      });
      for (const extra of extras) {
        await prisma.booking.update({
          where: { id: extra.id },
          data: { status: "cancelada", holdUntil: null, absenceReason: "Falha ao emitir o Pix da reserva" },
        });
      }
      await setConv({ step: "done", slotId: null, bookingId: null, clientId: client.id });
      return waSend(msg.from,
        `Seu cadastro ficou pronto, ${client.name.split(" ")[0]}! Só não consegui gerar o Pix agora. 😞\n\n` +
        `Me chama neste número que a gente garante a sua vaga na hora:\n📞 ${WA_ATENDENTE}`);
    }

    const isAvulso = freq === "avulso";
    await setConv({ step: "cobranca", bookingId: booking.id, clientId: client.id, weeklyFreq: isAvulso ? null : freq, extraSlots: "[]", pendingName: null });
    const quandoStr = listaComE([slot, ...extraSlots].map(fmtSlotBR));
    await waSend(msg.from, textoCobrancaReserva({
      nome: client.name,
      unidade: slot.unit,
      quando: quandoStr,
      // A cobrança mostra as duas parcelas e o total: o Pix vem no valor cheio,
      // e o número do QR tem que bater com o que ela acabou de ler.
      mensalidade: isAvulso ? "" : moedaBR(valorDoPlano(freq)),
      taxa: booking.taxaMatricula ? moedaBR(booking.taxaMatricula) : "",
      valor: moedaBR(booking.value),
      minutos: HOLD_MIN,
      isAvulso,
    }));
    // O código vai SOZINHO numa mensagem: assim ela copia com um toque, sem
    // arrastar junto o texto acima.
    if (pixCode) await waSend(msg.from, pixCode);
    return waButtons(msg.from, "Assim que o pagamento cair eu te confirmo por aqui. 💚", [
      { id: "duvida:pix", title: "💠 Reenviar o Pix" },
      { id: "humano", title: "Falar com atendente" },
    ]);
  };

  /* Horários da semana além do 1º, um por mensagem: no 2x ela escolhe o 2º;
     no 3x, o 2º e o 3º; no 4x, até o 4º. Os já escolhidos ficam em
     `conv.extraSlots` e saem da lista seguinte, junto com o que se sobrepõe a
     eles no mesmo dia. Ao completar o plano — ou se ela tocar em "definir
     depois", ou se a semana não tiver mais nada — segue para a cobrança.

     Faltou horário? A escola combina com ela: registrarMatriculaPaga deixa
     anotado na ficha quantos horários faltam na grade. (O texto antigo mandava
     marcar a 2ª aula pelo portal, mas o portal não deixa mensalista fixa
     marcar aula da grade — ela ficaria sem saída.) */
  const extrasDaConversa = () => {
    try { return (JSON.parse(conv.extraSlots || "[]") || []).map(Number).filter(Boolean); }
    catch { return []; }
  };
  const telaHorarioExtra = async (slot1, prefix = "") => {
    const freq = freqDoPlano(conv.weeklyFreq);
    const escolhidosIds = extrasDaConversa();
    if (escolhidosIds.length >= freq - 1) return cadastrarECobrar(freq, escolhidosIds);
    const todos = await waAvailableSlots(slot1.unit);
    const escolhidos = escolhidosIds.map((id) => todos.find((s) => s.id === id)).filter(Boolean);
    const possiveis = horariosExtrasPossiveis(slot1, escolhidos, todos, {
      mesmaSemana,
      choque: (a, b) => haChoque(hhmm(a), hhmm(b)),
    });
    const n = escolhidosIds.length + 2; // posição do horário que ela escolhe agora
    if (!possiveis.length) {
      await waSend(msg.from,
        `Não encontramos mais horários com vaga na mesma semana da sua primeira aula. ` +
        `Sem problema: seguimos com ${escolhidosIds.length ? "os horários que você já escolheu" : "a sua primeira aula"}, ` +
        `e a escola combina com você o${freq - n > 0 ? "s outros horários" : ` ${ordinal(n)} horário`} da sua semana. 💚`);
      return cadastrarECobrar(freq, escolhidosIds);
    }
    const rows = possiveis.slice(0, 8).map((s) => ({ // até 8 horários + "definir depois"
      id: "slot2:" + s.id,
      title: fmtSlotDia(s),
      description: waDescricaoSlot(s),
    }));
    rows.push({ id: "slot2:pular", title: "Definir depois", description: "A escola combina os outros horários com você" });
    await setConv({ step: "slot2" });
    const jaTem = [slot1, ...escolhidos].map(fmtSlotBR);
    return waList(
      msg.from,
      `${prefix}Como você escolheu *${freq}x por semana*, escolha o seu *${ordinal(n)} horário* na mesma semana ` +
        `(${escolhidos.length ? "você já tem " + listaComE(jaTem) : fmtSlotBR(slot1)}):

Toque abaixo para escolher 👇`,
      `Escolher ${ordinal(n)} horário`,
      rows
    );
  };

  /* ----- atendimento humano: vale em QUALQUER passo, e vem antes de tudo -----
     O contador sobe a cada pedido e o número só sai na 3ª vez (ver
     textoAtendenteHumano). Não trava a conversa: o bot segue respondendo se ela
     continuar. O contador zera quando a conversa recomeça. */
  if (rid === "humano" || /\b(atendente|humano|pessoa real|falar com alguém|falar com alguem|falar com uma pessoa)\b/.test(low)) {
    const vez = (conv.humanoPedidos || 0) + 1;
    await setConv({ humanoPedidos: vez });
    return waSend(msg.from, textoAtendenteHumano(vez));
  }

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
    if (conv.step === "cpf") return telaCpf("Retomando! ");
    if (conv.step === "name") return telaNome("Retomando! ");
    if (conv.step === "nameok" && conv.pendingName) return telaConfirmarNome(conv.pendingName);
    if (conv.step === "wpp") return telaWpp("Retomando! ");
    if (conv.step === "email") return telaEmail("Retomando! ");
    if (conv.step === "nasc") return telaNasc("Retomando! ");
    if (conv.step === "plano") return telaPlano(conv.pendingName || "", "Retomando! ");
    if (conv.step === "slot2" && conv.slotId) {
      const s = await prisma.slot.findUnique({ where: { id: conv.slotId } });
      if (s) return telaHorarioExtra(s, "Retomando! ");
    }
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

  /* Primeiro contato da vida — ou o primeiro depois de a conversa expirar. Vem
     ANTES da navegação por botão de propósito: quem chega do zero ouve quem
     está falando com ela antes de ver um menu, e quem some por 12h não é jogada
     de volta num horário de ontem por ter tocado num botão antigo. */
  if (primeiroContato || expirou || conv.step === "start") return telaBoasVindas();
  // Terminou uma conversa e voltou depois: cumprimenta de novo, sem repetir tudo.
  if (conv.step === "done" && ["oi", "olá", "ola", "bom dia", "boa tarde", "boa noite"].includes(low))
    return telaBoasVindas();

  /* ----- navegação por botão: vale em qualquer passo ----- */
  if (rid === "new" || ["menu", "agendar", "começar", "comecar", "início", "inicio"].includes(low))
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

  if (conv.step === "done") return telaUnidade();

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
      return telaCpf();
    }
    return waButtons(msg.from, `Toque em *Confirmar* para reservar, ou escolha outro horário 👇`, [
      { id: "ok:slot", title: "✅ Confirmar" },
      { id: "back:slot", title: "🔄 Outro horário" },
      { id: "back:unit", title: "← Trocar unidade" },
    ]);
  }

  /* O CPF chegou. Aqui a conversa se divide em dois caminhos bem diferentes:
     quem JÁ TEM ficha pula o cadastro inteiro, e quem não tem preenche. */
  if (conv.step === "cpf") {
    const cpf = onlyDigits(body);
    if (!cpfValido(cpf)) return telaCpf("Esse CPF não parece válido 🤔. Confere pra mim? ");
    const existente = await prisma.client.findFirst({ where: { cpf } });
    await setConv({ cpf, clientId: existente?.id ?? null });
    conv = { ...conv, cpf, clientId: existente?.id ?? null };

    if (!existente) return telaNome();

    /* Já é nossa aluna: este fluxo cobra a 1ª MENSALIDADE, que é o que matricula
       quem está chegando. Quem já se matriculou não pode entrar aqui — a aula
       dela já está paga dentro da mensalidade do mês, e cobrar de novo seria
       vender duas vezes a mesma coisa. Ela marca pelo portal, onde as regras
       do plano (teto da semana, janela da escala) são aplicadas. */
    if (jaFezMatricula(existente)) {
      await setConv({ step: "done", slotId: null });
      return waSend(msg.from,
        `${existente.name.split(" ")[0]}, achei seu cadastro — você já é nossa aluna! 💚\n\n` +
        `Suas aulas você marca pelo *portal da aluna*, que já conhece o seu plano e o seu saldo de reposição:\n${WA_PORTAL_URL}\n\n` +
        `Se tiver qualquer dificuldade, me chama neste número:\n📞 ${WA_ATENDENTE}`);
    }
    // Tem ficha mas ainda não se matriculou: só falta escolher o plano.
    return telaPlano(existente.name, `Achei o seu cadastro, ${existente.name.split(" ")[0]}! 💚 `);
  }

  if (conv.step === "name") {
    const name = body.replace(/\s+/g, " ").trim();
    const pareceUnidade = SETTINGS.units.some((u) => u.toLowerCase() === name.toLowerCase());
    // nome completo = pelo menos duas palavras, e nada de número no meio
    const completo = name.split(" ").filter((p) => p.length >= 2).length >= 2;
    if (name.length < 5 || pareceUnidade || !completo || !/\p{L}/u.test(name))
      return waButtons(msg.from, `Preciso do seu *nome completo* (nome e sobrenome) para o cadastro 💚`, [{ id: "back:slot", title: "← Voltar" }]);
    return telaConfirmarNome(name);
  }

  if (conv.step === "nameok") {
    if (rid === "ok:name") {
      if (!conv.pendingName) return telaNome();
      return telaWpp();
    }
    if (rid === "edit:name") return telaNome("Sem problema! ");
    // digitou um nome novo em vez de tocar no botão
    const name = body.replace(/\s+/g, " ").trim();
    if (name.length >= 5 && /\p{L}/u.test(name)) return telaConfirmarNome(name);
    return telaConfirmarNome(conv.pendingName || "");
  }

  if (conv.step === "wpp") {
    if (rid === "wpp:ok") {
      await setConv({ pendingPhone: phone });
      return telaEmail();
    }
    if (rid === "wpp:outro") return waSend(msg.from, "Sem problema! Me manda o número com DDD 💚");
    const d = onlyDigits(body);
    if (d.length >= 10 && d.length <= 13) {
      await setConv({ pendingPhone: d.startsWith("55") ? d : "55" + d });
      return telaEmail();
    }
    return telaWpp("Não consegui ler o número 🤔. ");
  }

  if (conv.step === "email") {
    if (rid === "email:pular") {
      await setConv({ pendingEmail: null });
      return telaNasc();
    }
    if (!emailValido(body)) return telaEmail("Esse e-mail não parece completo 🤔. Confere pra mim? ");
    await setConv({ pendingEmail: body.trim().toLowerCase() });
    return telaNasc();
  }

  if (conv.step === "nasc") {
    const iso = parseNascimento(body, Number(todayISO().slice(0, 4)));
    if (!iso) return telaNasc("Não consegui ler essa data 🤔. Manda assim: *15/03/1990*. ");
    await setConv({ pendingBirthday: iso });
    conv = { ...conv, pendingBirthday: iso };
    return telaPlano(conv.pendingName || "");
  }

  if (conv.step === "plano") {
    // aceita a linha da lista ("plano:3") ou o número digitado — ver waFluxo.js
    const escolha = planoEscolhido(rid, body);
    if (escolha === "avulso") {
      await setConv({ weeklyFreq: null, extraSlots: "[]" });
      conv = { ...conv, weeklyFreq: null, extraSlots: "[]" };
      return cadastrarECobrar("avulso");
    }
    if (!escolha) return telaPlano(conv.pendingName || "", "Não entendi 🤔. ");
    const freq = escolha;
    await setConv({ weeklyFreq: freq, extraSlots: "[]" });
    conv = { ...conv, weeklyFreq: freq, extraSlots: "[]" };
    if (freq >= 2) {
      const slot1 = conv.slotId ? await prisma.slot.findUnique({ where: { id: conv.slotId } }) : null;
      if (slot1) return telaHorarioExtra(slot1);
    }
    return cadastrarECobrar(freq);
  }

  /* Escolhendo os horários da semana além do 1º (o nome do passo ficou "slot2"
     de quando só existia o 2x). Cada escolha é guardada e a tela pergunta o
     próximo, até completar o plano. */
  if (conv.step === "slot2") {
    const freq = freqDoPlano(conv.weeklyFreq);
    const escolhidos = extrasDaConversa();
    if (rid === "slot2:pular" || body.trim().toLowerCase() === "pular" || body.trim().toLowerCase() === "depois") {
      return cadastrarECobrar(freq, escolhidos);
    }
    const slot1 = conv.slotId ? await prisma.slot.findUnique({ where: { id: conv.slotId } }) : null;
    if (rid.startsWith("slot2:")) {
      const id = Number(rid.replace("slot2:", ""));
      // toque repetido numa lista antiga não conta duas vezes
      if (id && id !== slot1?.id && !escolhidos.includes(id)) {
        const agora = [...escolhidos, id];
        await setConv({ extraSlots: JSON.stringify(agora) });
        conv = { ...conv, extraSlots: JSON.stringify(agora) };
      }
      if (slot1) return telaHorarioExtra(slot1);
      return cadastrarECobrar(freq, extrasDaConversa());
    }
    if (slot1) return telaHorarioExtra(slot1, "Toque em uma das opções da lista para escolher. ");
    return cadastrarECobrar(freq, escolhidos);
  }

  /* Aguardando o Pix. A conversa não avança sozinha: quem move daqui é o
     webhook do Sicredi (avisarMatriculaConfirmada) ou o prazo estourando. */
  if (conv.step === "cobranca") {
    const b = conv.bookingId ? await prisma.booking.findUnique({ where: { id: conv.bookingId } }) : null;
    if (b && b.paid) {
      await setConv({ step: "done", bookingId: null, slotId: null });
      return waButtons(
        msg.from,
        `Seu pagamento já está confirmado e sua vaga garantida! 💚\n\n` +
        `📱 *Acesse o Portal da Aluna:*\n${WA_PORTAL_URL}\n\n` +
        `Entre com seu CPF e cadastre seu *PIN de 4 dígitos* para gerenciar suas aulas e acompanhar seu plano.`,
        [{ id: "new", title: "🔄 Marcar outra aula" }]
      );
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
      if (!validarCPF(cpfDigits)) {
        return res.status(400).json({ error: "CPF inválido. Verifique os números digitados." });
      }
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
        if (!validarCPF(cpfDigits)) {
          return res.status(400).json({ error: "CPF inválido. Verifique os números digitados." });
        }
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
       aluna que sai continua ocupando vaga nas turmas e recebendo cobranças.
       Todas as aulas futuras são removidas da grade e todas as mensalidades
       pendentes são canceladas automaticamente. */
    let encerrado = null;
    if (data.status === "cancelado" && antes && antes.status !== "cancelado") {
      encerrado = await encerrarAluna(client);
    }
    if (data.mensalistaTipo === "escala" && antes && antes.mensalistaTipo !== "escala") {
      await limparGradeRecorrenteAoVirarEscala(client);
    }
    /* Mexeu no status: a tela precisa dizer o que acontece com a cobrança.
       Inativou → nenhuma mensalidade nova nasce enquanto ela estiver assim, e
       `cobranca` diz qual seria a próxima quando reativar. Reativou → é a data
       em que a cobrança volta de fato. */
    const mudouStatus = data.status !== undefined && antes && data.status !== antes.status;
    const cobranca = mudouStatus ? await proximaCobranca(client) : undefined;
    res.json({
      ...client,
      encerrado,
      ...(mudouStatus ? { cobranca, cobrancaSuspensa: client.status === "cancelado" } : {}),
    });
  })
);

/* Quando a aluna vira "escala", ela não participa mais de grade fixa replicada.
   As aulas da semana corrente são preservadas (para ela não perder a aula que já
   iria frequentar), e todas as aulas futuras recorrentes das semanas seguintes
   são removidas do banco, liberando as vagas na turma. */
async function limparGradeRecorrenteAoVirarEscala(client) {
  const hoje = todayISO();
  const d = new Date(hoje + "T00:00Z");
  const fimSemana = addDays(hoje, 6 - ((d.getUTCDay() + 6) % 7));

  const removidas = await prisma.booking.deleteMany({
    where: {
      clientName: client.name,
      date: { gt: fimSemana },
      status: { not: "cancelada" },
      paymentMethod: PGTO_PLANO,
    },
  });

  if (removidas.count > 0) {
    console.log(`[escala] ${client.name} virou escala: ${removidas.count} aula(s) futuras recorrentes removidas (após ${fimSemana}).`);
  }
  return removidas.count;
}

/* Derruba o que estava marcado para a frente quando a aluna sai do curso.
   Exclui as aulas da grade sem deixar registros fantasmas/cancelados poluindo turmas,
   e salva snapshot completo no undoManager para suporte ao Ctrl+Z. */
async function encerrarAluna(client) {
  const t = todayISO();
  // 1. Coleta todas as aulas futuras da aluna para backup antes de excluir
  const aulasParaRemover = await prisma.booking.findMany({
    where: { clientName: client.name, date: { gte: t } },
  });

  // 2. Exclui definitivamente as aulas futuras da grade sem deixar registros fantasmas
  const deletadas = await prisma.booking.deleteMany({
    where: { clientName: client.name, date: { gte: t } },
  });

  // 3. Cancela todas as mensalidades pendentes da aluna (mês atual e futuros)
  const mensalidadesPendentes = await prisma.invoice.findMany({
    where: { clientId: client.id, status: "pendente" },
  });
  if (mensalidadesPendentes.length > 0) {
    await prisma.invoice.updateMany({
      where: { id: { in: mensalidadesPendentes.map((i) => i.id) } },
      data: { status: "cancelado" },
    });
  }

  // 4. Salva no undoManager (backup da aluna + histórico de Ctrl+Z)
  undoManager.saveClientBackup(client.id, {
    client: { ...client },
    bookings: aulasParaRemover,
    invoiceIds: mensalidadesPendentes.map((i) => i.id),
  });

  undoManager.pushAction({
    type: "inativar_aluna",
    description: `Inativação de ${client.name}`,
    client: { ...client },
    bookings: aulasParaRemover,
    invoiceIds: mensalidadesPendentes.map((i) => i.id),
  });

  // Aula extra comprada e ainda não usada fica pendurada — o valor foi pago e
  // não é devolvido, então quem decide o que fazer com ela é a Inêz.
  const extrasPagas = await prisma.extraPass.count({ where: { clientId: client.id, status: "pago" } });
  console.log(`[encerramento] ${client.name}: ${deletadas.count} aula(s) excluídas da grade sem deixar registro e ${mensalidadesPendentes.length} mensalidade(s) canceladas.`);
  return { aulas: deletadas.count, mensalidades: mensalidadesPendentes.length, extrasPagas, canUndo: true };
}

async function reativarAlunaComManutencao(clientId) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Aluna não encontrada");

  // 1. Atualiza status de volta para ativo
  const atualizada = await prisma.client.update({
    where: { id: clientId },
    data: { status: "ativo" },
  });

  // 2. Busca o backup de aulas salvas
  const backup = undoManager.getClientBackup(clientId);
  let aulasRestauradas = 0;

  if (backup && Array.isArray(backup.bookings) && backup.bookings.length > 0) {
    for (const b of backup.bookings) {
      let targetSlotId = b.slotId;
      const slotExiste = await prisma.slot.findUnique({ where: { id: targetSlotId } });
      if (!slotExiste) {
        // Se a turma foi excluída por completo no meio tempo, recria o slot
        const slotNovo = await prisma.slot.create({
          data: {
            date: b.date,
            time: b.time,
            unit: b.unit,
            prof: b.prof || profFor(b.unit),
            capacity: CAPACITY_PADRAO,
          },
        });
        targetSlotId = slotNovo.id;
      }

      await prisma.booking.create({
        data: {
          clientName: b.clientName,
          phone: b.phone || client.phone || "",
          unit: b.unit,
          date: b.date,
          time: b.time,
          prof: b.prof,
          slotId: targetSlotId,
          seriesId: b.seriesId,
          status: b.status === "cancelada" ? "confirmada" : (b.status || "confirmada"),
          attendance: b.attendance || "",
          absenceReason: "",
          value: b.value ?? 80,
          taxaMatricula: b.taxaMatricula,
          paid: b.paid ?? false,
          paymentMethod: b.paymentMethod,
          paymentDate: b.paymentDate,
        },
      });
      aulasRestauradas++;
    }

    // Reativa mensalidades que foram canceladas no encerramento
    if (Array.isArray(backup.invoiceIds) && backup.invoiceIds.length > 0) {
      await prisma.invoice.updateMany({
        where: { id: { in: backup.invoiceIds }, status: "cancelado" },
        data: { status: "pendente" },
      });
    }
  }

  /* A cobrança volta junto com o cadastro. Dizer QUANDO é o que fecha a conta
     para quem reativa: enquanto ela estava inativa nada nascia, e a pergunta
     seguinte é sempre "e a mensalidade dela, cai quando?". */
  const cobranca = await proximaCobranca(atualizada);
  return {
    ok: true,
    client: atualizada,
    aulasRestauradas,
    cobranca,
    message:
      `${client.name} reativada com sucesso! ${aulasRestauradas} aula(s) restauradas na agenda.` +
      (cobranca
        ? ` Mensalidade de ${compPorExtenso(cobranca.competencia)}: ${cobranca.naProximaRodada ? "pode ser gerada agora" : `gerada em ${dataBR(cobranca.geraEm)}`}.`
        : ""),
  };
}

async function reverterUltimoUndo() {
  const action = undoManager.popAction();
  if (!action) {
    return { ok: false, message: "Nenhuma ação recente para desfazer." };
  }

  if (action.type === "inativar_aluna") {
    const r = await reativarAlunaComManutencao(action.client.id);
    return {
      ok: true,
      undone: true,
      actionType: action.type,
      message: `Inativação desfeita! ${action.client.name} reativada e ${r.aulasRestauradas} aula(s) restauradas na agenda.`,
    };
  }

  if (action.type === "excluir_aluna") {
    // Recria a aluna excluída
    const { id, createdAt, ...clientData } = action.client;
    const novoClient = await prisma.client.create({
      data: {
        ...clientData,
        status: "ativo",
      },
    });

    let aulasRestauradas = 0;
    if (Array.isArray(action.bookings)) {
      for (const b of action.bookings) {
        let targetSlotId = b.slotId;
        const slotExiste = await prisma.slot.findUnique({ where: { id: targetSlotId } });
        if (!slotExiste) {
          const slotNovo = await prisma.slot.create({
            data: {
              date: b.date,
              time: b.time,
              unit: b.unit,
              prof: b.prof || profFor(b.unit),
              capacity: CAPACITY_PADRAO,
            },
          });
          targetSlotId = slotNovo.id;
        }

        await prisma.booking.create({
          data: {
            clientName: novoClient.name,
            phone: novoClient.phone || b.phone || "",
            unit: b.unit,
            date: b.date,
            time: b.time,
            prof: b.prof,
            slotId: targetSlotId,
            seriesId: b.seriesId,
            status: b.status === "cancelada" ? "confirmada" : (b.status || "confirmada"),
            attendance: b.attendance || "",
            absenceReason: "",
            value: b.value ?? 80,
            taxaMatricula: b.taxaMatricula,
            paid: b.paid ?? false,
            paymentMethod: b.paymentMethod,
            paymentDate: b.paymentDate,
          },
        });
        aulasRestauradas++;
      }
    }

    return {
      ok: true,
      undone: true,
      actionType: action.type,
      message: `Exclusão desfeita! Cadastro de ${novoClient.name} recriado com ${aulasRestauradas} aula(s) restauradas na agenda.`,
    };
  }

  return { ok: false, message: `Tipo de ação desconhecido: ${action.type}` };
}

app.post(
  "/api/undo",
  wrap(async (req, res) => {
    const result = await reverterUltimoUndo();
    res.json(result);
  })
);

app.get(
  "/api/undo/status",
  wrap(async (req, res) => {
    res.json(undoManager.getStatus());
  })
);

app.post(
  "/api/clients/:id/reativar",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const result = await reativarAlunaComManutencao(id);
    res.json(result);
  })
);

/* Dar baixa manual em Lead (1ª aula avulsa ou matrícula/mensalidade paga por fora).
   - Atualiza o status do cliente para "ativo" (sai da lista de Leads)
   - Confirma a reserva e registra o pagamento
   - Se aula avulsa: marca firstClass: true (vai para aba 1ª Aula Pagas) e cria a fatura quitada no financeiro
   - Se mensalista: confirma matrícula e converte em mensalista
*/
app.post(
  "/api/clients/:id/baixa-lead",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: "Aluno não encontrado." });

    const dataPgto = req.body?.paymentDate || todayISO();
    const formaPgto = req.body?.paymentMethod || "Pix";
    const compAtualStr = competenciaAtual();

    // Busca reservas associadas ao cliente
    const bookings = await prisma.booking.findMany({
      where: { clientName: client.name },
      orderBy: { id: "desc" },
    });

    const isMensalista = client.plan === "mensalista" || client.matriculaStatus === "pendente" || (client.weeklyFreq && client.weeklyFreq > 0);
    let valorFinal = req.body?.value !== undefined && req.body?.value !== null && req.body?.value !== ""
      ? Number(req.body.value)
      : null;

    let bookingAtualizado = null;
    let matriculaConvertida = null;
    let reativouAula = false;

    if (isMensalista) {
      // Caso Mensalista / Matrícula
      const valorPadrao = Number(valorDoPlano(client.weeklyFreq)) || PRECOS_PADRAO[`valorPlano${freqDoPlano(client.weeklyFreq)}x`];
      if (valorFinal === null) valorFinal = valorPadrao;

      // Procura reserva de matrícula ou a mais recente
      const bkMatricula = bookings.find((b) => ehPagamentoDeMatricula(b.paymentMethod) || b.status === "aguardando") || bookings[0];
      if (bkMatricula) {
        bookingAtualizado = await prisma.booking.update({
          where: { id: bkMatricula.id },
          data: {
            paid: true,
            status: "confirmada",
            paymentMethod: ehPagamentoDeMatricula(bkMatricula.paymentMethod) ? bkMatricula.paymentMethod : MARCA_MATRICULA,
            paymentDate: dataPgto,
            holdUntil: null,
            absenceReason: "",
            value: valorFinal,
          },
        });
        matriculaConvertida = await registrarMatriculaPaga(bookingAtualizado);
        await avisarMatriculaConfirmada(bookingAtualizado);
      } else {
        // Sem booking prévio: atualiza cliente diretamente
        await prisma.client.update({
          where: { id: client.id },
          data: {
            status: "ativo",
            matriculaStatus: "paga",
            matriculaAt: dataPgto,
            plan: "mensalista",
          },
        });
      }

      // Garante fatura quitada no Financeiro
      const jaExisteInv = await prisma.invoice.findFirst({
        where: { clientId: client.id, competencia: compAtualStr },
      });
      if (!jaExisteInv) {
        await prisma.invoice.create({
          data: {
            clientId: client.id,
            competencia: compAtualStr,
            amountCents: Math.round(valorFinal * 100),
            dueDate: dataPgto,
            status: "pago",
            paidAt: dataPgto,
            baixaManual: true,
          },
        });
      } else if (jaExisteInv.status !== "pago") {
        await prisma.invoice.update({
          where: { id: jaExisteInv.id },
          data: { status: "pago", paidAt: dataPgto, baixaManual: true },
        });
      }
    } else {
      // Caso Aula Avulsa
      const valorPadrao = Number(SETTINGS.valorAvulsa) || 40;
      if (valorFinal === null) {
        valorFinal = bookings[0]?.value ? Number(bookings[0].value) : valorPadrao;
      }

      // Atualiza o cliente para ativo e firstClass: true (assim ele vai para a aba "1ª Aula (Pagas)")
      await prisma.client.update({
        where: { id: client.id },
        data: {
          status: "ativo",
          firstClass: true,
          matriculaStatus: "nao_aplica",
          plan: "avulso",
        },
      });

      // Se houver reserva da aluna:
      const bk = bookings[0];
      if (bk) {
        let deveReativar = bk.status === "aguardando";
        if (bk.status === "cancelada" && bk.date >= todayISO()) {
          const slot = await prisma.slot.findUnique({ where: { id: bk.slotId } });
          const occ = await occupancy(bk.slotId);
          if (slot && occ < (slot.capacity || 1)) {
            deveReativar = true;
            reativouAula = true;
          }
        }

        bookingAtualizado = await prisma.booking.update({
          where: { id: bk.id },
          data: {
            paid: true,
            status: deveReativar ? "confirmada" : bk.status,
            paymentMethod: formaPgto,
            paymentDate: dataPgto,
            holdUntil: null,
            ...(deveReativar ? { absenceReason: "" } : {}),
            value: valorFinal,
          },
        });
        await avisarMatriculaConfirmada(bookingAtualizado);
      }

      // Cria fatura quitada para constar em Recebimentos / Financeiro
      const jaExisteInv = await prisma.invoice.findFirst({
        where: { clientId: client.id, competencia: compAtualStr },
      });
      if (!jaExisteInv) {
        await prisma.invoice.create({
          data: {
            clientId: client.id,
            competencia: compAtualStr,
            amountCents: Math.round(valorFinal * 100),
            dueDate: dataPgto,
            status: "pago",
            paidAt: dataPgto,
            baixaManual: true,
          },
        });
      } else if (jaExisteInv.status !== "pago") {
        await prisma.invoice.update({
          where: { id: jaExisteInv.id },
          data: { status: "pago", paidAt: dataPgto, baixaManual: true },
        });
      }
    }

    const clientAtualizado = await prisma.client.findUnique({ where: { id: client.id } });
    console.log(`[baixa lead] ${client.name} (id ${client.id}) ativado com pagamento ${formaPgto} R$ ${valorFinal}.`);

    res.json({
      ok: true,
      client: clientAtualizado,
      booking: bookingAtualizado,
      reativouAula,
      message: `Baixa registrada com sucesso! ${client.name} agora está ativa.`,
    });
  })
);

app.delete(
  "/api/clients/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cli = await prisma.client.findUnique({ where: { id } });
    if (!cli) return res.json({ ok: true });

    // Salva snapshot para Ctrl+Z
    const aulas = await prisma.booking.findMany({
      where: { clientName: cli.name, date: { gte: todayISO() } },
    });
    const invoices = await prisma.invoice.findMany({
      where: { clientId: id },
    });

    undoManager.pushAction({
      type: "excluir_aluna",
      description: `Exclusão do cadastro de ${cli.name}`,
      client: { ...cli },
      bookings: aulas,
      invoices: invoices,
    });

    // remove as aulas futuras e a lista de espera da pessoa; o histórico passado é mantido
    await prisma.booking.deleteMany({ where: { clientName: cli.name, date: { gte: todayISO() } } });
    await prisma.waitlist.deleteMany({ where: { name: cli.name } });
    await prisma.client.delete({ where: { id } }); // mensalidades caem junto (cascade)
    res.json({ ok: true, canUndo: true });
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
    if (barrarFeriado(res, w.slot.date, w.slot.unit)) return;
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
      // feriado não é oferecido: a escola não abre naquele dia
      .filter((s) => s.date >= t && !feriadoNoDia(s.date, s.unit) && (occ[s.id] || 0) < s.capacity)
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
    if (barrarFeriado(res, slot.date, slot.unit)) return;
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

/* ---------- FERIADOS ----------
   O calendário (`feriados`) é o que vale na porta da escola: nacionais
   calculados + o que a Inêz cadastrou. `manuais` é só o que ela digitou, que é
   o que a tela de Configurações deixa editar. */
/* Estado e chave do feriado no próprio dia da agenda. O nome vem do calendário
   automático; a chave só decide se aquela UNIDADE terá aulas. */
app.get("/api/feriados-dia", wrap(async (req, res) => {
  const date = String(req.query?.date || "").slice(0, 10);
  const unit = String(req.query?.unit || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !unit)
    return res.status(400).json({ error: "Informe data e unidade." });
  const nome = feriadoDe(FERIADOS_BASE_POR_UNIDADE[unit], date);
  const hasClasses = !nome || !feriadoNoDia(date, unit);
  res.json({ date, unit, nome, hasClasses, isHoliday: !!nome });
}));

app.post("/api/feriados-dia", wrap(async (req, res) => {
  const date = String(req.body?.date || "").slice(0, 10);
  const unit = String(req.body?.unit || "");
  const hasClasses = !!req.body?.hasClasses;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !unit)
    return res.status(400).json({ error: "Informe data e unidade." });
  const nome = feriadoDe(FERIADOS_BASE_POR_UNIDADE[unit], date);
  if (!nome) return res.status(409).json({ error: "Esta data não é feriado nesta unidade." });
  if (hasClasses) {
    await prisma.holidayOverride.upsert({
      where: { date_unit: { date, unit } },
      update: { hasClasses: true },
      create: { date, unit, hasClasses: true },
    });
  } else {
    await prisma.holidayOverride.deleteMany({ where: { date, unit } });
  }
  await loadFeriados();
  const aulas = hasClasses ? [] : await prisma.booking.findMany({
    where: { date, unit, status: { not: "cancelada" } },
    orderBy: [{ time: "asc" }, { clientName: "asc" }],
  });
  res.json({ date, unit, nome, hasClasses, aulas });
}));

app.get("/api/feriados", wrap(async (_req, res) => {
  const manuais = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  res.json({
    feriados: FERIADOS,
    feriadosPorUnidade: FERIADOS_POR_UNIDADE,
    feriadosBasePorUnidade: FERIADOS_BASE_POR_UNIDADE,
    aberturas: ABERTURAS_FERIADO,
    manuais,
  });
}));

/* Aulas ATIVAS marcadas numa data — quem seria atingida se o dia virar feriado.
   Não cancela nada: quem decide é a Inêz, olhando a lista. */
async function aulasDoDia(date) {
  return prisma.booking.findMany({
    where: { date, status: { not: "cancelada" } },
    orderBy: [{ time: "asc" }, { clientName: "asc" }],
  });
}

/* Cadastrar (ou atualizar) um feriado manual.
   `remove: true` marca o contrário: neste feriado nacional a escola ABRE.
   A resposta traz as aulas já marcadas no dia — a tela mostra a lista e
   pergunta se cancela com crédito. Nada é cancelado aqui. */
app.post("/api/feriados", wrap(async (req, res) => {
  const date = String(req.body?.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Data inválida — use AAAA-MM-DD." });
  const remove = !!req.body?.remove;
  const nome = String(req.body?.nome || "").trim().slice(0, 120) || (remove ? "A escola abre" : "Feriado");
  await prisma.holiday.upsert({
    where: { date },
    update: { nome, remove },
    create: { date, nome, remove },
  });
  await loadFeriados();
  res.json({
    ok: true,
    feriados: FERIADOS,
    // só faz sentido avisar quando o dia VIROU feriado
    aulas: remove ? [] : await aulasDoDia(date),
  });
}));

// Tirar da lista manual (o dia volta a valer o que o calendário nacional disser)
app.delete("/api/feriados/:date", wrap(async (req, res) => {
  const date = String(req.params.date || "").slice(0, 10);
  await prisma.holiday.deleteMany({ where: { date } });
  await loadFeriados();
  res.json({ ok: true, feriados: FERIADOS });
}));

// As aulas que ainda estão marcadas num feriado (para a tela reabrir o aviso)
app.get("/api/feriados/:date/aulas", wrap(async (req, res) => {
  res.json({ aulas: await aulasDoDia(String(req.params.date || "").slice(0, 10)) });
}));

/* Cancelar as aulas de um feriado. SEM crédito de reposição — Vitor, 02/09/2026.

   Esta rota fazia o contrário até esta data: gerava um crédito por mensalista,
   com o argumento de que feriado é decisão da escola e ninguém deveria perder
   aula. A regra foi invertida. O que a aluna contrata é a grade da escola, e a
   grade não tem aula em feriado: a mensalidade já é calculada sobre os dias em
   que a porta abre. Creditar o feriado pagaria a aluna duas vezes pelo mesmo
   dia — uma no preço, outra na reposição.

   Continua cancelando as aulas: a agenda do feriado tem que ficar limpa, e o
   motivo escrito na reserva é o que explica o cancelamento para quem olhar o
   histórico depois. */
app.post("/api/feriados/:date/cancelar-aulas", wrap(async (req, res) => {
  const date = String(req.params.date || "").slice(0, 10);
  const unit = String(req.body?.unit || "");
  const nome = feriadoNoDia(date, unit);
  if (!nome) return res.status(409).json({ error: "Este dia não está marcado como feriado." });
  const aulas = await prisma.booking.findMany({
    where: { date, ...(unit ? { unit } : {}), status: { not: "cancelada" } },
    orderBy: [{ time: "asc" }, { clientName: "asc" }],
  });
  const canceladas = [];
  for (const b of aulas) {
    await prisma.booking.update({
      where: { id: b.id },
      data: { status: "cancelada", absenceReason: `Feriado: ${nome} — a escola não abre.` },
    });
    canceladas.push(b.id);
  }
  // `creditos: []` continua na resposta para não quebrar telas antigas que
  // contam o tamanho da lista. Hoje ela é sempre vazia, por regra.
  res.json({ ok: true, feriado: nome, canceladas: canceladas.length, creditos: [] });
}));

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
    /* Tabela de preços — 0 é valor válido (ex.: mês de cortesia), por isso não
       usa ||. Em `taxaMatricula`, zero é mais que válido: é o botão de desligar
       a taxa, sem precisar de deploy. */
    for (const k of ["valorPlano1x", "valorPlano2x", "valorPlano3x", "valorPlano4x", "valorAvulsa", "taxaMatricula"]) {
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

/* Só pode acessar o portal da aluna quem já é cadastrado e que já fez o pagamento. */
function clientPodeAcessarPortal(client) {
  if (!client) return { ok: false, motivo: "Cadastro não encontrado." };
  if (client.status === "cancelado") {
    return {
      ok: false,
      motivo: "Seu cadastro está inativo ou cancelado. Entre em contato com a escola pelo WhatsApp para reativar seu acesso. 💚",
    };
  }
  if (client.status === "lead" || client.matriculaStatus === "pendente") {
    return {
      ok: false,
      leadPendente: true,
      motivo: "O portal da aluna é exclusivo para alunas cadastradas com matrícula e pagamento confirmados. Seu pagamento ainda não foi identificado. 💚 Se você já realizou o Pix, aguarde alguns instantes pela confirmação bancária.",
    };
  }
  return { ok: true };
}

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
  const pode = clientPodeAcessarPortal(client);
  if (!pode.ok) {
    return res.status(403).json({
      error: pode.motivo,
      leadPendente: pode.leadPendente || false,
      exists: true,
      hasPin: !!client.pin,
    });
  }
  res.json({ exists: true, hasPin: !!client.pin, clientId: client.id });
}));

// Define PIN pela primeira vez (aluno(a) já cadastrado, sem PIN)
app.post("/api/auth/set-pin", wrap(async (req, res) => {
  const pin = String(req.body.pin || "");
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: "PIN de 4 dígitos é obrigatório." });
  const client = await clientByCpf(req.body.cpf);
  if (!client) return res.status(404).json({ error: "CPF não encontrado." });
  const pode = clientPodeAcessarPortal(client);
  if (!pode.ok) return res.status(403).json({ error: pode.motivo });
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
  const pode = clientPodeAcessarPortal(client);
  if (!pode.ok) return res.status(403).json({ error: pode.motivo });
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

/* Migração leve e idempotente: cria as colunas que o código novo espera, se o
   banco ainda não as tiver. Não substitui as migrations do Prisma — existe
   porque este servidor sobe em máquina onde ninguém vai rodar `prisma migrate`
   antes de o telefone tocar, e uma coluna faltando derruba o webhook do
   WhatsApp inteiro. Cada linha é conferida antes de ser criada. */
const COLUNAS_ESPERADAS = [
  // replicação de turma
  ["Slot", "seriesId", "VARCHAR(40) NULL"],
  /* Cadastro da aluna pela conversa do WhatsApp (01/09/2026): a conversa passou
     a começar pelo CPF e guarda os dados até a ficha ficar completa. */
  ["WaConversation", "pendingEmail", "VARCHAR(255) NULL"],
  ["WaConversation", "pendingBirthday", "VARCHAR(10) NULL"],
  ["WaConversation", "pendingPhone", "VARCHAR(20) NULL"],
  ["WaConversation", "clientId", "INT NULL"],
  ["WaConversation", "humanoPedidos", "INT NOT NULL DEFAULT 0"],
  ["WaConversation", "lastInboundAt", "DATETIME(3) NULL"],
  // "Cadastro via WhatsApp" no painel
  ["Client", "origem", "VARCHAR(20) NULL"],
  ["Client", "aniversarioMsgAt", "VARCHAR(10) NULL"],
  /* Taxa de matrícula, de volta em 01/09/2026: quanto a escola cobra hoje
     (Settings) e quanto foi cobrado daquela aluna (Booking). Ver a migration
     20260901140000 para o porquê de serem duas. */
  ["Settings", "taxaMatricula", "DOUBLE NOT NULL DEFAULT 20"],
  ["Booking", "taxaMatricula", "DOUBLE NULL"],
];

/* Tabelas inteiras que o código novo espera. Mesmo espírito das colunas acima:
   `CREATE TABLE IF NOT EXISTS` é idempotente e não briga com a migration do
   Prisma que cria a mesma tabela. Sem `Holiday`, toda checagem de feriado
   quebraria — e a checagem roda em todo caminho de marcação. */
const TABELAS_ESPERADAS = [
  ["Holiday", `CREATE TABLE IF NOT EXISTS \`Holiday\` (
      \`id\` INTEGER NOT NULL AUTO_INCREMENT,
      \`date\` VARCHAR(10) NOT NULL,
      \`nome\` VARCHAR(120) NOT NULL DEFAULT 'Feriado',
      \`remove\` BOOLEAN NOT NULL DEFAULT false,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`Holiday_date_key\`(\`date\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`],
  /* Entrega das mensagens que a escola inicia (08/09/2026). Sem esta tabela o
     webhook de status não tem onde escrever e a escola volta a ficar cega. */
  ["WaMessage", `CREATE TABLE IF NOT EXISTS \`WaMessage\` (
      \`id\` INTEGER NOT NULL AUTO_INCREMENT,
      \`wamid\` VARCHAR(160) NOT NULL,
      \`phone\` VARCHAR(20) NOT NULL,
      \`kind\` VARCHAR(40) NOT NULL,
      \`invoiceId\` INTEGER NULL,
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'enviado',
      \`errorCode\` INTEGER NULL,
      \`errorMsg\` VARCHAR(400) NULL,
      \`sentAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`WaMessage_wamid_key\`(\`wamid\`),
      INDEX \`WaMessage_phone_idx\`(\`phone\`),
      INDEX \`WaMessage_invoiceId_idx\`(\`invoiceId\`),
      INDEX \`WaMessage_status_idx\`(\`status\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`],
  /* Disparo em massa (20/09/2026). Antes vivia só na memória do processo: um
     deploy no meio levava junto "quem recebeu e quem não". */
  ["WaDisparo", `CREATE TABLE IF NOT EXISTS \`WaDisparo\` (
      \`id\` VARCHAR(40) NOT NULL,
      \`por\` VARCHAR(60) NOT NULL,
      \`modo\` VARCHAR(12) NOT NULL,
      \`template\` VARCHAR(80) NULL,
      \`texto\` TEXT NULL,
      \`inicioEm\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`fimEm\` DATETIME(3) NULL,
      INDEX \`WaDisparo_inicioEm_idx\`(\`inicioEm\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`],
  ["WaDisparoItem", `CREATE TABLE IF NOT EXISTS \`WaDisparoItem\` (
      \`id\` INTEGER NOT NULL AUTO_INCREMENT,
      \`disparoId\` VARCHAR(40) NOT NULL,
      \`clientId\` INTEGER NOT NULL,
      \`nome\` VARCHAR(120) NOT NULL,
      \`phone\` VARCHAR(30) NOT NULL DEFAULT '',
      \`situacao\` VARCHAR(12) NOT NULL DEFAULT 'na fila',
      \`motivo\` VARCHAR(200) NULL,
      \`wamid\` VARCHAR(160) NULL,
      INDEX \`WaDisparoItem_disparoId_idx\`(\`disparoId\`),
      INDEX \`WaDisparoItem_wamid_idx\`(\`wamid\`),
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`WaDisparoItem_disparoId_fkey\` FOREIGN KEY (\`disparoId\`)
        REFERENCES \`WaDisparo\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`],
  ["HolidayOverride", `CREATE TABLE IF NOT EXISTS \`HolidayOverride\` (
      \`id\` INTEGER NOT NULL AUTO_INCREMENT,
      \`date\` VARCHAR(10) NOT NULL,
      \`unit\` VARCHAR(100) NOT NULL,
      \`hasClasses\` BOOLEAN NOT NULL DEFAULT true,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`HolidayOverride_date_unit_key\`(\`date\`, \`unit\`),
      INDEX \`HolidayOverride_date_idx\`(\`date\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`],
];

async function ensureSchema() {
  for (const [tabela, sql] of TABELAS_ESPERADAS) {
    await prisma.$executeRawUnsafe(sql);
    void tabela;
  }
  for (const [tabela, coluna, tipo] of COLUNAS_ESPERADAS) {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      tabela, coluna
    );
    if (Number(rows?.[0]?.n)) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE \`${tabela}\` ADD COLUMN \`${coluna}\` ${tipo}`);
    console.log(`Migração aplicada: coluna ${tabela}.${coluna} criada.`);
  }
}

const PORT = process.env.PORT || 4000;
ensureSchema()
  .catch((e) => console.error("Falha ao garantir schema:", e.message))
  .then(() => fecharDisparosInterrompidos())
  .catch((e) => console.error("Falha ao fechar disparos interrompidos:", e.message))
  .then(() => loadSettings())
  .catch((e) => console.error("Falha ao carregar configurações:", e.message))
  .then(() => loadFeriados())
  .catch((e) => console.error("Falha ao carregar feriados:", e.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`API Fios que Curam rodando em http://localhost:${PORT}`));
    /* Sentinela da invariante "reposição é aula única": qualquer aula de
       reposição futura que nenhum crédito reivindica só pode ter vindo de uma
       cópia. Aqui só avisa — quem limpa é a Inêz, por
       POST /api/makeup/duplicadas/limpar, depois de ver a lista. */
    setTimeout(() => {
      varrerReposicoesOrfas()
        .then(({ orfas }) => {
          if (orfas.length) console.warn(`[reposição] ${orfas.length} aula(s) de reposição sem crédito — confira em GET /api/makeup/duplicadas.`);
        })
        .catch((e) => console.warn("[reposição] varredura falhou:", e.message));
      /* A outra ponta: crédito em aberto cuja aula de origem voltou para a
         agenda. A tela já não oferece esse crédito; aqui só avisa que ele
         continua ocupando linha no banco. */
      varrerCreditosRessuscitados()
        .then(({ creditos }) => {
          if (creditos.length) console.warn(`[reposição] ${creditos.length} crédito(s) com a aula de origem de volta — confira em GET /api/makeup/aula-de-volta.`);
        })
        .catch((e) => console.warn("[reposição] varredura de créditos falhou:", e.message));
    }, 15_000);
  });
