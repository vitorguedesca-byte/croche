// Teste das regras de marcação do mensalista (backend/src/regrasAula.js)
import {
  checarRegras, janelaReposicaoEscala, freqNaData, podeReplicarMensalista,
  segundaDaSemana, mesmaSemana, tetoSemanal, PGTO_PLANO,
  limiteMensalEscala, tetoCicloEscala, aulasDoPacote, compPorExtenso,
  cicloEscala, cicloEscalaNaData, resumoCiclosEscala,
  somarComp, diaDoMes,
  encargosDaMensalidade, diasEntreISO, MULTA_ATRASO_REAIS, JUROS_DIA_PERCENTUAL,
  primeiroPagamento, mensalidadeDoPagamento,
  prazoLiberacao, liberouATempo, REPO_HORAS_MIN, motivoSemCredito,
  contaNoTeto, PGTO_PRESENTE, PRESENTE_VALIDADE_DIAS, validadePresente, situacaoPresente, presenteParaAula,
  ehSabado, fixaSemSabado, PGTO_REPOSICAO, PGTO_EXTRA,
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

/* Regra de 31/10/2026: a fixa de semana não repõe no sábado. Só o destino da
   reposição muda: os casos acima continuam valendo. 24/08 = segunda, 22/08 e 29/08 = sábado. */
console.log("\n— reposição da fixa de semana não vai para o sábado —");
const plano = (date, time = "09:00") => ({ date, time, status: "confirmada", paymentMethod: PGTO_PLANO });
ok(ehSabado("2026-08-22") === true && ehSabado("2026-08-21") === false && ehSabado("2026-08-23") === false, "ehSabado: só o sábado");
ok(fixaSemSabado(fixo, [plano("2026-08-24")]) === true, "fixa só de semana: sem sábado");
ok(fixaSemSabado(fixo, [plano("2026-08-24"), plano("2026-08-29")]) === false, "fixa com semana e sábado na grade: pode");
ok(fixaSemSabado(fixo, [plano("2026-08-29")]) === false, "fixa só de sábado: pode");
ok(fixaSemSabado(fixo, []) === false, "fixa sem grade pela frente: não barra");
ok(fixaSemSabado(escala, [plano("2026-08-24")]) === false, "escala: sem trava");
ok(fixaSemSabado(avulsa, [plano("2026-08-24")]) === false, "avulsa: sem trava");
ok(fixaSemSabado(fixo, [plano("2026-08-24"), { ...plano("2026-08-29"), paymentMethod: PGTO_REPOSICAO }]) === true,
  "reposição marcada no sábado não põe o sábado na grade");
ok(fixaSemSabado(fixo, [plano("2026-08-24"), { ...plano("2026-08-29"), status: "cancelada" }]) === true,
  "aula cancelada de sábado não põe o sábado na grade");

// Exceção de 05/11/2026: horário regular de semana a partir das 18h libera sábado.
ok(fixaSemSabado(fixo, [plano("2026-08-24", "17:59")]) === true, "fixa às 17:59: sábado continua bloqueado");
ok(fixaSemSabado(fixo, [plano("2026-08-24", "18:00")]) === false, "fixa às 18:00: pode repor no sábado");
ok(fixaSemSabado(fixo, [plano("2026-08-24", "19:30")]) === false, "fixa após as 18h: pode repor no sábado");
ok(fixaSemSabado(fixo, [plano("2026-08-24", "18:00 as 20:00")]) === false, "faixa das 18h às 20h: pode repor no sábado");
ok(fixaSemSabado(fixo, [plano("2026-08-24", "16:00 as 18:00")]) === true, "aula que termina às 18h: sábado continua bloqueado");
ok(fixaSemSabado(fixo, [plano("2026-08-24", "9:00")]) === true, "horário sem zero à esquerda não libera sábado");
ok(fixaSemSabado(fixo, [plano("2026-08-24"), plano("2026-08-26", "18:00")]) === false,
  "grade mista de manhã e noite: pode repor no sábado");
ok(fixaSemSabado(fixo, [plano("2026-08-24"), { ...plano("2026-08-26", "18:00"), status: "cancelada" }]) === true,
  "aula noturna cancelada não libera sábado");
for (const paymentMethod of [PGTO_REPOSICAO, PGTO_EXTRA, PGTO_PRESENTE]) {
  ok(fixaSemSabado(fixo, [plano("2026-08-24"), { ...plano("2026-08-26", "18:00"), paymentMethod }]) === true,
    `${paymentMethod} à noite não altera o horário regular nem libera sábado`);
}

console.log("\n— avulsa (fora do plano de mensalista) —");
ok(c(avulsa, { date: "2026-08-22", time: "19:00" }).ok === true, "avulsa: sábado à noite passa");

console.log("\n— recorrência por tipo de mensalista —");
ok(podeReplicarMensalista(fixo) === true, "mensalista fixa pode participar da grade replicada");
ok(podeReplicarMensalista(escala) === false, "mensalista de escala nunca é replicada");
ok(podeReplicarMensalista(avulsa) === false, "aluna avulsa não entra em grade replicada");

console.log("\n— escala: ciclo pago de vencimento a vencimento —");
const alvoOk = { date: "2026-08-26", time: "09:00" };
const doPlanoEm = (date, extra = {}) => ({ date, time: "09:00", status: "confirmada", paymentMethod: PGTO_PLANO, ...extra });
const fatura = (dueDate, status = "pago") => ({ competencia: dueDate.slice(0, 7), dueDate, status });
const agostoPago = { mensalidades: [fatura("2026-08-10")] };
const doisCiclosPagos = { mensalidades: [fatura("2026-08-10"), fatura("2026-09-10")] };
const verificarEscala = (date, hoje, cobranca = agostoPago) =>
  c(escala, { date, time: "09:00" }, { hoje, cobranca });

ok(verificarEscala("2026-08-11", "2026-08-09").codigo === "escala", "pagamento antecipado: dia 9 ainda não abre a marcação do ciclo");
ok(verificarEscala("2026-08-11", "2026-08-10").codigo === "escala", "a marcação do novo ciclo fica fechada no dia 10");
ok(verificarEscala("2026-08-11", "2026-08-11").ok, "no dia 11, a mensalidade paga libera o ciclo");
ok(verificarEscala("2026-09-09", "2026-08-24").ok, "dia 9 do mês seguinte é a última data que pode reservar");
ok(verificarEscala("2026-09-10", "2026-08-24").codigo === "escala", "o próximo vencimento fica fora da marcação pelo portal");
ok(verificarEscala("2026-09-11", "2026-09-09", doisCiclosPagos).codigo === "escala", "quitação do próximo ciclo não abre o dia 11 antecipadamente");
ok(verificarEscala("2026-08-20", "2026-08-24").codigo === "escala", "data de aula passada é recusada");
ok(verificarEscala("2026-08-25", "2026-08-24", {}).codigo === "mensalidade_escala", "sem cobrança quitada, o ciclo fica fechado");
for (const status of ["pendente", "cancelado"]) {
  const cobranca = { mensalidades: [fatura("2026-08-10", status), fatura("2026-09-10")] };
  ok(verificarEscala("2026-08-25", "2026-08-24", cobranca).codigo === "mensalidade_escala", `agosto ${status}: o pagamento de setembro não libera o ciclo de agosto`);
}
ok(verificarEscala("2026-09-09", "2026-09-01", {
  mensalidades: [{ ...fatura("2026-08-10"), paidAt: "2026-09-01" }],
}).ok, "pagamento em atraso libera o restante do mesmo ciclo");
ok(verificarEscala("2027-01-09", "2026-12-11", { mensalidades: [fatura("2026-12-10")] }).ok, "o ciclo pode cruzar a virada do ano");

const cicloAgosto = cicloEscala(escala, "2026-08", agostoPago);
const cicloSetembro = cicloEscala(escala, "2026-09", agostoPago);
ok(cicloAgosto.inicio === "2026-08-11" && cicloAgosto.fim === "2026-09-09", "borda do ciclo reflete os dois vencimentos");
ok(cicloEscala({ ...escala, billingDay: 28 }, "2027-02").inicio === "2027-03-01", "dia seguinte ao vencimento atravessa fevereiro");
ok(cicloEscala(escala, "2026-08", { vencimentoDia: 20 }).inicio === "2026-08-21", "usa o padrão da escola quando não há dia no cadastro");
const comVencimentosRegistrados = { mensalidades: [fatura("2026-08-13"), fatura("2026-09-17", "pendente")] };
const cicloComVencimentosRegistrados = cicloEscala({ ...escala, billingDay: 10 }, "2026-08", comVencimentosRegistrados);
ok(cicloComVencimentosRegistrados.inicio === "2026-08-14" && cicloComVencimentosRegistrados.fim === "2026-09-16", "vencimento registrado na cobrança prevalece sobre o padrão");
ok(cicloEscalaNaData(escala, "2026-09-16", comVencimentosRegistrados).competencia === "2026-08", "o saldo segue a fatura anterior até a véspera da próxima");
const cobrancaRetroativa = { mensalidades: [{ ...fatura("2026-09-12"), competencia: "2026-08" }] };
ok(cicloEscala(escala, "2026-08", cobrancaRetroativa).inicio === "2026-08-11", "emissão retroativa em outro mês conserva o ciclo nominal");

console.log("\n— escala: pacote sem teto semanal —");
ok(c(escala, alvoOk, { cobranca: agostoPago }).ok, "primeira aula do pacote passa");
ok(c(escala, { date: "2026-08-29", time: "18:30" }, { cobranca: agostoPago }).ok, "sábado à noite passa");
const aulasNaSemana = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"].map(d => doPlanoEm(d));
const alvoNaSemana = { date: "2026-08-28", time: "15:00" };
ok(c(escala, alvoNaSemana, { cobranca: agostoPago, todasAulas: aulasNaSemana.slice(0, 3) }).ok, "1x: as quatro aulas podem cair na mesma semana");

const escala120 = { ...escala, weeklyFreq: 1, monthlyValue: 120 };
const escala200 = { ...escala, weeklyFreq: 2, monthlyValue: 200 };
ok(c(escala200, alvoNaSemana, { cobranca: agostoPago, todasAulas: aulasNaSemana }).ok, "2x: a quinta aula da semana passa");
ok(limiteMensalEscala(escala120, "2026-08") === 4, "1x tem 4 aulas no ciclo");
ok(limiteMensalEscala(escala200, "2026-08") === 8, "2x tem 8 aulas no ciclo");

const aulas4 = ["2026-08-11", "2026-08-25", "2026-09-01", "2026-09-09"].map(d => doPlanoEm(d));
ok(tetoCicloEscala(escala120, cicloAgosto, aulas4).restantes === 0, "aulas nos dois meses consomem o mesmo pacote de 4");
ok(tetoCicloEscala(escala200, cicloAgosto, aulas4).restantes === 4, "plano de 8 ainda tem 4 aulas");
ok(c(escala120, { date: "2026-09-05" }, { cobranca: agostoPago, todasAulas: aulas4 }).codigo === "teto_mes", "5ª aula no mesmo ciclo é bloqueada mesmo atravessando o mês");
ok(c(escala120, { date: "2026-09-12" }, { hoje: "2026-09-11", cobranca: doisCiclosPagos, todasAulas: aulas4 }).ok, "novo ciclo pago tem pacote próprio");
ok(tetoCicloEscala(escala120, cicloAgosto, [doPlanoEm("2026-09-10")]).marcadas === 1, "reserva já existente no vencimento ainda consome saldo do ciclo que fecha");
const planoAlterado = { ...escala200, monthlyValue: null, weeklyFreqAnterior: 1, weeklyFreqDesde: "2026-09" };
const resumo = resumoCiclosEscala(planoAlterado, HOJE, doisCiclosPagos, aulas4);
ok(resumo[0].limite === 4 && resumo[1].limite === 8, "mudança de frequência acompanha a competência da cobrança");
ok(resumo[0].atingido && /11\/09/.test(resumo[1].bloqueio), "resumo do portal distingue ciclo cheio de ciclo pago que ainda vai abrir");
ok(resumoCiclosEscala(escala, "2026-09-11", doisCiclosPagos, aulas4)[0].bloqueio === "", "resumo libera o mesmo ciclo que a API de marcação");

console.log("\n— escala: aulas que consomem o pacote —");
const tres = aulas4.slice(0, 3);
const liberada = doPlanoEm("2026-09-09", { status: "cancelada", liberada: true });
const tiradaPelaEscola = doPlanoEm("2026-09-09", { status: "cancelada" });
ok(aulasDoPacote([...tres, liberada], cicloAgosto) === 4, "aula liberada continua contando no pacote");
ok(aulasDoPacote([...tres, tiradaPelaEscola], cicloAgosto) === 3, "cancelamento pela escola sem crédito devolve a vaga ao pacote");
ok(aulasDoPacote([...tres, liberada, doPlanoEm("2026-09-09")], cicloAgosto) === 4, "liberação e retorno da mesma aula contam uma vez");
ok(aulasDoPacote([...tres, liberada, { ...liberada }], cicloAgosto) === 4, "a mesma aula liberada duas vezes conta uma vez");
ok(aulasDoPacote([...tres, liberada], cicloSetembro) === 0, "aulas do ciclo anterior ficam fora do novo pacote");
for (const paymentMethod of [PGTO_REPOSICAO, PGTO_EXTRA, PGTO_PRESENTE]) {
  const aula = doPlanoEm("2026-09-09", { paymentMethod, status: "cancelada", liberada: true });
  ok(aulasDoPacote([...tres, aula], cicloAgosto) === 3, `${paymentMethod} fica fora do pacote, mesmo quando liberada`);
}

console.log("\n— escala: marcação pela secretaria, reposição e passes —");
ok(c(escala, { date: "2026-10-06" }, { ignorarJanela: true }).ok, "secretaria pode marcar sem quitação e fora da janela do portal");
ok(c(escala, { date: "2026-09-05" }, { ignorarJanela: true, cobranca: agostoPago, todasAulas: aulas4 }).codigo === "teto_mes", "secretaria usa o mesmo saldo do ciclo");
ok(c(escala, { date: "2026-09-05" }, { ignorarJanela: true, ignorarTeto: true, todasAulas: aulas4 }).ok, "aula extra ou presente passa sem consumir o pacote");
ok(janelaReposicaoEscala(HOJE, "2026-09-30").aberta, "reposição pode usar o mês seguinte inteiro, conforme as regras de crédito");
ok(!janelaReposicaoEscala(HOJE, "2026-10-01").aberta, "reposição ainda tem o limite de dois meses no calendário");

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
