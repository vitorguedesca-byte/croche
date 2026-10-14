// Teste das regras puras do Pix (backend/src/pixRegras.js)
import {
  txidBooking, txidMensalidade, parseTxid, viasDaMensalidade,
  destinoDoPixNaMensalidade, reservasComPixAberto,
} from "./src/pixRegras.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };
const BACEN = /^[a-zA-Z0-9]{26,35}$/;

console.log("\n— txid —");
const v0 = txidMensalidade(122, "2026-09");
const v1 = txidMensalidade(122, "2026-09", 1);
ok(v0 === "FQCM0000000000000122202609", "via original da mensalidade");
ok(v1 === "FQCM000000000000012220260901", "via 01 com sufixo");
ok(BACEN.test(v0) && BACEN.test(v1) && BACEN.test(txidBooking(29029)), "todos no formato do BACEN");
ok(parseTxid(v1).seq === 1 && parseTxid(v1).clientId === 122 && parseTxid(v1).competencia === "2026-09", "lê a via de volta");
ok(parseTxid(txidBooking(29029)).id === 29029, "lê a reserva de volta");
ok(parseTxid("E60746abc") === null, "txid de fora não é nosso");

console.log("\n— vias a fechar —");
const inv = { clientId: 75, competencia: "2026-09", txid: txidMensalidade(75, "2026-09", 1) };
ok(JSON.stringify(viasDaMensalidade(inv)) === JSON.stringify([txidMensalidade(75, "2026-09"), txidMensalidade(75, "2026-09", 1)]), "original + reemissão");
ok(viasDaMensalidade({ ...inv, txid: null }).length === 1, "sem txid: só a original");
ok(viasDaMensalidade({ ...inv, txid: txidMensalidade(75, "2026-09", 1), pagoPorTxid: txidMensalidade(75, "2026-09", 3) }).length === 4, "vai até a via mais alta conhecida");
ok(viasDaMensalidade({ ...inv, txid: txidBooking(10) })[0] === txidMensalidade(75, "2026-09"), "txid de reserva não estica as vias");

console.log("\n— destino de um Pix que caiu —");
const pend = { status: "pendente", clientId: 122, competencia: "2026-10", amountCents: 20000, txid: txidMensalidade(122, "2026-10") };
ok(destinoDoPixNaMensalidade(pend, pend.txid) === "baixar", "em aberto: dá baixa");
ok(destinoDoPixNaMensalidade({ ...pend, status: "cancelado" }, pend.txid) === "baixar", "cancelada e paga: dá baixa (o dinheiro entrou)");
const pagaPix = { ...pend, status: "pago", pagoPorTxid: pend.txid };
ok(destinoDoPixNaMensalidade(pagaPix, pend.txid) === "nada", "webhook repetido do mesmo Pix: nada");
ok(destinoDoPixNaMensalidade(pagaPix, txidMensalidade(122, "2026-10", 1)) === "alertar", "outra via paga também: Pix a mais");
// O caso real de 09/10/2026: QR de setembro pago depois da baixa manual
const aparecida = { status: "pago", baixaManual: true, clientId: 122, competencia: "2026-09", amountCents: 20000, txid: v0 };
ok(destinoDoPixNaMensalidade(aparecida, v0) === "alertar", "Pix depois da baixa manual: alerta (Aparecida #122)");
ok(destinoDoPixNaMensalidade({ ...pend, status: "pago", amountCents: 0, txid: null }, v0) === "alertar", "cortesia de R$ 0: qualquer Pix é a mais");
const antiga = { ...pend, status: "pago", pagoPorTxid: null };
ok(destinoDoPixNaMensalidade(antiga, pend.txid) === "nada", "paga antes da coluna nova, pela via guardada: nada");
ok(destinoDoPixNaMensalidade(antiga, txidMensalidade(122, "2026-10", 1)) === "conferir", "paga antes da coluna nova, por outra via: conferir no banco");
ok(destinoDoPixNaMensalidade({ ...antiga, txid: null }, v0) === "nada", "sem via guardada: assume que foi este Pix");

console.log("\n— reservas com Pix aberto —");
const rs = [
  { id: 1, txid: txidBooking(1), paid: false },
  { id: 2, txid: txidBooking(2), paid: true },
  { id: 3, txid: null, paid: false },
  null,
];
ok(JSON.stringify(reservasComPixAberto(rs).map((b) => b.id)) === "[1]", "só a que tem Pix e não foi paga");
ok(reservasComPixAberto(undefined).length === 0, "lista vazia não quebra");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
