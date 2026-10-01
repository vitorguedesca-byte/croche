import { useState, useEffect, useMemo } from "react";
import { toast, confirmModal } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { Select } from "./ui.jsx";
import { api } from "./api.js";
import { money, fmtDate, compLabel } from "./helpers.js";

/* ============================================================
   Campanhas com código (voucher).

   A Inêz cria a campanha, escolhe o que ela dá (isenção da
   matrícula, desconto na mensalidade por X meses, aula
   experimental, prêmio) e as regras (os X primeiros, validade,
   unidade, planos). A aluna digita o código:
   • na matrícula pelo site (/agendar), antes de gerar o Pix;
   • na mensalidade, pelo portal — se a campanha for para
     quem já estuda.
   Esta tela também aplica o código pela aluna (quando ela manda
   pelo WhatsApp) e mostra quem usou, com o prêmio a entregar.

   As contas de verdade estão no servidor (backend/src/vouchers.js);
   a prévia daqui só ilustra com o plano 1x.
   ============================================================ */

const PUBLICOS = [
  { value: "novas", label: "Alunas novas", hint: "matrícula ou aula avulsa pelo site" },
  { value: "alunas", label: "Quem já estuda", hint: "na mensalidade, pelo portal" },
  { value: "todas", label: "Todas", hint: "nos dois lugares" },
];
const TIPOS = [
  { value: "percentual", label: "% de desconto" },
  { value: "valor", label: "R$ a menos" },
  { value: "preco", label: "Mensalidade sai por R$" },
];
const SITUACAO_COR = { ativa: "b-ok", agendada: "b-info", esgotada: "b-warn", encerrada: "b-muted", pausada: "b-muted" };
const USO_STATUS = {
  reservado: ["b-info", "⏳ aguardando Pix"],
  confirmado: ["b-ok", "✓ usado"],
  expirado: ["b-muted", "Pix não pago"],
  cancelado: ["b-danger", "cancelado"],
};
const CONTEXTO = { matricula: "Matrícula", avulsa: "Aula avulsa", mensalidade: "Mensalidade" };

const VAZIO = {
  nome: "", codigo: "", descricao: "", publico: "novas",
  isentaMatricula: false,
  temDesconto: false, descontoTipo: "percentual", descontoValor: "", descontoMeses: 1,
  aulaExperimental: false, valorExperimental: 0,
  temPremio: false, premio: "",
  limiteUsos: "", inicio: "", fim: "", unidade: "", planos: [], ativo: true,
};

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

