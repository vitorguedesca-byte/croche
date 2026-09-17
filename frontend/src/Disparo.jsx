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

   Por que existem dois modos: fora da janela de 24h só template
   aprovado chega. Texto livre para quem não falou com a escola
   recentemente é aceito pela Meta e descartado em silêncio — então
   o modo texto só manda para quem está com a conversa aberta e
   mostra as demais como puladas.
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
  enviado: ["b-info", "📤 aceita pela Meta"],
  entregue: ["b-ok", "✓ entregue"],
  lido: ["b-ok", "✓✓ lida"],
  falhou: ["b-danger", "✕ não chegou"],
};

export default function Disparo() {
  const { data } = useStore();
  const [opcoes, setOpcoes] = useState(null);
  const [erroOpcoes, setErroOpcoes] = useState(null);
  const [jobId, setJobId] = useState(null);

  const carregar = () => {
    setErroOpcoes(null);
    api.disparo.opcoes()
      .then((o) => { setOpcoes(o); if (o.emAndamento) setJobId(o.emAndamento); })
      .catch((e) => setErroOpcoes(e.message));
  };
  useEffect(carregar, []);

  if (jobId) return <Andamento id={jobId} onNovo={() => { setJobId(null); carregar(); }} />;
  if (erroOpcoes) return <div className="panel empty"><div className="ic">🔌</div><p>Não consegui carregar as opções do WhatsApp.</p><p className="cli-sub">{erroOpcoes}</p><button className="btn" onClick={carregar}>Tentar de novo</button></div>;
  if (!opcoes) return <div className="panel empty"><div className="ic">💬</div><p>Carregando templates do WhatsApp…</p></div>;
  return <Composer data={data} opcoes={opcoes} onIniciado={setJobId} />;
}

