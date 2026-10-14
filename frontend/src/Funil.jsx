import { useState, useEffect, useMemo } from "react";
import { useStore } from "./store.jsx";
import { Modal, Select, useModal } from "./ui.jsx";
import { api } from "./api.js";
import { toast, confirmModal } from "./toast.jsx";
import { ClientProfile } from "./modals.jsx";
import { WaIcon } from "./icons.jsx";
import { exportCsv } from "./exports.js";
import { Periodo, intervalo } from "./Relatorios.jsx";
import { todayISO, addDays, fmtDate, waLink, contemBusca, money, unitColor } from "./helpers.js";

/* ============================================================
   Funil de leads (Vitor, 14/10/2026)

   Do primeiro "oi" até a matrícula, num quadro por etapas. A
   ETAPA é calculada pelo servidor a partir dos fatos (ficha,
   reserva da 1ª aula, pagamento, plano) — ninguém arrasta um
   cartão para "matriculada". O que é da equipe fica na ficha
   da lead: de onde ela veio, quando falar de novo, o que foi
   conversado e, se for o caso, por que ela foi perdida.

   Abas:
   • Quadro    — as leads em aberto, uma coluna por etapa;
   • Retornos  — com quem falar hoje (e quem ficou para trás);
   • Perdidas  — com o motivo, e o botão de reabrir;
   • Relatório — do contato à matrícula, por origem e unidade.

   Regras: backend/src/funil.js. Rotas: /api/funil no server.js.
   ============================================================ */

// O botão "＋ Nova lead" mora na barra do topo (App.jsx): avisa a tela para recarregar.
const EVENTO_RECARREGAR = "fqc:funil";
export const avisarFunil = () => window.dispatchEvent(new Event(EVENTO_RECARREGAR));

export const ETAPAS = [
  { k: "contato", ic: "💬", l: "Primeiro contato", dica: "Falou com o robô ou foi anotada pela equipe — ainda sem ficha." },
  { k: "cadastro", ic: "📝", l: "Cadastro feito", dica: "Tem ficha, mas nenhuma 1ª aula em pé." },
  { k: "marcada", ic: "🗓️", l: "1ª aula marcada", dica: "Aula avulsa ou matrícula com a aula por vir — paga ou com o Pix pendente." },
  { k: "aula", ic: "🧶", l: "Depois da avulsa", dica: "A aula avulsa passou e ela ainda não fechou o plano: hora de convidar." },
  { k: "matriculada", ic: "🎓", l: "Matriculada", dica: "Pagou a matrícula e virou aluna. Aqui ficam as dos últimos 30 dias." },
];
const PERDIDA = { k: "perdida", ic: "✖", l: "Perdida" };
const ETAPA = Object.fromEntries([...ETAPAS, PERDIDA].map((e) => [e.k, e]));
const ABERTAS = ["contato", "cadastro", "marcada", "aula"];

export const ORIGENS = [
  { value: "anuncio", label: "Anúncio (Meta ou Google)", curto: "Anúncio", icon: "📣" },
  { value: "redes", label: "Instagram / Facebook", curto: "Instagram/Face", icon: "📸" },
  { value: "indicacao", label: "Indicação", icon: "🤝" },
  { value: "google", label: "Busca no Google", curto: "Google", icon: "🔎" },
  { value: "porta", label: "Passou na escola", icon: "🚪" },
  { value: "evento", label: "Evento / feira", curto: "Evento", icon: "🎪" },
  { value: "outro", label: "Outra", icon: "✳️" },
];
const ORIGEM = Object.fromEntries(ORIGENS.map((o) => [o.value, o]));
const OPCOES_ORIGEM = [{ value: "", label: "Não sei ainda", icon: "❔" }, ...ORIGENS];
const CANAL = { whatsapp: "💬 WhatsApp", site: "🌐 Site", escola: "🏫 Escola" };

// Mesmas chaves de MOTIVOS_PERDA em backend/src/funil.js
const MOTIVOS = [
  { value: "preco", label: "Achou caro", icon: "💸" },
  { value: "horario", label: "Horário não serve", icon: "🕒" },
  { value: "distancia", label: "Longe / mudou de cidade", icon: "📍" },
  { value: "sem_tempo", label: "Sem tempo agora", icon: "⏳" },
  { value: "sem_resposta", label: "Parou de responder", icon: "🔕" },
  { value: "outra_escola", label: "Foi para outra escola", icon: "🏫" },
  { value: "nao_lead", label: "Não era lead (engano/spam)", icon: "🚫", hint: "Sai das contas do relatório" },
  { value: "outro", label: "Outro motivo", icon: "✳️" },
];
const MOTIVO = Object.fromEntries(MOTIVOS.map((m) => [m.value, m]));

