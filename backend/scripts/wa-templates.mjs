// Modelos de mensagem (templates) do WhatsApp — os textos que a escola envia
// FORA da janela de 24h. Todo template precisa ser aprovado pela Meta antes do
// primeiro envio; a aprovação costuma sair em minutos, às vezes em algumas horas.
//
//   node --env-file=.env scripts/wa-templates.mjs             # mostra os textos (não envia nada)
//   node --env-file=.env scripts/wa-templates.mjs --listar    # status dos templates já submetidos
//   node --env-file=.env scripts/wa-templates.mjs --enviar    # submete para aprovação
//
// Todos são da categoria UTILITY, e isso é proposital: utilidade custa cerca de
// R$ 0,04 por mensagem e é GRATUITA dentro de uma janela de 24h aberta pela aluna,
// enquanto MARKETING custa ~R$ 0,34. Se a Meta reclassificar algum como marketing,
// o texto está soando promocional demais — reveja antes de aceitar.
import { listWaTemplates, createWaTemplate, waTemplatesConfigured } from "../src/wa.js";

const PORTAL_URL = process.env.WA_PORTAL_URL || "https://fiosquecuram.com.br/portal";
const FOOTER = "Fios que Curam · Ipatinga e Timóteo";

export const TEMPLATES = [
  {
    name: "confirmacao_reserva",
    category: "UTILITY",
    language: "pt_BR",
    // {{1}} primeiro nome · {{2}} unidade · {{3}} dia e hora · {{4}} valor
    exemplo: ["Maria", "Timóteo", "sexta, 15/08 às 14:00", "40,00"],
    components: [
      {
        type: "BODY",
        text:
          "Oi, {{1}}! Sua aula ficou reservada:\n\n" +
          "📍 Unidade: {{2}}\n" +
          "🗓️ Quando: {{3}}\n" +
          "💰 Valor: R$ {{4}}\n\n" +
          "A reserva é confirmada assim que o pagamento entra. Se precisar trocar de horário, é só responder por aqui. 💚",
        example: { body_text: [["Maria", "Timóteo", "sexta, 15/08 às 14:00", "40,00"]] },
      },
      { type: "FOOTER", text: FOOTER },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Já paguei" },
          { type: "QUICK_REPLY", text: "Preciso remarcar" },
        ],
      },
    ],
  },

  {
    name: "lembrete_aula",
    category: "UTILITY",
    language: "pt_BR",
    // {{1}} primeiro nome · {{2}} unidade · {{3}} dia e hora
    exemplo: ["Maria", "Timóteo", "amanhã, 15/08 às 14:00"],
    components: [
      {
        type: "BODY",
        text:
          "Oi, {{1}}! Passando para lembrar da sua aula de crochê:\n\n" +
          "📍 Unidade: {{2}}\n" +
          "🗓️ Quando: {{3}}\n\n" +
          "Se não puder vir, avise por aqui com pelo menos 6 horas de antecedência: a vaga fica livre para outra aluna e você ganha o crédito de reposição. 🧶",
        example: { body_text: [["Maria", "Timóteo", "amanhã, 15/08 às 14:00"]] },
      },
      { type: "FOOTER", text: FOOTER },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Confirmar presença" },
          { type: "QUICK_REPLY", text: "Não vou poder ir" },
        ],
      },
    ],
  },

  /* Os dois avisos de mensalidade são templates SEPARADOS de propósito. O de
     antes do vencimento é um lembrete gentil; o de depois é uma cobrança. Um
     texto só, tentando servir para as duas horas, sairia frio na primeira e
     mole na segunda — e é justamente o tom que a Inêz pediu para acertar. */
  {
    name: "mensalidade_a_vencer",
    category: "UTILITY",
    language: "pt_BR",
    // {{1}} primeiro nome · {{2}} mês por extenso · {{3}} valor · {{4}} vencimento
    exemplo: ["Maria", "agosto de 2026", "120,00", "10/08/2026"],
    components: [
      {
        type: "BODY",
        text:
          "Oi, {{1}}! Passando só para lembrar, sem pressa: sua mensalidade de {{2}} vence em breve.\n\n" +
          "💰 Valor: R$ {{3}}\n" +
          "📅 Vencimento: {{4}}\n\n" +
          "Pagando até o vencimento você não paga multa nem juros. O Pix está no portal da aluna — qualquer dúvida, é só responder por aqui. 💚",
        example: { body_text: [["Maria", "agosto de 2026", "120,00", "10/08/2026"]] },
      },
      { type: "FOOTER", text: FOOTER },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Abrir portal", url: PORTAL_URL }],
      },
    ],
  },

  {
    name: "mensalidade_em_atraso",
    category: "UTILITY",
    language: "pt_BR",
    // {{1}} primeiro nome · {{2}} mês por extenso · {{3}} dias de atraso · {{4}} total com encargos
    exemplo: ["Maria", "agosto de 2026", "3", "125,36"],
    components: [
      {
        type: "BODY",
        text:
          "Oi, {{1}}! Sua mensalidade de {{2}} está em aberto há {{3}} dia(s).\n\n" +
          "💰 Total com multa e juros: R$ {{4}}\n\n" +
          "O Pix atualizado está no portal da aluna. Se já tiver pago, me avisa por aqui que eu confiro. 💚",
        example: { body_text: [["Maria", "agosto de 2026", "3", "125,36"]] },
      },
      { type: "FOOTER", text: FOOTER },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Abrir portal", url: PORTAL_URL }],
      },
    ],
  },

  /* Confirmação da matrícula. As REGRAS completas não cabem aqui: o corpo de um
     template para em 1024 caracteres e o texto da Inêz passa de 1600. Dentro da
     janela de 24h (o caso normal — ela acabou de conversar e pagar) o sistema
     manda o texto inteiro como mensagem livre, sem esse limite. Este template é
     o fallback de quando o Pix demora mais de um dia para cair: confirma a vaga
     e manda ler as regras no portal. */
  {
    name: "matricula_confirmada",
    category: "UTILITY",
    language: "pt_BR",
    // {{1}} primeiro nome · {{2}} unidade · {{3}} dia e hora
    exemplo: ["Maria", "Timóteo", "sexta, 05/09 às 14:00"],
    components: [
      {
        type: "BODY",
        text:
          "Obrigada, {{1}}! Recebemos o seu pagamento e sua vaga está garantida:\n\n" +
          "📍 Unidade: {{2}}\n" +
          "🗓️ Quando: {{3}}\n\n" +
          "Antes da primeira aula, leia as regras de reposição e cancelamento no portal da aluna — é rapidinho e evita mal-entendido depois. 💚",
        example: { body_text: [["Maria", "Timóteo", "sexta, 05/09 às 14:00"]] },
      },
      { type: "FOOTER", text: FOOTER },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Abrir portal", url: PORTAL_URL }],
      },
    ],
  },
];

