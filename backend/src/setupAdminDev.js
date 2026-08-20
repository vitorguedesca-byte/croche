import { prisma } from "./prismaClient.js";
import bcrypt from "bcryptjs";

async function main() {
  console.log("--- Consultando AdminUsers existentes ---");
  const existing = await prisma.adminUser.findMany();
  console.log("Existentes:", existing.map(u => ({ id: u.id, username: u.username })));

  const targetUsername = "admin";
  const targetPassword = "admin"; // senha padrão de desenvolvimento

  const hash = await bcrypt.hash(targetPassword, 10);

  const existingAdmin = await prisma.adminUser.findFirst({
    where: { username: targetUsername }
  });

  if (existingAdmin) {
    await prisma.adminUser.update({
      where: { id: existingAdmin.id },
      data: { pass: hash }
    });
    console.log(`Senha do usuário '${targetUsername}' atualizada com sucesso para '${targetPassword}'!`);
  } else {
    await prisma.adminUser.create({
      data: {
        username: targetUsername,
        pass: hash
      }
    });
    console.log(`Usuário '${targetUsername}' criado com sucesso com a senha '${targetPassword}'!`);
  }

  const all = await prisma.adminUser.findMany();
  console.log("Todos os administradores agora:", all.map(u => ({ id: u.id, username: u.username })));
}

main()
  .catch((e) => {
    console.error("Erro ao configurar admin:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
