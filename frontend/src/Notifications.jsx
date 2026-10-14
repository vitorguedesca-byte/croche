import { useState, useMemo, useEffect, useRef } from "react";
import { useStore } from "./store.jsx";
import { WaIcon } from "./icons.jsx";
import { api } from "./api.js";
import { confirmModal, toast } from "./toast.jsx";
import {
  todayISO, fmtDate, money, waLink,
  slotCapacity, slotOccupancy, diasAteAniversario, faltamLabel, idadeQueFaz,
} from "./helpers.js";
import { ETAPAS, mensagemDaLead } from "./Funil.jsx";

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
      id: "mk" + b.id, event: true, icon: "📅", tone: "rgba(63,163,77,.14)",
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

  /* 💬 Mensagens no WhatsApp do robô que pedem gente (08/10/2026): aluna
     escrevendo, áudio/foto, dúvida que o robô não respondeu, pedido de
     atendente. Antes ficavam só no log do servidor. "Responder" abre a
     conversa no WhatsApp da escola. */
  const MOTIVO_WA = { aluna: "Aluna", midia: "Mandou mídia", duvida: "Dúvida sem resposta", atendente: "Pediu atendente" };
  const MIDIA_WA = { audio: "🎤 áudio", voice: "🎤 áudio", image: "📷 foto", video: "🎬 vídeo", sticker: "figurinha", document: "📄 documento", location: "📍 localização", contacts: "👤 contato" };
  (data.waRecebidas || []).forEach((m) => {
    const fone = String(m.phone || "").replace(/^55(?=\d{10,11}$)/, "");
    const conteudo = m.texto ? `“${m.texto.length > 90 ? m.texto.slice(0, 90) + "…" : m.texto}”` : `[${MIDIA_WA[m.tipo] || m.tipo}]`;
    out.push({
      id: "wa" + m.id, event: true, icon: "💬", tone: "rgba(37,211,102,.14)",
      title: `WhatsApp — ${m.clientName || m.perfil || fone}`,
      sub: `${MOTIVO_WA[m.motivo] || m.motivo} · ${conteudo}`,
      time: new Date(m.createdAt),
      wa: { phone: fone, label: "Responder", msg: "" },
    });
  });

  /* 💸 Pix que caiu e não deu baixa em nada (14/10/2026): mensalidade já
     quitada (pagou em dobro), reserva paga depois que a turma lotou, cobrança
     apagada. O dinheiro está na conta — fica aqui até alguém resolver. */
  const MOTIVO_PIX = { ja_quitada: "Pago em dobro?", turma_lotada: "Turma lotou", sem_registro: "Cobrança apagada" };
  (data.pixAlertas || []).forEach((a) => out.push({
    id: "px" + a.id, event: true, icon: "💸", tone: "rgba(194,84,63,.16)",
    title: `${MOTIVO_PIX[a.motivo] || "Pix a conferir"} — ${a.clientName || "sem cadastro"} · ${money(a.valorCents / 100)}`,
    sub: `${a.pagoEm ? `Pix de ${fmtDate(String(a.pagoEm).slice(0, 10))}. ` : ""}${a.descricao}`,
    time: new Date(a.createdAt),
    pixAlerta: a,
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

  /* 🎯 Funil de leads (14/10/2026). Substitui o antigo "🌱 Lead a converter",
     que listava TODA lead sem pagamento, todo dia, para sempre — virava
     paisagem. Agora: a lead que chegou (aconteceu), o retorno marcado para
     hoje ou atrasado (com quem falar), e um aviso só de quantas estão sem
     retorno marcado. */
  const funil = data.funilAvisos;
  const etapaTxt = (l) => (ETAPAS.find((e) => e.k === l.etapa) || {}).l || l.etapa;
  const canalTxt = { whatsapp: "pelo WhatsApp", site: "pelo site", escola: "anotada pela equipe" };
  /* Quem deixou o WhatsApp no /agendar (fase 2) só vira aviso depois de 30
     min sem gerar o Pix — antes disso ela pode estar no meio do pagamento, e
     ninguém deve chamá-la. O aviso nasce na hora em que ela "desistiu". */
  const MIN_NO_SITE = 30 * 60000;
  (funil?.novas || []).forEach((l) => {
    const noSite = l.etapa === "contato" && l.siteEm && !(l.detalhe || "").startsWith("parou em");
    if (noSite && Date.now() - new Date(l.siteEm).getTime() < MIN_NO_SITE) return;
    out.push({
      id: "ln" + l.id, event: true, icon: noSite ? "🌐" : "🎯", tone: "rgba(194,113,79,.14)",
      title: `${noSite ? "Parou no site" : "Nova lead"} — ${l.nome}`,
      sub: [noSite ? null : canalTxt[l.canal], l.detalhe || etapaTxt(l)].filter(Boolean).join(" · "),
      time: noSite ? new Date(new Date(l.siteEm).getTime() + MIN_NO_SITE) : new Date(l.createdAt),
      nav: (go) => go("funil", { lead: l.id }),
    });
  });
  (funil?.retornos || []).forEach((l) => out.push({
    id: "lr" + l.id, event: false, icon: "⏰", tone: "rgba(217,164,65,.18)",
    title: `Retornar para ${l.nome}`,
    sub: `${etapaTxt(l)}${l.proximoContato < t ? ` · atrasado desde ${fmtDate(l.proximoContato)}` : " · hoje"}`,
    nav: (go) => go("funil", { lead: l.id }),
    wa: l.phone ? { phone: l.phone, label: "Chamar", msg: mensagemDaLead(l, data.meta) } : null,
  }));
  if (funil?.semRetorno) out.push({
    id: "lsr", event: false, icon: "🎯", tone: "rgba(140,154,120,.18)",
    title: `${funil.semRetorno} lead(s) sem retorno marcado`,
    sub: "Abra o funil e marque quando falar com cada uma",
    nav: (go) => go("funil"),
  });

  // 🎂 Aniversários nos próximos 7 dias — a lista completa fica na tela
  // Aniversariantes; aqui é só o aviso de quem está chegando.
  data.clients.forEach((c) => {
    const d = diasAteAniversario(c.birthday, t);
    if (d === null || d > 7) return;
    const idade = idadeQueFaz(c.birthday, t);
    out.push({
      id: "bd" + c.id, event: false, icon: "🎂", tone: "rgba(206,122,83,.16)",
      title: `Aniversário — ${c.name}`,
      sub: faltamLabel(d) + (idade ? ` · faz ${idade} anos` : ""),
      nav: (go) => go("aniversariantes"),
      wa: c.phone ? { phone: c.phone, label: "Parabenizar", msg: `Feliz aniversário, ${c.name.split(" ")[0]}! 🎉💚 Toda a equipe da Fios que Curam deseja um dia lindo pra você. Que venha mais um ano de muitos fios e muitas histórias! 🧶` } : null,
    });
  });

  return out;
}

function NotifRow({ n, nav, unread, onResolver }) {
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
        {n.pixAlerta && (
          <button className="btn sec sm" onClick={(e) => { e.stopPropagation(); onResolver(n.pixAlerta); }}>
            ✓ Resolvido
          </button>
        )}
      </div>
    </div>
  );
}

export function Notifications({ go }) {
  const { data, run } = useStore();
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

  /* Sai da lista só depois de confirmado: é dinheiro na conta, e o aviso some
     para todo mundo do painel. */
  const resolverPix = async (a) => {
    const ok = await confirmModal({
      title: "Pix resolvido?",
      message:
        `${a.clientName || "Pix sem cadastro"} · ${money(a.valorCents / 100)}\n\n${a.descricao}\n\n` +
        "Marque como resolvido só depois de devolver, abater ou remarcar. O aviso sai das notificações.",
      confirmLabel: "✓ Marcar como resolvido",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    try {
      await run(api.resolverPixAlerta(a.id));
      toast("Aviso do Pix marcado como resolvido.", "success");
    } catch { /* o erro já foi mostrado pelo run */ }
  };

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
            {events.map((n) => <NotifRow key={n.id} n={n} nav={nav} unread={n.time.getTime() > lastSeen} onResolver={resolverPix} />)}
            {reminders.length > 0 && <div className="notif-sep">Lembretes</div>}
            {reminders.map((n) => <NotifRow key={n.id} n={n} nav={nav} unread={false} />)}
          </div>
        </div>
      )}
    </div>
  );
}
