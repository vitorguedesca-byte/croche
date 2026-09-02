/* ========================= FERIADOS: NÃO HÁ AULA =========================
   Em feriado a escola não abre, salvo quando a ADMIN liga "Terá aula" para a
   unidade naquele dia. O calendário é calculado por UNIDADE: um feriado
   municipal de Ipatinga não pode fechar Timóteo (nem o contrário).

   De onde saem as datas, nesta ordem:

   1. NACIONAIS, calculados aqui.
   2. MUNICIPAIS, próprios de Ipatinga e Timóteo. Sexta-feira da Paixão e
      Corpus Christi são datas móveis, por isso nascem a partir da Páscoa.
   3. MANUAIS, cadastrados pela escola em Configurações.
   4. ABERTURAS, ligadas no próprio dia da agenda para uma unidade específica.

   Este módulo é PURO de propósito: não toca no banco e não conhece Prisma.
   Quem chama traz as datas manuais. */

// Nacionais de data fixa — 'MM-DD': nome
const FIXOS = {
  "01-01": "Confraternização Universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "12-25": "Natal",
};

/* Consciência Negra virou feriado NACIONAL pela Lei 14.759, de 21/12/2023 —
   antes disso era feriado só em parte dos municípios. O corte por ano existe
   para o calendário de anos anteriores não sair errado no histórico. */
const CONSCIENCIA_NEGRA_DESDE = 2024;

/* Domingo de Páscoa pelo algoritmo de Meeus/Butcher (calendário gregoriano). */
export function domingoDePascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDe(Date.UTC(ano, mes - 1, dia));
}

const isoDe = (ms) => new Date(ms).toISOString().slice(0, 10);

// 'YYYY-MM-DD' somada de n dias (n pode ser negativo)
function maisDias(iso, n) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return isoDe(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * 86400000);
}

/* Feriados nacionais de um ano: { 'YYYY-MM-DD': 'nome' }.
   Carnaval e Corpus Christi são pontos facultativos no calendário federal;
   Sexta-feira da Paixão é feriado religioso definido localmente. Portanto eles
   não entram nesta lista nacional. */
export function feriadosNacionais(ano) {
  const y = Number(ano);
  if (!y) return {};
  const cal = {};
  for (const [md, nome] of Object.entries(FIXOS)) cal[`${y}-${md}`] = nome;
  if (y >= CONSCIENCIA_NEGRA_DESDE) cal[`${y}-11-20`] = "Consciência Negra";
  return cal;
}

/* Feriados municipais recorrentes das duas cidades atendidas.
   Fontes municipais: Lei 528/1975 e Lei 1.676/1999 (Ipatinga); Lei 590/1975
   e Lei 1.833/1997 (Timóteo). A separação por unidade fica explícita mesmo
   quando as cidades coincidem em uma data. */
export function feriadosMunicipais(ano, unidade) {
  const y = Number(ano);
  if (!y) return {};
  const u = String(unidade || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (u !== "ipatinga" && u !== "timoteo") return {};
  const pascoa = domingoDePascoa(y);
  return {
    [maisDias(pascoa, -2)]: "Sexta-feira da Paixão",
    [`${y}-04-29`]: u === "ipatinga" ? "Emancipação de Ipatinga" : "Aniversário de Timóteo",
    [maisDias(pascoa, 60)]: "Corpus Christi",
    [`${y}-08-15`]: "Assunção de Nossa Senhora",
  };
}

/* Calendário completo usado pelo sistema.

   `anos`    — lista de anos a calcular (o servidor manda o atual e os vizinhos)
   `manuais` — [{ date, nome, remove }] vindos do banco

   Devolve { 'YYYY-MM-DD': 'nome' } já com as remoções aplicadas. O manual vence
   o nacional: é a Inêz quem decide o que acontece na porta da escola. */
export function calendarioFeriados(anos = [], manuais = [], unidade = "") {
  const cal = {};
  for (const ano of anos) Object.assign(cal, feriadosNacionais(ano), feriadosMunicipais(ano, unidade));
  for (const f of manuais || []) {
    const d = String(f?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (f.unit && unidade && f.unit !== unidade) continue;
    if (f.remove) delete cal[d];
    else cal[d] = String(f.nome || "Feriado").trim() || "Feriado";
  }
  return cal;
}

// Anos que o calendário precisa cobrir a partir de uma data: o dela e o seguinte
// (a replicação de 52 semanas atravessa a virada do ano).
export function anosDoCalendario(hoje) {
  const y = Number(String(hoje).slice(0, 4)) || new Date().getUTCFullYear();
  return [y - 1, y, y + 1, y + 2];
}

/* O nome do feriado naquele dia, ou "" se é dia normal.
   `cal` é o mapa devolvido por calendarioFeriados. */
export const feriadoDe = (cal, date) => (cal || {})[String(date || "")] || "";
export const ehFeriado = (cal, date) => !!feriadoDe(cal, date);

// Mensagem única para todas as recusas — a aluna e a Inêz leem a mesma coisa.
export const recusaFeriado = (nome, date) =>
  `${diaBR(date)} é feriado (${nome}) e a escola não abre. Escolha outro dia. 💚`;

// 'YYYY-MM-DD' → '02/09'
function diaBR(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : String(date || "");
}
