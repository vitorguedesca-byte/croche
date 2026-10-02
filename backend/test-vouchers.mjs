// Teste das regras das campanhas com código (backend/src/vouchers.js)
import {
  normalizarCodigo, aplicarDesconto, primeiroPagamentoComVoucher, motivoRecusa,
  situacaoCampanha, mesesSeguintes, limparCampanha, descreverBeneficios, temDesconto,
} from "./src/vouchers.js";
import { somarComp, mensalidadeDoPagamento } from "./src/regrasAula.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };
const HOJE = "2026-09-30";
const base = { ativo: true, publico: "novas", planos: "[]", descontoMeses: 1, valorExperimental: 0 };

console.log("\n— código —");
ok(normalizarCodigo(" bem-vinda 10 ") === "BEM-VINDA10", "maiúscula, sem espaço");
ok(normalizarCodigo("Promoção") === "PROMOCAO", "sem acento");

console.log("\n— desconto na mensalidade —");
ok(aplicarDesconto(120, { descontoTipo: "percentual", descontoValor: 50 }) === 60, "50% de 120 = 60");
ok(aplicarDesconto(120, { descontoTipo: "valor", descontoValor: 30 }) === 90, "R$30 a menos");
ok(aplicarDesconto(120, { descontoTipo: "valor", descontoValor: 300 }) === 0, "nunca negativo");
ok(aplicarDesconto(120, { descontoTipo: "preco", descontoValor: 99 }) === 99, "preço fixo 99");
ok(aplicarDesconto(120, { descontoTipo: "preco", descontoValor: 150 }) === 120, "preço fixo nunca acima do normal");
ok(aplicarDesconto(120, { descontoTipo: "preco", descontoValor: 0 }) === 0, "preço 0 = mês grátis");
ok(temDesconto({ descontoTipo: "preco", descontoValor: 0 }), "preço 0 conta como desconto");
ok(!temDesconto({ descontoTipo: "percentual", descontoValor: 0 }), "0% não é desconto");
ok(aplicarDesconto(200, null) === 200, "sem voucher, valor intacto");

console.log("\n— 1º pagamento (matrícula) —");
const v1 = { ...base, isentaMatricula: true };
let p = primeiroPagamentoComVoucher(v1, { mensalidade: 120, taxa: 20 });
ok(p.total === 120 && p.taxa === 0 && p.mensalidade === 120, "isenção: só a mensalidade");
ok(p.descontoCents === 2000, "isenção: R$20 de desconto");
// a fatura do mês tem de sair com a mensalidade, não com a soma
ok(mensalidadeDoPagamento({ pago: p.total, taxa: p.taxa || null }) === 120, "isenção: fatura do mês = 120");
const v2 = { ...base, isentaMatricula: true, descontoTipo: "percentual", descontoValor: 10, descontoMeses: 3 };
p = primeiroPagamentoComVoucher(v2, { mensalidade: 200, taxa: 20 });
ok(p.total === 180 && p.mensalidade === 180, "isenção + 10%: 180");
ok(mensalidadeDoPagamento({ pago: p.total, taxa: p.taxa || null }) === 180, "fatura do mês = 180");
const v3 = { ...base, descontoTipo: "valor", descontoValor: 20 };
p = primeiroPagamentoComVoucher(v3, { mensalidade: 120, taxa: 20 });
ok(p.total === 120 && p.taxa === 20 && p.mensalidade === 100, "R$20 na mensalidade, taxa mantida");
ok(mensalidadeDoPagamento({ pago: p.total, taxa: p.taxa }) === 100, "fatura do mês = 100 (sem a taxa)");

console.log("\n— aula experimental (avulsa) —");
const vx = { ...base, aulaExperimental: true, valorExperimental: 0 };
p = primeiroPagamentoComVoucher(vx, { avulsa: true, valorAvulsa: 40 });
ok(p.total === 0 && p.descontoCents === 4000, "experimental grátis");
p = primeiroPagamentoComVoucher({ ...vx, valorExperimental: 20 }, { avulsa: true, valorAvulsa: 40 });
ok(p.total === 20, "experimental por R$20");
p = primeiroPagamentoComVoucher({ ...vx, valorExperimental: 90 }, { avulsa: true, valorAvulsa: 40 });
ok(p.total === 40, "experimental nunca acima da avulsa");

console.log("\n— meses seguintes —");
ok(JSON.stringify(mesesSeguintes(v2, "2026-11", somarComp)) === JSON.stringify(["2026-12", "2027-01"]), "3 meses: o 1º no Pix, mais 2");
ok(mesesSeguintes({ ...base, isentaMatricula: true }, "2026-11", somarComp).length === 0, "sem desconto, nenhum mês");

