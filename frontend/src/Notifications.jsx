import { useState, useMemo, useEffect, useRef } from "react";
import { useStore } from "./store.jsx";
import { WaIcon } from "./icons.jsx";
import {
  todayISO, fmtDate, money, waLink, classifyClient,
  slotCapacity, slotOccupancy,
} from "./helpers.js";

const SEEN_KEY = "fqc:notif:lastSeen";
const openWa = (phone, msg) => window.open(waLink(phone, msg), "_blank");

const daysSince = (iso, t) =>
  Math.floor((new Date(t + "T00:00") - new Date((iso || "").slice(0, 10) + "T00:00")) / 86400000);

function timeAgo(d) {
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const mo = Math.floor(days / 30);
  return `há ${mo} ${mo === 1 ? "mês" : "meses"}`;
}

// dias até o próximo aniversário (0 = hoje); null se sem data válida
function birthdayInDays(bd) {
  if (!bd) return null;
  const [, mm, dd] = bd.split("-");
  if (!mm || !dd) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), +mm - 1, +dd); next.setHours(0, 0, 0, 0);
  if (next < today) next = new Date(today.getFullYear() + 1, +mm - 1, +dd);
  return Math.round((next - today) / 86400000);
}

// Deriva a lista de notificações a partir do estado atual (sem backend dedicado).
// event:true = "aconteceu algo" (conta para não-lidas). event:false = lembrete permanente.
function buildNotifications(data) {
  const t = todayISO();
  const out = [];
  const at = (b) => new Date(b.createdAt || t + "T00:00");

  // 🆕 Aulas marcadas recentemente (últimos 7 dias)
  data.bookings
    .filter((b) => b.status !== "cancelada" && b.createdAt && daysSince(b.createdAt, t) <= 7)
    .forEach((b) => out.push({
      id: "mk" + b.id, event: true, icon: "🆕", tone: "rgba(63,163,77,.14)",
      title: `Nova aula marcada — ${b.clientName}`,
      sub: `${b.unit} · ${fmtDate(b.date)} às ${b.time}`,
      time: at(b), nav: (go) => go("marcacoes"),
    }));

  // ❌ Aulas canceladas recentemente (últimos 14 dias)
  data.bookings
    .filter((b) => b.status === "cancelada" && b.createdAt && daysSince(b.createdAt, t) <= 14)
    .forEach((b) => out.push({
      id: "cx" + b.id, event: true, icon: "❌", tone: "rgba(194,84,63,.14)",
      title: `Aula cancelada — ${b.clientName}`,
      sub: `${b.unit} · ${fmtDate(b.date)} às ${b.time}`,
      time: at(b), nav: (go) => go("marcacoes"),
    }));

  // 💰 Pagamentos atrasados (aguardando há 3+ dias)
  data.bookings
    .filter((b) => b.status === "aguardando" && daysSince(b.createdAt, t) >= 3)
    .forEach((b) => out.push({
      id: "pg" + b.id, event: true, icon: "💰", tone: "rgba(216,155,74,.16)",
      title: `Pagamento atrasado — ${b.clientName}`,
      sub: `há ${daysSince(b.createdAt, t)} dias · ${money(b.value)}`,
      time: at(b), nav: (go) => go("marcacoes"),
      wa: { phone: b.phone, label: "Cobrar", msg: `Olá ${b.clientName}! Vi que sua reserva da aula de ${fmtDate(b.date)} ainda está pendente. Posso te ajudar a confirmar? 💚` },
    }));

  // 🔥 Turmas quase lotando (1 vaga restante, aula futura)
  data.slots
    .filter((s) => s.date >= t && slotCapacity(s) > 1 && slotCapacity(s) - slotOccupancy(data, s.id) === 1)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .slice(0, 5)
    .forEach((s) => out.push({
      id: "sl" + s.id, event: false, icon: "🔥", tone: "rgba(184,92,54,.14)",
      title: `Turma quase lotando`,
      sub: `${s.unit} · ${fmtDate(s.date)} às ${s.time} · 1 vaga`,
      nav: (go) => go("agenda"),
    }));

  // 🌱 Leads a converter
  data.clients
    .filter((c) => classifyClient(data, c) === "lead")
    .forEach((c) => out.push({
      id: "ld" + c.id, event: false, icon: "🌱", tone: "rgba(140,154,120,.18)",
      title: `Lead a converter — ${c.name}`,
      sub: c.phone || "sem telefone",
      nav: (go) => go("clientes", { tab: "lead" }),
      wa: c.phone ? { phone: c.phone, label: "Convidar", msg: `Olá ${c.name}! Vi que você se interessou pelas aulas de crochê 💚 Posso te ajudar a escolher um horário?` } : null,
    }));

  // 🎂 Aniversários nos próximos 7 dias
  data.clients.forEach((c) => {
    const d = birthdayInDays(c.birthday);
    if (d === null || d > 7) return;
    out.push({
      id: "bd" + c.id, event: false, icon: "🎂", tone: "rgba(206,122,83,.16)",
      title: `Aniversário — ${c.name}`,
      sub: d === 0 ? "é hoje! 🎉" : d === 1 ? "amanhã" : `em ${d} dias`,
      nav: (go) => go("clientes", { tab: classifyClient(data, c) }),
      wa: c.phone ? { phone: c.phone, label: "Parabenizar", msg: `Feliz aniversário, ${c.name}! 🎉💚 Toda a equipe da Fios que Curam deseja um dia especial pra você.` } : null,
    });
  });

  return out;
}

