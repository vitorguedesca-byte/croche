// Teste das regras de marcação do mensalista (backend/src/regrasAula.js)
import {
  checarRegras, janelaEscala, freqNaData, podeReplicarMensalista,
  segundaDaSemana, mesmaSemana, tetoSemanal, PGTO_PLANO,
  limiteMensalEscala, tetoMensalEscala, aulasDoPacote, compPorExtenso,
  somarComp, diaDoMes,
  encargosDaMensalidade, diasEntreISO, MULTA_ATRASO_REAIS, JUROS_DIA_PERCENTUAL,
  primeiroPagamento, mensalidadeDoPagamento,
  prazoLiberacao, liberouATempo, REPO_HORAS_MIN, motivoSemCredito,
  contaNoTeto, PGTO_PRESENTE, PRESENTE_VALIDADE_DIAS, validadePresente, situacaoPresente, presenteParaAula,
} from "./src/regrasAula.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };

// 2026: 22/08 = sábado · 21/08 = sexta · 24/08 = segunda
const fixo = { plan: "mensalista", mensalistaTipo: "fixo" };
const escala = { plan: "mensalista", mensalistaTipo: "escala" };
const avulsa = { plan: "avulso" };
const HOJE = "2026-08-24"; // segunda

const c = (cli, alvo, ctx = {}) => checarRegras(cli, alvo, { hoje: HOJE, ...ctx });

console.log("\n— fixo —");
ok(c(fixo, { date: "2026-08-24", time: "17:30" }).ok === true, "fixo: 17:30 passa");
ok(c(fixo, { date: "2026-08-24", time: "09:00" }).ok === true, "fixo: seg 09:00 passa");

/* A regra "18:00+ não faz parte do plano" foi REMOVIDA em 26/08/2026 — a escola
   tem turma das 18h as 20h na grade fixa das duas unidades. Estes casos existem
   para que ela não volte por acidente. O horário digitado com uma casa só é o
   que quebrava a comparação de texto antiga ("9" > "1"): sem regra de horário,
   nem esse formato barra ninguém. */
console.log("\n— noite faz parte do plano (regra removida) —");
ok(c(fixo, { date: "2026-08-24", time: "18:00" }).ok === true, "fixo: 18:00 passa");
ok(c(fixo, { date: "2026-08-24", time: "19:30" }).ok === true, "fixo: 19:30 passa");
ok(c(fixo, { date: "2026-08-24", time: "18:00 as 20:00" }).ok === true, "fixo: faixa '18:00 as 20:00' passa");
ok(c(fixo, { date: "2026-08-24", time: "9:00" }).ok === true, "fixo: '9:00' sem zero à esquerda passa");

/* A regra "sábado não faz parte do plano" foi REMOVIDA em 30/08/2026 — a escola
   tem 180 turmas de sábado na grade e 17 alunas fazendo 1.066 aulas nelas.
   Estes casos existem para que ela não volte por acidente. 22/08/2026 é sábado. */
console.log("\n— sábado faz parte do plano (regra removida) —");
ok(c(fixo, { date: "2026-08-22", time: "10:00" }).ok === true, "fixo: sábado passa");
ok(c(escala, { date: "2026-08-22", time: "09:00" }, { ignorarJanela: true }).ok === true, "escala: sábado passa");
ok(c(fixo, { date: "2026-08-22", time: "19:00" }).ok === true, "fixo: sábado à noite passa");

console.log("\n— avulsa (fora do plano de mensalista) —");
ok(c(avulsa, { date: "2026-08-22", time: "19:00" }).ok === true, "avulsa: sábado à noite passa");

console.log("\n— recorrência por tipo de mensalista —");
ok(podeReplicarMensalista(fixo) === true, "mensalista fixa pode participar da grade replicada");
ok(podeReplicarMensalista(escala) === false, "mensalista de escala nunca é replicada");
ok(podeReplicarMensalista(avulsa) === false, "aluna avulsa não entra em grade replicada");

