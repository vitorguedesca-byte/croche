import { useState, useEffect, useMemo, Fragment } from "react";
import { useStore } from "./store.jsx";
import { useModal } from "./ui.jsx";
import { api } from "./api.js";
import { ClientProfile, SlotDetail } from "./modals.jsx";
import { exportCsv } from "./exports.js";
import {
  todayISO, addDays, weekStart, fmtDate, fmtDateLong, money, capitalize, hhmm, unitColor,
  slotCapacity, slotWaitlist, contemBusca, bookingKindDe, dowMon, WEEKDAYS_PT, WEEKDAYS_SHORT, classifyClient,
} from "./helpers.js";

/* ============================================================
   Relatórios do Financeiro — duas abas:

   • VENDAS: o dinheiro que entrou no período, por unidade e no
     total, separado pelo tipo (mensalidade, matrícula, taxa, aula
     avulsa, aula extra). As linhas vêm prontas do servidor
     (GET /api/relatorios/vendas) — é lá que mora a regra de não
     contar o mesmo Pix duas vezes; aqui só se soma.
   • VAGAS: capacidade da grade (dias × turmas × vagas), ocupação,
     alunas × vagas, turmas da grade e o tipo de cada aluna, por
     unidade e no total. Sai do estado do painel (horários +
     marcações), sem chamada extra.

   Em ambas, o resumo por unidade não muda com o filtro de unidade:
   o filtro só estreita a lista detalhada lá embaixo.
   ============================================================ */

const pad = (n) => String(n).padStart(2, "0");

