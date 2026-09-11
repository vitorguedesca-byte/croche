import { useState, useEffect, useRef, Fragment } from "react";
import { toast, confirmModal } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { useModal, StatusBadge, Select } from "./ui.jsx";
import { api } from "./api.js";
import { WaIcon } from "./icons.jsx";
import {
  SlotCard, DayModal, ManageBooking, ClientProfile, SlotDetail, TurmaView, AlterarMensalidade, FeriadoAulas,
  baixarMensalidade, AlterarVencimentoModal, BaixarLeadModal,
} from "./modals.jsx";
import {
  UNITS, STATUS, unitColor,
  todayISO, addDays, weekStart, fmtDate, fmtDateLong, weekdayShort, money, waLink, capitalize, faixaHorario, fimDaAula, hhmm,
  bookingsActive, slotBookings, slotBookingsAll, slotCapacity, slotOccupancy, slotWaitlist, clientAttendance,
  bookingKindDe, BOOKING_KINDS, feriadoDe, feriadoBaseDe, compAtual, addComp, compLabel, competenciasDoAluno, mensalidadeDe, matriculaISO,
  mensalidadeDaComp, precoDaComp, situacaoMensalidade, clientOfBooking, ehPagamentoDeMatricula,
  clientMonthClasses, classifyClient, isNewLead,
  aniversariantes, diaMesNasc, diaMesLabel, faltamLabel,
  proximaCobranca, fraseProximaCobranca,
} from "./helpers.js";

const openWa = (phone, msg) => window.open(waLink(phone, msg), "_blank");

