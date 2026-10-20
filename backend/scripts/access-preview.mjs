// Prévia isolada: serve o frontend compilado e a API real de acessos com dados
// descartáveis em memória. Nunca conecta ao MySQL nem importa server.js.
import express from "express";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import { createAccessControl } from "../src/accessControl.js";
import { filterState } from "../src/accessPolicy.js";
import { memoryPrisma } from "./access-fixture.mjs";
const app = express(); app.use(express.json());
const prisma = memoryPrisma();
// Credencial pública de fixture, sem acesso a qualquer banco ou conta real.
await prisma.adminUser.create({ data: { username: "admin.teste", nome: "Admin da prévia", role: "admin", pass: await bcrypt.hash("PreviaLocal123", 10) } });
const access = createAccessControl({ prisma, isPublicApi: req => /^\/api\/admin\/(exists|setup|register|login)$/.test(req.path) || ["/api/settings", "/api/testimonials", "/api/slots/available"].includes(req.path) });
app.use(access.middleware); app.use(access.router);
const meta = { units: ["Ipatinga", "Timóteo"], profs: ["Equipe FQC"], valorPadrao: 80, capacidadePadrao: 4, duracaoAulaMin: 120, valorPlano1x: 120, valorPlano2x: 200, feriados: {}, feriadosPorUnidade: {}, aberturasFeriado: [] };
app.get("/api/state", (req, res) => res.json(filterState({ access: access.safeUser(req.admin), meta, clients: [], slots: [], bookings: [], invoices: [], makeups: [], precos: [], presentes: [], waRecebidas: [], pixAlertas: [], funilAvisos: [] }, req.admin)));
app.get("/api/settings", (_req, res) => res.json(meta));
app.get("/api/testimonials", (_req, res) => res.json([]));
app.get("/api/slots/available", (_req, res) => res.json({ meta, slots: [] }));
app.use(express.static(fileURLToPath(new URL("../../frontend/dist", import.meta.url))));
app.get("*", (_req, res) => res.sendFile(fileURLToPath(new URL("../../frontend/dist/index.html", import.meta.url))));
app.listen(5188, "127.0.0.1", () => console.log("Prévia com dados descartáveis: http://127.0.0.1:5188/admin"));