/* ----------------- período (dia / semana / mês / ano) ----------------- */
function intervalo(tipo, ref) {
  if (tipo === "dia") return [ref, ref];
  if (tipo === "semana") { const s = weekStart(ref); return [s, addDays(s, 6)]; }
  // grade típica: 4 semanas a partir da semana de referência (a tela mostra a média)
  if (tipo === "tipica") { const s = weekStart(ref); return [s, addDays(s, 27)]; }
  const [y, m] = ref.split("-").map(Number);
  if (tipo === "mes") return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`];
  return [`${y}-01-01`, `${y}-12-31`];
}
function andar(tipo, ref, dir) {
  if (tipo === "dia") return addDays(ref, dir);
  if (tipo === "semana") return addDays(ref, 7 * dir);
  if (tipo === "tipica") return addDays(ref, 28 * dir);
  const [y, m] = ref.split("-").map(Number);
  if (tipo === "mes") { const d = new Date(y, m - 1 + dir, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; }
  return `${y + dir}-01-01`;
}
function rotuloPeriodo(tipo, ref) {
  const [de, ate] = intervalo(tipo, ref);
  if (tipo === "dia") return capitalize(fmtDateLong(ref)) + (ref === todayISO() ? " · hoje" : "");
  if (tipo === "semana") return `${fmtDate(de)} – ${fmtDate(ate)}`;
  if (tipo === "tipica") return `${fmtDate(de)} – ${fmtDate(ate)} · média`;
  if (tipo === "mes") return capitalize(new Date(de + "T00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  return ref.slice(0, 4);
}

function Periodo({ tipos, tipo, setTipo, refDia, setRefDia, children }) {
  const hoje = todayISO();
  const [de, ate] = intervalo(tipo, refDia);
  const ehAtual = hoje >= de && hoje <= ate;
  return (
    <div className="ag-toolbar">
      <div className="ag-views">
        {tipos.map(([k, l]) => <button key={k} className={tipo === k ? "on" : ""} onClick={() => setTipo(k)}>{l}</button>)}
      </div>
      <div className="ag-nav">
        <button className="navbtn" onClick={() => setRefDia(andar(tipo, refDia, -1))}>←</button>
        <span className="ag-period">{rotuloPeriodo(tipo, refDia)}</span>
        <button className="navbtn" onClick={() => setRefDia(andar(tipo, refDia, 1))}>→</button>
        {!ehAtual && <button className="btn ghost sm" onClick={() => setRefDia(hoje)}>Hoje</button>}
        {children}
      </div>
    </div>
  );
}

// Unidades do cadastro + qualquer outra que aparecer nos dados (ex.: "Sem unidade")
function unidadesDe(meta, extras) {
  const base = meta?.units || [];
  return [...base, ...[...new Set(extras)].filter((u) => u && !base.includes(u)).sort()];
}

function FiltroUnidade({ unidades, unit, setUnit }) {
  return (
    <div className="ag-units">
      <span style={{ fontSize: ".76rem", color: "var(--muted)", fontWeight: 700, marginRight: ".2rem" }}>Unidade:</span>
      {["Todas", ...unidades].map((u) => (
        <button key={u} className={`unit-chip ${unit === u ? "on" : ""}`}
          style={unit === u && u !== "Todas" ? { color: unitColor(u) } : undefined} onClick={() => setUnit(u)}>
          {u !== "Todas" && <span className="sw" style={{ background: unitColor(u) }} />}{u}
        </button>
      ))}
    </div>
  );
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/* ============================= VENDAS ============================= */
const TIPOS_VENDA = [
  { k: "mensalidade", l: "💳 Mensalidades", um: "💳 Mensalidade", csv: "Mensalidade" },
  { k: "matricula", l: "🎟️ Matrículas (1ª mensalidade)", um: "🎟️ Matrícula", csv: "Matrícula (1ª mensalidade)" },
  { k: "taxa", l: "🧾 Taxas de matrícula", um: "🧾 Taxa de matrícula", csv: "Taxa de matrícula" },
  { k: "avulsa", l: "🧶 Aulas avulsas", um: "🧶 Aula avulsa", csv: "Aula avulsa" },
  { k: "extra", l: "✨ Aulas extras", um: "✨ Aula extra", csv: "Aula extra" },
];
const TIPO_VENDA = Object.fromEntries(TIPOS_VENDA.map((t) => [t.k, t]));
const PERIODOS_VENDA = [["dia", "📍 Dia"], ["semana", "📆 Semana"], ["mes", "🗓 Mês"], ["ano", "📅 Ano"]];

export function RelatorioVendas() {
  const { data } = useStore();
  const { open } = useModal();
  const [tipo, setTipo] = useState("mes");
  const [refDia, setRefDia] = useState(todayISO());
  const [res, setRes] = useState(null);
  const [erro, setErro] = useState("");
  const [unit, setUnit] = useState("Todas");
  const [busca, setBusca] = useState("");
  const [de, ate] = intervalo(tipo, refDia);

  useEffect(() => {
    let vivo = true;
    setRes(null); setErro("");
    api.relatorioVendas(de, ate)
      .then((r) => { if (vivo) setRes(r); })
      .catch((e) => { if (vivo) setErro(e.message || "Não consegui carregar as vendas."); });
    return () => { vivo = false; };
  }, [de, ate]);

  const itens = res?.itens || [];
  const unidades = unidadesDe(data.meta, itens.map((i) => i.unidade));
  const soma = (lista) => lista.reduce((s, i) => s + (Number(i.valor) || 0), 0);
  const deUnidade = (u) => itens.filter((i) => i.unidade === u);
  const total = soma(itens);
  const matriculas = (lista) => lista.filter((i) => i.tipo === "matricula").length;

  // planos vendidos nas matrículas do período
  const planos = [...new Set(itens.filter((i) => i.tipo === "matricula").map((i) => i.detalhe || "sem plano"))].sort();

  const lista = itens
    .filter((i) => unit === "Todas" || i.unidade === unit)
    .filter((i) => contemBusca([i.aluna, i.unidade, TIPO_VENDA[i.tipo]?.csv, i.detalhe], busca));
  const cliOf = (i) => data.clients.find((c) => c.id === i.clientId);

  const exportar = () => exportCsv(`vendas-${de}-a-${ate}`,
    ["Data", "Aluna", "Unidade", "Tipo", "Detalhe", "Valor"],
    lista.map((i) => [i.data, i.aluna, i.unidade, TIPO_VENDA[i.tipo]?.csv || i.tipo, i.detalhe, String(i.valor.toFixed(2)).replace(".", ",")]));

  return (
    <>
      <div className="panel">
        <Periodo tipos={PERIODOS_VENDA} tipo={tipo} setTipo={setTipo} refDia={refDia} setRefDia={setRefDia} />
        {erro ? (
          <div className="empty"><div className="ic">⚠️</div><p>{erro}</p></div>
        ) : !res ? (
          <div className="empty"><div className="ic">🧶</div><p>Carregando vendas…</p></div>
        ) : (
          <>
            <div className="grid stats" style={{ marginBottom: "1rem" }}>
              {unidades.map((u) => {
                const v = soma(deUnidade(u));
                return (
                  <div key={u} className="card stat click" onClick={() => setUnit(unit === u ? "Todas" : u)}
                    style={unit === u ? { outline: `2px solid ${unitColor(u)}` } : undefined} title="Clique para ver só os lançamentos desta unidade">
                    <div className="lbl"><span style={{ background: unitColor(u), width: 10, height: 10, borderRadius: "50%", display: "inline-block" }} /> {u}</div>
                    <div className="val">{money(v)}</div>
                    <div className="foot">{deUnidade(u).length} venda(s) · {matriculas(deUnidade(u))} matrícula(s) · {pct(v, total)}% do total</div>
                  </div>
                );
              })}
              <div className="card stat">
                <div className="lbl">💰 Total</div>
                <div className="val terra">{money(total)}</div>
                <div className="foot">{itens.length} venda(s) · {matriculas(itens)} matrícula(s)</div>
              </div>
            </div>

            {res.devolvidas > 0 && (
              <div className="seg-hint">
                ↩️ {res.devolvidas} matrícula(s) devolvida(s) no período: a 1ª mensalidade voltou para a aluna e não entra aqui — a taxa de matrícula fica.
              </div>
            )}

            <table>
              <thead>
                <tr><th>Tipo</th>{unidades.map((u) => <th key={u}>{u}</th>)}<th>Total</th></tr>
              </thead>
              <tbody>
                {TIPOS_VENDA.map((t) => {
                  const doTipo = itens.filter((i) => i.tipo === t.k);
                  return (
                    <tr key={t.k}>
                      <td className="c-main"><b>{t.l}</b></td>
                      {unidades.map((u) => {
                        const x = doTipo.filter((i) => i.unidade === u);
                        return <td key={u} data-l={u}>{money(soma(x))}<div className="cli-sub">{x.length} lançamento(s)</div></td>;
                      })}
                      <td data-l="Total"><b>{money(soma(doTipo))}</b><div className="cli-sub">{doTipo.length} lançamento(s)</div></td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="c-main"><b>Total</b></td>
                  {unidades.map((u) => <td key={u} data-l={u}><b>{money(soma(deUnidade(u)))}</b><div className="cli-sub">{pct(soma(deUnidade(u)), total)}% do total</div></td>)}
                  <td data-l="Total"><b style={{ color: "var(--terracota)" }}>{money(total)}</b></td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>

      {res && planos.length > 0 && (
        <div className="panel">
          <div className="panel-h"><h2>🎟️ Matrículas novas <span className="muted-note">· plano escolhido</span></h2></div>
          <table>
            <thead><tr><th>Plano</th>{unidades.map((u) => <th key={u}>{u}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {planos.map((p) => {
                const doPlano = itens.filter((i) => i.tipo === "matricula" && (i.detalhe || "sem plano") === p);
                return (
                  <tr key={p}>
                    <td className="c-main"><b>{capitalize(p)}</b></td>
                    {unidades.map((u) => <td key={u} data-l={u}>{doPlano.filter((i) => i.unidade === u).length}</td>)}
                    <td data-l="Total"><b>{doPlano.length}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {res && (
        <div className="panel">
          <div className="panel-h">
            <h2>📋 Lançamentos <span className="muted-note">· {rotuloPeriodo(tipo, refDia)}</span></h2>
            <button className="btn sec sm" disabled={!lista.length} onClick={exportar}>⬇ Exportar CSV</button>
          </div>
          <div className="ag-filters">
            <FiltroUnidade unidades={unidades} unit={unit} setUnit={setUnit} />
          </div>
          <div className="filters" style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center", marginBottom: "1rem" }}>
            <input className="grow" placeholder="🔍 Buscar por aluna, tipo ou unidade..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            {busca && <button className="btn ghost sm" onClick={() => setBusca("")}>Limpar busca</button>}
            <span className="count">{lista.length} lançamento(s) · {money(soma(lista))}</span>
          </div>
          {lista.length ? (
            <table>
              <thead><tr><th>Aluna</th><th>Data</th><th>Unidade</th><th>Tipo</th><th>Detalhe</th><th>Valor</th></tr></thead>
              <tbody>
                {lista.map((i, n) => {
                  const c = cliOf(i);
                  return (
                    <tr key={n}>
                      <td className="cli-name c-main">
                        {c ? <span className="row-click" onClick={() => open(<ClientProfile client={c} />)}>{i.aluna}</span> : i.aluna}
                      </td>
                      <td data-l="Data">{fmtDate(i.data)}</td>
                      <td data-l="Unidade"><span className="chip">{i.unidade}</span></td>
                      <td data-l="Tipo">{TIPO_VENDA[i.tipo]?.um || i.tipo}</td>
                      <td data-l="Detalhe" className="cli-sub">{i.tipo === "mensalidade" && /^\d{4}-\d{2}/.test(i.detalhe)
                        ? `ref. ${i.detalhe.slice(5, 7)}/${i.detalhe.slice(0, 4)}${i.detalhe.slice(7)}` : (i.detalhe || "—")}</td>
                      <td data-l="Valor"><b>{money(i.valor)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty"><div className="ic">💰</div><p>{busca || unit !== "Todas" ? "Nenhum lançamento para este filtro." : "Nenhuma venda neste período."}</p></div>
          )}
        </div>
      )}
    </>
  );
}

/* ============================= VAGAS =============================
   A conta da Inêz, feita pelo sistema:
     turmas por dia × vagas por turma × dias = vagas da semana
   e, em cima dela, quem ocupa cada vaga.

   Aluna não é vaga: a do plano 2x ocupa duas por semana. Por isso a tela
   separa "alunas diferentes" de "vagas ocupadas", e compara a grade com o
   que os planos ativos já comprometem por semana.

   "Grade típica" = média das 4 semanas a partir da escolhida. A média é
   por turma (dia da semana + hora + unidade), dividida pelo número de
   vezes que ela aconteceu — um feriado tira uma aula, não puxa a média. */
const PERIODOS_VAGAS = [["dia", "📍 Dia"], ["semana", "📆 Semana"], ["mes", "🗓 Mês"], ["tipica", "📐 Grade típica"]];

const TIPOS_ALUNA = [
  { k: "fixo1", l: "Fixo 1x", cor: "#7C8A66" },
  { k: "fixo2", l: "Fixo 2x", cor: "#556347" },
  { k: "fixo34", l: "Fixo 3x/4x", cor: "#1F6B3A" },
  { k: "escala", l: "Escala", cor: "#9C6B2E" },
  { k: "primeira", l: "1ª aula", cor: "var(--danger)" },
  { k: "reposicao", l: "Reposição", cor: "var(--info)" },
  { k: "extra", l: "Aula extra", cor: "var(--green-mid)" },
  { k: "presente", l: "Presente", cor: "var(--warn)" },
  { k: "avulsa", l: "Avulsa", cor: "#8A55A8" },
];
const TIPO_ALUNA = Object.fromEntries(TIPOS_ALUNA.map((t) => [t.k, t]));

/* Nos gráficos os 9 tipos viram 6 grupos — 9 cores numa barra só não se lê.
   Reposição e 1ª aula ficam com as cores da Agenda; a ordem foi escolhida
   para que vizinhos na barra se distingam também para quem é daltônico. */
const GRUPOS_ALUNA = [
  { k: "fixo", l: "Fixo", cor: "#1F6B3A", tipos: ["fixo1", "fixo2", "fixo34"] },
  { k: "escala", l: "Escala", cor: "#C08A2E", tipos: ["escala"] },
  { k: "reposicao", l: "Reposição", cor: "var(--info)", tipos: ["reposicao"] },
  { k: "primeira", l: "1ª aula", cor: "var(--danger)", tipos: ["primeira"] },
  { k: "avulsa", l: "Avulsa", cor: "#8A55A8", tipos: ["avulsa"] },
  { k: "outras", l: "Extra e presente", cor: "#998A74", tipos: ["extra", "presente"] },
];
const somaGrupo = (tipos, g) => g.tipos.reduce((s, k) => s + (tipos[k] || 0), 0);

/* Quem ocupa a vaga. O tipo da AULA vem primeiro (reposição, 1ª aula e aula
   extra têm marca própria na reserva, as mesmas cores da Agenda); aula do
   plano é classificada pela ficha: fixo pela frequência, ou escala. */
function tipoDaReserva(data, b, cli) {
  const k = bookingKindDe(data, b)?.key;
  if (k) return k;
  if (b.paymentMethod === "Aula Avulsa" || cli?.plan !== "mensalista") return "avulsa";
  if (cli.mensalistaTipo === "escala") return "escala";
  const f = Number(cli.weeklyFreq) || 1;
  return f >= 3 ? "fixo34" : f === 2 ? "fixo2" : "fixo1";
}

// 8 → "8"; 7.25 → "7,3" (médias da grade típica)
const fmtN = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1).replace(".", ","));

function somar(lista) {
  const r = { turmas: lista.length, cap: 0, ocup: 0, vagas: 0, espera: 0, tipos: {} };
  for (const t of lista) {
    r.cap += t.cap; r.ocup += Math.min(t.ocup, t.cap); r.vagas += t.vagas; r.espera += t.espera;
    for (const a of t.alunas) r.tipos[a.tipo] = (r.tipos[a.tipo] || 0) + 1;
  }
  return r;
}
// turma da grade = mesma unidade, dia da semana e hora
function agrupar(lista) {
  const m = new Map();
  for (const t of lista) {
    const k = `${t.s.unit}|${t.dow}|${t.hora}`;
    if (!m.has(k)) m.set(k, { key: k, unit: t.s.unit, dow: t.dow, hora: t.hora, prof: t.s.prof, itens: [] });
    m.get(k).itens.push(t);
  }
  return [...m.values()].sort((a, b) => a.unit.localeCompare(b.unit) || a.dow - b.dow || a.hora.localeCompare(b.hora));
}
// soma direta, ou — na grade típica — soma das médias de cada turma
function resumir(lista, media) {
  if (!media) return somar(lista);
  const r = { turmas: 0, cap: 0, ocup: 0, vagas: 0, espera: 0, tipos: {} };
  for (const g of agrupar(lista)) {
    const s = somar(g.itens), n = g.itens.length;
    r.turmas += 1; r.cap += s.cap / n; r.ocup += s.ocup / n; r.vagas += s.vagas / n; r.espera += s.espera / n;
    for (const [k, v] of Object.entries(s.tipos)) r.tipos[k] = (r.tipos[k] || 0) + v / n;
  }
  return r;
}

function TiposChips({ tipos }) {
  const itens = TIPOS_ALUNA.filter((t) => tipos[t.k] > 0.04);
  if (!itens.length) return <span className="cli-sub">—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: ".25rem" }}>
      {itens.map((t) => (
        <span key={t.k} className="chip" style={{ background: "#fff", borderColor: t.cor, color: t.cor }}>{fmtN(tipos[t.k])} {t.l}</span>
      ))}
    </div>
  );
}
const Bolinha = ({ cor }) => <span style={{ background: cor, width: 10, height: 10, borderRadius: "50%", display: "inline-block", flex: "none" }} />;

// Situação da turma — a mesma régua no mapa e no selo da tabela
const SITUACOES = {
  pouca: { badge: "b-info", l: "pouca gente", dica: "menos da metade" },
  vaga: { badge: "b-ok", l: "com vaga" },
  quase: { badge: "b-warn", l: "quase cheia", dica: "85% ou mais" },
  lotada: { badge: "b-terra", l: "lotada" },
};
function estadoTurma(r) {
  const p = pct(r.ocup, r.cap);
  return p >= 100 ? "lotada" : p >= 85 ? "quase" : p < 50 ? "pouca" : "vaga";
}
function situacaoTurma(r) {
  const s = SITUACOES[estadoTurma(r)];
  return <span className={`badge ${s.badge}`}>{s.l}</span>;
}

// Vagas ocupadas contra a capacidade, numa barrinha
function Medidor({ valor, total, cor }) {
  return (
    <div className="vg-medidor">
      <div style={{ width: `${Math.min(100, pct(valor, total))}%`, background: cor }} />
    </div>
  );
}

/* Mapa da grade de uma unidade: dia da semana × horário. Cada quadrinho é
   uma turma, com as vagas livres em destaque e a cor da situação. No mês e
   na grade típica o quadrinho é a média das aulas daquela turma. */
function MapaDeVagas({ grupos, colunas, onAbrir }) {
  const horas = [...new Set(grupos.map((g) => g.hora))].sort();
  const v = fmtN;
  return (
    <div className="vg-mapa-wrap">
      <div className="vg-mapa" style={{ gridTemplateColumns: `48px repeat(${colunas.length}, minmax(68px, 150px))` }}>
        <div />
        {colunas.map((c) => (
          <div key={c.dow} className="hd">{c.rotulo}<small>{v(c.livres)} livre(s)</small></div>
        ))}
        {horas.map((h) => (
          <Fragment key={h}>
            <div className="hr">{h}</div>
            {colunas.map((c) => {
              const g = grupos.find((x) => x.dow === c.dow && x.hora === h);
              if (!g) return <div key={c.dow} className="vg-cel vazia" />;
              const st = estadoTurma(g.r), n = g.itens.length;
              const dica = [
                `${WEEKDAYS_PT[g.dow]} ${g.hora}${g.prof ? ` · ${g.prof}` : ""}`,
                `${v(g.r.ocup)} de ${v(g.r.cap)} vagas ocupadas · ${v(g.r.vagas)} livre(s)`,
                n > 1 ? `média de ${n} aulas` : fmtDate(g.itens[0].s.date),
                g.r.espera > 0.04 ? `${v(g.r.espera)} na lista de espera` : "",
                n === 1 ? "Clique para ver as alunas" : "",
              ].filter(Boolean).join("\n");
              return (
                <div key={c.dow} className={`vg-cel st-${st}${n === 1 ? " click" : ""}`} title={dica}
                  onClick={n === 1 ? () => onAbrir(g.itens[0].s.id) : undefined}>
                  {st === "lotada"
                    ? <><b>lotada</b><span>{g.r.espera > 0.04 ? `${v(g.r.espera)} na espera` : `${v(g.r.cap)} vagas`}</span></>
                    : <><b>{v(g.r.vagas)}</b><span>de {v(g.r.cap)} livres</span></>}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// A barra inteira é a capacidade: cada pedaço colorido é um tipo de aluna, o resto é vaga livre
function BarraOcupacao({ r }) {
  const base = Math.max(r.cap, Object.values(r.tipos).reduce((s, x) => s + x, 0)) || 1;
  return (
    <div className="vg-barra">
      {GRUPOS_ALUNA.map((g) => {
        const n = somaGrupo(r.tipos, g);
        if (n < 0.05) return null;
        return <div key={g.k} style={{ width: `${(n / base) * 100}%`, background: g.cor }}
          title={`${g.l}: ${fmtN(n)} vaga(s) · ${pct(n, r.cap)}% da capacidade`} />;
      })}
    </div>
  );
}

export function RelatorioVagas() {
  const { data } = useStore();
  const { open } = useModal();
  const [tipo, setTipo] = useState("semana");
  const [refDia, setRefDia] = useState(todayISO());
  const [unit, setUnit] = useState("Todas");
  const [soComVaga, setSoComVaga] = useState(false);
  const [aba, setAba] = useState("turmas");
  const [de, ate] = intervalo(tipo, refDia);
  const media = tipo === "tipica";
  const abaAtual = media ? "turmas" : aba; // na grade típica não há aula de uma data

  // ficha da aluna da reserva: pelo nome, ou pelos 8 últimos dígitos do telefone
  const cliDe = useMemo(() => {
    const porNome = new Map(), porTel = new Map();
    for (const c of data.clients) {
      porNome.set(c.name, c);
      const t = (c.phone || "").replace(/\D/g, "").slice(-8);
      if (t.length === 8 && !porTel.has(t)) porTel.set(t, c);
    }
    return (b) => porNome.get(b.clientName) || porTel.get((b.phone || "").replace(/\D/g, "").slice(-8)) || null;
  }, [data.clients]);

  // Uma linha por horário (aula de uma data), com quem ocupa cada vaga
  const montar = (de0, ate0) => {
    const porSlot = new Map();
    for (const b of data.bookings) {
      if (b.status === "cancelada" || b.date < de0 || b.date > ate0) continue;
      if (!porSlot.has(b.slotId)) porSlot.set(b.slotId, []);
      porSlot.get(b.slotId).push(b);
    }
    return data.slots
      .filter((s) => s.date >= de0 && s.date <= ate0)
      .map((s) => {
        const alunas = (porSlot.get(s.id) || [])
          .map((b) => ({ b, tipo: tipoDaReserva(data, b, cliDe(b)) }))
          .sort((a, b) => a.b.clientName.localeCompare(b.b.clientName));
        const cap = slotCapacity(s);
        return { s, dow: dowMon(s.date), hora: hhmm(s.time), alunas, cap, ocup: alunas.length, vagas: Math.max(0, cap - alunas.length), espera: slotWaitlist(s).length };
      })
      .sort((a, b) => (a.s.date + a.hora).localeCompare(b.s.date + b.hora) || a.s.unit.localeCompare(b.s.unit));
  };
  const turmas = useMemo(() => montar(de, ate), [data, de, ate, cliDe]);
  // Para "quantas alunas ainda cabem": sempre a grade típica das próximas 4 semanas
  const hoje = todayISO();
  const [tipDe, tipAte] = intervalo("tipica", hoje);
  const tipicas = useMemo(() => (media && de === tipDe ? turmas : montar(tipDe, tipAte)), [data, turmas, media, de, tipDe, tipAte, cliDe]);

  const unidades = unidadesDe(data.meta, turmas.map((t) => t.s.unit));
  const daUnidade = (lista, u) => lista.filter((t) => t.s.unit === u);
  const total = resumir(turmas, media);
  const v = fmtN;

  /* Os cartões do topo trocam a unidade; tudo abaixo deles segue a escolha.
     Com "Todas", cada unidade aparece separada e o total vem por último. */
  const comTurmas = unidades.filter((u) => daUnidade(turmas, u).length);
  const visiveis = unit === "Todas" ? comTurmas : comTurmas.filter((u) => u === unit);
  const comTotal = unit === "Todas" && comTurmas.length > 1;
  const blocos = [
    ...visiveis.map((u) => ({ u, cor: unitColor(u), lista: daUnidade(turmas, u), tip: daUnidade(tipicas, u) })),
    ...(comTotal ? [{ u: "Total", cor: "var(--terracota)", lista: turmas, tip: tipicas }] : []),
  ];

  // planos ativos hoje: quantas vagas por semana eles já comprometem
  const planos = (u) => {
    const r = { fixo1: 0, fixo2: 0, fixo34: 0, escala: 0, alunas: 0, vagas: 0 };
    for (const c of data.clients) {
      if (c.plan !== "mensalista" || c.status === "cancelado" || c.status === "lead") continue;
      if (u && (c.unit || "Sem unidade") !== u) continue;
      const f = Number(c.weeklyFreq) || 1;
      r[c.mensalistaTipo === "escala" ? "escala" : f >= 3 ? "fixo34" : f === 2 ? "fixo2" : "fixo1"]++;
      r.alunas++; r.vagas += f;
    }
    return r;
  };
  const alunasDiferentes = (lista) => new Set(lista.flatMap((t) => t.alunas.map((a) => a.b.clientName))).size;
  /* Ao lado de "quantas têm aula no período", o número da aba Alunos: sem ele
     a Inêz compara 163 com 182 e acha que sumiu gente — quem avisou falta ou é
     de escala e não marcou simplesmente não tem aula naquela semana. */
  const matriculadas = useMemo(() => {
    const porUnidade = new Map();
    let total = 0;
    for (const c of data.clients) {
      if (classifyClient(data, c) !== "cliente") continue;
      total++;
      porUnidade.set(c.unit, (porUnidade.get(c.unit) || 0) + 1);
    }
    return (u) => (u === "Total" ? total : porUnidade.get(u) || 0);
  }, [data]);
  const noPeriodo = { dia: "no dia", semana: "na semana", mes: "no mês", tipica: "nas 4 semanas" }[tipo];

  // ----- a conta da Inêz, por unidade: dias × turmas × vagas -----
  const linhasDaUnidade = (u) => {
    const doUnit = daUnidade(turmas, u);
    return [...new Set(doUnit.map((t) => t.dow))].sort((a, b) => a - b).map((dow) => {
      const itens = doUnit.filter((t) => t.dow === dow);
      const grupos = agrupar(itens);
      const caps = grupos.map((g) => Math.round(somar(g.itens).cap / g.itens.length));
      const datas = [...new Set(itens.map((t) => t.s.date))].sort();
      return { dow, grupos, caps, datas, uniforme: caps.every((c) => c === caps[0]) };
    });
  };
  const formula = (linhas, r) => {
    if (!linhas.length) return "";
    if (tipo === "mes") return `${r.turmas} aulas no mês · ${v(r.cap)} vagas`;
    if (tipo === "dia") return `${r.turmas} turma(s) · ${v(r.cap)} vagas no dia`;
    const t = linhas[0].grupos.length, c = linhas[0].caps[0];
    const igual = linhas.every((l) => l.uniforme && l.grupos.length === t && l.caps[0] === c);
    const porSemana = media ? " por semana (média)" : " na semana";
    return igual
      ? `${t} turmas por dia × ${c} vagas = ${t * c} por dia · × ${linhas.length} dias = ${v(r.cap)} vagas${porSemana}`
      : `${linhas.length} dias · ${r.turmas} turmas · ${v(r.cap)} vagas${porSemana}`;
  };

  // ----- mapa: as turmas da unidade (média de cada uma) e uma coluna por dia -----
  const mapaDa = (u) => {
    const grupos = agrupar(daUnidade(turmas, u)).map((g) => ({ ...g, r: resumir(g.itens, true) }));
    const linhas = linhasDaUnidade(u);
    const colunas = linhas.map((l) => ({
      dow: l.dow,
      rotulo: tipo === "dia" || tipo === "semana" ? `${WEEKDAYS_SHORT[l.dow]} ${fmtDate(l.datas[0])}` : WEEKDAYS_SHORT[l.dow],
      livres: grupos.filter((g) => g.dow === l.dow).reduce((s, g) => s + g.r.vagas, 0),
    }));
    return { grupos, colunas, conta: formula(linhas, resumir(daUnidade(turmas, u), media)) };
  };

  // ----- detalhes: turmas da grade e aulas do período -----
  const grade = agrupar(turmas)
    .filter((g) => unit === "Todas" || g.unit === unit)
    .map((g) => ({ ...g, r: resumir(g.itens, true) }))
    .filter((g) => !soComVaga || g.r.vagas > 0.04);
  const lista = turmas
    .filter((t) => unit === "Todas" || t.s.unit === unit)
    .filter((t) => !soComVaga || t.vagas > 0);
  const diasLista = [...new Set(lista.map((t) => t.s.date))];

  const exportar = () => abaAtual === "turmas"
    ? exportCsv(`grade-${de}-a-${ate}`,
      ["Unidade", "Dia", "Hora", "Professora", "Vagas", "Ocupadas (média)", "Livres (média)", "% ocupação", ...TIPOS_ALUNA.map((t) => t.l)],
      grade.map((g) => [g.unit, WEEKDAYS_PT[g.dow], g.hora, g.prof || "", v(g.r.cap), v(g.r.ocup), v(g.r.vagas), pct(g.r.ocup, g.r.cap),
        ...TIPOS_ALUNA.map((t) => v(g.r.tipos[t.k] || 0))]))
    : exportCsv(`vagas-${de}-a-${ate}`,
      ["Data", "Dia", "Hora", "Unidade", "Professora", "Capacidade", "Alunas", "Vagas livres", "Lista de espera", ...TIPOS_ALUNA.map((t) => t.l), "Nomes"],
      lista.map((t) => {
        const tp = somar([t]).tipos;
        return [t.s.date, WEEKDAYS_PT[t.dow], t.hora, t.s.unit, t.s.prof || "", t.cap, t.ocup, t.vagas, t.espera,
          ...TIPOS_ALUNA.map((x) => tp[x.k] || 0), t.alunas.map((a) => `${a.b.clientName} (${TIPO_ALUNA[a.tipo].l})`).join(", ")];
      }));

  // legenda das barras: os números do conjunto que está na tela
  const rLegenda = resumir(unit === "Todas" ? turmas : daUnidade(turmas, unit), media);
  const mensalistasNoTotal = (p) => [`${p.fixo1} fixo 1x`, `${p.fixo2} fixo 2x`, `${p.fixo34} fixo 3x/4x`, `${p.escala} escala`].join(" · ");

  return (
    <>
      <div className="panel">
        <Periodo tipos={PERIODOS_VAGAS} tipo={tipo} setTipo={setTipo} refDia={refDia} setRefDia={setRefDia} />
        {media && <div className="seg-hint">📐 Grade típica: a média de cada turma nas 4 semanas — uma semana “normal” da escola, sem o efeito de feriado.</div>}

        <div className="grid stats">
          {unidades.map((u) => {
            const r = resumir(daUnidade(turmas, u), media);
            return (
              <div key={u} className="card stat click" onClick={() => setUnit(unit === u ? "Todas" : u)}
                style={unit === u ? { outline: `2px solid ${unitColor(u)}` } : undefined} title="Clique para ver só esta unidade">
                <div className="lbl"><Bolinha cor={unitColor(u)} /> {u}</div>
                <div className="val">{v(r.vagas)}</div>
                <div className="foot">vaga(s) livre(s) de {v(r.cap)} · {pct(r.ocup, r.cap)}% ocupada</div>
                <Medidor valor={r.ocup} total={r.cap} cor={unitColor(u)} />
              </div>
            );
          })}
          <div className="card stat click" onClick={() => setUnit("Todas")}
            style={unit === "Todas" && unidades.length > 1 ? { outline: "2px solid var(--terracota)" } : undefined} title="Clique para ver todas as unidades">
            <div className="lbl">🪑 Total</div>
            <div className="val terra">{v(total.vagas)}</div>
            <div className="foot">vaga(s) livre(s) de {v(total.cap)} · {pct(total.ocup, total.cap)}% ocupada</div>
            <Medidor valor={total.ocup} total={total.cap} cor="var(--terracota)" />
          </div>
        </div>
        {!turmas.length && <div className="empty" style={{ marginTop: "1rem" }}><div className="ic">📅</div><p>Nenhuma turma cadastrada neste período.</p></div>}
      </div>

      {/* 1. Mapa de vagas: onde tem lugar */}
      {blocos.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>🗺️ Onde tem vaga <span className="muted-note">· {media || tipo === "mes" ? "média de cada turma" : "vagas livres em cada turma"}</span></h2>
          </div>
          <div className="ag-legend" style={{ marginBottom: "1.1rem" }}>
            {Object.entries(SITUACOES).map(([k, s]) => (
              <span key={k} className="lg"><span className={`badge ${s.badge}`}>{s.l}</span>{s.dica && <span>{s.dica}</span>}</span>
            ))}
            {!media && tipo !== "mes" && <><span className="lg-sep" /><span className="lg">👆 clique numa turma para ver as alunas</span></>}
          </div>
          {visiveis.map((u) => {
            const m = mapaDa(u);
            return (
              <div key={u} className="vg-unit">
                <div className="vg-unit-h">
                  <Bolinha cor={unitColor(u)} /><b style={{ color: unitColor(u) }}>{u}</b>
                  <span className="cli-sub">{m.conta}</span>
                </div>
                <MapaDeVagas grupos={m.grupos} colunas={m.colunas} onAbrir={(id) => open(<SlotDetail slotId={id} />)} />
              </div>
            );
          })}
        </div>
      )}

      {/* 2. Quem ocupa as vagas */}
      {blocos.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>🧩 Quem ocupa as vagas <span className="muted-note">· {media ? "por semana (média)" : "no período"}</span></h2>
          </div>
          <div className="vg-barras">
            {blocos.map((b) => {
              const r = resumir(b.lista, media);
              return (
                <div key={b.u} className="vg-barra-l">
                  <div className="vg-barra-nome">
                    {b.u === "Total" ? "🪑" : <Bolinha cor={b.cor} />}
                    <span style={{ color: b.u === "Total" ? "var(--ink)" : b.cor }}>{b.u}</span>
                  </div>
                  <BarraOcupacao r={r} />
                  <div className="vg-barra-num">
                    <div><b>{v(r.ocup)}</b> de {v(r.cap)} ocupadas</div>
                    <div><b style={{ color: "var(--green-deep)" }}>{v(r.vagas)}</b> livres</div>
                    <div title={"Aluna não é vaga: a do plano 2x ocupa duas por semana.\nMatriculadas = aba Alunos. Quem avisou falta, é de escala e não marcou, ou ainda não tem horário fica sem aula no período — mas continua matriculada. 1ª aula e avulsa têm aula, mas não estão na aba Alunos."}>
                      <b>{alunasDiferentes(b.lista)}</b> com aula {noPeriodo} · <b>{matriculadas(b.u)}</b> matriculada(s)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="vg-legenda">
            {GRUPOS_ALUNA.map((g) => {
              const n = somaGrupo(rLegenda.tipos, g);
              if (n < 0.05) return null;
              const detalhe = g.tipos.length > 1
                ? g.tipos.map((k) => `${TIPO_ALUNA[k].l}: ${v(rLegenda.tipos[k] || 0)}`).join(" · ") : undefined;
              return (
                <span key={g.k} className="lg" title={detalhe}>
                  <Bolinha cor={g.cor} />{g.l} <b>{v(n)}</b> <span>({pct(n, rLegenda.ocup)}%)</span>
                </span>
              );
            })}
            <span className="lg"><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--cream)", border: "1px solid var(--line)", display: "inline-block" }} />Livre <b>{v(rLegenda.vagas)}</b></span>
          </div>
        </div>
      )}

      {/* 3. Cabe mais gente? — sempre a grade típica das próximas 4 semanas */}
      {blocos.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>🌱 Cabe mais gente? <span className="muted-note">· semana típica das próximas 4 semanas</span></h2>
          </div>
          {tipicas.length ? (
            <div className="grid stats">
              {blocos.map((b) => {
                const r = resumir(b.tip, true);
                const livres = Math.floor(r.vagas + 0.05);
                const p = planos(b.u === "Total" ? null : b.u);
                return (
                  <div key={b.u} className="card stat">
                    <div className="lbl">{b.u === "Total" ? "🪑" : <Bolinha cor={b.cor} />} {b.u}</div>
                    <div className="val">{livres}</div>
                    <div className="foot">aluna(s) nova(s) no 1x · ou {Math.floor(livres / 2)} no 2x</div>
                    <div title={`${v(r.ocup)} de ${v(r.cap)} vagas da semana ocupadas`}><Medidor valor={r.ocup} total={r.cap} cor={b.cor} /></div>
                    <div className="cli-sub" style={{ marginTop: ".45rem" }}>semana {pct(r.ocup, r.cap)}% ocupada</div>
                    <div className="cli-sub" style={{ marginTop: ".2rem" }} title={`${mensalistasNoTotal(p)}\nOs planos usam ${p.vagas} vaga(s) por semana (2x = 2 vagas).`}>
                      {p.alunas} mensalista(s) ativa(s)
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="seg-hint" style={{ margin: 0 }}>Sem turmas cadastradas nas próximas 4 semanas para calcular o que ainda cabe.</div>
          )}
          {tipicas.length > 0 && <div className="cli-sub" style={{ marginTop: ".9rem" }}>Aproximado: a aluna do 2x precisa de vaga em dois horários da semana.</div>}
        </div>
      )}

      {/* 4. Detalhes: as tabelas, para quem quer o número de cada turma */}
      {turmas.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <div className="seg seg-tabs">
              <button className={abaAtual === "turmas" ? "on" : ""} onClick={() => setAba("turmas")}>
                🧶 Turmas da grade <span className="seg-count">{grade.length}</span>
              </button>
              {!media && (
                <button className={abaAtual === "aulas" ? "on" : ""} onClick={() => setAba("aulas")}>
                  📋 Aulas e alunas <span className="seg-count">{lista.length}</span>
                </button>
              )}
            </div>
            <button className="btn sec sm" disabled={abaAtual === "turmas" ? !grade.length : !lista.length} onClick={exportar}>⬇ Exportar CSV</button>
          </div>
          <div className="ag-filters">
            <FiltroUnidade unidades={unidades} unit={unit} setUnit={setUnit} />
            <div className="seg">
              <button className={!soComVaga ? "on" : ""} onClick={() => setSoComVaga(false)}>Todas as turmas</button>
              <button className={soComVaga ? "on" : ""} onClick={() => setSoComVaga(true)}>Só com vaga</button>
            </div>
          </div>

          {abaAtual === "turmas" && (grade.length ? (
            <table>
              <thead><tr><th>Turma</th><th>Unidade</th><th>Vagas</th><th>Ocupação</th><th>Livres</th><th>Tipos de aluna</th><th>Situação</th></tr></thead>
              <tbody>
                {grade.map((g) => {
                  const n = g.itens.length;
                  return (
                    <tr key={g.key} className={n === 1 ? "row-click" : undefined} onClick={n === 1 ? () => open(<SlotDetail slotId={g.itens[0].s.id} />) : undefined}>
                      <td className="c-main"><b>{WEEKDAYS_SHORT[g.dow]} {g.hora}</b>
                        <div className="cli-sub">{[g.prof, n > 1 ? `média de ${n} aulas` : fmtDate(g.itens[0].s.date)].filter(Boolean).join(" · ")}</div></td>
                      <td data-l="Unidade"><span className="chip" style={{ color: unitColor(g.unit) }}>{g.unit}</span></td>
                      <td data-l="Vagas">{v(g.r.cap)}</td>
                      <td data-l="Ocupação">
                        {v(g.r.ocup)}/{v(g.r.cap)} <span className="cli-sub">({pct(g.r.ocup, g.r.cap)}%)</span>
                        <div style={{ maxWidth: 120 }}><Medidor valor={g.r.ocup} total={g.r.cap} cor={g.r.ocup >= g.r.cap ? "var(--terracota)" : "var(--sage-deep)"} /></div>
                      </td>
                      <td data-l="Livres"><b>{v(g.r.vagas)}</b>{g.r.espera > 0.04 ? <div className="cli-sub">{v(g.r.espera)} na espera</div> : null}</td>
                      <td data-l="Tipos de aluna"><TiposChips tipos={g.r.tipos} /></td>
                      <td data-l="Situação">{situacaoTurma(g.r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty"><div className="ic">🪑</div><p>Nenhuma turma para este filtro.</p></div>
          ))}

          {abaAtual === "aulas" && (
            <>
              <div className="ag-legend" style={{ marginBottom: ".8rem" }}>
                {TIPOS_ALUNA.map((t) => <span key={t.k} className="lg"><span className="lgdot" style={{ background: t.cor }} />{t.l}</span>)}
              </div>
              {lista.length ? (
                <table>
                  <thead><tr><th>Turma</th><th>Unidade</th><th>Ocupação</th><th>Vagas</th><th>Alunas</th></tr></thead>
                  <tbody>
                    {diasLista.map((d) => {
                      const doDia = lista.filter((t) => t.s.date === d);
                      const r = somar(doDia);
                      return (
                        <Fragment key={d}>
                          <tr className="grp">
                            <td colSpan={5} style={{ background: "var(--cream)", fontWeight: 800, color: "var(--green-deep)" }}>
                              📅 {capitalize(fmtDateLong(d))}
                              <span className="cli-sub" style={{ fontWeight: 600, marginLeft: ".5rem" }}>
                                {r.turmas} turma(s) · {r.ocup}/{r.cap} ocupadas · {r.vagas} vaga(s)
                              </span>
                            </td>
                          </tr>
                          {doDia.map((t) => (
                            <tr key={t.s.id} className="row-click" onClick={() => open(<SlotDetail slotId={t.s.id} />)}>
                              <td className="c-main"><b>{t.hora}</b>{t.s.prof ? <div className="cli-sub">{t.s.prof}</div> : null}</td>
                              <td data-l="Unidade"><span className="chip" style={{ color: unitColor(t.s.unit) }}>{t.s.unit}</span></td>
                              <td data-l="Ocupação">{t.ocup}/{t.cap}</td>
                              <td data-l="Vagas">
                                {t.vagas
                                  ? <span className="badge b-ok">{t.vagas} vaga(s)</span>
                                  : <span className="badge b-terra">lotada{t.ocup > t.cap ? ` (+${t.ocup - t.cap})` : ""}</span>}
                                {t.espera ? <div className="cli-sub">{t.espera} na lista de espera</div> : null}
                              </td>
                              <td data-l="Alunas" style={{ fontSize: ".85rem" }}>
                                {t.alunas.length ? (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: ".2rem .7rem" }}>
                                    {t.alunas.map((a) => (
                                      <span key={a.b.id} title={TIPO_ALUNA[a.tipo].l} style={{ display: "inline-flex", alignItems: "center", gap: ".3rem" }}>
                                        <Bolinha cor={TIPO_ALUNA[a.tipo].cor} />{a.b.clientName}
                                      </span>
                                    ))}
                                  </div>
                                ) : <span className="cli-sub">nenhuma aluna</span>}
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="empty"><div className="ic">🪑</div><p>Nenhuma turma para este filtro.</p></div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/* ============================= PRESENTES =============================
   Apuração das aulas de presente que a ADMIN dá na ficha (AulaPresente).

   PRESENTE NÃO É DINHEIRO (Vitor, 08/10/2026): não entra em Vendas, nem no
   Financeiro, nem em valor a receber. Este relatório só conta o que foi dado
   e o que aconteceu com cada presente. O "equivale a" é referência, para a
   Inêz ter noção do tamanho do que deu — não é receita.

   O período é o dia em que o presente foi DADO. Sai do estado do painel
   (presentes + marcações), sem chamada extra. */
const PERIODOS_PRESENTE = [["semana", "📆 Semana"], ["mes", "🗓 Mês"], ["ano", "📅 Ano"]];

// O que aconteceu com o presente, já olhando a aula que ele virou
const DESTINOS_PRESENTE = [
  { k: "feita", l: "Virou aula", cor: "var(--ok)", badge: "b-ok", ic: "✅" },
  { k: "marcada", l: "Aula marcada", cor: "var(--info)", badge: "b-info", ic: "📅" },
  { k: "aguardando", l: "Aguardando a aluna", cor: "var(--warn)", badge: "b-warn", ic: "⏳" },
  { k: "faltou", l: "Faltou / desistiu", cor: "var(--danger)", badge: "b-danger", ic: "🙅" },
  { k: "vencido", l: "Venceu sem uso", cor: "var(--muted)", badge: "b-muted", ic: "⌛" },
  { k: "recolhido", l: "Recolhido", cor: "var(--beige)", badge: "b-muted", ic: "↩️" },
];
const DESTINO_PRESENTE = Object.fromEntries(DESTINOS_PRESENTE.map((d) => [d.k, d]));

function destinoDoPresente(p, aula, hoje) {
  if (p.situacao === "cancelado") return "recolhido";
  if (p.situacao === "vencido") return "vencido";
  if (p.situacao === "disponivel") return "aguardando";
  // usado: depende da aula que ele virou
  if (!aula || aula.status === "cancelada" || aula.attendance === "falta") return "faltou";
  return aula.date > hoje ? "marcada" : "feita";
}

// Barra empilhada: cada pedaço é um destino dos presentes
function BarraPresentes({ c, total }) {
  return (
    <div className="vg-barra">
      {DESTINOS_PRESENTE.map((d) => (c[d.k] ? (
        <div key={d.k} style={{ width: `${(c[d.k] / (total || 1)) * 100}%`, background: d.cor }} title={`${d.l}: ${c[d.k]}`} />
      ) : null))}
    </div>
  );
}

export function RelatorioPresentes() {
  const { data } = useStore();
  const { open } = useModal();
  const [tipo, setTipo] = useState("mes");
  const [refDia, setRefDia] = useState(todayISO());
  const [unit, setUnit] = useState("Todas");
  const [busca, setBusca] = useState("");
  const [de, ate] = intervalo(tipo, refDia);
  const hoje = todayISO();
  const valorAvulsa = Number(data.meta?.valorAvulsa) || 40;

  const itens = useMemo(() => {
    const cli = new Map(data.clients.map((c) => [c.id, c]));
    const aulas = new Map(data.bookings.map((b) => [b.id, b]));
    return (data.presentes || [])
      .map((p) => {
        const dadoEm = String(p.createdAt || "").slice(0, 10);
        const c = cli.get(p.clientId) || null;
        const aula = p.usedBookingId ? aulas.get(p.usedBookingId) || null : null;
        return {
          p, c, aula, dadoEm,
          aluna: c?.name || `aluna #${p.clientId}`,
          unidade: aula?.unit || c?.unit || "Sem unidade",
          destino: destinoDoPresente(p, aula, hoje),
        };
      })
      .filter((x) => x.dadoEm >= de && x.dadoEm <= ate)
      .sort((a, b) => b.dadoEm.localeCompare(a.dadoEm) || a.aluna.localeCompare(b.aluna));
  }, [data, de, ate, hoje]);

  const unidades = unidadesDe(data.meta, itens.map((x) => x.unidade));
  const doFiltro = itens.filter((x) => unit === "Todas" || x.unidade === unit);
  const conta = (l) => Object.fromEntries(DESTINOS_PRESENTE.map((d) => [d.k, l.filter((x) => x.destino === d.k).length]));
  const alunas = (l) => new Set(l.map((x) => x.p.clientId)).size;
  const tot = conta(doFiltro);
  const viraramAula = tot.feita + tot.marcada;

  // quem deu
  const porQuem = [...new Set(doFiltro.map((x) => x.p.dadoPor || "—"))]
    .map((q) => {
      const l = doFiltro.filter((x) => (x.p.dadoPor || "—") === q);
      return { q, n: l.length, alunas: alunas(l), feitas: conta(l).feita };
    })
    .sort((a, b) => b.n - a.n);

  // barras: cada unidade com presente, e o total por último
  const comPresente = unidades.filter((u) => itens.some((x) => x.unidade === u));
  const barras = [...comPresente, ...(comPresente.length > 1 ? ["Total"] : [])];

  const lista = doFiltro.filter((x) => contemBusca([x.aluna, x.unidade, x.p.motivo, x.p.dadoPor, DESTINO_PRESENTE[x.destino].l], busca));

  const exportar = () => exportCsv(`presentes-${de}-a-${ate}`,
    ["Dado em", "Aluna", "Unidade", "Dado por", "Motivo", "Vale até", "Situação", "Aula", "Presença"],
    lista.map((x) => [x.dadoEm, x.aluna, x.unidade, x.p.dadoPor || "", x.p.motivo || "", x.p.expiresOn,
      DESTINO_PRESENTE[x.destino].l, x.aula ? `${x.aula.date} ${hhmm(x.aula.time)}` : "",
      x.aula ? (x.aula.status === "cancelada" ? "cancelada" : x.aula.attendance || "") : ""]));

  return (
    <>
      <div className="panel">
        <Periodo tipos={PERIODOS_PRESENTE} tipo={tipo} setTipo={setTipo} refDia={refDia} setRefDia={setRefDia} />
        <div className="seg-hint">
          🎁 Presente não é dinheiro: não entra em Vendas, no Financeiro nem em valor a receber. Aqui é só a apuração do que foi dado no período.
        </div>
        <div className="grid stats">
          <div className="card stat">
            <div className="lbl">🎁 Aulas dadas</div>
            <div className="val terra">{doFiltro.length}</div>
            <div className="foot">para {alunas(doFiltro)} aluna(s)</div>
            {doFiltro.length > 0 && (
              <div className="cli-sub" title="Só referência: quanto essas aulas custariam como aula avulsa. Não é receita nem valor a receber.">
                equivale a {money(doFiltro.length * valorAvulsa)} em avulsas · só referência
              </div>
            )}
          </div>
          <div className="card stat">
            <div className="lbl">✅ Viraram aula</div>
            <div className="val">{viraramAula}</div>
            <div className="foot">{tot.feita} feita(s) · {tot.marcada} marcada(s) · {pct(viraramAula, doFiltro.length)}% do dado</div>
          </div>
          <div className="card stat">
            <div className="lbl">⏳ Aguardando a aluna</div>
            <div className="val warn">{tot.aguardando}</div>
            <div className="foot">ainda no prazo para marcar</div>
          </div>
          <div className="card stat">
            <div className="lbl">⌛ Não aproveitadas</div>
            <div className="val">{tot.vencido + tot.faltou + tot.recolhido}</div>
            <div className="foot">{tot.vencido} venceu · {tot.faltou} faltou/desistiu · {tot.recolhido} recolhida(s)</div>
          </div>
        </div>
        {!itens.length && <div className="empty" style={{ marginTop: "1rem" }}><div className="ic">🎁</div><p>Nenhuma aula de presente dada neste período.</p></div>}
      </div>

      {/* 1. O que aconteceu com os presentes, por unidade */}
      {itens.length > 0 && (
        <div className="panel">
          <div className="panel-h"><h2>🧩 O que aconteceu com os presentes <span className="muted-note">· por unidade</span></h2></div>
          <div className="vg-barras">
            {barras.map((u) => {
              const l = u === "Total" ? itens : itens.filter((x) => x.unidade === u);
              const c = conta(l);
              return (
                <div key={u} className="vg-barra-l row-click" onClick={() => setUnit(u === "Total" || unit === u ? "Todas" : u)}
                  title={u === "Total" ? "Clique para ver todas as unidades" : "Clique para ver só esta unidade"}>
                  <div className="vg-barra-nome">
                    {u === "Total" ? "🎁" : <Bolinha cor={unitColor(u)} />}
                    <span style={{ color: u === "Total" ? "var(--ink)" : unitColor(u) }}>{u}</span>
                  </div>
                  <BarraPresentes c={c} total={l.length} />
                  <div className="vg-barra-num">
                    <div><b>{l.length}</b> dada(s) · <b>{alunas(l)}</b> aluna(s)</div>
                    <div><b style={{ color: "var(--ok)" }}>{c.feita + c.marcada}</b> viraram aula · <b>{c.aguardando}</b> aguardando</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="vg-legenda">
            {DESTINOS_PRESENTE.map((d) => (
              <span key={d.k} className="lg"><Bolinha cor={d.cor} />{d.l} <b>{tot[d.k]}</b></span>
            ))}
          </div>
        </div>
      )}

      {/* 2. Quem deu */}
      {porQuem.length > 0 && (
        <div className="panel">
          <div className="panel-h"><h2>👩‍💼 Quem deu <span className="muted-note">· {rotuloPeriodo(tipo, refDia)}</span></h2></div>
          <div className="grid stats">
            {porQuem.map((r) => (
              <div key={r.q} className="card stat">
                <div className="lbl">{r.q === "—" ? "Sem registro de quem deu" : r.q}</div>
                <div className="val">{r.n}</div>
                <div className="foot">aula(s) para {r.alunas} aluna(s) · {r.feitas} já feita(s)</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Detalhes: um presente por linha */}
      {itens.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>📋 Presentes <span className="muted-note">· {rotuloPeriodo(tipo, refDia)}</span></h2>
            <button className="btn sec sm" disabled={!lista.length} onClick={exportar}>⬇ Exportar CSV</button>
          </div>
          <div className="ag-filters">
            <FiltroUnidade unidades={unidades} unit={unit} setUnit={setUnit} />
          </div>
          <div className="filters" style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center", marginBottom: "1rem" }}>
            <input className="grow" placeholder="🔍 Buscar por aluna, motivo, quem deu ou situação..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            {busca && <button className="btn ghost sm" onClick={() => setBusca("")}>Limpar busca</button>}
            <span className="count">{lista.length} presente(s)</span>
          </div>
          {lista.length ? (
            <table>
              <thead><tr><th>Aluna</th><th>Dado em</th><th>Por</th><th>Motivo</th><th>Situação</th><th>Aula</th></tr></thead>
              <tbody>
                {lista.map((x) => {
                  const d = DESTINO_PRESENTE[x.destino];
                  return (
                    <tr key={x.p.id}>
                      <td className="cli-name c-main">
                        {x.c ? <span className="row-click" onClick={() => open(<ClientProfile client={x.c} />)}>{x.aluna}</span> : x.aluna}
                        <div className="cli-sub">{x.unidade}</div>
                      </td>
                      <td data-l="Dado em">{fmtDate(x.dadoEm)}<div className="cli-sub">vale até {fmtDate(x.p.expiresOn)}</div></td>
                      <td data-l="Por">{x.p.dadoPor || "—"}</td>
                      <td data-l="Motivo" className="cli-sub">{x.p.motivo || "—"}</td>
                      <td data-l="Situação"><span className={`badge ${d.badge}`}>{d.ic} {d.l}</span></td>
                      <td data-l="Aula">
                        {x.aula ? (
                          <>
                            {fmtDate(x.aula.date)} · {hhmm(x.aula.time)}
                            <div className="cli-sub">
                              {x.aula.status === "cancelada" ? "cancelada" : x.aula.attendance === "presente" ? "presente" : x.aula.attendance === "falta" ? "falta" : x.aula.unit}
                            </div>
                          </>
                        ) : <span className="cli-sub">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty"><div className="ic">🎁</div><p>Nenhum presente para este filtro.</p></div>
          )}
        </div>
      )}
    </>
  );
}