export default function Campanhas() {
  const { data } = useStore();
  const meta = data?.meta || {};
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(null); // null | "nova" | campanha
  const [form, setForm] = useState(VAZIO);
  const [busy, setBusy] = useState(false);
  const [usosDe, setUsosDe] = useState(null); // campanha aberta na lista de usos

  const carregar = async () => {
    setCarregando(true);
    try { setLista(await api.vouchers.list()); }
    catch (e) { toast.error("Não consegui carregar as campanhas: " + e.message); }
    finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const abrirNova = () => { setForm(VAZIO); setEditando("nova"); };
  const abrirEdicao = (c) => {
    setForm({
      ...VAZIO,
      nome: c.nome, codigo: c.codigo, descricao: c.descricao || "", publico: c.publico,
      isentaMatricula: c.isentaMatricula,
      temDesconto: !!c.descontoTipo, descontoTipo: c.descontoTipo || "percentual",
      descontoValor: c.descontoValor ?? "", descontoMeses: c.descontoMeses || 1,
      aulaExperimental: c.aulaExperimental, valorExperimental: c.valorExperimental || 0,
      temPremio: !!c.premio, premio: c.premio || "",
      limiteUsos: c.limiteUsos ?? "", inicio: c.inicio || "", fim: c.fim || "",
      unidade: c.unidade || "", planos: c.planos || [], ativo: c.ativo,
    });
    setEditando(c);
  };

  const corpo = () => ({
    nome: form.nome, codigo: form.codigo, descricao: form.descricao, publico: form.publico,
    isentaMatricula: form.isentaMatricula,
    descontoTipo: form.temDesconto ? form.descontoTipo : null,
    descontoValor: form.temDesconto ? Number(form.descontoValor) : null,
    descontoMeses: Number(form.descontoMeses) || 1,
    aulaExperimental: form.aulaExperimental,
    valorExperimental: Number(form.valorExperimental) || 0,
    premio: form.temPremio ? form.premio : "",
    limiteUsos: form.limiteUsos === "" ? null : Number(form.limiteUsos),
    inicio: form.inicio || null, fim: form.fim || null,
    unidade: form.unidade || null, planos: form.planos, ativo: form.ativo,
  });

  const beneficiosDoForm = () => {
    const out = [];
    if (form.isentaMatricula) out.push(`Isenção da taxa de matrícula (${money(Number(meta.taxaMatricula) || 0)})`);
    if (form.temDesconto && form.descontoValor !== "") {
      const x = Number(form.descontoValor) || 0, m = Number(form.descontoMeses) || 1;
      const alcance = m === 1 ? "na 1ª mensalidade" : `nas ${m} primeiras mensalidades`;
      out.push(form.descontoTipo === "percentual" ? `${x}% de desconto ${alcance}`
        : form.descontoTipo === "valor" ? `${money(x)} de desconto ${alcance}`
        : `Mensalidade por ${money(x)} ${alcance}`);
    }
    if (form.aulaExperimental) out.push(Number(form.valorExperimental) > 0 ? `Aula experimental por ${money(form.valorExperimental)}` : "Aula experimental grátis");
    if (form.temPremio && form.premio.trim()) out.push(`Prêmio: ${form.premio.trim()}`);
    return out;
  };

  const salvar = async () => {
    const ben = beneficiosDoForm();
    if (!form.nome.trim()) return toast.error("Dê um nome para a campanha.");
    if (codigoLimpo(form.codigo).length < 3) return toast.error("O código precisa ter pelo menos 3 letras ou números.");
    if (!ben.length) return toast.error("Escolha pelo menos um benefício.");
    const ok = await confirmModal({
      title: editando === "nova" ? "Criar campanha" : "Salvar alterações",
      message: `Código ${codigoLimpo(form.codigo)} — ${ben.join(" · ")}` +
        (form.limiteUsos ? ` · só os ${form.limiteUsos} primeiros` : " · sem limite de usos") +
        (form.fim ? ` · até ${fmtDate(form.fim)}` : "") + ". Confirmar?",
      confirmLabel: editando === "nova" ? "Criar" : "Salvar",
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (editando === "nova") await api.vouchers.create(corpo());
      else await api.vouchers.update(editando.id, corpo());
      toast(editando === "nova" ? "Campanha criada! 🎟️" : "Campanha salva!");
      setEditando(null);
      carregar();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const alternarAtivo = async (c) => {
    const pausar = c.ativo;
    const ok = await confirmModal({
      title: pausar ? "Pausar campanha" : "Reativar campanha",
      message: pausar
        ? `Ninguém mais consegue usar o código ${c.codigo} enquanto estiver pausada. Quem já usou continua com o benefício.`
        : `O código ${c.codigo} volta a valer (respeitando validade e limite).`,
      confirmLabel: pausar ? "Pausar" : "Reativar",
      tone: pausar ? "danger" : undefined,
    });
    if (!ok) return;
    try { await api.vouchers.update(c.id, { ativo: !c.ativo }); carregar(); }
    catch (e) { toast.error(e.message); }
  };

  const excluir = async (c) => {
    const ok = await confirmModal({ title: "Excluir campanha", message: `Excluir a campanha ${c.nome} (${c.codigo})? Ela nunca foi usada.`, confirmLabel: "Excluir", tone: "danger" });
    if (!ok) return;
    try { await api.vouchers.remove(c.id); toast("Campanha excluída."); carregar(); }
    catch (e) { toast.error(e.message); }
  };

  if (usosDe) return <UsosDaCampanha campanha={usosDe} onVoltar={() => { setUsosDe(null); carregar(); }} />;

  if (editando) {
    const base1x = Number(meta.valorPlano1x) || 0;
    const taxa = Number(meta.taxaMatricula) || 0;
    const m1 = comDesconto(base1x, form);
    const t1 = form.isentaMatricula ? 0 : taxa;
    const ben = beneficiosDoForm();
    return (
      <div className="panel" style={{ maxWidth: 760 }}>
        <div className="panel-h">
          <h2>{editando === "nova" ? "🎟️ Nova campanha" : `🎟️ Editando — ${editando.nome}`}</h2>
          <button className="btn ghost sm" onClick={() => setEditando(null)}>✕ Cancelar</button>
        </div>

        <div className="row2">
          <div className="field">
            <label>Nome da campanha</label>
            <input value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Ex.: Volta às aulas de outubro" />
          </div>
          <div className="field">
            <label>Código que a aluna digita</label>
            <input
              value={form.codigo}
              onChange={(e) => set("codigo", codigoLimpo(e.target.value).slice(0, 20))}
              placeholder="Ex.: OUTUBRO10"
              style={{ fontWeight: 700, letterSpacing: ".04em" }}
              disabled={editando !== "nova" && editando.usos?.total > 0}
            />
            {editando !== "nova" && editando.usos?.total > 0 && <p className="hint">O código já foi usado e não pode mudar.</p>}
          </div>
        </div>
        <div className="field">
          <label>Mensagem para a aluna <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional — aparece quando ela aplica o código)</span></label>
          <input value={form.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="Ex.: Presente de boas-vindas da Fios que Curam 💚" />
        </div>

        <div className="field">
          <label>Quem pode usar</label>
          <div className="seg seg-tabs">
            {PUBLICOS.map((p) => (
              <button key={p.value} className={form.publico === p.value ? "on" : ""} onClick={() => set("publico", p.value)} title={p.hint}>{p.label}</button>
            ))}
          </div>
          <p className="hint">{PUBLICOS.find((p) => p.value === form.publico)?.hint}</p>
        </div>

        <h3 style={{ margin: "1.2rem 0 .5rem" }}>O que a campanha dá <span className="hint" style={{ fontWeight: 400 }}>(pode marcar mais de um)</span></h3>

        <Beneficio on={form.isentaMatricula} onToggle={(v) => set("isentaMatricula", v)} titulo="Isenção da taxa de matrícula"
          sub={`A taxa de ${money(taxa)} sai do 1º pagamento. Vale na matrícula pelo site.`} />

        <Beneficio on={form.temDesconto} onToggle={(v) => set("temDesconto", v)} titulo="Desconto na mensalidade por X meses"
          sub="O 1º mês sai no próprio Pix da matrícula; os seguintes já nascem com o desconto e, depois, o valor volta ao normal sozinho.">
          <div className="row2" style={{ alignItems: "end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Tipo</label>
              <Select value={form.descontoTipo} onChange={(v) => set("descontoTipo", v)} options={TIPOS} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{form.descontoTipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}</label>
              <input type="number" min="0" step="0.01" value={form.descontoValor} onChange={(e) => set("descontoValor", e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Por quantos meses</label>
              <input type="number" min="1" max="12" value={form.descontoMeses} onChange={(e) => set("descontoMeses", e.target.value)} />
            </div>
          </div>
        </Beneficio>

        <Beneficio on={form.aulaExperimental} onToggle={(v) => set("aulaExperimental", v)} titulo="Aula experimental"
          sub={`A aula AVULSA (hoje ${money(Number(meta.valorAvulsa) || 0)}) sai pelo valor abaixo. Com R$ 0, a vaga é confirmada na hora, sem Pix.`}>
          <div className="field" style={{ marginBottom: 0, maxWidth: 220 }}>
            <label>Valor da aula experimental (R$)</label>
            <input type="number" min="0" step="0.01" value={form.valorExperimental} onChange={(e) => set("valorExperimental", e.target.value)} />
          </div>
        </Beneficio>

        <Beneficio on={form.temPremio} onToggle={(v) => set("temPremio", v)} titulo="Prêmio / brinde"
          sub="O sistema registra quem ganhou e avisa na ficha. A entrega é feita pela escola — aqui você marca como entregue.">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Qual o prêmio</label>
            <input value={form.premio} onChange={(e) => set("premio", e.target.value)} placeholder="Ex.: Kit de agulhas + 1 novelo" />
          </div>
        </Beneficio>

        <h3 style={{ margin: "1.2rem 0 .5rem" }}>Regras</h3>
        <div className="row2">
          <div className="field">
            <label>Os X primeiros <span style={{ color: "var(--muted)", fontWeight: 400 }}>(vazio = sem limite)</span></label>
            <input type="number" min="1" value={form.limiteUsos} onChange={(e) => set("limiteUsos", e.target.value)} placeholder="Ex.: 10" />
          </div>
          <div className="field">
            <label>Unidade</label>
            <Select value={form.unidade} onChange={(v) => set("unidade", v)}
              options={[{ value: "", label: "Todas as unidades" }, ...(meta.units || []).map((u) => ({ value: u, label: u }))]} />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Vale a partir de <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span></label>
            <input type="date" value={form.inicio} onChange={(e) => set("inicio", e.target.value)} />
          </div>
          <div className="field">
            <label>Vale até <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional, inclusive)</span></label>
            <input type="date" value={form.fim} onChange={(e) => set("fim", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Planos aceitos <span style={{ color: "var(--muted)", fontWeight: 400 }}>(nenhum marcado = todos)</span></label>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            {[1, 2, 3, 4].map((p) => {
              const on = form.planos.includes(p);
              return (
                <button key={p} type="button" className={`btn sm ${on ? "" : "ghost"}`}
                  onClick={() => set("planos", on ? form.planos.filter((x) => x !== p) : [...form.planos, p].sort())}>
                  {on ? "✓ " : ""}{p}x por semana
                </button>
              );
            })}
          </div>
        </div>
        <label className="opt" style={{ display: "flex", gap: ".5rem", alignItems: "center", marginTop: ".6rem" }}>
          <input type="checkbox" checked={form.ativo} onChange={(e) => set("ativo", e.target.checked)} />
          Campanha ativa (desmarque para deixar pronta e soltar depois)
        </label>

        {/* Prévia: é o que ajuda a conferir antes de divulgar o código */}
        <div className="cfg-preview" style={{ marginTop: "1.2rem", padding: "1rem", border: "1px dashed var(--line)", borderRadius: 10 }}>
          <b>Como fica para a aluna</b>
          {ben.length ? <ul style={{ margin: ".4rem 0 .6rem 1.1rem" }}>{ben.map((t) => <li key={t}>{t}</li>)}</ul>
            : <p className="hint">Escolha um benefício acima.</p>}
          {form.publico !== "alunas" && (form.isentaMatricula || form.temDesconto) && (
            <p className="hint" style={{ margin: 0 }}>
              Exemplo no plano 1x: 1º pagamento de <s>{money(base1x + taxa)}</s> por <b>{money(m1 + t1)}</b>
              {form.temDesconto && Number(form.descontoMeses) > 1 && <> · próximas {Number(form.descontoMeses) - 1} mensalidade(s) por <b>{money(m1)}</b>, depois {money(base1x)}</>}
            </p>
          )}
          {form.aulaExperimental && <p className="hint" style={{ margin: ".3rem 0 0" }}>Aula experimental: <s>{money(Number(meta.valorAvulsa) || 0)}</s> por <b>{money(Math.min(Number(meta.valorAvulsa) || 0, Number(form.valorExperimental) || 0))}</b></p>}
        </div>

        <button className="btn" style={{ marginTop: "1.2rem" }} onClick={salvar} disabled={busy}>
          {busy ? "Salvando…" : editando === "nova" ? "🎟️ Criar campanha" : "💾 Salvar campanha"}
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>🎟️ Campanhas e códigos de promoção</h2>
        <button className="btn" onClick={abrirNova}>＋ Nova campanha</button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        A aluna nova digita o código na matrícula pelo site (<b>/agendar</b>), antes de gerar o Pix.
        Quem já estuda digita no portal, na mensalidade. Você também pode aplicar o código por ela em “Ver usos”.
      </p>
      {carregando ? <div className="empty"><div className="ic">🧶</div><p>Carregando…</p></div>
        : !lista.length ? <div className="empty"><div className="ic">🎟️</div><p>Nenhuma campanha ainda. Crie a primeira!</p></div>
        : (
          <table>
            <thead><tr><th>Código</th><th>Campanha</th><th>Benefícios</th><th>Usos</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td data-l="Código"><span className="chip" style={{ fontWeight: 800, letterSpacing: ".04em" }}>{c.codigo}</span></td>
                  <td data-l="Campanha">
                    <b>{c.nome}</b>
                    <div className="cli-sub">
                      {PUBLICOS.find((p) => p.value === c.publico)?.label}
                      {c.unidade ? ` · ${c.unidade}` : ""}
                      {c.planos?.length ? ` · plano ${c.planos.map((p) => `${p}x`).join("/")}` : ""}
                      {c.inicio || c.fim ? ` · ${c.inicio ? fmtDate(c.inicio) : "…"} a ${c.fim ? fmtDate(c.fim) : "…"}` : ""}
                    </div>
                  </td>
                  <td data-l="Benefícios">{c.beneficios.map((t) => <div key={t} className="cli-sub" style={{ color: "var(--ink)" }}>• {t}</div>)}</td>
                  <td data-l="Usos">
                    <b>{c.usos.usados}{c.limiteUsos != null ? ` / ${c.limiteUsos}` : ""}</b>
                    {c.usos.reservados > 0 && <div className="cli-sub">{c.usos.reservados} aguardando Pix</div>}
                    {c.descontoTotalCents > 0 && <div className="cli-sub">{money(c.descontoTotalCents / 100)} em descontos</div>}
                    {c.premiosPendentes > 0 && <div className="cli-sub" style={{ color: "var(--terracota)", fontWeight: 700 }}>🎁 {c.premiosPendentes} prêmio(s) a entregar</div>}
                  </td>
                  <td data-l="Situação"><span className={`badge ${SITUACAO_COR[c.situacao.codigo] || "b-muted"}`}>{c.situacao.texto}</span></td>
                  <td data-l="">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: ".35rem", justifyContent: "flex-end" }}>
                      <button className="btn sec sm" onClick={() => setUsosDe(c)}>Ver usos</button>
                      <button className="btn ghost sm" onClick={() => abrirEdicao(c)}>Editar</button>
                      <button className="btn ghost sm" onClick={() => alternarAtivo(c)}>{c.ativo ? "Pausar" : "Reativar"}</button>
                      {c.usos.total === 0 && <button className="btn ghost sm" onClick={() => excluir(c)}>Excluir</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}

function Beneficio({ on, onToggle, titulo, sub, children }) {
  return (
    <div style={{ border: `1.5px solid ${on ? "var(--green-deep)" : "var(--line)"}`, borderRadius: 10, padding: ".75rem .9rem", marginBottom: ".6rem", background: on ? "rgba(28,94,51,.04)" : "transparent" }}>
      <label style={{ display: "flex", gap: ".55rem", alignItems: "flex-start", cursor: "pointer" }}>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} style={{ marginTop: ".2rem" }} />
        <span><b>{titulo}</b><br /><span className="hint">{sub}</span></span>
      </label>
      {on && children && <div style={{ marginTop: ".7rem", paddingLeft: "1.6rem" }}>{children}</div>}
    </div>
  );
}

function UsosDaCampanha({ campanha: c, onVoltar }) {
  const { data, reload } = useStore();
  const [usos, setUsos] = useState(null);
  const [aluna, setAluna] = useState("");

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
    const ok = await confirmModal({
      title: "Aplicar código",
      message: `Aplicar o código ${c.codigo} na mensalidade de ${cli.name}? ${c.beneficios.join(" · ")}. A mensalidade em aberto (e os meses da campanha) mudam de valor e o Pix é refeito.`,
      confirmLabel: "Aplicar",
    });
    if (!ok) return;
    try {
      const r = await api.vouchers.aplicarNaAluna(cli.id, c.codigo);
      toast(`Código aplicado para ${cli.name}${r.meses?.length ? ` — ${r.meses.length} mês(es) com desconto` : ""}. 🎟️`);
      setAluna("");
      carregar(); reload?.();
    } catch (e) { toast.error(e.message); }
  };

  const cancelar = async (u) => {
    const ok = await confirmModal({
      title: "Cancelar uso do código",
      message: `Cancelar o uso de ${u.nome}? Os meses seguintes que ainda não foram pagos voltam ao valor normal e a vaga na campanha é liberada. Mês já pago não muda, e um Pix que já foi gerado continua com o valor dele.`,
      confirmLabel: "Cancelar uso", tone: "danger",
    });
    if (!ok) return;
    try {
      const r = await api.vouchers.cancelarUso(u.id);
      const mexidos = (r.meses || []).filter((m) => m.resultado === "mexido_depois").length;
      toast(mexidos ? `Uso cancelado. ${mexidos} mês(es) tinham sido alterados depois e ficaram como estão.` : "Uso cancelado.");
      carregar(); reload?.();
    } catch (e) { toast.error(e.message); }
  };

  const premio = async (u) => {
    try { await api.vouchers.premio(u.id, !u.premioEntregueAt); carregar(); }
    catch (e) { toast.error(e.message); }
  };

  const podeAplicar = c.publico !== "novas";

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>🎟️ {c.codigo} — {c.nome}</h2>
        <button className="btn ghost sm" onClick={onVoltar}>← Voltar</button>
      </div>
      <div className="cli-sub" style={{ marginBottom: ".8rem" }}>
        {c.beneficios.join(" · ")} · {c.usos.usados}{c.limiteUsos != null ? ` de ${c.limiteUsos}` : ""} uso(s)
      </div>

      {podeAplicar && (
        <div style={{ display: "flex", gap: ".6rem", alignItems: "end", flexWrap: "wrap", marginBottom: "1rem", padding: ".8rem", border: "1px solid var(--line)", borderRadius: 10 }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 260, flex: 1 }}>
            <label>Aplicar o código na mensalidade de uma aluna</label>
            <Select value={aluna} onChange={setAluna} options={opcoesAlunas} placeholder="Escolha a aluna" searchable />
          </div>
          <button className="btn" onClick={aplicar} disabled={!aluna}>Aplicar</button>
        </div>
      )}

      {usos == null ? <div className="empty"><p>Carregando…</p></div>
        : !usos.length ? <div className="empty"><div className="ic">🎟️</div><p>Ninguém usou este código ainda.</p></div>
        : (
          <table>
            <thead><tr><th>#</th><th>Data</th><th>Aluna</th><th>Onde</th><th>Situação</th><th>Desconto</th>{c.premio && <th>Prêmio</th>}<th></th></tr></thead>
            <tbody>
              {usos.map((u, i) => {
                const [cor, txt] = USO_STATUS[u.status] || ["b-muted", u.status];
                return (
                  <tr key={u.id}>
                    <td data-l="#">{i + 1}º</td>
                    <td data-l="Data">{fmtDate(String(u.createdAt).slice(0, 10))}</td>
                    <td data-l="Aluna"><b>{u.nome}</b></td>
                    <td data-l="Onde">{CONTEXTO[u.contexto] || u.contexto}</td>
                    <td data-l="Situação"><span className={`badge ${cor}`}>{txt}</span></td>
                    <td data-l="Desconto">
                      {u.descontoCents > 0 ? money(u.descontoCents / 100) : "—"}
                      {u.meses?.length > 0 && <div className="cli-sub">{u.meses.map((m) => `${compLabel(m.comp)}: ${money(m.depois / 100)}`).join(" · ")}</div>}
                    </td>
                    {c.premio && (
                      <td data-l="Prêmio">
                        {u.status === "confirmado"
                          ? <button className={`btn sm ${u.premioEntregueAt ? "ghost" : ""}`} onClick={() => premio(u)}>{u.premioEntregueAt ? `✓ entregue ${fmtDate(u.premioEntregueAt)}` : "🎁 Marcar entregue"}</button>
                          : <span className="cli-sub">—</span>}
                      </td>
                    )}
                    <td data-l="">{u.status !== "cancelado" && u.status !== "expirado" && <button className="btn ghost sm" onClick={() => cancelar(u)}>Cancelar uso</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </div>
  );
}