console.log("\n— quem pode usar —");
const ctx = { hoje: HOJE, usados: 0 };
ok(motivoRecusa(null, ctx) !== null, "código inexistente recusa");
ok(motivoRecusa({ ...v1, ativo: false }, { ...ctx, contexto: "matricula" }).includes("encerrada"), "pausada recusa");
ok(motivoRecusa({ ...v1, fim: "2026-09-29" }, { ...ctx, contexto: "matricula" }).includes("encerrada"), "vencida recusa");
ok(motivoRecusa({ ...v1, inicio: "2026-10-01" }, { ...ctx, contexto: "matricula" }).includes("começa"), "futura recusa");
ok(motivoRecusa({ ...v1, fim: HOJE }, { ...ctx, contexto: "matricula" }) === null, "vale no último dia");
ok(motivoRecusa({ ...v1, limiteUsos: 5 }, { ...ctx, usados: 5, contexto: "matricula" }).includes("acabaram"), "esgotada (os X primeiros)");
ok(motivoRecusa({ ...v1, limiteUsos: 5 }, { ...ctx, usados: 4, contexto: "matricula" }) === null, "ainda tem vaga");
ok(motivoRecusa(v1, { ...ctx, contexto: "mensalidade" }) !== null, "código de aluna nova não vale na mensalidade");
ok(motivoRecusa({ ...v3, publico: "alunas" }, { ...ctx, contexto: "matricula" }) !== null, "código de aluna atual não vale na matrícula");
ok(motivoRecusa({ ...v3, publico: "todas" }, { ...ctx, contexto: "mensalidade" }) === null, "público todas vale na mensalidade");
ok(motivoRecusa(vx, { ...ctx, contexto: "matricula", freq: 1 }).includes("AVULSO"), "experimental pede a opção avulso");
ok(motivoRecusa(v1, { ...ctx, contexto: "avulsa" }) !== null, "isenção não vale na avulsa");
ok(motivoRecusa({ ...v1, planos: "[2]" }, { ...ctx, contexto: "matricula", freq: 1 }).includes("2x"), "restrição de plano");
ok(motivoRecusa({ ...v1, unidade: "Timóteo" }, { ...ctx, contexto: "matricula", unidade: "Ipatinga" }).includes("Timóteo"), "restrição de unidade");
ok(motivoRecusa({ ...base, premio: "Kit" }, { ...ctx, contexto: "avulsa" }) === null, "prêmio vale em qualquer 1º pagamento");

console.log("\n— situação —");
ok(situacaoCampanha({ ...v1, limiteUsos: 3 }, { hoje: HOJE, usados: 3 }).codigo === "esgotada", "esgotada");
ok(situacaoCampanha(v1, { hoje: HOJE }).codigo === "ativa", "ativa");

console.log("\n— formulário —");
ok(!!limparCampanha({ codigo: "AB", nome: "x", isentaMatricula: true }).erro, "código curto recusa");
ok(!!limparCampanha({ codigo: "TESTE1", nome: "x" }).erro, "sem benefício recusa");
ok(!!limparCampanha({ codigo: "TESTE1", nome: "x", descontoTipo: "percentual", descontoValor: 150 }).erro, "150% recusa");
ok(!!limparCampanha({ codigo: "TESTE1", nome: "x", isentaMatricula: true, inicio: "2026-10-10", fim: "2026-10-01" }).erro, "fim antes do início recusa");
ok(!!limparCampanha({ codigo: "TESTE1", nome: "x", publico: "alunas", isentaMatricula: true }).erro, "aluna atual sem desconto/prêmio recusa");
const lc = limparCampanha({ codigo: "volta às aulas", nome: "Volta", isentaMatricula: true, limiteUsos: "10", planos: [2, 1, 2] });
ok(lc.dados?.codigo === "VOLTAASAULAS" && lc.dados.limiteUsos === 10 && lc.dados.planos === "[1,2]", "limpa e normaliza");
ok(descreverBeneficios(v2).length === 2, "descreve isenção + desconto");

console.log("\n— aula avulsa de presente —");
const va = { ...base, aulasExtras: 2 };
ok(descreverBeneficios(va).includes("2 aulas avulsas de presente"), "descreve 2 aulas de presente");
ok(descreverBeneficios({ ...base, aulasExtras: 1 }).includes("1 aula avulsa de presente"), "descreve 1 aula (singular)");
ok(motivoRecusa(va, { ...ctx, contexto: "matricula", freq: 1 }) === null, "só aula de presente vale na matrícula");
ok(motivoRecusa(va, { ...ctx, contexto: "avulsa" }) === null, "só aula de presente vale na avulsa");
ok(motivoRecusa({ ...va, publico: "alunas" }, { ...ctx, contexto: "mensalidade" }) === null, "só aula de presente vale para quem já estuda");
ok(!limparCampanha({ codigo: "TESTE1", nome: "x", aulasExtras: 1 }).erro, "campanha só com aula de presente é aceita");
ok(limparCampanha({ codigo: "TESTE1", nome: "x", aulasExtras: 50 }).dados.aulasExtras === 10, "no máximo 10 aulas por uso");
ok(limparCampanha({ codigo: "TESTE1", nome: "x", isentaMatricula: true }).dados.aulasExtras === 0, "sem aula de presente por padrão");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
