import { useState, useEffect } from "react";
import { api } from "./api.js";

/* ============================================================
   Gasto com a Meta (aba do Disparo WhatsApp, 25/11/2026).

   Em cima, o REAL: o que a Meta cobrou da conta do WhatsApp no período,
   lido direto dela (pricing_analytics) — por dia e por categoria. É o
   mesmo número do Gerenciador do WhatsApp; a fatura é que vale centavo
   a centavo.

   Embaixo, a ESTIMATIVA POR DISPARO: a Meta não diz de qual disparo veio
   cada cobrança, então cada disparo é estimado como mensagens cobradas ×
   o preço médio que ela cobrou por mensagem daquela categoria. O que
   sobra do real é dos avisos automáticos e do robô.
   ============================================================ */

const CATEGORIA = {
  MARKETING: "Marketing",
  MARKETING_LITE: "Marketing (lite)",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
  AUTHENTICATION_INTERNATIONAL: "Autenticação internacional",
  SERVICE: "Serviço (conversa)",
  REFERRAL_CONVERSION: "Conversa de anúncio",
};
const nomeCategoria = (c) => CATEGORIA[String(c || "").toUpperCase()] || (c ? String(c).toLowerCase() : "—");

const AVISO = {
  lembrete_mensalidade: "Lembrete de mensalidade",
  cobranca_mensalidade_1: "Cobrança em atraso (1º aviso)",
  cobranca_mensalidade_2: "Cobrança em atraso (2º aviso)",
  mensalidade_a_vencer: "Mensalidade a vencer",
  mensalidade_em_atraso: "Mensalidade em atraso",
  aniversario: "Aniversário",
  matricula: "Matrícula",
  pagamento: "Pagamento confirmado",
  pix: "Pix",
  livre: "Mensagem avulsa",
};
const nomeAviso = (k) => AVISO[k] || String(k || "").replace(/_/g, " ");

const iso = (d) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
function periodo(chave) {
  const hoje = new Date();
  const h = iso(hoje);
  if (chave === "mes") return [`${h.slice(0, 8)}01`, h];
  if (chave === "7d" || chave === "30d") {
    const d = new Date(hoje.getTime() - ((chave === "7d" ? 7 : 30) - 1) * 86400_000);
    return [iso(d), h];
  }
  if (chave === "mesPassado") {
    const ano = Number(h.slice(0, 4)), mes = Number(h.slice(5, 7));
    const [a, m] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return [`${a}-${mm}-01`, `${a}-${mm}-${ultimo}`];
  }
  return null;
}
const PERIODOS = [
  ["mes", "Este mês"],
  ["mesPassado", "Mês passado"],
  ["7d", "7 dias"],
  ["30d", "30 dias"],
];

