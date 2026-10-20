import { useState, useEffect } from "react";
import { api, getToken, setToken, isInstrutora, getNome, canAccess, getSession } from "./api.js";
import Usuarios from "./Usuarios.jsx";
import { canView, canEditView } from "./access.js";
import AdminLogin from "./AdminLogin.jsx";
import { useStore } from "./store.jsx";
import { useModal } from "./ui.jsx";
import { Dashboard, Agenda, Marcacoes, Clientes, Financeiro, Depoimentos, Aniversariantes } from "./views.jsx";
import { RelatorioVendas, RelatorioVagas, RelatorioPresentes } from "./Relatorios.jsx";
import { SlotForm, BookingForm, ClientForm } from "./modals.jsx";
import ClienteApp from "./ClienteApp.jsx";
import Config from "./Config.jsx";
import Disparo from "./Disparo.jsx";
import Campanhas, { CampanhaForm } from "./Campanhas.jsx";
import Funil, { LeadForm } from "./Funil.jsx";
import { exportBookingsCsv } from "./exports.js";
import ClientPortal from "./ClientPortal.jsx";
import FirstClassBooking from "./FirstClassBooking.jsx";
import { Notifications } from "./Notifications.jsx";
import { toast } from "./toast.jsx";

// O painel se atualiza sozinho a cada 25s e sempre que a aba volta ao foco
// (ver store.jsx) — por isso não há botão de atualizar na barra do topo.

// marca o aparelho como tablet da sala (quiosque), persistindo entre recargas
const KIOSK_KEY = "fqc_kiosk";

/* Endereços das telas públicas. O caminho é o endereço oficial — é ele que vai
   no WhatsApp e na landing, e é por isso que a aluna nunca precisa ver "/admin".
   Os hashes ficam como atalho antigo: link já enviado continua abrindo. */
const ROTAS_PUBLICAS = { "/portal": "portal", "/aluno": "portal", "/agendar": "cliente" };
function rotaPublica() {
  // "/portal/", "/portal", "/aluno/", "/aluno" são a mesma tela
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  if (ROTAS_PUBLICAS[p]) return ROTAS_PUBLICAS[p];
  const h = window.location.hash;
  return h === "#agendar" ? "cliente" : (h === "#portal" || h === "#aluno") ? "portal" : null;
}

const NAV = [
  { sep: "Operação" },
  { view: "dashboard", ic: "📊", label: "Painel" },
  { view: "agenda", ic: "📅", label: "Agenda" },
  { view: "marcacoes", ic: "📝", label: "Marcações" },
  { sep: "Relacionamento" },
  { view: "clientes", ic: "👩", label: "Alunos" },
  { view: "funil", ic: "🎯", label: "Funil de leads" },
  { view: "aniversariantes", ic: "🎂", label: "Aniversariantes" },
  { view: "disparo", ic: "📣", label: "Disparo WhatsApp" },
  { sep: "Financeiro" },
  { view: "financeiro", ic: "💰", label: "Financeiro" },
  { view: "rel-vendas", ic: "📈", label: "Relatório de vendas" },
  { view: "rel-vagas", ic: "🪑", label: "Relatório de vagas" },
  { view: "rel-presentes", ic: "🎁", label: "Relatório de presentes" },
  { view: "campanhas", ic: "🎟️", label: "Campanhas e códigos" },
  { sep: "Site" },
  { view: "depoimentos", ic: "⭐", label: "Depoimentos" },
  { sep: "Sistema" },
  { view: "acessos", ic: "🔐", label: "Usuários e acessos" },
  { view: "config", ic: "⚙️", label: "Configurações" },
];
const TITLES = {
  dashboard:    ["Painel",        "Visão geral da operação"],
  agenda:       ["Agenda",        "Horários e ocupação por unidade"],
  marcacoes:    ["Marcações",     "Novos e alunas com acesso — confirmações e remarcações"],
  clientes:     ["Alunos",        "Alunos, leads e novatos — CRM e contato direto"],
  funil:        ["Funil de leads", "Do primeiro contato até a matrícula — com quem falar e de onde vêm as alunas"],
  aniversariantes: ["Aniversariantes", "Quem faz aniversário na semana e no mês"],
  disparo:      ["Disparo WhatsApp", "Mensagem para várias alunas de uma vez, pelo WhatsApp oficial"],
  financeiro:   ["Financeiro",    "Mensalidades, cobranças e fluxo de caixa"],
  mensalistas:  ["Financeiro",    "Mensalidades, cobranças e fluxo de caixa"],
  recebimentos: ["Financeiro",    "Mensalidades, cobranças e fluxo de caixa"],
  "rel-vendas": ["Relatório de vendas", "O que entrou no período, por unidade e no total"],
  "rel-vagas":  ["Relatório de vagas",  "Capacidade, ocupação e tipos de aluna — por unidade e no total"],
  "rel-presentes": ["Relatório de presentes", "Aulas de presente dadas e o que aconteceu com elas — não é valor a receber"],
  campanhas:    ["Campanhas e códigos", "Vouchers de promoção: isenção, desconto, aula experimental e prêmios"],
  depoimentos:  ["Depoimentos",   "Gerencie os depoimentos exibidos no site"],
  acessos:      ["Usuários e acessos", "Usuários, perfis, permissões e histórico"],
  config:       ["Configurações", "Padrões do sistema, unidades e profissionais"],
};