function NotifRow({ n, nav, unread }) {
  const clickable = !!n.nav;
  return (
    <div
      className={`notif-row ${unread ? "unread" : ""}`}
      onClick={clickable ? () => nav(n.nav) : undefined}
      style={clickable ? { cursor: "pointer" } : undefined}
    >
      <span className="notif-ic" style={{ background: n.tone }}>{n.icon}</span>
      <div className="notif-body">
        <div className="notif-title">{n.title}</div>
        <div className="notif-sub">{n.sub}</div>
      </div>
      <div className="notif-meta">
        {n.event && n.time && <span className="notif-time">{timeAgo(n.time)}</span>}
        {n.wa && (
          <button className="btn wa sm" onClick={(e) => { e.stopPropagation(); openWa(n.wa.phone, n.wa.msg); }}>
            <WaIcon /> {n.wa.label}
          </button>
        )}
      </div>
    </div>
  );
}

export function Notifications({ go }) {
  const { data } = useStore();
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(() => Number(localStorage.getItem(SEEN_KEY)) || 0);
  const ref = useRef();

  const notifs = useMemo(() => (data ? buildNotifications(data) : []), [data]);
  const events = useMemo(() => notifs.filter((n) => n.event).sort((a, b) => b.time - a.time), [notifs]);
  const reminders = useMemo(() => notifs.filter((n) => !n.event), [notifs]);
  const unreadCount = events.filter((n) => n.time.getTime() > lastSeen).length;

  const markSeen = () => { const now = Date.now(); localStorage.setItem(SEEN_KEY, String(now)); setLastSeen(now); };
  const toggle = () => setOpen((o) => { const nv = !o; if (nv) markSeen(); return nv; });
  const nav = (fn) => { setOpen(false); fn(go); };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  return (
    <div className="notif" ref={ref}>
      <button className="notif-bell" onClick={toggle} aria-label="Notificações" title="Notificações">
        🔔{unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-h">
            <b>Notificações</b>
            {events.length > 0 && <button onClick={markSeen}>Marcar como lidas</button>}
          </div>
          <div className="notif-list">
            {events.length === 0 && reminders.length === 0 && (
              <div className="notif-empty"><div style={{ fontSize: "1.9rem" }}>✨</div><span>Tudo tranquilo por aqui.</span></div>
            )}
            {events.map((n) => <NotifRow key={n.id} n={n} nav={nav} unread={n.time.getTime() > lastSeen} />)}
            {reminders.length > 0 && <div className="notif-sep">Lembretes</div>}
            {reminders.map((n) => <NotifRow key={n.id} n={n} nav={nav} unread={false} />)}
          </div>
        </div>
      )}
    </div>
  );
}
