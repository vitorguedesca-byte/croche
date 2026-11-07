import { useEffect, useRef, useState } from "react";
import { api, canAccess } from "./api.js";
import { Modal } from "./ui.jsx";
import { compLabel, money } from "./helpers.js";
import "./DataAudit.css";

const ENTITIES = { invoice: "Mensalidade", client: "Cadastro", monthlyPrice: "Valor combinado", settings: "Configuração de cobrança" };
const FIELDS = {
  name: "Nome", unit: "Unidade", plan: "Plano", status: "Situação", weeklyFreq: "Aulas por semana", mensalistaTipo: "Tipo do plano",
  monthlyValue: "Valor individual", billingDay: "Dia de vencimento", weeklyFreqAnterior: "Plano anterior", weeklyFreqDesde: "Plano válido desde",
  matriculaStatus: "Matrícula", matriculaAt: "Data da matrícula", matriculaRefundAt: "Devolução da matrícula", matriculaPainelAt: "Matrícula pelo painel",
  clientId: "Cadastro nº", competencia: "Mês de referência", amountCents: "Valor", dueDate: "Vencimento", paidAt: "Pagamento", baixaManual: "Baixa manual", semPix: "Sem Pix", origem: "Origem do valor",
  mensalidadeValor: "Mensalidade padrão", vencimentoDia: "Dia de vencimento padrão", valorPlano1x: "Plano 1x", valorPlano2x: "Plano 2x", valorPlano3x: "Plano 3x", valorPlano4x: "Plano 4x", taxaMatricula: "Taxa de matrícula",
  geracaoAuto: "Emissão automática", cobrarEncargos: "Multa e juros", pixExpira: "Pix expira no vencimento", travaAtraso: "Bloqueio por atraso",
};
const VALUES = { pendente: "Pendente", pago: "Pago", cancelado: "Cancelado", ativo: "Ativo", lead: "Lead", mensalista: "Mensalista", avulso: "Avulso", fixo: "Fixo", escala: "Escala", nao_aplica: "Não se aplica", paga: "Paga", convertida: "Convertida", devolvida: "Devolvida", ajuste: "Ajuste", promocao: "Promoção", desconto: "Desconto", voucher: "Campanha" };
const currency = new Set(["monthlyValue", "mensalidadeValor", "valorPlano1x", "valorPlano2x", "valorPlano3x", "valorPlano4x", "taxaMatricula"]);
const actionOf = item => {
  const labels = { criado: ["criado", "criada"], alterado: ["alterado", "alterada"], excluido: ["excluído", "excluída"] };
  return labels[item.action]?.[["invoice", "settings"].includes(item.entity) ? 1 : 0] || item.action;
};
function valueOf(field, value) {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (field === "amountCents") return money(value / 100);
  if (currency.has(field)) return money(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10).split("-").reverse().join("/");
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) return compLabel(value);
  return VALUES[value] || String(value);
}
const when = value => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export function DataAudit({ clientId }) {
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [version, setVersion] = useState(0), [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState(""), [entity, setEntity] = useState("");
  const generation = useRef(0);
  const allowed = canAccess("financeiro");
  useEffect(() => { const timer = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(timer); }, [searchInput]);
  useEffect(() => {
    const current = ++generation.current;
    setItems([]); setCursor(null); setError("");
    if (!allowed) return;
    setBusy(true);
    api.getDataAudit(clientId, null, { search, entity }).then(result => {
      if (generation.current === current) { setItems(result.items); setCursor(result.nextCursor); }
    }).catch(e => { if (generation.current === current) setError(e.message); })
      .finally(() => { if (generation.current === current) setBusy(false); });
    return () => { generation.current++; };
  }, [clientId, version, allowed, search, entity]);
  const more = async () => {
    const current = generation.current;
    setBusy(true); setError("");
    try {
      const result = await api.getDataAudit(clientId, cursor, { search, entity });
      if (generation.current === current) { setItems(old => [...old, ...result.items]); setCursor(result.nextCursor); }
    } catch (e) { if (generation.current === current) setError(e.message); }
    finally { if (generation.current === current) setBusy(false); }
  };
  if (!allowed) return <p>Acesso ao Financeiro necessário para consultar este histórico.</p>;
  return <section className="data-audit" aria-label="Histórico de alterações">
    <p className="cli-sub">Alterações registradas a partir da ativação da auditoria. Os registros anteriores não têm autoria recuperável. Horários de Brasília.</p>
    <div className="data-audit-controls">
      <input aria-label="Buscar por aluna, usuário ou motivo" placeholder="Buscar aluna, usuário ou motivo" value={searchInput} onChange={e => setSearchInput(e.target.value)} maxLength={100} />
      <select aria-label="Tipo de registro" value={entity} onChange={e => setEntity(e.target.value)}>
        <option value="">Todos os registros</option>
        {Object.entries(ENTITIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <button className="btn ghost sm" disabled={busy} onClick={() => setVersion(v => v + 1)}>Atualizar</button>
    </div>
    {error && <p role="alert" className="data-audit-error">{error}</p>}
    <div aria-busy={busy} aria-live="polite">
      {items.map(item => <article className="data-audit-event" key={item.id}>
        <div className="data-audit-heading">
          <b>{ENTITIES[item.entity] || item.entity} {actionOf(item)}{item.competencia ? ` · ${compLabel(item.competencia)}` : ""}</b>
          <time dateTime={item.createdAt}>{when(item.createdAt)}</time>
        </div>
        <div className="cli-sub">
          {item.clientName || "Todas as alunas · configuração geral"} · {item.actorName ? `${item.actorName} (${item.actor})` : item.actor}
          {item.source !== "painel" ? ` · ${item.source}` : ""}
          {" · "}registro #{item.id}
        </div>
        {item.reason && <p className="data-audit-reason"><b>Motivo:</b> {item.reason}</p>}
        <dl className="data-audit-changes">
          {Object.entries(item.changes).filter(([field, change]) => field !== "clientId" && (field !== "competencia" || change.before != null)).map(([field, change]) => <div key={field}>
            <dt>{FIELDS[field] || field}</dt>
            <dd><span>{valueOf(field, change.before)}</span><span aria-label="para"> → </span><strong>{valueOf(field, change.after)}</strong></dd>
          </div>)}
        </dl>
      </article>)}
      {!busy && !error && !items.length && <div className="prof-empty">Nenhuma alteração registrada{search || entity ? " para este filtro" : " ainda"}.</div>}
      {busy && <p role="status">Carregando histórico…</p>}
    </div>
    {cursor && <button className="btn sec" onClick={more} disabled={busy}>Carregar registros anteriores</button>}
  </section>;
}

export function DataAuditModal() {
  return <Modal title="Histórico de alterações" size="lg"><DataAudit /></Modal>;
}
