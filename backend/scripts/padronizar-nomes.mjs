/* ============================================================================
   Padroniza os nomes JÁ GRAVADOS no banco.

   Uso:
     node scripts/padronizar-nomes.mjs            → só mostra o que mudaria
     node scripts/padronizar-nomes.mjs --aplicar  → grava (faz backup antes)

   A regra é a mesma do sistema (src/nomes.js): caixa correta, espaços,
   conectivos em minúscula, charset consertado, caractere estranho fora.

   O CUIDADO IMPORTANTE
   A aula é ligada à aluna pelo NOME (Booking.clientName), não pelo id. Então
   renomear a ficha sem renomear as aulas deixaria o histórico órfão. Aqui todo
   nome desce em cascata para Booking.clientName e Waitlist.name, na mesma
   transação.

   E o script PARA sozinho se duas alunas diferentes forem cair no mesmo nome
   depois da padronização (ex.: "MARIA SILVA" e "maria silva" são dois
   cadastros). Isso não é padronizar, é fundir duas pessoas — decisão que só a
   Inêz pode tomar, cadastro a cadastro. Nesse caso ele lista os conflitos e
   não grava nada.
   ========================================================================== */
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { padronizarNome, chaveNome } from "../src/nomes.js";

const prisma = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const cor = { verde: "\x1b[32m", verm: "\x1b[31m", amar: "\x1b[33m", cinza: "\x1b[90m", off: "\x1b[0m" };
const linha = (n = 74) => console.log(cor.cinza + "─".repeat(n) + cor.off);

