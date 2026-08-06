import { prisma } from "./prismaClient.js";
import bcrypt from "bcryptjs";

async function main() {
  console.log("Resetando AdminUser...");
  await prisma.adminUser.deleteMany();
  const user = await prisma.adminUser.create({
    data: {
      username: "inez",
      pass: await bcrypt.hash("654321", 10),
    },
  });
  console.log("AdminUser recriado com sucesso:", user.username);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
