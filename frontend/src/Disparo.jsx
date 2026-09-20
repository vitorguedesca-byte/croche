import { useState, useEffect, useMemo, useRef } from "react";
import { toast, confirmModal } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { Select } from "./ui.jsx";
import { api } from "./api.js";
import { contemBusca } from "./helpers.js";

/* ============================================================
   Disparo em massa pelo WhatsApp oficial (Meta).

   A Inêz escolhe as alunas (uma a uma ou todas da lista filtrada),
   escolhe a mensagem, revisa e confirma. O envio roda no servidor;
   esta tela só acompanha — inclusive a ENTREGA, que chega depois
   pelo webhook da Meta.

   Três coisas vêm sincronizadas de lá e não são adivinhadas aqui:

   1. os TEMPLATES, com o status de aprovação de cada um. Os que
      ainda esperam a Meta aparecem na lista, apagados, com o
      motivo — antes eram filtrados fora e a escola só via um
      template sumido, sem saber se tinha sido recusado ou se
      ainda estava na fila;
   2. a JANELA DE 24H de cada aluna, com a hora em que fecha.
      Fora dela só template chega: texto livre a Meta aceita,
      responde 200 e descarta em silêncio;
   3. a ENTREGA de cada mensagem já enviada — e o disparo fica
      gravado no banco, então dá para fechar a tela, voltar
      amanhã e ainda ver quem recebeu e quem ficou faltando.
   ============================================================ */

const SITUACOES = [
  { value: "ativas", label: "Alunas ativas", icon: "💚" },
  { value: "mensalistas", label: "Mensalistas", icon: "📅" },
  { value: "avulsas", label: "Avulsas", icon: "🧺" },
  { value: "leads", label: "Pagamento não realizado", icon: "⚠️" },
  { value: "inativas", label: "Inativas", icon: "💤" },
  { value: "todas", label: "Todas as fichas", icon: "👩" },
];
const naSituacao = (c, s) =>
  s === "todas" ? true
  : s === "inativas" ? c.status === "cancelado"
  : s === "leads" ? c.status === "lead"
  : c.status === "cancelado" || c.status === "lead" ? false
  : s === "mensalistas" ? c.plan === "mensalista"
  : s === "avulsas" ? c.plan !== "mensalista"
  : true;

const temTelefone = (c) => String(c.phone || "").replace(/\D/g, "").length >= 10;
const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const preencher = (txt, nome) =>
  String(txt ?? "").replace(/\{nome_completo\}/gi, nome || "").replace(/\{nome\}/gi, primeiroNome(nome));
// Troca {{1}}, {{2}}... pelos valores (já com o nome da aluna aplicado).
const montar = (txt, valores, nome) =>
  String(txt || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const v = valores[Number(n) - 1];
    return v && v.trim() ? preencher(v, nome) : `{{${n}}}`;
  });

const SITUACAO_ENVIO = {
  "na fila": ["b-muted", "⏳ na fila"],
  enviado: ["b-info", "📤 enviada"],
  pulada: ["b-warn", "⏭ pulada"],
  erro: ["b-danger", "⚠️ erro"],
};
const ENTREGA = {
  enviado: ["b-info", "⏳ aguardando confirmação"],
  entregue: ["b-ok", "✓ entregue"],
  lido: ["b-ok", "✓✓ lida"],
  falhou: ["b-danger", "✕ não chegou"],
};
// Status de template como a Meta devolve.
const STATUS_TPL = {
  APPROVED: ["b-ok", "✓ aprovado"],
  PENDING: ["b-warn", "⏳ aguardando a Meta"],
  IN_APPEAL: ["b-warn", "⚖️ em recurso"],
  REJECTED: ["b-danger", "✕ recusado"],
  PAUSED: ["b-danger", "⏸ pausado"],
  DISABLED: ["b-danger", "🚫 desativado"],
  PENDING_DELETION: ["b-muted", "🗑 marcado para exclusão"],
};
const statusTpl = (s) => STATUS_TPL[s] || ["b-muted", String(s || "?").toLowerCase()];
const ICONE_TPL = { APPROVED: "✓", PENDING: "⏳", IN_APPEAL: "⚖️", REJECTED: "✕", PAUSED: "⏸", DISABLED: "🚫", PENDING_DELETION: "🗑" };

const hhmmDe = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
const dataHoraDe = (iso) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
// "3h20", "40 min" — quanto ainda falta para um instante no futuro.
function faltando(ms) {
  if (!(ms > 0)) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}
