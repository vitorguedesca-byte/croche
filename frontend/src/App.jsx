import { useState, useEffect } from "react";
import { api, getToken, setToken } from "./api.js";
import AdminLogin from "./AdminLogin.jsx";
import { useStore } from "./store.jsx";
import { useModal } from "./ui.jsx";
import { Dashboard, Agenda, Marcacoes, Clientes, Mensalistas, Recebimentos, Depoimentos } from "./views.jsx";
import { SlotForm, BookingForm, ClientForm } from "./modals.jsx";
import ClienteApp from "./ClienteApp.jsx";
import Config from "./Config.jsx";
import { exportBookingsCsv } from "./exports.js";
import ClientPortal from "./ClientPortal.jsx";
import FirstClassBooking from "./FirstClassBooking.jsx";
import { Notifications } from "./Notifications.jsx";

// Botão de atualizar + relógio de "atualizado há X". O painel também se
// recarrega sozinho a cada 25s (ver store.jsx).
function RefreshButton() {
  const { reload, refreshing, lastUpdated } = useStore();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const ago = () => {
    if (!lastUpdated) return "—";
    const s = Math.floor((Date.now() - lastUpdated) / 1000);
    if (s < 5) return "agora";
    if (s < 60) return `há ${s}s`;
    const m = Math.floor(s / 60);
    return `há ${m} min`;
  };
  return (
    <button className={`refresh-btn ${refreshing ? "spin" : ""}`} onClick={() => reload()} disabled={refreshing}
      title="Atualizar agora">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
      </svg>
      <span className="refresh-lbl">{refreshing ? "Atualizando…" : ago()}</span>
    </button>
  );
}

// marca o aparelho como tablet da sala (quiosque), persistindo entre recargas
const KIOSK_KEY = "fqc_kiosk";

const NAV = [
  { sep: "Operação" },
  { view: "dashboard", ic: "📊", label: "Painel" },
  { view: "agenda", ic: "📅", label: "Agenda" },
  { view: "marcacoes", ic: "📝", label: "Marcações" },
  { sep: "Relacionamento" },
  { view: "clientes", ic: "👩", label: "Alunos" },
  { view: "mensalistas", ic: "📅", label: "Mensalistas" },
  { view: "recebimentos", ic: "💰", label: "Recebimentos" },
  { sep: "Site" },
  { view: "depoimentos", ic: "⭐", label: "Depoimentos" },
  { sep: "Sistema" },
  { view: "config", ic: "⚙️", label: "Configurações" },
];
const TITLES = {
  dashboard:    ["Painel",        "Visão geral da operação"],
  agenda:       ["Agenda",        "Horários e ocupação por unidade"],
  marcacoes:    ["Marcações",     "Novos e alunas com acesso — confirmações e remarcações"],
  clientes:     ["Alunos",        "Alunos, leads e novatos — CRM e contato direto"],
  mensalistas:  ["Mensalistas",   "Mensalidades e boletos dos alunos mensalistas"],
  recebimentos: ["Recebimentos",  "Visão de receita por dia, semana e mês"],
  depoimentos:  ["Depoimentos",   "Gerencie os depoimentos exibidos no site"],
  config:       ["Configurações", "Padrões do sistema, unidades e profissionais"],
};

export default function App() {
  const { data, error } = useStore();
  const { open } = useModal();
  const [view, setView] = useState("dashboard");
  const [viewParams, setViewParams] = useState({});
  // Modo tablet (quiosque da sala): fica gravado para sobreviver a recarga do
  // aparelho. Entra com #tablet e sai com #sairtablet.
  const [kiosk, setKiosk] = useState(() => {
    const h = window.location.hash;
    if (h === "#sairtablet") { try { localStorage.removeItem(KIOSK_KEY); } catch {} return false; }
    if (h === "#tablet") { try { localStorage.setItem(KIOSK_KEY, "1"); } catch {} return true; }
    try { return localStorage.getItem(KIOSK_KEY) === "1"; } catch { return false; }
  });
  const [mode, setMode] = useState(() => {
    const h = window.location.hash;
    return h === "#agendar" ? "cliente" : h === "#portal" ? "portal" : "admin";
  });
  const fromSite = useState(() => window.location.hash === "#agendar" || window.location.hash === "#portal")[0];
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (["#agendar", "#portal", "#tablet", "#sairtablet"].includes(window.location.hash)) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // No tablet da sala o portal é a única tela: sem volta para o painel admin.
  if (kiosk) return <ClientPortal kiosk onSairKiosk={() => { try { localStorage.removeItem(KIOSK_KEY); } catch {} setKiosk(false); }} />;
  if (mode === "portal") return <ClientPortal onBack={fromSite ? () => window.history.back() : () => setMode("admin")} fromSite={fromSite} />;
  if (mode === "cliente") return <FirstClassBooking onBack={fromSite ? () => window.history.back() : () => setMode("admin")} fromSite={fromSite} />;

  // Painel admin exige login (usuário + senha)
  if (mode === "admin" && !getToken()) return <AdminLogin />;
  // Token inválido/expirado (ex.: servidor reiniciado) → volta ao login
  if (mode === "admin" && error && /restrito|faça login/i.test(error)) { setToken(null); return <AdminLogin />; }

  if (error) return <div className="empty" style={{ padding: "4rem" }}><div className="ic">🔌</div><p>Não consegui falar com o servidor.<br />Confira se o backend está rodando em <b>http://localhost:4000</b>.</p><p className="cli-sub">{error}</p></div>;
  if (!data) return <div className="empty" style={{ padding: "4rem" }}><div className="ic">🧶</div><p>Carregando…</p></div>;

  const go = (v, params = {}) => { setView(v); setViewParams(params); setSidebarOpen(false); };
  const actions = {
    agenda: <button className="btn" onClick={() => open(<SlotForm />)}>＋ Novo horário</button>,
    marcacoes: <button className="btn" onClick={() => open(<BookingForm />)}>＋ Nova marcação</button>,
    clientes: <button className="btn" onClick={() => open(<ClientForm />)}>＋ Novo aluno</button>,
  };
  const Body = { dashboard: Dashboard, agenda: Agenda, marcacoes: Marcacoes, clientes: Clientes, mensalistas: Mensalistas, recebimentos: Recebimentos, depoimentos: Depoimentos, config: Config }[view];

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <img src="/logo-1.PNG" alt="Fios que Curam" />
          <div><b>Fios que Curam</b><span>Gestão · por Inêz</span></div>
        </div>
        {NAV.map((n, i) => n.sep
          ? <div key={i} className="nav-sep">{n.sep}</div>
          : <button key={i} className={`nav-item ${view === n.view ? "active" : ""}`} onClick={() => go(n.view)}><span className="ic">{n.ic}</span> {n.label}</button>)}
        <div className="spacer" />
        <div className="side-foot">
          Backend MySQL + Prisma · React
          <button onClick={() => setMode("cliente")}>👁 Ver como aluno</button>
          <button onClick={() => exportBookingsCsv(data)}>⬇ Exportar marcações (CSV)</button>
          <button onClick={async () => { try { await api.admin.logout(); } catch {} setToken(null); window.location.reload(); }}>🚪 Sair</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: ".8rem" }}>
            <button className="menu-btn" onClick={() => setSidebarOpen((o) => !o)}>☰</button>
            <div><h1>{TITLES[view][0]}</h1><div className="sub">{TITLES[view][1]}</div></div>
          </div>
          <div className="topbar-right">{actions[view]}<RefreshButton /><Notifications go={go} /></div>
        </div>
        <div className="content">
          <Body go={go} params={viewParams} />
        </div>
      </div>
    </div>
  );
}