export default function App() {
  const { data, error, reload } = useStore();
  const { open } = useModal();
  const [, accessChanged] = useState(0);
  const instrutora = isInstrutora();
  useEffect(() => {
    const update = () => accessChanged(n => n + 1);
    const sync = e => { if (e.key?.startsWith("fqc_admin_")) window.location.reload(); };
    window.addEventListener("fqc-access", update);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("fqc-access", update); window.removeEventListener("storage", sync); };
  }, []);
  const [view, setView] = useState(instrutora ? "agenda" : "dashboard");
  const [viewParams, setViewParams] = useState({});
  // Modo tablet (quiosque da sala): fica gravado para sobreviver a recarga do
  // aparelho. Entra com #tablet e sai com #sairtablet.
  const [kiosk, setKiosk] = useState(() => {
    const h = window.location.hash;
    if (h === "#sairtablet") { try { localStorage.removeItem(KIOSK_KEY); } catch {} return false; }
    if (h === "#tablet") { try { localStorage.setItem(KIOSK_KEY, "1"); } catch {} return true; }
    try { return localStorage.getItem(KIOSK_KEY) === "1"; } catch { return false; }
  });
  /* Rota das telas públicas. O endereço bonito é o caminho — /portal e
     /agendar — que é o que a aluna recebe por WhatsApp; ninguém precisa ver
     "/admin" para entrar no portal. Os hashes antigos (/admin/#portal) seguem
     valendo para não quebrar link já enviado. */
  const [mode, setMode] = useState(() => rotaPublica() || "admin");
  const fromSite = useState(() => !!rotaPublica())[0];
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (["#agendar", "#portal", "#aluno", "#tablet", "#sairtablet"].includes(window.location.hash)) {
      // Tira só o hash: o caminho (/portal, /aluno, /agendar) é o endereço da tela e fica.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  // Atalho global Ctrl+Z / Cmd+Z para desfazer inativação ou exclusão acidental no painel
  useEffect(() => {
    if (mode !== "admin" || getSession()?.role !== "admin") return;
    const handleKeyDown = async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        const active = document.activeElement;
        const tag = (active?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || active?.isContentEditable) {
          return;
        }
        e.preventDefault();
        try {
          const res = await api.undo();
          if (res?.ok && res?.undone) {
            toast(res.message || "Ação desfeita com sucesso! ↩️", "success");
            await reload();
          } else {
            toast(res?.message || "Nenhuma ação recente para desfazer.", "info");
          }
        } catch (err) {
          toast("Não foi possível desfazer: " + (err.message || "tente novamente"), "error");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, reload]);

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

  const go = (v, params = {}) => {

    if (v === "mensalistas") { v = "financeiro"; params = { tab: "operacao", ...params }; }
    if (v === "recebimentos") { v = "financeiro"; params = { tab: "metricas", ...params }; }
    if (!canView(v)) { toast("Seu perfil não tem acesso a esta tela.", "info"); return; }
    setView(v); setViewParams(params); setSidebarOpen(false);
  };
  const currentView = canView(view) ? view : NAV.find(n => n.view && canView(n.view))?.view;
  const somenteLeitura = !canEditView(currentView);
  const actions = {
    agenda: <button className="btn" onClick={() => open(<SlotForm />)}>＋ Novo horário</button>,
    marcacoes: <button className="btn" onClick={() => open(<BookingForm />)}>＋ Nova marcação</button>,
    clientes: <button className="btn" onClick={() => open(<ClientForm />)}>＋ Novo aluno</button>,
    funil: <button className="btn" onClick={() => open(<LeadForm />)}>＋ Nova lead</button>,
    campanhas: <button className="btn" onClick={() => open(<CampanhaForm />)}>＋ Nova campanha</button>,
  };
  const Body = {
    acessos: Usuarios,
    dashboard: Dashboard,
    agenda: Agenda,
    marcacoes: Marcacoes,
    clientes: Clientes,
    funil: Funil,
    aniversariantes: Aniversariantes,
    disparo: Disparo,
    financeiro: Financeiro,
    mensalistas: Financeiro,
    recebimentos: Financeiro,
    "rel-vendas": RelatorioVendas,
    "rel-vagas": RelatorioVagas,
    "rel-presentes": RelatorioPresentes,
    campanhas: Campanhas,
    depoimentos: Depoimentos,
    config: Config,
  }[currentView];
  const [tituloAtual, subtituloAtual] = TITLES[currentView] || ["Acesso ao painel", "Nenhum módulo liberado. Solicite um perfil à Admin."];
  const nav = NAV.filter((n, i) => n.view ? canView(n.view) : NAV.slice(i + 1, NAV.findIndex((m, j) => j > i && m.sep) < 0 ? undefined : NAV.findIndex((m, j) => j > i && m.sep)).some(m => m.view && canView(m.view)));

  return (
    <div className="app">
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <img src="/logo-1.PNG" alt="Fios que Curam" />
          <div><b>Fios que Curam</b><span>{instrutora ? "Instrutoras · consulta" : "Gestão · Fios que Curam"}</span></div>
        </div>
        {nav.map((n, i) => n.sep
          ? <div key={i} className="nav-sep">{n.sep}</div>
          : <button key={i} className={`nav-item ${currentView === n.view ? "active" : ""}`} onClick={() => go(n.view)}><span className="ic">{n.ic}</span> {n.label}</button>)}
        <div className="spacer" />
        <div className="side-foot">
          {instrutora ? "Acesso de consulta · somente leitura" : "Backend MySQL + Prisma · React"}
          {getSession()?.role === "admin" && <button onClick={() => setMode("cliente")}>👁 Ver como aluno</button>}
          {canAccess("relatorios") && <button onClick={() => exportBookingsCsv(data)}>⬇ Exportar marcações (CSV)</button>}
          <button onClick={async () => { try { await api.admin.logout(); } catch {} setToken(null); window.location.reload(); }}>🚪 Sair</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: ".8rem" }}>
            <button className="menu-btn" onClick={() => setSidebarOpen((o) => !o)}>☰</button>
            <div><h1>{tituloAtual}</h1><div className="sub">{subtituloAtual}</div></div>
          </div>
          <div className="topbar-right">{canEditView(currentView) && actions[currentView]}{getSession()?.role === "admin" && <Notifications go={go} />}</div>
        </div>
        <div className="content">
          {somenteLeitura && currentView && !["dashboard", "rel-vendas", "rel-vagas", "rel-presentes"].includes(currentView) && <p className="access-readonly-banner">Seu perfil permite somente consulta neste módulo.</p>}
          {Body ? <fieldset className="access-fieldset" disabled={currentView === "config" && somenteLeitura}><Body key={currentView} go={go} params={viewParams} somenteLeitura={somenteLeitura} /></fieldset> : <p>Nenhum módulo liberado. Solicite a revisão do seu perfil à Admin.</p>}
        </div>
      </div>
    </div>
  );
}
