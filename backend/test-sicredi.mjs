// Teste de ponta a ponta da API Pix do Sicredi: autentica, cria uma cobrança de
// R$ 0,01 e mostra o Pix copia-e-cola. Nunca imprime o token nem a chave privada.
// Rode:  node --env-file=.env test-sicredi.mjs
import { getToken, createCharge, getCharge, sicrediConfigured, sicrediMissing, extractPix, pixKey } from "./src/sicredi.js";

console.log("Sicredi configurado?", sicrediConfigured());
if (!sicrediConfigured()) {
  console.log("Falta configurar:", sicrediMissing().join(", "));
  process.exit(1);
}
console.log("Chave Pix em uso:", pixKey().replace(/.(?=.{4})/g, "•")); // mascarada

// 1) autenticação
let token;
try {
  token = await getToken();
  console.log(`✅ AUTENTICOU! Token recebido (${token.length} chars, começa com ${token.slice(0, 12)}…)`);
} catch (e) {
  console.log("❌ FALHOU na autenticação:", e.message);
  if (e.body) console.log("Resposta:", JSON.stringify(e.body).slice(0, 400));
  process.exit(1);
}

// 2) cobrança de teste — txid alfanumérico de 26 chars, como manda o padrão BACEN
const txid = `TESTE${String(Date.now()).padStart(21, "0")}`;
const d = new Date();
d.setDate(d.getDate() + 3);
const dueDate = d.toISOString().slice(0, 10);

try {
  const cob = await createCharge({
    txid,
    name: "Cliente Teste",
    cpf: "11144477735", // CPF válido de teste
    amountCents: 1,     // R$ 0,01 — se alguém pagar sem querer, o prejuízo é um centavo
    dueDate,
    description: "Aula de crochê — teste",
  });
  console.log("\n✅ COBRANÇA CRIADA!");
  console.log("  txid:", cob.txid);
  console.log("  status:", cob.status);
  console.log("  vencimento (expiração):", dueDate);
  console.log("  location:", cob.location);
  console.log("\n--- Pix copia-e-cola ---");
  console.log(extractPix(cob) || "(não veio pixCopiaECola na resposta!)");

  // 3) releitura — é essa chamada que o webhook usa como prova de pagamento
  const lido = await getCharge(txid);
  console.log("\n✅ RELEITURA OK — status:", lido.status, "(CONCLUIDA = paga)");
} catch (e) {
  console.log("❌ FALHOU:", e.message);
  if (e.body) console.log("Detalhes:", JSON.stringify(e.body, null, 2));
  process.exit(1);
}
