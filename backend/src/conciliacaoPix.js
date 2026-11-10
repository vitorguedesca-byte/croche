import { parseTxid } from "./pixRegras.js";

const chaveMensalidade = ({ clientId, competencia }) => `${clientId}:${competencia}`;

export async function reconciliarMensalidadesPix(prisma, paginas, confirmar) {
  let baixadas = 0;
  for await (const pixRecebidos of paginas) {
    const cobrancas = new Map();
    for (const { txid } of pixRecebidos) {
      const ref = parseTxid(txid);
      if (ref?.tipo === "mensalidade") cobrancas.set(txid, ref);
    }
    if (!cobrancas.size) continue;

    // A via paga pode ser anterior ao QR guardado no título.
    const abertas = await prisma.invoice.findMany({
      where: {
        status: { not: "pago" },
        OR: Array.from(cobrancas.values(), ({ clientId, competencia }) => ({ clientId, competencia })),
      },
      select: { clientId: true, competencia: true },
    });
    const chavesAbertas = new Set(abertas.map(chaveMensalidade));
    for (const [txid, ref] of cobrancas) {
      if (!chavesAbertas.has(chaveMensalidade(ref))) continue;
      try {
        if (await confirmar(txid)) baixadas++;
      } catch (e) {
        console.warn(`[sicredi] conciliação falhou para ${txid}: ${e.message}`);
      }
    }
  }
  return baixadas;
}