const diaMes = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const dataHora = (d) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function DisparoGasto() {
  const [chave, setChave] = useState("mes");
  const [[de, ate], setPer] = useState(() => periodo("mes"));
  const [g, setG] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    api.disparo.gasto(de, ate)
      .then((r) => { if (vivo) setG(r); })
      .catch((e) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [de, ate]);

  const escolher = (k) => { setChave(k); setPer(periodo(k)); };
  const mudarData = (qual, v) => {
    if (!v) return;
    setChave("outro");
    setPer(([d, a]) => (qual === "de" ? [v, v > a ? v : a] : [v < d ? v : d, v]));
  };

  const moeda = g?.moeda;
  const fmt = (v, casas = 2) => {
    if (v == null) return "—";
    try {
      return moeda
        ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: moeda, minimumFractionDigits: casas, maximumFractionDigits: casas })
        : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
    } catch { return Number(v).toFixed(casas); }
  };

  const real = g?.real;
  const dias = real?.porDia || [];
  const maxDia = Math.max(0, ...dias.map((d) => d.custo));
  const marketing = real?.porCategoria.find((c) => c.categoria === "MARKETING");
  const nDias = Math.max(1, Math.round((Date.parse(ate) - Date.parse(de)) / 86400_000) + 1);

  return (<>
    <div className="panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <div className="seg seg-tabs">
        {PERIODOS.map(([k, l]) => <button key={k} className={chave === k ? "on" : ""} onClick={() => escolher(k)}>{l}</button>)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
        <input type="date" value={de} max={ate} onChange={(e) => mudarData("de", e.target.value)} aria-label="De" />
        <span className="cli-sub">até</span>
        <input type="date" value={ate} min={de} max={periodo("mes")[1]} onChange={(e) => mudarData("ate", e.target.value)} aria-label="Até" />
      </div>
    </div>

    {erro && <div className="panel empty"><div className="ic">🔌</div><p>Não consegui calcular o gasto.</p><p className="cli-sub">{erro}</p></div>}
    {!erro && !g && <div className="panel empty"><div className="ic">💰</div><p>Perguntando à Meta quanto ela cobrou…</p></div>}

    {g && (<div style={{ opacity: carregando ? 0.55 : 1, transition: "opacity .2s" }}>
      {g.erro && (
        <div className="help" style={{ marginBottom: "1rem", borderLeftColor: "var(--danger)" }}>
          ⚠️ A Meta não respondeu com o gasto real: {g.erro}. A estimativa por disparo abaixo fica sem preço até ela responder.
        </div>
      )}

      <div className="grid stats" style={{ marginBottom: "1rem" }}>
        <div className="card stat">
          <div className="lbl">💰 Gasto real na Meta</div>
          <div className="val terra">{real ? fmt(real.total) : "—"}</div>
          <div className="foot">{diaMes(de)} a {diaMes(ate)}{real ? ` · média ${fmt(real.total / nDias)}/dia` : ""}</div>
        </div>
        <div className="card stat">
          <div className="lbl">📨 Mensagens cobradas</div>
          <div className="val">{real ? real.volumePago.toLocaleString("pt-BR") : "—"}</div>
          <div className="foot">{real ? `${(real.volume - real.volumePago).toLocaleString("pt-BR")} grátis (conversa aberta)` : "sem dado da Meta"}</div>
        </div>
        <div className="card stat">
          <div className="lbl">📣 Preço do marketing</div>
          <div className="val">{g.precoMedio?.MARKETING != null ? fmt(g.precoMedio.MARKETING, 4) : "—"}</div>
          <div className="foot">{marketing ? `por mensagem · ${fmt(marketing.custo)} no período` : "por mensagem, média cobrada"}</div>
        </div>
        <div className="card stat">
          <div className="lbl">🚀 Disparos no período</div>
          <div className="val">{fmt(g.somaDisparos)}</div>
          <div className="foot">estimado · {g.disparos.length} disparo(s)</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <h2>Gasto por dia</h2>
          <div className="tools"><span className="cli-sub">direto da Meta{moeda ? ` · ${moeda}` : ""}</span></div>
        </div>
        {!real ? <div className="empty">Sem resposta da Meta.</div>
          : !dias.length || maxDia === 0 ? <div className="empty">A Meta não cobrou nada nesse período.</div>
          : (
            <div role="img" aria-label={`Gasto por dia: ${dias.map((d) => `${diaMes(d.dia)} ${fmt(d.custo)}`).join(", ")}`}
              style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 160, padding: "0 .25rem", borderBottom: "1px solid var(--line)" }}>
              {dias.map((d) => (
                <div key={d.dia} title={`${diaMes(d.dia)} · ${fmt(d.custo)} · ${d.volume} mensagem(ns)\n${Object.entries(d.porCategoria).filter(([, v]) => v > 0).map(([c, v]) => `${nomeCategoria(c)}: ${fmt(v)}`).join("\n")}`}
                  style={{ flex: 1, minWidth: 4, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default" }}>
                  <div style={{ width: "100%", height: `${maxDia ? (d.custo / maxDia) * 100 : 0}%`, minHeight: d.custo > 0 ? 2 : 0, background: "var(--green-mid)", borderRadius: "4px 4px 0 0" }} />
                </div>
              ))}
            </div>
          )}
        {real && dias.length > 0 && maxDia > 0 && (
          <div className="cli-sub" style={{ display: "flex", justifyContent: "space-between", marginTop: ".35rem" }}>
            <span>{diaMes(dias[0].dia)}</span>
            <span>maior dia: {fmt(maxDia)} — passe o mouse nas barras para ver cada dia</span>
            <span>{diaMes(dias[dias.length - 1].dia)}</span>
          </div>
        )}
      </div>

      {real && real.porCategoria.length > 0 && (
        <div className="panel">
          <div className="panel-h"><h2>Por categoria</h2></div>
          <table>
            <thead><tr><th>Categoria</th><th>Mensagens</th><th>Preço médio</th><th>Gasto</th></tr></thead>
            <tbody>
              {real.porCategoria.map((c) => (
                <tr key={c.categoria}>
                  <td className="c-main"><span className="cli-name">{nomeCategoria(c.categoria)}</span></td>
                  <td data-l="Mensagens">{c.volumePago.toLocaleString("pt-BR")} cobrada(s){c.volumeGratis ? <span className="cli-sub"> · {c.volumeGratis.toLocaleString("pt-BR")} grátis</span> : null}</td>
                  <td data-l="Preço médio">{c.precoMedio != null ? fmt(c.precoMedio, 4) : "—"}</td>
                  <td data-l="Gasto"><b>{fmt(c.custo)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <div className="panel-h">
          <h2>Por disparo</h2>
          <div className="tools"><span className="cli-sub">estimado</span></div>
        </div>
        <div className="seg-hint">
          A Meta não diz de qual disparo veio cada cobrança. Aqui é <b>mensagens cobradas × preço médio</b> que ela cobrou na categoria do template.
          Texto livre (conversa aberta) não é cobrado.
        </div>
        {!g.disparos.length ? <div className="empty">Nenhum disparo nesse período.</div> : (
          <table>
            <thead><tr><th>Quando</th><th>Mensagem</th><th>Cobradas</th><th>Estimado</th></tr></thead>
            <tbody>
              {g.disparos.map((d) => (
                <tr key={d.id}>
                  <td className="c-main">
                    <span className="cli-name">{dataHora(d.inicioEm)}</span>
                    <div className="cli-sub">por {d.por}</div>
                  </td>
                  <td data-l="Mensagem">
                    {d.modo === "template" ? <span className="chip">🧾 {d.template}</span> : <span className="chip">✍️ texto livre</span>}
                    <div className="cli-sub">{nomeCategoria(d.categoria)}</div>
                  </td>
                  <td data-l="Cobradas">
                    {d.cobradas} de {d.enviadas}
                    {d.cobradas > d.confirmadas && <div className="cli-sub" title="Mensagens de antes do registro da cobrança: contam como cobradas porque foram template e chegaram">{d.cobradas - d.confirmadas} pela entrega</div>}
                  </td>
                  <td data-l="Estimado"><b>{d.estimado == null ? "sem preço" : fmt(d.estimado)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-h"><h2>Avisos automáticos e robô</h2></div>
        <div className="seg-hint">
          O que a Meta cobrou e não é de disparo: cobrança e lembrete de mensalidade, aniversário, matrícula e as respostas do robô.
          {g.restante != null && <> No período, <b>{fmt(g.restante)}</b> (gasto real − disparos).</>}
        </div>
        {g.automaticos.length > 0 && (
          <table>
            <thead><tr><th>Aviso</th><th>Enviados</th><th>Cobrados</th><th>Estimado</th></tr></thead>
            <tbody>
              {g.automaticos.map((a) => (
                <tr key={a.kind}>
                  <td className="c-main"><span className="cli-name">{nomeAviso(a.kind)}</span></td>
                  <td data-l="Enviados">{a.enviadas}</td>
                  <td data-l="Cobrados">{a.cobradas || <span className="cli-sub">— a Meta ainda não informou</span>}</td>
                  <td data-l="Estimado">{a.cobradas ? fmt(a.estimado) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="cli-sub" style={{ marginTop: ".5rem" }}>
        Valores da Meta são aproximados (ela mesma avisa); a fatura do WhatsApp Business é que vale. Os dados de hoje podem demorar algumas horas para aparecer.
      </div>
    </div>)}
  </>);
}
