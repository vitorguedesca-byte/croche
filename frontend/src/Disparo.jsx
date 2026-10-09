import { useState, useEffect, useMemo, useRef } from "react";
import { toast, confirmModal } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { Select, Modal, useModal } from "./ui.jsx";
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

   E quando o texto livre não alcança (quase sempre: poucas alunas
   estão com a janela aberta), a Inêz CRIA o template aqui mesmo —
   o servidor confere as regras da Meta, submete, e a tela acompanha
   a aprovação sozinha (ver CriarTemplate).
   ============================================================ */

const SITUACOES = [
  { value: "ativas", label: "Alunas ativas", icon: "💚" },
  { value: "mensalistas", label: "Mensalistas", icon: "📅" },
  { value: "avulsas", label: "Avulsas", icon: "🧺" },
  { value: "leads", label: "Pagamento não realizado", icon: "⚠️" },
  { value: "inativas", label: "Inativas", icon: "💤" },
  { value: "todas", label: "Todas as fichas", icon: "👩" },
  // quem recebe TEXTO LIVRE agora — de qualquer situação, lead incluída
  { value: "conversa", label: "Conversa aberta (24h)", icon: "💬" },
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
/* Os mesmos marcadores que o servidor troca (preencherDisparo): {nome},
   {nome_completo}, e {unidade}/{endereco} — os da unidade DELA. */
// "Timoteo" e "Timóteo" são a mesma unidade (igual a enderecoDaUnidade no servidor)
const chaveUnidade = (u) => String(u || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const enderecoDe = (enderecos, unit) =>
  Object.entries(enderecos || {}).find(([u]) => chaveUnidade(u) === chaveUnidade(unit))?.[1] || "";
const preencher = (txt, cli, enderecos = {}) =>
  String(txt ?? "")
    .replace(/\{nome_completo\}/gi, cli?.name || "")
    .replace(/\{nome\}/gi, primeiroNome(cli?.name))
    .replace(/\{unidade\}/gi, cli?.unit || "")
    .replace(/\{endere[cç]o\}/gi, enderecoDe(enderecos, cli?.unit));
/* Troca {{1}}, {{2}}... pelos valores (já com os dados da aluna). Campo ainda
   vazio mostra o exemplo aprovado na Meta, entre colchetes, para a prévia já
   dizer o que vai naquele lugar. */
const montar = (txt, valores, cli, enderecos, exemplos = []) =>
  String(txt || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const v = valores[Number(n) - 1];
    if (v && v.trim()) return preencher(v, cli, enderecos);
    const ex = exemplos[Number(n) - 1];
    return ex ? `[${ex}]` : `{{${n}}}`;
  });

/* O que entra sozinho em cada {{n}} ao escolher o template, lendo o texto em
   volta e o exemplo aprovado. "Feliz aniversário, {{1}}!" é o nome; "unidade
   {{1}}:" é a unidade; exemplo com "Rua ..." é o endereço. Fora disso o campo
   fica vazio, com o exemplo da Meta à vista — antes TODO {{1}} vinha com {nome},
   e o template do material ia com o nome da aluna no lugar da unidade. */
function palpite(texto, n, exemplo, unidades = []) {
  /* Template criado pelo painel leva um exemplo FIXO por marcador (ver
     waTemplateRegras.js no servidor) — é a resposta exata, vem primeiro. */
  if (exemplo === "Maria") return "{nome}";
  if (exemplo === "Maria Silva") return "{nome_completo}";
  if (exemplo && unidades.some((u) => chaveUnidade(u) === chaveUnidade(exemplo))) return "{unidade}";
  const antes = String(texto || "").split(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`))[0] || "";
  if (/unidade\s*$/i.test(antes)) return "{unidade}";
  if (/\b(rua|av\.?|avenida|praça|travessa|rodovia)\b/i.test(exemplo || "")) return "{endereco}";
  if (/,\s*$/.test(antes) || /\b(oi|ol[aá])\s*$/i.test(antes)) return "{nome}";
  return "";
}
// "…Endereço da unidade {{1}}: {{2}}" — o pedaço do texto em volta da variável
function trechoDe(texto, n) {
  const t = String(texto || "").replace(/\s+/g, " ");
  const m = t.match(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`));
  if (!m) return "";
  const ini = Math.max(0, m.index - 40), fim = Math.min(t.length, m.index + m[0].length + 25);
  return (ini > 0 ? "…" : "") + t.slice(ini, fim).trim() + (fim < t.length ? "…" : "");
}

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
/* Os códigos de falha de ENTREGA que mais aparecem, em português e com o que
   fazer. O 131049 é o limite de marketing por pessoa: a Meta não entrega e
   reenviar antes de 24h só gasta e falha de novo. */
