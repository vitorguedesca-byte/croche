// Teste das regras puras da volta da ex-aluna (backend/src/volta.js)
import { ehExAluna, ehPagamentoDaVolta, intencaoDaVolta, fichaDaVoltaPaga, SEM_VOLTA } from "./src/volta.js";
import { textoExAluna, textoPlanoVolta, textoMatriculaConfirmada } from "./src/textosEscola.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };
const lanca = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const desde = new Date("2026-10-19T13:00:00Z");
const exMensalista = {
  id: 7, name: "Maria Souza", status: "cancelado", plan: "mensalista", weeklyFreq: 2, mensalistaTipo: "fixo",
  monthlyValue: 180, matriculaStatus: "convertida", matriculaAt: "2026-03-10", trialDate: "2026-03-12",
  weeklyFreqAnterior: 1, weeklyFreqDesde: "2026-09",
};
const emVolta = { ...exMensalista, voltaDesde: desde, voltaFreq: 1, voltaTipo: "escala" };

console.log("\n— quem é ex-aluna —");
ok(ehExAluna(exMensalista), "ficha cancelada é ex-aluna");
ok(!ehExAluna({ ...exMensalista, status: "ativo" }), "ativa não é");
ok(!ehExAluna({ ...exMensalista, status: "lead" }), "lead não é");
ok(!ehExAluna(null), "sem ficha não é");

console.log("\n— o Pix é desta volta? —");
ok(ehPagamentoDaVolta(emVolta, { createdAt: new Date("2026-10-19T13:00:05Z") }), "reserva depois do começo da volta: sim");
ok(ehPagamentoDaVolta(emVolta, { createdAt: new Date("2026-10-19T12:59:30Z") }), "meio minuto antes (relógio): sim");
ok(!ehPagamentoDaVolta(emVolta, { createdAt: new Date("2026-03-01T10:00:00Z") }), "reserva de matrícula antiga: não");
ok(!ehPagamentoDaVolta(exMensalista, { createdAt: new Date("2026-10-19T14:00:00Z") }), "sem volta em curso: não");
ok(!ehPagamentoDaVolta({ ...emVolta, status: "ativo" }, { createdAt: new Date("2026-10-19T14:00:00Z") }), "ficha já reativada pela Inêz: não");
ok(!ehPagamentoDaVolta(emVolta, {}), "reserva sem data: não");

console.log("\n— intenção guardada na reserva —");
const agora = new Date("2026-10-20T09:00:00Z");
const i1 = intencaoDaVolta(exMensalista, { freq: 3, tipo: "fixo", agora });
ok(i1.voltaFreq === 3 && i1.voltaTipo === "fixo", "plano e tipo escolhidos");
ok(i1.voltaDesde === agora, "1ª tentativa: começa agora");
ok(intencaoDaVolta(emVolta, { freq: 2, tipo: "escala", agora }).voltaDesde === desde, "nova tentativa mantém o começo da 1ª");
ok(intencaoDaVolta(exMensalista, { freq: "2", tipo: "qualquer", agora }).voltaTipo === "fixo", "tipo desconhecido vira fixo");
ok(!("status" in i1) && !("plan" in i1) && !("trialDate" in i1) && !("matriculaStatus" in i1), "não mexe em status, plano, 1ª aula nem matrícula");
ok(lanca(() => intencaoDaVolta(exMensalista, { freq: "avulso", agora }))?.code === 400, "avulsa recusada");
ok(lanca(() => intencaoDaVolta(exMensalista, { freq: 5, agora }))?.code === 400, "plano inexistente recusado");
ok(lanca(() => intencaoDaVolta(exMensalista, { freq: null, agora }))?.code === 400, "sem plano recusado");

console.log("\n— ficha quando o Pix cai —");
const f = fichaDaVoltaPaga(emVolta, "2026-10-19");
ok(f.status === "ativo", "volta a ficar ativa");
ok(f.weeklyFreq === 1 && f.mensalistaTipo === "escala", "plano da volta vira o plano dela");
ok(f.monthlyValue === null, "desconto individual antigo sai (valor de tabela)");
ok(f.weeklyFreqAnterior === null && f.weeklyFreqDesde === null, "troca de plano pendente sai");
ok(f.matriculaStatus === "paga", "matrícula paga (vira convertida na conversão)");
ok(!("matriculaAt" in f), "ex-mensalista mantém a data da matrícula (relatório de Vendas)");
ok(f.voltaAt === "2026-10-19" && f.voltaDesde === null && f.voltaFreq === null && f.voltaTipo === null, "volta registrada e intenção limpa");
ok(f.firstClass === false, "não é aluna nova");
const exAvulsa = { ...emVolta, plan: "avulso", matriculaAt: null, matriculaStatus: "nao_aplica" };
ok(fichaDaVoltaPaga(exAvulsa, "2026-10-19").matriculaAt === "2026-10-19", "ex-avulsa sem matrícula ganha a data");
ok(!("matriculaAt" in fichaDaVoltaPaga({ ...exAvulsa, matriculaAt: "2026-05-01" }, "2026-10-19")), "quem já tinha data mantém");
ok(fichaDaVoltaPaga({ ...emVolta, voltaFreq: null, voltaTipo: null }, "2026-10-19").weeklyFreq === 2, "sem intenção: fica o plano que tinha");

console.log("\n— painel reativa —");
ok(SEM_VOLTA.voltaDesde === null && SEM_VOLTA.voltaFreq === null && SEM_VOLTA.voltaTipo === null, "zera a tentativa");

console.log("\n— textos —");
const t1 = textoExAluna({ nome: "Maria Souza" });
ok(t1.startsWith("Oi, Maria!"), "ex-aluna: chama pelo primeiro nome");
ok(/não há taxa de matrícula/.test(t1), "ex-aluna: avisa que não há taxa");
ok(textoExAluna({ nome: "Maria", midia: "o seu áudio" }).includes("o seu áudio"), "ex-aluna: avisa da mídia");
const t2 = textoPlanoVolta({ nome: "Maria Souza", planos: [{ freq: 1, valor: "R$ 120,00" }, { freq: 2, valor: "R$ 200,00" }] });
ok(t2.startsWith("Que bom ter você de volta, Maria!"), "plano: saudação da volta");
ok(t2.includes("*1x por semana* — R$ 120,00") && t2.includes("*2x por semana* — R$ 200,00"), "plano: lista os planos com valor");
ok(!/avulsa/i.test(t2), "plano: sem avulsa");
ok(textoPlanoVolta({ nome: "Maria", prefixo: "Não entendi 🤔. ", planos: [] }).startsWith("Não entendi"), "plano: prefixo no lugar da saudação");
const t3 = textoMatriculaConfirmada({ nome: "Maria Souza", unidade: "Centro", quando: "seg 20/10 09:00", volta: true });
ok(t3.startsWith("Que bom ter você de volta, Maria!") && t3.includes("ativo de novo"), "confirmação da volta");
ok(!/taxa de matrícula/.test(t3) && !/devolvemos/.test(t3), "confirmação da volta: sem taxa nem devolução de aluna nova");
ok(/reposição/.test(t3), "confirmação da volta: relembra as regras");
ok(!textoMatriculaConfirmada({ nome: "Ana", unidade: "Centro", quando: "x" }).includes("de volta"), "aluna nova continua com o texto de sempre");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
