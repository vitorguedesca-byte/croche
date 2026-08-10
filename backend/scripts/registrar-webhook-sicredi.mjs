// Cadastra (ou consulta) no Sicredi a URL que recebe o aviso de Pix pago.
// É uma operação de UMA VEZ SÓ — depois de cadastrada, ela fica valendo.
//
//   node --env-file=.env scripts/registrar-webhook-sicredi.mjs            # consulta
//   node --env-file=.env scripts/registrar-webhook-sicredi.mjs --gravar   # cadastra
//
// A URL cadastrada é a de SICREDI_WEBHOOK_URL. Importante: o Sicredi acrescenta
// "/pix" ao final na hora de notificar, então cadastrando
//   https://fiosquecuram.com.br/api/sicredi/webhook
// as notificações chegam em
//   https://fiosquecuram.com.br/api/sicredi/webhook/pix
// — e o backend responde nas duas rotas de propósito.
import { registerWebhook, getWebhook, sicrediConfigured, sicrediMissing, pixKey } from "../src/sicredi.js";

if (!sicrediConfigured()) {
  console.log("❌ Sicredi não configurado. Falta:", sicrediMissing().join(", "));
  process.exit(1);
}

const gravar = process.argv.includes("--gravar");
const url = process.env.SICREDI_WEBHOOK_URL || "";

console.log("Chave Pix:", pixKey().replace(/.(?=.{4})/g, "•"));

if (gravar) {
  if (!/^https:\/\//.test(url)) {
    console.log("❌ Defina SICREDI_WEBHOOK_URL com uma URL https:// válida antes de gravar.");
    process.exit(1);
  }
  try {
    await registerWebhook(url);
    console.log("✅ Webhook cadastrado:", url);
    console.log("   O Sicredi vai notificar em:", url.replace(/\/$/, "") + "/pix");
  } catch (e) {
    console.log("❌ FALHOU ao cadastrar:", e.message);
    if (e.body) console.log("Detalhes:", JSON.stringify(e.body, null, 2));
    process.exit(1);
  }
} else {
  try {
    const atual = await getWebhook();
    console.log("✅ Webhook já cadastrado:", JSON.stringify(atual, null, 2));
  } catch (e) {
    if (e.status === 404) console.log("ℹ️  Nenhum webhook cadastrado ainda. Rode com --gravar para cadastrar.");
    else {
      console.log("❌ FALHOU ao consultar:", e.message);
      process.exit(1);
    }
  }
}