const ERRO_META = {
  131049: "a Meta segurou: limite de marketing por pessoa (ela recebeu muito marketing). Não reenvie antes de 24h.",
  131050: "ela parou de receber marketing de empresas.",
  131047: "a conversa de 24h fechou antes de chegar — mande por template.",
  131026: "não deu para entregar (número sem WhatsApp, versão antiga ou bloqueio).",
  131056: "mensagens demais para o mesmo número em pouco tempo.",
  130472: "a Meta não entregou (número em teste interno dela).",
  131042: "problema de pagamento na conta do WhatsApp da escola.",
  132001: "template não existe (ou não neste idioma).",
  132015: "template pausado pela Meta por baixa qualidade.",
  132016: "template desativado pela Meta.",
};
const traduzErro = (txt) => {
  const cod = Number(String(txt || "").match(/^\d+/)?.[0]);
  return ERRO_META[cod] ? `${cod}: ${ERRO_META[cod]}` : txt;
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
  const { data, reload } = useStore();
  const [opcoes, setOpcoes] = useState(null);
  const [erroOpcoes, setErroOpcoes] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [jobId, setJobId] = useState(null);
  // alunas que já entram marcadas (vem de "mandar de novo para quem faltou")
  const [preSel, setPreSel] = useState(null);

  /* `sync` pergunta na hora para a Meta em vez de usar o cache de 5 min do
     servidor. Sem ele a tela ainda sincroniza — só aceita uma resposta de
     poucos minutos atrás, que é o suficiente para abrir a tela.

     O botão "Sincronizar agora" também relê as fichas (aluna nova, telefone
     corrigido) e SEMPRE responde com um aviso do que achou: antes ele
     sincronizava em silêncio e, como a lista vinha igual, parecia que não
     tinha feito nada. Se a Meta falhar aí, a tela fica como estava — só a
     abertura sem dados nenhuns vira a tela de erro.

     sync = "auto" é a resincronização sozinha enquanto há template esperando a
     Meta: pergunta para ela, mas sem aviso de "sincronizado" a cada minuto —
     o único aviso é o que interessa, "aprovou" ou "recusou". */
  const visto = useRef(null); // name → "STATUS/CATEGORIA" da última leitura
  const carregar = (sync = false) => {
    if (!sync) setErroOpcoes(null);
    if (sync === true) setSincronizando(true);
    return Promise.all([api.disparo.opcoes(!!sync), sync === true ? reload() : null])
      .then(([o]) => {
        setOpcoes(o);
        setErroOpcoes(null);
        if (o.emAndamento) setJobId(o.emAndamento);
        avisarMudancas(o);
        if (sync !== true) return;
        if (o.erroTemplates) { toast.error(`A Meta não respondeu: ${o.erroTemplates}`); return; }
        const prontos = o.templates.filter((t) => t.usavel).length;
        const esperando = o.templates.filter((t) => !t.usavel).length;
        toast(`Sincronizado ✓ ${prontos} template(s) pronto(s)${esperando ? `, ${esperando} sem liberar` : ""} · ${o.janelas.filter((j) => new Date(j.fechaEm) > new Date()).length} aluna(s) com a conversa aberta`);
      })
      .catch((e) => {
        if (sync && opcoes) toast.error(`Não consegui sincronizar: ${e.message}`);
        else setErroOpcoes(e.message);
      })
      .finally(() => setSincronizando(false));
  };
  useEffect(() => { carregar(false); }, []);

  /* A Meta decidiu algo desde a última leitura: aprovou, recusou, pausou ou
     reclassificou (utilidade → marketing muda o preço). Avisa uma vez. */
  function avisarMudancas(o) {
    const agora = new Map([...o.templates, ...o.templatesSistema].map((t) => [t.name, `${t.status}/${t.category}`]));
    const antes = visto.current;
    visto.current = agora;
    if (!antes) return;
    for (const t of [...o.templates, ...o.templatesSistema]) {
      const era = antes.get(t.name);
      if (!era || era === agora.get(t.name)) continue;
      const [stEra, catEra] = era.split("/");
      if (stEra !== t.status) {
        if (t.status === "APPROVED") toast(`✓ A Meta aprovou “${t.name}” — já dá para usar no disparo.`, "success", { duration: 9000 });
        else toast.error(`“${t.name}”: ${statusTpl(t.status)[1]}${t.motivoRecusa ? ` — ${t.motivoRecusa}` : ""}.`);
      } else if (catEra !== t.category) {
        toast.error(`A Meta mudou a categoria de “${t.name}” para ${t.category === "MARKETING" ? "marketing (mais caro)" : "utilidade"}.`);
      }
    }
  }

  /* Template esperando aprovação: a tela resincroniza com a Meta a cada minuto
     enquanto estiver aberta, para o "pode usar" virar sozinho — mesmo que o
     webhook de status não esteja assinado no app da Meta. */
  const esperandoMeta = !!opcoes && opcoes.templates.some((t) => t.status === "PENDING" || t.status === "IN_APPEAL");
  useEffect(() => {
    if (!esperandoMeta || jobId) return;
    const t = setInterval(() => { if (!document.hidden) carregar("auto"); }, 60_000);
    return () => clearInterval(t);
  }, [esperandoMeta, jobId]);

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
      onRecarregar={() => carregar("auto")}
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

function Composer({ data, opcoes, preSel, sincronizando, onSincronizar, onRecarregar, onAbrir, onIniciado }) {
  const { open } = useModal();
  // janela "criar template" — vazia, a partir do texto livre, ou corrigindo um recusado
  const criarTemplate = (inicial) =>
    open(<CriarTemplate inicial={inicial} opcoes={opcoes} onCriado={onRecarregar} />);
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
  const enderecos = opcoes.enderecos || {};
  const escolherTemplate = (name) => {
    const t = opcoes.templates.find((x) => x.name === name);
    setTplName(name);
    const ex = t?.exemplo || { header: [], body: [] };
    setHVals(Array.from({ length: t?.headerVars || 0 }, (_, i) => palpite(t.header, i + 1, ex.header[i], data.meta.units)));
    setBVals(Array.from({ length: t?.bodyVars || 0 }, (_, i) => palpite(t.body, i + 1, ex.body[i], data.meta.units)));
  };

  const lista = data.clients
    .filter((c) => (sitF === "conversa" ? abertas.has(c.id) : naSituacao(c, sitF)))
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
  const exemploCli = selecionadas[0] || { name: "Maria Silva", unit: data.meta.units[0] || "" };
  const exemploNome = exemploCli.name;
  // todas as fichas com a conversa aberta agora, marcadas ou não
  const abertasComTel = data.clients.filter((c) => abertas.has(c.id) && temTelefone(c));
  const abertasForaDaSel = abertasComTel.filter((c) => !sel.has(c.id));
  const soAbertas = () => setSel(new Set(abertasComTel.map((c) => c.id)));
  const tirarFechadas = () => setSel((s) => new Set([...s].filter((id) => abertas.has(id))));

  const faltaVariavel = modo === "template" && (!tpl || !tpl.usavel || [...hVals, ...bVals].some((v) => !v.trim()));
  // "Oi, {nome}!" sozinho não é mensagem
  const textoVazio = modo === "texto" && !texto.replace(/\{nome(_completo)?\}/gi, "").replace(/^\s*oi[,!\s]*/i, "").trim();
  const recebem = modo === "template" ? selecionadas.length : comConversaAberta;
  /* Por que ainda não dá para revisar — a MESMA frase aparece embaixo do botão
     e no aviso ao clicar. O botão não fica mais cinza e mudo: cinza sem
     explicação era o "o revisar envio não funciona". */
  const pendencia =
    !selecionadas.length ? "Selecione pelo menos uma aluna."
    : modo === "template" && !tpl ? "Escolha o template."
    : modo === "template" && !tpl.usavel ? "Este template ainda não está liberado pela Meta."
    : faltaVariavel ? "Preencha todas as variáveis do template."
    : textoVazio ? "Escreva a mensagem."
    : modo === "texto" && !recebem ? "Nenhuma das selecionadas está com a conversa aberta — texto livre não chega para elas. Use um template, ou filtre por “Conversa aberta (24h)”."
    : null;

  const previa = modo === "template" && tpl
    ? {
        header: tpl.header ? montar(tpl.header, hVals, exemploCli, enderecos, tpl.exemplo?.header) : null,
        body: montar(tpl.body, bVals, exemploCli, enderecos, tpl.exemplo?.body),
        footer: tpl.footer, buttons: tpl.buttons,
      }
    : { header: null, body: preencher(texto, exemploCli, enderecos), footer: null, buttons: [] };

  // {endereco} só existe para unidade com endereço cadastrado (o servidor pula as outras)
  const usaEndereco = (modo === "texto" ? [texto] : [...hVals, ...bVals]).some((v) => /\{endere[cç]o\}/i.test(v));
  const semEndereco = usaEndereco ? selecionadas.filter((c) => !enderecoDe(enderecos, c.unit)) : [];

  const revisar = async () => {
    if (pendencia) { toast.error(pendencia); return; }
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
        {semEndereco.length > 0 && <><br /><br />⚠️ {semEndereco.length} aluna(s) sem endereço de unidade cadastrado ficam de fora: {semEndereco.slice(0, 4).map((c) => primeiroNome(c.name)).join(", ")}{semEndereco.length > 4 ? "…" : ""}.</>}
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
            <div className="seg-hint">Chega para <b>todas</b> as selecionadas. É o único jeito de falar com quem não mandou mensagem para a escola nas últimas 24h. Cada envio é cobrado pela Meta (marketing é o mais caro).</div>
            {opcoes.erroTemplates && <div className="help" style={{ marginBottom: ".8rem", borderLeftColor: "var(--danger)" }}>⚠️ Não consegui ler os templates na Meta: {opcoes.erroTemplates}{opcoes.sincronizadoEm ? " — a lista abaixo é da última sincronização que deu certo." : ""}</div>}
            {!opcoes.erroTemplates && !opcoes.templates.length && <div className="help" style={{ marginBottom: ".8rem" }}>Nenhum template cadastrado na conta do WhatsApp. Ele precisa ser criado e aprovado na Meta antes.</div>}
            {opcoes.templates.length > 0 && (
              <div className="field">
                <label>Template</label>
                <Select value={tplName} onChange={escolherTemplate} options={templateOptions} placeholder="Escolha o template" />
              </div>
            )}
            {opcoes.wabaConfigurada && (
              <div style={{ marginBottom: ".8rem" }}>
                <button type="button" className="btn sec sm" onClick={() => criarTemplate()}>＋ Criar template novo</button>
                <span className="cli-sub" style={{ marginLeft: ".5rem" }}>o sistema confere as regras e manda para a Meta aprovar</span>
              </div>
            )}
            {tpl && !tpl.usavel && (
              <div className="help" style={{ borderLeftColor: "var(--danger)" }}>
                Este template não pode ser disparado: {tpl.motivo}.{tpl.motivoRecusa ? ` Motivo da Meta: ${tpl.motivoRecusa}.` : ""}
              </div>
            )}
            {tpl && tpl.usavel && (tpl.bodyVars + tpl.headerVars) === 0 && (
              <div className="help">Este template não tem variáveis: vai exatamente o texto da prévia, igual para todas.</div>
            )}
            {tpl && [["h", hVals, setHVals, tpl.header, tpl.exemplo?.header], ["b", bVals, setBVals, tpl.body, tpl.exemplo?.body]].map(([k, vals, setVals, txt, exs]) =>
              vals.map((v, i) => (
                <div className="field" key={k + i}>
                  <label>{k === "h" ? "Cabeçalho" : "Variável"} {`{{${i + 1}}}`}</label>
                  {trechoDe(txt, i + 1) && <div className="cli-sub" style={{ marginBottom: ".3rem" }}>{trechoDe(txt, i + 1)}</div>}
                  <input
                    value={v}
                    onChange={(e) => setVals((a) => a.map((x, j) => (j === i ? e.target.value.replace(/[\r\n]+/g, " ") : x)))}
                    placeholder={exs?.[i] ? `ex.: ${exs[i]}` : "texto que entra no lugar da variável"}
                  />
                  {exs?.[i] && (
                    <div className="cli-sub" style={{ marginTop: ".25rem" }}>
                      Exemplo aprovado na Meta: <b>{exs[i]}</b>
                    </div>
                  )}
                </div>
              )))}
            {tpl && (tpl.bodyVars + tpl.headerVars) > 0 && <div className="help">Escreva <b>{"{nome}"}</b> para o primeiro nome de cada aluna, <b>{"{nome_completo}"}</b>, <b>{"{unidade}"}</b> ou <b>{"{endereco}"}</b> (os da unidade dela). Variável não aceita quebra de linha.</div>}
          </>) : (<>
            <div className="seg-hint">
              Só chega para <b>quem falou com a escola nas últimas 24h</b> — das selecionadas, {comConversaAberta} de {selecionadas.length}. As demais ficam de fora (use um template para elas). Desde 01/10/2026 a Meta cobra também o texto livre, pelo preço de utilidade.
            </div>
            <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: ".8rem" }}>
              {abertasForaDaSel.length > 0 && (
                <button type="button" className="btn sec sm" onClick={soAbertas}>💬 Selecionar só as {abertasComTel.length} com conversa aberta</button>
              )}
              {selecionadas.length > comConversaAberta && comConversaAberta > 0 && (
                <button type="button" className="btn ghost sm" onClick={tirarFechadas}>Desmarcar as {selecionadas.length - comConversaAberta} com conversa fechada</button>
              )}
              {!abertasComTel.length && <span className="cli-sub">Ninguém está com a conversa aberta agora — para falar com elas, só por template.</span>}
              {opcoes.wabaConfigurada && selecionadas.length > comConversaAberta && (
                <button type="button" className="btn sm" onClick={() => criarTemplate({ corpo: texto, categoria: "UTILITY" })}>
                  🧾 Transformar este texto em template
                </button>
              )}
            </div>
            <div className="field">
              <label>Mensagem</label>
              <textarea rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000} />
            </div>
            <div className="help">Escreva <b>{"{nome}"}</b> para o primeiro nome de cada aluna, <b>{"{nome_completo}"}</b>, <b>{"{unidade}"}</b> ou <b>{"{endereco}"}</b>.</div>
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
          {modo === "template" && tpl && [...hVals, ...bVals].some((v) => !v.trim()) && (
            <div className="cli-sub" style={{ marginTop: ".4rem" }}>[entre colchetes] = exemplo aprovado na Meta, no lugar do campo que ainda está vazio.</div>
          )}
        </div>
      </div>
    </div>

    <div className="panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
      <div>
        <b>3. Revisar e enviar</b>
        <div className="cli-sub" style={pendencia && selecionadas.length ? { color: "var(--danger)" } : undefined}>
          {pendencia || `Vai para ${recebem} aluna(s)${modo === "texto" && recebem < selecionadas.length ? ` (${selecionadas.length - recebem} ficam de fora)` : ""}.`}
          {!opcoes.horarioBom && " · ⚠️ fora do horário das 8h às 20h"}
        </div>
      </div>
      <button className={`btn${pendencia ? " sec" : ""}`} disabled={enviando} onClick={revisar}>{enviando ? "Enviando…" : "📣 Revisar envio"}</button>
    </div>

    <TemplatesDaMeta opcoes={opcoes} onCriar={criarTemplate} />
    <UltimosDisparos lista={opcoes.ultimos} onAbrir={onAbrir} />
  </>);
}