/* Regra de 29/10/2026: a escala não tem mais dia nem semana — tem o pacote do
   mês (4 no 1x, 8 no 2x) e marca quando quiser, no mês atual e no seguinte.
   Os casos marcados "(antes barrado)" eram recusados pela regra antiga do
   "marque no dia da sua aula" / "2 por semana"; estão aqui para ela não voltar. */
console.log("\n— escala: janela = mês atual + o seguinte —");
const alvoOk = { date: "2026-08-26", time: "09:00" }; // quarta
const doPlanoEm = (date, extra = {}) => ({ date, time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO, ...extra });
ok(c(escala, alvoOk).ok === true, "escala sem nenhuma aula: pode marcar");
ok(c(escala, alvoOk, { todasAulas: [doPlanoEm("2026-08-27")] }).ok === true,
  "escala com aula só na quinta: marca hoje mesmo (antes barrado)");
ok(c(escala, { date: "2026-08-28", time: "09:00" }, {
  todasAulas: [doPlanoEm("2026-08-25"), doPlanoEm("2026-08-26"), doPlanoEm("2026-08-27")],
}).ok === true, "escala 1x: as 4 aulas do mês na MESMA semana (antes barrado)");
ok(c(escala, { date: "2026-09-15", time: "09:00" }).ok === true, "escala: o mês seguinte já está aberto");
ok(c(escala, { date: "2026-09-30", time: "09:00" }).ok === true, "escala: até o último dia do mês seguinte");
const doisMeses = c(escala, { date: "2026-10-01", time: "09:00" });
ok(doisMeses.codigo === "escala" && /outubro de 2026/.test(doisMeses.motivo),
  `escala: dois meses à frente fica fechado: "${doisMeses.motivo}"`);
ok(c(escala, { date: "2026-08-20", time: "09:00" }).codigo === "escala", "escala: data passada é recusada");
ok(c(escala, { date: "2026-09-02", time: "09:00" }, { hoje: "2026-08-29" }).ok === true,
  "escala: no dia 29 marca a semana que vem, já no mês seguinte");
ok(c(escala, { date: "2027-01-05", time: "09:00" }, { hoje: "2026-12-20" }).ok === true,
  "escala: virada do ano — janeiro abre em dezembro");
ok(c(escala, { date: "2027-02-01", time: "09:00" }, { hoje: "2026-12-20" }).codigo === "escala",
  "escala: virada do ano — fevereiro ainda fechado em dezembro");
ok(janelaEscala(HOJE).aberta === true, "janelaEscala sem data alvo: aberta (o dia é que decide)");

console.log("\n— escala: nenhuma data barra, só o horizonte e o pacote —");
ok(c(escala, { date: "2026-08-29", time: "09:00" }).ok === true, "escala: sábado passa");
ok(c(escala, { date: "2026-08-26", time: "18:30" }).ok === true, "escala: 18:30 passa");

console.log("\n— ignorarJanela (aula extra / presente / lote do painel) —");
ok(c(escala, { date: "2026-10-06", time: "09:00" }, { ignorarJanela: true }).ok === true,
  "ignorarJanela: fora do horizonte, passa");
ok(c(escala, { date: "2026-08-22", time: "09:00" }, { ignorarJanela: true }).ok === true,
  "ignorarJanela: sem a janela, o sábado passa");

console.log("\n— escala 2x: pacote de 8, sem regra de semana —");
const escala2x = { plan: "mensalista", mensalistaTipo: "escala", weeklyFreq: 2 };
ok(c(escala2x, { date: "2026-08-28", time: "15:00" }, {
  todasAulas: ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"].map((d) => doPlanoEm(d)),
}).ok === true, "escala 2x: 5ª aula na mesma semana passa (antes barrado)");
ok(c(escala2x, { date: "2026-09-01", time: "09:00" }, {
  todasAulas: [doPlanoEm("2026-08-27", { time: "14:00" })], hoje: "2026-08-26",
}).ok === true, "escala 2x: semana seguinte aberta antes da última aula desta (antes barrado)");

console.log("\n— teto mensal da escala (120,00 = 4 aulas / 200,00 = 8 aulas) —");
const escala120 = { plan: "mensalista", mensalistaTipo: "escala", weeklyFreq: 1, monthlyValue: 120 };
const escala200 = { plan: "mensalista", mensalistaTipo: "escala", weeklyFreq: 2, monthlyValue: 200 };