// "agora mesmo", "há 4 min", "às 14:32" — quando algo aconteceu.
function tempoDesde(iso, agora = Date.now()) {
  if (!iso) return "nunca";
  const seg = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));
  if (seg < 30) return "agora mesmo";
  if (seg < 90) return "há 1 min";
  if (seg < 3600) return `há ${Math.round(seg / 60)} min`;
  return `às ${hhmmDe(iso)}`;
}

export default function Disparo() {
  const { data } = useStore();
  const [opcoes, setOpcoes] = useState(null);
  const [erroOpcoes, setErroOpcoes] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [jobId, setJobId] = useState(null);
  // alunas que já entram marcadas (vem de "mandar de novo para quem faltou")
  const [preSel, setPreSel] = useState(null);

  /* `sync` pergunta na hora para a Meta em vez de usar o cache de 5 min do
     servidor. Sem ele a tela ainda sincroniza — só aceita uma resposta de
     poucos minutos atrás, que é o suficiente para abrir a tela. */
  const carregar = (sync = false) => {
    setErroOpcoes(null);
    if (sync) setSincronizando(true);
    return api.disparo.opcoes(sync)
      .then((o) => { setOpcoes(o); if (o.emAndamento) setJobId(o.emAndamento); })
      .catch((e) => setErroOpcoes(e.message))
      .finally(() => setSincronizando(false));
  };
  useEffect(() => { carregar(false); }, []);

  const voltar = (idsParaMarcar) => {
    setPreSel(idsParaMarcar && idsParaMarcar.length ? idsParaMarcar : null);
    setJobId(null);
    carregar(false);
  };

  if (jobId) return <Andamento id={jobId} onNovo={voltar} />;
  if (erroOpcoes) return <div className="panel empty"><div className="ic">🔌</div><p>Não consegui falar com o WhatsApp.</p><p className="cli-sub">{erroOpcoes}</p><button className="btn" onClick={() => carregar(true)}>Tentar de novo</button></div>;
  if (!opcoes) return <div className="panel empty"><div className="ic">💬</div><p>Sincronizando com o WhatsApp…</p></div>;
  return (
    <Composer
      data={data}
      opcoes={opcoes}
      preSel={preSel}
      sincronizando={sincronizando}
      onSincronizar={() => carregar(true)}
      onAbrir={setJobId}
      onIniciado={setJobId}
    />
  );
}

/* Barra de sincronização: de quando é o que está na tela, quantos templates a
   Meta liberou, quantos ainda estão pendentes e quantas alunas estão com a
   janela de 24h aberta agora. É a resposta para "isso aqui está atualizado?". */
function BarraSync({ opcoes, abertas, sincronizando, onSincronizar }) {
  const pendentes = [...opcoes.templates, ...opcoes.templatesSistema].filter((t) => t.status !== "APPROVED").length;
  const aprovados = opcoes.templates.filter((t) => t.usavel).length;
  const conectado = opcoes.waConfigurado && opcoes.wabaConfigurada && !!opcoes.sincronizadoEm;
  return (
    <div className="panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <div>
        <b>{conectado ? "🔗 Conectado ao WhatsApp da Meta" : "🔌 Sem conexão com o WhatsApp da Meta"}</b>
        <div className="cli-sub">
          {conectado ? <>
            Templates sincronizados {tempoDesde(opcoes.sincronizadoEm)} · <b>{aprovados}</b> prontos para disparo
            {pendentes > 0 && <> · <b>{pendentes}</b> ainda não aprovados</>}
          </> : <>Templates nunca sincronizados{opcoes.erroTemplates ? ` — ${opcoes.erroTemplates}` : ""}</>}
          {" · "}<b>{abertas.size}</b> aluna(s) com a janela de 24h aberta
        </div>
      </div>
      <button className="btn sec sm" disabled={sincronizando} onClick={onSincronizar}>
        {sincronizando ? "Sincronizando…" : "🔄 Sincronizar agora"}
      </button>
    </div>
  );
}

