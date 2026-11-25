/* Cria a campanha do PACOTE (24/11/2026), já configurada como a Inêz pediu:
   • código usado até 30/11/2026, por alunas que já estudam (portal) e novas (matrícula);
   • mensalidade de dezembro/2026 grátis;
   • janeiro, fevereiro e março/2027 pagos juntos, num Pix só (soma do plano dela);
   • abril/2027 volta a ser cobrada sozinha;
   • quem já estuda paga o pacote no dia em que usa o código; aluna nova paga
     na matrícula, sem taxa.
   Tudo continua editável na tela Campanhas (código, datas, meses, limite…).
   Idempotente: se o código já existir, não mexe em nada.

   Rodar (com o banco certo no .env), depois do deploy que cria as colunas:
     node --env-file=.env scripts/criar-campanha-pacote.mjs [CODIGO]          */
import { PrismaClient } from "@prisma/client";
import { limparCampanha, descreverBeneficios } from "../src/vouchers.js";

const prisma = new PrismaClient();
const codigo = process.argv[2] || "PACOTEVERAO";

const { erro, dados } = limparCampanha({
  codigo,
  nome: "Pacote de verão — dezembro grátis",
  descricao: "Dezembro é presente nosso: pague janeiro, fevereiro e março juntos e não paga dezembro. 💚",
  publico: "todas",
  inicio: "2026-11-24",
  fim: "2026-11-30",
  pacoteInicio: "2026-12",
  pacoteGratis: 1,
  pacotePagos: 3,
  ativo: true,
});
if (erro) { console.error(erro); process.exit(1); }

const existe = await prisma.voucher.findUnique({ where: { codigo: dados.codigo } });
if (existe) {
  console.log(`Já existe uma campanha com o código ${dados.codigo} (id ${existe.id}) — nada mudou.`);
} else {
  const v = await prisma.voucher.create({ data: { ...dados, criadoPor: "script" } });
  console.log(`Campanha criada: ${v.codigo} (id ${v.id})`);
  for (const b of descreverBeneficios(v)) console.log(`  • ${b}`);
}
await prisma.$disconnect();