ok(limiteMensalEscala(escala120, "2026-08-10") === 4, "escala 120/1x: limite mensal de 4 aulas");
ok(limiteMensalEscala(escala200, "2026-08-10") === 8, "escala 200/2x: limite mensal de 8 aulas");

const aulas4 = [
  { date: "2026-08-03", time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO },
  { date: "2026-08-10", time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO },
  { date: "2026-08-17", time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO },
  { date: "2026-08-24", time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO },
];

ok(tetoMensalEscala(escala120, "2026-08-24", aulas4).atingido === true, "4 aulas em agosto atingem o limite de 1x");
ok(tetoMensalEscala(escala120, "2026-08-24", aulas4).restantes === 0, "restantes é 0 após 4 aulas");
ok(tetoMensalEscala(escala200, "2026-08-24", aulas4).atingido === false, "4 aulas em agosto NÃO atingem o limite de 2x (8 aulas)");
ok(tetoMensalEscala(escala200, "2026-08-24", aulas4).restantes === 4, "2x ainda tem 4 aulas restantes");

// checarRegras bloqueia 5ª aula no mesmo mês para escala 1x
ok(c(escala120, { date: "2026-08-31", time: "09:00" }, {
  todasAulas: aulas4,
}).codigo === "teto_mes", "escala 1x: 5ª aula do mês é bloqueada pelo teto mensal");

// reposição e extra não contam no teto mensal
const aulasComRepo = [
  { date: "2026-08-03", time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO },
  { date: "2026-08-10", time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO },
  { date: "2026-08-17", time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO },
  { date: "2026-08-20", time: "09:00", status: "confirmada", paymentMethod: "Reposição" },
  { date: "2026-08-22", time: "09:00", status: "confirmada", paymentMethod: "Avulsa" },
];
ok(tetoMensalEscala(escala120, "2026-08-24", aulasComRepo).atingido === false, "reposição e extra não consomem o teto mensal (3 do plano < 4)");
ok(tetoMensalEscala(escala120, "2026-08-24", aulasComRepo).marcadas === 3, "apenas as 3 do plano são contabilizadas");

console.log("\n— pacote do mês: aula liberada continua contando (29/10/2026) —");
const tres = [doPlanoEm("2026-08-03"), doPlanoEm("2026-08-10"), doPlanoEm("2026-08-17")];
const liberadaDia24 = doPlanoEm("2026-08-24", { status: "cancelada", liberada: true });
const tiradaPelaEscola = doPlanoEm("2026-08-24", { status: "cancelada" });
ok(aulasDoPacote([...tres, liberadaDia24], "2026-08") === 4, "liberada pela aluna conta no pacote (virou crédito)");
ok(c(escala120, { date: "2026-08-28", time: "09:00" }, { todasAulas: [...tres, liberadaDia24] }).codigo === "teto_mes",
  "escala 1x: 3 de pé + 1 liberada = pacote cheio, não marca a 5ª");
ok(aulasDoPacote([...tres, tiradaPelaEscola], "2026-08") === 3, "cancelada pela escola (feriado, exclusão) volta para o pacote");
ok(aulasDoPacote([...tres, liberadaDia24, doPlanoEm("2026-08-24")], "2026-08") === 4,
  "liberou e remarcou a MESMA aula: conta uma vez só");
ok(aulasDoPacote([...tres, liberadaDia24, { ...liberadaDia24 }], "2026-08") === 4,
  "a mesma aula liberada duas vezes conta uma vez só");
ok(aulasDoPacote([...tres, liberadaDia24], "2026-09") === 0, "cada mês tem o seu pacote");
ok(c(escala120, { date: "2026-09-01", time: "09:00" }, { todasAulas: aulas4 }).ok === true,
  "pacote de agosto cheio não trava setembro");
ok(aulasDoPacote([doPlanoEm("2026-08-03", { paymentMethod: "Reposição", status: "cancelada", liberada: true })], "2026-08") === 0,
  "reposição liberada não entra no pacote");

