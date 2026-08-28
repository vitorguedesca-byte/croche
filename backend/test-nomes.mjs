// Teste da padronização de nomes (backend/src/nomes.js)
import { padronizarNome, chaveNome, precisaPadronizar } from "./src/nomes.js";

let falhas = 0;
const eq = (entrada, esperado) => {
  const obtido = padronizarNome(entrada);
  const ok = obtido === esperado;
  console.log(`${ok ? "  ok" : "FALHA"}  ${JSON.stringify(entrada)} → ${JSON.stringify(obtido)}${ok ? "" : `  (esperado ${JSON.stringify(esperado)})`}`);
  if (!ok) falhas++;
};
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };

console.log("— caixa e espaços —");
eq("MARIA DA SILVA", "Maria da Silva");
eq("maria  da silva", "Maria da Silva");
eq("  Maria Da Silva  ", "Maria da Silva");
eq("maria", "Maria");

console.log("\n— conectivos: minúscula só no meio —");
eq("JOAO DOS SANTOS DE OLIVEIRA", "Joao dos Santos de Oliveira");
// conectivo na última posição costuma ser digitação pela metade: fica normal
eq("maria de", "Maria De");

console.log("\n— junções internas —");
/* ATENÇÃO — comportamento atual, que CONTRADIZ o comentário do módulo.
   nomes.js diz "a partícula antes do apóstrofo fica minúscula quando tem 1
   letra" (ou seja, "d'Ávila"), mas o código faz maiuscula(parte) e devolve
   "D'Ávila". A contradição é anterior à correção dos parênteses (28/08) e não
   foi mexida aqui para não alterar nome já gravado sem decisão. O teste fixa o
   que o sistema REALMENTE faz — se a regra for decidida, muda nos dois. */
eq("ana-maria d'ávila", "Ana-Maria D'Ávila");
eq("D ' Ávila", "D'Ávila");
eq("joao paulo ii", "Joao Paulo II");

console.log("\n— parênteses: apelido/nome da criança (o defeito de 28/08) —");
// Sem espaço antes do abre, o nome colava numa palavra só: "Costaalice".
eq("Vanessa Moreira Costa(Alice )", "Vanessa Moreira Costa (Alice)");
eq("Vanessa Moreira Costa(Isabele)", "Vanessa Moreira Costa (Isabele)");
eq("Viviane Luzia da Silva ( Larissa)", "Viviane Luzia da Silva (Larissa)");
eq("Ana(Bia)", "Ana (Bia)");
eq("ANA ( BIA )", "Ana (Bia)");
eq("Joao(2)", "Joao (2)");
// o conteúdo do parêntese segue as mesmas regras de caixa
eq("ana (maria da silva)", "Ana (Maria da Silva)");
// parêntese vazio não diz nada
eq("Ana ()", "Ana");
// desemparelhado é digitação pela metade: o sinal sai, o conteúdo fica
eq("Ana(Bia", "Ana Bia");
eq("Ana Bia)", "Ana Bia");

console.log("\n— charset gravado errado (mojibake) —");
eq("JosÃ© da Silva", "José da Silva");
eq("ConceiÃ§Ã£o", "Conceição");

console.log("\n— caractere que não é nome —");
eq("Maria Silva 🧶", "Maria Silva");
eq("Maria Silva.", "Maria Silva");
eq("Ana “Neneza” Souza", "Ana Neneza Souza");

console.log("\n— não inventa acento —");
eq("jose", "Jose");
eq("ines", "Ines");

console.log("\n— casos de borda —");
eq(null, "");
eq("", "");
eq("   ", "");
eq("🧶", "");

console.log("\n— chaveNome: mesma pessoa escrita de formas diferentes —");
ok(chaveNome("MARIA SILVA") === chaveNome("maria  silva"), "caixa e espaço não mudam a chave");
ok(chaveNome("José") === chaveNome("Jose"), "acento não muda a chave");
ok(chaveNome("Costa (Alice)") !== chaveNome("Costa (Isabele)"), "apelidos diferentes são pessoas diferentes");
ok(chaveNome("Ana") !== chaveNome("Ana Paula"), "nomes diferentes têm chaves diferentes");

console.log("\n— precisaPadronizar —");
ok(precisaPadronizar("MARIA DA SILVA") === true, "nome torto precisa");
ok(precisaPadronizar("Maria da Silva") === false, "nome já certo não precisa");
ok(precisaPadronizar("Vanessa Moreira Costa (Alice)") === false, "nome com parêntese já certo não precisa");

console.log("\n— idempotência: padronizar duas vezes não muda —");
for (const n of ["MARIA DA SILVA", "Vanessa Moreira Costa(Alice )", "ana-maria d'ávila", "Ana(Bia", "joao paulo ii"]) {
  const uma = padronizarNome(n);
  ok(padronizarNome(uma) === uma, `estável: ${JSON.stringify(uma)}`);
}

console.log(falhas ? `\n${falhas} caso(s) falharam.` : "\nTodos os casos passaram.");
process.exit(falhas ? 1 : 0);
