/* ===================== REGRAS DA CONVERSA DO WHATSAPP =====================
   As decisões da conversa que não dependem do banco: o que a aluna digitou é
   uma data?, um e-mail?, quanto falta para a turma lotar?, este horário de hoje
   ainda dá tempo?

   Vivem aqui, e não dentro do server.js, pelo mesmo motivo de regrasAula.js:
   são regras que a escola PROMETE (a turma "quase esgotando" tem que ser mesmo,
   o horário oferecido tem que dar tempo de chegar) e regra prometida precisa de
   teste. Ver backend/test-wa-fluxo.mjs.

   Este módulo é PURO: não toca no banco, não manda mensagem, não olha relógio
   por conta própria — quem chama traz a hora. */

/* Folga entre a hora do contato e o início da aula.

   Existe porque a lista era filtrada só por DATA: quem escrevia às 15h
   continuava vendo a turma das 9h de hoje, escolhia, confirmava, pagava — e só
   então descobria que a aula tinha sido de manhã. Meia hora não bastava (as
   unidades ficam em pontos diferentes da cidade), então 45 minutos: tempo de
   pagar o Pix e sair de casa. */
export const WA_ANTECEDENCIA_MIN = 45;

/* 'HH:MM' a partir da qual um horário de HOJE ainda pode ser oferecido.
   `agora` é 'HH:MM' no fuso da aluna. Devolve '99:99' quando a folga passa da
   meia-noite: nada de hoje serve mais, e comparação de string com '99:99'
   descarta tudo sem precisar de caso especial em quem chama. */
export function horaDeCorte(agora, folgaMin = WA_ANTECEDENCIA_MIN) {
  const [h, m] = String(agora || "00:00").slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "00:00";
  const min = h * 60 + m + folgaMin;
  if (min >= 1440) return "99:99";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/* Este horário ainda pode ser oferecido? Só o dia de HOJE é cortado pelo
   relógio — a regra é sobre a hora em que ela entrou no chat, então amanhã de
   manhã continua valendo mesmo que ela escreva hoje à noite. */
export const slotAindaDaTempo = (slot, hojeISO, corte) =>
  slot.date > hojeISO || (slot.date === hojeISO && String(slot.time).slice(0, 5) >= corte);

/* Como a lotação da turma é dita para a aluna.

   A Inêz pediu para mostrar o movimento das turmas, e a razão é boa: turma
   cheia sumindo da lista faz uma escola lotada parecer vazia. O aviso de
   "última vaga" só aparece quando é verdade — é urgência verificável, não
   gatilho de venda. */
export function lotacaoDaTurma({ alunas = 0, capacidade = 1 }) {
  const vagas = Math.max(0, capacidade - alunas);
  if (vagas === 0) return { nivel: "esgotada", ic: "🔴", txt: "esgotada", vagas };
  if (vagas === 1) return { nivel: "ultima", ic: "🟠", txt: "última vaga!", vagas };
  if (vagas <= 2) return { nivel: "quase", ic: "🟡", txt: `só ${vagas} vagas`, vagas };
  return { nivel: "livre", ic: "🟢", txt: `${vagas} vagas`, vagas };
}

/* Descrição da linha na lista do WhatsApp. A Meta corta em 72 caracteres, então
   o corte é feito aqui — texto truncado pela plataforma no meio de uma palavra
   é pior que texto curto escrito de propósito. */
export const DESCRICAO_MAX = 72;
export function descricaoDaTurma(slot) {
  const l = lotacaoDaTurma(slot);
  return `${String(slot.time).slice(0, 5)} · ${l.ic} ${l.txt} · ${slot.alunas}/${slot.capacidade} alunas`.slice(0, DESCRICAO_MAX);
}

/* 'DD/MM/AAAA', 'DD-MM-AAAA' ou 'DDMMAAAA' → 'YYYY-MM-DD'; null se não for
   data. Recusa 31/02 e datas no futuro: nascimento que ainda não aconteceu é
   dedo trocado, não exceção. */
export function parseNascimento(texto, anoAtual = new Date().getFullYear()) {
  const d = String(texto || "").replace(/\D/g, "");
  if (d.length !== 8) return null;
  const dia = Number(d.slice(0, 2)), mes = Number(d.slice(2, 4)), ano = Number(d.slice(4));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (ano < 1900 || ano > anoAtual) return null;
  const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  // 31/02 vira 03/03 no Date: se voltar diferente, a data não existe
  const chk = new Date(iso + "T12:00:00Z");
  if (chk.getUTCDate() !== dia || chk.getUTCMonth() + 1 !== mes) return null;
  return iso;
}

/* E-mail. Deliberadamente frouxo: o objetivo é pegar o dedo trocado óbvio
   ("maria@gmail", "maria.gmail.com"), não policiar a RFC. E-mail recusado à toa
   é aluna travada num passo que ela não consegue passar. */
export const emailValido = (s) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(s || "").trim());