/* ===================== teto de aulas por semana (plano 1x/2x) ===================== */
// Semana de 24/08 (seg) a 30/08 (dom) de 2026
console.log("\n— semana: segunda a domingo —");
ok(segundaDaSemana("2026-08-24") === "2026-08-24", "segunda é o começo da própria semana");
ok(segundaDaSemana("2026-08-30") === "2026-08-24", "domingo 30/08 ainda é a semana da segunda 24/08");
ok(segundaDaSemana("2026-08-31") === "2026-08-31", "segunda 31/08 já é a semana seguinte");
ok(mesmaSemana("2026-08-25", "2026-08-28") === true, "terça e sexta da mesma semana");
ok(mesmaSemana("2026-08-30", "2026-08-31") === false, "domingo e a segunda seguinte são semanas diferentes");

const plano1x = { plan: "mensalista", mensalistaTipo: "fixo", weeklyFreq: 1 };
const plano2x = { ...plano1x, weeklyFreq: 2 };
const planoAntigo = { ...plano1x, weeklyFreq: null };
const doPlano = (date) => ({ date, time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO });
const reposicao = (date) => ({ date, time: "09:00", status: "confirmada", paymentMethod: "Reposição" });
const extraPaga = (date) => ({ date, time: "09:00", status: "confirmada", paymentMethod: "Avulsa" });

console.log("\n— teto: o que conta —");
ok(tetoSemanal(plano2x, "2026-08-26", [doPlano("2026-08-25")]).marcadas === 1, "aula do plano conta");
ok(tetoSemanal(plano2x, "2026-08-26", [reposicao("2026-08-25")]).marcadas === 0, "reposição NÃO conta no teto");
ok(tetoSemanal(plano2x, "2026-08-26", [extraPaga("2026-08-25")]).marcadas === 0, "aula extra NÃO conta no teto");
ok(tetoSemanal(plano2x, "2026-08-26", [{ ...doPlano("2026-08-25"), status: "cancelada" }]).marcadas === 0,
  "aula cancelada não conta");
ok(tetoSemanal(plano2x, "2026-08-26", [doPlano("2026-08-31")]).marcadas === 0, "aula de outra semana não conta");
ok(tetoSemanal(planoAntigo, "2026-08-26", [doPlano("2026-08-25")]).limite === 0, "plano antigo (sem weeklyFreq) não tem teto");

console.log("\n— frequência não bloqueia mais a marcação —");
const alvoQua = { date: "2026-08-26", time: "09:00" }; // quarta
ok(c(plano1x, alvoQua, { aulasAtivas: [] }).ok === true, "1x sem nada na semana: pode marcar");
ok(c(plano1x, alvoQua, { aulasAtivas: [doPlano("2026-08-25")] }).ok === true, "1x com aula na semana: não há bloqueio calculado");
ok(c(plano2x, alvoQua, { aulasAtivas: [doPlano("2026-08-25")] }).ok === true, "2x com 1 aula na semana: ainda pode");
ok(c(plano2x, alvoQua, { aulasAtivas: [doPlano("2026-08-25"), doPlano("2026-08-27")] }).ok === true,
  "2x com 2 aulas na semana: não há bloqueio calculado");
ok(c(plano1x, { date: "2026-08-31", time: "09:00" }, { aulasAtivas: [doPlano("2026-08-25")] }).ok === true,
  "1x: a semana que vem está livre de novo");
ok(c(plano1x, alvoQua, { aulasAtivas: [reposicao("2026-08-25"), extraPaga("2026-08-27")] }).ok === true,
  "reposição e extra na semana não fecham a vaga do plano");
ok(c(plano1x, alvoQua, { aulasAtivas: [doPlano("2026-08-25")], ignorarTeto: true }).ok === true,
  "ignorarTeto: reposição e aula extra passam por cima do teto");
ok(c(planoAntigo, alvoQua, { aulasAtivas: [doPlano("2026-08-25"), doPlano("2026-08-27")] }).ok === true,
  "plano antigo não é barrado pelo teto");

