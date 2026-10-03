import { useState, useEffect, Fragment } from "react";
import { useStore } from "./store.jsx";
import { useModal } from "./ui.jsx";
import { api } from "./api.js";
import { ClientProfile, SlotDetail } from "./modals.jsx";
import { exportCsv } from "./exports.js";
import {
  todayISO, addDays, weekStart, fmtDate, fmtDateLong, money, capitalize, hhmm, unitColor,
  slotBookings, slotCapacity, slotWaitlist, contemBusca,
} from "./helpers.js";

/* ============================================================
   Relatórios do Financeiro — duas abas:

   • VENDAS: o dinheiro que entrou no período, por unidade e no
     total, separado pelo tipo (mensalidade, matrícula, taxa, aula
     avulsa, aula extra). As linhas vêm prontas do servidor
     (GET /api/relatorios/vendas) — é lá que mora a regra de não
     contar o mesmo Pix duas vezes; aqui só se soma.
   • VAGAS: lugares livres por dia e por turma, com as alunas de
     cada turma, por unidade e no total. Sai do estado do painel
     (horários + marcações), sem chamada extra.

   Em ambas, o resumo por unidade não muda com o filtro de unidade:
   o filtro só estreita a lista detalhada lá embaixo.
   ============================================================ */

const pad = (n) => String(n).padStart(2, "0");

