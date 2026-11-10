import assert from "node:assert/strict";
import { test } from "node:test";
import { reconciliarMensalidadesPix } from "./src/conciliacaoPix.js";
import { txidBooking, txidMensalidade } from "./src/pixRegras.js";

test("consulta novamente o Pix sem baixa e encontra o título mesmo pelo QR anterior", async () => {
  const competencia = "2026-11";
  const txidPago = txidMensalidade(1, competencia);
  const txidJaBaixado = txidMensalidade(2, competencia);
  const txidSemTitulo = txidMensalidade(3, competencia);
  const titulos = [
    { clientId: 1, competencia, txid: txidMensalidade(1, competencia, 1), status: "pendente" },
    { clientId: 2, competencia, txid: txidJaBaixado, status: "pago" },
  ];
  const prisma = { invoice: { findMany: async ({ where }) => titulos.filter(titulo =>
    titulo.status !== where.status.not && where.OR.some(ref =>
      ref.clientId === titulo.clientId && ref.competencia === titulo.competencia)),
  } };
  async function* paginas() {
    yield [{ txid: txidBooking(10) }, { txid: txidJaBaixado }];
    yield [{ txid: txidSemTitulo }, { txid: txidPago }, { txid: txidPago }];
  }
  const consultas = [];
  let sicrediConfirmou = false;
  const confirmar = async txid => {
    consultas.push(txid);
    if (!sicrediConfirmou) return false;
    titulos[0].status = "pago";
    return true;
  };

  assert.equal(await reconciliarMensalidadesPix(prisma, paginas(), confirmar), 0);
  assert.equal(titulos[0].status, "pendente");
  sicrediConfirmou = true;
  assert.equal(await reconciliarMensalidadesPix(prisma, paginas(), confirmar), 1);
  assert.equal(titulos[0].status, "pago");
  assert.equal(await reconciliarMensalidadesPix(prisma, paginas(), confirmar), 0);
  assert.deepEqual(consultas, [txidPago, txidPago]);
});