/* Troca de plano: vale a partir de weeklyFreqDesde. Antes disso, o teto continua
   medindo pelo plano ANTIGO — senão subir de 1x para 2x no dia 30 abriria uma
   vaga extra na semana que está acabando, num mês já cobrado pelo plano velho. */
console.log("\n— troca de plano: o teto muda só na virada do mês —");
const trocou = { plan: "mensalista", mensalistaTipo: "fixo", weeklyFreq: 2, weeklyFreqAnterior: 1, weeklyFreqDesde: "2026-09" };
ok(freqNaData(trocou, "2026-08-31") === 1, "31/08 (mês da troca): ainda vale o plano antigo, 1x");
ok(freqNaData(trocou, "2026-09-01") === 2, "01/09: já vale o plano novo, 2x");
ok(freqNaData(trocou, "2026-12-10") === 2, "meses depois: o plano novo continua valendo");
ok(freqNaData(trocou, "2026-07-15") === 1, "mês anterior à troca: plano antigo");
// sem troca registrada, é só o weeklyFreq
ok(freqNaData({ weeklyFreq: 2 }, "2026-08-31") === 2, "sem troca: usa o weeklyFreq direto");
ok(freqNaData({ weeklyFreq: 1, weeklyFreqAnterior: 2 }, "2026-08-31") === 1, "anterior sem 'desde' é ignorado");
ok(freqNaData({}, "2026-08-31") === 0, "sem plano nenhum: 0");

// O histórico da troca continua disponível para cobrança, mas não bloqueia agenda.
ok(c(trocou, { date: "2026-08-26", time: "09:00" }, { aulasAtivas: [doPlano("2026-08-25")] }).ok === true,
  "agosto: frequência antiga não bloqueia agenda");
ok(c(trocou, { date: "2026-09-02", time: "09:00" }, { aulasAtivas: [doPlano("2026-09-01")] }).ok === true,
  "setembro: com o plano novo, a 2ª aula da semana passa");

console.log("\n— nenhuma data é bloqueada por total semanal —");
ok(c(plano1x, { date: "2026-08-22", time: "09:00" }, { aulasAtivas: [doPlano("2026-08-19")] }).ok === true,
  "sábado com aula na semana continua disponível");

/* ===================== ciclo de cobrança da mensalidade ===================== */
console.log("\n— vencimento: o dia da matrícula, a partir do mês seguinte —");
// O caso que o Vitor descreveu: matriculou dia 19 → paga todo dia 19, começando no mês seguinte
ok(diaDoMes("2026-08-19") === 19, "matriculou em 19/08 → dia de vencimento 19");
ok(somarComp("2026-08", 1) === "2026-09", "1ª mensalidade é a competência do mês seguinte");
ok(somarComp("2026-12", 1) === "2027-01", "dezembro vira janeiro do ano seguinte");
ok(somarComp("2026-01", 1) === "2026-02", "janeiro vira fevereiro (sem pular mês)");

console.log("\n— vencimento: dias que não existem em todo mês —");
ok(diaDoMes("2026-01-31") === 28, "matriculou em 31/01 → cai para 28 (existe em todo mês)");
ok(diaDoMes("2026-03-29") === 28, "dia 29 também cai para 28");
ok(diaDoMes("2026-08-01") === 1, "dia 1 é mantido");
ok(diaDoMes("2026-08-28") === 28, "dia 28 é mantido");
ok(diaDoMes(undefined) === 1, "data ausente não quebra: cai para o dia 1");

/* ===================== multa e juros da mensalidade em atraso ===================== */
console.log("\n— contagem de dias —");
ok(diasEntreISO("2026-08-19", "2026-08-19") === 0, "no dia do vencimento: 0 dias");
ok(diasEntreISO("2026-08-19", "2026-08-20") === 1, "um dia depois: 1");
ok(diasEntreISO("2026-08-19", "2026-09-18") === 30, "30 dias depois");
ok(diasEntreISO("2026-08-19", "2026-08-18") === -1, "antes do vencimento: negativo");

// Mensalidade de R$ 200 vencendo em 19/08
const m200 = { amountCents: 20000, dueDate: "2026-08-19" };

