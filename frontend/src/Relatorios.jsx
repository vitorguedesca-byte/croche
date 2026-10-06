import { useState, useEffect, useMemo, Fragment } from "react";
import { useStore } from "./store.jsx";
import { useModal } from "./ui.jsx";
import { api } from "./api.js";
import { ClientProfile, SlotDetail } from "./modals.jsx";
import { exportCsv } from "./exports.js";
import {
  todayISO, addDays, weekStart, fmtDate, fmtDateLong, money, capitalize, hhmm, unitColor,
  slotCapacity, slotWaitlist, contemBusca, bookingKindDe, dowMon, WEEKDAYS_PT, WEEKDAYS_SHORT,
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
  { k: "avulsa", l: "Avulsa", cor: "var(--terracota)" },
];
const TIPO_ALUNA = Object.fromEntries(TIPOS_ALUNA.map((t) => [t.k, t]));

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

function situacaoTurma(r) {
  const p = pct(r.ocup, r.cap);
  if (p >= 100) return <span className="badge b-terra">lotada</span>;
  if (p >= 85) return <span className="badge b-warn">quase cheia</span>;
  if (p < 50) return <span className="badge b-info">pouca gente</span>;
  return <span className="badge b-ok">com vaga</span>;
}

export function RelatorioVagas() {
  const { data } = useStore();
  const { open } = useModal();
  const [tipo, setTipo] = useState("semana");
  const [refDia, setRefDia] = useState(todayISO());
  const [unit, setUnit] = useState("Todas");
  const [soComVaga, setSoComVaga] = useState(false);
  const [de, ate] = intervalo(tipo, refDia);
  const media = tipo === "tipica";

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

  // ----- 1. capacidade: uma tabela por unidade, uma linha por dia da semana -----
  const linhasDaUnidade = (u) => {
    const doUnit = daUnidade(turmas, u);
    return [...new Set(doUnit.map((t) => t.dow))].sort((a, b) => a - b).map((dow) => {
      const itens = doUnit.filter((t) => t.dow === dow);
      const grupos = agrupar(itens);
      const caps = grupos.map((g) => Math.round(somar(g.itens).cap / g.itens.length));
      const datas = [...new Set(itens.map((t) => t.s.date))].sort();
      return { dow, itens, grupos, caps, datas, r: resumir(itens, media), uniforme: caps.every((c) => c === caps[0]) };
    });
  };
  const rotuloDia = (l) => (tipo === "dia" || tipo === "semana")
    ? `${WEEKDAYS_SHORT[l.dow]} ${fmtDate(l.datas[0])}`
    : WEEKDAYS_PT[l.dow];
  const textoTurmas = (l) => {
    const base = l.uniforme ? `${l.grupos.length} × ${l.caps[0]} vagas` : l.caps.join(" + ");
    return tipo === "mes" && l.datas.length > 1 ? `${base} · ${l.datas.length} semanas` : base;
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

  // ----- 3. turmas da grade (lista filtrável) -----
  const grade = agrupar(turmas)
    .filter((g) => unit === "Todas" || g.unit === unit)
    .map((g) => ({ ...g, r: resumir(g.itens, true) }))
    .filter((g) => !soComVaga || g.r.vagas > 0.04);

  // ----- aulas do período com as alunas (fora da grade típica) -----
  const lista = turmas
    .filter((t) => unit === "Todas" || t.s.unit === unit)
    .filter((t) => !soComVaga || t.vagas > 0);
  const diasLista = [...new Set(lista.map((t) => t.s.date))];

  const exportar = () => media
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

  return (
    <>
      <div className="panel">
        <Periodo tipos={PERIODOS_VAGAS} tipo={tipo} setTipo={setTipo} refDia={refDia} setRefDia={setRefDia} />
        {media && <div className="seg-hint">📐 Grade típica: a média de cada turma nas 4 semanas — uma semana “normal” da escola, sem o efeito de feriado.</div>}

        <div className="grid stats" style={{ marginBottom: "1rem" }}>
          {unidades.map((u) => {
            const r = resumir(daUnidade(turmas, u), media);
            return (
              <div key={u} className="card stat click" onClick={() => setUnit(unit === u ? "Todas" : u)}
                style={unit === u ? { outline: `2px solid ${unitColor(u)}` } : undefined} title="Clique para ver só as turmas desta unidade">
                <div className="lbl"><Bolinha cor={unitColor(u)} /> {u}</div>
                <div className="val">{v(r.vagas)}</div>
                <div className="foot">vaga(s) livre(s) · {v(r.ocup)}/{v(r.cap)} ocupadas ({pct(r.ocup, r.cap)}%)</div>
              </div>
            );
          })}
          <div className="card stat">
            <div className="lbl">🪑 Total</div>
            <div className="val terra">{v(total.vagas)}</div>
            <div className="foot">vaga(s) livre(s) · {v(total.ocup)}/{v(total.cap)} ocupadas ({pct(total.ocup, total.cap)}%)</div>
          </div>
        </div>
        {!turmas.length && <div className="empty"><div className="ic">📅</div><p>Nenhuma turma cadastrada neste período.</p></div>}
      </div>

      {/* 1. Capacidade */}
      {turmas.length > 0 && (
        <div className="panel">
          <div className="panel-h"><h2>📐 Capacidade <span className="muted-note">· dias × turmas × vagas</span></h2></div>
          {unidades.map((u) => {
            const linhas = linhasDaUnidade(u);
            if (!linhas.length) return null;
            const r = resumir(daUnidade(turmas, u), media);
            return (
              <div key={u} style={{ marginBottom: "1.4rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", marginBottom: ".4rem" }}>
                  <Bolinha cor={unitColor(u)} /><b style={{ color: unitColor(u) }}>{u}</b>
                  <span className="cli-sub">{formula(linhas, r)}</span>
                </div>
                <table>
                  <thead><tr><th>Dia</th><th>Turmas</th><th>Vagas</th><th>Ocupadas</th><th>Livres</th><th>Tipos de aluna</th></tr></thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.dow}>
                        <td className="c-main"><b>{rotuloDia(l)}</b></td>
                        <td data-l="Turmas">{textoTurmas(l)}<div className="cli-sub">{l.grupos.map((g) => g.hora).join(" · ")}</div></td>
                        <td data-l="Vagas"><b>{v(l.r.cap)}</b></td>
                        <td data-l="Ocupadas">{v(l.r.ocup)} <span className="cli-sub">({pct(l.r.ocup, l.r.cap)}%)</span></td>
                        <td data-l="Livres"><b style={{ color: l.r.vagas > 0.04 ? "var(--green-deep)" : "var(--muted)" }}>{v(l.r.vagas)}</b></td>
                        <td data-l="Tipos de aluna"><TiposChips tipos={l.r.tipos} /></td>
                      </tr>
                    ))}
                    <tr>
                      <td className="c-main"><b>{tipo === "mes" ? "Mês" : tipo === "dia" ? "Dia" : "Semana"}</b></td>
                      <td data-l="Turmas"><b>{r.turmas}</b> {tipo === "mes" ? "aulas" : "turma(s)"}</td>
                      <td data-l="Vagas"><b>{v(r.cap)}</b></td>
                      <td data-l="Ocupadas"><b>{v(r.ocup)}</b> <span className="cli-sub">({pct(r.ocup, r.cap)}%)</span></td>
                      <td data-l="Livres"><b style={{ color: "var(--green-deep)" }}>{v(r.vagas)}</b></td>
                      <td data-l="Tipos de aluna"><TiposChips tipos={r.tipos} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
          {unidades.length > 1 && (
            <div className="seg-hint" style={{ margin: 0 }}>
              <b>Total das unidades:</b> {total.turmas} turmas · {v(total.cap)} vagas · {v(total.ocup)} ocupadas ({pct(total.ocup, total.cap)}%) · {v(total.vagas)} livres
            </div>
          )}
        </div>
      )}

      {/* 2. Alunas × vagas */}
      {turmas.length > 0 && (() => {
        const cols = [...unidades.map((u) => ({ u, lista: daUnidade(turmas, u), tip: daUnidade(tipicas, u), p: planos(u) })),
          { u: "Total", lista: turmas, tip: tipicas, p: planos(null) }];
        const linha = (rotulo, fn, dica) => (
          <tr>
            <td className="c-main"><b>{rotulo}</b>{dica && <div className="cli-sub">{dica}</div>}</td>
            {cols.map((c) => <td key={c.u} data-l={c.u}>{fn(c)}</td>)}
          </tr>
        );
        return (
          <div className="panel">
            <div className="panel-h"><h2>👩 Alunas × vagas</h2></div>
            <table>
              <thead><tr><th></th>{cols.map((c) => <th key={c.u}>{c.u}</th>)}</tr></thead>
              <tbody>
                {linha("Alunas diferentes", (c) => <b>{alunasDiferentes(c.lista)}</b>, "nas aulas do período")}
                {linha("Vagas ocupadas", (c) => v(resumir(c.lista, media).ocup), media ? "média por semana" : "no período")}
                {linha("Vagas por aluna", (c) => { const n = alunasDiferentes(c.lista); return n ? v(resumir(c.lista, media).ocup / n) : "—"; },
                  media ? "por semana" : "no período · plano 2x ocupa 2")}
                {linha("Mensalistas ativas hoje", (c) => (
                  <><b>{c.p.alunas}</b><div className="cli-sub">{c.p.fixo1} fixo 1x · {c.p.fixo2} fixo 2x · {c.p.fixo34} fixo 3x/4x · {c.p.escala} escala</div></>
                ), "pela ficha")}
                {linha("Vagas/semana dos planos", (c) => <b>{c.p.vagas}</b>, "soma das frequências (2x = 2 vagas)")}
                {linha("Capacidade/semana", (c) => v(resumir(c.tip, true).cap), "grade típica das próximas 4 semanas")}
                {linha("Livres/semana", (c) => <b style={{ color: "var(--green-deep)" }}>{v(resumir(c.tip, true).vagas)}</b>, "grade típica · o que dá para vender")}
                {linha("Cabem ainda", (c) => {
                  const livres = Math.floor(resumir(c.tip, true).vagas + 0.05);
                  return <><b>{livres}</b> aluna(s) 1x<div className="cli-sub">ou {Math.floor(livres / 2)} no 2x</div></>;
                }, "aproximado — o 2x precisa de vaga em dois horários")}
              </tbody>
            </table>
            {!tipicas.length && <div className="seg-hint">Sem turmas cadastradas nas próximas 4 semanas para calcular o que ainda cabe.</div>}
          </div>
        );
      })()}

      {/* 4. Tipos de aluna por unidade */}
      {turmas.length > 0 && (
        <div className="panel">
          <div className="panel-h"><h2>🏷️ Tipos de aluna <span className="muted-note">· vagas ocupadas{media ? " por semana (média)" : " no período"}</span></h2></div>
          <table>
            <thead><tr><th>Tipo</th>{unidades.map((u) => <th key={u}>{u}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {TIPOS_ALUNA.map((t) => {
                const deU = (u) => resumir(daUnidade(turmas, u), media).tipos[t.k] || 0;
                const tot = total.tipos[t.k] || 0;
                return (
                  <tr key={t.k}>
                    <td className="c-main"><span style={{ display: "inline-flex", alignItems: "center", gap: ".45rem" }}><Bolinha cor={t.cor} /><b>{t.l}</b></span></td>
                    {unidades.map((u) => <td key={u} data-l={u}>{v(deU(u))}</td>)}
                    <td data-l="Total"><b>{v(tot)}</b> <span className="cli-sub">({pct(tot, total.ocup)}%)</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 3. Turmas da grade, com filtros e CSV */}
      {turmas.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>🧶 Turmas da grade <span className="muted-note">· {media ? "média de cada turma" : rotuloPeriodo(tipo, refDia)}</span></h2>
            <button className="btn sec sm" disabled={media ? !grade.length : !lista.length} onClick={exportar}>⬇ Exportar CSV</button>
          </div>
          <div className="ag-filters">
            <FiltroUnidade unidades={unidades} unit={unit} setUnit={setUnit} />
            <div className="seg">
              <button className={!soComVaga ? "on" : ""} onClick={() => setSoComVaga(false)}>Todas as turmas</button>
              <button className={soComVaga ? "on" : ""} onClick={() => setSoComVaga(true)}>Só com vaga</button>
            </div>
          </div>
          {grade.length ? (
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
                        <div style={{ height: 6, borderRadius: 4, background: "var(--line)", marginTop: 4, maxWidth: 120, overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, pct(g.r.ocup, g.r.cap))}%`, height: "100%", background: g.r.ocup >= g.r.cap ? "var(--terracota)" : "var(--sage-deep)" }} />
                        </div>
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
          )}
        </div>
      )}

      {/* Aulas do período com o nome de cada aluna e o tipo dela */}
      {turmas.length > 0 && !media && (
        <div className="panel">
          <div className="panel-h"><h2>📋 Aulas e alunas <span className="muted-note">· {rotuloPeriodo(tipo, refDia)}</span></h2></div>
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
        </div>
      )}
    </>
  );
}
