// Teste rápido: autentica na Cora e imprime só o resultado (nunca o token inteiro).
import { getToken, coraConfigured } from "./src/cora.js";

console.log("Cora configurado?", coraConfigured());
try {
  const token = await getToken();
  console.log("✅ AUTENTICOU! Token recebido (tamanho:", token.length, "chars, começa com:", token.slice(0, 12) + "…)");
} catch (e) {
  console.log("❌ FALHOU:", e.message);
  if (e.body) console.log("Resposta:", JSON.stringify(e.body).slice(0, 300));
}
