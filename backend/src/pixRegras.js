/* Regras puras do Pix: o txid de cada cobrança e o que fazer quando um Pix
   cai. Sem banco e sem Sicredi aqui — é o que deixa testar sem rede
   (test-pix-regras.mjs). Quem chama o banco é o server.js. */

// O txid é o identificador da cobrança no padrão BACEN e ele é NOSSO: precisa
// casar com /^[a-zA-Z0-9]{26,35}$/ — nada de hífen. Como é derivado do id da
// reserva (ou do aluno + competência), o mesmo registro sempre gera o mesmo txid,
// e o PUT /cob/{txid} do Sicredi é idempotente: reenviar não duplica cobrança.
export const txidBooking = (id) => `FQCB${String(id).padStart(22, "0")}`;

// `seq` é a via da cobrança: 0 (sem sufixo) é a original; 1, 2, 3… são as
// reemissões, feitas quando a cobrança anterior expirou ou o valor mudou.
// Precisa de txid novo porque o PUT /cob/{txid} é idempotente — reenviar o
// mesmo txid devolveria a cobrança antiga em vez de criar uma válida.
export const txidMensalidade = (clientId, comp, seq = 0) =>
  `FQCM${String(clientId).padStart(16, "0")}${comp.replace("-", "")}${seq ? String(seq).padStart(2, "0") : ""}`;

// Caminho inverso: o webhook só nos entrega o txid, então precisamos saber a que
// ele se refere quando a busca direta no banco não acha. É o que salva o caso da
// aluna que pagou pelo QR antigo: o txid dela não está mais na invoice (foi
// substituído pela reemissão), mas cliente + competência ainda identificam a dívida.
export const parseTxid = (txid) => {
  let m = /^FQCB(\d{22})$/.exec(txid || "");
  if (m) return { tipo: "booking", id: Number(m[1]) };
  m = /^FQCX(\d{22})$/.exec(txid || "");
  if (m) return { tipo: "extra", id: Number(m[1]) };
  m = /^FQCM(\d{16})(\d{4})(\d{2})(\d{2})?$/.exec(txid || "");
  if (m) {
    return { tipo: "mensalidade", clientId: Number(m[1]), competencia: `${m[2]}-${m[3]}`, seq: Number(m[4] || 0) };
  }
  return null;
};

/* Todas as vias que uma mensalidade pode ter aberto no banco: a original e as
   reemissões até a mais alta que o registro conhece. Fechar só a via guardada
   não basta — a reemissão não fecha a anterior (ela continua pagável, de
   propósito, para quem guardou o código do lembrete). */
export function viasDaMensalidade(inv) {
  const seqs = [inv.txid, inv.pagoPorTxid]
    .map(parseTxid)
    .filter((r) => r?.tipo === "mensalidade")
    .map((r) => r.seq);
  const ultima = Math.max(0, ...seqs);
  return Array.from({ length: ultima + 1 }, (_, seq) => txidMensalidade(inv.clientId, inv.competencia, seq));
}

/* O que fazer com um Pix JÁ CONFIRMADO no banco (CONCLUIDA) que encontrou esta
   mensalidade:
     "baixar"   → em aberto (ou cancelada): é o pagamento dela, dá a baixa;
     "nada"     → foi este mesmo Pix que quitou — webhook repetido, nova consulta;
     "alertar"  → já estava quitada por outro meio: este Pix é dinheiro a mais;
     "conferir" → quitada pelo Pix antes de `pagoPorTxid` existir, por uma via
                  diferente desta. Só é Pix a mais se a via guardada em `txid`
                  também foi paga — quem chama pergunta ao banco. */
export function destinoDoPixNaMensalidade(inv, txid) {
  if (inv.status !== "pago") return "baixar";
  if (inv.pagoPorTxid) return inv.pagoPorTxid === txid ? "nada" : "alertar";
  if (inv.baixaManual) return "alertar";
  if (!inv.amountCents) return "alertar"; // cortesia: não havia nada a pagar
  if (!inv.txid || inv.txid === txid) return "nada";
  return "conferir";
}

/* Reservas cujo Pix deve ser fechado quando elas deixam de valer: só as que
   têm cobrança e ainda não foram pagas. */
export const reservasComPixAberto = (bookings) =>
  (bookings || []).filter((b) => b && b.txid && !b.paid);
