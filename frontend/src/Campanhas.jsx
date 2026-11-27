import { useState, useEffect, useMemo } from "react";
import { toast, confirmModal } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { Modal, Select, useModal } from "./ui.jsx";
import { Chave } from "./Config.jsx";
import { api, canAccess } from "./api.js";
import { money, fmtDate, compLabel } from "./helpers.js";
import { CriarTemplate } from "./Disparo.jsx";
import { FORMAS_PAGAMENTO } from "./modals.jsx";

/* ============================================================
   Campanhas com código (voucher).

   A Inêz cria a campanha, escolhe o que ela dá (isenção da
   matrícula, desconto na mensalidade por X meses, aula
   experimental, prêmio) e as regras (os X primeiros, validade,
   unidade, planos). A aluna digita o código:
   • na matrícula pelo site (/agendar) ou pelo WhatsApp, antes
     de o Pix nascer;
   • na mensalidade, pelo portal — se a campanha for para
     quem já estuda.

   A tela segue o desenho do resto do painel: cartões de resumo
   (como o Painel), abas com contagem (como Marcações), tabela no
   painel padrão e formulário em janela (como "Novo aluno"). Os
   benefícios usam o mesmo interruptor das Configurações.

   As contas de verdade estão no servidor (backend/src/vouchers.js);
   a prévia do formulário só ilustra com o plano 1x.
   ============================================================ */

// O botão "Nova campanha" mora na barra do topo (App.jsx), fora desta tela:
// depois de salvar, avisa a lista por este evento para ela se recarregar.
const EVENTO_RECARREGAR = "fqc:campanhas";
const avisarLista = () => window.dispatchEvent(new Event(EVENTO_RECARREGAR));

const PUBLICOS = [
  { value: "novas", label: "Alunas novas", hint: "Na matrícula ou aula avulsa — pelo site ou pelo WhatsApp." },
  { value: "alunas", label: "Quem já estuda", hint: "Na mensalidade, pelo portal (ou aplicado pela escola)." },
  { value: "todas", label: "Todas", hint: "Vale nos dois lugares." },
];
const TIPOS = [
  { value: "percentual", label: "% de desconto" },
  { value: "valor", label: "R$ a menos" },
  { value: "preco", label: "Mensalidade sai por R$" },
];
const SITUACAO_COR = { ativa: "b-ok", agendada: "b-info", esgotada: "b-warn", encerrada: "b-muted", pausada: "b-muted" };
const USO_STATUS = {
  reservado: ["b-info", "Aguardando Pix"],
  confirmado: ["b-ok", "Usado"],
  expirado: ["b-muted", "Pix não pago"],
  cancelado: ["b-danger", "Cancelado"],
};
const CONTEXTO = { matricula: "Matrícula", avulsa: "Aula avulsa", mensalidade: "Mensalidade" };
const ABAS = [
  ["ativas", "Ativas", (c) => c.situacao.codigo === "ativa"],
  ["programadas", "Programadas", (c) => c.situacao.codigo === "agendada" || c.situacao.codigo === "pausada"],
  ["encerradas", "Encerradas", (c) => c.situacao.codigo === "encerrada" || c.situacao.codigo === "esgotada"],
  ["todas", "Todas", () => true],
];

const VAZIO = {
  nome: "", codigo: "", descricao: "", publico: "novas",
  isentaMatricula: false,
  temDesconto: false, descontoTipo: "percentual", descontoValor: "", descontoMeses: 1,
  aulaExperimental: false, valorExperimental: 0,
  temPremio: false, premio: "",
  temAulas: false, aulasExtras: 1,
  temPacote: false, pacoteInicio: "", pacoteGratis: 1, pacotePagos: 3, pacotePrazo: "uso", pacoteVenceEm: "",
  limiteUsos: "", inicio: "", fim: "", unidade: "", planos: [], ativo: true,
};

