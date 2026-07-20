import { useState } from "react";
import { toast } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { api } from "./api.js";
import { WEEKDAYS_PT, parseHorario, horarioToText, serializeHorario } from "./helpers.js";

export default function Config() {
  const { data, run } = useStore();
  const m = data.meta;
  const [valor, setValor] = useState(m.valorPadrao);
  const [cap, setCap] = useState(m.capacidadePadrao);
  const [hours, setHours] = useState(() => parseHorario(m.horarioFunc).days);
  const setDay = (i, patch) => setHours((hs) => hs.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const [units, setUnits] = useState((m.units || []).join("\n"));
  const [profs, setProfs] = useState((m.profs || []).join("\n"));
  const [pixKey, setPixKey] = useState(m.pixKey || "");
  const [pixName, setPixName] = useState(m.pixName || "");
  const [mensalidadeValor, setMensalidadeValor] = useState(m.mensalidadeValor || "");
  const [vencimentoDia, setVencimentoDia] = useState(m.vencimentoDia || 10);
  const [taxaMatricula, setTaxaMatricula] = useState(m.taxaMatricula ?? 20);
  const [plano1x, setPlano1x] = useState(m.valorPlano1x ?? 120);
  const [plano2x, setPlano2x] = useState(m.valorPlano2x ?? 200);
  const [avulsa, setAvulsa] = useState(m.valorAvulsa ?? 40);
  const [duracao, setDuracao] = useState(m.duracaoAulaMin ?? 120);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const payload = {
      valorPadrao: Number(valor) || m.valorPadrao,
      capacidadePadrao: Math.max(1, parseInt(cap, 10) || m.capacidadePadrao),
      horarioFunc: serializeHorario(hours),
      pixKey: pixKey.trim(),
      pixName: pixName.trim(),
      mensalidadeValor: Number(mensalidadeValor) || 0,
      vencimentoDia: Math.min(28, Math.max(1, parseInt(vencimentoDia, 10) || 10)),
      taxaMatricula: Number(taxaMatricula) || 0,
      valorPlano1x: Number(plano1x) || 0,
      valorPlano2x: Number(plano2x) || 0,
      valorAvulsa: Number(avulsa) || 0,
      duracaoAulaMin: Math.min(600, Math.max(15, parseInt(duracao, 10) || 120)),
      units: units.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      profs: profs.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    };
    if (!payload.units.length) return toast("Cadastre ao menos uma unidade.", "error");
    if (!payload.profs.length) return toast("Cadastre ao menos um profissional.", "error");
    await run(api.updateSettings(payload));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const unitsList = units.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const profsList = profs.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

  return (
    <div className="config-wrap">
      {/* PAGAMENTO / PIX */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">💠</span><div><h2>Pagamento (Pix)</h2><p>A chave usada pelas alunas para pagar a reserva das aulas.</p></div></div>
        <div className="row2">
          <div className="field"><label>Chave Pix</label><input value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="ex.: 31988880000, e-mail, CPF ou chave aleatória" /></div>
          <div className="field"><label>Nome do recebedor</label><input value={pixName} onChange={(e) => setPixName(e.target.value)} placeholder="Inêz Pimentel" /></div>
        </div>
        {pixKey.trim()
          ? <div className="cfg-preview">🔑 Alunas verão: <b>{pixName.trim() || "—"}</b> · chave <b>{pixKey.trim()}</b></div>
          : <div className="cfg-warn">⚠️ Sem chave Pix cadastrada, as alunas não conseguem pagar a reserva.</div>}
      </div>

      {/* TABELA DE PREÇOS */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">🏷️</span><div><h2>Tabela de preços</h2><p>Valores do curso. Alimentam a aula experimental, os planos e as aulas extras.</p></div></div>
        <div className="row2">
          <div className="field">
            <label>Taxa de matrícula (R$)</label>
            <input type="number" min="0" step="0.01" value={taxaMatricula} onChange={(e) => setTaxaMatricula(e.target.value)} />
            <div className="help" style={{ marginTop: ".4rem" }}>Cobrada para agendar a aula experimental. Devolvida se a aluna não continuar; se continuar, vira a matrícula.</div>
          </div>
          <div className="field">
            <label>Duração da aula (minutos)</label>
            <input type="number" min="15" max="600" step="15" value={duracao} onChange={(e) => setDuracao(e.target.value)} />
            <div className="help" style={{ marginTop: ".4rem" }}>Usada para mostrar o fim da aula e impedir turmas sobrepostas na mesma unidade.</div>
          </div>
        </div>
        <div className="row2">
          <div className="field"><label>Plano 1x por semana (R$/mês)</label><input type="number" min="0" step="0.01" value={plano1x} onChange={(e) => setPlano1x(e.target.value)} /></div>
          <div className="field"><label>Plano 2x por semana (R$/mês)</label><input type="number" min="0" step="0.01" value={plano2x} onChange={(e) => setPlano2x(e.target.value)} /></div>
        </div>
        <div className="field"><label>Aula extra avulsa (R$)</label><input type="number" min="0" step="0.01" value={avulsa} onChange={(e) => setAvulsa(e.target.value)} /></div>
        <div className="cfg-preview">
          🏷️ Matrícula <b>R$ {taxaMatricula}</b> · 1x/semana <b>R$ {plano1x}</b> (4 aulas) · 2x/semana <b>R$ {plano2x}</b> (8 aulas) · extra <b>R$ {avulsa}</b> · aula de <b>{Math.floor(duracao / 60)}h{duracao % 60 ? String(duracao % 60).padStart(2, "0") : ""}</b>
        </div>
      </div>

      {/* MENSALIDADES */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">📅</span><div><h2>Cobrança das mensalidades</h2><p>Quando os boletos vencem. O valor vem do plano da aluna (acima) ou de um valor próprio no cadastro dela.</p></div></div>
        <div className="row2">
          <div className="field"><label>Dia de vencimento padrão (1–28)</label><input type="number" min="1" max="28" value={vencimentoDia} onChange={(e) => setVencimentoDia(e.target.value)} /></div>
          <div className="field">
            <label>Valor padrão antigo (R$)</label>
            <input type="number" min="0" step="0.01" value={mensalidadeValor} onChange={(e) => setMensalidadeValor(e.target.value)} placeholder="ex.: 200" />
            <div className="help" style={{ marginTop: ".4rem" }}>Só é usado por alunas cadastradas antes dos planos, que ainda não têm 1x ou 2x definido.</div>
          </div>
        </div>
        <div className="cfg-preview">🧾 Vencimento dia <b>{vencimentoDia}</b> de cada mês</div>
      </div>

      {/* PADRÕES DE RESERVA */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">🧶</span><div><h2>Padrões de reserva</h2><p>Valores aplicados automaticamente ao criar horários e marcações.</p></div></div>
        <div className="row2">
          <div className="field"><label>Valor padrão da reserva (R$)</label><input type="number" min="0" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
          <div className="field"><label>Capacidade padrão das turmas (vagas)</label><input type="number" min="1" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
        </div>
      </div>

      {/* UNIDADES & PROFISSIONAIS */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">📍</span><div><h2>Unidades &amp; Profissionais</h2><p>Alimentam as opções em toda a agenda e nas marcações. Uma por linha.</p></div></div>
        <div className="row2">
          <div className="field">
            <label>Unidades <span className="cfg-count">{unitsList.length}</span></label>
            <textarea value={units} onChange={(e) => setUnits(e.target.value)} style={{ minHeight: 110 }} placeholder={"Ipatinga\nTimóteo"} />
          </div>
          <div className="field">
            <label>Profissionais <span className="cfg-count">{profsList.length}</span></label>
            <textarea value={profs} onChange={(e) => setProfs(e.target.value)} style={{ minHeight: 110 }} placeholder={"Inêz\nEquipe FQC"} />
          </div>
        </div>
      </div>

      {/* HORÁRIO POR DIA */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">🕒</span><div><h2>Horário de funcionamento</h2><p>Defina o horário de cada dia da semana. Exibido para as alunas.</p></div></div>
        <div className="hf-list">
          {WEEKDAYS_PT.map((dia, i) => (
            <div key={dia} className={`hf-row ${hours[i].open ? "" : "off"}`}>
              <label className="hf-toggle">
                <input type="checkbox" checked={hours[i].open} onChange={(e) => setDay(i, { open: e.target.checked })} />
                <span className="hf-day">{dia}</span>
              </label>
              {hours[i].open ? (
                <div className="hf-times">
                  <input type="time" value={hours[i].from} onChange={(e) => setDay(i, { from: e.target.value })} />
                  <span className="hf-sep">às</span>
                  <input type="time" value={hours[i].to} onChange={(e) => setDay(i, { to: e.target.value })} />
                </div>
              ) : <span className="hf-closed">Fechado</span>}
            </div>
          ))}
        </div>
        <div className="cfg-preview" style={{ marginTop: ".9rem" }}>🕒 Alunas verão: <b>{horarioToText(hours)}</b></div>
      </div>

      <div className="cfg-save">
        <button className="btn" onClick={save}>Salvar configurações</button>
        {saved && <span className="badge b-ok"><span className="dot" style={{ background: "var(--ok)" }} /> Salvo</span>}
      </div>
    </div>
  );
}