/* ----------------- período (dia / semana / mês / ano) ----------------- */
function intervalo(tipo, ref) {
  if (tipo === "dia") return [ref, ref];
  if (tipo === "semana") { const s = weekStart(ref); return [s, addDays(s, 6)]; }
  const [y, m] = ref.split("-").map(Number);
  if (tipo === "mes") return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`];
  return [`${y}-01-01`, `${y}-12-31`];
}
function andar(tipo, ref, dir) {
  if (tipo === "dia") return addDays(ref, dir);
  if (tipo === "semana") return addDays(ref, 7 * dir);
  const [y, m] = ref.split("-").map(Number);
  if (tipo === "mes") { const d = new Date(y, m - 1 + dir, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; }
  return `${y + dir}-01-01`;
}
function rotuloPeriodo(tipo, ref) {
  const [de, ate] = intervalo(tipo, ref);
  if (tipo === "dia") return capitalize(fmtDateLong(ref)) + (ref === todayISO() ? " · hoje" : "");
  if (tipo === "semana") return `${fmtDate(de)} – ${fmtDate(ate)}`;
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

/* ============================= VAGAS ============================= */
const PERIODOS_VAGAS = [["dia", "📍 Dia"], ["semana", "📆 Semana"], ["mes", "🗓 Mês"]];

export function RelatorioVagas() {
  const { data } = useStore();
  const { open } = useModal();
  const [tipo, setTipo] = useState("semana");
  const [refDia, setRefDia] = useState(todayISO());
  const [unit, setUnit] = useState("Todas");
  const [soComVaga, setSoComVaga] = useState(false);
  const [de, ate] = intervalo(tipo, refDia);

  // Uma linha por turma (horário) do período, já com as contas feitas
  const turmas = data.slots
    .filter((s) => s.date >= de && s.date <= ate)
    .map((s) => {
      const alunas = slotBookings(data, s.id);
      const cap = slotCapacity(s);
      return { s, alunas, cap, ocup: alunas.length, vagas: Math.max(0, cap - alunas.length), espera: slotWaitlist(s).length };
    })
    .sort((a, b) => (a.s.date + hhmm(a.s.time)).localeCompare(b.s.date + hhmm(b.s.time)) || a.s.unit.localeCompare(b.s.unit));

  const unidades = unidadesDe(data.meta, turmas.map((t) => t.s.unit));
  const resumo = (lista) => {
    const cap = lista.reduce((n, t) => n + t.cap, 0);
    const ocup = lista.reduce((n, t) => n + Math.min(t.ocup, t.cap), 0);
    return { turmas: lista.length, cap, ocup, vagas: lista.reduce((n, t) => n + t.vagas, 0), espera: lista.reduce((n, t) => n + t.espera, 0) };
  };
  const total = resumo(turmas);
  const dias = [...new Set(turmas.map((t) => t.s.date))];

  const lista = turmas
    .filter((t) => unit === "Todas" || t.s.unit === unit)
    .filter((t) => !soComVaga || t.vagas > 0);
  const diasLista = [...new Set(lista.map((t) => t.s.date))];

  const exportar = () => exportCsv(`vagas-${de}-a-${ate}`,
    ["Data", "Dia", "Hora", "Unidade", "Professora", "Capacidade", "Alunas", "Vagas livres", "Lista de espera", "Nomes"],
    lista.map((t) => [t.s.date, capitalize(new Date(t.s.date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long" })),
      hhmm(t.s.time), t.s.unit, t.s.prof || "", t.cap, t.ocup, t.vagas, t.espera, t.alunas.map((b) => b.clientName).join(", ")]));

  const celula = (r) => (
    <>
      <b style={{ color: r.vagas ? "var(--green-deep)" : "var(--muted)" }}>{r.vagas} vaga(s)</b>
      <div className="cli-sub">{r.ocup}/{r.cap} ocupados · {pct(r.ocup, r.cap)}%</div>
    </>
  );

  return (
    <>
      <div className="panel">
        <Periodo tipos={PERIODOS_VAGAS} tipo={tipo} setTipo={setTipo} refDia={refDia} setRefDia={setRefDia} />

        <div className="grid stats" style={{ marginBottom: "1rem" }}>
          {unidades.map((u) => {
            const r = resumo(turmas.filter((t) => t.s.unit === u));
            return (
              <div key={u} className="card stat click" onClick={() => setUnit(unit === u ? "Todas" : u)}
                style={unit === u ? { outline: `2px solid ${unitColor(u)}` } : undefined} title="Clique para ver só as turmas desta unidade">
                <div className="lbl"><span style={{ background: unitColor(u), width: 10, height: 10, borderRadius: "50%", display: "inline-block" }} /> {u}</div>
                <div className="val">{r.vagas}</div>
                <div className="foot">vaga(s) livre(s) · {r.turmas} turma(s) · {r.ocup}/{r.cap} ocupados ({pct(r.ocup, r.cap)}%)</div>
              </div>
            );
          })}
          <div className="card stat">
            <div className="lbl">🪑 Total</div>
            <div className="val terra">{total.vagas}</div>
            <div className="foot">vaga(s) livre(s) · {total.turmas} turma(s) · {total.ocup}/{total.cap} ocupados ({pct(total.ocup, total.cap)}%)</div>
          </div>
        </div>

        {dias.length ? (
          <table>
            <thead><tr><th>Dia</th>{unidades.map((u) => <th key={u}>{u}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {dias.map((d) => {
                const doDia = turmas.filter((t) => t.s.date === d);
                return (
                  <tr key={d}>
                    <td className="c-main"><b>{capitalize(fmtDateLong(d))}</b><div className="cli-sub">{doDia.length} turma(s)</div></td>
                    {unidades.map((u) => {
                      const x = doDia.filter((t) => t.s.unit === u);
                      return <td key={u} data-l={u}>{x.length ? celula(resumo(x)) : <span className="cli-sub">sem turma</span>}</td>;
                    })}
                    <td data-l="Total">{celula(resumo(doDia))}</td>
                  </tr>
                );
              })}
              {dias.length > 1 && (
                <tr>
                  <td className="c-main"><b>Total do período</b></td>
                  {unidades.map((u) => <td key={u} data-l={u}>{celula(resumo(turmas.filter((t) => t.s.unit === u)))}</td>)}
                  <td data-l="Total">{celula(total)}</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="empty"><div className="ic">📅</div><p>Nenhuma turma cadastrada neste período.</p></div>
        )}
      </div>

      {turmas.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <h2>🧶 Turmas e alunas <span className="muted-note">· {rotuloPeriodo(tipo, refDia)}</span></h2>
            <button className="btn sec sm" disabled={!lista.length} onClick={exportar}>⬇ Exportar CSV</button>
          </div>
          <div className="ag-filters">
            <FiltroUnidade unidades={unidades} unit={unit} setUnit={setUnit} />
            <div className="seg">
              <button className={!soComVaga ? "on" : ""} onClick={() => setSoComVaga(false)}>Todas as turmas</button>
              <button className={soComVaga ? "on" : ""} onClick={() => setSoComVaga(true)}>Só com vaga</button>
            </div>
          </div>
          {lista.length ? (
            <table>
              <thead><tr><th>Turma</th><th>Unidade</th><th>Ocupação</th><th>Vagas</th><th>Alunas</th></tr></thead>
              <tbody>
                {diasLista.map((d) => {
                  const doDia = lista.filter((t) => t.s.date === d);
                  const r = resumo(doDia);
                  return (
                    <Fragment key={d}>
                      <tr className="grp">
                        <td colSpan={5} style={{ background: "var(--cream)", fontWeight: 800, color: "var(--green-deep)" }}>
                          📅 {capitalize(fmtDateLong(d))}
                          <span className="cli-sub" style={{ fontWeight: 600, marginLeft: ".5rem" }}>
                            {r.turmas} turma(s) · {r.ocup}/{r.cap} ocupados · {r.vagas} vaga(s)
                          </span>
                        </td>
                      </tr>
                      {doDia.map((t) => (
                        <tr key={t.s.id} className="row-click" onClick={() => open(<SlotDetail slotId={t.s.id} />)}>
                          <td className="c-main"><b>{hhmm(t.s.time)}</b>{t.s.prof ? <div className="cli-sub">{t.s.prof}</div> : null}</td>
                          <td data-l="Unidade"><span className="chip" style={{ color: unitColor(t.s.unit) }}>{t.s.unit}</span></td>
                          <td data-l="Ocupação">
                            {t.ocup}/{t.cap}
                            <div style={{ height: 6, borderRadius: 4, background: "var(--line)", marginTop: 4, maxWidth: 120, overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(100, pct(t.ocup, t.cap))}%`, height: "100%", background: t.ocup >= t.cap ? "var(--terracota)" : "var(--sage-deep)" }} />
                            </div>
                          </td>
                          <td data-l="Vagas">
                            {t.vagas
                              ? <span className="badge b-ok">{t.vagas} vaga(s)</span>
                              : <span className="badge b-terra">lotada{t.ocup > t.cap ? ` (+${t.ocup - t.cap})` : ""}</span>}
                            {t.espera ? <div className="cli-sub">{t.espera} na lista de espera</div> : null}
                          </td>
                          <td data-l="Alunas" style={{ fontSize: ".85rem" }}>
                            {t.alunas.length ? t.alunas.map((b) => b.clientName).join(", ") : <span className="cli-sub">nenhuma aluna</span>}
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