/* ---------- pacote: a mesma conta de backend/src/vouchers.js → mesesDoPacote ---------- */
const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const somaMes = (comp, n) => {
  const [y, m] = comp.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const nomeMes = (comp) => `${MESES_PT[Number(comp.slice(5, 7)) - 1]}/${comp.slice(0, 4)}`;
function listaMeses(comps) {
  if (!comps.length) return "";
  const anos = new Set(comps.map((c) => c.slice(0, 4)));
  const nomes = anos.size === 1 ? comps.map((c) => MESES_PT[Number(c.slice(5, 7)) - 1]) : comps.map(nomeMes);
  const txt = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return anos.size === 1 ? `${txt}/${[...anos][0]}` : txt;
}
function mesesDoPacoteForm(f) {
  if (!f.temPacote || !/^\d{4}-\d{2}$/.test(f.pacoteInicio || "")) return null;
  const g = Math.max(0, Number(f.pacoteGratis) || 0), n = Math.max(1, Number(f.pacotePagos) || 1);
  const gratis = Array.from({ length: g }, (_, i) => somaMes(f.pacoteInicio, i));
  const pagos = Array.from({ length: n }, (_, i) => somaMes(f.pacoteInicio, g + i));
  return { gratis, pagos, cobranca: (gratis[0] || pagos[0]), volta: somaMes(f.pacoteInicio, g + n) };
}
/* Benefícios em etiquetas curtas, para a lista. O texto completo (o mesmo que
   a aluna vê) fica no title, ao passar o mouse. */
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesCurto = (comp) => `${MES_CURTO[Number(comp.slice(5, 7)) - 1]}/${comp.slice(2, 4)}`;
const faixaCurta = (comps) => (comps.length === 1 ? mesCurto(comps[0])
  : comps[0].slice(0, 4) === comps[comps.length - 1].slice(0, 4)
    ? `${MES_CURTO[Number(comps[0].slice(5, 7)) - 1]} a ${mesCurto(comps[comps.length - 1])}`
    : `${mesCurto(comps[0])} a ${mesCurto(comps[comps.length - 1])}`);
const primeiraMaiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function etiquetasDaCampanha(c) {
  const out = [];
  const pac = c.pacoteInicio
    ? mesesDoPacoteForm({ temPacote: true, pacoteInicio: c.pacoteInicio, pacoteGratis: c.pacoteGratis, pacotePagos: c.pacotePagos })
    : null;
  if (pac) {
    if (pac.gratis.length) out.push(`${primeiraMaiuscula(faixaCurta(pac.gratis))} grátis`);
    out.push(`${primeiraMaiuscula(faixaCurta(pac.pagos))} num Pix só`);
    out.push(c.pacoteVenceEm ? `Pix até ${fmtDate(c.pacoteVenceEm).slice(0, 5)}` : "Pix no dia do uso");
  }
  if (c.isentaMatricula || pac) out.push("Sem taxa de matrícula");
  if (c.descontoTipo) {
    const x = Number(c.descontoValor) || 0, m = Number(c.descontoMeses) || 1;
    const quanto = c.descontoTipo === "percentual" ? `${x}% off` : c.descontoTipo === "valor" ? `${money(x)} off` : `Mensalidade ${money(x)}`;
    out.push(m > 1 ? `${quanto} · ${m} meses` : quanto);
  }
  if (c.aulaExperimental) out.push(Number(c.valorExperimental) > 0 ? `Experimental ${money(c.valorExperimental)}` : "Experimental grátis");
  if (c.aulasExtras > 0) out.push(c.aulasExtras === 1 ? "1 aula de presente" : `${c.aulasExtras} aulas de presente`);
  if (c.premio) out.push(`🎁 ${c.premio}`);
  return out;
}

/* ---------- WhatsApp: a mensagem do disparo em massa da campanha ----------
   O texto nasce da própria campanha (benefícios, código, prazo e onde usar) e a
   Inêz ajusta antes de mandar para a Meta. Vai como MARKETING: é promoção, e a
   Meta reclassificaria uma "utilidade" com oferta de qualquer jeito. */
const RODAPE_WA = "Fios que Curam · Ipatinga e Timóteo";
const ONDE_USAR = {
  novas: "na matrícula pelo site ou aqui pelo WhatsApp",
  alunas: "no seu portal, em “Minha mensalidade”",
  todas: "no portal (se você já estuda) ou na matrícula pelo site e aqui pelo WhatsApp",
};
// Para quem o disparo é sugerido (filtro da tela de Disparo)
const PUBLICO_DISPARO = { novas: "interessadas", alunas: "mensalistas", todas: "tudo" };
function textoDivulgacao(c) {
  const linhas = (c.beneficios || []).map((b) => `• ${b}`);
  const prazo = c.fim ? ` até ${fmtDate(c.fim).slice(0, 5)}` : "";
  const corpo = [
    "Oi, {nome}! 💚",
    c.descricao || `Temos uma novidade para você: ${c.nome}.`,
    linhas.join("\n"),
    `Para aproveitar, use o código *${c.codigo}*${prazo}, ${ONDE_USAR[c.publico] || ONDE_USAR.todas}.`,
    "Qualquer dúvida, é só responder esta mensagem.",
  ].filter(Boolean).join("\n\n");
  return corpo.slice(0, 1024);
}
const inicialDoTemplate = (c) => ({
  titulo: `Campanha ${c.codigo}`,
  categoria: "MARKETING",
  cabecalho: "",
  corpo: textoDivulgacao(c),
  rodape: RODAPE_WA,
});
const WA_SITUACAO = {
  APPROVED: ["b-ok", "WhatsApp aprovado"],
  PENDING: ["b-info", "WhatsApp na Meta"],
  IN_APPEAL: ["b-info", "WhatsApp em recurso"],
  REJECTED: ["b-danger", "WhatsApp recusado"],
  PAUSED: ["b-warn", "WhatsApp pausado"],
  DISABLED: ["b-danger", "WhatsApp desativado"],
};

// Mês seguinte a uma data 'YYYY-MM-DD' — sugestão de início do pacote
const mesSeguinte = (iso) => (iso ? somaMes(iso.slice(0, 7), 1) : "");

const codigoLimpo = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");

// Mesma conta do servidor (vouchers.js → aplicarDesconto), só para a prévia
function comDesconto(base, f) {
  if (!f.temDesconto) return base;
  const x = Number(f.descontoValor) || 0;
  let r = base;
  if (f.descontoTipo === "percentual") r = base * (1 - Math.min(100, x) / 100);
  else if (f.descontoTipo === "valor") r = base - x;
  else r = Math.min(base, x);
  return Math.max(0, Math.round(r * 100) / 100);
}

function beneficiosDoForm(form, meta) {
  const out = [];
  if (form.isentaMatricula) out.push(`Isenção da taxa de matrícula (${money(Number(meta.taxaMatricula) || 0)})`);
  const pac = mesesDoPacoteForm(form);
  if (pac) {
    if (pac.gratis.length) out.push(`Mensalidade de ${listaMeses(pac.gratis)} grátis`);
    out.push(pac.pagos.length === 1
      ? `Mensalidade de ${nomeMes(pac.pagos[0])} paga já no pacote`
      : `Mensalidades de ${listaMeses(pac.pagos)} pagas juntas, num Pix só (a soma das ${pac.pagos.length} mensalidades do plano)`);
    out.push(form.pacotePrazo === "data" && form.pacoteVenceEm
      ? `O pacote é pago até ${fmtDate(form.pacoteVenceEm)}`
      : "O pacote é pago no dia em que a aluna usar o código");
    if (form.fim) out.push(`Depois de ${fmtDate(form.fim)}, quando a promoção acaba, o pacote não pode mais ser pago`);
    out.push("Para quem está entrando: sem taxa de matrícula");
    out.push(`Em ${nomeMes(pac.volta)} a mensalidade volta a ser cobrada normalmente`);
    out.push("Se cancelar durante o pacote, o valor pago não é devolvido");
  }
  if (form.temDesconto && form.descontoValor !== "") {
    const x = Number(form.descontoValor) || 0, m = Number(form.descontoMeses) || 1;
    const alcance = m === 1 ? "na 1ª mensalidade" : `nas ${m} primeiras mensalidades`;
    out.push(form.descontoTipo === "percentual" ? `${x}% de desconto ${alcance}`
      : form.descontoTipo === "valor" ? `${money(x)} de desconto ${alcance}`
      : `Mensalidade por ${money(x)} ${alcance}`);
  }
  if (form.aulaExperimental) out.push(Number(form.valorExperimental) > 0 ? `Aula experimental por ${money(form.valorExperimental)}` : "Aula experimental grátis");
  if (form.temAulas) {
    const n = Math.max(1, Number(form.aulasExtras) || 1);
    out.push(n === 1 ? "1 aula avulsa de presente" : `${n} aulas avulsas de presente`);
  }
  if (form.temPremio && form.premio.trim()) out.push(`Prêmio: ${form.premio.trim()}`);
  return out;
}

/* Cabeçalho de seção dentro do formulário — o mesmo das Configurações */
const Secao = ({ ic, titulo, sub, children }) => (
  <div style={{ marginBottom: "1.2rem" }}>
    <div className="cfg-h"><span className="cfg-ic">{ic}</span><div><h2>{titulo}</h2>{sub && <p>{sub}</p>}</div></div>
    {children}
  </div>
);

/* ===================== Formulário (janela) ===================== */
export function CampanhaForm({ campanha }) {
  const { data } = useStore();
  const { close, open } = useModal();
  const meta = data?.meta || {};
  /* Divulgar no WhatsApp: ao salvar, abre a criação do template já com o texto
     da campanha. Ligado por padrão em campanha nova; na edição, só quando a
     campanha ainda não tem template (ou o dela foi recusado). */
  const waRecusado = ["REJECTED", "DISABLED"].includes(campanha?.whatsapp?.status);
  const [divulgar, setDivulgar] = useState(() => !campanha || !campanha.whatsapp || waRecusado);
  const [form, setForm] = useState(() => campanha ? {
    ...VAZIO,
    nome: campanha.nome, codigo: campanha.codigo, descricao: campanha.descricao || "", publico: campanha.publico,
    isentaMatricula: campanha.isentaMatricula,
    temDesconto: !!campanha.descontoTipo, descontoTipo: campanha.descontoTipo || "percentual",
    descontoValor: campanha.descontoValor ?? "", descontoMeses: campanha.descontoMeses || 1,
    aulaExperimental: campanha.aulaExperimental, valorExperimental: campanha.valorExperimental || 0,
    temPremio: !!campanha.premio, premio: campanha.premio || "",
    temAulas: (campanha.aulasExtras || 0) > 0, aulasExtras: campanha.aulasExtras || 1,
    temPacote: !!campanha.pacoteInicio, pacoteInicio: campanha.pacoteInicio || "",
    pacoteGratis: campanha.pacoteInicio ? campanha.pacoteGratis : 1, pacotePagos: campanha.pacoteInicio ? campanha.pacotePagos : 3,
    pacotePrazo: campanha.pacoteVenceEm ? "data" : "uso", pacoteVenceEm: campanha.pacoteVenceEm || "",
    limiteUsos: campanha.limiteUsos ?? "", inicio: campanha.inicio || "", fim: campanha.fim || "",
    unidade: campanha.unidade || "", planos: campanha.planos || [], ativo: campanha.ativo,
  } : VAZIO);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const codigoTravado = !!campanha && campanha.usos?.total > 0;

  const ben = beneficiosDoForm(form, meta);
  const base1x = Number(meta.valorPlano1x) || 0;
  const taxa = Number(meta.taxaMatricula) || 0;
  const avulsa = Number(meta.valorAvulsa) || 0;
  const m1 = comDesconto(base1x, form);
  const t1 = form.isentaMatricula ? 0 : taxa;

  const salvar = async () => {
    if (!form.nome.trim()) return toast.error("Dê um nome para a campanha.");
    if (codigoLimpo(form.codigo).length < 3) return toast.error("O código precisa ter pelo menos 3 letras ou números.");
    if (!ben.length) return toast.error("Ligue pelo menos um benefício.");
    if (form.temPacote) {
      if (!form.pacoteInicio) return toast.error("Escolha o mês em que o pacote começa.");
      if (!form.fim) return toast.error("Com pacote, preencha \"Vale até\": o pacote começa no mês seguinte ao fim da campanha (ou depois).");
      if (form.fim.slice(0, 7) >= form.pacoteInicio) return toast.error("O pacote precisa começar num mês depois do fim da campanha.");
      if (form.temDesconto) return toast.error("O pacote e o desconto na mensalidade não podem ser usados juntos.");
      if (form.pacotePrazo === "data" && !form.pacoteVenceEm) return toast.error("Escolha até que dia o pacote pode ser pago.");
      if (form.pacotePrazo === "data" && form.pacoteVenceEm > form.fim)
        return toast.error(`O pacote precisa ser pago até o fim da campanha (${fmtDate(form.fim)}).`);
    }
    const ok = await confirmModal({
      title: campanha ? "Salvar alterações" : "Criar campanha",
      message: `Código ${codigoLimpo(form.codigo)}\n\n${ben.join("\n")}\n\n` +
        (form.limiteUsos ? `Só os ${form.limiteUsos} primeiros.` : "Sem limite de usos.") +
        (form.fim ? ` Vale até ${fmtDate(form.fim)}.` : ""),
      confirmLabel: campanha ? "Salvar" : "Criar",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const corpo = {
        nome: form.nome, codigo: form.codigo, descricao: form.descricao, publico: form.publico,
        isentaMatricula: form.isentaMatricula,
        descontoTipo: form.temDesconto ? form.descontoTipo : null,
        descontoValor: form.temDesconto ? Number(form.descontoValor) : null,
        descontoMeses: Number(form.descontoMeses) || 1,
        aulaExperimental: form.aulaExperimental,
        valorExperimental: Number(form.valorExperimental) || 0,
        premio: form.temPremio ? form.premio : "",
        aulasExtras: form.temAulas ? Math.max(1, Number(form.aulasExtras) || 1) : 0,
        pacoteInicio: form.temPacote ? form.pacoteInicio : null,
        pacoteGratis: form.temPacote ? Number(form.pacoteGratis) || 0 : 0,
        pacotePagos: form.temPacote ? Number(form.pacotePagos) || 1 : 0,
        pacoteVenceEm: form.temPacote && form.pacotePrazo === "data" ? form.pacoteVenceEm : null,
        limiteUsos: form.limiteUsos === "" ? null : Number(form.limiteUsos),
        inicio: form.inicio || null, fim: form.fim || null,
        unidade: form.unidade || null, planos: form.planos, ativo: form.ativo,
      };
      const salva = campanha ? await api.vouchers.update(campanha.id, corpo) : await api.vouchers.create(corpo);
      toast(campanha ? "Campanha salva." : "Campanha criada! 🎟️");
      avisarLista();
      if (divulgar && canAccess("whatsapp", 2)) {
        // a mesma janela do Disparo, já com o texto da campanha — e ligada a ela
        open(<CriarTemplate inicial={inicialDoTemplate(salva)} voucherId={salva.id} onCriado={avisarLista} />);
      } else close();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal size="md" title={campanha ? `Editar campanha · ${campanha.codigo}` : "Nova campanha"} footer={<>
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button data-access="campanhas:2" className="btn" onClick={salvar} disabled={busy}>
        {busy ? "Salvando…" : `${campanha ? "Salvar" : "Criar campanha"}${divulgar && (!campanha?.whatsapp || waRecusado) ? " e escrever o WhatsApp" : ""}`}
      </button>
    </>}>
      {/* .cfg-sec dá aos campos e textos de ajuda o mesmo acabamento das Configurações */}
      <div className="cfg-sec" style={{ padding: 0 }}>
      <Secao ic="🎟️" titulo="Campanha" sub="O nome é só para você; o código é o que a aluna digita.">
        <div className="row2">
          <div className="field">
            <label>Nome da campanha</label>
            <input value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder="ex.: Volta às aulas de outubro" />
          </div>
          <div className="field">
            <label>Código</label>
            <input value={form.codigo} disabled={codigoTravado} placeholder="ex.: OUTUBRO10"
              onChange={(e) => set("codigo", codigoLimpo(e.target.value).slice(0, 20))} />
          </div>
        </div>
        {codigoTravado && <div className="help">O código já foi usado, então não pode mudar.</div>}
        <div className="field">
          <label>Mensagem para a aluna (opcional)</label>
          <input value={form.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="ex.: Presente de boas-vindas da Fios que Curam 💚" />
        </div>
        <div className="field">
          <label>Quem pode usar</label>
          <div className="seg">
            {PUBLICOS.map((p) => (
              <button key={p.value} type="button" className={form.publico === p.value ? "on" : ""} onClick={() => set("publico", p.value)}>{p.label}</button>
            ))}
          </div>
          <div className="help">{PUBLICOS.find((p) => p.value === form.publico)?.hint}</div>
        </div>
      </Secao>

      <Secao ic="🎁" titulo="Benefícios" sub="Ligue um ou mais. Eles se somam.">
        <Chave on={form.isentaMatricula} onToggle={() => set("isentaMatricula", !form.isentaMatricula)}
          titulo="Isenção da taxa de matrícula"
          ligado={`A taxa de ${money(taxa)} sai do 1º pagamento.`}
          desligado="A taxa de matrícula é cobrada normalmente." />

        <Chave on={form.temDesconto} onToggle={() => set("temDesconto", !form.temDesconto)}
          titulo="Desconto na mensalidade"
          ligado="O 1º mês sai no Pix da matrícula; os seguintes já nascem com desconto. Depois, volta ao valor normal sozinho."
          desligado="Mensalidade no valor normal." />
        {form.temDesconto && (
          <div className="row2" style={{ gridTemplateColumns: "1.4fr 1fr 1fr", margin: ".2rem 0 .8rem" }}>
            <div className="field">
              <label>Tipo</label>
              <Select value={form.descontoTipo} onChange={(v) => set("descontoTipo", v)} options={TIPOS} />
            </div>
            <div className="field">
              <label>{form.descontoTipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}</label>
              <input type="number" min="0" step="0.01" value={form.descontoValor} onChange={(e) => set("descontoValor", e.target.value)} />
            </div>
            <div className="field">
              <label>Por quantos meses</label>
              <input type="number" min="1" max="12" value={form.descontoMeses} onChange={(e) => set("descontoMeses", e.target.value)} />
            </div>
          </div>
        )}

        <Chave on={form.temPacote} onToggle={() => setForm((f) => ({
            ...f, temPacote: !f.temPacote,
            // sugere o mês seguinte ao fim da campanha
            pacoteInicio: f.pacoteInicio || mesSeguinte(f.fim),
          }))}
          titulo="Pacote de mensalidades"
          ligado="Meses grátis e meses pagos juntos num Pix só (a soma das mensalidades do plano dela). Quem já estuda paga o mês corrente normalmente e o Pix do pacote vence no prazo abaixo. Aluna nova paga o pacote na matrícula, no lugar da 1ª mensalidade e sem taxa de matrícula. Os meses do pacote nascem quitados e, depois, a cobrança volta sozinha, no dia de vencimento dela. Cancelando no meio, não há devolução e o mês seguinte não é gerado."
          desligado="Sem pacote." />
        {form.temPacote && (
          <div className="row2" style={{ gridTemplateColumns: "1.4fr 1fr 1fr", margin: ".2rem 0 .8rem" }}>
            <div className="field">
              <label>Começa em (mês)</label>
              <input type="month" value={form.pacoteInicio} onChange={(e) => set("pacoteInicio", e.target.value)} />
            </div>
            <div className="field">
              <label>Meses grátis</label>
              <input type="number" min="0" max="6" value={form.pacoteGratis} onChange={(e) => set("pacoteGratis", e.target.value)} />
            </div>
            <div className="field">
              <label>Meses pagos juntos</label>
              <input type="number" min="1" max="12" value={form.pacotePagos} onChange={(e) => set("pacotePagos", e.target.value)} />
            </div>
          </div>
        )}
        {form.temPacote && (
          <div className="field" style={{ margin: "-.3rem 0 .8rem" }}>
            <label>Quem já estuda paga o pacote</label>
            <div className="seg">
              <button type="button" className={form.pacotePrazo === "uso" ? "on" : ""} onClick={() => set("pacotePrazo", "uso")}>No dia em que usar o código</button>
              <button type="button" className={form.pacotePrazo === "data" ? "on" : ""}
                onClick={() => setForm((f) => ({ ...f, pacotePrazo: "data", pacoteVenceEm: f.pacoteVenceEm || f.fim }))}>Até uma data</button>
            </div>
            {form.pacotePrazo === "data" && (
              <input type="date" style={{ maxWidth: 220, marginTop: ".5rem" }} value={form.pacoteVenceEm} max={form.fim || undefined}
                onChange={(e) => set("pacoteVenceEm", e.target.value)} />
            )}
            <div className="help">
              {form.pacotePrazo === "data"
                ? "O Pix vence nessa data (quem usar o código depois dela paga no mesmo dia)."
                : "O Pix vence no mesmo dia em que ela usar o código."}
              {` O prazo final é o fim da campanha${form.fim ? ` (${fmtDate(form.fim)})` : ""}: até lá, valem as regras de atraso de sempre; depois, o Pix não pode mais ser pago, o pacote é cancelado e o mês volta ao valor normal.`}
              {" "}Aluna nova sempre paga na hora, no Pix da matrícula.
            </div>
          </div>
        )}
        {form.temPacote && campanha?.usos?.total > 0 && (
          <div className="help" style={{ marginTop: "-.5rem", marginBottom: ".8rem" }}>
            Quem já usou o código continua com os meses que pegou. A mudança vale para os próximos usos.
          </div>
        )}

        <Chave on={form.aulaExperimental} onToggle={() => set("aulaExperimental", !form.aulaExperimental)}
          titulo="Aula experimental"
          ligado={`A aula avulsa (hoje ${money(avulsa)}) sai pelo valor abaixo. Com R$ 0, a vaga é confirmada na hora, sem Pix.`}
          desligado="A aula avulsa é cobrada normalmente." />
        {form.aulaExperimental && (
          <div className="field" style={{ maxWidth: 240, margin: ".2rem 0 .8rem" }}>
            <label>Valor da aula experimental (R$)</label>
            <input type="number" min="0" step="0.01" value={form.valorExperimental} onChange={(e) => set("valorExperimental", e.target.value)} />
          </div>
        )}

        <Chave on={form.temAulas} onToggle={() => set("temAulas", !form.temAulas)}
          titulo="Aula avulsa de presente"
          ligado="Quem usar o código ganha a aula e escolhe o horário pelo portal, como numa aula extra — sem pagar. Você também pode dar a aula na mão em Usos."
          desligado="Sem aula de presente automática (dá para dar na mão em Usos)." />
        {form.temAulas && (
          <div className="field" style={{ maxWidth: 240, margin: ".2rem 0 .8rem" }}>
            <label>Quantas aulas por aluna</label>
            <input type="number" min="1" max="10" value={form.aulasExtras} onChange={(e) => set("aulasExtras", e.target.value)} />
          </div>
        )}

        <Chave on={form.temPremio} onToggle={() => set("temPremio", !form.temPremio)}
          titulo="Prêmio / brinde"
          ligado="Fica registrado quem ganhou, com aviso na ficha. A entrega é feita pela escola."
          desligado="Sem prêmio." />
        {form.temPremio && (
          <div className="field" style={{ margin: ".2rem 0 0" }}>
            <label>Qual o prêmio</label>
            <input value={form.premio} onChange={(e) => set("premio", e.target.value)} placeholder="ex.: Kit de agulhas + 1 novelo" />
          </div>
        )}
      </Secao>

      <Secao ic="📋" titulo="Regras" sub="Tudo opcional. Em branco = sem restrição.">
        <div className="row2">
          <div className="field">
            <label>Os X primeiros</label>
            <input type="number" min="1" value={form.limiteUsos} onChange={(e) => set("limiteUsos", e.target.value)} placeholder="sem limite" />
          </div>
          <div className="field">
            <label>Unidade</label>
            <Select value={form.unidade} onChange={(v) => set("unidade", v)}
              options={[{ value: "", label: "Todas as unidades" }, ...(meta.units || []).map((u) => ({ value: u, label: u }))]} />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Vale a partir de</label>
            <input type="date" value={form.inicio} onChange={(e) => set("inicio", e.target.value)} />
          </div>
          <div className="field">
            <label>Vale até (inclusive)</label>
            <input type="date" value={form.fim} onChange={(e) => set("fim", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Planos aceitos (nenhum marcado = todos)</label>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            {[1, 2, 3, 4].map((p) => (
              <label key={p} className="check-row" style={{ display: "flex", marginBottom: 0, fontSize: ".9rem", color: "var(--ink)" }}>
                {/* dentro de .field, rótulo e input herdariam o estilo de campo de texto */}
                <input type="checkbox" style={{ width: 17, height: 17, padding: 0 }} checked={form.planos.includes(p)}
                  onChange={(e) => set("planos", e.target.checked ? [...form.planos, p].sort() : form.planos.filter((x) => x !== p))} />
                {p}x por semana
              </label>
            ))}
          </div>
        </div>
        <Chave on={form.ativo} onToggle={() => set("ativo", !form.ativo)}
          titulo="Campanha ativa"
          ligado="O código já pode ser usado (respeitando as datas e o limite)."
          desligado="Pausada: fica pronta, mas ninguém consegue usar ainda." />
      </Secao>

      <Secao ic="📣" titulo="Divulgar no WhatsApp" sub="Mensagem para o disparo em massa, aprovada pela Meta.">
        {campanha?.whatsapp && !waRecusado ? (
          <div className="help">
            Esta campanha já tem a mensagem <b>{campanha.whatsapp.name}</b>
            {" "}({(WA_SITUACAO[campanha.whatsapp.status] || ["", campanha.whatsapp.status])[1]}).
            {" "}O texto aprovado não muda: para outro texto, crie um template novo na tela Disparo.
          </div>
        ) : (
          <Chave on={divulgar} onToggle={() => setDivulgar(!divulgar)}
            titulo={waRecusado ? "Criar uma nova mensagem (a anterior foi recusada)" : "Criar a mensagem do WhatsApp ao salvar"}
            ligado="Ao salvar, abre o template já escrito com os benefícios e o código. Você revisa e envia para a Meta aprovar; quando aprovar, o botão “Disparar” aparece na lista."
            desligado="Sem mensagem de WhatsApp por enquanto (dá para criar depois, editando a campanha)." />
        )}
      </Secao>

      <div className="cfg-preview">
        <b>Como fica para a aluna</b>
        {ben.length
          ? <ul style={{ margin: ".35rem 0 .2rem 1.1rem" }}>{ben.map((t) => <li key={t}>{t}</li>)}</ul>
          : <div className="help">Ligue um benefício acima.</div>}
        {form.publico !== "alunas" && (form.isentaMatricula || form.temDesconto) && (
          <div className="help">
            Plano 1x: 1º pagamento de {money(base1x + taxa)} por <b>{money(m1 + t1)}</b>
            {form.temDesconto && Number(form.descontoMeses) > 1 && <> · depois mais {Number(form.descontoMeses) - 1} mensalidade(s) de <b>{money(m1)}</b> e volta para {money(base1x)}</>}.
          </div>
        )}
        {form.aulaExperimental && (
          <div className="help">Aula experimental: {money(avulsa)} por <b>{money(Math.min(avulsa, Number(form.valorExperimental) || 0))}</b>.</div>
        )}
        {(() => {
          const pac = mesesDoPacoteForm(form);
          if (!pac) return null;
          const planos = (form.planos.length ? form.planos : [1, 2, 3, 4]).filter((p) => Number(meta[`valorPlano${p}x`]) > 0);
          return (
            <div className="help">
              Valor do pacote (aluna nova paga na matrícula, sem taxa):{" "}
              {planos.map((p, i) => (
                <span key={p}>{i ? " · " : ""}{p}x <b>{money(Number(meta[`valorPlano${p}x`]) * pac.pagos.length)}</b></span>
              ))}
              {" "}(quem tem valor próprio paga a soma do valor dela). Volta ao normal em {nomeMes(pac.volta)}.
            </div>
          );
        })()}
      </div>
      </div>
    </Modal>
  );
}

/* ===================== Quem usou (janela) ===================== */
function UsosDaCampanha({ campanha: c }) {
  const { data, reload } = useStore();
  const { close } = useModal();
  const [usos, setUsos] = useState(null);
  const [aluna, setAluna] = useState("");
  /* Pacote pago por fora (dinheiro, Pix direto para a escola): aplica e já dá
     a baixa — a mensalidade do pacote nasce quitada, sem Pix. */
  const [porFora, setPorFora] = useState(false);
  const [forma, setForma] = useState("Dinheiro");
  const [dataPg, setDataPg] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [previa, setPrevia] = useState(null);
  const [erroPrevia, setErroPrevia] = useState("");
  useEffect(() => {
    setPrevia(null); setErroPrevia("");
    if (!aluna || !c.pacoteInicio) return;
    let vivo = true;
    // pago por fora: a campanha é conferida no dia do pagamento
    api.vouchers.previaNaAluna(aluna, c.codigo, porFora ? { data: dataPg, forma } : null)
      .then((r) => { if (vivo) setPrevia(r); })
      .catch((e) => { if (vivo) setErroPrevia(e.message); });
    return () => { vivo = false; };
  }, [aluna, c.id, porFora, dataPg]);

  const carregar = async () => {
    try { setUsos(await api.vouchers.usos(c.id)); }
    catch (e) { toast.error(e.message); setUsos([]); }
  };
  useEffect(() => { carregar(); }, [c.id]);

  // Só mensalistas ativas recebem código na mensalidade
  const opcoesAlunas = useMemo(() => (data?.clients || [])
    .filter((x) => x.plan === "mensalista" && x.status !== "cancelado")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((x) => ({ value: x.id, label: x.name, hint: [x.unit, x.weeklyFreq ? `${x.weeklyFreq}x` : ""].filter(Boolean).join(" · ") })), [data]);

  const aplicar = async () => {
    const cli = (data?.clients || []).find((x) => x.id === aluna);
    if (!cli) return toast.error("Escolha a aluna.");
    const fora = !!c.pacoteInicio && porFora;
    const valorTxt = previa?.pacote ? ` (${money(previa.pacote.valor)})` : "";
    const ok = await confirmModal({
      title: fora ? "Aplicar e dar baixa" : "Aplicar código",
      message: `Aplicar ${c.codigo} na mensalidade de ${cli.name}?\n\n${c.beneficios.join("\n")}\n\n` +
        (fora
          ? `O pacote${valorTxt} fica PAGO por fora (${forma}) em ${fmtDate(dataPg)}: a mensalidade de ${previa?.pacote?.texto?.cobranca || "cobrança do pacote"} nasce quitada, sem Pix, e entra no recebido do Financeiro. Os meses do pacote ficam cobertos e a mensalidade volta sozinha em ${previa?.pacote?.texto?.volta || "o mês de volta"}.`
          : c.pacoteInicio
          ? "Os meses do pacote mudam de valor e a mensalidade do pacote é gerada agora, com o Pix, para ela pagar pelo portal."
          : "A mensalidade em aberto e os meses da campanha mudam de valor, e o Pix é refeito."),
      confirmLabel: fora ? "✓ Aplicar e dar baixa" : "Aplicar",
    });
    if (!ok) return;
    try {
      const r = await api.vouchers.aplicarNaAluna(cli.id, c.codigo, fora ? { data: dataPg, forma } : null);
      toast(r.pacote
        ? (fora
          ? `Pacote de ${cli.name} pago por fora: ${money(r.pacote.valor)} quitado na mensalidade de ${r.pacote.texto.cobranca}.`
          : `Pacote aplicado para ${cli.name}: ${money(r.pacote.valor)} na mensalidade de ${r.pacote.texto.cobranca}.`)
        : `Código aplicado para ${cli.name}${r.meses?.length ? ` — ${r.meses.length} mês(es) com desconto` : ""}.`);
      setAluna(""); setPorFora(false);
      carregar(); reload?.(); avisarLista();
    } catch (e) { toast.error(e.message); }
  };

  const cancelar = async (u) => {
    const ok = await confirmModal({
      title: "Cancelar uso do código",
      message: `Cancelar o uso de ${u.nome}?\n\nOs meses seguintes ainda não pagos voltam ao valor normal, a aula de presente ainda não marcada é recolhida e a vaga volta para a campanha. Mês já pago e aula já marcada não mudam, e um Pix já gerado continua com o valor dele.` +
        (c.pacoteInicio ? "\n\nPacote: só dá para cancelar enquanto o Pix do pacote não foi pago — a mensalidade do pacote volta ao valor normal do mês." : ""),
      confirmLabel: "Cancelar uso", tone: "danger",
    });
    if (!ok) return;
    try {
      const r = await api.vouchers.cancelarUso(u.id);
      const mexidos = (r.meses || []).filter((m) => m.resultado === "mexido_depois").length;
      toast(mexidos ? `Uso cancelado. ${mexidos} mês(es) tinham sido alterados depois e ficaram como estão.` : "Uso cancelado.");
      carregar(); reload?.(); avisarLista();
    } catch (e) { toast.error(e.message); }
  };

  const premio = async (u) => {
    try { await api.vouchers.premio(u.id, !u.premioEntregueAt); carregar(); avisarLista(); }
    catch (e) { toast.error(e.message); }
  };

  /* Aula avulsa de presente na mão: vira um passe de aula extra já pago, e a
     aluna escolhe o horário pelo portal. Não manda mensagem sozinha — avise
     a aluna pelo WhatsApp. */
  const darAula = async (u) => {
    const ok = await confirmModal({
      title: "Dar aula avulsa de presente",
      message: `Dar 1 aula avulsa de presente para ${u.nome}?

Ela escolhe o dia e o horário pelo portal, sem pagar. Avise a aluna pelo WhatsApp.`,
      confirmLabel: "Dar a aula",
    });
    if (!ok) return;
    try { await api.vouchers.darAula(u.id, 1); toast(`Aula de presente liberada para ${u.nome}. 🎁`); carregar(); avisarLista(); }
    catch (e) { toast.error(e.message); }
  };
  const confirmadas = (usos || []).filter((u) => u.status === "confirmado" && u.clientId);
  const darAulaTodas = async () => {
    const ok = await confirmModal({
      title: "Dar aula avulsa a todas",
      message: `Dar 1 aula avulsa de presente para cada uma das ${confirmadas.length} aluna(s) que usaram o código ${c.codigo}?

Cada uma escolhe o horário pelo portal, sem pagar.`,
      confirmLabel: `Dar ${confirmadas.length} aula(s)`,
    });
    if (!ok) return;
    try {
      const r = await api.vouchers.darAulaTodas(c.id, 1);
      toast(`${r.aulas} aula(s) de presente liberada(s)${r.puladas?.length ? ` · ${r.puladas.length} aluna(s) pulada(s): ${r.puladas.map((p) => p.nome).join(", ")}` : ""}. 🎁`);
      carregar(); avisarLista();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Modal size="md" title={`Usos do código ${c.codigo}`}
      subheader={<div className="day-sub">{c.nome} · {c.usos.usados}{c.limiteUsos != null ? ` de ${c.limiteUsos}` : ""} uso(s)</div>}
      footer={<button className="btn ghost" onClick={close}>Fechar</button>}>
      {/* mesmo acabamento das Configurações nos textos de ajuda */}
      <div className="cfg-sec" style={{ padding: 0 }}>
      {c.publico !== "novas" && (
        <div className="cfg-preview" style={{ marginTop: 0, marginBottom: "1rem" }}>
          <div className="field" style={{ marginBottom: ".6rem" }}>
            <label>Aplicar o código na mensalidade de uma aluna</label>
            <Select value={aluna} onChange={setAluna} options={opcoesAlunas} placeholder="Escolha a aluna" searchable />
          </div>
          {c.pacoteInicio && aluna && (
            <div className="help" style={{ marginTop: "-.3rem", marginBottom: ".6rem", color: erroPrevia ? "var(--danger)" : undefined }}>
              {erroPrevia || (previa?.pacote
                ? <>Pacote para ela: <b>{money(previa.pacote.valor)}</b> ({previa.pacote.texto.pagos}). Volta ao normal em {previa.pacote.texto.volta}.</>
                : "Calculando o valor do pacote...")}
            </div>
          )}
          {c.pacoteInicio && (
            <>
              <Chave on={porFora} onToggle={() => setPorFora(!porFora)}
                titulo="Ela já pagou o pacote por fora"
                ligado="A mensalidade do pacote nasce quitada, sem Pix (baixa manual)."
                desligado="O Pix do pacote é gerado para ela pagar pelo portal." />
              {porFora && (
                <div className="row2">
                  <div className="field">
                    <label>Forma de pagamento</label>
                    <Select value={forma} onChange={setForma} options={FORMAS_PAGAMENTO} />
                  </div>
                  <div className="field">
                    <label>Data do pagamento</label>
                    <input type="date" value={dataPg} max={new Date().toLocaleDateString("sv-SE")} onChange={(e) => setDataPg(e.target.value)} />
                  </div>
                </div>
              )}
            </>
          )}
          <button data-access="campanhas:2" className="btn sec sm" onClick={aplicar} disabled={!aluna || (porFora && !!erroPrevia)}>
            {c.pacoteInicio && porFora ? "✓ Aplicar e dar baixa" : "Aplicar código"}
          </button>
          <div className="help">Para quando ela mandar o código pelo WhatsApp{c.pacoteInicio ? " ou pagar o pacote direto na escola" : ""}.</div>
        </div>
      )}

      {confirmadas.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem", flexWrap: "wrap", marginBottom: ".8rem" }}>
          <div className="help" style={{ margin: 0 }}>Quer dar uma aula avulsa de presente? Ela escolhe o horário pelo portal.</div>
          <button className="btn sec sm" onClick={darAulaTodas}>🎁 Dar aula a todas ({confirmadas.length})</button>
        </div>
      )}

      {usos == null ? <div className="empty"><p>Carregando…</p></div>
        : !usos.length ? <div className="empty"><div className="ic">🎟️</div><p>Ninguém usou este código ainda.</p></div>
        : (
          <table>
            <thead><tr><th>#</th><th>Aluna</th><th>Onde</th><th>Desconto</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {usos.map((u, i) => {
                const [cor, txt] = USO_STATUS[u.status] || ["b-muted", u.status];
                return (
                  <tr key={u.id}>
                    <td data-l="#">{i + 1}º</td>
                    <td data-l="Aluna">
                      <b>{u.nome}</b>
                      <div className="cli-sub">{fmtDate(String(u.createdAt).slice(0, 10))}</div>
                    </td>
                    <td data-l="Onde">{CONTEXTO[u.contexto] || u.contexto}</td>
                    <td data-l="Desconto">
                      {u.descontoCents > 0 ? money(u.descontoCents / 100) : "—"}
                      {u.meses?.length > 0 && <div className="cli-sub">{u.meses.map((m) => `${compLabel(m.comp)}: ${money(m.depois / 100)}`).join(" · ")}</div>}
                      {u.aulas?.total > 0 && <div className="cli-sub">🎁 {u.aulas.total} aula(s) de presente · {u.aulas.marcadas} marcada(s)</div>}
                    </td>
                    <td data-l="Situação"><span className={`badge ${cor}`}>{txt}</span></td>
                    <td data-l="">
                      <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {c.premio && u.status === "confirmado" && (
                          <button data-access="campanhas:2" className={`btn sm ${u.premioEntregueAt ? "ghost" : "sec"}`} onClick={() => premio(u)}>
                            {u.premioEntregueAt ? `🎁 Entregue ${fmtDate(u.premioEntregueAt)}` : "🎁 Marcar entregue"}
                          </button>
                        )}
                        {u.status === "confirmado" && u.clientId && (
                          <button data-access="campanhas:2" className="btn ghost sm" onClick={() => darAula(u)}>🎁 Dar aula</button>
                        )}
                        {u.status !== "cancelado" && u.status !== "expirado" && (
                          <button data-access="campanhas:2" className="btn ghost sm" onClick={() => cancelar(u)}>Cancelar uso</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Tela ===================== */
export default function Campanhas({ go }) {
  const { open } = useModal();
  const [lista, setLista] = useState(null);
  const [aba, setAba] = useState("ativas");

  const carregar = async () => {
    try { setLista(await api.vouchers.list()); }
    catch (e) { toast.error("Não consegui carregar as campanhas: " + e.message); setLista([]); }
  };
  useEffect(() => {
    carregar();
    window.addEventListener(EVENTO_RECARREGAR, carregar);
    return () => window.removeEventListener(EVENTO_RECARREGAR, carregar);
  }, []);

  const todas = lista || [];
  const visiveis = todas.filter((ABAS.find((a) => a[0] === aba) || ABAS[3])[2]);
  const ativas = todas.filter(ABAS[0][2]).length;
  const usados = todas.reduce((s, c) => s + c.usos.confirmados, 0);
  const aguardando = todas.reduce((s, c) => s + c.usos.reservados, 0);
  const descontos = todas.reduce((s, c) => s + c.descontoTotalCents, 0) / 100;
  const premios = todas.reduce((s, c) => s + c.premiosPendentes, 0);

  const alternarAtivo = async (c) => {
    const pausar = c.ativo;
    const ok = await confirmModal({
      title: pausar ? "Pausar campanha" : "Ativar campanha",
      message: pausar
        ? `Ninguém mais consegue usar o código ${c.codigo} enquanto estiver pausada. Quem já usou continua com o benefício.`
        : `O código ${c.codigo} volta a valer, respeitando as datas e o limite.`,
      confirmLabel: pausar ? "Pausar" : "Ativar",
      tone: pausar ? "danger" : undefined,
    });
    if (!ok) return;
    try { await api.vouchers.update(c.id, { ativo: !c.ativo }); carregar(); }
    catch (e) { toast.error(e.message); }
  };

  const excluir = async (c) => {
    const ok = await confirmModal({ title: "Excluir campanha", message: `Excluir ${c.nome} (${c.codigo})? Ela nunca foi usada.`, confirmLabel: "Excluir", tone: "danger" });
    if (!ok) return;
    try { await api.vouchers.remove(c.id); toast("Campanha excluída."); carregar(); }
    catch (e) { toast.error(e.message); }
  };

  return (<>
    <div className="grid stats" style={{ marginBottom: "1rem" }}>
      <div className="card stat"><div className="lbl">🎟️ Campanhas ativas</div><div className="val">{ativas}</div><div className="foot">de {todas.length} cadastrada(s)</div></div>
      <div className="card stat"><div className="lbl">✅ Códigos usados</div><div className="val">{usados}</div><div className="foot">{aguardando ? `${aguardando} aguardando Pix` : "pagamentos confirmados"}</div></div>
      <div className="card stat"><div className="lbl">💸 Descontos concedidos</div><div className="val terra">{money(descontos)}</div><div className="foot">no ato do uso</div></div>
      <div className="card stat"><div className="lbl">🎁 Prêmios a entregar</div><div className={`val${premios ? " warn" : ""}`}>{premios}</div><div className="foot">{premios ? "veja em Usos" : "nenhum pendente"}</div></div>
    </div>

    <div className="seg seg-tabs" style={{ marginBottom: "1rem" }}>
      {ABAS.map(([id, label, filtro]) => (
        <button key={id} className={aba === id ? "on" : ""} onClick={() => setAba(id)}>
          {label} <span className="seg-count">{todas.filter(filtro).length}</span>
        </button>
      ))}
    </div>
    <div className="seg-hint">A aluna nova digita o código no site (/agendar) ou no WhatsApp; quem já estuda, no portal, na mensalidade.</div>

    <div className="panel">
      {lista == null ? <div className="empty"><div className="ic">🧶</div><p>Carregando…</p></div>
        : !visiveis.length ? (
          <div className="empty">
            <div className="ic">🎟️</div>
            <p>{todas.length ? "Nenhuma campanha nesta aba." : "Nenhuma campanha ainda."}</p>
            {!todas.length && <button data-access="campanhas:2" className="btn" onClick={() => open(<CampanhaForm />)}>＋ Nova campanha</button>}
          </div>
        ) : (
          <table>
            <thead><tr><th>Código</th><th>Campanha</th><th>Benefícios</th><th>Usos</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.id}>
                  <td data-l="Código"><span className="chip">{c.codigo}</span></td>
                  <td data-l="Campanha">
                    <b>{c.nome}</b>
                    <div className="cli-sub">
                      {PUBLICOS.find((p) => p.value === c.publico)?.label}
                      {c.unidade ? ` · ${c.unidade}` : ""}
                      {c.planos?.length ? ` · ${c.planos.map((p) => `${p}x`).join("/")}` : ""}
                      {c.inicio || c.fim ? ` · ${c.inicio ? fmtDate(c.inicio) : "…"} a ${c.fim ? fmtDate(c.fim) : "…"}` : ""}
                    </div>
                  </td>
                  <td data-l="Benefícios">
                    <div title={c.beneficios.join("\n")} style={{ display: "flex", flexWrap: "wrap", gap: ".3rem", maxWidth: 420 }}>
                      {etiquetasDaCampanha(c).map((t) => <span key={t} className="badge b-sage">{t}</span>)}
                    </div>
                  </td>
                  <td data-l="Usos">
                    <b>{c.usos.usados}{c.limiteUsos != null ? ` / ${c.limiteUsos}` : ""}</b>
                    {c.premiosPendentes > 0 && <div className="cli-sub">🎁 {c.premiosPendentes} a entregar</div>}
                    {c.aulasDadas > 0 && <div className="cli-sub">➕ {c.aulasDadas} aula(s) de presente</div>}
                  </td>
                  <td data-l="Situação">
                    <span className={`badge ${SITUACAO_COR[c.situacao.codigo] || "b-muted"}`}>{c.situacao.texto}</span>
                    {c.whatsapp && (() => {
                      const [cor, txt] = WA_SITUACAO[c.whatsapp.status] || ["b-muted", `WhatsApp: ${c.whatsapp.status}`];
                      return (
                        <div style={{ marginTop: ".3rem", display: "flex", gap: ".35rem", alignItems: "center", flexWrap: "wrap" }}>
                          <span className={`badge ${cor}`} title={[c.whatsapp.name, c.whatsapp.motivoRecusa].filter(Boolean).join(" — ")}>{txt}</span>
                          {/* aprovado: abre o Disparo já com a mensagem e o público sugerido */}
                          {c.whatsapp.usavel && go && (
                            <button data-access="whatsapp:2" className="btn sm" title={`Abrir o Disparo com a mensagem ${c.whatsapp.name}`}
                              onClick={() => go("disparo", { template: c.whatsapp.name, situacao: PUBLICO_DISPARO[c.publico] || "todas" })}>📣 Disparar</button>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td data-l="" style={{ width: "1%", whiteSpace: "nowrap" }}>
                    {/* numa linha só, sempre na mesma ordem: ver · mexer · ligar/desligar · apagar */}
                    <div style={{ display: "flex", gap: ".35rem", alignItems: "center" }}>
                      <button className="btn sec sm" onClick={() => open(<UsosDaCampanha campanha={c} />)}>Usos</button>
                      <button data-access="campanhas:2" className="btn ghost sm" onClick={() => open(<CampanhaForm campanha={c} />)}>Editar</button>
                      <button data-access="campanhas:2" className="btn ghost sm" onClick={() => alternarAtivo(c)}>{c.ativo ? "Pausar" : "Ativar"}</button>
                      {c.usos.total === 0 && (
                        <button data-access="campanhas:2" className="btn ghost sm" title="Excluir campanha" aria-label="Excluir campanha"
                          style={{ color: "var(--danger, #b3261e)" }} onClick={() => excluir(c)}>Excluir</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  </>);
}

// Metadados estáveis de autorização dos diálogos (preservados no build).
CampanhaForm.accessModule = "campanhas";
