/* Cria (ou atualiza) os acessos das INSTRUTORAS.
   Perfil "instrutora": vê só Operação › Agenda, e só para consultar.
   Rodar com:  npx dotenv -e .env -- node scripts/criar-instrutoras.mjs      */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const INSTRUTORAS = [
  { nome: "Francielle Vitorino", username: "francielle", senha: "agulha472" },
  { nome: "Maria da Luz",        username: "marialuz",   senha: "linha358"  },
  { nome: "Viviane",             username: "viviane",    senha: "croche916" },
  { nome: "Tatiane",             username: "tatiane",    senha: "novelo245" },
  { nome: "Cristina",            username: "cristina",   senha: "trico683"  },
];

const main = async () => {
  for (const i of INSTRUTORAS) {
    const pass = await bcrypt.hash(i.senha, 10);
    const existente = await prisma.adminUser.findFirst({ where: { username: i.username } });
    if (existente) {
      await prisma.adminUser.update({
        where: { id: existente.id },
        data: { pass, role: "instrutora", nome: i.nome },
      });
      console.log(`~ atualizada  ${i.username.padEnd(12)} (${i.nome}) — senha: ${i.senha}`);
    } else {
      await prisma.adminUser.create({
        data: { username: i.username, pass, role: "instrutora", nome: i.nome },
      });
      console.log(`+ criada      ${i.username.padEnd(12)} (${i.nome}) — senha: ${i.senha}`);
    }
  }
  console.log("\nPronto. Elas entram na mesma tela de login do painel.");
  console.log("Acesso: Operação › Agenda, somente leitura (mês, semana, dia e lista).");
};

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