console.log("\n— em dia não tem acréscimo —");
ok(encargosDaMensalidade(m200, "2026-08-10").totalCents === 20000, "adiantada: paga o valor cheio e nada mais");
ok(encargosDaMensalidade(m200, "2026-08-19").totalCents === 20000, "no dia do vencimento: sem multa");
ok(encargosDaMensalidade(m200, "2026-08-19").atrasada === false, "no dia do vencimento não está atrasada");

console.log("\n— a multa é um degrau: entra inteira no 1º dia —");
const d1 = encargosDaMensalidade(m200, "2026-08-20");
ok(d1.atrasada === true && d1.dias === 1, "1 dia de atraso");
ok(d1.multaCents === MULTA_ATRASO_REAIS * 100, `multa de R$ ${MULTA_ATRASO_REAIS} já no 1º dia`);
ok(encargosDaMensalidade(m200, "2026-09-18").multaCents === d1.multaCents, "a multa não cresce com o tempo");

console.log("\n— juros: o caso que o Vitor conferiu (R$ 200, 30 dias) —");
const d30 = encargosDaMensalidade(m200, "2026-09-18");
ok(d30.dias === 30, "30 dias de atraso");
ok(d30.jurosCents === 6, `juros = R$ 0,06 (0,001%/dia × 30 × R$ 200) — deu ${d30.jurosCents} centavos`);
ok(d30.totalCents === 20000 + 500 + 6, "total = R$ 205,06");

console.log("\n— juros crescem com os dias e com o valor —");
ok(encargosDaMensalidade(m200, "2026-10-18").jurosCents > d30.jurosCents, "60 dias rende mais juros que 30");
ok(encargosDaMensalidade({ amountCents: 40000, dueDate: "2026-08-19" }, "2026-09-18").jurosCents === 12,
  "R$ 400 pelos mesmos 30 dias rende o dobro de juros");
ok(JUROS_DIA_PERCENTUAL === 0.001, "a taxa fixa continua 0,001% ao dia");

console.log("\n— casos de borda —");
ok(encargosDaMensalidade({ amountCents: 0, dueDate: "2026-08-19" }, "2026-09-18").totalCents === 500,
  "mensalidade zerada em atraso: só a multa");
ok(encargosDaMensalidade({ amountCents: 20000, dueDate: "2026-08-19" }, undefined).totalCents === 20000,
  "sem data de referência não inventa acréscimo");
ok(encargosDaMensalidade(null, "2026-09-18").totalCents === 0, "invoice ausente não quebra");

/* ============ o primeiro pagamento da aluna nova ============
   Mensalidade + taxa de matrícula (uma vez só). O que este bloco prende é o
   PAR: o que se soma para cobrar tem que ser exatamente o que se subtrai para
   registrar a mensalidade do mês. Errar isso não quebra nada visível — só faz a
   receita da escola crescer R$ 20 por aluna nova, em silêncio. */
console.log("\n— 1º pagamento: mensalidade + taxa de matrícula —");
ok(primeiroPagamento({ mensalidade: 120, taxa: 20 }) === 140, "plano 1x (R$ 120) + taxa R$ 20 = R$ 140");
ok(primeiroPagamento({ mensalidade: 200, taxa: 20 }) === 220, "plano 2x (R$ 200) + taxa R$ 20 = R$ 220");
ok(primeiroPagamento({ mensalidade: 120, taxa: 0 }) === 120, "taxa zerada = só a mensalidade (é o botão de desligar)");
ok(primeiroPagamento({ mensalidade: 120 }) === 120, "sem taxa informada = só a mensalidade");
ok(primeiroPagamento({ mensalidade: 149.9, taxa: 20.1 }) === 170, "centavos fecham certos (149,90 + 20,10)");
ok(primeiroPagamento({ mensalidade: 120, taxa: -5 }) === 120, "taxa negativa não vira desconto");

