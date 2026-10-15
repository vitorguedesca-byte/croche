// Teste de "Liberar turma por completo": o que cada aluna recebe (backend/src/regrasAula.js)
import { destinoNaTurmaFechada, PGTO_PLANO, PGTO_REPOSICAO, PGTO_EXTRA, PGTO_PRESENTE } from "./src/regrasAula.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };
const tipo = (b, c) => destinoNaTurmaFechada(b, c).tipo;

const mensalista = { plan: "mensalista", status: "ativo" };
const avulsa = { plan: "avulso", status: "ativo" };
const cancelada = { plan: "mensalista", status: "cancelado" };

console.log("\n— mensalista —");
ok(tipo({ paymentMethod: PGTO_PLANO, paid: false }, mensalista) === "credito", "aula do plano → crédito garantido (mesmo sem `paid`)");
ok(tipo({ paymentMethod: PGTO_REPOSICAO, paid: true }, mensalista) === "devolver_credito", "reposição → o crédito gasto volta");
ok(tipo({ paymentMethod: PGTO_PRESENTE, paid: true }, mensalista) === "devolver_presente", "presente → o presente volta");
ok(tipo({ paymentMethod: PGTO_EXTRA, paid: true }, mensalista) === "devolver_passe", "aula extra → o passe volta");
ok(tipo({ paymentMethod: "1ª mensalidade", paid: true }, mensalista) === "credito", "matrícula paga de quem já é mensalista → crédito");

console.log("\n— avulsa / entrada —");
ok(tipo({ paymentMethod: "Pix", paid: true }, avulsa) === "presente", "avulsa paga → aula de presente");
ok(tipo({ paymentMethod: "1ª mensalidade", paid: false }, avulsa) === "nada", "reserva não paga → só sai");
ok(tipo({ paymentMethod: PGTO_PLANO, paid: false }, avulsa) === "nada", "aula do plano de quem deixou de ser mensalista → só sai");
ok(tipo({ paymentMethod: PGTO_EXTRA, paid: true }, avulsa) === "devolver_passe", "aula extra da avulsa → o passe volta");

console.log("\n— sem direito —");
ok(tipo({ paymentMethod: PGTO_PLANO, paid: false }, cancelada) === "nada", "inscrição cancelada → sem crédito");
ok(tipo({ paymentMethod: PGTO_REPOSICAO, paid: true }, cancelada) === "nada", "cancelada não recupera nem a reposição");
ok(tipo({ paymentMethod: "Pix", paid: true }, null) === "nada", "sem ficha → sem crédito");
ok(!!destinoNaTurmaFechada({ paymentMethod: "Pix", paid: false }, avulsa).motivo, "quem sai sem nada leva o motivo escrito");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
