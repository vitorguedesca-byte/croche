import { useState, useEffect } from "react";
import { useStore } from "./store.jsx";
import { useModal } from "./ui.jsx";
import { Dashboard, Agenda, Marcacoes, Clientes, Recebimentos, Depoimentos } from "./views.jsx";
import { SlotForm, BookingForm, ClientForm } from "./modals.jsx";
import ClienteApp from "./ClienteApp.jsx";
import Config from "./Config.jsx";
import { exportBookingsCsv } from "./exports.js";
import ClientPortal from "./ClientPortal.jsx";
import FirstClassBooking from "./FirstClassBooking.jsx";

const NAV = [
  { sep: "Operação" },
  { view: "dashboard", ic: "📊", label: "Painel" },
  { view: "agenda", ic: "📅", label: "Agenda" },
  { view: "marcacoes", ic: "📝", label: "Marcações" },
  { sep: "Relacionamento" },
  { view: "clientes", ic: "👩", label: "Clientes" },
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
  clientes:     ["Clientes",      "Clientes, leads e novatos — CRM e contato direto"],
  recebimentos: ["Recebimentos",  "Visão de receita por dia, semana e mês"],
  depoimentos:  ["Depoimentos",   "Gerencie os depoimentos exibidos no site"],
  config:       ["Configurações", "Padrões do sistema, unidades e profissionais"],
};

export default function App() {
  const { data, error } = useStore();
  const { open } = useModal();
  const [view, setView] = useState("dashboard");
  const [mode, setMode] = useState(() => {
    const h = window.location.hash;
    return h === "#agendar" ? "cliente" : h === "#portal" ? "portal" : "admin";
  });
  const fromSite = useState(() => window.location.hash === "#agendar" || window.location.hash === "#portal")[0];
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (window.location.hash === "#agendar" || window.location.hash === "#portal") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (mode === "portal") return <ClientPortal onBack={fromSite ? () => window.history.back() : () => setMode("admin")} fromSite={fromSite} />;
  if (mode === "cliente") return <FirstClassBooking onBack={fromSite ? () => window.history.back() : () => setMode("admin")} fromSite={fromSite} />;

  if (error) return <div className="empty" style={{ padding: "4rem" }}><div className="ic">🔌</div><p>Não consegui falar com o servidor.<br />Confira se o backend está rodando em <b>http://localhost:4000</b>.</p><p className="cli-sub">{error}</p></div>;
  if (!data) return <div className="empty" style={{ padding: "4rem" }}><div className="ic">🧶</div><p>Carregando…</p></div>;

  const go = (v) => { setView(v); setSidebarOpen(false); };
  const actions = {
    agenda: <button className="btn" onClick={() => open(<SlotForm />)}>＋ Novo horário</button>,
    marcacoes: <button className="btn" onClick={() => open(<BookingForm />)}>＋ Nova marcação</button>,
    clientes: <button className="btn" onClick={() => open(<ClientForm />)}>＋ Novo cliente</button>,
  };
  const Body = { dashboard: Dashboard, agenda: Agenda, marcacoes: Marcacoes, clientes: Clientes, recebimentos: Recebimentos, depoimentos: Depoimentos, config: Config }[view];

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
          <button onClick={() => setMode("cliente")}>👁 Ver como cliente</button>
          <button onClick={() => exportBookingsCsv(data)}>⬇ Exportar marcações (CSV)</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: ".8rem" }}>
            <button className="menu-btn" onClick={() => setSidebarOpen((o) => !o)}>☰</button>
            <div><h1>{TITLES[view][0]}</h1><div className="sub">{TITLES[view][1]}</div></div>
          </div>
          <div>{actions[view]}</div>
        </div>
        <div className="content">
          <Body go={go} />
        </div>
      </div>
    </div>
  );
}
