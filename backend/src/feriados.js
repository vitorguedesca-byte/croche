/* ========================= FERIADOS: NÃO HÁ AULA =========================
   Regra da escola, combinada em 01/09/2026: em feriado a escola não abre.
   Nenhum horário é criado, nenhuma aula é marcada — nem pelo painel, nem pelo
   portal da aluna, nem pelo WhatsApp, e a replicação semanal pula a data.

   De onde saem as datas, nesta ordem:

   1. NACIONAIS, calculados aqui. Os fixos são sempre os mesmos; os móveis
      (Carnaval, Sexta-feira Santa, Corpus Christi) andam com a Páscoa e por
      isso são calculados, nunca digitados.
   2. MANUAIS, cadastrados pela Inêz em Configurações — o feriado municipal de
      Ipatinga, o de Timóteo, um recesso, uma emenda. Uma data manual também
      pode DESMARCAR um nacional (`remove`), para o caso de a escola decidir
      abrir num feriado.

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

/* Domingo de Páscoa pelo algoritmo de Meeus/Butcher (calendário gregoriano).
   É a âncora dos três feriados móveis; todos são contados a partir dele. */
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
   Móveis, contados a partir do Domingo de Páscoa:
     Carnaval        −47 dias (terça-feira)
     Sexta-feira Santa −2 dias
     Corpus Christi  +60 dias
   A segunda-feira de carnaval e a quarta-feira de cinzas NÃO entram: não são
   feriado nacional. Onde a escola não abre nesses dias, a Inêz cadastra na mão
   — é justamente para isso que existe a lista manual. */
export function feriadosNacionais(ano) {
  const y = Number(ano);
  if (!y) return {};
  const cal = {};
  for (const [md, nome] of Object.entries(FIXOS)) cal[`${y}-${md}`] = nome;
  if (y >= CONSCIENCIA_NEGRA_DESDE) cal[`${y}-11-20`] = "Consciência Negra";
  const pascoa = domingoDePascoa(y);
  cal[maisDias(pascoa, -47)] = "Carnaval";
  cal[maisDias(pascoa, -2)] = "Sexta-feira Santa";
  cal[maisDias(pascoa, 60)] = "Corpus Christi";
  return cal;
}

/* Calendário completo usado pelo sistema.

   `anos`    — lista de anos a calcular (o servidor manda o atual e os vizinhos)
   `manuais` — [{ date, nome, remove }] vindos do banco

   Devolve { 'YYYY-MM-DD': 'nome' } já com as remoções aplicadas. O manual vence
   o nacional: é a Inêz quem decide o que acontece na porta da escola. */
export function calendarioFeriados(anos = [], manuais = []) {
  const cal = {};
  for (const ano of anos) Object.assign(cal, feriadosNacionais(ano));
  for (const f of manuais || []) {
    const d = String(f?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
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
