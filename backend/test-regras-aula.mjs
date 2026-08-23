// Teste das regras de marcação do mensalista (backend/src/regrasAula.js)
import {
  checarRegras, horarioPermitido, janelaEscala, ehSabado, ehNoite,
  segundaDaSemana, mesmaSemana, tetoSemanal, PGTO_PLANO,
  somarComp, diaDoMes,
  encargosDaMensalidade, diasEntreISO, MULTA_ATRASO_REAIS, JUROS_DIA_PERCENTUAL,
} from "./src/regrasAula.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };

// 2026: 22/08 = sábado · 21/08 = sexta · 24/08 = segunda
ok(ehSabado("2026-08-22") === true, "22/08/2026 é sábado");
ok(ehSabado("2026-08-21") === false, "21/08/2026 não é sábado");
ok(ehNoite("18:00") === true, "18:00 conta como noite (corte inclusivo)");
ok(ehNoite("17:59") === false, "17:59 não conta como noite");
ok(ehNoite("19:30") === true, "19:30 conta como noite");

const fixo = { plan: "mensalista", mensalistaTipo: "fixo", podeSabado: false, podeNoite: false };
const fixoHerdado = { plan: "mensalista", mensalistaTipo: "fixo", podeSabado: true, podeNoite: true };
const escala = { plan: "mensalista", mensalistaTipo: "escala", podeSabado: false, podeNoite: false };
const avulsa = { plan: "avulso" };
const HOJE = "2026-08-24"; // segunda

const c = (cli, alvo, ctx = {}) => checarRegras(cli, alvo, { hoje: HOJE, aulasAtivas: [], ...ctx });

console.log("\n— fixo —");
ok(c(fixo, { date: "2026-08-22", time: "10:00" }).codigo === "sabado", "fixo: sábado barrado");
ok(c(fixo, { date: "2026-08-24", time: "18:00" }).codigo === "noite", "fixo: 18:00 barrado");
ok(c(fixo, { date: "2026-08-24", time: "17:30" }).ok === true, "fixo: 17:30 passa");
ok(c(fixo, { date: "2026-08-24", time: "09:00" }).ok === true, "fixo: seg 09:00 passa");

console.log("\n— fixo com direito herdado —");
ok(c(fixoHerdado, { date: "2026-08-22", time: "10:00" }).ok === true, "herdado: sábado passa");
ok(c(fixoHerdado, { date: "2026-08-24", time: "18:00" }).ok === true, "herdado: 18:00 passa");

console.log("\n— avulsa (fora do plano de mensalista) —");
ok(c(avulsa, { date: "2026-08-22", time: "19:00" }).ok === true, "avulsa: sábado à noite passa");

console.log("\n— escala: janela de marcação —");
const alvoOk = { date: "2026-08-26", time: "09:00" }; // quarta
ok(c(escala, alvoOk, { aulasAtivas: [] }).ok === true,
  "escala sem nenhuma aula em aberto: janela aberta (não trava a primeira)");
ok(c(escala, alvoOk, { aulasAtivas: [{ date: HOJE, time: "14:00", status: "confirmada" }] }).ok === true,
  "escala com aula HOJE: pode marcar");
ok(c(escala, alvoOk, { aulasAtivas: [{ date: "2026-08-27", time: "14:00", status: "confirmada" }] }).codigo === "escala",
  "escala com aula só na quinta: barrada hoje");
ok(c(escala, alvoOk, { aulasAtivas: [{ date: HOJE, time: "14:00", status: "cancelada" }] }).ok === true,
  "escala: aula cancelada hoje não conta, mas sem outra aula a janela abre");
ok(c(escala, alvoOk, {
  aulasAtivas: [{ date: HOJE, time: "14:00", status: "cancelada" }, { date: "2026-08-28", time: "09:00", status: "confirmada" }],
}).codigo === "escala", "escala: liberou a de hoje e tem outra na sexta → barrada");
ok(c(escala, alvoOk, {
  aulasAtivas: [{ date: HOJE, time: "14:00", status: "confirmada" }, { date: "2026-08-28", time: "09:00", status: "confirmada" }],
}).ok === true, "escala: com aula hoje pode marcar mais de uma (sem teto no dia)");

console.log("\n— escala: as regras de horário valem junto —");
ok(c(escala, { date: "2026-08-22", time: "09:00" }, { aulasAtivas: [{ date: HOJE, time: "14:00", status: "confirmada" }] }).codigo === "sabado",
  "escala: sábado barrado mesmo com a janela aberta");