/* ---------- validações locais, para não gastar ciclo de recusa da Meta ---------- */
const REGRAS = [
  [(t) => /^[a-z0-9_]+$/.test(t.name), "nome só pode ter minúsculas, números e _"],
  [(t) => t.name.length <= 512, "nome longo demais"],
  [(t) => body(t).length <= 1024, "corpo passa de 1024 caracteres"],
  [(t) => !/^\s*\{\{\d+\}\}/.test(body(t)), "corpo não pode COMEÇAR com variável"],
  [(t) => !/\{\{\d+\}\}\s*$/.test(body(t)), "corpo não pode TERMINAR com variável"],
  [(t) => !/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body(t)), "duas variáveis coladas"],
  [(t) => vars(t).every((n, i) => n === i + 1), "variáveis fora de ordem (precisa ser {{1}}, {{2}}, ...)"],
  [(t) => (footer(t) || "").length <= 60, "rodapé passa de 60 caracteres"],
  [(t) => botoes(t).every((b) => b.text.length <= 25), "texto de botão passa de 25 caracteres"],
  [(t) => botoes(t).filter((b) => b.type === "QUICK_REPLY").length <= 3, "mais de 3 botões de resposta rápida"],
  [(t) => vars(t).length === (t.exemplo || []).length, "quantidade de exemplos difere da de variáveis"],
];

const comp = (t, tipo) => t.components.find((c) => c.type === tipo);
const body = (t) => comp(t, "BODY")?.text || "";
const footer = (t) => comp(t, "FOOTER")?.text;
const botoes = (t) => comp(t, "BUTTONS")?.buttons || [];
const vars = (t) => [...body(t).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

function validar(t) {
  return REGRAS.filter(([ok]) => !ok(t)).map(([, msg]) => msg);
}

// Substitui {{n}} pelos exemplos, para conferir como a mensagem chega de verdade.
function previa(t) {
  return body(t).replace(/\{\{(\d+)\}\}/g, (_, n) => t.exemplo?.[n - 1] ?? `{{${n}}}`);
}

/* ---------------------------------- CLI ---------------------------------- */
const listar = process.argv.includes("--listar");
const enviar = process.argv.includes("--enviar");

if (listar || enviar) {
  if (!waTemplatesConfigured()) {
    console.log("❌ Faltam WA_TOKEN e/ou WA_WABA_ID no .env.");
    process.exit(1);
  }
}

if (listar) {
  const r = await listWaTemplates();
  const linhas = r.data || [];
  if (!linhas.length) console.log("Nenhum template cadastrado ainda.");
  for (const t of linhas) {
    const icone = { APPROVED: "✅", PENDING: "⏳", REJECTED: "❌" }[t.status] || "•";
    console.log(`${icone} ${t.name}  [${t.category}/${t.language}]  ${t.status}` +
      (t.rejected_reason && t.rejected_reason !== "NONE" ? `  — ${t.rejected_reason}` : ""));
  }
  process.exit(0);
}

let problemas = 0;
for (const t of TEMPLATES) {
  const erros = validar(t);
  problemas += erros.length;
  console.log(`\n${"─".repeat(64)}`);
  console.log(`${t.name}   [${t.category}]   ${vars(t).length} variáve${vars(t).length === 1 ? "l" : "is"}`);
  console.log("─".repeat(64));
  console.log(previa(t));
  const f = footer(t); if (f) console.log(`\n   ${f}`);
  const b = botoes(t); if (b.length) console.log(`   [ ${b.map((x) => x.text).join(" ] [ ")} ]`);
  if (erros.length) console.log("\n❌ " + erros.join("\n❌ "));
}

console.log(`\n${"─".repeat(64)}`);
if (problemas) {
  console.log(`❌ ${problemas} problema(s) encontrado(s). Corrija antes de submeter.`);
  process.exit(1);
}
console.log("✅ Todos os textos passaram nas regras da Meta.");

if (!enviar) {
  console.log("\nNada foi enviado. Para submeter à aprovação:");
  console.log("   node --env-file=.env scripts/wa-templates.mjs --enviar");
  process.exit(0);
}

for (const t of TEMPLATES) {
  try {
    const r = await createWaTemplate(t);
    console.log(`✅ ${t.name} submetido — status ${r.status || "PENDING"} (id ${r.id})`);
  } catch (e) {
    const msg = e?.body?.error?.error_user_msg || e?.body?.error?.message || e.message;
    console.log(`❌ ${t.name}: ${msg}`);
  }
}
console.log("\nAcompanhe a aprovação com: node --env-file=.env scripts/wa-templates.mjs --listar");
