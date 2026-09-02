/* Testes das regras da conversa do WhatsApp (backend/src/waFluxo.js).
   Rodar:  node test-wa-fluxo.mjs

   O que está aqui é o que a escola PROMETE para quem escreve: não oferecer aula
   que já começou, dizer a lotação como ela é, e não perder a aluna num campo de
   cadastro por causa de um formato de data. */

import {
  CONVERSA_EXPIRA_H,
  WA_ANTECEDENCIA_MIN,
  conversaExpirou,
  descricaoDaTurma,
  DESCRICAO_MAX,
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
} from "./src/waFluxo.js";

let falhas = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok " : "FALHOU"}  ${msg}`);
  if (!cond) falhas++;
};
const eq = (a, b, msg) => ok(a === b, `${msg}${a === b ? "" : `  (esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)})`}`);
const titulo = (t) => console.log(`\n— ${t} —`);

/* ============ horário que já passou não aparece ============ */
titulo("hora de corte: o pedido do Vitor — quem escreve à tarde não vê a manhã");
eq(horaDeCorte("15:00"), "15:45", `entrou às 15:00 → corte às 15:45 (folga de ${WA_ANTECEDENCIA_MIN} min)`);
eq(horaDeCorte("08:10"), "08:55", "entrou às 08:10 → corte às 08:55");
eq(horaDeCorte("23:30"), "99:99", "entrou às 23:30 → a folga passa da meia-noite: nada de hoje serve");
eq(horaDeCorte("00:00"), "00:45", "meia-noite em ponto ainda deixa o resto do dia");

titulo("o corte vale só para HOJE");
const HOJE = "2026-09-01", corte = horaDeCorte("15:00");
ok(!slotAindaDaTempo({ date: HOJE, time: "09:00" }, HOJE, corte), "aula de hoje às 09:00, escrevendo às 15:00 → fora");
ok(!slotAindaDaTempo({ date: HOJE, time: "15:30" }, HOJE, corte), "aula de hoje às 15:30 → fora (menos de 45 min)");
ok(slotAindaDaTempo({ date: HOJE, time: "15:45" }, HOJE, corte), "aula de hoje às 15:45 → entra, no limite exato");
ok(slotAindaDaTempo({ date: HOJE, time: "19:00" }, HOJE, corte), "aula de hoje às 19:00 → entra");
ok(slotAindaDaTempo({ date: "2026-09-02", time: "09:00" }, HOJE, corte), "amanhã de MANHÃ continua valendo — a regra é sobre hoje");
ok(slotAindaDaTempo({ date: HOJE, time: "16:00" }, HOJE, horaDeCorte("23:30")) === false, "às 23:30 nem o resto de hoje aparece");

titulo("horário fora do formato não derruba o filtro");
ok(slotAindaDaTempo({ date: HOJE, time: "19:00:00" }, HOJE, corte), "'19:00:00' (hora solta do banco) ainda é comparado certo");

/* ============ lotação das turmas ============ */
titulo("lotação: o que a aluna lê na lista");
eq(lotacaoDaTurma({ alunas: 0, capacidade: 6 }).nivel, "livre", "turma vazia → livre");
eq(lotacaoDaTurma({ alunas: 3, capacidade: 6 }).nivel, "livre", "3 de 6 → livre");
eq(lotacaoDaTurma({ alunas: 4, capacidade: 6 }).nivel, "quase", "4 de 6 (2 vagas) → quase esgotando");
eq(lotacaoDaTurma({ alunas: 5, capacidade: 6 }).nivel, "ultima", "5 de 6 → última vaga");
eq(lotacaoDaTurma({ alunas: 6, capacidade: 6 }).nivel, "esgotada", "6 de 6 → esgotada");
eq(lotacaoDaTurma({ alunas: 9, capacidade: 6 }).vagas, 0, "turma estourada não devolve vaga negativa");
eq(lotacaoDaTurma({ alunas: 5, capacidade: 6 }).txt, "última vaga!", "o aviso de última vaga é verdade verificável");

titulo("descrição da linha cabe no limite da Meta");
const desc = descricaoDaTurma({ time: "14:00", alunas: 5, capacidade: 6 });
ok(desc.includes("14:00"), `mostra a hora: "${desc}"`);
ok(desc.includes("5/6"), "mostra quantas alunas já estão na turma");
ok(desc.length <= DESCRICAO_MAX, `cabe em ${DESCRICAO_MAX} caracteres (tem ${desc.length})`);
ok(descricaoDaTurma({ time: "09:00", alunas: 0, capacidade: 12 }).length <= DESCRICAO_MAX, "o caso mais longo também cabe");

/* ============ data de nascimento ============ */
titulo("data de nascimento: aceitar como a pessoa escreve");
eq(parseNascimento("15/03/1990", 2026), "1990-03-15", "15/03/1990");
eq(parseNascimento("15-03-1990", 2026), "1990-03-15", "com traço");
eq(parseNascimento("15031990", 2026), "1990-03-15", "sem separador");
eq(parseNascimento("05/01/2001", 2026), "2001-01-05", "dia e mês com zero à esquerda");
eq(parseNascimento("29/02/2000", 2026), "2000-02-29", "29/02 de ano bissexto existe");