console.log("\n— voltar da soma à mensalidade (é o que vira a fatura do mês) —");
ok(mensalidadeDoPagamento({ pago: 140, taxa: 20 }) === 120, "pagou R$ 140 com taxa de R$ 20 → mensalidade R$ 120");
ok(mensalidadeDoPagamento({ pago: 220, taxa: 20 }) === 200, "pagou R$ 220 com taxa de R$ 20 → mensalidade R$ 200");
ok(mensalidadeDoPagamento({ pago: 120, taxa: 0 }) === 120, "sem taxa: a mensalidade é o pagamento inteiro");
ok(mensalidadeDoPagamento({ pago: 120 }) === 120, "reserva antiga (taxa null) é toda mensalidade");
ok(mensalidadeDoPagamento({ pago: 0, taxa: 20 }) === 0, "não devolve valor negativo");

console.log("\n— ida e volta: o par tem que fechar em todos os preços —");
let paresOk = true;
for (const mens of [0, 80, 120, 149.9, 200, 237.35, 1000]) {
  for (const taxa of [0, 20, 15.5, 49.99]) {
    const cobrado = primeiroPagamento({ mensalidade: mens, taxa });
    if (mensalidadeDoPagamento({ pago: cobrado, taxa }) !== mens) {
      console.log(`        divergiu: mensalidade ${mens} + taxa ${taxa} → cobrou ${cobrado}`);
      paresOk = false;
    }
  }
}
ok(paresOk, "28 combinações de preço e taxa: somar e subtrair devolvem a mensalidade original");

/* ---------- prazo para liberar a aula e ganhar crédito de reposição ----------
   É a regra que a escola promete por escrito ("avise com pelo menos 6 horas").
   A faixa da manhã existe porque 6 horas antes de uma aula das 8h seria de
   madrugada: para elas, o prazo é 23:59 da véspera. */
console.log("\n— prazo da reposição —");
ok(prazoLiberacao("2026-09-10", "09:00") === "2026-09-09T23:59:59", "aula da manhã: até 23:59 da véspera");
ok(prazoLiberacao("2026-09-10", "07:00") === "2026-09-09T23:59:59", "aula das 7h: idem");
ok(prazoLiberacao("2026-09-10", "13:00") === "2026-09-10T07:00:00", "13:00 → 6h antes, no mesmo dia");
ok(prazoLiberacao("2026-09-10", "18:00") === "2026-09-10T12:00:00", "18:00 → 12:00");
ok(prazoLiberacao("2026-09-10", "10:00") === "2026-09-10T04:00:00", "10:00 já está fora da faixa da manhã");
// hora fora do formato não pode derrubar a conta (o banco guarda texto livre)
ok(prazoLiberacao("2026-09-10", "9:00") === "2026-09-09T23:59:59", "'9:00' sem zero à esquerda cai na manhã");
ok(prazoLiberacao("2026-09-10", "18:00 as 20:00") === "2026-09-10T12:00:00", "faixa inteira usa a hora de início");
/* A madrugada NÃO cai na conta das 6 horas: qualquer hora antes das 10:00 usa
   o prazo da véspera, que é sempre o mais cedo dos dois. É por isso que o
   `while` da virada de dia dentro de prazoLiberacao nunca dispara na prática —
   a partir das 10:00, seis horas antes ainda é o mesmo dia. */
ok(prazoLiberacao("2026-09-10", "03:00") === "2026-09-09T23:59:59", "madrugada usa o prazo da véspera");

console.log("\n— avisou a tempo? —");
ok(liberouATempo("2026-09-10", "15:00", "2026-09-10T08:59:00") === true, "15:00 avisando às 8h59: no prazo");
ok(liberouATempo("2026-09-10", "15:00", "2026-09-10T09:00:00") === true, "no limite exato ainda vale");
ok(liberouATempo("2026-09-10", "15:00", "2026-09-10T09:01:00") === false, "um minuto depois já não gera crédito");
ok(liberouATempo("2026-09-10", "09:00", "2026-09-09T23:59:00") === true, "manhã: véspera às 23:59 vale");
ok(liberouATempo("2026-09-10", "09:00", "2026-09-10T06:00:00") === false, "manhã: no próprio dia não vale");
ok(REPO_HORAS_MIN === 6, "a antecedência prometida continua sendo 6 horas");