/* ============================= ALERTAS ============================= */
function Alerts({ open }) {
  const { data } = useStore();
  const t = todayISO();
  const daysSince = (iso) => Math.floor((new Date(t + "T00:00") - new Date((iso || "").slice(0, 10) + "T00:00")) / 86400000);

  /* Só a reserva da matrícula entra aqui: o dinheiro dela é a 1ª mensalidade
     da aluna. As demais aulas não têm preço próprio — já estão dentro do plano —
     e cobrar por elas era o R$ 20 fantasma que saiu do sistema em 30/08/2026. */
  const atrasados = data.bookings.filter((b) => b.status === "aguardando" &&
    ehPagamentoDeMatricula(b.paymentMethod) && daysSince(b.createdAt) >= 3)
    .sort((a, b) => daysSince(b.createdAt) - daysSince(a.createdAt)).slice(0, 5);
  const quase = data.slots.filter((s) => s.date >= t && slotCapacity(s) > 1 && slotCapacity(s) - slotOccupancy(data, s.id) === 1)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);
  const lastByClient = {};
  bookingsActive(data).forEach((b) => { if (!lastByClient[b.clientName] || b.date > lastByClient[b.clientName]) lastByClient[b.clientName] = b.date; });
  const inativas = data.clients.filter((c) => { const l = lastByClient[c.name]; return l && daysSince(l) >= 30; })
    .sort((a, b) => daysSince(lastByClient[b.name]) - daysSince(lastByClient[a.name])).slice(0, 5);

  /* Fez a 1ª aula, a 1ª mensalidade está paga e ela não virou mensalista:
     ou você conclui a matrícula, ou devolve o valor. Normalmente isso só aparece
     quando a conversão automática falhou (Sicredi fora do ar, por exemplo).
     Só cobra atenção depois da aula ter acontecido. */
  const decidirMatricula = data.clients
    .filter((c) => c.matriculaStatus === "paga" && c.plan !== "mensalista" && c.trialDate && c.trialDate <= t)
    .sort((a, b) => (a.trialDate || "").localeCompare(b.trialDate || ""))
    .slice(0, 5);

  if (!atrasados.length && !quase.length && !inativas.length && !decidirMatricula.length) return null;

  return (
    <div className="panel">
      <div className="panel-h"><h2>🔔 Alertas</h2></div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "1rem" }}>
        {atrasados.length > 0 && (
          <div>
            <div className="alert-h" style={{ color: "var(--warn)" }}>⏳ 1ª mensalidade pendente</div>
            {atrasados.map((b) => (
              <div className="alert-row" key={b.id}>
                <div><b>{b.clientName}</b><div className="cli-sub">
                  há {daysSince(b.createdAt)} dias · {money(b.value)}
                </div></div>
                <button className="btn wa sm" onClick={() => openWa(b.phone, `Olá ${b.clientName}! Vi que sua matrícula da aula de ${fmtDate(b.date)} ainda está pendente. Posso te ajudar a confirmar? 💚`)}>Cobrar</button>
              </div>
            ))}
          </div>
        )}
        {decidirMatricula.length > 0 && (
          <div>
            <div className="alert-h" style={{ color: "var(--terracota)" }}>🎟️ Matrícula a decidir</div>
            {decidirMatricula.map((c) => {
              const dias = daysSince(c.trialDate);
              return (
                <div className="alert-row row-click" key={c.id} onClick={() => open(<ClientProfile client={c} />)}>
                  <div>
                    <b>{c.name}</b>
                    <div className="cli-sub">
                      1ª aula {dias === 0 ? "hoje" : `há ${dias} dia${dias === 1 ? "" : "s"}`} · concluir a matrícula ou devolver o valor
                    </div>
                  </div>
                  <span className={`badge ${dias >= 7 ? "b-danger" : "b-warn"}`}>{dias >= 7 ? "atrasado" : "decidir"}</span>
                </div>
              );
            })}
          </div>
        )}
        {quase.length > 0 && (
          <div>
            <div className="alert-h" style={{ color: "var(--terracota)" }}>🔥 Turmas quase lotando</div>
            {quase.map((s) => (
              <div className="alert-row row-click" key={s.id} onClick={() => open(<SlotDetail slotId={s.id} />)}>
                <div><b>{fmtDate(s.date)} · {hhmm(s.time)}</b><div className="cli-sub">{s.unit} · 1 vaga restante</div></div>
                <span className="badge b-terra">1 vaga</span>
              </div>
            ))}
          </div>
        )}
        {inativas.length > 0 && (
          <div>
            <div className="alert-h" style={{ color: "var(--info)" }}>💤 Alunas inativas</div>
            {inativas.map((c) => (
              <div className="alert-row" key={c.id}>
                <div><b>{c.name}</b><div className="cli-sub">sem aula há {daysSince(lastByClient[c.name])} dias</div></div>
                <button className="btn wa sm" onClick={() => openWa(c.phone, `Olá ${c.name}! Sentimos sua falta nas aulas de crochê 💚 Que tal voltar? Tenho horários novos pra você.`)}>Reativar</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================= DASHBOARD ============================= */
export function Dashboard({ go }) {
  const { data } = useStore();
  const { open } = useModal();
  const t = todayISO();
  const hoje = bookingsActive(data).filter((b) => b.date === t).sort((a, b) => a.time.localeCompare(b.time));
  const month = new Date().toISOString().slice(0, 7);
  const wk = weekStart(t), wkEnd = addDays(wk, 6);
  const aulasSemana = bookingsActive(data).filter((b) => b.date >= wk && b.date <= wkEnd).length;
  const concluidasMes = data.bookings.filter((b) => b.status === "concluida" && b.date.slice(0, 7) === month).length;
  const futuras = bookingsActive(data).filter((b) => b.date >= t).length;
  const prox = bookingsActive(data).filter((b) => b.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 6);

  const groups = { cliente: 0, novato: 0 };
  data.clients.forEach((c) => { groups[classifyClient(data, c)]++; });

  const hh = new Date().getHours();
  const saud = hh < 12 ? "Bom dia" : hh < 18 ? "Boa tarde" : "Boa noite";
  const dataLonga = capitalize(new Date(t + "T00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }));

  const confHoje = hoje.filter((b) => b.status === "confirmada").length;

  return (<>
    <div className="dash-hello">
      <div><h2>{saud}! 💚</h2><p>{dataLonga}</p></div>
      <button className="btn" onClick={() => go("agenda")}>📅 Abrir agenda</button>
    </div>

    <div className="grid stats" style={{ marginBottom: "1rem" }}>
      <div className="card stat click" onClick={() => go("agenda")}><div className="lbl">📅 Aulas hoje</div><div className="val">{hoje.length}</div><div className="foot">{hoje.length ? `${hoje.length} agendada(s)` : "nenhuma"}</div></div>
      <div className="card stat click" onClick={() => go("agenda")}><div className="lbl">📆 Nesta semana</div><div className="val">{aulasSemana}</div><div className="foot">{fmtDate(wk)} – {fmtDate(wkEnd)}</div></div>
      <div className="card stat click" onClick={() => go("agenda")}><div className="lbl">🗓 Aulas agendadas</div><div className="val terra">{futuras}</div><div className="foot">de hoje em diante</div></div>
      <div className="card stat click" onClick={() => go("marcacoes")}><div className="lbl">✅ Aulas realizadas</div><div className="val">{concluidasMes}</div><div className="foot">presenças no mês</div></div>
    </div>

    <div className="people-strip">
      <button className="people-card" onClick={() => go("clientes", { tab: "cliente" })}><span className="pc-ic">👩</span><span className="pc-n">{groups.cliente}</span><span className="pc-l">Alunos</span></button>
      <button className="people-card" onClick={() => go("clientes", { tab: "novato" })}><span className="pc-ic">✨</span><span className="pc-n">{groups.novato}</span><span className="pc-l">Novatos(as)</span></button>
    </div>

    <Alerts open={open} />

    {/* A aula não se cobra sozinha: a aluna paga por MÊS. O que precisa de olho
        no dinheiro está no Financeiro (Pix das mensalidades), não aqui. */}
    <div className="panel">
      <div className="panel-h"><h2>🧶 Aulas de hoje</h2><button className="btn sec sm" onClick={() => go("agenda")}>Agenda</button></div>
      {hoje.length ? (
        <table><thead><tr><th>Hora</th><th>Aluno</th><th>Unidade</th><th>Presença</th></tr></thead><tbody>
          {hoje.map((b) => (
            <tr key={b.id} onClick={() => open(<ManageBooking booking={b} />)} className="row-click">
              <td data-l="Hora"><b>{b.time}</b></td>
              <td data-l="Aluno">{b.clientName}</td>
              <td data-l="Unidade"><span className="chip">{b.unit}</span></td>
              <td data-l="Presença">
                {b.status === "cancelada" ? <span className="badge b-danger">Cancelada</span>
                  : b.attendance === "presente" ? <span className="badge b-ok">✓ Presente</span>
                  : b.attendance === "falta" ? <span className="badge b-danger">✕ Falta</span>
                  : <span className="cli-sub">—</span>}
              </td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="empty"><div className="ic">☕</div><p>Nenhuma aula hoje.</p></div>}
    </div>

    <div className="panel">
      <div className="panel-h"><h2>📅 Próximas aulas</h2><button className="btn sec sm" onClick={() => go("agenda")}>Abrir agenda</button></div>
      {prox.length ? (
        <table><thead><tr><th>Dia</th><th>Hora</th><th>Aluno</th><th>Unidade</th></tr></thead><tbody>
          {prox.map((b) => (
            <tr key={b.id} onClick={() => open(<ManageBooking booking={b} />)} className="row-click">
              <td data-l="Dia">{fmtDateLong(b.date)}</td><td data-l="Hora"><b>{b.time}</b></td><td data-l="Aluno">{b.clientName}</td><td data-l="Unidade"><span className="chip">{b.unit}</span></td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="empty"><div className="ic">🧶</div><p>Sem aulas agendadas.</p></div>}
    </div>
  </>);
}

/* ============================= AGENDA ============================= */
export function Agenda({ somenteLeitura = false }) {
  const { data } = useStore();
  const { open } = useModal();
  const [view, setView] = useState("month");
  const [unit, setUnit] = useState("Todas");
  const [ref, setRef] = useState(todayISO());

  const agSlots = (date) => data.slots.filter((s) => s.date === date && (unit === "Todas" || s.unit === unit)).sort((a, b) => a.time.localeCompare(b.time));
  const nav = (dir) => {
    if (view === "month") { const d = new Date(ref + "T00:00"); d.setDate(1); d.setMonth(d.getMonth() + dir); setRef(d.toISOString().slice(0, 10)); }
    else if (view === "day") setRef(addDays(ref, dir)); // o dia anda de 1 em 1
    else setRef(addDays(ref, 7 * dir)); // semana e lista andam de 7 em 7 dias
  };
  const periodLabel = () => {
    const d = new Date(ref + "T00:00");
    if (view === "month") return capitalize(d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
    if (view === "week") { const s = weekStart(ref); return fmtDate(s) + " – " + fmtDate(addDays(s, 6)); }
    if (view === "day") return capitalize(fmtDateLong(ref)) + (ref === todayISO() ? " · hoje" : "");
    return ref === todayISO() ? "Hoje e próximos dias" : "A partir de " + fmtDate(ref);
  };

  const views = [["month", "🗓 Mês"], ["week", "📆 Semana"], ["day", "📍 Dia"], ["list", "📋 Lista"]];
  const metaUnits = data.meta.units;
  const units = ["Todas", ...metaUnits];

  return (
    <div className="panel">
      <div className="ag-toolbar">
        <div className="ag-views">
          {views.map((v) => <button key={v[0]} className={view === v[0] ? "on" : ""} onClick={() => setView(v[0])}>{v[1]}</button>)}
        </div>
        <div className="ag-nav">
          <button className="navbtn" onClick={() => nav(-1)}>←</button>
          <span className="ag-period">{periodLabel()}</span>
          <button className="navbtn" onClick={() => nav(1)}>→</button>
          <button className="btn ghost sm" onClick={() => setRef(todayISO())}>Hoje</button>
        </div>
      </div>
      <div className="ag-filters">
        <div className="ag-units">
          <span style={{ fontSize: ".76rem", color: "var(--muted)", fontWeight: 700, marginRight: ".2rem" }}>Unidade:</span>
          {units.map((u) => {
            const sw = u === "Todas"
              ? <span className="sw" style={{ background: `linear-gradient(135deg,${unitColor(metaUnits[0])} 50%,${unitColor(metaUnits[1] || metaUnits[0])} 50%)` }} />
              : <span className="sw" style={{ background: unitColor(u) }} />;
            return <button key={u} className={`unit-chip ${unit === u ? "on" : ""}`} style={unit === u && u !== "Todas" ? { color: unitColor(u) } : undefined} onClick={() => setUnit(u)}>{sw}{u}</button>;
          })}
        </div>
        <div className="ag-legend">
          {Object.values(BOOKING_KINDS).map((t) => <span key={t.key} className="lg"><span className="lgdot" style={{ background: t.color }} />{t.ic} {t.label}</span>)}
          <span className="lg-sep" />
          {Object.keys(STATUS).map((k) => <span key={k} className="lg"><span className="lgdot" style={{ background: STATUS[k].dot }} />{STATUS[k].label}</span>)}
        </div>
      </div>
      {view === "month" && <MonthView ref0={ref} agSlots={agSlots} open={open} data={data} unit={unit} somenteLeitura={somenteLeitura} />}
      {view === "week" && <WeekView ref0={ref} agSlots={agSlots} data={data} unit={unit} somenteLeitura={somenteLeitura} />}
      {view === "day" && <DayView ref0={ref} agSlots={agSlots} data={data} unit={unit} somenteLeitura={somenteLeitura} irPara={setRef} />}
      {view === "list" && <ListView data={data} unit={unit} open={open} ref0={ref} somenteLeitura={somenteLeitura} />}
    </div>
  );
}

function MonthView({ ref0, agSlots, open, data, unit, somenteLeitura = false }) {
  const refd = new Date(ref0 + "T00:00");
  const y = refd.getFullYear(), m = refd.getMonth(), t = todayISO();
  const firstISO = new Date(y, m, 1).toISOString().slice(0, 10);
  const startDow = (new Date(firstISO + "T00:00").getDay() + 6) % 7;
  const gridStart = addDays(firstISO, -startDow);
  const dows = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const dd = new Date(date + "T00:00");
    const out = dd.getMonth() !== m;
    const slots = agSlots(date);
    const evs = slots.slice(0, 3).map((s) => {
      const uc = unitColor(s.unit), cap = slotCapacity(s), occ = slotOccupancy(data, s.id), full = occ >= cap;
      const txt = occ ? `${hhmm(s.time)} · ${occ}/${cap}` : `${hhmm(s.time)} Livre`;
      return <div key={s.id} className={`m-ev ${occ ? "" : "free"} ${full ? "full" : ""}`} style={{ "--uc": uc, ...(occ ? { background: "var(--cream)", color: uc } : {}) }}>{txt}</div>;
    });
    const dots = slots.slice(0, 8).map((s) => <span key={s.id} className="m-dot" style={{ background: slotOccupancy(data, s.id) ? unitColor(s.unit) : "var(--line)", width: 7, height: 7, borderRadius: "50%" }} />);
    const more = slots.length > 3 ? <div className="m-more">+{slots.length - 3} mais</div> : null;
    // Feriado: a escola não abre. O dia fica marcado no mês para a Inêz não
    // tentar criar turma ali — e para entender por que a replicação pulou.
    const fer = feriadoDe(data, date, unit);
    cells.push(
      <div key={i} className={`m-cell ${out ? "out" : ""} ${date === t ? "today" : ""} ${fer ? "feriado" : ""}`} onClick={() => open(<DayModal date={date} unit={unit} somenteLeitura={somenteLeitura} />)}>
        <span className="dn">{dd.getDate()}</span>
        {fer && <div className="m-feriado" title={`${fer} — a escola não abre`}>🚫 {fer}</div>}
        {evs}{more}<div className="m-dots">{dots}</div>
      </div>
    );
  }
  return <div className="month-grid">{dows.map((d) => <div key={d} className="month-dow">{d}</div>)}{cells}</div>;
}

function WeekView({ ref0, agSlots, data, unit, somenteLeitura = false }) {
  const start = weekStart(ref0), t = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="agenda" style={{ "--cols": 7 }}>
      {days.map((date) => {
        const slots = agSlots(date);
        const fer = feriadoDe(data, date, unit);
        return (
          <div key={date} className={`day-col ${fer ? "feriado" : ""}`}>
            <div className={`day-h ${date === t ? "today" : ""}`}><b>{fmtDate(date)}</b><span>{weekdayShort(date)}</span></div>
            {/* Feriado: a escola não abre. A coluna diz isso antes de qualquer turma. */}
            {fer && <div className="col-feriado" title="A escola não abre neste dia">🚫 {fer}</div>}
            {/* todosAlunos: na semana o cartão mostra a turma inteira, não os 5 primeiros */}
            {slots.length ? slots.map((s) => <SlotCard key={s.id} slot={s} showUnit={unit === "Todas"} todosAlunos somenteLeitura={somenteLeitura} />) : !fer && <div className="day-empty">—</div>}
          </div>
        );
      })}
    </div>
  );
}

function FeriadoDayControls({ date, unit, data, somenteLeitura }) {
  const { reload } = useStore();
  const { open } = useModal();
  const [busy, setBusy] = useState("");
  const unidades = unit === "Todas" ? (data.meta?.units || []) : [unit];
  const itens = unidades
    .map((u) => ({ unit: u, nome: feriadoBaseDe(data, date, u), fechado: !!feriadoDe(data, date, u) }))
    .filter((f) => f.nome);
  if (!itens.length) return null;

  const alternar = async (f) => {
    setBusy(f.unit);
    try {
      const r = await api.feriados.definirAulas(date, f.unit, f.fechado);
      await reload();
      if (!f.fechado && r.aulas?.length) open(<FeriadoAulas date={date} unit={f.unit} nome={f.nome} aulas={r.aulas} />);
      else toast(f.fechado ? `Aulas ativadas em ${f.unit}.` : `Dia fechado em ${f.unit}.`, "success");
    } catch (e) { toast(e.message || "Não foi possível alterar o feriado.", "error"); }
    finally { setBusy(""); }
  };

  return itens.map((f) => (
    <div className={`dia-feriado ${f.fechado ? "" : "aberto"}`} key={f.unit}>
      <span>{f.fechado ? "🚫" : "✅"} <b>{f.nome}</b>{unit === "Todas" ? ` · ${f.unit}` : ""}</span>
      {!somenteLeitura && (
        <label className="hf-toggle" style={{ margin: 0 }}>
          <input type="checkbox" checked={!f.fechado} disabled={busy === f.unit} onChange={() => alternar(f)} />
          <span className="hf-day">Terá aula</span>
        </label>
      )}
    </div>
  ));
}

/* Visão DIA: um único dia inteiro, hora a hora, com a turma aberta em cada
   horário. É a tela de quem vai dar aula — não precisa procurar o dia na grade
   do mês nem espremer sete colunas para ler os nomes. A tira da semana em cima
   serve para pular de um dia para o outro sem sair da visão. */
function DayView({ ref0, agSlots, data, unit, somenteLeitura = false, irPara }) {
  const { open } = useModal();
  const t = todayISO();
  const semana = weekStart(ref0);
  const dias = Array.from({ length: 7 }, (_, i) => addDays(semana, i));
  const slots = agSlots(ref0);
  const totalAlunas = slots.reduce((n, s) => n + slotOccupancy(data, s.id), 0);
  const totalVagas = slots.reduce((n, s) => n + slotCapacity(s), 0);
  return (
    <>
      <div className="dv-tira">
        {dias.map((d) => {
          const qtd = data.slots.filter((s) => s.date === d && (unit === "Todas" || s.unit === unit)).length;
          return (
            <button key={d} className={`dv-tira-d ${d === ref0 ? "on" : ""} ${d === t ? "hoje" : ""}`}
              onClick={() => irPara(d)}>
              <span className="dv-dow">{weekdayShort(d)}</span>
              <span className="dv-num">{new Date(d + "T00:00").getDate()}</span>
              <span className="dv-pts">{qtd ? "•".repeat(Math.min(qtd, 4)) : "\u00a0"}</span>
            </button>
          );
        })}
      </div>

      {/* Feriado: a escola não abre. Fica no topo do dia, acima de tudo — se
          ainda houver turma marcada aqui, ela é o problema a resolver. */}
      <FeriadoDayControls date={ref0} unit={unit} data={data} somenteLeitura={somenteLeitura} />

      {slots.length ? (
        <>
          <div className="dv-resumo">
            {slots.length} {slots.length === 1 ? "horário" : "horários"} ·{" "}
            <b>{totalAlunas}</b> de {totalVagas} {totalVagas === 1 ? "vaga" : "vagas"} ocupadas
          </div>
          <div className="dv-lista">
            {slots.map((s) => {
              const uc = unitColor(s.unit);
              const todas = slotBookingsAll(data, s.id);
              const ativas = todas.filter((b) => b.status !== "cancelada");
              const cap = slotCapacity(s);
              const cheio = ativas.length >= cap;
              return (
                <div className="dv-slot" key={s.id} style={{ "--uc": uc }}>
                  <div className="dv-hora">
                    <b>{hhmm(s.time)}</b>
                    <span>até {fimDaAula(s.time, data.meta.duracaoAulaMin)}</span>
                  </div>
                  <div className="dv-corpo">
                    <div className="dv-slot-h">
                      <span className="dv-unit" style={{ color: uc }}>📍 {s.unit}</span>
                      <span className={`dv-ocup ${cheio ? "cheio" : ativas.length ? "" : "livre"}`}>
                        {ativas.length}/{cap}
                      </span>
                      <button className="btn ghost sm"
                        onClick={() => open(somenteLeitura ? <TurmaView slotId={s.id} /> : <SlotDetail slotId={s.id} />)}>
                        {somenteLeitura ? "Ver turma" : "Gerir turma"}
                      </button>
                    </div>
                    {todas.length ? (
                      <div className="dv-alunas">
                        {todas.map((b) => {
                          const k = bookingKindDe(data, b);
                          return (
                            <div key={b.id} className={`dv-al ${b.status === "cancelada" ? "canc" : ""} ${somenteLeitura ? "ro" : ""} ${k ? "dv-" + k.key : ""}`}
                              style={k ? { "--kc": k.color } : undefined}
                              onClick={somenteLeitura ? undefined : () => open(<ManageBooking booking={b} />)}>
                              <span className="nm">{b.clientName}</span>
                              <span className="sp">
                                {k && <span className={`badge ${k.cls}`}>{k.ic} {k.label}</span>}
                                {b.attendance === "presente" && <span className="badge b-ok">✓ presente</span>}
                                {b.attendance === "falta" && <span className="badge b-danger">✕ faltou</span>}
                                <StatusBadge status={b.status} />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : <div className="dv-vazio">Horário livre — nenhuma aluna marcada.</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="empty"><div className="ic">📍</div><p>Nenhum horário{unit === "Todas" ? "" : ` de ${unit}`} neste dia.</p></div>
      )}
    </>
  );
}

function ListView({ data, unit, open, ref0, somenteLeitura = false }) {
  const base = ref0 || todayISO();
  const DIAS = 21; // mostra ~3 semanas a partir da data de referência
  const dias = Array.from({ length: DIAS }, (_, i) => addDays(base, i));
  const t = todayISO();

  // dias que têm horário cadastrado na unidade filtrada
  const porDia = dias
    .map((d) => ({
      date: d,
      slots: data.slots
        .filter((s) => s.date === d && (unit === "Todas" || s.unit === unit))
        .sort((a, b) => a.time.localeCompare(b.time)),
    }))
    .filter((x) => x.slots.length);

  if (!porDia.length)
    return <div className="empty"><div className="ic">📋</div><p>Sem horários cadastrados nesse período.</p></div>;

  return <>{porDia.map(({ date, slots }) => (
    <div className="list-day" key={date}>
      <div className="list-day-h">{fmtDateLong(date)}{date === t ? " · hoje" : ""}</div>
      {slots.map((s) => {
        const uc = unitColor(s.unit);
        const todas = slotBookingsAll(data, s.id);      // inclui canceladas
        const ativas = todas.filter((b) => b.status !== "cancelada");
        const cap = slotCapacity(s);
        return (
          <div className="ls-slot" key={s.id} style={{ "--uc": uc }}>
            <div className="ls-slot-h">
              <span className="ls-time">{faixaHorario(s.time, data.meta.duracaoAulaMin)}</span>
              <span className="ls-unit">{s.unit}</span>
              {/* O nome de quem dá a aula saiu daqui: a marcação é dia, hora e
                  unidade. O campo continua no cadastro do horário, para uso
                  interno — só não acompanha mais cada aula na tela. */}
              <span className="ls-cap">{ativas.length}/{cap}</span>
              <button className="btn ghost sm" onClick={() => open(somenteLeitura ? <TurmaView slotId={s.id} /> : <SlotDetail slotId={s.id} />)}>
                {somenteLeitura ? "Ver turma" : "Gerir turma"}
              </button>
            </div>
            {todas.length ? todas.map((b) => {
              const k = bookingKindDe(data, b);
              return (
                <div className={`ls-al ${b.status === "cancelada" ? "canc" : ""} ${k ? "kinded" : ""} ${somenteLeitura ? "ro" : ""}`} key={b.id}
                  style={k ? { "--kc": k.color } : undefined}
                  onClick={somenteLeitura ? undefined : () => open(<ManageBooking booking={b} />)}>
                  <span className="nm">{b.clientName}</span>
                  <span className="sp">
                    {k && <span className={`badge ${k.cls}`}>{k.ic} {k.label}</span>}
                    {b.attendance === "presente" && <span className="badge b-ok">✓ presente</span>}
                    {b.attendance === "falta" && <span className="badge b-danger">✕ faltou</span>}
                    <StatusBadge status={b.status} />
                  </span>
                </div>
              );
            }) : <div className="ls-vazio">Nenhuma aluna nesse horário ainda.</div>}
          </div>
        );
      })}
    </div>
  ))}</>;
}

/* ============================= MARCAÇÕES ============================= */
export function Marcacoes() {
  const { data } = useStore();
  const { open } = useModal();
  const [tab, setTab] = useState("novos"); // novos | acesso
  const [filter, setFilter] = useState("todas");
  const [mensF, setMensF] = useState("todas");
  const [search, setSearch] = useState("");
  // Semana visível da aba "Novos" — segunda a domingo, como no resto do sistema.
  const [semana, setSemana] = useState(() => weekStart(todayISO()));
  const semanaFim = addDays(semana, 6);
  const semanaAtual = weekStart(todayISO());
  const segs = [["todas", "Todas"], ["ativas", "Ativas"], ["cancelada", "Canceladas"]];
  const comp = compAtual();

  const isNovo = (b) => isNewLead(data, b);
  const novos = data.bookings.filter(isNovo);
  const acessoCount = data.bookings.length - novos.length;
  // O badge da aba conta a SEMANA, não o acervo: é o tamanho do trabalho de agora.
  const novosSemana = novos.filter((b) => b.date >= semana && b.date <= semanaFim).length;

  // Situação da mensalidade do mês da aluna por trás de cada marcação.
  const sitDe = (b) => situacaoMensalidade(data, clientOfBooking(data, b), comp);

  let list = [...data.bookings].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  list = list.filter((b) => (tab === "novos" ? isNovo(b) : !isNovo(b)));
  /* "Novos" é uma caixa de entrada, não um arquivo: são milhares de solicitações
     acumuladas desde sempre, e a Inêz só trabalha as da semana. A navegação por
     semana é a mesma da agenda — ← período → — para não inventar um jeito novo
     de andar no tempo dentro do mesmo sistema.

     Buscar pelo nome escapa da semana de propósito: quem digita um nome está
     procurando uma pessoa, não conferindo a semana, e não faz sentido esconder
     a marcação dela porque caiu em outro período. */
  if (tab === "novos" && !search) list = list.filter((b) => b.date >= semana && b.date <= semanaFim);
  if (filter === "ativas") list = list.filter((b) => b.status !== "cancelada");
  else if (filter === "cancelada") list = list.filter((b) => b.status === "cancelada");
  if (mensF !== "todas") list = list.filter((b) => sitDe(b).estado === mensF);
  if (search) list = list.filter((b) => b.clientName.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="panel">
      <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
        <button className={tab === "novos" ? "on" : ""} onClick={() => setTab("novos")}>🆕 Novos <span className="seg-count">{novosSemana}</span></button>
        <button className={tab === "acesso" ? "on" : ""} onClick={() => setTab("acesso")}>👤 Com acesso <span className="seg-count">{acessoCount}</span></button>
      </div>
      <div className="seg-hint">{tab === "novos"
        ? "Solicitações de quem ainda não tem acesso (sem PIN) ou está na primeira aula — uma semana por vez."
        : "Marcações de alunas que já têm cadastro e acesso ao portal."}</div>

      {tab === "novos" && (
        <div className="ag-toolbar">
          <div className="ag-nav">
            <button className="navbtn" onClick={() => setSemana(addDays(semana, -7))}>←</button>
            <span className="ag-period">{fmtDate(semana)} – {fmtDate(semanaFim)}</span>
            <button className="navbtn" onClick={() => setSemana(addDays(semana, 7))}>→</button>
            {semana !== semanaAtual && <button className="btn ghost sm" onClick={() => setSemana(semanaAtual)}>Semana atual</button>}
          </div>
          <span className="cli-sub">
            {search ? "🔍 busca ativa — mostrando todas as semanas" : `${novosSemana} solicitação(ões) nesta semana`}
          </span>
        </div>
      )}
      <div className="filters">
        <div className="seg">{segs.map((s) => <button key={s[0]} className={filter === s[0] ? "on" : ""} onClick={() => setFilter(s[0])}>{s[1]}</button>)}</div>
        <Select
          compact
          value={mensF}
          onChange={setMensF}
          options={[
            { value: "todas", label: "Mensalidade: todas", icon: "🧾" },
            { value: "atraso", label: "Em atraso", icon: "⚠️" },
            { value: "a_receber", label: "A receber", icon: "⏳" },
            { value: "recebido", label: "Recebido", icon: "✓" },
            { value: "sem_boleto", label: "Sem mensalidade gerada", icon: "📄" },
          ]}
        />
        <input className="grow" placeholder="🔍 Buscar aluno..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {/* A coluna Status saiu em 30/08/2026: aqui é quase tudo "aguardando
          confirmação", e o que a Inêz decide olhando esta lista é a mensalidade.
          O status continua filtrável acima e aparece inteiro no "Gerir". */}
      {list.length ? (
        <table><thead><tr><th>Aluno</th><th>Unidade</th><th>Dia / Hora</th><th>Mensalidade · {compLabel(comp)}</th><th></th></tr></thead><tbody>
          {list.map((b) => {
            /* A aula não tem mais preço próprio: a aluna paga por MÊS. O que
               interessa aqui é como está a mensalidade da competência atual
               dela — recebido, a receber ou em atraso. */
            const cli = clientOfBooking(data, b);
            const sit = situacaoMensalidade(data, cli, comp);
            return (
              <tr key={b.id} style={tab === "novos" ? { background: "rgba(127,194,65,.08)" } : {}}>
                <td className="c-main">
                  <span className="cli-name">{b.clientName}</span>
                  {isNovo(b) && <span className="badge b-terra ml">🆕 Novata</span>}
                  <div className="cli-sub">{b.phone}</div>
                </td>
                <td data-l="Unidade"><span className="chip">{b.unit}</span></td>
                <td data-l="Dia / Hora">{fmtDate(b.date)} · <b>{b.time}</b></td>
                <td data-l="Mensalidade">
                  <span className={`badge ${sit.cls}`} title={sit.inv ? `Vencimento ${fmtDate(sit.inv.dueDate)}` : ""}>{sit.label}</span>
                  {sit.estado === "atraso" && (
                    <div className="cli-sub">{sit.inv.encargos.dias} dia(s) · com multa e juros</div>
                  )}
                  {sit.valor > 0 && <div className="cli-sub">{money(sit.valor)}</div>}
                </td>
                <td className="td-actions">
                  <button className="btn wa sm" title="WhatsApp" onClick={() => openWa(b.phone, `Olá ${b.clientName}! 💚`)}><WaIcon /></button>
                  <button className="btn sec sm" onClick={() => open(<ManageBooking booking={b} />)}>Gerir</button>
                </td>
              </tr>
            );
          })}
        </tbody></table>
      ) : (
        <div className="empty"><div className="ic">📝</div>
          <p>{tab === "novos" ? "Nenhuma solicitação nesta semana." : "Nenhuma marcação nesse filtro."}</p>
          {tab === "novos" && <div className="cli-sub">Use as setas acima para ver outra semana.</div>}
        </div>
      )}
    </div>
  );
}

/* ============================= CLIENTES ============================= */
const initials = (n) => (n || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function Clientes({ params }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const [tab, setTab] = useState(params?.tab === "novato" ? "novato" : params?.tab === "lead" ? "lead" : "cliente"); // cliente | novato | lead
  useEffect(() => { if (params?.tab) setTab(params.tab === "novato" ? "novato" : params.tab === "lead" ? "lead" : "cliente"); }, [params?.tab]);
  const [search, setSearch] = useState("");
  const [unitF, setUnitF] = useState("Todas");
  const [planF, setPlanF] = useState("Todos");
  const [sortBy, setSortBy] = useState("nome");
  // "Aulas" na lista = aulas FEITAS no mês corrente (não o total da vida toda).
  const comp = compAtual();
  const mesOf = (c) => clientMonthClasses(data, c.name, comp);
  const cntOf = (c) => mesOf(c).feitas;

  const groups = { cliente: [], novato: [], lead: [], "ex-aluno": [] };
  data.clients.forEach((c) => {
    const k = classifyClient(data, c);
    (groups[k] || groups.cliente).push(c);
  });

  const TABS = [
    ["cliente", "👩 Alunos", groups.cliente.length, "Alunos com cadastro e aulas ativas."],
    ["novato", "✨ 1ª Aula (Pagas)", groups.novato.length, "Alunos com primeira aula/matrícula confirmada e paga."],
    ["lead", "🎯 Leads (Remarketing)", groups.lead.length, "Contatos que iniciaram cadastro mas não concluíram o pagamento — ideal para remarketing."],
    ["ex-aluno", "👋 Ex-Alunos", groups["ex-aluno"].length, "Alunas inativadas ou com inscrições encerradas. As aulas foram removidas da grade e você pode restaurar tudo a qualquer momento."],
  ];
  const hint = (TABS.find((t) => t[0] === tab) || [])[3];

  const cleanSearch = search.trim();
  const searchDigits = cleanSearch.replace(/\D/g, "");
  let list = (groups[tab] || []).filter((c) => {
    if (cleanSearch) {
      const matchesName = (c.name || "").toLowerCase().includes(cleanSearch.toLowerCase());
      const matchesPhone = (c.phone || "").includes(cleanSearch) || (searchDigits.length > 0 && (c.phone || "").replace(/\D/g, "").includes(searchDigits));
      const clientCpfDigits = (c.cpf || "").replace(/\D/g, "");
      const matchesCpf = (c.cpf || "").includes(cleanSearch) || (searchDigits.length > 0 && clientCpfDigits.includes(searchDigits));
      if (!matchesName && !matchesPhone && !matchesCpf) return false;
    }
    return (unitF === "Todas" || c.unit === unitF) &&
      (planF === "Todos" || (planF === "Mensalistas" ? c.plan === "mensalista" : c.plan !== "mensalista"));
  });
  list = [...list].sort((a, b) => sortBy === "aulas" ? cntOf(b) - cntOf(a) : a.name.localeCompare(b.name));

  const resetPin = async (c) => {
    if (!(await confirmModal({ title: "Resetar PIN", message: `Resetar PIN de ${c.name}? Na próxima entrada ela terá que criar um novo PIN.`, confirmLabel: "Resetar", tone: "danger" }))) return;
    await run(api.resetPin(c.id));
    toast("PIN resetado! A aluna criará um novo no próximo acesso.");
  };

  /* Inativar e reativar dizem, nas duas pontas, o que acontece com a COBRANÇA:
     ex-aluna não gera mensalidade nenhuma, e ao reativar a próxima volta a
     nascer numa data que dá para ler antes de confirmar. Sem isso, a pergunta
     "ela ainda vai ser cobrada?" só se responde olhando a aba Mensalidades. */
  const inativarAluna = async (c) => {
    const prox = proximaCobranca(data, c);
    if (!(await confirmModal({
      title: "Inativar aluna",
      message: `Inativar ${c.name}?\n\n` +
        `• O cadastro será movido para a aba "Ex-Alunos"\n` +
        `• Todas as aulas futuras serão excluídas da grade sem deixar registros\n` +
        `• As mensalidades em aberto serão canceladas\n` +
        (prox
          ? `• Nenhuma mensalidade nova será gerada enquanto ela estiver inativa — ao reativar, a próxima seria a ${fraseProximaCobranca(prox)}\n`
          : `• Nenhuma cobrança nova será gerada enquanto ela estiver inativa\n`) +
        `\nVocê poderá reverter a qualquer momento usando Ctrl+Z ou clicando em "Restaurar" na aba Ex-Alunos.`,
      confirmLabel: "Inativar e limpar grade",
      tone: "danger"
    }))) return;
    const res = await run(api.updateClient(c.id, { status: "cancelado" }));
    toast(`Aluna ${c.name} inativada e movida para Ex-Alunos — sem cobrança nova até reativar. ↩️ (Ctrl+Z para desfazer)`, "info");
  };

  const reativar = async (c) => {
    const prox = proximaCobranca(data, c);
    if (!(await confirmModal({
      title: "Restaurar aluna",
      message: `Reativar ${c.name}?\n\n` +
        `• O cadastro voltará para a lista de alunos ativos\n` +
        `• As aulas agendadas serão restauradas na grade da agenda\n` +
        (prox ? `• A cobrança volta: ${fraseProximaCobranca(prox)}\n` : ""),
      confirmLabel: "Restaurar aluna",
      tone: "ok"
    }))) return;
    const res = await run(api.reativarClient(c.id));
    toast(res?.message || `${c.name} reativada com sucesso!`, "success");
  };

  const delClientDefinitivo = async (c) => {
    if (!(await confirmModal({
      title: "Excluir cadastro definitivamente",
      message: `Excluir definitivamente o cadastro de ${c.name}?\n\nEsta ação apagará o cadastro do banco de dados. (Se excluir por engano, você ainda poderá usar Ctrl+Z logo em seguida para desfazer).`,
      confirmLabel: "Excluir definitivamente",
      tone: "danger"
    }))) return;
    await run(api.deleteClient(c.id));
    toast(`Cadastro de ${c.name} excluído. ↩️ (Ctrl+Z para desfazer)`);
  };

  const waMsg = (c) => tab === "lead"
    ? `Olá ${c.name}! Tudo bem? 💚 Vi que você demonstrou interesse nas nossas aulas de crochê da Fios que Curam. Ficou alguma dúvida sobre os horários ou valores? Posso te ajudar a garantir sua vaga!`
    : tab === "novato"
    ? `Olá ${c.name}! Que alegria ter você na sua primeira aula de crochê 💚 Qualquer dúvida, é só chamar!`
    : tab === "ex-aluno"
    ? `Olá ${c.name}! 💚 Sentimos sua falta aqui nas aulas de crochê da Fios que Curam! Que tal voltar a crochetar com a gente? Tenho novos horários disponíveis para você.`
    : `Olá ${c.name}! 💚`;

  const emptyLabel = {
    cliente: "Nenhum aluno encontrado.",
    novato: "Nenhum aluno na primeira aula.",
    lead: "Nenhum lead pendente de remarketing.",
    "ex-aluno": "Nenhuma ex-aluna registrada.",
  }[tab];

  return (
    <div className="panel">
      <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
        {TABS.map((t) => <button key={t[0]} className={tab === t[0] ? "on" : ""} onClick={() => setTab(t[0])}>{t[1]} <span className="seg-count">{t[2]}</span></button>)}
      </div>
      <div className="seg-hint">{hint}</div>
      <div className="filters">
        <input className="grow" placeholder="🔍 Buscar por nome, CPF ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select
          compact
          value={unitF}
          onChange={setUnitF}
          options={[
            { value: "Todas", label: "Todas as unidades", icon: "📍" },
            ...data.meta.units.map((u) => ({ value: u, label: u, icon: "📍" })),
          ]}
        />
        <Select
          compact
          value={planF}
          onChange={setPlanF}
          options={[
            { value: "Todos", label: "Todos os planos", icon: "🧶" },
            { value: "Mensalistas", label: "Mensalistas", icon: "📅" },
            { value: "Avulsos", label: "Avulsos", icon: "🧺" },
          ]}
        />
        <Select
          compact
          value={sortBy}
          onChange={setSortBy}
          options={[
            { value: "nome", label: "Ordenar: Nome", icon: "🔤" },
            { value: "aulas", label: "Ordenar: Mais aulas no mês", icon: "📈" },
          ]}
        />
        <span className="count">{list.length} de {groups[tab].length}</span>
      </div>
      {list.length ? (
        <table>
          <thead>
            <tr>
              <th>Aluno</th>
              <th>Unidade</th>
              <th title={tab === "ex-aluno" ? "Total de presenças registradas no histórico" : `Aulas feitas em ${compLabel(comp)}`}>
                {tab === "ex-aluno" ? "Aulas no histórico" : "Aulas no mês"}
              </th>
              <th>{tab === "ex-aluno" ? "Situação" : "Presença"}</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const mes = mesOf(c);
              const at = clientAttendance(data, c.name);
              return (
                <tr key={c.id} style={tab === "novato" ? { background: "rgba(194,113,79,.06)" } : tab === "ex-aluno" ? { opacity: 0.9 } : {}}>
                  <td className="c-main">
                    <div className="cli-row row-click" onClick={() => open(<ClientProfile client={c} />)}>
                      <span className="cli-av">{initials(c.name)}</span>
                      <div>
                        <span className="cli-name">{c.name}</span>
                        {tab === "ex-aluno" || c.status === "cancelado" ? <span className="badge b-danger ml">Inativa</span> : null}
                        {c.plan === "mensalista" && c.status !== "cancelado" ? <span className="badge b-ok ml">📅 {c.weeklyFreq ? `${c.weeklyFreq}x/semana` : "mensalista"}</span> : null}
                        {c.plan === "avulso" && c.status !== "cancelado" ? <span className="badge ml" style={{ background: "rgba(180, 83, 9, 0.12)", color: "#b45309", border: "1px solid rgba(180, 83, 9, 0.3)" }}>🧺 AULA AVULSA</span> : null}
                        {c.matriculaStatus === "paga" && c.plan !== "mensalista" && c.status !== "cancelado" ? <span className="badge b-warn ml">🎟️ matrícula a concluir</span> : null}
                        {tab === "novato" ? <span className="badge b-terra ml">✨ 1ª aula</span> : null}
                        {(tab === "lead" || c.status === "lead") ? <span className="badge b-warn ml" style={{ background: "#fff3cd", color: "#856404", border: "1px solid #ffeeba" }}>⚠️ Pagamento não realizado</span> : null}
                        {c.origem === "whatsapp" ? <span className="badge b-info ml" title="Cadastro feito pela própria aluna na conversa do WhatsApp — confira os dados">💬 Cadastro via WhatsApp</span> : null}
                        <div className="cli-sub">{c.phone || "sem telefone"}{c.birthday ? " · 🎂 " + fmtDate(c.birthday) : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td data-l="Unidade"><span className="chip">{c.unit}</span></td>
                  <td data-l={tab === "ex-aluno" ? "Aulas no histórico" : "Aulas no mês"}>
                    {tab === "ex-aluno" ? (
                      <b style={{ color: at.pres ? "var(--terracota)" : "var(--muted)" }}>{at.pres} aula(s) feita(s)</b>
                    ) : (
                      <>
                        <b style={{ color: mes.feitas ? "var(--terracota)" : "var(--muted)" }}>{mes.feitas}</b>
                        {mes.futuras ? <span className="cli-sub"> +{mes.futuras} agendada(s)</span> : null}
                      </>
                    )}
                  </td>
                  <td data-l={tab === "ex-aluno" ? "Situação" : "Presença"}>
                    {tab === "ex-aluno" ? (
                      <span className="badge b-muted">Inscrição encerrada</span>
                    ) : (
                      <>
                        <span className="badge b-ok" title="Presenças">✓ {at.pres}</span>
                        {at.falt ? <> <span className="badge b-danger" title="Faltas">✕ {at.falt}</span></> : null}
                      </>
                    )}
                  </td>
                  <td className="td-actions">
                    <button className="btn wa sm" title="WhatsApp" onClick={() => openWa(c.phone, waMsg(c))}><WaIcon /></button>
                    {tab === "ex-aluno" ? (
                      <>
                        <button className="btn ok sm" title="Restaurar aluna e suas aulas salvas na grade" onClick={() => reativar(c)}>
                          🔄 Restaurar
                        </button>
                        <button className="btn sec sm" onClick={() => open(<ClientProfile client={c} initialTab="editar" />)}>
                          Editar
                        </button>
                        <button className="btn ghost sm" style={{ color: "var(--danger)" }} title="Excluir cadastro definitivamente" onClick={() => delClientDefinitivo(c)}>
                          🗑
                        </button>
                      </>
                    ) : (
                      <>
                        {tab === "lead" && (
                          <button
                            className="btn sm"
                            title="Dar baixa no pagamento da 1ª aula / matrícula"
                            onClick={() => open(<BaixarLeadModal client={c} />)}
                          >
                            ✓ Baixar
                          </button>
                        )}
                        {c.hasPin && <button className="btn sec sm" onClick={() => resetPin(c)}>🔒 Resetar PIN</button>}
                        <button className="btn sec sm" onClick={() => open(<ClientProfile client={c} initialTab="editar" />)}>Editar</button>
                        <button className="btn ghost sm" style={{ color: "var(--danger)" }} title="Inativar aluna (limpar grade e mover para Ex-Alunos)" onClick={() => inativarAluna(c)}>
                          🚫 Inativar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <div className="empty"><div className="ic">{tab === "novato" ? "✨" : tab === "ex-aluno" ? "👋" : tab === "lead" ? "🎯" : "👩"}</div><p>{emptyLabel}</p></div>}
    </div>
  );
}

/* ============================= FINANCEIRO (mensalidades, cobranças e fluxo) ============================= */

// Gráfico de barras nativo (sem dependência externa)
function BarChart({ series, color = "var(--sage-deep)" }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  const total = series.reduce((a, s) => a + s.value, 0);
  return (
    <div className="chart">
      <div className="chart-bars">
        {series.map((s, i) => {
          const pct = Math.round((s.value / max) * 100);
          return (
            <div className="bar" key={i} title={`${s.full || s.label}: ${money(s.value)}`}>
              <span className="bar-val">{s.value ? money(s.value).replace("R$ ", "") : ""}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ height: `${s.value ? Math.max(pct, 3) : 0}%`, background: color }} />
              </div>
              <span className="bar-label">{s.label}</span>
            </div>
          );
        })}
      </div>
      {total === 0 && <div className="chart-empty">Sem recebimentos neste período.</div>}
    </div>
  );
}

/* ----------------- ABA 1: OPERAÇÃO DO MÊS (mensalidades e cobranças) ----------------- */
function FinanceiroOperacao() {
  const { data, run } = useStore();
  const { open } = useModal();
  const [comp, setComp] = useState(compAtual());
  const [busy, setBusy] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState("todos"); // "todos" | "atraso" | "aberto" | "pago" | "semBoleto"
  const [search, setSearch] = useState("");

  const atual = compAtual();
  const ehMesAtual = comp === atual;

  // Alunas mensalistas que já estavam matriculadas nessa competência.
  // Inativas só entram se tiverem mensalidade paga no mês (registro histórico de quitação).
  const mensalistas = data.clients
    .filter((c) => c.plan === "mensalista")
    .filter((c) => c.status !== "cancelado" || (data.invoices || []).some((i) => i.clientId === c.id && i.competencia === comp && i.status === "pago"))
    .filter((c) => { const ini = matriculaISO(c); return !ini || ini.slice(0, 7) <= comp; })
    .sort((a, b) => a.name.localeCompare(b.name));

  const invOf = (c) => (data.invoices || []).find((i) => i.clientId === c.id && i.competencia === comp);
  const valorDe = (c) => mensalidadeDaComp(c, comp, data.meta, data.precos);
  const vencDe = (c) => Math.min(28, Math.max(1, c.billingDay || data.meta.vencimentoDia || 10));

  const gerar = async (c) => {
    setBusy(true);
    try { await run(api.gerarMensalidade(c.id, comp)); }
    finally { setBusy(false); }
  };

  const gerarTodos = async () => {
    const ativas = mensalistas.filter((c) => c.status !== "cancelado").length;
    if (!(await confirmModal({
      title: "Gerar mensalidades",
      message: `Gerar os boletos de ${compLabel(comp)} para os ${ativas} mensalistas ativos?`,
      confirmLabel: "Gerar",
    }))) return;
    setBusy(true);
    try {
      const r = await run(api.gerarMensalidadesMes());
      toast(`${r?.geradas ?? 0} boleto(s) gerado(s)/reaproveitado(s).`, "success");
    } finally { setBusy(false); }
  };

  const marcarPago = async (c, inv) => {
    setBusy(true);
    try { await baixarMensalidade(inv, run, c.name, data.invoices); }
    finally { setBusy(false); }
  };

  const copyPix = (code) => {
    navigator.clipboard.writeText(code);
    toast("Código Pix copiado! 📋", "success");
  };

  const reemitir = async (inv) => {
    setBusy(true);
    try {
      const r = await run(api.reemitirPix(inv.id));
      if (r?.pixCode) {
        navigator.clipboard.writeText(r.pixCode);
        toast("Pix atualizado e copiado! 📋", "success");
      } else {
        toast("Pix gerado.", "success");
      }
    } finally { setBusy(false); }
  };

  const msgCobranca = (c, inv) => {
    const e = inv.encargos;
    const primeiro = (c.name || "").split(" ")[0];
    const linhas = [
      `Olá ${primeiro}! 💚 Passando para lembrar da sua mensalidade de ${compLabel(inv.competencia)}, aqui na Fios que Curam.`,
      "",
      `Vencimento: ${fmtDate(inv.dueDate)}`,
    ];
    if (e && e.atrasada) {
      linhas.push(
        `Está em atraso há ${e.dias} ${e.dias === 1 ? "dia" : "dias"}.`,
        "",
        `Mensalidade: ${money(inv.amountCents / 100)}`,
        `Multa: ${money(e.multa)}`,
        `Juros (${e.dias} ${e.dias === 1 ? "dia" : "dias"}): ${money(e.juros)}`,
        `*Total: ${money(e.total)}*`,
      );
    } else {
      linhas.push("", `*Valor: ${money(inv.amountCents / 100)}*`);
    }
    if (inv.pixCode && inv.pixAtualizado !== false) {
      linhas.push("", "Segue o Pix copia-e-cola:", inv.pixCode);
    } else {
      linhas.push("", "Me avisa por aqui que eu te mando o Pix atualizado. 💚");
    }
    linhas.push("", "Qualquer dúvida, é só responder por aqui!");
    return linhas.join("\n");
  };

  const cobrarNoWa = (c, inv) => {
    if (!(c.phone || "").replace(/\D/g, "")) return toast(`${c.name} não tem telefone no cadastro.`, "error");
    openWa(c.phone, msgCobranca(c, inv));
  };

  // Cálculos do fechamento da competência
  const invs = mensalistas.map(invOf);
  const pagosArr = invs.filter((i) => i && i.status === "pago");
  const pendArr = invs.filter((i) => i && i.status === "pendente");
  const emAtrasoArr = pendArr.filter((i) => i.encargos && i.encargos.atrasada);
  const noPrazoArr = pendArr.filter((i) => !i.encargos || !i.encargos.atrasada);
  const semBoleto = invs.filter((i) => !i).length;

  const recebido = pagosArr.reduce((s, i) => s + i.amountCents / 100, 0);
  const aReceber = noPrazoArr.reduce((s, i) => s + (i.amountCents / 100), 0);
  const emAtrasoTotal = emAtrasoArr.reduce((s, i) => s + (i.encargos ? i.encargos.total : i.amountCents / 100), 0);
  const previsto = mensalistas.reduce((s, c) => { const i = invOf(c); return s + (i ? i.amountCents / 100 : valorDe(c)); }, 0);
  const emitido = recebido + aReceber + emAtrasoTotal;
  const pctRecebido = emitido ? Math.round((recebido / emitido) * 100) : 0;

  // Filtragem da lista
  const cleanSearch = search.trim();
  const searchDigits = cleanSearch.replace(/\D/g, "");
  const mensalistasFiltrados = mensalistas.filter((c) => {
    if (cleanSearch) {
      const matchesName = (c.name || "").toLowerCase().includes(cleanSearch.toLowerCase());
      const matchesPhone = (c.phone || "").includes(cleanSearch) || (searchDigits.length > 0 && (c.phone || "").replace(/\D/g, "").includes(searchDigits));
      const clientCpfDigits = (c.cpf || "").replace(/\D/g, "");
      const matchesCpf = (c.cpf || "").includes(cleanSearch) || (searchDigits.length > 0 && clientCpfDigits.includes(searchDigits));
      if (!matchesName && !matchesPhone && !matchesCpf) return false;
    }
    if (filtroStatus === "todos") return true;
    const inv = invOf(c);
    if (filtroStatus === "semBoleto") return !inv;
    if (!inv) return false;
    if (filtroStatus === "pago") return inv.status === "pago";
    if (filtroStatus === "atraso") return inv.status === "pendente" && !!inv.encargos?.atrasada;
    if (filtroStatus === "aberto") return inv.status === "pendente" && !inv.encargos?.atrasada;
    return true;
  });

  return (
    <div className="panel">
      {/* Navegação de competência + Ação em lote */}
      <div className="ag-toolbar">
        <div className="ag-nav">
          <button className="navbtn" onClick={() => setComp(addComp(comp, -1))}>←</button>
          <span className="ag-period">{compLabel(comp)}</span>
          <button className="navbtn" onClick={() => setComp(addComp(comp, 1))} disabled={comp >= atual}>→</button>
          {!ehMesAtual && <button className="btn ghost sm" onClick={() => setComp(atual)}>Mês atual</button>}
        </div>
        <button
          className="btn"
          disabled={busy || !mensalistas.length || !ehMesAtual}
          title={ehMesAtual ? "" : "Boletos só são gerados para o mês atual"}
          onClick={gerarTodos}
        >
          🧾 Gerar boletos do mês
        </button>
      </div>

      {/* Cards de Métricas da Competência com Filtro Interativo */}
      <div className="fch-tot" style={{ marginTop: "1rem" }}>
        <div
          className="fch-card"
          style={{
            cursor: "pointer",
            outline: filtroStatus === "pago" ? "2px solid var(--ok)" : "none",
            background: filtroStatus === "pago" ? "rgba(46,125,50,0.06)" : undefined,
          }}
          title="Clique para filtrar apenas mensalidades recebidas"
          onClick={() => setFiltroStatus(filtroStatus === "pago" ? "todos" : "pago")}
        >
          <div className="l">✓ Recebido</div>
          <div className="v">{money(recebido)}</div>
          <div className="cli-sub">{pagosArr.length} pago(s) · {pctRecebido}% do emitido</div>
        </div>

        <div
          className="fch-card"
          style={{
            cursor: "pointer",
            outline: filtroStatus === "aberto" ? "2px solid var(--warn)" : "none",
            background: filtroStatus === "aberto" ? "rgba(217,119,6,0.06)" : undefined,
          }}
          title="Clique para filtrar mensalidades a receber no prazo"
          onClick={() => setFiltroStatus(filtroStatus === "aberto" ? "todos" : "aberto")}
        >
          <div className="l">⏳ A receber</div>
          <div className="v warn">{money(aReceber)}</div>
          <div className="cli-sub">{noPrazoArr.length} dentro do prazo</div>
        </div>

        <div
          className="fch-card"
          style={{
            cursor: "pointer",
            outline: filtroStatus === "atraso" ? "2px solid var(--danger)" : "none",
            background: filtroStatus === "atraso" ? "rgba(220,53,69,0.06)" : undefined,
          }}
          title="Clique para filtrar apenas cobranças em atraso"
          onClick={() => setFiltroStatus(filtroStatus === "atraso" ? "todos" : "atraso")}
        >
          <div className="l">⚠️ Em atraso</div>
          <div className="v" style={{ color: "var(--danger)" }}>{money(emAtrasoTotal)}</div>
          <div className="cli-sub">{emAtrasoArr.length} vencida(s){emAtrasoArr.length ? " · com encargos" : ""}</div>
        </div>

        <div
          className="fch-card"
          style={{
            cursor: "pointer",
            outline: filtroStatus === "semBoleto" ? "2px solid var(--terracota)" : "none",
            background: filtroStatus === "semBoleto" ? "rgba(199,92,62,0.06)" : undefined,
          }}
          title="Clique para filtrar alunas sem boleto emitido"
          onClick={() => setFiltroStatus(filtroStatus === "semBoleto" ? "todos" : "semBoleto")}
        >
          <div className="l">📄 Sem boleto</div>
          <div className="v terra">{semBoleto}</div>
          <div className="cli-sub">de {mensalistas.length} aluno(s)</div>
        </div>

        <div
          className="fch-card"
          style={{
            cursor: "pointer",
            outline: filtroStatus === "todos" && !cleanSearch ? "2px solid var(--line)" : "none",
          }}
          title="Clique para ver a lista completa"
          onClick={() => setFiltroStatus("todos")}
        >
          <div className="l">📊 Previsto no mês</div>
          <div className="v">{money(previsto)}</div>
          <div className="cli-sub">{previsto ? Math.round((recebido / previsto) * 100) : 0}% fechado</div>
        </div>
      </div>

      {/* Barra de composição visual do mês */}
      {emitido > 0 && (
        <div
          style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", margin: ".3rem 0 1rem", background: "var(--line)" }}
          title={`Recebido ${money(recebido)} · A receber ${money(aReceber)} · Em atraso ${money(emAtrasoTotal)}`}
        >
          <div style={{ width: `${(recebido / emitido) * 100}%`, background: "var(--ok)" }} />
          <div style={{ width: `${(aReceber / emitido) * 100}%`, background: "var(--warn)" }} />
          <div style={{ width: `${(emAtrasoTotal / emitido) * 100}%`, background: "var(--danger)" }} />
        </div>
      )}

      {/* Filtros rápidos e busca */}
      <div className="filters" style={{ margin: "1rem 0", display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center" }}>
        <input
          className="grow"
          placeholder="🔍 Buscar mensalista por nome, CPF ou telefone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && <button className="btn ghost sm" onClick={() => setSearch("")}>Limpar busca</button>}

        <div style={{ display: "flex", gap: ".3rem", flexWrap: "wrap" }}>
          <button className={`btn sm ${filtroStatus === "todos" ? "" : "ghost"}`} onClick={() => setFiltroStatus("todos")}>
            Todos ({mensalistas.length})
          </button>
          <button className={`btn sm ${filtroStatus === "atraso" ? "" : "ghost"}`} style={filtroStatus === "atraso" ? { background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" } : { color: "var(--danger)" }} onClick={() => setFiltroStatus("atraso")}>
            ⚠️ Atraso ({emAtrasoArr.length})
          </button>
          <button className={`btn sm ${filtroStatus === "aberto" ? "" : "ghost"}`} style={filtroStatus === "aberto" ? { background: "var(--warn)", color: "#fff", borderColor: "var(--warn)" } : { color: "var(--warn)" }} onClick={() => setFiltroStatus("aberto")}>
            ⏳ No prazo ({noPrazoArr.length})
          </button>
          <button className={`btn sm ${filtroStatus === "pago" ? "" : "ghost"}`} style={filtroStatus === "pago" ? { background: "var(--ok)", color: "#fff", borderColor: "var(--ok)" } : { color: "var(--ok)" }} onClick={() => setFiltroStatus("pago")}>
            ✓ Pago ({pagosArr.length})
          </button>
          <button className={`btn sm ${filtroStatus === "semBoleto" ? "" : "ghost"}`} style={filtroStatus === "semBoleto" ? { background: "var(--terracota)", color: "#fff", borderColor: "var(--terracota)" } : { color: "var(--terracota)" }} onClick={() => setFiltroStatus("semBoleto")}>
            📄 Sem boleto ({semBoleto})
          </button>
        </div>

        <span className="count">{mensalistasFiltrados.length} de {mensalistas.length}</span>
      </div>

      {!ehMesAtual && (
        <div className="seg-hint">
          📅 Mês fechado — os boletos são gerados apenas para o mês atual. Meses anteriores sem boleto aparecem como “não gerado”.
        </div>
      )}

      {/* Tabela de mensalistas da competência */}
      {mensalistasFiltrados.length ? (
        <table>
          <thead>
            <tr>
              <th>Aluno</th>
              <th>Mensalidade</th>
              <th>Vencimento</th>
              <th>Status do mês</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mensalistasFiltrados.map((c) => {
              const inv = invOf(c);
              return (
                <tr key={c.id}>
                  <td className="c-main">
                    <div className="cli-row row-click" onClick={() => open(<ClientProfile client={c} />)}>
                      <span className="cli-av">{initials(c.name)}</span>
                      <div>
                        <span className="cli-name">{c.name}</span>
                        <div className="cli-sub">
                          {c.unit}
                          {c.cpf ? "" : " · ⚠ sem CPF"}
                          {c.status === "cancelado" ? " · 🚫 inativa" : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td data-l="Mensalidade">
                    {money(inv ? inv.amountCents / 100 : valorDe(c))}
                    {(() => {
                      const combinado = precoDaComp(data.precos, c.id, comp);
                      if (combinado) return (
                        <span className="cli-sub" title={combinado.motivo || `Valor combinado só para ${compLabel(comp)} — o normal dela é ${money(mensalidadeDe(c, data.meta))}`}>
                          {" "}{combinado.origem === "promocao" ? "🎁 promoção" : "🎁 desconto"}
                        </span>
                      );
                      if (c.monthlyValue != null) return <span className="cli-sub"> (individual)</span>;
                      return null;
                    })()}
                    {inv?.encargos?.atrasada && (
                      <div className="cli-sub" title={`Multa ${money(inv.encargos.multa)} + juros ${money(inv.encargos.juros)} (${inv.encargos.dias} dia(s))`}>
                        + encargos = <b style={{ color: "var(--danger)" }}>{money(inv.encargos.total)}</b>
                      </div>
                    )}
                  </td>
                  <td data-l="Vencimento">
                    {inv ? (
                      inv.status === "pendente" ? (
                        <span
                          className="row-click"
                          style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted" }}
                          title="Clique para alterar a data de vencimento deste boleto"
                          onClick={() => open(<AlterarVencimentoModal invoice={inv} clientName={c.name} />)}
                        >
                          {fmtDate(inv.dueDate)} ✏️
                        </span>
                      ) : (
                        fmtDate(inv.dueDate)
                      )
                    ) : (
                      "dia " + vencDe(c)
                    )}
                    {inv?.status === "pago" && inv.paidAt ? (
                      <div className="cli-sub">pago em {fmtDate(String(inv.paidAt).slice(0, 10))}</div>
                    ) : null}
                  </td>
                  <td data-l="Status do mês">
                    {!inv ? (
                      <span className="badge b-muted">não gerado</span>
                    ) : inv.status === "pago" ? (
                      <span className="badge b-ok" title={inv.baixaManual ? "Baixa dada no painel — recebido por fora do Pix" : "Confirmado pelo Sicredi"}>
                        ✓ pago{inv.paidAt ? " em " + fmtDate(String(inv.paidAt).slice(0, 10)) : ""}{inv.baixaManual ? " · baixa manual" : ""}
                      </span>
                    ) : inv.status === "cancelado" ? (
                      <span className="badge b-danger">cancelado</span>
                    ) : inv.encargos?.atrasada ? (
                      <span className="badge b-danger">⚠️ em atraso há {inv.encargos.dias} dia(s)</span>
                    ) : (
                      <span className="badge b-warn">⏳ pendente · vence {fmtDate(inv.dueDate)}</span>
                    )}
                  </td>
                  <td className="td-actions">
                    <button
                      className="btn ghost sm"
                      title="Alterar o valor da mensalidade"
                      onClick={() => open(<AlterarMensalidade client={c} compInicial={comp} />)}
                    >
                      💰
                    </button>

                    {!inv && ehMesAtual && (
                      c.status === "cancelado" ? (
                        <span className="badge b-muted" title="Inscrição inativa: reative a aluna na aba Ex-Alunos para voltar a gerar mensalidade.">
                          🚫 inativa · sem cobrança
                        </span>
                      ) : (
                        <button className="btn sm" disabled={busy} onClick={() => gerar(c)}>
                          🧾 Gerar boleto
                        </button>
                      )
                    )}

                    {inv && inv.status === "pendente" && (
                      <>
                        <button
                          className="btn wa sm"
                          title={inv.encargos?.atrasada ? "Cobrar no WhatsApp da aluna" : "Lembrar no WhatsApp da aluna"}
                          onClick={() => cobrarNoWa(c, inv)}
                        >
                          <WaIcon /> {inv.encargos?.atrasada ? "Cobrar" : "Lembrar"}
                        </button>
                        {inv.boletoUrl && (
                          <a className="btn sec sm" href={inv.boletoUrl} target="_blank" rel="noreferrer">
                            📄 Boleto
                          </a>
                        )}
                        {inv.pixCode ? (
                          <button className="btn sec sm" onClick={() => copyPix(inv.pixCode)} title="Copiar código Pix">
                            💠 Pix
                          </button>
                        ) : (
                          <button className="btn sec sm" disabled={busy} onClick={() => reemitir(inv)} title="Gerar código Pix desta mensalidade">
                            💠 Gerar Pix
                          </button>
                        )}
                        <button className="btn sm" disabled={busy} onClick={() => marcarPago(c, inv)}>
                          ✓ Baixar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="empty">
          <div className="ic">📅</div>
          <p>{search || filtroStatus !== "todos" ? "Nenhum mensalista encontrado para este filtro." : "Nenhum mensalista nessa competência."}</p>
        </div>
      )}
    </div>
  );
}

/* ----------------- ABA 2: MÉTRICAS & FLUXO (gráficos e histórico) ----------------- */
function FinanceiroMetricas() {
  const { data } = useStore();
  const { open } = useModal();
  const [histSearch, setHistSearch] = useState("");
  const month = compAtual();

  const cliOf = (i) => data.clients.find((c) => c.id === i.clientId);
  const invs = (data.invoices || []).filter((i) => i.status !== "cancelado");
  const valorHoje = (i) => (i.encargos ? i.encargos.total : i.amountCents / 100);
  const diaPgto = (i) => String(i.paidAt || "").slice(0, 10);

  const pagos = invs
    .filter((i) => i.status === "pago")
    .map((i) => ({ ...i, cli: cliOf(i) }))
    .sort((a, b) => diaPgto(b).localeCompare(diaPgto(a)));

  const pend = invs.filter((i) => i.status === "pendente" && i.competencia === month);
  const atrasadas = pend.filter((i) => i.encargos?.atrasada).length;

  const recMes = pagos.filter((i) => diaPgto(i).slice(0, 7) === month).reduce((a, i) => a + i.amountCents / 100, 0);
  const totalPend = pend.reduce((a, i) => a + valorHoje(i), 0);
  const recTotal = pagos.reduce((a, i) => a + i.amountCents / 100, 0);
  const ticket = pagos.length ? recTotal / pagos.length : 0;

  const sumBetween = (fromISO, toISO) => pagos
    .filter((i) => { const d = diaPgto(i); return d >= fromISO && d <= toISO; })
    .reduce((a, i) => a + i.amountCents / 100, 0);

  const t = todayISO();
  // Por dia (últimos 14 dias)
  const porDia = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(t, -(13 - i));
    return { label: fmtDate(d), full: fmtDateLong(d), value: sumBetween(d, d) };
  });
  // Por semana (últimas 8 semanas)
  const wkStart = weekStart(t);
  const porSemana = Array.from({ length: 8 }, (_, i) => {
    const s = addDays(wkStart, -7 * (7 - i));
    const e = addDays(s, 6);
    return { label: fmtDate(s), full: `Semana de ${fmtDate(s)} a ${fmtDate(e)}`, value: sumBetween(s, e) };
  });
  // Por mês (últimos 6 meses)
  const now = new Date(t + "T00:00");
  const porMes = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const from = d.toISOString().slice(0, 10);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    return {
      label: capitalize(d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")),
      full: capitalize(d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })),
      value: sumBetween(from, to),
    };
  });

  // Filtragem do histórico
  const cleanHist = histSearch.trim().toLowerCase();
  const pagosFiltrados = pagos.filter((i) => {
    if (!cleanHist) return true;
    const nome = (i.cli?.name || "").toLowerCase();
    const unidade = (i.cli?.unit || "").toLowerCase();
    const compNome = compLabel(i.competencia).toLowerCase();
    return nome.includes(cleanHist) || unidade.includes(cleanHist) || compNome.includes(cleanHist);
  });

  return (
    <>
      <div className="grid stats" style={{ marginBottom: "1.2rem" }}>
        <div className="card stat">
          <div className="lbl">💰 Recebido no mês</div>
          <div className="val">{money(recMes)}</div>
          <div className="foot">{compLabel(month)}</div>
        </div>
        <div className="card stat" title={`Mensalidades de ${compLabel(month)} ainda em aberto, com multa e juros das vencidas.`}>
          <div className="lbl">⏳ A receber no mês</div>
          <div className="val warn">{money(totalPend)}</div>
          <div className="foot">{pend.length} mensalidade(s) · {compLabel(month)}</div>
          {atrasadas ? <div className="cli-sub" style={{ fontSize: ".68rem" }}>{atrasadas} em atraso · com encargos</div> : null}
        </div>
        <div className="card stat">
          <div className="lbl">📈 Recebido total</div>
          <div className="val terra">{money(recTotal)}</div>
          <div className="foot">{pagos.length} mensalidade(s) paga(s)</div>
        </div>
        <div className="card stat">
          <div className="lbl">🎟️ Ticket médio</div>
          <div className="val">{money(ticket)}</div>
          <div className="foot">por mensalidade paga</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: "1.2rem" }}>
        <div className="panel-h">
          <h2>📅 Recebido por dia <span className="muted-note">· últimos 14 dias</span></h2>
        </div>
        <BarChart series={porDia} color="var(--sage-deep)" />
      </div>

      <div className="dash-cols" style={{ marginBottom: "1.2rem" }}>
        <div className="panel">
          <div className="panel-h">
            <h2>📆 Por semana <span className="muted-note">· 8 semanas</span></h2>
          </div>
          <BarChart series={porSemana} color="var(--terracota)" />
        </div>
        <div className="panel">
          <div className="panel-h">
            <h2>🗓 Por mês <span className="muted-note">· 6 meses</span></h2>
          </div>
          <BarChart series={porMes} color="var(--green-deep)" />
        </div>
      </div>

      <div className="panel">
        <div className="panel-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: ".8rem" }}>
          <div>
            <h2>✅ Recebimentos confirmados</h2>
            <span className="cli-sub">{pagos.length} registro(s) histórico(s)</span>
          </div>
          <input
            style={{ maxWidth: 300 }}
            placeholder="🔍 Filtrar por aluno ou unidade..."
            value={histSearch}
            onChange={(e) => setHistSearch(e.target.value)}
          />
        </div>

        {pagosFiltrados.length ? (
          <table>
            <thead>
              <tr>
                <th>Aluno</th>
                <th>Unidade</th>
                <th>Competência</th>
                <th>Vencimento</th>
                <th>Data pgto.</th>
                <th>Valor</th>
                <th>Origem</th>
              </tr>
            </thead>
            <tbody>
              {pagosFiltrados.map((i) => (
                <tr key={i.id}>
                  <td className="cli-name c-main">
                    {i.cli ? (
                      <span className="row-click" onClick={() => open(<ClientProfile client={i.cli} />)}>
                        {i.cli.name}
                      </span>
                    ) : (
                      `aluno #${i.clientId}`
                    )}
                  </td>
                  <td data-l="Unidade">{i.cli?.unit ? <span className="chip">{i.cli.unit}</span> : "—"}</td>
                  <td data-l="Competência"><span className="badge b-sage">{compLabel(i.competencia)}</span></td>
                  <td data-l="Vencimento">{i.dueDate ? fmtDate(i.dueDate) : "—"}</td>
                  <td data-l="Data pgto.">{diaPgto(i) ? fmtDate(diaPgto(i)) : "—"}</td>
                  <td data-l="Valor"><b>{money(i.amountCents / 100)}</b></td>
                  <td data-l="Origem">
                    {i.baixaManual ? (
                      <span className="badge b-warn" title="Baixa manual registrada no painel">baixa manual</span>
                    ) : (
                      <span className="badge b-ok" title="Recebido via Pix Sicredi">Pix Sicredi</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            <div className="ic">💰</div>
            <p>{histSearch ? "Nenhum pagamento encontrado para este filtro." : "Nenhuma mensalidade paga ainda."}</p>
          </div>
        )}
      </div>
    </>
  );
}

/* ----------------- COMPONENTE PRINCIPAL FINANCEIRO ----------------- */
export function Financeiro({ go, params }) {
  const [tab, setTab] = useState(params?.tab || "operacao");

  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);

  return (
    <>
      <div className="seg seg-tabs" style={{ marginBottom: "1.2rem" }}>
        <button className={tab === "operacao" ? "on" : ""} onClick={() => setTab("operacao")}>
          📋 Operação do Mês
        </button>
        <button className={tab === "metricas" ? "on" : ""} onClick={() => setTab("metricas")}>
          📊 Métricas & Fluxo
        </button>
      </div>

      {tab === "operacao" ? <FinanceiroOperacao /> : <FinanceiroMetricas />}
    </>
  );
}

// Aliases para compatibilidade reversa
export const Mensalistas = Financeiro;
export const Recebimentos = Financeiro;

/* ===================== DEPOIMENTOS ===================== */
const EMPTY_FORM = { name: "", role: "", text: "", active: true, order: 0 };

export function Depoimentos() {
  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | testimonial object
  const [form, setForm]       = useState(EMPTY_FORM);
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState("");
  const fileRef               = useRef();
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const load = async () => {
    setLoading(true);
    try { setList(await api.testimonials.list()); }
    catch (e) { flash("Erro ao carregar: " + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setPhotoFile(null);
    setPhotoPreview(null);
    setEditing("new");
  };

  const openEdit = (t) => {
    setForm({ name: t.name, role: t.role, text: t.text, active: t.active, order: t.order });
    setPhotoFile(null);
    setPhotoPreview(t.photo ? `/depoimentos/${encodeURIComponent(t.photo)}` : null);
    setEditing(t);
  };

  const handlePhoto = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!form.name.trim() || !form.text.trim()) { flash("Nome e depoimento são obrigatórios."); return; }
    setBusy(true);
    try {
      let t;
      if (editing === "new") {
        t = await api.testimonials.create(form);
      } else {
        t = await api.testimonials.update(editing.id, form);
      }
      if (photoFile) {
        t = await api.testimonials.uploadPhoto(t.id, photoFile);
      }
      flash(editing === "new" ? "Depoimento criado!" : "Salvo!");
      setEditing(null);
      load();
    } catch (e) { flash("Erro: " + e.message); }
    finally { setBusy(false); }
  };

  const remove = async (t) => {
    if (!(await confirmModal({ title: "Excluir depoimento", message: `Excluir depoimento de ${t.name}?`, confirmLabel: "Excluir", tone: "danger" }))) return;
    try { await api.testimonials.remove(t.id); load(); }
    catch (e) { flash("Erro: " + e.message); }
  };

  const toggleActive = async (t) => {
    try { await api.testimonials.update(t.id, { active: !t.active }); load(); }
    catch (e) { flash("Erro: " + e.message); }
  };

  if (editing) return (
    <div className="panel" style={{ maxWidth: 640 }}>
      <div className="panel-h">
        <h2>{editing === "new" ? "⭐ Novo depoimento" : `⭐ Editando — ${editing.name}`}</h2>
        <button className="btn ghost sm" onClick={() => setEditing(null)}>✕ Cancelar</button>
      </div>
      {msg && <div className="toast-inline">{msg}</div>}

      <div className="dep-photo-row">
        <div className="dep-av lg">
          {photoPreview ? <img src={photoPreview} alt="" /> : "📷"}
        </div>
        <div>
          <button className="btn sec sm" onClick={() => fileRef.current.click()}>📷 Escolher foto</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          <p className="hint">JPG, PNG ou WebP · máx 5 MB</p>
        </div>
      </div>

      <div className="field">
        <label>Nome</label>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Ana Paula Tavares" />
      </div>
      <div className="field">
        <label>Identificação <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span></label>
        <input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="@instagram · Cidade/UF" />
      </div>
      <div className="field">
        <label>Depoimento</label>
        <textarea rows={5} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="Escreva o relato da aluna…" />
      </div>

      <div className="dep-inline-opts">
        <label className="opt">
          <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
          Visível no site
        </label>
        <div className="opt">
          <span style={{ color: "var(--muted)" }}>Ordem:</span>
          <input type="number" className="form-input" value={form.order} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} />
        </div>
      </div>

      <button className="btn" style={{ marginTop: "1.4rem" }} onClick={save} disabled={busy}>
        {busy ? "Salvando…" : "💾 Salvar depoimento"}
      </button>
    </div>
  );

  return (<>
    {msg && <div className="toast-inline">{msg}</div>}
    <div className="panel">
      <div className="panel-h">
        <h2>⭐ Depoimentos <span className="muted-note">· {list.length} no total</span></h2>
        <button className="btn" onClick={openNew}>＋ Novo depoimento</button>
      </div>

      {loading ? <div className="empty"><div className="ic">⭐</div><p>Carregando…</p></div>
        : list.length === 0 ? <div className="empty"><div className="ic">💬</div><p>Nenhum depoimento ainda.<br />Clique em <b>＋ Novo</b> para adicionar.</p></div>
        : (
          <div className="dep-list">
            {list.map(t => (
              <div key={t.id} className={`dep-card ${t.active ? "" : "off"}`}>
                <div className="dep-av">
                  {t.photo ? (
                    <img
                      src={`/depoimentos/${encodeURIComponent(t.photo)}`}
                      alt={t.name}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = "inline";
                      }}
                    />
                  ) : null}
                  <span style={{ display: t.photo ? "none" : "inline" }}>{t.name ? t.name[0] : "?"}</span>
                </div>
                <div className="dep-body">
                  <div className="dep-top">
                    <b>{t.name}</b>
                    {t.role && <span className="dep-role">{t.role}</span>}
                    {!t.active && <span className="badge b-muted">🙈 oculto</span>}
                    <span className="dep-order">#{t.order}</span>
                  </div>
                  <p className="dep-text">"{t.text}"</p>
                </div>
                <div className="dep-actions">
                  <button className="btn sec sm" onClick={() => openEdit(t)}>✏️ Editar</button>
                  <button className="btn ghost sm" onClick={() => toggleActive(t)}>
                    {t.active ? "🙈 Ocultar" : "👁 Mostrar"}
                  </button>
                  <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => remove(t)}>🗑 Excluir</button>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  </>);
}

/* ============================= ANIVERSARIANTES =============================
   Controle de aniversários das alunas — a Inêz usa para mandar o parabéns no
   dia e para se organizar com o mês (bolo na aula, recadinho, mimo).

   A data vem de `Client.birthday`, que a aluna já preenche na matrícula. Quem
   está sem data aparece numa lista à parte no fim: é a única forma de a Inêz
   saber quem falta completar, senão a pessoa some da tela para sempre.

   O sino (Notifications.jsx) continua avisando dos aniversários dos próximos 7
   dias — esta tela é o lugar de olhar a coisa inteira. */
/* Uma linha da tabela. Quem faz hoje ganha fundo e etiqueta; quem já fez no
   período em vista fica esmaecida, mas continua na lista — a Inêz quer ver. */
function AniversarioRow({ x, open, parabens }) {
  const { c } = x;
  const ehHoje = x.dias === 0;
  return (
    <tr style={ehHoje ? { background: "rgba(206,122,83,.12)" } : x.passou ? { opacity: .62 } : undefined}>
      <td className="c-main">
        <div className="cli-row row-click" onClick={() => open(<ClientProfile client={c} />)}>
          <span className="cli-av">{initials(c.name)}</span>
          <div>
            <span className="cli-name">{c.name}</span>
            {ehHoje && <span className="badge b-terra ml">🎉 é hoje</span>}
            {c.plan === "mensalista" && <span className="badge b-ok ml">📅 mensalista</span>}
            {c.status === "cancelado" && <span className="badge b-muted ml">inativa</span>}
            <div className="cli-sub">{c.phone || "sem telefone"}</div>
          </div>
        </div>
      </td>
      <td data-l="Dia"><b style={ehHoje ? { color: "var(--terracota)" } : undefined}>🎂 {diaMesLabel(c.birthday)}</b></td>
      <td data-l="Quando">{x.passou ? <span className="cli-sub">{faltamLabel(x.dias)}</span> : faltamLabel(x.dias)}</td>
      <td data-l="Faz">{x.idade ? `${x.idade} anos` : "—"}</td>
      <td data-l="Unidade"><span className="chip">{c.unit || "—"}</span></td>
      <td className="td-actions">
        <button className="btn wa sm" title="Parabenizar no WhatsApp" disabled={!c.phone}
          onClick={() => openWa(c.phone, parabens(c))}><WaIcon /> Parabenizar</button>
        <button className="btn sec sm" onClick={() => open(<ClientProfile client={c} />)}>Ficha</button>
      </td>
    </tr>
  );
}

export function Aniversariantes() {
  const { data } = useStore();
  const { open } = useModal();
  const [per, setPer] = useState("mes");     // semana | mes | proximos | ano
  const [search, setSearch] = useState("");
  const [unitF, setUnitF] = useState("Todas");
  const t = todayISO();

  const hoje = aniversariantes(data.clients, "proximos", t, 0);
  const daSemana = aniversariantes(data.clients, "semana", t);
  const doMes = aniversariantes(data.clients, "mes", t);
  const semData = data.clients
    .filter((c) => !diaMesNasc(c.birthday))
    .sort((a, b) => a.name.localeCompare(b.name));

  const base = per === "semana" ? daSemana
    : per === "mes" ? doMes
    : per === "proximos" ? aniversariantes(data.clients, "proximos", t, 30)
    : aniversariantes(data.clients, "proximos", t, 366); // 'ano' — os 12 meses à frente

  const q = search.trim().toLowerCase();
  const list = base.filter(({ c }) =>
    (unitF === "Todas" || c.unit === unitF) &&
    (!q || c.name.toLowerCase().includes(q) || (c.phone || "").includes(q))
  );

  const TABS = [
    ["semana", "Esta semana", daSemana.length],
    ["mes", "Este mês", doMes.length],
    ["proximos", "Próximos 30 dias", aniversariantes(data.clients, "proximos", t, 30).length],
    ["ano", "Ano todo", aniversariantes(data.clients, "proximos", t, 366).length],
  ];
  const HINTS = {
    semana: "A semana corrente, de segunda a domingo — inclui quem já fez aniversário nos dias que passaram.",
    mes: "O mês inteiro, do dia 1 ao último — quem já fez aparece marcado, para você não perder ninguém.",
    proximos: "Os próximos 30 dias corridos, a partir de hoje. Bom para se antecipar com lembrancinha ou bolo.",
    ano: "Os 12 meses à frente, agrupados por mês — a visão para planejar o ano.",
  };

  const parabens = (c) =>
    `Feliz aniversário, ${c.name.split(" ")[0]}! 🎉💚 Toda a equipe da Fios que Curam deseja um dia lindo pra você. Que venha mais um ano de muitos fios e muitas histórias! 🧶`;

  // No "Ano todo" a lista sai agrupada por mês; nos outros, uma tabela só.
  const grupos = per !== "ano" ? [["", list]] : Object.entries(
    list.reduce((acc, x) => {
      const k = x.quando.slice(0, 7);
      (acc[k] = acc[k] || []).push(x);
      return acc;
    }, {})
  );

  return (<>
    <div className="grid stats" style={{ marginBottom: "1.2rem" }}>
      <div className="card stat"><div className="lbl">🎉 Hoje</div><div className="val terra">{hoje.length}</div>
        <div className="foot">{hoje.length ? hoje.map((x) => x.c.name.split(" ")[0]).join(", ") : "ninguém faz aniversário hoje"}</div></div>
      <div className="card stat"><div className="lbl">📅 Esta semana</div><div className="val">{daSemana.length}</div><div className="foot">de segunda a domingo</div></div>
      <div className="card stat"><div className="lbl">🗓 Este mês</div><div className="val">{doMes.length}</div>
        <div className="foot">{capitalize(new Date(t + "T00:00").toLocaleDateString("pt-BR", { month: "long" }))}</div></div>
      <div className="card stat"><div className="lbl">🎂 Sem data</div><div className="val warn">{semData.length}</div><div className="foot">alunas a completar o cadastro</div></div>
    </div>

    <div className="panel">
      <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
        {TABS.map(([k, lbl, n]) => (
          <button key={k} className={per === k ? "on" : ""} onClick={() => setPer(k)}>{lbl} <span className="seg-count">{n}</span></button>
        ))}
      </div>
      <div className="seg-hint">{HINTS[per]}</div>
      <div className="filters">
        <input className="grow" placeholder="🔍 Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select
          compact
          value={unitF}
          onChange={setUnitF}
          options={[{ value: "Todas", label: "Todas as unidades", icon: "📍" }, ...data.meta.units.map((u) => ({ value: u, label: u, icon: "📍" }))]}
        />
        <span className="count">{list.length} de {base.length}</span>
      </div>

      {list.length ? grupos.map(([comp, itens]) => (
        <div key={comp || "unico"}>
          {comp && <div className="panel-h" style={{ marginTop: ".6rem" }}><h2>{compLabel(comp)} <span className="muted-note">· {itens.length} aniversariante(s)</span></h2></div>}
          <table><thead><tr><th>Aluna</th><th>Dia</th><th>Quando</th><th>Faz</th><th>Unidade</th><th></th></tr></thead><tbody>
            {itens.map((x) => <AniversarioRow key={x.c.id} x={x} open={open} parabens={parabens} />)}
          </tbody></table>
        </div>
      )) : (
        <div className="empty"><div className="ic">🎂</div><p>Nenhuma aniversariante {per === "semana" ? "nesta semana" : per === "mes" ? "neste mês" : per === "proximos" ? "nos próximos 30 dias" : "no período"}.</p></div>
      )}
    </div>

    {semData.length > 0 && (
      <div className="panel">
        <div className="panel-h">
          <h2>🎂 Sem data de nascimento <span className="muted-note">· {semData.length} aluna(s)</span></h2>
        </div>
        <div className="seg-hint">
          Sem a data, elas nunca vão aparecer nesta tela nem no sino. Abra a ficha e preencha o campo
          <b> Aniversário</b> — ou pergunte no WhatsApp, que é o jeito mais rápido.
        </div>
        <table><thead><tr><th>Aluna</th><th>Unidade</th><th></th></tr></thead><tbody>
          {semData.map((c) => (
            <tr key={c.id}>
              <td className="c-main">
                <div className="cli-row row-click" onClick={() => open(<ClientProfile client={c} initialTab="editar" />)}>
                  <span className="cli-av">{initials(c.name)}</span>
                  <div><span className="cli-name">{c.name}</span><div className="cli-sub">{c.phone || "sem telefone"}</div></div>
                </div>
              </td>
              <td data-l="Unidade"><span className="chip">{c.unit || "—"}</span></td>
              <td className="td-actions">
                <button className="btn wa sm" title="Perguntar no WhatsApp" disabled={!c.phone}
                  onClick={() => openWa(c.phone, `Oi ${c.name.split(" ")[0]}! 💚 Estamos completando o cadastro aqui na Fios que Curam — qual é a sua data de nascimento? Queremos te parabenizar no seu dia! 🎂`)}><WaIcon /> Perguntar</button>
                <button className="btn sec sm" onClick={() => open(<ClientProfile client={c} initialTab="editar" />)}>Preencher</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>
    )}
  </>);
}