function Composer({ data, opcoes, onIniciado }) {
  const abertas = useMemo(() => new Set(opcoes.janelaAberta), [opcoes]);
  const [search, setSearch] = useState("");
  const [unitF, setUnitF] = useState("Todas");
  const [sitF, setSitF] = useState("ativas");
  const [sel, setSel] = useState(() => new Set());
  const [modo, setModo] = useState(opcoes.templates.some((t) => t.suportado) ? "template" : "texto");
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

  const faltaVariavel = modo === "template" && (!tpl || [...hVals, ...bVals].some((v) => !v.trim()));
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

  const templateOptions = opcoes.templates.map((t) => ({
    value: t.name,
    label: t.name,
    icon: t.category === "MARKETING" ? "📢" : "🧾",
    hint: t.suportado ? `${t.category === "MARKETING" ? "marketing" : "utilidade"} · ${t.bodyVars + t.headerVars} variável(is)` : `não dá para usar: ${t.motivo}`,
    disabled: !t.suportado,
  }));

  return (<>
    {!opcoes.waConfigurado && <div className="help" style={{ marginBottom: "1rem", borderLeftColor: "var(--danger)" }}>⚠️ O WhatsApp não está configurado no servidor — o envio vai falhar.</div>}

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
            <thead><tr><th style={{ width: 40 }}></th><th>Aluna</th><th>Unidade</th><th>Conversa</th></tr></thead>
            <tbody>
              {lista.map((c) => {
                const tel = temTelefone(c);
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
                    <td data-l="Conversa">
                      {abertas.has(c.id)
                        ? <span className="badge b-ok" title="Falou com a escola nas últimas 24h — recebe texto livre">💬 aberta</span>
                        : <span className="badge b-muted" title="Só template chega">fechada</span>}
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
      <div className="panel-h"><h2>2. Mensagem</h2></div>
      <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
        <button className={modo === "template" ? "on" : ""} onClick={() => setModo("template")}>🧾 Template aprovado</button>
        <button className={modo === "texto" ? "on" : ""} onClick={() => setModo("texto")}>✍️ Texto livre</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.2rem" }}>
        <div>
          {modo === "template" ? (<>
            <div className="seg-hint">Chega para <b>todas</b> as selecionadas. É o único jeito de falar com quem não mandou mensagem para a escola nas últimas 24h. Cada envio é cobrado pela Meta.</div>
            {opcoes.erroTemplates && <div className="help" style={{ marginBottom: ".8rem", borderLeftColor: "var(--danger)" }}>⚠️ Não consegui ler os templates: {opcoes.erroTemplates}</div>}
            {!opcoes.erroTemplates && !opcoes.templates.length && <div className="help" style={{ marginBottom: ".8rem" }}>Nenhum template aprovado disponível para disparo. Ele precisa ser criado e aprovado na Meta antes.</div>}
            {opcoes.templates.length > 0 && (
              <div className="field">
                <label>Template</label>
                <Select value={tplName} onChange={escolherTemplate} options={templateOptions} placeholder="Escolha o template" />
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
            : faltaVariavel ? (tpl ? "Preencha todas as variáveis do template." : "Escolha o template.")
            : textoVazio ? "Escreva a mensagem."
            : modo === "texto" && !recebem ? "Nenhuma das selecionadas está com a conversa aberta — use um template."
            : `Vai para ${recebem} aluna(s)${modo === "texto" && recebem < selecionadas.length ? ` (${selecionadas.length - recebem} ficam de fora)` : ""}.`}
          {!opcoes.horarioBom && " · ⚠️ fora do horário das 8h às 20h"}
        </div>
      </div>
      <button className="btn" disabled={!podeRevisar} onClick={revisar}>📣 Revisar envio</button>
    </div>
  </>);
}

function Andamento({ id, onNovo }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState(null);
  const fimRef = useRef(null);

  useEffect(() => {
    let vivo = true, timer;
    const buscar = async () => {
      try {
        const r = await api.disparo.status(id);
        if (!vivo) return;
        setD(r); setErro(null);
        if (r.fimEm && !fimRef.current) fimRef.current = Date.now();
      } catch (e) { if (vivo) setErro(e.message); }
      // enquanto envia, a cada 2s; depois, a entrega continua chegando por uns 10 min
      const terminou = fimRef.current;
      if (!vivo || (terminou && Date.now() - terminou > 10 * 60_000)) return;
      timer = setTimeout(buscar, terminou ? 8000 : 2000);
    };
    buscar();
    return () => { vivo = false; clearTimeout(timer); };
  }, [id]);

  if (erro && !d) return <div className="panel empty"><div className="ic">🔌</div><p>{erro}</p><button className="btn" onClick={onNovo}>Voltar</button></div>;
  if (!d) return <div className="panel empty"><div className="ic">📣</div><p>Carregando o disparo…</p></div>;

  const conta = (f) => d.itens.filter(f).length;
  const total = d.itens.length;
  const processadas = conta((i) => i.situacao !== "na fila");
  const enviadas = conta((i) => i.situacao === "enviado");
  const entregues = conta((i) => i.entrega === "entregue" || i.entrega === "lido");
  const lidas = conta((i) => i.entrega === "lido");
  const naoChegaram = conta((i) => i.situacao === "erro" || i.entrega === "falhou");
  const puladas = conta((i) => i.situacao === "pulada");

  return (<>
    <div className="grid stats" style={{ marginBottom: "1.2rem" }}>
      <div className="card stat"><div className="lbl">📤 Enviadas</div><div className="val">{enviadas}</div><div className="foot">{processadas} de {total} processadas</div></div>
      <div className="card stat"><div className="lbl">✓ Entregues</div><div className="val">{entregues}</div><div className="foot">{lidas} lida(s)</div></div>
      <div className="card stat"><div className="lbl">✕ Não chegaram</div><div className="val warn">{naoChegaram}</div><div className="foot">erro no envio ou na entrega</div></div>
      <div className="card stat"><div className="lbl">⏭ Puladas</div><div className="val terra">{puladas}</div><div className="foot">sem telefone ou conversa fechada</div></div>
    </div>

    <div className="panel">
      <div className="panel-h">
        <h2>{d.fimEm ? "Disparo concluído" : `Enviando… ${processadas}/${total}`}</h2>
        <div className="tools">
          <span className="cli-sub">{d.modo === "template" ? `template ${d.template}` : "texto livre"} · por {d.por}</span>
          <button className="btn sec sm" disabled={!d.fimEm} onClick={onNovo}>＋ Novo disparo</button>
        </div>
      </div>
      <div className="seg-hint">
        “Aceita pela Meta” ainda não quer dizer que chegou: a entrega é confirmada alguns segundos ou minutos depois, e esta lista se atualiza sozinha.
      </div>
      <table>
        <thead><tr><th>Aluna</th><th>Envio</th><th>Entrega</th></tr></thead>
        <tbody>
          {d.itens.map((i) => {
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
    </div>
  </>);
}