async function main() {
  console.log(`\n🧶 Padronização de nomes — ${APLICAR ? cor.amar + "MODO GRAVAÇÃO" + cor.off : "simulação (nada será gravado)"}\n`);

  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
  const bookings = await prisma.booking.findMany({ select: { id: true, clientName: true } });
  const waitlist = await prisma.waitlist.findMany({ select: { id: true, name: true } });

  /* ---- 1. o que muda em cada ficha ---- */
  const mudancas = clients
    .map((c) => ({ id: c.id, de: c.name, para: padronizarNome(c.name) }))
    .filter((m) => m.de !== m.para && m.para);

  const vazios = clients.filter((c) => !padronizarNome(c.name));

  /* ---- 2a. COLISÃO (impede a gravação): duas fichas cairiam no nome
     idêntico. Aí a cascata misturaria as aulas de duas pessoas. ---- */
  const agrupar = (fn) => {
    const m = new Map();
    for (const c of clients) {
      const k = fn(c.name);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return [...m.values()].filter((g) => g.length > 1);
  };
  const colisoes = agrupar(padronizarNome);

  /* ---- 2b. PARECIDOS (só aviso): mesmo nome ignorando acento — "Ines" e
     "Inês", "Luis" e "Luís". Podem ser a mesma pessoa cadastrada duas vezes,
     mas o script não decide isso: acento que falta é correção manual. ---- */
  const parecidos = agrupar(chaveNome).filter(
    (g) => new Set(g.map((c) => padronizarNome(c.name))).size > 1
  );

  /* ---- 3. aulas cujo clientName não bate com ficha nenhuma ---- */
  const nomesDeFicha = new Set(clients.map((c) => c.name));
  const orfas = new Map(); // nome → nº de aulas
  for (const b of bookings) {
    if (!nomesDeFicha.has(b.clientName)) orfas.set(b.clientName, (orfas.get(b.clientName) || 0) + 1);
  }

  /* ================= relatório ================= */
  console.log(`Cadastros: ${clients.length} · aulas: ${bookings.length} · lista de espera: ${waitlist.length}`);
  linha();

  if (!mudancas.length) {
    console.log(cor.verde + "✓ Todos os nomes já estão padronizados." + cor.off);
  } else {
    console.log(`${cor.amar}${mudancas.length} nome(s) a padronizar:${cor.off}\n`);
    for (const m of mudancas) {
      const aulas = bookings.filter((b) => b.clientName === m.de).length;
      const espera = waitlist.filter((w) => w.name === m.de).length;
      const junto = [aulas ? `${aulas} aula(s)` : null, espera ? `${espera} na espera` : null].filter(Boolean).join(", ");
      console.log(`  ${cor.verm}${m.de}${cor.off}\n    → ${cor.verde}${m.para}${cor.off}${junto ? cor.cinza + `   (leva junto: ${junto})` + cor.off : ""}`);
    }
  }

  if (vazios.length) {
    linha();
    console.log(`${cor.verm}⚠ ${vazios.length} cadastro(s) ficariam SEM nome depois da limpeza (nome só com símbolo/emoji).${cor.off}`);
    vazios.forEach((c) => console.log(`  #${c.id}  ${JSON.stringify(c.name)}`));
    console.log(cor.cinza + "  Esses ficam como estão — precisam ser corrigidos à mão na ficha." + cor.off);
  }

  if (orfas.size) {
    linha();
    console.log(`${cor.amar}ℹ ${orfas.size} nome(s) aparecem em aulas mas não têm ficha de aluna:${cor.off}`);
    [...orfas.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, q]) => console.log(`  ${q.toString().padStart(3)} aula(s)  ${n}`));
    console.log(cor.cinza + "  (o script não mexe nesses: sem ficha, não há o que padronizar em cascata)" + cor.off);
  }

  if (parecidos.length) {
    linha();
    console.log(`${cor.amar}ℹ ${parecidos.length} grupo(s) de nomes quase iguais (só o acento difere) — pode ser cadastro repetido:${cor.off}`);
    for (const g of parecidos) {
      console.log("  " + g.map((c) => `#${c.id} ${padronizarNome(c.name)}`).join("   ·   "));
    }
    console.log(cor.cinza + "  O script não junta nem acentua por conta própria — confira no painel se quiser unificar." + cor.off);
  }

  if (colisoes.length) {
    linha();
    console.log(`${cor.verm}✖ ${colisoes.length} conflito(s): fichas diferentes que viram o MESMO nome.${cor.off}\n`);
    for (const g of colisoes) {
      console.log(`  vira "${padronizarNome(g[0].name)}":`);
      for (const c of g) {
        const aulas = bookings.filter((b) => b.clientName === c.name).length;
        console.log(`    #${c.id}  ${JSON.stringify(c.name)}  ${cor.cinza}${c.phone || "sem telefone"} · ${aulas} aula(s)${cor.off}`);
      }
    }
    console.log(`\n${cor.verm}Nada foi gravado.${cor.off} Resolva os duplicados primeiro (junte ou renomeie as fichas no painel) e rode de novo.`);
    return;
  }

  /* ================= gravação ================= */
  linha();
  if (!mudancas.length) return;
  if (!APLICAR) {
    console.log(`Simulação. Para gravar de verdade:\n\n   ${cor.verde}node scripts/padronizar-nomes.mjs --aplicar${cor.off}\n`);
    return;
  }

  // backup antes de tocar em qualquer coisa
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const arquivo = join(RAIZ, `backup-nomes-${carimbo}.json`);
  writeFileSync(arquivo, JSON.stringify({ geradoEm: new Date().toISOString(), clients, bookings, waitlist }, null, 2), "utf8");
  console.log(`💾 Backup: ${arquivo}`);

  let fichas = 0, aulas = 0, esperas = 0;
  for (const m of mudancas) {
    const [, b, w] = await prisma.$transaction([
      prisma.client.update({ where: { id: m.id }, data: { name: m.para } }),
      prisma.booking.updateMany({ where: { clientName: m.de }, data: { clientName: m.para } }),
      prisma.waitlist.updateMany({ where: { name: m.de }, data: { name: m.para } }),
    ]);
    fichas++; aulas += b.count; esperas += w.count;
  }

  console.log(`\n${cor.verde}✓ Pronto.${cor.off} ${fichas} ficha(s), ${aulas} aula(s) e ${esperas} espera(s) atualizadas.`);
  console.log(cor.cinza + "  Reinicie o backend (ou espere o painel atualizar sozinho) para ver o resultado.\n" + cor.off);
}

main()
  .catch((e) => { console.error(`\n${cor.verm}Erro:${cor.off}`, e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
