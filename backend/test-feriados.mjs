// Teste do calendário de feriados (backend/src/feriados.js)
//
// Em feriado a escola não abre. As datas fixas qualquer um confere de cabeça; o
// que precisa de teste são as MÓVEIS — Carnaval, Sexta-feira Santa e Corpus
// Christi andam com a Páscoa, e uma conta errada aqui fecha a escola no dia
// errado (ou a mantém aberta num feriado). Os valores abaixo são as datas reais
// desses anos, conferidas fora do sistema.
import {
  domingoDePascoa, feriadosNacionais, calendarioFeriados,
  anosDoCalendario, feriadoDe, ehFeriado,
} from "./src/feriados.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };

console.log("\n— Páscoa (âncora dos móveis) —");
const PASCOA = { 2024: "2024-03-31", 2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28", 2028: "2028-04-16" };
for (const [ano, esperado] of Object.entries(PASCOA))
  ok(domingoDePascoa(Number(ano)) === esperado, `Páscoa de ${ano} = ${esperado}`);

console.log("\n— móveis de 2026 —");
const c26 = feriadosNacionais(2026);
ok(c26["2026-02-17"] === "Carnaval", "Carnaval 2026 = 17/02");
ok(c26["2026-04-03"] === "Sexta-feira Santa", "Sexta-feira Santa 2026 = 03/04");
ok(c26["2026-06-04"] === "Corpus Christi", "Corpus Christi 2026 = 04/06");

console.log("\n— móveis de 2025 (ano diferente, datas diferentes) —");
const c25 = feriadosNacionais(2025);
ok(c25["2025-03-04"] === "Carnaval", "Carnaval 2025 = 04/03");
ok(c25["2025-04-18"] === "Sexta-feira Santa", "Sexta-feira Santa 2025 = 18/04");
ok(c25["2025-06-19"] === "Corpus Christi", "Corpus Christi 2025 = 19/06");

console.log("\n— fixos —");
ok(c26["2026-12-25"] === "Natal", "Natal");
ok(c26["2026-09-07"] === "Independência do Brasil", "7 de setembro");
ok(c26["2026-05-01"] === "Dia do Trabalho", "1º de maio");

/* Consciência Negra virou feriado NACIONAL pela Lei 14.759/2023. Antes disso
   era feriado só em parte dos municípios — o calendário de anos anteriores não
   pode sair errado no histórico. */
console.log("\n— Consciência Negra: nacional a partir de 2024 —");
ok(!!feriadosNacionais(2024)["2024-11-20"], "2024: é feriado nacional");
ok(!feriadosNacionais(2023)["2023-11-20"], "2023: ainda não era");

console.log("\n— lista manual da escola —");
const cal = calendarioFeriados([2026], [
  { date: "2026-04-28", nome: "Aniversário de Ipatinga", remove: false },
  { date: "2026-11-20", nome: "Abrimos normalmente", remove: true },
  { date: "não é data", nome: "lixo" },
]);
ok(feriadoDe(cal, "2026-04-28") === "Aniversário de Ipatinga", "municipal cadastrado entra");
ok(ehFeriado(cal, "2026-11-20") === false, "manual DESMARCA um nacional (a escola abre)");
ok(ehFeriado(cal, "2026-12-25") === true, "o resto do calendário nacional continua valendo");
ok(ehFeriado(cal, "2026-09-02") === false, "dia comum não é feriado");
ok(Object.keys(cal).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), "entrada inválida é ignorada");

/* O calendário precisa atravessar a virada do ano: a replicação de turma vai
   até 52 semanas à frente, e uma turma replicada em dezembro cai em janeiro. */
console.log("\n— cobertura de anos —");
const anos = anosDoCalendario("2026-12-30");
ok(anos.includes(2027) && anos.includes(2026), "inclui o ano seguinte");
const cal2 = calendarioFeriados(anosDoCalendario("2026-12-30"), []);
ok(ehFeriado(cal2, "2027-01-01") === true, "1º de janeiro do ano que vem já é feriado");
ok(ehFeriado(cal2, "2027-02-09") === true, "Carnaval de 2027 (móvel) também");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os casos passaram.");
process.exit(falhas ? 1 : 0);
