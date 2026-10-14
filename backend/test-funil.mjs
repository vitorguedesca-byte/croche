// Teste das regras puras do funil de leads (backend/src/funil.js)
import {
  situacaoDaLead, entraNoFunil, ehReservaDeEntrada, origemDaUtm, origemDoAnuncioWa,
  telefoneDaLead, chaveTelefone, limparUtm, utmParaGravar, descreverConversa, diaBR,
} from "./src/funil.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };

const hoje = "2026-10-14";
const lead = { createdAt: new Date("2026-10-10T13:00:00Z") };
const ficha = { id: 1, name: "Maria", status: "lead", plan: "avulso", matriculaStatus: "nao_aplica" };
const avulsa = (o = {}) => ({ paymentMethod: "Aula Avulsa", value: 40, status: "aguardando", paid: false, date: "2026-10-20", time: "09:00", createdAt: new Date("2026-10-11T12:00:00Z"), attendance: "", ...o });
const matricula = (o = {}) => avulsa({ paymentMethod: "1ª mensalidade", value: 140, ...o });
const sit = (o) => situacaoDaLead({ lead, hoje, ...o });

console.log("\n— etapa —");
ok(sit({}).etapa === "contato", "sem ficha: contato");
ok(sit({ conversa: { step: "slot" } }).detalhe === "parou em: escolha do horário", "contato mostra onde parou no robô");
ok(sit({ client: ficha }).etapa === "cadastro", "ficha sem reserva: cadastro");
ok(sit({ client: ficha }).detalhe === "sem aula marcada", "…sem aula marcada");
ok(sit({ client: ficha, reservas: [avulsa()] }).etapa === "marcada", "avulsa futura: marcada");
ok(sit({ client: ficha, reservas: [avulsa()] }).detalhe === "avulsa · Pix pendente · aula 20/10", "…com o Pix pendente à vista");
ok(sit({ client: ficha, reservas: [avulsa({ paid: true })] }).detalhe === "avulsa · paga · aula 20/10", "…ou paga");
ok(sit({ client: ficha, reservas: [avulsa({ date: hoje })] }).detalhe.endsWith("aula hoje"), "aula de hoje ainda é marcada");
ok(sit({ client: ficha, reservas: [matricula()] }).detalhe.startsWith("matrícula ·"), "matrícula pendente: marcada (matrícula)");
ok(sit({ client: ficha, reservas: [avulsa({ status: "cancelada" })] }).etapa === "cadastro", "reserva caiu sem Pix: volta para cadastro");
ok(sit({ client: ficha, reservas: [avulsa({ status: "cancelada" })] }).detalhe === "reserva caiu sem pagamento", "…e diz por quê");
ok(sit({ client: ficha, reservas: [avulsa({ date: "2026-10-12", paid: true })] }).etapa === "aula", "avulsa paga que passou: depois da aula");
ok(sit({ client: ficha, reservas: [avulsa({ date: "2026-10-12", attendance: "presente" })] }).detalhe === "aula de 12/10 · falta pagar", "veio sem pagar");
ok(sit({ client: ficha, reservas: [avulsa({ date: "2026-10-12", paid: true, attendance: "falta" })] }).detalhe === "faltou na aula de 12/10", "pagou e faltou");
ok(sit({ client: ficha, reservas: [avulsa({ date: "2026-10-12" })] }).etapa === "cadastro", "não veio nem pagou: cadastro");
ok(sit({ client: { ...ficha, plan: "mensalista", status: "ativo", weeklyFreq: 2, matriculaAt: "2026-10-12" }, reservas: [matricula({ paid: true })] }).etapa === "matriculada", "plano pago: matriculada");
ok(sit({ client: { ...ficha, matriculaStatus: "paga" } }).etapa === "matriculada", "matrícula a concluir também é matriculada");
ok(sit({ lead: { ...lead, perdidaAt: "2026-10-13", motivoPerda: "preco" }, client: ficha }).etapa === "perdida", "perdida pela equipe");
ok(sit({ lead: { ...lead, perdidaAt: "2026-10-13", motivoPerda: "preco" }, client: ficha }).detalhe === "Achou caro", "…com o motivo");
ok(sit({ lead: { ...lead, perdidaAt: "2026-10-13" }, client: { ...ficha, plan: "mensalista" } }).etapa === "matriculada", "perdida que matriculou: matriculada");
ok(sit({ client: { ...ficha, status: "cancelado" } }).etapa === "perdida", "ficha inativada: perdida");
ok(sit({ client: ficha, reservas: [{ paymentMethod: "Mensalista", value: 0, status: "aguardando", date: "2026-10-20" }] }).etapa === "cadastro", "aula do plano não é entrada");

