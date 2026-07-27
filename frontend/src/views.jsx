import { useState, useEffect, useRef } from "react";
import { toast, confirmModal } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { useModal, StatusBadge } from "./ui.jsx";
import { api } from "./api.js";
import { WaIcon } from "./icons.jsx";
import {
  SlotCard, DayModal, ManageBooking, ConfirmPayment, ClientProfile, SlotDetail,
} from "./modals.jsx";
import {
  UNITS, STATUS, unitColor,
  todayISO, addDays, weekStart, fmtDate, fmtDateLong, weekdayShort, money, waLink, capitalize, faixaHorario, hhmm,
  bookingsActive, slotBookings, slotBookingsAll, slotCapacity, slotOccupancy, slotWaitlist, clientAttendance,
  bookingKind, BOOKING_KINDS, compAtual, addComp, compLabel, competenciasDoAluno, mensalidadeDe, matriculaISO,
  clientActiveCount, classifyClient, isNewLead,
} from "./helpers.js";

const openWa = (phone, msg) => window.open(waLink(phone, msg), "_blank");

/* ============================= ALERTAS ============================= */
function Alerts({ open }) {
  const { data } = useStore();
  const t = todayISO();
  const daysSince = (iso) => Math.floor((new Date(t + "T00:00") - new Date((iso || "").slice(0, 10) + "T00:00")) / 86400000);

  const atrasados = data.bookings.filter((b) => b.status === "aguardando" && daysSince(b.createdAt) >= 3)
    .sort((a, b) => daysSince(b.createdAt) - daysSince(a.createdAt)).slice(0, 5);
  const quase = data.slots.filter((s) => s.date >= t && slotCapacity(s) > 1 && slotCapacity(s) - slotOccupancy(data, s.id) === 1)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);
  const lastByClient = {};
  bookingsActive(data).forEach((b) => { if (!lastByClient[b.clientName] || b.date > lastByClient[b.clientName]) lastByClient[b.clientName] = b.date; });
  const inativas = data.clients.filter((c) => { const l = lastByClient[c.name]; return l && daysSince(l) >= 30; })
    .sort((a, b) => daysSince(lastByClient[b.name]) - daysSince(lastByClient[a.name])).slice(0, 5);

  // Fez a experimental, a taxa está paga e ela não virou mensalista: ou converte
  // ou devolve os R$20. Só cobra atenção depois da aula ter acontecido.
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
            <div className="alert-h" style={{ color: "var(--warn)" }}>⏳ Pagamentos atrasados</div>
            {atrasados.map((b) => (
              <div className="alert-row" key={b.id}>
                <div><b>{b.clientName}</b><div className="cli-sub">há {daysSince(b.createdAt)} dias · {money(b.value)}</div></div>
                <button className="btn wa sm" onClick={() => openWa(b.phone, `Olá ${b.clientName}! Vi que sua reserva da aula de ${fmtDate(b.date)} ainda está pendente. Posso te ajudar a confirmar? 💚`)}>Cobrar</button>
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
                      experimental {dias === 0 ? "hoje" : `há ${dias} dia${dias === 1 ? "" : "s"}`} · matricular ou devolver {money(data.meta?.taxaMatricula ?? 20)}
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
  const aguardando = data.bookings.filter((b) => b.status === "aguardando").sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const month = new Date().toISOString().slice(0, 7);
  const wk = weekStart(t), wkEnd = addDays(wk, 6);
  const aulasSemana = bookingsActive(data).filter((b) => b.date >= wk && b.date <= wkEnd).length;
  const concluidasMes = data.bookings.filter((b) => b.status === "concluida" && b.date.slice(0, 7) === month).length;
  const futuras = bookingsActive(data).filter((b) => b.date >= t).length;
  const prox = bookingsActive(data).filter((b) => b.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 6);

  const groups = { cliente: 0, lead: 0, novato: 0 };
  data.clients.forEach((c) => { groups[classifyClient(data, c)]++; });

  const hh = new Date().getHours();
  const saud = hh < 12 ? "Bom dia" : hh < 18 ? "Boa tarde" : "Boa noite";
  const dataLonga = capitalize(new Date(t + "T00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }));

  const confHoje = hoje.filter((b) => b.status === "confirmada").length;

  return (<>
    <div className="dash-hello">
      <div><h2>{saud}, Inêz! 💚</h2><p>{dataLonga}</p></div>
      <button className="btn" onClick={() => go("agenda")}>📅 Abrir agenda</button>
    </div>

    <div className="grid stats" style={{ marginBottom: "1rem" }}>
      <div className="card stat click" onClick={() => go("agenda")}><div className="lbl">📅 Aulas hoje</div><div className="val">{hoje.length}</div><div className="foot">{confHoje} confirmada(s)</div></div>
      <div className="card stat click" onClick={() => go("agenda")}><div className="lbl">📆 Nesta semana</div><div className="val">{aulasSemana}</div><div className="foot">{fmtDate(wk)} – {fmtDate(wkEnd)}</div></div>
      <div className="card stat click" onClick={() => go("agenda")}><div className="lbl">🗓 Aulas agendadas</div><div className="val terra">{futuras}</div><div className="foot">de hoje em diante</div></div>
      <div className="card stat click" onClick={() => go("marcacoes")}><div className="lbl">✅ Concluídas no mês</div><div className="val">{concluidasMes}</div><div className="foot">aulas realizadas</div></div>
    </div>

    <div className="people-strip">
      <button className="people-card" onClick={() => go("clientes", { tab: "cliente" })}><span className="pc-ic">👩</span><span className="pc-n">{groups.cliente}</span><span className="pc-l">Alunos</span></button>
      <button className="people-card" onClick={() => go("clientes", { tab: "lead" })}><span className="pc-ic">🌱</span><span className="pc-n">{groups.lead}</span><span className="pc-l">Leads a converter</span></button>
      <button className="people-card" onClick={() => go("clientes", { tab: "novato" })}><span className="pc-ic">✨</span><span className="pc-n">{groups.novato}</span><span className="pc-l">Novatos(as)</span></button>
    </div>

    <Alerts open={open} />

    <div className="dash-cols">
      <div className="panel">
        <div className="panel-h"><h2>⏳ Confirmar pagamento</h2><button className="btn sec sm" onClick={() => go("marcacoes")}>Ver todas</button></div>
        {aguardando.length ? (
          <table><thead><tr><th>Aluno</th><th>Dia</th><th>Valor</th><th></th></tr></thead><tbody>
            {aguardando.slice(0, 6).map((b) => (
              <tr key={b.id}>
                <td><span className="cli-name">{b.clientName}</span><div className="cli-sub">{b.unit}</div></td>
                <td>{fmtDate(b.date)} · {b.time}</td>
                <td><b>{money(b.value)}</b></td>
                <td className="td-actions">
                  <button className="btn wa sm" onClick={() => openWa(b.phone, `Olá ${b.clientName}! Para confirmar sua aula de ${fmtDate(b.date)} às ${b.time}, a reserva é de ${money(b.value)}. Pode me enviar o comprovante? 💚`)}><WaIcon /></button>
                  <button className="btn sm" onClick={() => open(<ConfirmPayment booking={b} />)}>✓ Pago</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        ) : <div className="empty"><div className="ic">✅</div><p>Nenhuma pendência. Tudo em dia!</p></div>}
      </div>

      <div className="panel">
        <div className="panel-h"><h2>🧶 Aulas de hoje</h2><button className="btn sec sm" onClick={() => go("agenda")}>Agenda</button></div>
        {hoje.length ? (
          <table><thead><tr><th>Hora</th><th>Aluno</th><th>Unidade</th><th>Status</th></tr></thead><tbody>
            {hoje.map((b) => (
              <tr key={b.id} onClick={() => open(<ManageBooking booking={b} />)} className="row-click">
                <td><b>{b.time}</b></td><td>{b.clientName}</td><td><span className="chip">{b.unit}</span></td><td><StatusBadge status={b.status} /></td>
              </tr>
            ))}
          </tbody></table>
        ) : <div className="empty"><div className="ic">☕</div><p>Nenhuma aula hoje.</p></div>}
      </div>
    </div>

    <div className="panel">
      <div className="panel-h"><h2>📅 Próximas aulas</h2><button className="btn sec sm" onClick={() => go("agenda")}>Abrir agenda</button></div>
      {prox.length ? (
        <table><thead><tr><th>Dia</th><th>Hora</th><th>Aluno</th><th>Unidade</th><th>Status</th></tr></thead><tbody>
          {prox.map((b) => (
            <tr key={b.id} onClick={() => open(<ManageBooking booking={b} />)} className="row-click">
              <td>{fmtDateLong(b.date)}</td><td><b>{b.time}</b></td><td>{b.clientName}</td><td><span className="chip">{b.unit}</span></td><td><StatusBadge status={b.status} /></td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="empty"><div className="ic">🧶</div><p>Sem aulas agendadas.</p></div>}
    </div>
  </>);
}

/* ============================= AGENDA ============================= */
export function Agenda() {
  const { data } = useStore();
  const { open } = useModal();
  const [view, setView] = useState("month");
  const [unit, setUnit] = useState("Todas");
  const [ref, setRef] = useState(todayISO());

  const agSlots = (date) => data.slots.filter((s) => s.date === date && (unit === "Todas" || s.unit === unit)).sort((a, b) => a.time.localeCompare(b.time));
  const nav = (dir) => {
    if (view === "month") { const d = new Date(ref + "T00:00"); d.setDate(1); d.setMonth(d.getMonth() + dir); setRef(d.toISOString().slice(0, 10)); }
    else setRef(addDays(ref, 7 * dir)); // semana e lista andam de 7 em 7 dias
  };
  const periodLabel = () => {
    const d = new Date(ref + "T00:00");
    if (view === "month") return capitalize(d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
    if (view === "week") { const s = weekStart(ref); return fmtDate(s) + " – " + fmtDate(addDays(s, 6)); }
    return ref === todayISO() ? "Hoje e próximos dias" : "A partir de " + fmtDate(ref);
  };

  const views = [["month", "🗓 Mês"], ["week", "📆 Semana"], ["list", "📋 Lista"]];
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
      {view === "month" && <MonthView ref0={ref} agSlots={agSlots} open={open} data={data} unit={unit} />}
      {view === "week" && <WeekView ref0={ref} agSlots={agSlots} unit={unit} />}
      {view === "list" && <ListView data={data} unit={unit} open={open} ref0={ref} />}
    </div>
  );
}

function MonthView({ ref0, agSlots, open, data, unit }) {
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
    cells.push(
      <div key={i} className={`m-cell ${out ? "out" : ""} ${date === t ? "today" : ""}`} onClick={() => open(<DayModal date={date} unit={unit} />)}>
        <span className="dn">{dd.getDate()}</span>{evs}{more}<div className="m-dots">{dots}</div>
      </div>
    );
  }
  return <div className="month-grid">{dows.map((d) => <div key={d} className="month-dow">{d}</div>)}{cells}</div>;
}

function WeekView({ ref0, agSlots, unit }) {
  const start = weekStart(ref0), t = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="agenda" style={{ "--cols": 7 }}>
      {days.map((date) => {
        const slots = agSlots(date);
        return (
          <div key={date} className="day-col">
            <div className={`day-h ${date === t ? "today" : ""}`}><b>{fmtDate(date)}</b><span>{weekdayShort(date)}</span></div>
            {slots.length ? slots.map((s) => <SlotCard key={s.id} slot={s} showUnit={unit === "Todas"} />) : <div className="day-empty">—</div>}
          </div>
        );
      })}
    </div>
  );
}

function ListView({ data, unit, open, ref0 }) {
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
              {s.prof && <span className="cli-sub">· {s.prof}</span>}
              <span className="ls-cap">{ativas.length}/{cap}</span>
              <button className="btn ghost sm" onClick={() => open(<SlotDetail slotId={s.id} />)}>Gerir turma</button>
            </div>
            {todas.length ? todas.map((b) => {
              const k = bookingKind(b);
              return (
                <div className={`ls-al ${b.status === "cancelada" ? "canc" : ""} ${k ? "kinded" : ""}`} key={b.id}
                  style={k ? { "--kc": k.color } : undefined}
                  onClick={() => open(<ManageBooking booking={b} />)}>
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
  const [search, setSearch] = useState("");
  const segs = [["todas", "Todas"], ["aguardando", "Aguardando"], ["confirmada", "Confirmadas"], ["concluida", "Concluídas"], ["cancelada", "Canceladas"]];

  const isNovo = (b) => isNewLead(data, b);
  const novosCount = data.bookings.filter(isNovo).length;
  const acessoCount = data.bookings.length - novosCount;

  let list = [...data.bookings].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  list = list.filter((b) => (tab === "novos" ? isNovo(b) : !isNovo(b)));
  if (filter !== "todas") list = list.filter((b) => b.status === filter);
  if (search) list = list.filter((b) => b.clientName.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="panel">
      <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
        <button className={tab === "novos" ? "on" : ""} onClick={() => setTab("novos")}>🆕 Novos <span className="seg-count">{novosCount}</span></button>
        <button className={tab === "acesso" ? "on" : ""} onClick={() => setTab("acesso")}>👤 Com acesso <span className="seg-count">{acessoCount}</span></button>
      </div>
      <div className="seg-hint">{tab === "novos"
        ? "Solicitações de quem ainda não tem acesso (sem PIN) ou está na primeira aula."
        : "Marcações de alunas que já têm cadastro e acesso ao portal."}</div>
      <div className="filters">
        <div className="seg">{segs.map((s) => <button key={s[0]} className={filter === s[0] ? "on" : ""} onClick={() => setFilter(s[0])}>{s[1]}</button>)}</div>
        <input className="grow" placeholder="🔍 Buscar aluno..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.length ? (
        <table><thead><tr><th>Aluno</th><th>Unidade</th><th>Dia / Hora</th><th>Valor</th><th>Pagamento</th><th>Status</th><th></th></tr></thead><tbody>
          {list.map((b) => (
            <tr key={b.id} style={tab === "novos" ? { background: "rgba(127,194,65,.08)" } : {}}>
              <td>
                <span className="cli-name">{b.clientName}</span>
                {isNovo(b) && <span className="badge b-terra ml">🆕 Novata</span>}
                <div className="cli-sub">{b.phone}</div>
              </td>
              <td><span className="chip">{b.unit}</span></td>
              <td>{fmtDate(b.date)} · <b>{b.time}</b></td>
              <td>{money(b.value)}</td>
              <td>{b.paid ? <span className="badge b-ok">Pago · {b.paymentMethod}</span> : <span className="badge b-warn">Pendente</span>}</td>
              <td><StatusBadge status={b.status} /></td>
              <td className="td-actions">
                <button className="btn wa sm" title="WhatsApp" onClick={() => openWa(b.phone, `Olá ${b.clientName}! 💚`)}><WaIcon /></button>
                <button className="btn sec sm" onClick={() => open(<ManageBooking booking={b} />)}>Gerir</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="empty"><div className="ic">📝</div><p>Nenhuma marcação nesse filtro.</p></div>}
    </div>
  );
}

/* ============================= CLIENTES ============================= */
const initials = (n) => (n || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function Clientes({ params }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const [tab, setTab] = useState(params?.tab || "cliente"); // cliente | lead | novato
  useEffect(() => { if (params?.tab) setTab(params.tab); }, [params?.tab]);
  const [search, setSearch] = useState("");
  const [unitF, setUnitF] = useState("Todas");
  const [planF, setPlanF] = useState("Todos");
  const [sortBy, setSortBy] = useState("nome");
  const cntOf = (c) => clientActiveCount(data, c);

  const groups = { cliente: [], lead: [], novato: [] };
  data.clients.forEach((c) => groups[classifyClient(data, c)].push(c));

  const TABS = [
    ["cliente", "👩 Alunos", groups.cliente.length, "Alunos com cadastro e aulas ativas."],
    ["lead", "🌱 Leads", groups.lead.length, "Cadastraram/entraram mas ainda não marcaram uma aula."],
    ["novato", "✨ Novatos", groups.novato.length, "Na primeira aula — merecem atenção especial no acolhimento."],
  ];
  const hint = (TABS.find((t) => t[0] === tab) || [])[3];

  let list = groups[tab].filter((c) =>
    (!search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || "").includes(search)) &&
    (unitF === "Todas" || c.unit === unitF) &&
    (planF === "Todos" || (planF === "Mensalistas" ? c.plan === "mensalista" : c.plan !== "mensalista"))
  );
  list = [...list].sort((a, b) => sortBy === "aulas" ? cntOf(b) - cntOf(a) : a.name.localeCompare(b.name));

  const resetPin = async (c) => {
    if (!(await confirmModal({ title: "Resetar PIN", message: `Resetar PIN de ${c.name}? Na próxima entrada ela terá que criar um novo PIN.`, confirmLabel: "Resetar", tone: "danger" }))) return;
    await run(api.resetPin(c.id));
    toast("PIN resetado! A aluna criará um novo no próximo acesso.");
  };
  const delClient = async (c) => {
    if (!(await confirmModal({ title: "Excluir cadastro", message: `Excluir ${c.name}?\n\nAs aulas futuras serão removidas da agenda; o histórico de aulas passadas é mantido.`, confirmLabel: "Excluir", tone: "danger" }))) return;
    await run(api.deleteClient(c.id));
    toast("Cadastro excluído.");
  };
  const waMsg = (c) => tab === "lead"
    ? `Olá ${c.name}! Vi que você se interessou pelas aulas de crochê 💚 Posso te ajudar a escolher um horário?`
    : tab === "novato"
      ? `Olá ${c.name}! Que alegria ter você na sua primeira aula de crochê 💚 Qualquer dúvida, é só chamar!`
      : `Olá ${c.name}! 💚`;

  const emptyLabel = { cliente: "Nenhum aluno encontrado.", lead: "Nenhum lead no momento.", novato: "Nenhum aluno na primeira aula." }[tab];

  return (
    <div className="panel">
      <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
        {TABS.map((t) => <button key={t[0]} className={tab === t[0] ? "on" : ""} onClick={() => setTab(t[0])}>{t[1]} <span className="seg-count">{t[2]}</span></button>)}
      </div>
      <div className="seg-hint">{hint}</div>
      <div className="filters">
        <input className="grow" placeholder="🔍 Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={unitF} onChange={(e) => setUnitF(e.target.value)}>
          <option>Todas</option>
          {data.meta.units.map((u) => <option key={u}>{u}</option>)}
        </select>
        <select value={planF} onChange={(e) => setPlanF(e.target.value)}>
          <option>Todos</option>
          <option>Mensalistas</option>
          <option>Avulsos</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="nome">Ordenar: Nome</option>
          <option value="aulas">Ordenar: Mais aulas</option>
        </select>
        <span className="count">{list.length} de {groups[tab].length}</span>
      </div>
      {list.length ? (
        <table><thead><tr><th>{tab === "lead" ? "Contato" : "Aluno"}</th><th>Unidade</th><th>Etiquetas</th><th>Aulas</th><th>Presença</th><th></th></tr></thead><tbody>
          {list.map((c) => {
            const cnt = cntOf(c);
            const at = clientAttendance(data, c.name);
            return (
              <tr key={c.id} style={tab === "novato" ? { background: "rgba(194,113,79,.06)" } : {}}>
                <td>
                  <div className="cli-row row-click" onClick={() => open(<ClientProfile client={c} />)}>
                    <span className="cli-av">{initials(c.name)}</span>
                    <div>
                      <span className="cli-name">{c.name}</span>
                      {c.plan === "mensalista" ? <span className="badge b-ok ml">📅 {c.weeklyFreq ? `${c.weeklyFreq}x/semana` : "mensalista"}</span> : null}
                      {c.matriculaStatus === "paga" && c.plan !== "mensalista" ? <span className="badge b-warn ml">🎟️ matrícula a decidir</span> : null}
                      {tab === "novato" ? <span className="badge b-terra ml">✨ 1ª aula</span> : null}
                      {tab === "lead" ? <span className="badge b-warn ml">🌱 lead</span> : null}
                      <div className="cli-sub">{c.phone || "sem telefone"}{c.birthday ? " · 🎂 " + fmtDate(c.birthday) : ""}</div>
                    </div>
                  </div>
                </td>
                <td><span className="chip">{c.unit}</span></td>
                <td><div className="tags">{(c.tags || []).length ? c.tags.map((t) => <span key={t} className="chip">{t}</span>) : <span className="cli-sub">—</span>}</div></td>
                <td>{cnt}</td>
                <td><span className="badge b-ok" title="Presenças">✓ {at.pres}</span>{at.falt ? <> <span className="badge b-danger" title="Faltas">✕ {at.falt}</span></> : null}</td>
                <td className="td-actions">
                  <button className="btn wa sm" title={tab === "lead" ? "Convidar" : "WhatsApp"} onClick={() => openWa(c.phone, waMsg(c))}><WaIcon /></button>
                  {c.hasPin && <button className="btn sec sm" onClick={() => resetPin(c)}>🔒 Resetar PIN</button>}
                  <button className="btn sec sm" onClick={() => open(<ClientProfile client={c} initialTab="editar" />)}>Editar</button>
                  <button className="btn ghost sm" style={{ color: "var(--danger)" }} title="Excluir" onClick={() => delClient(c)}>🗑</button>
                </td>
              </tr>
            );
          })}
        </tbody></table>
      ) : <div className="empty"><div className="ic">{tab === "lead" ? "🌱" : tab === "novato" ? "✨" : "👩"}</div><p>{emptyLabel}</p></div>}
    </div>
  );
}

/* ============================= MENSALISTAS (mensalidades / boletos) ============================= */
export function Mensalistas() {
  const { data, run } = useStore();
  const { open } = useModal();
  const [comp, setComp] = useState(compAtual());
  const [busy, setBusy] = useState(false);
  const atual = compAtual();
  const ehMesAtual = comp === atual;

  // mensalistas que já estavam matriculados nessa competência
  const mensalistas = data.clients
    .filter((c) => c.plan === "mensalista")
    .filter((c) => { const ini = matriculaISO(c); return !ini || ini.slice(0, 7) <= comp; })
    .sort((a, b) => a.name.localeCompare(b.name));

  const invOf = (c) => (data.invoices || []).find((i) => i.clientId === c.id && i.competencia === comp);
  const valorDe = (c) => mensalidadeDe(c, data.meta);
  const vencDe = (c) => Math.min(28, Math.max(1, c.billingDay || data.meta.vencimentoDia || 10));

  const gerar = async (c) => { setBusy(true); try { await run(api.gerarMensalidade(c.id, comp)); } finally { setBusy(false); } };
  const gerarTodos = async () => {
    if (!(await confirmModal({ title: "Gerar mensalidades", message: `Gerar os boletos de ${compLabel(comp)} para todos os ${mensalistas.length} mensalistas?`, confirmLabel: "Gerar" }))) return;
    setBusy(true);
    try { const r = await run(api.gerarMensalidadesMes()); toast(`${r?.geradas ?? 0} boleto(s) gerado(s)/reaproveitado(s).`); }
    finally { setBusy(false); }
  };
  const marcarPago = async (inv) => { await run(api.payInvoice(inv.id)); };
  const copyPix = (code) => { navigator.clipboard.writeText(code); toast("Código Pix copiado! 📋"); };

  // ----- fechamento da competência -----
  const invs = mensalistas.map(invOf);
  const pagosArr = invs.filter((i) => i && i.status === "pago");
  const pendArr = invs.filter((i) => i && i.status === "pendente");
  const semBoleto = invs.filter((i) => !i).length;
  const recebido = pagosArr.reduce((s, i) => s + i.amountCents / 100, 0);
  const aReceber = pendArr.reduce((s, i) => s + i.amountCents / 100, 0);
  const previsto = mensalistas.reduce((s, c) => { const i = invOf(c); return s + (i ? i.amountCents / 100 : valorDe(c)); }, 0);

  return (
    <div className="panel">
      <div className="ag-toolbar">
        <div className="ag-nav">
          <button className="navbtn" onClick={() => setComp(addComp(comp, -1))}>←</button>
          <span className="ag-period">{compLabel(comp)}</span>
          <button className="navbtn" onClick={() => setComp(addComp(comp, 1))} disabled={comp >= atual}>→</button>
          {!ehMesAtual && <button className="btn ghost sm" onClick={() => setComp(atual)}>Mês atual</button>}
        </div>
        <button className="btn" disabled={busy || !mensalistas.length || !ehMesAtual}
          title={ehMesAtual ? "" : "Boletos só são gerados para o mês atual"} onClick={gerarTodos}>
          🧾 Gerar boletos do mês
        </button>
      </div>

      <div className="fch-tot">
        <div className="fch-card"><div className="l">✓ Recebido</div><div className="v">{money(recebido)}</div><div className="cli-sub">{pagosArr.length} pago(s)</div></div>
        <div className="fch-card"><div className="l">⏳ A receber</div><div className="v warn">{money(aReceber)}</div><div className="cli-sub">{pendArr.length} pendente(s)</div></div>
        <div className="fch-card"><div className="l">📄 Sem boleto</div><div className="v terra">{semBoleto}</div><div className="cli-sub">de {mensalistas.length} aluno(s)</div></div>
        <div className="fch-card"><div className="l">📊 Previsto no mês</div><div className="v">{money(previsto)}</div><div className="cli-sub">{previsto ? Math.round((recebido / previsto) * 100) : 0}% fechado</div></div>
      </div>

      {!ehMesAtual && <div className="seg-hint">📅 Mês fechado — os boletos são gerados apenas para o mês atual. Meses anteriores sem boleto aparecem como “não gerado”.</div>}

      {mensalistas.length ? (
        <table><thead><tr><th>Aluno</th><th>Mensalidade</th><th>Vencimento</th><th>Status do mês</th><th></th></tr></thead><tbody>
          {mensalistas.map((c) => {
            const inv = invOf(c);
            return (
              <tr key={c.id}>
                <td>
                  <div className="cli-row row-click" onClick={() => open(<ClientProfile client={c} />)}>
                    <span className="cli-av">{initials(c.name)}</span>
                    <div><span className="cli-name">{c.name}</span><div className="cli-sub">{c.unit}{c.cpf ? "" : " · ⚠ sem CPF"}</div></div>
                  </div>
                </td>
                <td>{money(inv ? inv.amountCents / 100 : valorDe(c))}{c.monthlyValue != null ? <span className="cli-sub"> (individual)</span> : null}</td>
                <td>{inv ? fmtDate(inv.dueDate) : "dia " + vencDe(c)}</td>
                <td>
                  {!inv ? <span className="badge b-muted">não gerado</span>
                    : inv.status === "pago" ? <span className="badge b-ok">✓ pago{inv.paidAt ? " em " + fmtDate(String(inv.paidAt).slice(0, 10)) : ""}</span>
                    : inv.status === "cancelado" ? <span className="badge b-danger">cancelado</span>
                    : <span className="badge b-warn">⏳ pendente · vence {fmtDate(inv.dueDate)}</span>}
                </td>
                <td className="td-actions">
                  {!inv && ehMesAtual && <button className="btn sm" disabled={busy} onClick={() => gerar(c)}>🧾 Gerar boleto</button>}
                  {inv && inv.status === "pendente" && <>
                    {inv.boletoUrl && <a className="btn sec sm" href={inv.boletoUrl} target="_blank" rel="noreferrer">📄 Boleto</a>}
                    {inv.pixCode && <button className="btn sec sm" onClick={() => copyPix(inv.pixCode)}>💠 Pix</button>}
                    <button className="btn sm" onClick={() => marcarPago(inv)}>✓ Marcar pago</button>
                  </>}
                </td>
              </tr>
            );
          })}
        </tbody></table>
      ) : <div className="empty"><div className="ic">📅</div><p>Nenhum mensalista nessa competência.</p></div>}
    </div>
  );
}

/* ============================= RECEBIMENTOS (só leitura) ============================= */
// Gráfico de barras nativo (sem dependência)
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

export function Recebimentos() {
  const { data } = useStore();
  const month = new Date().toISOString().slice(0, 7);
  const pagos = data.bookings.filter((b) => b.paid).sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""));
  const pend = data.bookings.filter((b) => b.status === "aguardando");
  const recMes = pagos.filter((b) => (b.paymentDate || "").slice(0, 7) === month).reduce((a, b) => a + b.value, 0);
  const totalPend = pend.reduce((a, b) => a + b.value, 0);
  const recTotal = pagos.reduce((a, b) => a + b.value, 0);
  const ticket = pagos.length ? recTotal / pagos.length : 0;

  const sumBetween = (fromISO, toISO) => pagos
    .filter((b) => { const d = (b.paymentDate || "").slice(0, 10); return d >= fromISO && d <= toISO; })
    .reduce((a, b) => a + b.value, 0);

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
    return { label: capitalize(d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")), full: capitalize(d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })), value: sumBetween(from, to) };
  });

  return (<>
    <div className="grid stats" style={{ marginBottom: "1.2rem" }}>
      <div className="card stat"><div className="lbl">💰 Recebido no mês</div><div className="val">{money(recMes)}</div><div className="foot">mês atual</div></div>
      <div className="card stat"><div className="lbl">⏳ A receber</div><div className="val warn">{money(totalPend)}</div><div className="foot">{pend.length} reservas</div></div>
      <div className="card stat"><div className="lbl">📈 Recebido total</div><div className="val terra">{money(recTotal)}</div><div className="foot">{pagos.length} pagamentos</div></div>
      <div className="card stat"><div className="lbl">🎟️ Ticket médio</div><div className="val">{money(ticket)}</div><div className="foot">por reserva paga</div></div>
    </div>

    <div className="panel">
      <div className="panel-h"><h2>📅 Recebido por dia <span className="muted-note">· últimos 14 dias</span></h2></div>
      <BarChart series={porDia} color="var(--sage-deep)" />
    </div>
    <div className="dash-cols">
      <div className="panel">
        <div className="panel-h"><h2>📆 Por semana <span className="muted-note">· 8 semanas</span></h2></div>
        <BarChart series={porSemana} color="var(--terracota)" />
      </div>
      <div className="panel">
        <div className="panel-h"><h2>🗓 Por mês <span className="muted-note">· 6 meses</span></h2></div>
        <BarChart series={porMes} color="var(--green-deep)" />
      </div>
    </div>

    <div className="panel">
      <div className="panel-h"><h2>✅ Recebimentos confirmados</h2><span className="cli-sub">{pagos.length} registro(s)</span></div>
      {pagos.length ? (
        <table><thead><tr><th>Aluno</th><th>Unidade</th><th>Aula</th><th>Forma</th><th>Data pgto.</th><th>Valor</th></tr></thead><tbody>
          {pagos.map((b) => (
            <tr key={b.id}><td className="cli-name">{b.clientName}</td><td><span className="chip">{b.unit}</span></td><td>{fmtDate(b.date)} · {b.time}</td><td><span className="badge b-sage">{b.paymentMethod || "—"}</span></td><td>{b.paymentDate ? fmtDate(b.paymentDate) : "—"}</td><td><b>{money(b.value)}</b></td></tr>
          ))}
        </tbody></table>
      ) : <div className="empty"><div className="ic">💰</div><p>Nenhum recebimento ainda.</p></div>}
    </div>
  </>);
}

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
    setPhotoPreview(t.photo ? `/depoimentos/${t.photo}` : null);
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
                  {t.photo ? <img src={`/depoimentos/${t.photo}`} alt={t.name} /> : t.name[0]}
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
