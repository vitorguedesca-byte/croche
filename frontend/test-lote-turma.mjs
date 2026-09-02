/* Teste do alcance do LOTE do painel — irmasNaAgenda() em src/helpers.js.

   Este teste mora no frontend, e não em backend/ como os outros, porque é o
   helper do frontend que ele prende. Ele existe porque `irmasNaAgenda` virou a
   definição ÚNICA de "quais turmas o lote alcança": as três ações do painel
   (incluir, alterar, excluir) contam por ela quantas ocorrências vão mudar, e
   o backend repete o mesmo critério em irmasDaTurma(). Um erro aqui não dá
   erro nenhum na tela — só apaga ou remaneja a agenda errada, em silêncio.

   Rode com: node frontend/test-lote-turma.mjs                                */
import { irmasNaAgenda, todayISO, SEMANAS_PADRAO, MESES_PADRAO } from "./src/helpers.js";

let falhas = 0;
const ok = (cond, nome) => { console.log(`${cond ? "  ok" : "FALHA"}  ${nome}`); if (!cond) falhas++; };

const HOJE = todayISO();
const dias = (n) => {
  const d = new Date(HOJE + "T00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// A turma-base: hoje, Ipatinga, 09:00. As irmãs são as de 7 em 7 dias.
const base = { id: 1, date: HOJE, unit: "Ipatinga", time: "09:00", capacity: 4 };
const slots = [
  base,
  { id: 2, date: dias(7), unit: "Ipatinga", time: "09:00", capacity: 4 },   // irmã
  { id: 3, date: dias(14), unit: "Ipatinga", time: "09:00", capacity: 4 },  // irmã
  { id: 4, date: dias(-7), unit: "Ipatinga", time: "09:00", capacity: 4 },  // passado
  { id: 5, date: dias(7), unit: "Timóteo", time: "09:00", capacity: 4 },    // outra unidade
  { id: 6, date: dias(7), unit: "Ipatinga", time: "14:00", capacity: 4 },   // outra hora
  { id: 7, date: dias(1), unit: "Ipatinga", time: "09:00", capacity: 4 },   // outro dia da semana
  { id: 8, date: dias(21), unit: "Ipatinga", time: "9:00", capacity: 4 },   // hora sem zero à esquerda
];
const ids = (arr) => arr.map((s) => s.id).sort((a, b) => a - b);

const r = irmasNaAgenda({ slots }, base);

ok(ids(r).join() === "2,3,8", "alcança as ocorrências futuras do mesmo dia/hora/unidade");
ok(!r.some((s) => s.id === 1), "não devolve a própria turma");
ok(!r.some((s) => s.id === 4), "não alcança o passado — aula realizada é histórico");
ok(!r.some((s) => s.id === 5), "não atravessa unidades");
ok(!r.some((s) => s.id === 6), "não pega outro horário");
ok(!r.some((s) => s.id === 7), "não pega outro dia da semana");
ok(r.some((s) => s.id === 8), '"9:00" e "09:00" são a mesma turma (time é texto livre)');

/* A série existe para alcançar o que o trio unidade/hora/dia perde: a turma
   criada junto que depois foi movida para outro horário. */
const comSerie = { ...base, seriesId: "abc" };
const slotsSerie = [
  comSerie,
  { id: 9, date: dias(7), unit: "Ipatinga", time: "10:30", capacity: 4, seriesId: "abc" },
  { id: 10, date: dias(7), unit: "Ipatinga", time: "10:30", capacity: 4, seriesId: "outra" },
];
const rs = irmasNaAgenda({ slots: slotsSerie }, comSerie);
ok(rs.some((s) => s.id === 9), "a mesma série entra mesmo com horário diferente");
ok(!rs.some((s) => s.id === 10), "série diferente não entra");

// Sem agenda nenhuma o lote não inventa irmãs (e não estoura).
ok(irmasNaAgenda({ slots: [] }, base).length === 0, "agenda vazia devolve lista vazia");
ok(irmasNaAgenda({ slots }, null).length === 0, "turma inexistente devolve lista vazia");

/* O horizonte tem que bater com o do backend (regrasAula.js). Se um lado
   replicar 12 meses e o outro 4 semanas, a aluna nova fica com a agenda
   terminando antes da turma dela. */
ok(SEMANAS_PADRAO === 52, "horizonte padrão: 52 semanas");
ok(MESES_PADRAO === 12, "horizonte padrão: 12 meses");

console.log(falhas ? `\n${falhas} caso(s) falharam.` : "\nTodos os casos passaram.");
process.exit(falhas ? 1 : 0);
