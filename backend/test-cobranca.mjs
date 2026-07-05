// Teste de cobrança no Stage: emite um boleto+Pix e mostra o resultado.
// Rode:  node --env-file=.env test-cobranca.mjs
import { createInvoice, coraConfigured } from "./src/cora.js";

console.log("Cora configurado?", coraConfigured());

// Vencimento daqui a 3 dias (YYYY-MM-DD)
const d = new Date();
d.setDate(d.getDate() + 3);
const dueDate = d.toISOString().slice(0, 10);

try {
  const inv = await createInvoice({
    code: `teste-${Date.now()}`,
    name: "Cliente Teste",
    cpf: "11144477735",            // CPF válido de teste
    email: "teste@exemplo.com",
    address: {
      street: "Rua Teste",
      number: "100",
      district: "Centro",
      city: "Ipatinga",
      state: "MG",
      complement: "N/A",
      zip_code: "35160000",
    },
    amountCents: 8000,             // R$ 80,00
    dueDate,
    description: "Aula de crochê — teste",
  });
  console.log("✅ COBRANÇA CRIADA!");
  console.log("  id:", inv.id);
  console.log("  status:", inv.status);
  console.log("  vencimento:", dueDate);
  // Campos úteis (nomes podem variar — imprimo o objeto inteiro pra confirmarmos):
  console.log("\n--- resposta completa ---");
  console.log(JSON.stringify(inv, null, 2));
} catch (e) {
  console.log("❌ FALHOU:", e.message);
  if (e.body) console.log("Detalhes:", JSON.stringify(e.body, null, 2));
}