function Composer({ data, opcoes, preSel, sincronizando, onSincronizar, onAbrir, onIniciado }) {
  /* O relógio anda: uma janela que fechou enquanto a tela estava aberta tem que
     aparecer fechada, senão a Inêz manda texto livre para quem já não recebe
     mais. Por isso o "agora" é estado, e não `Date.now()` solto no render. */
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const janelas = useMemo(() => new Map(opcoes.janelas.map((j) => [j.id, new Date(j.fechaEm).getTime()])), [opcoes]);
  const abertas = useMemo(() => {
    const s = new Set();
    for (const [id, fim] of janelas) if (fim > agora) s.add(id);
    return s;
  }, [janelas, agora]);

  const [search, setSearch] = useState("");
  const [unitF, setUnitF] = useState("Todas");
  const [sitF, setSitF] = useState("ativas");
  const [sel, setSel] = useState(() => new Set(preSel || []));
  const [modo, setModo] = useState(opcoes.templates.some((t) => t.usavel) ? "template" : "texto");
  const [tplName, setTplName] = useState("");
  const [hVals, setHVals] = useState([]);
  const [bVals, setBVals] = useState([]);
  const [texto, setTexto] = useState("Oi, {nome}! ");
  const [enviando, setEnviando] = useState(false);

  const tpl = opcoes.templates.find((t) => t.name === tplName) || null;
  const escolherTemplate = (name) => {
    const t = opcoes.templates.find((x) => x.name === name);
    setTplName(name);
    setHVals(Array(t?.headerVars || 0).fill(""));
    // quase todo template começa com o nome da aluna em {{1}}
    setBVals(Array(t?.bodyVars || 0).fill("").map((v, i) => (i === 0 ? "{nome}" : v)));
  };

  const lista = data.clients
    .filter((c) => naSituacao(c, sitF))
    .filter((c) => unitF === "Todas" || c.unit === unitF)
    .filter((c) => contemBusca([c.name, c.phone], search))
    .sort((a, b) => a.name.localeCompare(b.name));
  const listaComTel = lista.filter(temTelefone);
  const todasDaListaMarcadas = listaComTel.length > 0 && listaComTel.every((c) => sel.has(c.id));

  const toggle = (c) => {
    if (!temTelefone(c)) return;
    setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; });
  };
  const marcarLista = () => setSel((s) => {
    const n = new Set(s);
    if (todasDaListaMarcadas) listaComTel.forEach((c) => n.delete(c.id));
    else listaComTel.forEach((c) => n.add(c.id));
    return n;
  });

  const selecionadas = data.clients.filter((c) => sel.has(c.id));
  const comConversaAberta = selecionadas.filter((c) => abertas.has(c.id)).length;
  const exemploNome = selecionadas[0]?.name || "Maria Silva";

  const faltaVariavel = modo === "template" && (!tpl || !tpl.usavel || [...hVals, ...bVals].some((v) => !v.trim()));
  // "Oi, {nome}!" sozinho não é mensagem
  const textoVazio = modo === "texto" && !texto.replace(/\{nome(_completo)?\}/gi, "").replace(/^\s*oi[,!\s]*/i, "").trim();
  const recebem = modo === "template" ? selecionadas.length : comConversaAberta;
  const podeRevisar = selecionadas.length > 0 && !faltaVariavel && !textoVazio && recebem > 0 && !enviando;

  const previa = modo === "template" && tpl
    ? { header: tpl.header ? montar(tpl.header, hVals, exemploNome) : null, body: montar(tpl.body, bVals, exemploNome), footer: tpl.footer, buttons: tpl.buttons }
    : { header: null, body: preencher(texto, exemploNome), footer: null, buttons: [] };

  const revisar = async () => {
    const nomes = selecionadas.slice(0, 6).map((c) => primeiroNome(c.name)).join(", ") + (selecionadas.length > 6 ? ` e mais ${selecionadas.length - 6}` : "");
    const ok = await confirmModal({
      title: "Confirmar disparo no WhatsApp",
      confirmLabel: `📣 Enviar para ${recebem}`,
      message: (<>
        <b>{selecionadas.length}</b> aluna(s) selecionada(s): {nomes}.<br /><br />
        {modo === "template"
          ? <>Mensagem: template <b>{tpl.name}</b> ({tpl.category === "MARKETING" ? "marketing" : "utilidade"}). Chega para todas — <b>cada mensagem é cobrada pela Meta</b>{tpl.category === "MARKETING" ? ", e marketing custa mais" : ""}.</>
          : <>Mensagem: <b>texto livre</b>. Só vai para as <b>{comConversaAberta}</b> que falaram com a escola nas últimas 24h; {selecionadas.length - comConversaAberta} ficam de fora.</>}
        <br /><br />
        Exemplo para {primeiroNome(exemploNome)}: “{previa.body.length > 220 ? previa.body.slice(0, 220) + "…" : previa.body}”
        {!opcoes.horarioBom && <><br /><br />⚠️ Agora está fora do horário das mensagens automáticas (8h às 20h).</>}
        <br /><br />Depois de enviado não dá para desfazer.
      </>),
    });
    if (!ok) return;
    setEnviando(true);
    try {
      const r = await api.disparo.enviar({
        clientIds: [...sel],
        modo,
        texto: modo === "texto" ? texto : undefined,
        template: modo === "template" ? { name: tpl.name, header: hVals, body: bVals } : undefined,
      });
      toast("Disparo iniciado 📣");
      onIniciado(r.id);
    } catch (e) {
      toast.error(e.message);
      setEnviando(false);
    }
  };

  /* Todos os templates entram na lista, inclusive os que a Meta ainda não
     liberou — apagados e com o motivo na dica. Template que some da lista vira
     "cadê aquela mensagem?"; template apagado com "aguardando a Meta" escrito
     ao lado responde sozinho. */
  const templateOptions = opcoes.templates.map((t) => ({
    value: t.name,
    label: t.name,
    icon: t.usavel ? (t.category === "MARKETING" ? "📢" : "🧾") : (ICONE_TPL[t.status] || "⚠️"),
    hint: t.usavel
      ? `${t.category === "MARKETING" ? "marketing" : "utilidade"} · ${t.bodyVars + t.headerVars} variável(is)`
      : `não dá para usar: ${t.motivo}`,
    disabled: !t.usavel,
  }));

  return (<>
    {!opcoes.waConfigurado && <div className="help" style={{ marginBottom: "1rem", borderLeftColor: "var(--danger)" }}>⚠️ O WhatsApp não está configurado no servidor — o envio vai falhar.</div>}

    <BarraSync opcoes={opcoes} abertas={abertas} sincronizando={sincronizando} onSincronizar={onSincronizar} />

    <div className="panel">
      <div className="panel-h">
        <h2>1. Quem recebe</h2>
        <div className="tools">
          <span className="badge b-terra">{sel.size} selecionada(s)</span>
          {sel.size > 0 && <button className="btn ghost sm" onClick={() => setSel(new Set())}>Limpar seleção</button>}
        </div>
      </div>
      <div className="filters">
        <input className="grow" placeholder="🔍 Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select compact value={sitF} onChange={setSitF} options={SITUACOES} />
        <Select compact value={unitF} onChange={setUnitF}
          options={[{ value: "Todas", label: "Todas as unidades", icon: "📍" }, ...data.meta.units.map((u) => ({ value: u, label: u, icon: "📍" }))]} />
        <button className="btn sec sm" disabled={!listaComTel.length} onClick={marcarLista}>
          {todasDaListaMarcadas ? `Desmarcar as ${listaComTel.length} da lista` : `☑ Selecionar todas (${listaComTel.length})`}
        </button>
      </div>
      {lista.length ? (
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table>
            <thead><tr><th style={{ width: 40 }}></th><th>Aluna</th><th>Unidade</th><th>Janela de 24h</th></tr></thead>
            <tbody>
              {lista.map((c) => {
                const tel = temTelefone(c);
                const fim = janelas.get(c.id);
                const resta = fim ? faltando(fim - agora) : null;
                return (
                  <tr key={c.id} onClick={() => toggle(c)} style={{ cursor: tel ? "pointer" : "not-allowed", opacity: tel ? 1 : 0.55, background: sel.has(c.id) ? "rgba(140,154,120,.12)" : undefined }}>
                    <td><input type="checkbox" checked={sel.has(c.id)} disabled={!tel} onChange={() => toggle(c)} onClick={(e) => e.stopPropagation()} style={{ width: "auto" }} /></td>
                    <td className="c-main">
                      <span className="cli-name">{c.name}</span>
                      {c.status === "cancelado" ? <span className="badge b-danger ml">Inativa</span> : null}
                      {c.plan === "mensalista" && c.status !== "cancelado" ? <span className="badge b-ok ml">📅 mensalista</span> : null}
                      <div className="cli-sub">{tel ? c.phone : "sem telefone — não dá para enviar"}</div>
                    </td>
                    <td data-l="Unidade">{c.unit ? <span className="chip">{c.unit}</span> : "—"}</td>
                    <td data-l="Janela de 24h">
                      {resta
                        ? <><span className="badge b-ok" title={`Falou com a escola nas últimas 24h — recebe texto livre até ${hhmmDe(new Date(fim).toISOString())}`}>💬 aberta</span><div className="cli-sub">fecha em {resta}</div></>
                        : <span className="badge b-muted" title="Não mandou mensagem nas últimas 24h — só template chega">fechada · só template</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">Nenhuma aluna nesse filtro.</div>}
    </div>

    <div className="panel">
      <div className="panel-h">
        <h2>2. Mensagem</h2>
        {opcoes.sincronizadoEm && <div className="tools"><span className="cli-sub">templates lidos da Meta {tempoDesde(opcoes.sincronizadoEm)}</span></div>}
      </div>
      <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
        <button className={modo === "template" ? "on" : ""} onClick={() => setModo("template")}>🧾 Template aprovado</button>
        <button className={modo === "texto" ? "on" : ""} onClick={() => setModo("texto")}>✍️ Texto livre</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.2rem" }}>
        <div>
          {modo === "template" ? (<>
            <div className="seg-hint">Chega para <b>todas</b> as selecionadas. É o único jeito de falar com quem não mandou mensagem para a escola nas últimas 24h. Cada envio é cobrado pela Meta.</div>
            {opcoes.erroTemplates && <div className="help" style={{ marginBottom: ".8rem", borderLeftColor: "var(--danger)" }}>⚠️ Não consegui ler os templates na Meta: {opcoes.erroTemplates}{opcoes.sincronizadoEm ? " — a lista abaixo é da última sincronização que deu certo." : ""}</div>}
            {!opcoes.erroTemplates && !opcoes.templates.length && <div className="help" style={{ marginBottom: ".8rem" }}>Nenhum template cadastrado na conta do WhatsApp. Ele precisa ser criado e aprovado na Meta antes.</div>}
            {opcoes.templates.length > 0 && (
              <div className="field">
                <label>Template</label>
                <Select value={tplName} onChange={escolherTemplate} options={templateOptions} placeholder="Escolha o template" />
              </div>
            )}
            {tpl && !tpl.usavel && (
              <div className="help" style={{ borderLeftColor: "var(--danger)" }}>
                Este template não pode ser disparado: {tpl.motivo}.{tpl.motivoRecusa ? ` Motivo da Meta: ${tpl.motivoRecusa}.` : ""}
              </div>
            )}
            {tpl && hVals.map((v, i) => (
              <div className="field" key={"h" + i}>
                <label>Cabeçalho {`{{${i + 1}}}`}</label>
                <input value={v} onChange={(e) => setHVals((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
              </div>
            ))}
            {tpl && bVals.map((v, i) => (
              <div className="field" key={"b" + i}>
                <label>Variável {`{{${i + 1}}}`}</label>
                <input value={v} onChange={(e) => setBVals((a) => a.map((x, j) => (j === i ? e.target.value : x)))} placeholder="texto que entra no lugar da variável" />
              </div>
            ))}
            {tpl && (tpl.bodyVars + tpl.headerVars) > 0 && <div className="help">Escreva <b>{"{nome}"}</b> para o primeiro nome de cada aluna, ou <b>{"{nome_completo}"}</b>. Variável não aceita quebra de linha.</div>}
          </>) : (<>
            <div className="seg-hint">
              Gratuito, mas <b>só chega para quem falou com a escola nas últimas 24h</b> — das selecionadas, {comConversaAberta} de {selecionadas.length}. As demais ficam de fora (use um template para elas).
            </div>
            <div className="field">
              <label>Mensagem</label>
              <textarea rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000} />
            </div>
            <div className="help">Escreva <b>{"{nome}"}</b> para o primeiro nome de cada aluna, ou <b>{"{nome_completo}"}</b>.</div>
          </>)}
        </div>

        <div>
          <label style={{ display: "block", fontSize: ".82rem", fontWeight: 700, color: "var(--brown)", marginBottom: ".35rem" }}>
            Prévia — como {primeiroNome(exemploNome)} vai ver
          </label>
          <div style={{ background: "#e5ddd5", borderRadius: 12, padding: "1rem", minHeight: 140 }}>
            {(modo === "texto" || tpl) ? (
              <div style={{ background: "#fff", borderRadius: "0 10px 10px 10px", padding: ".6rem .8rem", maxWidth: 360, boxShadow: "0 1px 1px rgba(0,0,0,.12)", whiteSpace: "pre-wrap", fontSize: ".9rem", lineHeight: 1.4 }}>
                {previa.header && <div style={{ fontWeight: 700, marginBottom: ".3rem" }}>{previa.header}</div>}
                {previa.body}
                {previa.footer && <div style={{ color: "#8a8a8a", fontSize: ".78rem", marginTop: ".4rem" }}>{previa.footer}</div>}
                {previa.buttons.map((b, i) => (
                  <div key={i} style={{ borderTop: "1px solid #eee", marginTop: ".5rem", paddingTop: ".4rem", textAlign: "center", color: "#1f8fd6", fontWeight: 600 }}>{b}</div>
                ))}
              </div>
            ) : <div className="cli-sub">Escolha um template para ver a prévia.</div>}
          </div>
        </div>
      </div>
    </div>

    <div className="panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
      <div>
        <b>3. Revisar e enviar</b>
        <div className="cli-sub">
          {!selecionadas.length ? "Selecione pelo menos uma aluna."
            : faltaVariavel ? (!tpl ? "Escolha o template." : !tpl.usavel ? "Este template ainda não está liberado pela Meta." : "Preencha todas as variáveis do template.")
            : textoVazio ? "Escreva a mensagem."
            : modo === "texto" && !recebem ? "Nenhuma das selecionadas está com a conversa aberta — use um template."
            : `Vai para ${recebem} aluna(s)${modo === "texto" && recebem < selecionadas.length ? ` (${selecionadas.length - recebem} ficam de fora)` : ""}.`}
          {!opcoes.horarioBom && " · ⚠️ fora do horário das 8h às 20h"}
        </div>
      </div>
      <button className="btn" disabled={!podeRevisar} onClick={revisar}>📣 Revisar envio</button>
    </div>

    <TemplatesDaMeta opcoes={opcoes} />
    <UltimosDisparos lista={opcoes.ultimos} onAbrir={onAbrir} />
  </>);
}

/* Situação dos templates na Meta — os que ainda não dá para usar e os que as
   automações do sistema dependem. Fica fechado por padrão: no dia a dia não
   interessa, mas no dia em que a cobrança não sai é a primeira coisa a olhar. */
function TemplatesDaMeta({ opcoes }) {
  const [aberto, setAberto] = useState(false);
  const pendentes = opcoes.templates.filter((t) => t.status !== "APPROVED");
  // esperar a Meta é uma coisa; ter sido recusado é outra, e só uma delas passa sozinha
  const esperando = pendentes.filter((t) => t.status === "PENDING" || t.status === "IN_APPEAL");
  const barrados = pendentes.filter((t) => !["PENDING", "IN_APPEAL"].includes(t.status));
  const sistema = opcoes.templatesSistema;
  const sistemaComProblema = sistema.filter((t) => t.status !== "APPROVED");
  if (!opcoes.wabaConfigurada) {
    return <div className="panel"><div className="help">A conta do WhatsApp (WA_WABA_ID) não está configurada no servidor — não dá para ler os templates da Meta.</div></div>;
  }
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Templates na Meta</h2>
        <div className="tools">
          {pendentes.length > 0 && <span className="badge b-warn">{pendentes.length} não liberado(s)</span>}
          {sistemaComProblema.length > 0 && <span className="badge b-danger">{sistemaComProblema.length} automação(ões) em risco</span>}
          {!pendentes.length && !sistemaComProblema.length && <span className="badge b-ok">tudo aprovado</span>}
          <button className="btn ghost sm" onClick={() => setAberto((a) => !a)}>{aberto ? "Esconder" : "Ver todos"}</button>
        </div>
      </div>

      {sistemaComProblema.length > 0 && (
        <div className="help" style={{ borderLeftColor: "var(--danger)" }}>
          ⚠️ {sistemaComProblema.map((t) => t.name).join(", ")} — usado(s) pelas mensagens automáticas (lembrete, cobrança, confirmação de pagamento). Enquanto não estiver aprovado, esse aviso não chega para quem está fora da janela de 24h.
        </div>
      )}

      {!aberto ? (
        pendentes.length > 0 && (<>
          {esperando.length > 0 && (
            <div className="seg-hint">
              Esperando a Meta aprovar: {esperando.map((t) => t.name).join(", ")}. Costuma sair em minutos — clique em “Sincronizar agora” para conferir.
            </div>
          )}
          {barrados.length > 0 && (
            <div className="seg-hint">
              Não dá para usar: {barrados.map((t) => `${t.name} (${statusTpl(t.status)[1]})`).join(", ")}. Um template recusado precisa ser corrigido e submetido de novo na Meta.
            </div>
          )}
        </>)
      ) : (
        <table>
          <thead><tr><th>Template</th><th>Para quê</th><th>Status na Meta</th></tr></thead>
          <tbody>
            {[...opcoes.templates.map((t) => ({ ...t, uso: "disparo" })), ...sistema.map((t) => ({ ...t, uso: "automação" }))].map((t) => {
              const [cls, lbl] = statusTpl(t.status);
              return (
                <tr key={t.uso + t.name}>
                  <td className="c-main">
                    <span className="cli-name">{t.name}</span>
                    <div className="cli-sub">{t.category === "MARKETING" ? "marketing (custa mais)" : "utilidade"}</div>
                  </td>
                  <td data-l="Para quê"><span className="chip">{t.uso}</span></td>
                  <td data-l="Status na Meta">
                    <span className={`badge ${cls}`}>{lbl}</span>
                    {t.motivoRecusa && <div className="cli-sub">motivo: {t.motivoRecusa}</div>}
                    {t.status === "APPROVED" && t.uso === "disparo" && !t.usavel && <div className="cli-sub">aprovado, mas o disparo não dá conta: {t.motivo}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Os últimos disparos, para reabrir o de ontem e ver quem recebeu.
function UltimosDisparos({ lista, onAbrir }) {
  if (!lista?.length) return null;
  return (
    <div className="panel">
      <div className="panel-h"><h2>Últimos disparos</h2></div>
      <table>
        <thead><tr><th>Quando</th><th>Mensagem</th><th>Chegou</th><th></th></tr></thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.id}>
              <td className="c-main">
                <span className="cli-name">{dataHoraDe(d.inicioEm)}</span>
                <div className="cli-sub">{d.total} aluna(s) · por {d.por}{d.fimEm ? "" : " · enviando agora"}</div>
              </td>
              <td data-l="Mensagem">{d.modo === "template" ? <span className="chip">🧾 {d.template}</span> : <span className="chip">✍️ texto livre</span>}</td>
              <td data-l="Chegou">
                <span className="badge b-ok">{d.entregues} entregues</span>
                {d.aguardando > 0 && <span className="badge b-info ml">{d.aguardando} aguardando</span>}
                {d.naoChegaram > 0 && <span className="badge b-danger ml">{d.naoChegaram} não chegaram</span>}
                {d.puladas > 0 && <span className="badge b-warn ml">{d.puladas} puladas</span>}
              </td>
              <td><button className="btn ghost sm" onClick={() => onAbrir(d.id)}>Ver quem recebeu</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FILTROS_ANDAMENTO = [
  { k: "todas", label: "Todas" },
  { k: "faltando", label: "Ainda não receberam" },
  { k: "receberam", label: "Já receberam" },
];

function Andamento({ id, onNovo }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState("todas");
  const [agora, setAgora] = useState(() => Date.now());
  const fimRef = useRef(null);
  const pedir = useRef(null); // força uma sincronização fora do ritmo do timer

  useEffect(() => {
    let vivo = true, timer;
    const buscar = async () => {
      try {
        const r = await api.disparo.status(id);
        if (!vivo) return;
        setD(r); setErro(null); setAgora(Date.now());
        if (r.fimEm && !fimRef.current) fimRef.current = Date.now();
      } catch (e) { if (vivo) setErro(e.message); }
      /* Enquanto envia, a cada 2s. Depois de terminar a entrega ainda chega por
         uns 10 min (é a Meta que avisa, quando avisa), então segue de 8 em 8s e
         para — disparo velho não fica batendo no servidor à toa. */
      const terminou = fimRef.current;
      if (!vivo || (terminou && Date.now() - terminou > 10 * 60_000)) return;
      timer = setTimeout(buscar, terminou ? 8000 : 2000);
    };
    pedir.current = () => { clearTimeout(timer); buscar(); };
    buscar();
    return () => { vivo = false; clearTimeout(timer); };
  }, [id]);

  if (erro && !d) return <div className="panel empty"><div className="ic">🔌</div><p>{erro}</p><button className="btn" onClick={() => onNovo()}>Voltar</button></div>;
  if (!d) return <div className="panel empty"><div className="ic">📣</div><p>Carregando o disparo…</p></div>;

  const recebeu = (i) => i.entrega === "entregue" || i.entrega === "lido";
  const conta = (f) => d.itens.filter(f).length;
  const total = d.itens.length;
  const processadas = conta((i) => i.situacao !== "na fila");
  const enviadas = conta((i) => i.situacao === "enviado");
  const entregues = conta(recebeu);
  const lidas = conta((i) => i.entrega === "lido");
  const aguardando = conta((i) => i.situacao === "na fila" || i.entrega === "enviado");
  const naoChegaram = conta((i) => i.situacao === "erro" || i.entrega === "falhou");
  const puladas = conta((i) => i.situacao === "pulada");
  const faltaram = d.itens.filter((i) => !recebeu(i) && i.situacao !== "na fila");

  const itens = d.itens.filter((i) =>
    filtro === "receberam" ? recebeu(i)
    : filtro === "faltando" ? !recebeu(i)
    : true);

  const mandarDeNovo = () => {
    // quem não recebeu volta marcada na tela de composição
    const ids = d.itens.filter((i) => !recebeu(i)).map((i) => i.clientId);
    onNovo(ids);
  };

  return (<>
    <div className="grid stats" style={{ marginBottom: "1.2rem" }}>
      <div className="card stat"><div className="lbl">📤 Enviadas</div><div className="val">{enviadas}</div><div className="foot">{processadas} de {total} processadas</div></div>
      <div className="card stat"><div className="lbl">✓ Já receberam</div><div className="val">{entregues}</div><div className="foot">{lidas} lida(s)</div></div>
      <div className="card stat"><div className="lbl">⏳ Aguardando</div><div className="val">{aguardando}</div><div className="foot">a Meta aceitou, ainda não confirmou</div></div>
      <div className="card stat"><div className="lbl">✕ Não chegaram</div><div className="val warn">{naoChegaram}</div><div className="foot">erro no envio ou na entrega</div></div>
      <div className="card stat"><div className="lbl">⏭ Puladas</div><div className="val terra">{puladas}</div><div className="foot">sem telefone ou conversa fechada</div></div>
    </div>

    <div className="panel">
      <div className="panel-h">
        <h2>{d.fimEm ? "Disparo concluído" : `Enviando… ${processadas}/${total}`}</h2>
        <div className="tools">
          <span className="cli-sub">
            {d.modo === "template" ? `template ${d.template}` : "texto livre"} · por {d.por} · {dataHoraDe(d.inicioEm)}
          </span>
          <button className="btn ghost sm" onClick={() => pedir.current && pedir.current()}>🔄 Sincronizar</button>
          <button className="btn sec sm" disabled={!d.fimEm} onClick={() => onNovo()}>＋ Novo disparo</button>
        </div>
      </div>
      <div className="seg-hint">
        “Aguardando” não é “chegou”: a Meta aceita o envio na hora e confirma a entrega alguns segundos ou minutos depois, pelo webhook. Esta lista se atualiza sozinha — sincronizado {tempoDesde(d.sincronizadoEm, agora)}.
        {d.fimEm && faltaram.length > 0 && <> {faltaram.length} aluna(s) ainda não receberam.</>}
      </div>
      <div className="filters">
        <div className="seg seg-tabs">
          {FILTROS_ANDAMENTO.map((f) => (
            <button key={f.k} className={filtro === f.k ? "on" : ""} onClick={() => setFiltro(f.k)}>{f.label}</button>
          ))}
        </div>
        {d.fimEm && faltaram.length > 0 && (
          <button className="btn sec sm" onClick={mandarDeNovo}>📣 Mandar de novo para quem não recebeu ({faltaram.length})</button>
        )}
      </div>
      {itens.length ? (
        <table>
          <thead><tr><th>Aluna</th><th>Envio</th><th>Entrega</th></tr></thead>
          <tbody>
            {itens.map((i) => {
              const [cls, lbl] = SITUACAO_ENVIO[i.situacao] || ["b-muted", i.situacao];
              const ent = i.entrega ? ENTREGA[i.entrega] || ["b-muted", i.entrega] : null;
              return (
                <tr key={i.clientId}>
                  <td className="c-main"><span className="cli-name">{i.nome}</span><div className="cli-sub">{i.phone || "sem telefone"}</div></td>
                  <td data-l="Envio"><span className={`badge ${cls}`}>{lbl}</span>{i.motivo && <div className="cli-sub">{i.motivo}</div>}</td>
                  <td data-l="Entrega">
                    {ent ? <span className={`badge ${ent[0]}`}>{ent[1]}</span> : <span className="cli-sub">—</span>}
                    {i.erroEntrega && <div className="cli-sub">{i.erroEntrega}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <div className="empty">{filtro === "faltando" ? "Todas receberam. 💚" : "Ninguém nesse filtro."}</div>}
    </div>
  </>);
}