/* Situação dos templates na Meta — os que ainda não dá para usar e os que as
   automações do sistema dependem. Fica fechado por padrão: no dia a dia não
   interessa, mas no dia em que a cobrança não sai é a primeira coisa a olhar. */
function TemplatesDaMeta({ opcoes, onCriar }) {
  const [aberto, setAberto] = useState(false);
  /* Recusado/pausado não se edita: vira um template NOVO, com o texto de volta
     em {nome}, {unidade}... e um nome novo (a Meta não deixa reaproveitar o
     nome de um template apagado). */
  const corrigir = (t) => onCriar({ ...t.rascunho, titulo: `${t.name}_v2` });
  const [verTpl, setVerTpl] = useState(null); // linha aberta, com o texto e o exemplo
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
          <button className="btn sec sm" onClick={() => onCriar()}>＋ Criar template</button>
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
              ⏳ Esperando a Meta aprovar: {esperando.map((t) => t.name).join(", ")}. Costuma sair em minutos (pode levar até 24h) — esta tela confere sozinha a cada minuto e avisa quando liberar.
            </div>
          )}
          {barrados.map((t) => (
            <div className="seg-hint" key={t.name} style={{ display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
              <span><b>{t.name}</b> não pode ser usado: {statusTpl(t.status)[1]}{t.motivoRecusa ? ` — ${t.motivoRecusa}` : ""}.</span>
              <button className="btn sec sm" onClick={() => corrigir(t)}>✏️ Corrigir e mandar de novo</button>
            </div>
          ))}
        </>)
      ) : (
        <table>
          <thead><tr><th>Template</th><th>Para quê</th><th>Status na Meta</th><th>Pode usar?</th></tr></thead>
          <tbody>
            {[...opcoes.templates.map((t) => ({ ...t, uso: "disparo" })), ...sistema.map((t) => ({ ...t, uso: "automação" }))].map((t) => {
              const [cls, lbl] = statusTpl(t.status);
              const k = t.uso + t.name;
              const vendo = verTpl === k;
              return (
                <tr key={k} onClick={() => setVerTpl(vendo ? null : k)} style={{ cursor: "pointer" }} title="Clique para ver o texto com o exemplo aprovado">
                  <td className="c-main">
                    <span className="cli-name">{vendo ? "▾" : "▸"} {t.name}</span>
                    <div className="cli-sub">{t.category === "MARKETING" ? "marketing (custa mais)" : "utilidade"}</div>
                    {vendo && <ExemploTemplate t={t} />}
                  </td>
                  <td data-l="Para quê"><span className="chip">{t.uso}</span></td>
                  <td data-l="Status na Meta">
                    <span className={`badge ${cls}`}>{lbl}</span>
                    {t.motivoRecusa && <div className="cli-sub">motivo: {t.motivoRecusa}</div>}
                    {t.status === "APPROVED" && t.uso === "disparo" && !t.usavel && <div className="cli-sub">aprovado, mas o disparo não dá conta: {t.motivo}</div>}
                    {t.qualidade && t.qualidade !== "alta" && <div className="cli-sub" style={{ color: "var(--danger)" }}>qualidade {t.qualidade} — a Meta pode pausar</div>}
                  </td>
                  <td data-l="Pode usar?">
                    {t.uso === "automação"
                      ? (t.status === "APPROVED" ? <span className="badge b-ok">✓ automação ok</span> : <span className="badge b-danger">✕ automação parada</span>)
                      : t.usavel ? <span className="badge b-ok">✓ pode usar</span>
                      : t.status === "PENDING" || t.status === "IN_APPEAL" ? <span className="badge b-warn">⏳ ainda não</span>
                      : <span className="badge b-danger">✕ não pode</span>}
                    {t.uso === "disparo" && !t.usavel && !["PENDING", "IN_APPEAL"].includes(t.status) && t.rascunho && (
                      <div style={{ marginTop: ".35rem" }}><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); corrigir(t); }}>✏️ Corrigir e mandar de novo</button></div>
                    )}
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

/* ---------- Criar template ----------

   A Inêz escreve com os mesmos marcadores do disparo ({nome}, {unidade}…) e
   vê, enquanto digita, o que a Meta recusaria (erros — não deixa mandar) e o
   que ela precisa saber (avisos — custo, categoria). Quem confere é o
   servidor (waTemplateRegras.js), o mesmo que submete: não há regra repetida
   aqui. Depois de enviado, o template aparece na lista como "aguardando a
   Meta", e a tela avisa sozinha quando ele for aprovado ou recusado. */
const CATEGORIAS = [
  { k: "UTILITY", label: "🧾 Utilidade", dica: "Sobre algo DELA: aula, horário, reposição, pagamento. Sem oferta nem convite. Mais barato." },
  { k: "MARKETING", label: "📢 Marketing", dica: "Novidade, promoção, convite, evento, aniversário. Mais caro, e a Meta limita quantos cada pessoa recebe." },
];

function CriarTemplate({ inicial, opcoes, onCriado }) {
  const { close } = useModal();
  const [f, setF] = useState(() => ({
    titulo: "", categoria: "UTILITY", cabecalho: "", corpo: "Oi, {nome}! ", rodape: "",
    ...(inicial || {}),
  }));
  const [conf, setConf] = useState(null);
  const [busy, setBusy] = useState(false);
  const corpoRef = useRef(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // confere no servidor 0,4s depois de parar de digitar
  useEffect(() => {
    const t = setTimeout(() => {
      api.disparo.conferirTemplate(f).then(setConf).catch((e) => setConf({ erros: [e.message], avisos: [], previa: null, name: "" }));
    }, 400);
    return () => clearTimeout(t);
  }, [f]);

  // põe o marcador onde está o cursor, e não sempre no fim
  const inserir = (m) => {
    const el = corpoRef.current;
    const ini = el ? el.selectionStart : f.corpo.length;
    const fim = el ? el.selectionEnd : ini;
    const tag = `{${m}}`;
    set("corpo", f.corpo.slice(0, ini) + tag + f.corpo.slice(fim));
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(ini + tag.length, ini + tag.length); } });
  };

  const enviar = async () => {
    let c = conf;
    try { c = await api.disparo.conferirTemplate(f); setConf(c); } catch (e) { toast.error(e.message); return; }
    if (c.erros.length) { toast.error(c.erros[0]); return; }
    const cat = CATEGORIAS.find((x) => x.k === f.categoria);
    const ok = await confirmModal({
      title: "Enviar para aprovação da Meta",
      confirmLabel: "📤 Enviar para a Meta",
      message: (<>
        Template <b>{c.name}</b> · {cat?.label}.<br /><br />
        “{c.previa.body.length > 260 ? c.previa.body.slice(0, 260) + "…" : c.previa.body}”<br /><br />
        A Meta revisa em minutos (às vezes até 24h). Enquanto isso ele aparece como “aguardando a Meta” e não pode ser usado; esta tela avisa quando sair a resposta.
        {c.avisos.length > 0 && <><br /><br />⚠️ {c.avisos[0]}</>}
        <br /><br />Depois de enviado, o texto não muda: para corrigir, cria-se outro com nome novo.
      </>),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.disparo.criarTemplate(f);
      toast(r.status === "APPROVED" ? `✓ “${r.name}” aprovado na hora — já dá para usar.` : `📤 “${r.name}” enviado. Aguardando a Meta aprovar.`, "success", { duration: 8000 });
      if (r.category && r.category !== f.categoria) toast.error(`A Meta registrou “${r.name}” como ${r.category === "MARKETING" ? "marketing" : "utilidade"}, não como você escolheu.`);
      close();
      onCriado && onCriado(r);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const lim = opcoes.limitesTemplate || { cabecalho: 60, corpo: 1024, rodape: 60 };
  const marcadores = opcoes.marcadores || { nome: "primeiro nome da aluna", nome_completo: "nome completo", unidade: "unidade dela", endereco: "endereço da unidade dela" };
  const erros = conf?.erros || [];
  const avisos = conf?.avisos || [];

  return (
    <Modal size="lg" title="Criar template do WhatsApp" footer={<>
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className={`btn${erros.length ? " sec" : ""}`} disabled={busy} onClick={enviar}>{busy ? "Enviando…" : "📤 Enviar para aprovação da Meta"}</button>
    </>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.2rem" }}>
        <div>
          <div className="field">
            <label>Nome do template</label>
            <input value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="ex.: Aviso de feriado" maxLength={80} />
            <div className="cli-sub" style={{ marginTop: ".25rem" }}>
              {conf?.name ? <>na Meta fica <b>{conf.name}</b></> : "só para a escola achar depois — a aluna não vê"}
            </div>
          </div>

          <div className="field">
            <label>Categoria</label>
            <div className="seg seg-tabs">
              {CATEGORIAS.map((c) => (
                <button key={c.k} type="button" className={f.categoria === c.k ? "on" : ""} onClick={() => set("categoria", c.k)}>{c.label}</button>
              ))}
            </div>
            <div className="seg-hint" style={{ marginTop: ".4rem" }}>{CATEGORIAS.find((c) => c.k === f.categoria)?.dica}</div>
          </div>

          <div className="field">
            <label>Cabeçalho <span className="cli-sub">(opcional · até {lim.cabecalho} · sem emoji)</span></label>
            <input value={f.cabecalho} onChange={(e) => set("cabecalho", e.target.value)} maxLength={lim.cabecalho + 20} placeholder="ex.: Aviso da escola" />
          </div>

          <div className="field">
            <label>Mensagem <span className="cli-sub">({f.corpo.length}/{lim.corpo})</span></label>
            <textarea ref={corpoRef} rows={8} value={f.corpo} onChange={(e) => set("corpo", e.target.value)} maxLength={lim.corpo + 200} />
            <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap", marginTop: ".4rem" }}>
              {Object.entries(marcadores).map(([k, d]) => (
                <button key={k} type="button" className="btn ghost sm" title={d} onClick={() => inserir(k)}>＋ {`{${k}}`}</button>
              ))}
            </div>
            <div className="cli-sub" style={{ marginTop: ".3rem" }}>Os marcadores viram o dado de cada aluna na hora do disparo. Não comece nem termine a mensagem com um marcador.</div>
          </div>

          <div className="field">
            <label>Rodapé <span className="cli-sub">(opcional · até {lim.rodape} · texto fixo)</span></label>
            <input value={f.rodape} onChange={(e) => set("rodape", e.target.value)} maxLength={lim.rodape + 20} placeholder="ex.: Fios que Curam · Ipatinga e Timóteo" />
          </div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: ".82rem", fontWeight: 700, color: "var(--brown)", marginBottom: ".35rem" }}>
            Prévia com o exemplo que vai para a Meta
          </label>
          <div style={{ background: "#e5ddd5", borderRadius: 12, padding: "1rem", minHeight: 120 }}>
            {conf?.previa?.body ? (
              <div style={{ background: "#fff", borderRadius: "0 10px 10px 10px", padding: ".6rem .8rem", maxWidth: 360, boxShadow: "0 1px 1px rgba(0,0,0,.12)", whiteSpace: "pre-wrap", fontSize: ".9rem", lineHeight: 1.4, color: "#222" }}>
                {conf.previa.header && <div style={{ fontWeight: 700, marginBottom: ".3rem" }}>{conf.previa.header}</div>}
                {conf.previa.body}
                {conf.previa.footer && <div style={{ color: "#8a8a8a", fontSize: ".78rem", marginTop: ".4rem" }}>{conf.previa.footer}</div>}
              </div>
            ) : <div className="cli-sub">Escreva a mensagem para ver a prévia.</div>}
          </div>

          <div style={{ marginTop: ".9rem" }}>
            {!conf ? <div className="cli-sub">Conferindo as regras da Meta…</div>
              : !erros.length ? <div className="help" style={{ borderLeftColor: "var(--ok)" }}>✓ Passa nas regras da Meta — pode enviar para aprovação.</div>
              : (
                <div className="help" style={{ borderLeftColor: "var(--danger)" }}>
                  <b>A Meta recusaria — corrija antes:</b>
                  <ul style={{ margin: ".3rem 0 0 1rem", padding: 0 }}>{erros.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
            {avisos.map((a, i) => <div key={i} className="seg-hint" style={{ marginTop: ".5rem" }}>⚠️ {a}</div>)}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* O texto do template como a Meta aprovou, com os valores de exemplo que foram
   mandados na aprovação no lugar de cada {{n}} — é o "como fica" de cada um,
   sem precisar abrir o Gerenciador do WhatsApp. */
function ExemploTemplate({ t }) {
  const ex = t.exemplo || { header: [], body: [] };
  const comExemplo = (txt, vals) =>
    String(txt || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => vals[Number(n) - 1] || m);
  if (!t.body) return <div className="cli-sub" style={{ marginTop: ".4rem" }}>Sem texto para mostrar.</div>;
  return (
    <div style={{ background: "#e5ddd5", borderRadius: 10, padding: ".7rem", marginTop: ".5rem", maxWidth: 420, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
      <div style={{ background: "#fff", borderRadius: "0 10px 10px 10px", padding: ".55rem .75rem", boxShadow: "0 1px 1px rgba(0,0,0,.12)", whiteSpace: "pre-wrap", fontSize: ".85rem", lineHeight: 1.4, color: "#222" }}>
        {t.header && <div style={{ fontWeight: 700, marginBottom: ".3rem" }}>{comExemplo(t.header, ex.header)}</div>}
        {comExemplo(t.body, ex.body)}
        {t.footer && <div style={{ color: "#8a8a8a", fontSize: ".75rem", marginTop: ".4rem" }}>{t.footer}</div>}
        {(t.buttons || []).map((b, i) => (
          <div key={i} style={{ borderTop: "1px solid #eee", marginTop: ".5rem", paddingTop: ".4rem", textAlign: "center", color: "#1f8fd6", fontWeight: 600 }}>{b}</div>
        ))}
      </div>
      {ex.body.length + ex.header.length > 0
        ? <div className="cli-sub" style={{ marginTop: ".35rem" }}>Exemplo aprovado: {[
            ...ex.header.map((v, i) => `cabeçalho {{${i + 1}}} = ${v}`),
            ...ex.body.map((v, i) => `{{${i + 1}}} = ${v}`),
          ].join(" · ")}</div>
        : <div className="cli-sub" style={{ marginTop: ".35rem" }}>Sem variáveis — vai sempre este texto.</div>}
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

  const mandarDeNovo = async () => {
    // quem não recebeu volta marcada na tela de composição
    let alvo = d.itens.filter((i) => !recebeu(i));
    // limite de marketing (131049): reenviar antes de 24h falha de novo e é cobrado
    const seguradas = alvo.filter((i) => /^131049\b/.test(i.erroEntrega || ""));
    if (seguradas.length && Date.now() - new Date(d.inicioEm).getTime() < 24 * 3600_000) {
      const r = await confirmModal({
        title: "Algumas foram seguradas pela Meta",
        message: `${seguradas.length} aluna(s) não receberam por causa do limite de marketing por pessoa (131049). A Meta pede para esperar 24h — reenviar agora deve falhar de novo.`,
        confirmLabel: `Deixar essas ${seguradas.length} de fora`,
        altLabel: "Marcar todas mesmo assim",
      });
      if (r === false) return;
      if (r === true) alvo = alvo.filter((i) => !seguradas.includes(i));
    }
    onNovo(alvo.map((i) => i.clientId));
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
                    {i.erroEntrega && <div className="cli-sub">{traduzErro(i.erroEntrega)}</div>}
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
