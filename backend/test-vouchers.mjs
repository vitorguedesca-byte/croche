// Teste das regras das campanhas com código (backend/src/vouchers.js)
import {
  normalizarCodigo, aplicarDesconto, primeiroPagamentoComVoucher, motivoRecusa,
  situacaoCampanha, mesesSeguintes, limparCampanha, descreverBeneficios, temDesconto,
  temPacote, mesesDoPacote, valorDoPacote, descricaoDoPacote, listaMeses, mesesDoPacoteNaMatricula, vencimentoDoPacote, limiteDoPacote,
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
ok(motivoRecusa({ ...v1, ativo: false }, { ...ctx, contexto: "matricula" }).includes("ainda não está valendo"), "pausada no prazo: ainda não vale");
ok(motivoRecusa({ ...v1, ativo: false, fim: "2026-09-29" }, { ...ctx, contexto: "matricula" }).includes("encerrada"), "pausada depois do fim: encerrada");
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

console.log("\n— pacote (dezembro grátis + jan, fev, mar juntos) —");
const camp0 = () => ({ codigo: "VERAO", nome: "Verão", publico: "todas", fim: "2026-11-30", pacoteInicio: "2026-12", pacoteGratis: 1, pacotePagos: 3 });
const vp = { ...base, codigo: "VERAO", publico: "todas", pacoteInicio: "2026-12", pacoteGratis: 1, pacotePagos: 3, fim: "2026-11-30" };
const mp = mesesDoPacote(vp);
ok(temPacote(vp), "campanha tem pacote");
ok(!temPacote({ ...base, pacoteInicio: "2026-12", pacotePagos: 0 }), "sem meses pagos não é pacote");
ok(mp.cobranca === "2026-12", "o Pix do pacote mora na mensalidade de dezembro");
ok(JSON.stringify(mp.gratis) === '["2026-12"]', "dezembro grátis");
ok(JSON.stringify(mp.pagos) === '["2027-01","2027-02","2027-03"]', "jan, fev e mar pagos (virada de ano)");
ok(JSON.stringify(mp.cobertos) === '["2027-01","2027-02","2027-03"]', "jan, fev e mar nascem quitados");
ok(mp.volta === "2027-04", "abril volta ao normal");
ok(valorDoPacote(vp, () => 200) === 600, "plano 2x (R$ 200): pacote de R$ 600");
ok(valorDoPacote(vp, () => 120) === 360, "plano 1x (R$ 120): pacote de R$ 360");
ok(valorDoPacote(vp, (c) => (c === "2027-03" ? 130 : 120)) === 370, "respeita o valor de cada mês (reajuste em março)");
ok(listaMeses(mp.pagos) === "janeiro, fevereiro e março/2027", "lista de meses em português");
ok(descricaoDoPacote(vp) === "Pacote VERAO: dezembro/2026 grátis + janeiro, fevereiro e março/2027 pagos juntos", "descrição da fatura");
ok(descreverBeneficios(vp).some((t) => t.includes("abril/2027")), "descreve a volta em abril");
ok(descreverBeneficios(vp).some((t) => t.includes("não é devolvido")), "avisa que não há devolução");
const mp0 = mesesDoPacote({ ...vp, pacoteGratis: 0 });
ok(mp0.cobranca === "2026-12" && mp0.cobertos.length === 2 && mp0.volta === "2027-03", "sem mês grátis: o Pix fica no 1º mês pago");
// aluna nova: o Pix da matrícula é o pacote, sem a mensalidade do mês de entrada
let pp = primeiroPagamentoComVoucher(vp, { mensalidade: 200, taxa: 20 });
ok(pp.mensalidade === 600 && pp.taxa === 0 && pp.total === 600, "matrícula 2x com pacote: R$ 600, sem taxa");
ok(pp.descontoCents === 2000 && pp.pacote?.meses === 3, "o desconto no ato é só a taxa");
ok(mensalidadeDoPagamento({ pago: pp.total, taxa: pp.taxa || null }) === 600, "fatura do mês de entrada = o pacote (R$ 600)");
pp = primeiroPagamentoComVoucher(vp, { mensalidade: 120, taxa: 20 });
ok(pp.total === 360, "pacote 1x: R$ 360");
ok(vencimentoDoPacote(vp, "2026-11-24") === "2026-11-24", "sem data: o pacote vence no dia do uso");
ok(vencimentoDoPacote({ ...vp, pacoteVenceEm: "2026-11-30" }, "2026-11-24") === "2026-11-30", "com data: vence até 30/11");
ok(vencimentoDoPacote({ ...vp, pacoteVenceEm: "2026-11-30" }, "2026-12-02") === "2026-12-02", "data já passada: vence no dia");
ok(limparCampanha({ ...camp0(), pacoteVenceEm: "2026-11-30" }).dados.pacoteVenceEm === "2026-11-30", "guarda a data do prazo");
ok(!!limparCampanha({ ...camp0(), pacoteVenceEm: "2027-01-05" }).erro, "prazo não pode passar do 1º mês do pacote");
// o pagamento do pacote acaba junto com a campanha (Inêz, 25/11/2026)
ok(!!limparCampanha({ ...camp0(), pacoteVenceEm: "2026-12-01" }).erro, "prazo não pode passar do fim da campanha");
ok(limparCampanha({ ...camp0(), pacoteVenceEm: "2026-11-20" }).dados.pacoteVenceEm === "2026-11-20", "prazo antes do fim vale");
ok(limiteDoPacote(vp) === "2026-11-30", "o limite do Pix do pacote é o fim da campanha");
ok(limiteDoPacote({ ...vp, fim: null }) === null, "sem fim, sem limite");
ok(vencimentoDoPacote({ ...vp, pacoteVenceEm: "2026-12-10" }, "2026-11-24") === "2026-11-30", "prazo antigo depois do fim: vence no fim");
ok(descreverBeneficios({ ...vp, pacoteVenceEm: "2026-12-10" }).includes("O pacote é pago até 30/11/2026"), "a aluna vê o prazo limitado ao fim");
ok(descreverBeneficios(vp).some((t) => t.includes("30/11/2026") && t.includes("não pode mais ser pago")), "avisa que depois do fim não paga mais");
ok(limparCampanha({ ...camp0(), pacoteInicio: "", isentaMatricula: true, pacoteVenceEm: "2026-11-30" }).dados.pacoteVenceEm === null, "sem pacote, sem prazo");
ok(primeiroPagamentoComVoucher(vp, { avulsa: true, valorAvulsa: 40 }).total === 40, "pacote não mexe na aula avulsa");
let mm = mesesDoPacoteNaMatricula(vp, "2026-11");
ok(mm.cobranca === "2026-11", "entrou em novembro: o pacote é a mensalidade de entrada");
ok(JSON.stringify(mm.cobertos) === '["2026-12","2027-01","2027-02","2027-03"]', "dezembro a março nascem quitados");
ok(mm.volta === "2027-04", "aluna nova volta a pagar em abril");
mm = mesesDoPacoteNaMatricula(vp, "2026-12");
ok(JSON.stringify(mm.cobertos) === '["2027-01","2027-02","2027-03"]' && mm.volta === "2027-04", "Pix caiu em dezembro: jan a mar quitados, abril normal");

const ctxPac = { hoje: "2026-11-24", usados: 0 };
ok(motivoRecusa(vp, { ...ctxPac, contexto: "mensalidade", freq: 2 }) === null, "aluna atual usa o pacote no portal");
ok(motivoRecusa(vp, { ...ctxPac, contexto: "matricula", freq: 3 }) === null, "aluna nova usa o pacote na matrícula");
ok(!!motivoRecusa(vp, { ...ctxPac, contexto: "avulsa" }), "pacote não vale na aula avulsa");
ok(!!motivoRecusa({ ...vp, fim: null }, { hoje: "2026-12-02", usados: 0, contexto: "mensalidade", freq: 1 }), "pacote já começado não se vende");
ok(!!motivoRecusa(vp, { hoje: "2026-12-01", usados: 0, contexto: "mensalidade", freq: 1 }), "depois de 30/11 a campanha encerra");
const camp = { codigo: "VERAO", nome: "Verão", publico: "todas", fim: "2026-11-30", pacoteInicio: "2026-12", pacoteGratis: 1, pacotePagos: 3 };
const lp = limparCampanha(camp);
ok(!lp.erro && lp.dados.pacoteInicio === "2026-12" && lp.dados.pacotePagos === 3 && lp.dados.pacoteGratis === 1, "campanha só com pacote é aceita");
ok(!!limparCampanha({ ...camp, fim: "" }).erro, "pacote exige data final");
ok(!!limparCampanha({ ...camp, fim: "2026-12-05" }).erro, "pacote precisa começar depois do fim da campanha");
ok(!!limparCampanha({ ...camp, descontoTipo: "percentual", descontoValor: 10 }).erro, "pacote + desconto não andam juntos");
ok(!!limparCampanha({ ...camp, pacotePagos: 0 }).erro, "pacote precisa de pelo menos 1 mês pago");
ok(!limparCampanha({ ...camp, publico: "alunas" }).erro, "pacote serve para quem já estuda");
ok(limparCampanha({ ...camp, pacoteInicio: "", isentaMatricula: true }).dados.pacoteInicio === null, "desligar o pacote limpa os campos");
ok(limparCampanha({ codigo: "X12", nome: "x", isentaMatricula: true }).dados.pacotePagos === 0, "sem pacote por padrão");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