ok(c(escala, { date: "2026-08-26", time: "18:30" }, { aulasAtivas: [{ date: HOJE, time: "14:00", status: "confirmada" }] }).codigo === "noite",
  "escala: 18:30 barrado mesmo com a janela aberta");

console.log("\n— ignorarJanela (aula extra / 1ª aula oficial / lote) —");
ok(c(escala, alvoOk, { aulasAtivas: [{ date: "2026-08-27", time: "14:00", status: "confirmada" }], ignorarJanela: true }).ok === true,
  "ignorarJanela: a janela da escala não se aplica");
ok(c(escala, { date: "2026-08-22", time: "09:00" }, { ignorarJanela: true }).codigo === "sabado",
  "ignorarJanela: sábado continua barrado");

console.log("\n— horarioPermitido (filtro do portal e do lote) —");
ok(horarioPermitido(fixo, { date: "2026-08-22", time: "09:00" }) === false, "filtro: sábado fora");
ok(horarioPermitido(fixo, { date: "2026-08-24", time: "18:00" }) === false, "filtro: 18:00 fora");
ok(horarioPermitido(fixoHerdado, { date: "2026-08-22", time: "18:00" }) === true, "filtro: herdado mantém");
ok(horarioPermitido(avulsa, { date: "2026-08-22", time: "20:00" }) === true, "filtro: avulsa não é filtrada");

console.log("\n— janelaEscala: mensagem —");
const j = janelaEscala([{ date: "2026-08-27", time: "14:00", status: "confirmada" }], HOJE);
ok(j.aberta === false && /quinta, 27\/08/.test(j.motivo), `mensagem cita o dia da próxima aula: "${j.motivo}"`);

/* ===================== teto de aulas por semana (plano 1x/2x) ===================== */
// Semana de 24/08 (seg) a 30/08 (dom) de 2026
console.log("\n— semana: segunda a domingo —");
ok(segundaDaSemana("2026-08-24") === "2026-08-24", "segunda é o começo da própria semana");
ok(segundaDaSemana("2026-08-30") === "2026-08-24", "domingo 30/08 ainda é a semana da segunda 24/08");
ok(segundaDaSemana("2026-08-31") === "2026-08-31", "segunda 31/08 já é a semana seguinte");
ok(mesmaSemana("2026-08-25", "2026-08-28") === true, "terça e sexta da mesma semana");
ok(mesmaSemana("2026-08-30", "2026-08-31") === false, "domingo e a segunda seguinte são semanas diferentes");

const plano1x = { plan: "mensalista", mensalistaTipo: "fixo", weeklyFreq: 1, podeSabado: false, podeNoite: false };
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

console.log("\n— teto: barra na hora de marcar —");
const alvoQua = { date: "2026-08-26", time: "09:00" }; // quarta
ok(c(plano1x, alvoQua, { aulasAtivas: [] }).ok === true, "1x sem nada na semana: pode marcar");
ok(c(plano1x, alvoQua, { aulasAtivas: [doPlano("2026-08-25")] }).codigo === "teto", "1x com 1 aula na semana: barrada");
ok(c(plano2x, alvoQua, { aulasAtivas: [doPlano("2026-08-25")] }).ok === true, "2x com 1 aula na semana: ainda pode");
ok(c(plano2x, alvoQua, { aulasAtivas: [doPlano("2026-08-25"), doPlano("2026-08-27")] }).codigo === "teto",
  "2x com 2 aulas na semana: barrada");
ok(c(plano1x, { date: "2026-08-31", time: "09:00" }, { aulasAtivas: [doPlano("2026-08-25")] }).ok === true,
  "1x: a semana que vem está livre de novo");
ok(c(plano1x, alvoQua, { aulasAtivas: [reposicao("2026-08-25"), extraPaga("2026-08-27")] }).ok === true,
  "reposição e extra na semana não fecham a vaga do plano");
ok(c(plano1x, alvoQua, { aulasAtivas: [doPlano("2026-08-25")], ignorarTeto: true }).ok === true,
  "ignorarTeto: reposição e aula extra passam por cima do teto");
ok(c(planoAntigo, alvoQua, { aulasAtivas: [doPlano("2026-08-25"), doPlano("2026-08-27")] }).ok === true,
  "plano antigo não é barrado pelo teto");

console.log("\n— ordem das regras: sábado/noite vêm antes do teto —");
ok(c(plano1x, { date: "2026-08-22", time: "09:00" }, { aulasAtivas: [doPlano("2026-08-19")] }).codigo === "sabado",
  "sábado é o motivo, mesmo com a semana cheia");

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

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os casos passaram.");
process.exit(falhas ? 1 : 0);
