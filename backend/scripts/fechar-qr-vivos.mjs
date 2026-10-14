/* Fecha no Sicredi os QRs que ficaram abertos antes de 14/10/2026, quando a
   baixa manual, o cancelamento e a reserva refeita ainda não fechavam o QR no
   banco. Na conferência de 13/10 eram 75 mensalidades quitadas com QR pagável
   (R$ 10.680) e um Pix já caído em mensalidade quitada (Aparecida #122).

   O que faz, por mensalidade PAGA ou CANCELADA:
   - via ATIVA e ainda no prazo → fecha (REMOVIDA_PELO_USUARIO_RECEBEDOR);
   - via CONCLUIDA que não foi a que quitou → cria o aviso "Pago em dobro?"
     nas notificações do painel (PixAlerta), igual ao webhook faria hoje;
   - paga por um único Pix → grava `pagoPorTxid` (é o que faz o webhook
     reconhecer um Pix repetido daqui em diante).
   E fecha o QR de reservas pagas por fora ou soltas por "refez a entrada" /
   "alterar dados" / "matrícula refeita", e de aulas extras canceladas. Reserva
   solta por prazo vencido (vaga segurada do WhatsApp) fica: pagar depois do
   prazo ainda vale, de propósito.

   SÓ LÊ por padrão. Para aplicar:  node scripts/fechar-qr-vivos.mjs --aplicar
   Produção: dentro do container do backend (ver scripts-seed-nao-rodam-em-producao). */
import { PrismaClient } from "@prisma/client";
import { sicrediConfigured, getCharge, cancelCharge, isPaidStatus } from "../src/sicredi.js";
import { viasDaMensalidade, destinoDoPixNaMensalidade } from "../src/pixRegras.js";
import { compPorExtenso } from "../src/regrasAula.js";

const APLICAR = process.argv.includes("--aplicar");
const prisma = new PrismaClient();
const agora = Date.now();
const diaBR = (iso) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
const reais = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

if (!sicrediConfigured()) {
  console.error("Sicredi não configurado neste ambiente — rode dentro do container do backend.");
  process.exit(1);
}

const cache = new Map();
async function cob(txid) {
  if (!cache.has(txid)) cache.set(txid, await getCharge(txid).catch((e) => ({ erro: e.status || e.message })));
  return cache.get(txid);
}
// GET /cob devolve ATIVA mesmo depois de expirar: o prazo é criação + expiração.
const aindaPagavel = (c) =>
  c?.status === "ATIVA" && Date.parse(c.calendario?.criacao) + Number(c.calendario?.expiracao || 0) * 1000 > agora;

const fechar = [];   // { txid, valor, onde }
const alertas = [];  // dados do PixAlerta
const pagoPor = [];  // { id, txid }