/* ----------------- datas ----------------- */
// Dia de Brasília de um createdAt (UTC). slice(0, 10) erra das 21h à meia-noite.
const diaDe = (d) => (d ? new Date(d).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : "");
const diasDesde = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
const haDias = (n) => (n === 0 ? "hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`);
const quandoFoi = (d) => {
  const dia = diaDe(d);
  const hora = new Date(d).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${dia === todayISO() ? "hoje" : fmtDate(dia)} às ${hora}`;
};
const tempoNaEtapa = (l) => {
  const n = diasDesde(l.etapaDesde);
  return n === 0 ? "chegou nesta etapa hoje" : `nesta etapa há ${n} dia${n > 1 ? "s" : ""}`;
};
const diasEntre = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 86400000);

/* Retorno marcado: atrasado, hoje ou futuro — o que a equipe precisa ver no cartão. */
function Retorno({ lead }) {
  const p = lead.proximoContato;
  if (!p || !ABERTAS.includes(lead.etapa)) return null;
  const hoje = todayISO();
  if (p < hoje) return <span className="badge b-danger" title="Retorno atrasado">⏰ desde {fmtDate(p)}</span>;
  if (p === hoje) return <span className="badge b-warn">⏰ hoje</span>;
  return <span className="badge b-muted">⏰ {fmtDate(p)}</span>;
}

/* Mensagem pronta para o botão de WhatsApp, conforme a etapa. Abre no
   WhatsApp da escola (wa.me) — dá para editar antes de mandar, e não é
   mensagem da API (não é cobrada pela Meta). */
export function mensagemDaLead(lead, meta = {}) {
  const nome = String(lead?.nome || "").trim().split(/\s+/)[0];
  const oi = nome && !/^contato$/i.test(nome) ? `Oi, ${nome}!` : "Oi!";
  const det = lead?.detalhe || "";
  const plano1x = Number(meta.valorPlano1x) || 0;
  switch (lead?.etapa) {
    case "contato":
      // parou no site, no plano e pagamento: a aula que ela escolheu está guardada
      if (det.startsWith("parou no site") || det.includes("pelo site")) {
        return `${oi} Aqui é da Fios que Curam 💚 Vi que você começou a marcar sua primeira aula pelo site${lead.siteAula ? ` (${lead.siteAula})` : ""}. Ficou alguma dúvida sobre os planos ou o pagamento? Posso te ajudar a concluir!`;
      }
      return `${oi} Aqui é da Fios que Curam 💚 Vi que você começou a marcar sua aula de crochê com a gente. Posso te ajudar a escolher o melhor horário?`;
    case "cadastro":
      return `${oi} Tudo bem? 💚 Seu cadastro na Fios que Curam já está feito — só falta escolher o horário da sua primeira aula. Quer que eu te mande os horários com vaga${lead.unit ? ` em ${lead.unit}` : ""}?`;
    case "marcada":
      return det.includes("Pix pendente")
        ? `${oi} 💚 Sua aula está reservada, mas o pagamento ainda não apareceu aqui. Ficou alguma dúvida com o Pix? Posso te ajudar a concluir.`
        : `${oi} 💚 Tudo certo para a sua primeira aula! Qualquer dúvida sobre o endereço ou o material, é só me chamar. Até lá! 🧶`;
    case "aula":
      return det.startsWith("faltou")
        ? `${oi} 💚 Sentimos sua falta na aula. Quer remarcar? Me fala o melhor dia que eu vejo os horários com vaga.`
        : `${oi} 💚 Que alegria ter você com a gente na aula! O que achou? Se quiser continuar, os planos começam em ${plano1x ? money(plano1x) : "um valor bem acessível"} por mês, com 1 aula por semana. Posso te mostrar os horários?`;
    case "matriculada":
      return `${oi} 💚 Seja muito bem-vinda à Fios que Curam! Qualquer dúvida, é só chamar.`;
    default:
      return `${oi} Tudo bem? 💚 Aqui é da Fios que Curam. Abrimos novos horários de aula de crochê — quer que eu te mande as opções?`;
  }
}

/* ----------------- carregar a lista ----------------- */
function useLeads() {
  const [leads, setLeads] = useState(null);
  const carregar = async () => {
    try { setLeads((await api.funil.list()).leads); }
    catch (e) { toast.error("Não consegui carregar o funil: " + e.message); setLeads((l) => l || []); }
  };
  useEffect(() => {
    carregar();
    window.addEventListener(EVENTO_RECARREGAR, carregar);
    // sozinho a cada minuto, como o resto do painel (que se atualiza a cada 25s)
    const t = setInterval(() => { if (!document.hidden) carregar(); }, 60000);
    return () => { window.removeEventListener(EVENTO_RECARREGAR, carregar); clearInterval(t); };
  }, []);
  return leads;
}

/* ============================================================
   Janelas: nova lead, registrar contato, dar como perdida, ficha
   ============================================================ */

/* Escolha de data por botão (hoje, amanhã, 3 dias, 1 semana) ou no calendário. */
function EscolherData({ value, onChange, semData = "Sem retorno" }) {
  const hoje = todayISO();
  const atalhos = [["Hoje", hoje], ["Amanhã", addDays(hoje, 1)], ["Em 3 dias", addDays(hoje, 3)], ["Em 1 semana", addDays(hoje, 7)]];
  return (
    <div className="fn-datas">
      {atalhos.map(([l, d]) => (
        <button key={l} type="button" className={`btn sm ${value === d ? "" : "ghost"}`} onClick={() => onChange(d)}>{l}</button>
      ))}
      <input type="date" value={value || ""} min={hoje} onChange={(e) => onChange(e.target.value || "")} style={{ width: "auto", minWidth: 150 }} />
      <button type="button" className={`btn sm ${!value ? "" : "ghost"}`} onClick={() => onChange("")}>{semData}</button>
    </div>
  );
}

export function LeadForm({ lead }) {
  const { data } = useStore();
  const { open, close } = useModal();
  const units = data?.meta?.units || [];
  const [f, setF] = useState(() => ({
    nome: lead?.nome || "", phone: lead?.phone || "", unit: lead?.unit || "",
    origem: lead?.origem || "", origemDetalhe: lead?.origemDetalhe || "", nota: "", proximoContato: lead ? lead.proximoContato || "" : addDays(todayISO(), 1),
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const temFicha = !!lead?.clientId;

  const salvar = async () => {
    if (f.nome.trim().length < 2) return toast.error("Escreva o nome da lead.");
    const dig = f.phone.replace(/\D/g, "");
    if (dig && dig.length < 10) return toast.error("WhatsApp com DDD, ex.: (31) 99999-8888.");
    const resumo = [
      `${f.nome.trim()}${dig ? ` · ${f.phone}` : " · sem WhatsApp"}`,
      f.unit ? `Unidade: ${f.unit}` : null,
      `Origem: ${f.origem ? ORIGEM[f.origem].label : "não informada"}${f.origemDetalhe.trim() ? ` (${f.origemDetalhe.trim()})` : ""}`,
      !lead ? (f.proximoContato ? `Retorno: ${fmtDate(f.proximoContato)}` : "Sem retorno marcado") : null,
    ].filter(Boolean).join("\n");
    const ok = await confirmModal({ title: lead ? "Salvar a lead" : "Anotar lead", message: resumo, confirmLabel: lead ? "Salvar" : "Anotar" });
    if (!ok) return;
    setBusy(true);
    try {
      if (lead) {
        const corpo = { origem: f.origem || null, origemDetalhe: f.origemDetalhe };
        if (!temFicha) Object.assign(corpo, { nome: f.nome, phone: f.phone, unit: f.unit });
        await api.funil.update(lead.id, corpo);
        toast("Lead salva.");
        avisarFunil();
        open(<LeadFicha id={lead.id} />);
      } else {
        const nova = await api.funil.create(f);
        toast("Lead anotada no funil. 🎯");
        avisarFunil();
        open(<LeadFicha id={nova.id} />);
      }
    } catch (e) {
      if (e.data?.leadId) {
        const abrir = await confirmModal({ title: "Já está no funil", message: `${e.message}\n\nAbrir a ficha dela?`, confirmLabel: "Abrir a ficha" });
        if (abrir) open(<LeadFicha id={e.data.leadId} />);
      } else toast.error(e.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal size="md" title={lead ? `Editar lead · ${lead.nome}` : "Nova lead"} footer={<>
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={lead ? () => open(<LeadFicha id={lead.id} />) : close}>{lead ? "Voltar" : "Cancelar"}</button>
      <button className="btn" onClick={salvar} disabled={busy}>{busy ? "Salvando…" : lead ? "Salvar" : "Anotar lead"}</button>
    </>}>
      <div className="cfg-sec" style={{ padding: 0 }}>
        {!lead && <div className="help" style={{ marginTop: 0, marginBottom: "1rem" }}>Para quem chamou no Instagram, ligou ou passou na escola. Quem fala com o robô do WhatsApp ou marca pelo site entra no funil sozinha.</div>}
        {temFicha && <div className="help" style={{ marginTop: 0, marginBottom: "1rem" }}>Nome, WhatsApp e unidade vêm da ficha da aluna — corrija lá, em Alunos.</div>}
        <div className="row2">
          <div className="field">
            <label>Nome</label>
            <input value={f.nome} disabled={temFicha} onChange={(e) => set("nome", e.target.value)} placeholder="ex.: Maria Aparecida" />
          </div>
          <div className="field">
            <label>WhatsApp</label>
            <input value={f.phone} disabled={temFicha} inputMode="tel" onChange={(e) => set("phone", e.target.value)} placeholder="(31) 99999-8888" />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Unidade</label>
            <Select value={f.unit} onChange={(v) => set("unit", v)} disabled={temFicha}
              options={[{ value: "", label: "Ainda não sabe", icon: "📍" }, ...units.map((u) => ({ value: u, label: u, icon: "📍" }))]} />
          </div>
          <div className="field">
            <label>De onde veio</label>
            <Select value={f.origem} onChange={(v) => set("origem", v)} options={OPCOES_ORIGEM} />
          </div>
        </div>
        <div className="field">
          <label>Detalhe da origem (opcional)</label>
          <input value={f.origemDetalhe} onChange={(e) => set("origemDetalhe", e.target.value)} placeholder="ex.: indicação da Ana Paula · @maria.croche no Instagram · anúncio de outubro" />
        </div>
        {!lead && <>
          <div className="field">
            <label>Anotação (opcional)</label>
            <textarea value={f.nota} onChange={(e) => set("nota", e.target.value)} placeholder="ex.: quer aula à noite, tem uma filha de 12 anos que também quer fazer" />
          </div>
          <div className="field">
            <label>Quando falar com ela de novo</label>
            <EscolherData value={f.proximoContato} onChange={(v) => set("proximoContato", v)} />
          </div>
        </>}
      </div>
    </Modal>
  );
}

/* Registrar contato: o que foi conversado e quando falar de novo. Abre
   sozinho depois do botão de WhatsApp — é o que mantém o retorno em dia. */
function RegistrarContato({ lead, texto: textoInicial = "" }) {
  const { open } = useModal();
  const [texto, setTexto] = useState(textoInicial);
  const [prox, setProx] = useState(lead.proximoContato && lead.proximoContato > todayISO() ? lead.proximoContato : addDays(todayISO(), 3));
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    setBusy(true);
    try {
      await api.funil.evento(lead.id, { tipo: "contato", texto, proximoContato: prox || null });
      toast(prox ? `Contato registrado. Retorno em ${fmtDate(prox)}.` : "Contato registrado.");
      avisarFunil();
      open(<LeadFicha id={lead.id} />);
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <Modal size="md" title={`Contato com ${lead.nome}`} footer={<>
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={() => open(<LeadFicha id={lead.id} />)}>Não registrar</button>
      <button className="btn" onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Registrar contato"}</button>
    </>}>
      <div className="cfg-sec" style={{ padding: 0 }}>
        <div className="field">
          <label>Como foi? (opcional)</label>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ex.: mandei os horários de Timóteo; ela vai ver com o marido e responde amanhã" />
        </div>
        <div className="field">
          <label>Quando falar com ela de novo</label>
          <EscolherData value={prox} onChange={setProx} />
          <div className="help">No dia, ela aparece em Retornos e nas notificações.</div>
        </div>
      </div>
    </Modal>
  );
}

function Anotacao({ lead }) {
  const { open } = useModal();
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (!texto.trim()) return toast.error("Escreva a anotação.");
    setBusy(true);
    try {
      await api.funil.evento(lead.id, { tipo: "nota", texto });
      toast("Anotação salva.");
      open(<LeadFicha id={lead.id} />);
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <Modal size="md" title={`Anotação · ${lead.nome}`} footer={<>
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={() => open(<LeadFicha id={lead.id} />)}>Voltar</button>
      <button className="btn" onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Salvar anotação"}</button>
    </>}>
      <div className="field">
        <label>Anotação</label>
        <textarea autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ex.: prefere sábado de manhã; perguntou se pode levar a neta" />
      </div>
    </Modal>
  );
}

function DarComoPerdida({ lead }) {
  const { open } = useModal();
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (!motivo) return toast.error("Escolha o motivo.");
    const ok = await confirmModal({
      title: "Dar como perdida",
      message: `${lead.nome}: ${MOTIVO[motivo].label}${texto.trim() ? ` — ${texto.trim()}` : ""}\n\nEla sai do quadro e o retorno marcado é desmarcado. Se ela voltar a falar no WhatsApp ou marcar pelo site, volta sozinha para o funil.`,
      confirmLabel: "Dar como perdida", tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.funil.perder(lead.id, motivo, texto);
      toast("Lead marcada como perdida.");
      avisarFunil();
      open(<LeadFicha id={lead.id} />);
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <Modal size="md" title={`Dar como perdida · ${lead.nome}`} footer={<>
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={() => open(<LeadFicha id={lead.id} />)}>Voltar</button>
      <button className="btn danger" onClick={salvar} disabled={busy || !motivo}>{busy ? "Salvando…" : "Dar como perdida"}</button>
    </>}>
      <div className="cfg-sec" style={{ padding: 0 }}>
        <div className="field">
          <label>Por quê?</label>
          <Select value={motivo} onChange={setMotivo} options={MOTIVOS} placeholder="Escolha o motivo" />
          <div className="help">O motivo vai para o relatório — é ele que mostra o que mais faz a escola perder aluna.</div>
        </div>
        <div className="field">
          <label>Detalhe (opcional)</label>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ex.: só pode à noite e a turma da noite está lotada" />
        </div>
      </div>
    </Modal>
  );
}

const ICONE_EVENTO = { nota: "📝", contato: "📞", etapa: "➡️", perdida: "✖", reaberta: "↩️", sistema: "•" };

/* A ficha da lead: onde ela está, o caminho até aqui, o que fazer agora. */
export function LeadFicha({ id }) {
  const { data } = useStore();
  const { open, close } = useModal();
  const [lead, setLead] = useState(null);
  const [erro, setErro] = useState("");
  const [prox, setProx] = useState(null); // retorno escolhido, ainda não salvo
  const [busy, setBusy] = useState(false);

  const carregar = async () => {
    try { const l = await api.funil.get(id); setLead(l); setProx(null); }
    catch (e) { setErro(e.message); }
  };
  useEffect(() => { carregar(); }, [id]);

  if (!lead) {
    return (
      <Modal size="md" title="Lead" footer={<button className="btn ghost" onClick={close}>Fechar</button>}>
        <div className="empty"><div className="ic">{erro ? "⚠️" : "🧶"}</div><p>{erro || "Carregando…"}</p></div>
      </Modal>
    );
  }

  const e = ETAPA[lead.etapa] || ETAPA.contato;
  const aberta = ABERTAS.includes(lead.etapa);
  const ficha = lead.clientId ? (data?.clients || []).find((c) => c.id === lead.clientId) : null;
  const msg = mensagemDaLead(lead, data?.meta);
  const chamar = () => {
    window.open(waLink(lead.phone, msg), "_blank");
    open(<RegistrarContato lead={lead} texto="Mandei mensagem pelo WhatsApp." />);
  };
  const salvarRetorno = async () => {
    setBusy(true);
    try {
      await api.funil.update(lead.id, { proximoContato: prox || null });
      toast(prox ? `Retorno marcado para ${fmtDate(prox)}.` : "Retorno desmarcado.");
      avisarFunil();
      await carregar();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };
  const reabrir = async () => {
    const ok = await confirmModal({ title: "Reabrir lead", message: `${lead.nome} volta para o quadro, na etapa em que estiver.`, confirmLabel: "Reabrir" });
    if (!ok) return;
    try { await api.funil.reabrir(lead.id); toast("Lead reaberta."); avisarFunil(); await carregar(); }
    catch (err) { toast.error(err.message); }
  };

  const entrou = diaDe(lead.createdAt);
  const marcos = [
    { l: "Entrou no funil", d: entrou, extra: lead.canal ? CANAL[lead.canal] : "antes do funil" },
    // ficha mais antiga que a lead (cadastro de outra época): conta do dia em que ela entrou
    { l: "Fez o cadastro", d: ficha ? [diaDe(ficha.createdAt), entrou].sort()[1] : lead.marcouAt, ok: !!(lead.clientId || lead.marcouAt) },
    { l: "Marcou a 1ª aula", d: lead.marcouAt },
    { l: "Pagou a entrada", d: lead.pagouAt },
    { l: "Matriculou", d: lead.ganhaAt },
  ];
  const utm = lead.utm || {};
  const pistas = [utm.utm_source && `fonte: ${utm.utm_source}`, utm.utm_medium && `meio: ${utm.utm_medium}`, utm.utm_campaign && `campanha: ${utm.utm_campaign}`,
    utm.utm_content && `anúncio: ${utm.utm_content}`, utm.headline && `anúncio: “${utm.headline}”`, utm.referrer && `veio de: ${utm.referrer.replace(/^https?:\/\//, "").split("/")[0]}`].filter(Boolean);
  const prontoParaSalvar = prox !== null && (prox || null) !== (lead.proximoContato || null);

  return (
    <Modal size="md" title={lead.nome}
      subheader={<div className="day-sub">
        <span className={`badge ${lead.etapa === "perdida" ? "b-danger" : lead.etapa === "matriculada" ? "b-ok" : "b-terra"}`}>{e.ic} {e.l}</span>
        {lead.detalhe ? <> · {lead.detalhe}</> : null} · {tempoNaEtapa(lead)}
      </div>}
      footer={<button className="btn ghost" onClick={close}>Fechar</button>}>
      <div className="cfg-sec" style={{ padding: 0 }}>
        <div className="fn-acoes">
          {lead.phone && <button className="btn wa sm" onClick={chamar}><WaIcon /> Mandar mensagem</button>}
          <button className="btn sec sm" onClick={() => open(<RegistrarContato lead={lead} />)}>📞 Registrar contato</button>
          <button className="btn ghost sm" onClick={() => open(<Anotacao lead={lead} />)}>📝 Anotação</button>
          <button className="btn ghost sm" onClick={() => open(<LeadForm lead={lead} />)}>✏️ Editar</button>
          {ficha && <button className="btn ghost sm" onClick={() => open(<ClientProfile client={ficha} />)}>👩 Ficha da aluna</button>}
          {aberta && <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => open(<DarComoPerdida lead={lead} />)}>✖ Perdida</button>}
          {lead.etapa === "perdida" && lead.perdidaAt && <button className="btn ok sm" onClick={reabrir}>↩️ Reabrir</button>}
        </div>

        <div className="row2" style={{ alignItems: "start" }}>
          <div className="field">
            <label>Contato</label>
            <div>{lead.phone ? lead.phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") : "sem WhatsApp"}{lead.unit ? <> · <span className="chip" style={{ color: unitColor(lead.unit) }}>{lead.unit}</span></> : null}</div>
            {lead.ultimoContatoAt && <div className="help">Último contato: {quandoFoi(lead.ultimoContatoAt)}</div>}
          </div>
          <div className="field">
            <label>De onde veio</label>
            <div>{lead.origem ? `${ORIGEM[lead.origem]?.icon || ""} ${ORIGEM[lead.origem]?.label || lead.origem}` : <span style={{ color: "var(--warn)" }}>❔ Não informada — pergunte a ela</span>}</div>
            {lead.origemDetalhe && <div className="help">{lead.origemDetalhe}</div>}
            {pistas.length > 0 && <div className="help">{pistas.join(" · ")}</div>}
          </div>
        </div>

        {aberta && (
          <div className="field">
            <label>Próximo contato {lead.proximoContato ? <span className="field-subtext">marcado para {fmtDate(lead.proximoContato)}</span> : null}</label>
            <EscolherData value={prox ?? lead.proximoContato ?? ""} onChange={setProx} />
            {prontoParaSalvar && (
              <div style={{ marginTop: ".5rem" }}>
                <button className="btn sm" onClick={salvarRetorno} disabled={busy}>{busy ? "Salvando…" : prox ? `Salvar retorno para ${fmtDate(prox)}` : "Desmarcar retorno"}</button>
                <button className="btn ghost sm" style={{ marginLeft: ".4rem" }} onClick={() => setProx(null)}>Cancelar</button>
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label>O caminho dela</label>
          <div className="fn-jornada">
            {marcos.map((m, i) => {
              const feito = i === 0 || (m.ok ?? !!m.d);
              return (
                <div key={m.l} className={`fn-marco${feito ? " ok" : ""}`}>
                  <span className="pt">{feito ? "✓" : i + 1}</span>
                  <span>{m.l}</span>
                  <span className="cli-sub" style={{ marginLeft: "auto" }}>{feito ? [m.d ? fmtDate(m.d) : "", m.extra].filter(Boolean).join(" · ") : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Histórico</label>
          <div className="fn-hist">
            {(lead.eventos || []).map((ev) => (
              <div key={ev.id} className="fn-ev">
                <span style={{ width: 18, textAlign: "center", flex: "none" }}>{ICONE_EVENTO[ev.tipo] || "•"}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ev.texto}</div>
                  <div className="q">{quandoFoi(ev.createdAt)}{ev.por ? ` · ${ev.por}` : ""}</div>
                </div>
              </div>
            ))}
            {!(lead.eventos || []).length && <div className="cli-sub">Nada registrado ainda.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
   Quadro
   ============================================================ */
function CartaoLead({ lead, meta, onAbrir, onChamar }) {
  return (
    <div className="fn-card" role="button" tabIndex={0} onClick={onAbrir} onKeyDown={(e) => { if (e.key === "Enter") onAbrir(); }}>
      <div className="fn-card-top">
        <span className="fn-card-nome">{lead.nome}</span>
        <span className="fn-card-dias" title="Tempo nesta etapa">{haDias(diasDesde(lead.etapaDesde))}</span>
      </div>
      {lead.detalhe && <div className="fn-card-det">{lead.detalhe}</div>}
      <div className="fn-card-pe">
        {lead.unit && <span className="chip" style={{ color: unitColor(lead.unit) }}>{lead.unit}</span>}
        {lead.origem
          ? <span className="badge b-sage" title={lead.origemDetalhe || ""}>{ORIGEM[lead.origem]?.icon} {ORIGEM[lead.origem]?.label || lead.origem}</span>
          : <span className="badge b-muted" title="Origem não informada — pergunte a ela e anote na ficha">❔ origem?</span>}
        <Retorno lead={lead} />
        {lead.phone && (
          <button className="btn wa sm" title="Mandar mensagem no WhatsApp" onClick={(e) => { e.stopPropagation(); onChamar(); }}><WaIcon /></button>
        )}
      </div>
    </div>
  );
}

const POR_COLUNA = 40; // cartões por coluna antes do "ver mais"

function Quadro({ leads, meta, abrir, chamar }) {
  const [mais, setMais] = useState({});
  const hoje = todayISO();
  const limiteMatricula = addDays(hoje, -30);
  return (
    <div className="fn-quadro"><div className="fn-board">
      {ETAPAS.map((e) => {
        let lista = leads.filter((l) => l.etapa === e.k);
        if (e.k === "matriculada") lista = lista.filter((l) => (l.ganhaAt || "") >= limiteMatricula);
        // retorno vencido/de hoje primeiro; depois quem entrou na etapa mais recentemente
        lista.sort((a, b) => {
          const ra = a.proximoContato && a.proximoContato <= hoje ? 0 : 1;
          const rb = b.proximoContato && b.proximoContato <= hoje ? 0 : 1;
          return ra - rb || new Date(b.etapaDesde) - new Date(a.etapaDesde);
        });
        const visiveis = mais[e.k] ? lista : lista.slice(0, POR_COLUNA);
        return (
          <div key={e.k} className="fn-col">
            <div className="fn-col-h"><span>{e.ic}</span><span>{e.l}</span><span className="seg-count">{lista.length}</span></div>
            <div className="fn-col-dica">{e.dica}</div>
            {visiveis.map((l) => <CartaoLead key={l.id} lead={l} meta={meta} onAbrir={() => abrir(l)} onChamar={() => chamar(l)} />)}
            {!lista.length && <div className="fn-vazio">Ninguém aqui.</div>}
            {lista.length > visiveis.length && (
              <button className="btn ghost sm" onClick={() => setMais((m) => ({ ...m, [e.k]: true }))}>Ver mais {lista.length - visiveis.length}</button>
            )}
          </div>
        );
      })}
    </div></div>
  );
}

/* ============================================================
   Relatório: do contato à matrícula
   ============================================================ */
const PERIODOS_FUNIL = [["semana", "📆 Semana"], ["mes", "🗓 Mês"], ["ano", "📅 Ano"]];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const mediana = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/* Uma barra por grupo (origem, canal, unidade): o comprimento é quantas
   leads chegaram; a parte verde, quantas matricularam. */
function BarrasDeConversao({ grupos }) {
  const max = Math.max(1, ...grupos.map((g) => g.leads));
  return (
    <div className="vg-barras">
      {grupos.map((g) => (
        <div key={g.k} className="vg-barra-l">
          <div className="vg-barra-nome"><span>{g.ic}</span><span>{g.l}</span></div>
          <div className="vg-barra" title={`${g.leads} lead(s) · ${g.ganhas} matrícula(s)`}>
            <div style={{ width: `${(g.ganhas / max) * 100}%`, background: "var(--green-deep)" }} />
            <div style={{ width: `${((g.leads - g.ganhas) / max) * 100}%`, background: "var(--sand)" }} />
          </div>
          <div className="vg-barra-num">
            <div><b>{g.leads}</b> lead(s) · <b style={{ color: "var(--green-deep)" }}>{g.ganhas}</b> matrícula(s)</div>
            <div>{pct(g.ganhas, g.leads)}% viraram aluna</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* Barras centradas que encolhem a cada degrau, com quantos seguiram entre um
   e outro — o mesmo desenho para o funil das leads e para o do /agendar. */
function Degraus({ degraus }) {
  const base = degraus[0]?.n || 0;
  return (
    <div className="fn-funil">
      {degraus.map((d, i) => (
        <div key={d.l}>
          {i > 0 && <div className="fn-passo">↓ {pct(d.n, degraus[i - 1].n)}% seguiram</div>}
          <div className="fn-degrau">
            <div className="fn-degrau-l">{d.l}</div>
            <div className="fn-degrau-barra"><div style={{ width: `${Math.max(1, pct(d.n, base))}%`, opacity: 1 - i * 0.1 }} /></div>
            <div className="fn-degrau-n"><b>{d.n}</b> · {pct(d.n, base)}%</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* Onde as visitas ao /agendar param (fase 2, 14/10/2026). Contagem anônima:
   mostra também quem saiu ANTES de deixar o WhatsApp — esse não vira lead. */
const PASSO_SITE_TEXTO = {
  inicio: "Abriram o /agendar", unidade: "Escolheram a unidade", horario: "Escolheram o horário",
  dados: "Deixaram nome e WhatsApp", pix: "Geraram o Pix", pago: "Pagaram",
};
function OndeParamNoSite({ de, ate }) {
  const [r, setR] = useState(null);
  useEffect(() => {
    let vivo = true;
    setR(null);
    api.funil.site(de, ate).then((x) => vivo && setR(x)).catch(() => vivo && setR({ erro: true }));
    return () => { vivo = false; };
  }, [de, ate]);
  if (!r) return null;
  if (r.erro) return null;
  return (
    <div className="panel">
      <div className="panel-h"><h2>🌐 Onde param no /agendar <span className="muted-note">· visitas ao site no período</span></h2></div>
      {r.total ? <Degraus degraus={r.passos.map((p) => ({ l: PASSO_SITE_TEXTO[p.passo] || p.passo, n: p.n }))} />
        : <div className="empty" style={{ padding: "1rem" }}><p>Nenhuma visita ao /agendar neste período.</p></div>}
      <div className="vg-legenda">
        Contagem sem identificar ninguém{r.desde ? `, desde ${fmtDate(r.desde)}` : ""}. Quem deixou nome e WhatsApp e não gerou o Pix está no Quadro, em Primeiro contato.
      </div>
    </div>
  );
}

function agrupar(lista, chave, rotulo) {
  const m = new Map();
  for (const l of lista) {
    const k = chave(l) || "";
    if (!m.has(k)) m.set(k, { k, ...rotulo(k), leads: 0, ganhas: 0 });
    const g = m.get(k);
    g.leads++;
    if (l.ganhaAt) g.ganhas++;
  }
  return [...m.values()].sort((a, b) => b.leads - a.leads || b.ganhas - a.ganhas);
}

function Relatorio({ leads, units }) {
  const [tipo, setTipo] = useState("mes");
  const [refDia, setRefDia] = useState(todayISO());
  const [de, ate] = intervalo(tipo, refDia);
  const noPeriodo = (d) => d && d >= de && d <= ate;
  // "não era lead" não é interessada: fica fora de todas as contas
  const validas = leads.filter((l) => l.motivoPerda !== "nao_lead");
  const coorte = validas.filter((l) => noPeriodo(diaDe(l.createdAt)));

  const degraus = [
    { l: "Entraram no funil", n: coorte.length },
    { l: "Fizeram o cadastro", n: coorte.filter((l) => l.clientId || l.marcouAt).length },
    { l: "Marcaram a 1ª aula", n: coorte.filter((l) => l.marcouAt).length },
    { l: "Pagaram a entrada", n: coorte.filter((l) => l.pagouAt).length },
    { l: "Matricularam", n: coorte.filter((l) => l.ganhaAt).length },
  ];
  const matriculasNoPeriodo = validas.filter((l) => noPeriodo(l.ganhaAt));
  const tempo = mediana(coorte.filter((l) => l.ganhaAt).map((l) => Math.max(0, diasEntre(diaDe(l.createdAt), l.ganhaAt))));
  const perdidas = coorte.filter((l) => l.etapa === "perdida");
  const emAberto = coorte.filter((l) => ABERTAS.includes(l.etapa)).length;

  const porOrigem = agrupar(coorte, (l) => l.origem, (k) => ({ ic: ORIGEM[k]?.icon || "❔", l: ORIGEM[k]?.curto || ORIGEM[k]?.label || "Não informada" }));
  const porCanal = agrupar(coorte, (l) => l.canal, (k) => ({ ic: (CANAL[k] || "📁").split(" ")[0], l: (CANAL[k] || "📁 Antes do funil").split(" ").slice(1).join(" ") }));
  const porUnidade = agrupar(coorte, (l) => l.unit, (k) => ({ ic: "📍", l: k || "Sem unidade" }));
  const porMotivo = Object.entries(perdidas.reduce((acc, l) => {
    const k = l.motivoPerda || (l.detalhe === "ficha inativada" ? "inativada" : "outro");
    acc[k] = (acc[k] || 0) + 1; return acc;
  }, {})).map(([k, n]) => ({ k, n, l: MOTIVO[k]?.label || (k === "inativada" ? "Ficha inativada" : k), ic: MOTIVO[k]?.icon || "📁" })).sort((a, b) => b.n - a.n);
  const maxMotivo = Math.max(1, ...porMotivo.map((m) => m.n));

  const csv = () => exportCsv(`funil-${de}-a-${ate}`,
    ["Nome", "WhatsApp", "Entrou", "Canal", "Origem", "Detalhe da origem", "Unidade", "Etapa", "Detalhe", "Marcou", "Pagou", "Matriculou", "Motivo da perda", "Retorno"],
    coorte.map((l) => [l.nome, l.phone || "", diaDe(l.createdAt), CANAL[l.canal]?.split(" ").slice(1).join(" ") || "antes do funil",
      ORIGEM[l.origem]?.label || "", l.origemDetalhe || "", l.unit || "", ETAPA[l.etapa]?.l || l.etapa, l.detalhe || "",
      l.marcouAt || "", l.pagouAt || "", l.ganhaAt || "", MOTIVO[l.motivoPerda]?.label || "", l.proximoContato || ""]));

  return (<>
    <div className="panel">
      <Periodo tipos={PERIODOS_FUNIL} tipo={tipo} setTipo={setTipo} refDia={refDia} setRefDia={setRefDia} />
      <div className="seg-hint">Conta as leads que <b>entraram</b> no período e até onde cada uma chegou até hoje.</div>
      <div className="grid stats">
        <div className="card stat"><div className="lbl">🎯 Entraram</div><div className="val">{coorte.length}</div><div className="foot">{emAberto} ainda em aberto</div></div>
        <div className="card stat"><div className="lbl">🎓 Viraram aluna</div><div className="val">{pct(degraus[4].n, coorte.length)}%</div><div className="foot">{degraus[4].n} de {coorte.length}</div></div>
        <div className="card stat"><div className="lbl">📅 Matrículas no período</div><div className="val terra">{matriculasNoPeriodo.length}</div><div className="foot">inclui leads de antes do período</div></div>
        <div className="card stat"><div className="lbl">⏱️ Até matricular</div><div className="val">{tempo == null ? "—" : tempo}</div><div className="foot">{tempo == null ? "ninguém matriculou ainda" : `dia${tempo === 1 ? "" : "s"} do contato à matrícula, em geral`}</div></div>
      </div>
    </div>

    {coorte.length === 0 ? (<>
      <div className="panel"><div className="empty"><div className="ic">🎯</div><p>Nenhuma lead entrou neste período.</p></div></div>
      <OndeParamNoSite de={de} ate={ate} />
    </>) : (<>
      <div className="panel">
        <div className="panel-h"><h2>🔻 Do contato à matrícula</h2></div>
        <Degraus degraus={degraus} />
      </div>

      <OndeParamNoSite de={de} ate={ate} />

      <div className="panel">
        <div className="panel-h"><h2>📣 De onde vêm <span className="muted-note">· verde = viraram aluna</span></h2></div>
        <BarrasDeConversao grupos={porOrigem} />
        {porOrigem.some((g) => !g.k) && <div className="vg-legenda">❔ “Não informada”: pergunte na conversa e anote na ficha da lead — é o que mostra qual divulgação traz aluna.</div>}
      </div>

      <div className="row2" style={{ alignItems: "start" }}>
        <div className="panel">
          <div className="panel-h"><h2>🚪 Por onde entraram</h2></div>
          <BarrasDeConversao grupos={porCanal} />
        </div>
        {units.length > 1 && (
          <div className="panel">
            <div className="panel-h"><h2>📍 Por unidade</h2></div>
            <BarrasDeConversao grupos={porUnidade} />
          </div>
        )}
      </div>

      {porMotivo.length > 0 && (
        <div className="panel">
          <div className="panel-h"><h2>✖ Por que perdemos <span className="muted-note">· {perdidas.length} perdida(s)</span></h2></div>
          <div className="vg-barras">
            {porMotivo.map((m) => (
              <div key={m.k} className="vg-barra-l">
                <div className="vg-barra-nome"><span>{m.ic}</span><span>{m.l}</span></div>
                <div className="vg-barra"><div style={{ width: `${(m.n / maxMotivo) * 100}%`, background: "var(--terracota)" }} /></div>
                <div className="vg-barra-num"><b>{m.n}</b> · {pct(m.n, perdidas.length)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-h">
          <h2>📋 As leads do período <span className="muted-note">· {coorte.length}</span></h2>
          <div className="tools"><button className="btn ghost sm" onClick={csv}>⬇ CSV</button></div>
        </div>
        <table>
          <thead><tr><th>Lead</th><th>Entrou</th><th>Origem</th><th>Etapa</th><th>Matriculou</th></tr></thead>
          <tbody>
            {[...coorte].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((l) => (
              <tr key={l.id}>
                <td data-l="Lead"><b>{l.nome}</b><div className="cli-sub">{[l.unit, CANAL[l.canal]].filter(Boolean).join(" · ")}</div></td>
                <td data-l="Entrou">{fmtDate(diaDe(l.createdAt))}</td>
                <td data-l="Origem">{ORIGEM[l.origem] ? `${ORIGEM[l.origem].icon} ${ORIGEM[l.origem].label}` : "—"}</td>
                <td data-l="Etapa">{ETAPA[l.etapa]?.ic} {ETAPA[l.etapa]?.l}{l.etapa === "perdida" && l.motivoPerda ? <div className="cli-sub">{MOTIVO[l.motivoPerda]?.label}</div> : null}</td>
                <td data-l="Matriculou">{l.ganhaAt ? fmtDate(l.ganhaAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>)}
  </>);
}

/* ============================================================
   Tela
   ============================================================ */
const ABAS = [
  ["quadro", "🗂️ Quadro"],
  ["retornos", "⏰ Retornos"],
  ["perdidas", "✖ Perdidas"],
  ["relatorio", "📈 Relatório"],
];
const DICA = {
  quadro: "A etapa anda sozinha: o sistema acompanha a ficha, a reserva da 1ª aula, o Pix e a matrícula. Toque no cartão para ver o caminho dela e marcar o retorno.",
  retornos: "Com quem falar hoje — e quem ficou para trás. Depois de falar, registre o contato e marque o próximo retorno.",
  perdidas: "Quem desistiu, com o motivo. Se ela voltar a falar no WhatsApp ou marcar pelo site, volta sozinha para o quadro.",
};

export default function Funil({ params }) {
  const { data } = useStore();
  const { open } = useModal();
  const leads = useLeads();
  const [aba, setAba] = useState("quadro");
  const [busca, setBusca] = useState("");
  const [unit, setUnit] = useState("Todas");
  const [origem, setOrigem] = useState("todas");
  const meta = data?.meta || {};
  const units = meta.units || [];

  // atalho das notificações: abre direto a ficha da lead
  // (depende do objeto `params`: cada clique na notificação é um objeto novo, mesmo que seja a mesma lead)
  useEffect(() => { if (params?.lead) open(<LeadFicha id={params.lead} />); }, [params]);
  useEffect(() => { if (params?.aba) setAba(params.aba); }, [params]);

  const abrir = (l) => open(<LeadFicha id={l.id} />);
  const chamar = (l) => {
    window.open(waLink(l.phone, mensagemDaLead(l, meta)), "_blank");
    open(<RegistrarContato lead={l} texto="Mandei mensagem pelo WhatsApp." />);
  };

  const todas = leads || [];
  const hoje = todayISO();
  const filtradas = useMemo(() => todas.filter((l) =>
    (!busca.trim() || contemBusca([l.nome, l.origemDetalhe, l.detalhe], busca) ||
      (busca.replace(/\D/g, "").length >= 4 && (l.phone || "").includes(busca.replace(/\D/g, "")))) &&
    (unit === "Todas" || l.unit === unit) &&
    (origem === "todas" || (origem === "" ? !l.origem : l.origem === origem))
  ), [todas, busca, unit, origem]);

  const abertas = todas.filter((l) => ABERTAS.includes(l.etapa));
  const retornosHoje = abertas.filter((l) => l.proximoContato && l.proximoContato <= hoje);
  const semRetorno = abertas.filter((l) => !l.proximoContato).length;
  const novas7 = todas.filter((l) => diasDesde(l.createdAt) <= 7 && l.motivoPerda !== "nao_lead").length;
  const comp = hoje.slice(0, 7);
  const matriculasMes = todas.filter((l) => (l.ganhaAt || "").startsWith(comp)).length;
  const coorte90 = todas.filter((l) => diaDe(l.createdAt) >= addDays(hoje, -90) && l.motivoPerda !== "nao_lead");
  const conv90 = pct(coorte90.filter((l) => l.ganhaAt).length, coorte90.length);
  const perdidas = todas.filter((l) => l.etapa === "perdida");

  const contagem = { quadro: abertas.length, retornos: retornosHoje.length, perdidas: perdidas.length };

  const filtros = (
    <div className="filters">
      <input className="grow" placeholder="🔍 Buscar por nome, WhatsApp ou detalhe..." value={busca} onChange={(e) => setBusca(e.target.value)} />
      <Select compact value={unit} onChange={setUnit}
        options={[{ value: "Todas", label: "Todas as unidades", icon: "📍" }, ...units.map((u) => ({ value: u, label: u, icon: "📍" }))]} />
      <Select compact value={origem} onChange={setOrigem}
        options={[{ value: "todas", label: "Todas as origens", icon: "📣" }, { value: "", label: "Origem não informada", icon: "❔" }, ...ORIGENS]} />
    </div>
  );

  const retornos = filtradas.filter((l) => ABERTAS.includes(l.etapa) && l.proximoContato)
    .sort((a, b) => a.proximoContato.localeCompare(b.proximoContato));
  const listaPerdidas = filtradas.filter((l) => l.etapa === "perdida")
    .sort((a, b) => (b.perdidaAt || diaDe(b.etapaDesde)).localeCompare(a.perdidaAt || diaDe(a.etapaDesde)));

  return (<>
    <div className="grid stats" style={{ marginBottom: "1rem" }}>
      <div className="card stat click" onClick={() => setAba("quadro")}><div className="lbl">🎯 Leads em aberto</div><div className="val">{abertas.length}</div><div className="foot">{novas7} nova(s) nos últimos 7 dias</div></div>
      <div className="card stat click" onClick={() => setAba("retornos")}><div className="lbl">⏰ Retornar hoje</div><div className={`val${retornosHoje.length ? " warn" : ""}`}>{retornosHoje.length}</div><div className="foot">{semRetorno ? `${semRetorno} sem retorno marcado` : "todas com retorno marcado"}</div></div>
      <div className="card stat click" onClick={() => setAba("relatorio")}><div className="lbl">🎓 Matrículas no mês</div><div className="val terra">{matriculasMes}</div><div className="foot">vindas do funil</div></div>
      <div className="card stat click" onClick={() => setAba("relatorio")}><div className="lbl">📈 Conversão (90 dias)</div><div className="val">{conv90}%</div><div className="foot">das que entraram, viraram aluna</div></div>
    </div>

    <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
      {ABAS.map(([k, l]) => (
        <button key={k} className={aba === k ? "on" : ""} onClick={() => setAba(k)}>
          {l}{contagem[k] != null && <span className="seg-count">{contagem[k]}</span>}
        </button>
      ))}
    </div>
    {DICA[aba] && <div className="seg-hint">{DICA[aba]}</div>}

    {leads == null ? (
      <div className="panel"><div className="empty"><div className="ic">🧶</div><p>Carregando…</p></div></div>
    ) : aba === "relatorio" ? (
      <Relatorio leads={todas} units={units} />
    ) : aba === "quadro" ? (
      <div className="panel">
        {filtros}
        <Quadro leads={filtradas} meta={meta} abrir={abrir} chamar={chamar} />
      </div>
    ) : aba === "retornos" ? (
      <div className="panel">
        {filtros}
        {semRetorno > 0 && <div className="seg-hint">💡 {semRetorno} lead(s) em aberto sem retorno marcado — veja no Quadro.</div>}
        {retornos.length ? (
          <table>
            <thead><tr><th>Lead</th><th>Etapa</th><th>Retorno</th><th>Último contato</th><th>Ações</th></tr></thead>
            <tbody>
              {retornos.map((l) => (
                <tr key={l.id} style={l.proximoContato <= hoje ? { background: "rgba(217,164,65,.07)" } : undefined}>
                  <td className="c-main" data-l="Lead">
                    <div className="row-click" onClick={() => abrir(l)}>
                      <span className="cli-name">{l.nome}</span>
                      <div className="cli-sub">{[l.unit, ORIGEM[l.origem]?.label].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                  </td>
                  <td data-l="Etapa">{ETAPA[l.etapa]?.ic} {ETAPA[l.etapa]?.l}{l.detalhe ? <div className="cli-sub">{l.detalhe}</div> : null}</td>
                  <td data-l="Retorno"><Retorno lead={l} /></td>
                  <td data-l="Último contato">{l.ultimoContatoAt ? quandoFoi(l.ultimoContatoAt) : <span className="cli-sub">nenhum ainda</span>}</td>
                  <td className="td-actions">
                    {l.phone && <button className="btn wa sm" title="WhatsApp" onClick={() => chamar(l)}><WaIcon /></button>}
                    <button className="btn sec sm" onClick={() => open(<RegistrarContato lead={l} />)}>📞 Registrar contato</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty"><div className="ic">✨</div><p>Nenhum retorno marcado.</p></div>}
      </div>
    ) : (
      <div className="panel">
        {filtros}
        {listaPerdidas.length ? (
          <table>
            <thead><tr><th>Lead</th><th>Motivo</th><th>Perdida em</th><th>Origem</th><th>Ações</th></tr></thead>
            <tbody>
              {listaPerdidas.map((l) => (
                <tr key={l.id}>
                  <td className="c-main" data-l="Lead">
                    <div className="row-click" onClick={() => abrir(l)}>
                      <span className="cli-name">{l.nome}</span>
                      <div className="cli-sub">{l.unit || "—"}</div>
                    </div>
                  </td>
                  <td data-l="Motivo">{MOTIVO[l.motivoPerda] ? `${MOTIVO[l.motivoPerda].icon} ${MOTIVO[l.motivoPerda].label}` : l.detalhe || "—"}</td>
                  <td data-l="Perdida em">{fmtDate(l.perdidaAt || diaDe(l.etapaDesde))}</td>
                  <td data-l="Origem">{ORIGEM[l.origem] ? `${ORIGEM[l.origem].icon} ${ORIGEM[l.origem].label}` : "—"}</td>
                  <td className="td-actions">
                    {l.phone && <button className="btn wa sm" title="WhatsApp" onClick={() => chamar(l)}><WaIcon /></button>}
                    <button className="btn ghost sm" onClick={() => abrir(l)}>Abrir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty"><div className="ic">🌱</div><p>Nenhuma lead perdida{busca || unit !== "Todas" || origem !== "todas" ? " com esse filtro" : ""}.</p></div>}
      </div>
    )}
  </>);
}