// '5531999998888' → '(31) 99999-8888' — para o bot mostrar o número que ela
// confirma, em vez de pedir que ela digite o próprio telefone.
export function telefoneBR(numero) {
  const d = String(numero || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length < 10) return String(numero || "");
  const ddd = d.slice(0, 2), resto = d.slice(2);
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

/* ============ A VAGA É SEGURADA POR 10 MINUTOS, E TODO PAGAMENTO AVISA ============
   Vitor, 02/09/2026. Duas regras que andam juntas.

   1) O prazo caiu de 1 hora para HOLD_MIN = 10 minutos (a constante mora no
      server.js, junto de quem cria a reserva). Pix cai em segundos; o que a
      hora inteira segurava era vaga parada de quem já tinha desistido,
      enquanto a próxima aluna via a turma como lotada. A HOLD_AVISO_MIN = 3
      minutos do fim sai um último toque oferecendo reenviar o Pix — três, não
      trinta: em dez minutos, lembrete cedo demais chega colado na mensagem do
      Pix e vira cobrança. A rodada que varre os prazos passou a rodar de minuto
      em minuto; num prazo de dez, uma varredura de cinco soltaria a vaga com
      metade do prazo de atraso.

      O prazo curto SÓ é seguro por causa da rede que já existia, e ela não pode
      ser removida junto: quem paga depois de o prazo estourar não perde o
      dinheiro. O Sicredi é consultado antes de a vaga sair e de novo quando o
      pagamento chega — se ainda houver lugar, a aula volta; se não houver, o
      pagamento fica registrado e a Inêz remarca. E o texto de expiração diz
      isso à aluna, para ela não pagar duas vezes por susto.

   2) TODO pagamento confirmado manda mensagem. Antes, só a matrícula avisava;
      mensalidade e aula extra eram baixadas em silêncio, e a dúvida ("caiu?")
      voltava como trabalho para a Inêz — ou como um segundo pagamento. Ver
      `avisarPagamento` no server.js e os textos em textosEscola.js.

   A parte da (1) que não depende do banco — QUANDO expirar e quando avisar —
   está logo abaixo, com teste. O resto (consultar o Sicredi, soltar a vaga,
   mandar a mensagem) fica no server.js. */

export const HOLD_MIN = 10;       // quanto tempo a vaga fica segurada
export const HOLD_AVISO_MIN = 3;  // último toque, a esta distância do fim
export const RODADA_HOLD_MIN = 1; // de quanto em quanto tempo a varredura roda

/* O que fazer com uma reserva segurada, agora: "expirar", "avisar" ou
   "esperar". `holdUntil` é o instante em que o prazo acaba.

   Mora aqui porque a relação entre os três números acima é frágil de um jeito
   que não dá erro: se a varredura rodar mais espaçada que HOLD_AVISO_MIN, o
   aviso dos 3 minutos simplesmente não sai em algumas reservas — ninguém vê,
   e a aluna perde a vaga sem o último toque. O teste prende isso. */
export function acaoDaReserva({ holdUntil, holdNudged = false }, agora = Date.now()) {
  /* Sem prazo, nada a fazer. O teste de nulo vem ANTES do Date porque
     `new Date(null)` é 1970 — data válida, no passado, que faria a reserva ser
     "expirada" na primeira varredura. A rodada filtra por holdUntil não-nulo,
     mas essa é a proteção de quem chama; a função não pode depender dela. */
  if (holdUntil === null || holdUntil === undefined || holdUntil === "")
    return { acao: "esperar", faltam: 0 };
  const fim = new Date(holdUntil).getTime();
  if (!Number.isFinite(fim)) return { acao: "esperar", faltam: 0 };
  const faltam = Math.round((fim - agora) / 60_000);
  if (agora >= fim) return { acao: "expirar", faltam: 0 };
  if (!holdNudged && faltam <= HOLD_AVISO_MIN) return { acao: "avisar", faltam: Math.max(1, faltam) };
  return { acao: "esperar", faltam };
}

/* A conversa expira em 12 horas de silêncio DELA.

   O horário que ela escolheu de manhã pode ter lotado à noite; retomar do meio
   faria o bot confirmar uma vaga que já não existe. Recomeçar custa três
   toques, confirmar reserva fantasma custa a confiança. */
export const CONVERSA_EXPIRA_H = 12;
export const conversaExpirou = (ultimaMsg, agora = Date.now(), horas = CONVERSA_EXPIRA_H) =>
  !!ultimaMsg && agora - new Date(ultimaMsg).getTime() >= horas * 3600_000;

/* Em que pedido o número do atendente humano é entregue.

   A Inêz pediu para insistir no automático (ela é uma pessoa só, e quase toda
   dúvida o bot responde na hora), mas insistir sem fim vira parede. Três: duas
   tentativas de resolver aqui, e na terceira o número sai sem discussão. */
export const HUMANO_ENTREGA_NA_VEZ = 3;

/* ===================== PLANO E HORÁRIOS DA SEMANA =====================
   Vitor, 23/09/2026: o WhatsApp passou a oferecer 3x e 4x por semana, além de
   1x e 2x. Quem escolhe NX escolhe N horários na MESMA semana da 1ª aula — é
   com eles que a grade de 12 meses é montada quando o Pix cai. A aluna do
   WhatsApp entra como mensalista FIXO, e 3x/4x só existem no fixo. */
export const FREQS_WA = [1, 2, 3, 4];

/* O que ela respondeu na tela do plano: o botão da lista ("plano:3") ou o
   número digitado. Devolve 1..4, "avulso" ou null (não entendi). */
export function planoEscolhido(rid, body) {
  const id = String(rid || "");
  const txt = String(body || "").trim().toLowerCase();
  if (id === "plano:avulso" || txt.includes("avuls") || txt === "0") return "avulso";
  const m = id.match(/^plano:(\d)$/) || txt.match(/^(\d)\s*(x|vez|vezes)?\b/);
  const n = m ? Number(m[1]) : NaN;
  return FREQS_WA.includes(n) ? n : null;
}

/* "2º horário", "3ª aula": a posição do que ela está escolhendo agora. */
export const ordinal = (n, genero = "o") => `${n}${genero === "a" ? "ª" : "º"}`;

/* Horários que ainda podem entrar na semana dela.
   - só a semana da 1ª aula, e só turma com vaga;
   - nada que ela já escolheu;
   - nada que se sobreponha, no mesmo dia, a uma aula que ela já escolheu:
     ninguém faz duas turmas ao mesmo tempo. Dois horários no mesmo dia sem
     choque (manhã e tarde) valem — é a escolha dela.
   `choque(horaA, horaB)` vem de quem chama, porque a duração da aula mora nas
   Configurações. */
export function horariosExtrasPossiveis(slot1, escolhidos, todos, { mesmaSemana, choque }) {
  const ja = [slot1, ...(escolhidos || [])].filter(Boolean);
  const ids = new Set(ja.map((s) => s.id));
  return (todos || []).filter((s) =>
    !s.esgotada &&
    !ids.has(s.id) &&
    mesmaSemana(s.date, slot1.date) &&
    !ja.some((j) => j.date === s.date && choque(j.time, s.time)));
}

/* "seg 28/09 09:00, ter 29/09 14:00 e qua 30/09 09:00" */
export function listaComE(itens) {
  const xs = (itens || []).filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
}