console.log("\n— marcos —");
const m1 = sit({ client: ficha, reservas: [avulsa({ status: "cancelada" })] });
ok(m1.marcouAt === "2026-10-11" && !m1.pagouAt && !m1.ganhaAt, "reserva que caiu ainda conta como marcou");
const m2 = sit({ lead: { ...lead, marcouAt: "2026-10-11" }, client: ficha });
ok(m2.marcouAt === "2026-10-11", "marco gravado não some quando a reserva some");
const m3 = sit({ client: { ...ficha, plan: "mensalista", matriculaPainelAt: "2026-10-12" } });
ok(m3.ganhaAt === "2026-10-12" && m3.pagouAt === "2026-10-12" && m3.marcouAt === "2026-10-12", "matrícula na hora pelo painel: marcos andam juntos");
const m4 = sit({ client: { ...ficha, plan: "mensalista", matriculaAt: "2026-08-01" } });
ok(m4.ganhaAt === "2026-10-10", "marco nunca antes de ela entrar no funil");
const m5 = sit({ lead: { ...lead, ganhaAt: "2026-10-12" }, client: { ...ficha, matriculaStatus: "devolvida" } });
ok(m5.ganhaAt === null, "matrícula devolvida: deixa de ser ganha");
const m6 = sit({ client: ficha, reservas: [avulsa({ paid: true, paymentDate: "2026-10-12" })] });
ok(m6.pagouAt === "2026-10-12", "pagamento pela data do pagamento");
ok(diaBR(new Date("2026-10-11T01:30:00Z")) === "2026-10-10", "22h30 de Brasília é o dia 10, não o 11");

console.log("\n— quem entra sozinho no funil —");
ok(entraNoFunil({ status: "lead", plan: "avulso", createdAt: new Date("2026-06-01") }), "lead aberta de qualquer data");
ok(!entraNoFunil({ status: "lead", plan: "mensalista", createdAt: new Date("2026-10-01") }), "mensalista com status lead (caso Camila) não");
ok(!entraNoFunil({ status: "ativo", plan: "mensalista", matriculaStatus: "nao_aplica", createdAt: new Date("2026-07-01") }), "mensalista antiga sem marcas não");
ok(!entraNoFunil({ status: "ativo", plan: "mensalista", trialDate: "2026-08-10", createdAt: new Date("2026-08-05") }), "matrícula antes do corte não");
ok(entraNoFunil({ status: "ativo", plan: "mensalista", matriculaAt: "2026-09-10", createdAt: new Date("2026-09-08T12:00:00Z") }), "matrícula depois do corte sim");
ok(!entraNoFunil({ status: "cancelado", plan: "avulso", trialDate: "2026-09-10", createdAt: new Date("2026-09-08") }), "ex-aluna não");
ok(!entraNoFunil({ status: "ativo", plan: "avulso", createdAt: new Date("2026-10-01") }), "ficha sem passar pela entrada não");

console.log("\n— reserva de entrada —");
ok(ehReservaDeEntrada({ paymentMethod: "Aula Avulsa", value: 40 }), "avulsa");
ok(ehReservaDeEntrada({ paymentMethod: "1ª mensalidade", value: 0 }), "outro horário da matrícula (valor 0)");
ok(ehReservaDeEntrada({ paymentMethod: "Pix", value: 40 }), "avulsa que recebeu baixa no painel");
ok(!ehReservaDeEntrada({ paymentMethod: "Reposição", value: 0 }), "reposição não");
ok(!ehReservaDeEntrada({ paymentMethod: "Avulsa", value: 40 }), "aula EXTRA da aluna não");

console.log("\n— origem —");
ok(origemDaUtm({ utm_source: "facebook", utm_medium: "paid" }) === "anuncio", "facebook pago: anúncio");
ok(origemDaUtm({ utm_source: "ig", utm_medium: "cpc" }) === "anuncio", "ig cpc: anúncio");
ok(origemDaUtm({ utm_source: "instagram", utm_medium: "bio" }) === "redes", "link da bio: redes");
ok(origemDaUtm({ fbclid: "abc" }) === "redes", "fbclid sozinho não prova anúncio");
ok(origemDaUtm({ gclid: "x" }) === "anuncio", "gclid: anúncio do Google");
ok(origemDaUtm({ referrer: "https://www.google.com/" }) === "google", "busca do Google");
ok(origemDaUtm({ utm_source: "indicacao" }) === "indicacao", "indicação");
ok(origemDaUtm({ landing: "/agendar" }) === null, "sem pista: não informada");
const ctwa = origemDoAnuncioWa({ source_type: "ad", headline: "Aula de crochê em Ipatinga", ctwa_clid: "Z" });
ok(ctwa.origem === "anuncio" && ctwa.detalhe === "Aula de crochê em Ipatinga", "anúncio de clique para o WhatsApp");
ok(origemDoAnuncioWa({ source_type: "post" }).origem === "redes", "publicação impulsionada/orgânica: redes");
ok(origemDoAnuncioWa(null) === null, "sem referral: nada");

console.log("\n— telefone e dados de fora —");
ok(telefoneDaLead("5531999998888") === "31999998888", "tira o 55 do WhatsApp");
ok(telefoneDaLead("(31) 99999-8888") === "31999998888", "tira a máscara da ficha");
ok(telefoneDaLead("123") === null, "curto demais: sem telefone");
ok(chaveTelefone("5531999998888") === chaveTelefone("(31) 9999-8888"), "mesma pessoa com e sem o 9");
ok(JSON.stringify(limparUtm({ utm_source: " fb ", hack: "x", utm_medium: "" })) === '{"utm_source":"fb"}', "só chaves conhecidas, sem vazio");
ok(limparUtm("texto") === null && limparUtm({}) === null, "lixo vira null");
const grande = utmParaGravar({ utm_source: "fb", fbclid: "x".repeat(900), referrer: "y".repeat(150) });
ok(grande && grande.length <= 1000 && JSON.parse(grande).utm_source === "fb" && !JSON.parse(grande).fbclid, "UTM grande cabe na coluna sem cortar o JSON");
ok(descreverConversa({ step: "aluna" }) === null, "conversa de aluna não descreve");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