/* ---------- mensalidades quitadas ou canceladas ---------- */
const clientes = new Map((await prisma.client.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
const invs = await prisma.invoice.findMany({ where: { status: { in: ["pago", "cancelado"] } } });
for (const inv of invs) {
  const pagas = [];
  for (const txid of viasDaMensalidade(inv)) {
    const c = await cob(txid);
    if (c.erro) continue; // 404: via nunca emitida
    if (aindaPagavel(c)) fechar.push({ txid, valor: Math.round(Number(c.valor?.original) * 100), onde: `mensalidade ${inv.competencia} de ${clientes.get(inv.clientId)} #${inv.clientId} (${inv.status}${inv.baixaManual ? ", baixa manual" : ""})` });
    if (isPaidStatus(c.status)) pagas.push({ txid, c });
  }
  if (inv.status !== "pago") continue;
  for (const { txid, c } of pagas) {
    let destino = destinoDoPixNaMensalidade(inv, txid);
    if (destino === "conferir") destino = pagas.some((p) => p.txid === inv.txid) ? "alertar" : "nada";
    if (destino === "nada" && !inv.pagoPorTxid && pagas.length === 1) pagoPor.push({ id: inv.id, txid });
    if (destino !== "alertar") continue;
    const pix = Array.isArray(c.pix) ? c.pix : [];
    alertas.push({
      txid, motivo: "ja_quitada",
      valorCents: Math.round((pix.reduce((s, p) => s + Number(p.valor || 0), 0) || Number(c.valor?.original) || 0) * 100),
      pagoEm: pix[0]?.horario ? String(pix[0].horario).slice(0, 30) : null,
      e2eId: pix[0]?.endToEndId ? String(pix[0].endToEndId).slice(0, 40) : null,
      clientId: inv.clientId, clientName: clientes.get(inv.clientId) || null,
      descricao: `Pix caiu na mensalidade de ${compPorExtenso(inv.competencia)}, que ${inv.baixaManual
        ? `já tinha baixa manual${inv.paidAt ? ` em ${diaBR(inv.paidAt)}` : ""}`
        : "já estava paga por outro Pix"}. Confira se é pagamento em dobro: devolva ou abata no próximo mês.`,
    });
  }
}

/* ---------- reservas e aulas extras ---------- */
const SOLTAS_POR_TROCA = /refez a entrada|alterar dados|matrícula refeita/i;
const desde = new Date(agora - 5 * 86400_000); // QR de reserva vale ~2,5 dias
const reservas = await prisma.booking.findMany({ where: { txid: { not: null }, createdAt: { gte: desde } } });
for (const b of reservas) {
  const c = await cob(b.txid);
  if (!aindaPagavel(c)) continue;
  const pagaPorFora = b.paid; // paga no sistema e QR ainda aberto = baixa manual
  const trocada = !b.paid && b.status === "cancelada" && SOLTAS_POR_TROCA.test(b.absenceReason || "");
  if (pagaPorFora || trocada) fechar.push({ txid: b.txid, valor: Math.round(Number(c.valor?.original) * 100), onde: `reserva #${b.id} de ${b.clientName} (${pagaPorFora ? "paga por fora" : b.absenceReason})` });
}
const extras = await prisma.extraPass.findMany({ where: { status: "cancelado", txid: { not: null } } });
for (const x of extras) {
  const c = await cob(x.txid);
  if (aindaPagavel(c)) fechar.push({ txid: x.txid, valor: x.amountCents, onde: `aula extra #${x.id} cancelada` });
}

/* ---------- relatório ---------- */
console.log(`\n${APLICAR ? "APLICANDO" : "SÓ LEITURA (use --aplicar)"} — ${cache.size} consultas ao Sicredi\n`);
console.log(`QRs a fechar: ${fechar.length} (${reais(fechar.reduce((s, f) => s + (f.valor || 0), 0))})`);
for (const f of fechar) console.log(`  - ${f.txid}  ${reais(f.valor || 0)}  ${f.onde}`);
console.log(`\nAvisos "Pago em dobro?" a criar: ${alertas.length}`);
for (const a of alertas) console.log(`  - ${a.txid}  ${reais(a.valorCents)}  ${a.clientName} #${a.clientId}: ${a.descricao}`);
console.log(`\nMensalidades que ganham pagoPorTxid: ${pagoPor.length}`);

if (APLICAR) {
  let fechados = 0;
  for (const f of fechar) {
    try { await cancelCharge(f.txid); fechados++; }
    catch (e) { console.warn(`  não fechei ${f.txid}: ${e.message}`); }
  }
  for (const a of alertas) await prisma.pixAlerta.upsert({ where: { txid: a.txid }, update: {}, create: a });
  for (const p of pagoPor) await prisma.invoice.update({ where: { id: p.id }, data: { pagoPorTxid: p.txid } });
  console.log(`\nFeito: ${fechados}/${fechar.length} QRs fechados, ${alertas.length} aviso(s), ${pagoPor.length} pagoPorTxid.`);
}
await prisma.$disconnect();