/* FERIADO NÃO GERA CRÉDITO (Vitor, 02/09/2026) — regra invertida nesta data.
   O que este bloco prende não é só o "não": é a ORDEM. Numa véspera de feriado
   as duas recusas são verdadeiras ao mesmo tempo, e responder "você avisou
   tarde" para um dia em que a escola nem abriria acusa a aluna de algo que não
   aconteceu. O feriado tem que falar primeiro. */
console.log("\n— feriado não gera crédito —");
const semCred = (o) => motivoSemCredito({ agora: "2026-09-10T08:00:00", ...o });

ok(semCred({ date: "2026-09-10", time: "15:00" }) === "",
  "dia comum, avisando a tempo: o crédito sai");
ok(semCred({ date: "2026-09-07", time: "15:00", nomeFeriado: "Independência" }) !== "",
  "feriado não gera crédito");
ok(semCred({ date: "2026-09-07", time: "15:00", nomeFeriado: "Independência" }).includes("Independência"),
  "o motivo diz qual feriado é");
/* Aviso em cima da hora E feriado: as duas recusas valem, mas quem responde é
   o feriado. Se esta trocar de lado, a aluna leva a culpa por um dia sem aula. */
ok(semCred({ date: "2026-09-07", time: "09:00", nomeFeriado: "Independência", agora: "2026-09-07T08:00:00" })
     .includes("não abre"),
  "feriado responde ANTES da antecedência, mesmo com aviso em cima da hora");
ok(semCred({ date: "2026-09-10", time: "09:00", agora: "2026-09-10T06:00:00" }).includes("23:59"),
  "sem feriado, a recusa volta a ser a da antecedência");
ok(semCred({ date: "2026-09-10", time: "15:00", agora: "2026-09-10T09:01:00" }).includes("6h"),
  "tarde: a recusa cita as 6 horas prometidas");

/* AULA DE PRESENTE (Vitor, 05/10/2026). O que este bloco prende: a validade de
   30 dias é da AULA (a data dela), o presente que vence primeiro é o gasto
   primeiro, e a aula de presente fica fora do teto do plano. */
console.log("\n— aula de presente —");
ok(PRESENTE_VALIDADE_DIAS === 30, "a validade prometida continua sendo 30 dias");
ok(validadePresente("2026-10-05") === "2026-11-04", "dado em 05/10, vale até 04/11");
ok(validadePresente("2026-12-15") === "2027-01-14", "a validade atravessa a virada do ano");

const pres = (o) => ({ id: 1, status: "disponivel", expiresOn: "2026-11-04", usedBookingId: null, ...o });
ok(situacaoPresente(pres(), "2026-10-20") === "disponivel", "dentro da validade: disponível");
ok(situacaoPresente(pres(), "2026-11-04") === "disponivel", "no último dia ainda vale");
ok(situacaoPresente(pres(), "2026-11-05") === "vencido", "no dia seguinte venceu — sem rodada nenhuma");
ok(situacaoPresente(pres({ status: "usado", usedBookingId: 9 }), "2026-11-05") === "usado", "usado continua usado depois da validade");
ok(situacaoPresente(pres({ status: "cancelado" }), "2026-10-20") === "cancelado", "recolhido pela escola");

const lista = [
  pres({ id: 1, expiresOn: "2026-11-20" }),
  pres({ id: 2, expiresOn: "2026-11-04" }),
  pres({ id: 3, expiresOn: "2026-10-01" }), // já venceu
];
ok(presenteParaAula(lista, "2026-10-20", "2026-10-10")?.id === 2, "gasta primeiro o que vence primeiro");
ok(presenteParaAula(lista, "2026-11-10", "2026-10-10")?.id === 1, "aula depois de uma validade usa o que ainda alcança a data");
ok(presenteParaAula(lista, "2026-11-25", "2026-10-10") === null, "aula depois de todas as validades: nenhum serve");
ok(presenteParaAula([pres({ status: "usado", usedBookingId: 5 })], "2026-10-20", "2026-10-10") === null, "presente usado não serve");

ok(!contaNoTeto({ status: "confirmada", paymentMethod: PGTO_PRESENTE }), "aula de presente não conta no teto do plano");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os casos passaram.");
process.exit(falhas ? 1 : 0);
