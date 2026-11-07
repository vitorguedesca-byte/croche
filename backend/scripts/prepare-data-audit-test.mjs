// Banco SQLite descartável, dentro de backend/.qa. Não lê DATABASE_URL.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { AUDIT_FIELDS } from "../src/dataAudit.js";

const root = new URL("../.qa/data-audit-db/", import.meta.url);
mkdirSync(root, { recursive: true });
const productionSchema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const models = { client: "Client", invoice: "Invoice", monthlyPrice: "MonthlyPrice", settings: "Settings", dataAudit: "DataAudit" };
let schema = `generator client {
  provider = "prisma-client-js"
  output = "./client"
}
datasource db {
  provider = "sqlite"
  url = "file:./audit-test.db"
}
`;
for (const [delegate, model] of Object.entries(models)) {
  const source = productionSchema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))[1];
  const fields = delegate === "dataAudit" ? null : new Set([...AUDIT_FIELDS[delegate], ...(delegate === "client" ? ["pin", "cpf", "phone", "notes"] : [])]);
  const lines = source.split("\n").filter(line => {
    const field = line.trim().split(/\s/)[0];
    return fields ? fields.has(field) : !line.trim().startsWith("//") && !!line.trim();
  }).map(line => line.replace(/@db\.\w+(?:\([^)]*\))?/g, "").replace(/\/\/.*$/, "").trim());
  if (delegate === "client") lines.push("invoices Invoice[]", "precos MonthlyPrice[]");
  if (delegate === "invoice" || delegate === "monthlyPrice") lines.push("client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)");
  if (delegate === "monthlyPrice") lines.push("@@unique([clientId, competencia])");
  schema += `\nmodel ${model} {\n  ${lines.join("\n  ")}\n}\n`;
}
const path = fileURLToPath(new URL("schema.prisma", root));
writeFileSync(path, schema);
// O schema engine do Windows precisa do arquivo SQLite existente no primeiro push.
writeFileSync(new URL("audit-test.db", root), "", { flag: "a" });
const cli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
for (const args of [["generate", "--schema", path], ["db", "push", "--schema", path, "--skip-generate"]]) {
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" } });
  if (result.status !== 0) process.exit(result.status || 1);
}