titulo("data de nascimento: o que tem que ser recusado");
eq(parseNascimento("31/02/1990", 2026), null, "31/02 não existe — não vira 03/03");
eq(parseNascimento("15/13/1990", 2026), null, "mês 13");
eq(parseNascimento("00/03/1990", 2026), null, "dia 0");
eq(parseNascimento("15/03/2030", 2026), null, "nascimento no futuro é dedo trocado");
eq(parseNascimento("15/03/1850", 2026), null, "ano absurdo");
eq(parseNascimento("15/03/90", 2026), null, "ano com 2 dígitos: ambíguo, melhor perguntar de novo");
eq(parseNascimento("", 2026), null, "vazio");
eq(parseNascimento("não sei", 2026), null, "texto");

/* ============ e-mail ============ */
titulo("e-mail: pegar o dedo trocado óbvio, sem policiar a RFC");
ok(emailValido("maria@gmail.com"), "maria@gmail.com");
ok(emailValido("maria.silva+aulas@dominio.com.br"), "com ponto e mais");
ok(!emailValido("maria@gmail"), "sem o .com");
ok(!emailValido("maria.gmail.com"), "sem o arroba");
ok(!emailValido("maria @gmail.com"), "com espaço");
ok(!emailValido(""), "vazio");

/* ============ telefone ============ */
titulo("telefone: mostrar o número para ela só confirmar");
eq(telefoneBR("5531999998888"), "(31) 99999-8888", "celular com o 55 na frente");
eq(telefoneBR("31999998888"), "(31) 99999-8888", "sem o 55");
eq(telefoneBR("553133334444"), "(31) 3333-4444", "fixo de 8 dígitos");
eq(telefoneBR("123"), "123", "número curto demais volta como veio, sem inventar formato");

/* ============ expiração da conversa ============ */
titulo(`conversa expira em ${CONVERSA_EXPIRA_H}h de silêncio dela`);
const AGORA = new Date("2026-09-01T20:00:00Z").getTime();
const hAtras = (h) => new Date(AGORA - h * 3600_000);
ok(!conversaExpirou(hAtras(1), AGORA), "1h de silêncio: continua de onde parou");
ok(!conversaExpirou(hAtras(11.9), AGORA), "11h54: ainda vale");
ok(conversaExpirou(hAtras(12), AGORA), "12h em ponto: recomeça");
ok(conversaExpirou(hAtras(48), AGORA), "dois dias depois: recomeça");
ok(!conversaExpirou(null, AGORA), "conversa que nunca recebeu mensagem não 'expira'");

/* ============ a vaga segurada por 10 minutos ============
   Vitor, 02/09/2026: o prazo caiu de 1h para 10 minutos e o aviso passou a sair
   a 3 do fim. O que este bloco guarda é a RELAÇÃO entre os três números — ela
   quebra em silêncio: com a varredura mais espaçada que o aviso, o último toque
   simplesmente não sai, ninguém vê o erro, e a aluna perde a vaga sem ele. */
titulo(`vaga segurada por ${HOLD_MIN} min, aviso a ${HOLD_AVISO_MIN} do fim`);
const emMin = (m) => new Date(AGORA + m * 60_000);
const acao = (m, nudged = false) => acaoDaReserva({ holdUntil: emMin(m), holdNudged: nudged }, AGORA).acao;

ok(acao(10) === "esperar", "recém-criada (faltam 10): não faz nada");
ok(acao(4) === "esperar", "faltando 4 min: ainda cedo para o aviso");
ok(acao(3) === "avisar", "faltando 3 min: sai o último toque");
ok(acao(1) === "avisar", "faltando 1 min: ainda dá para avisar");
ok(acao(3, true) === "esperar", "já avisado não é avisado de novo");
ok(acao(0) === "expirar", "no instante do fim: expira");
ok(acao(-5) === "expirar", "prazo estourado há 5 min: expira");
ok(acao(-5, true) === "expirar", "quem já foi avisado também expira");
ok(acaoDaReserva({ holdUntil: null }, AGORA).acao === "esperar", "reserva sem prazo não é tocada");

// O minuto mostrado na mensagem nunca é "0 minutos" — soa como já era.
ok(acaoDaReserva({ holdUntil: emMin(0.4) }, AGORA).faltam === 1, "menos de um minuto é dito como 1");

/* A trava que justifica os outros números: a varredura tem que caber dentro da
   janela do aviso. Se alguém subir RODADA_HOLD_MIN sem olhar, isto quebra. */
ok(RODADA_HOLD_MIN <= HOLD_AVISO_MIN,
  `a varredura (${RODADA_HOLD_MIN} min) cabe na janela do aviso (${HOLD_AVISO_MIN} min)`);
ok(HOLD_AVISO_MIN < HOLD_MIN, "o aviso sai antes do fim do prazo, não depois");

console.log(falhas ? `\n${falhas} caso(s) falharam.` : "\nTodos os casos passaram.");
process.exit(falhas ? 1 : 0);
