import { useState } from "react";
import { useStore } from "./store.jsx";
import { api } from "./api.js";

export default function Config() {
  const { data, run } = useStore();
  const m = data.meta;
  const [valor, setValor] = useState(m.valorPadrao);
  const [cap, setCap] = useState(m.capacidadePadrao);
  const [horario, setHorario] = useState(m.horarioFunc || "");
  const [units, setUnits] = useState((m.units || []).join("\n"));
  const [profs, setProfs] = useState((m.profs || []).join("\n"));
  const [pixKey, setPixKey] = useState(m.pixKey || "");
  const [pixName, setPixName] = useState(m.pixName || "");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const payload = {
      valorPadrao: Number(valor) || m.valorPadrao,
      capacidadePadrao: Math.max(1, parseInt(cap, 10) || m.capacidadePadrao),
      horarioFunc: horario,
      pixKey: pixKey.trim(),
      pixName: pixName.trim(),
      units: units.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      profs: profs.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    };
    if (!payload.units.length) return alert("Cadastre ao menos uma unidade.");
    if (!payload.profs.length) return alert("Cadastre ao menos um profissional.");
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

      {/* HORÁRIO */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">🕒</span><div><h2>Horário de funcionamento</h2><p>Exibido para as alunas na página pública e no portal.</p></div></div>
        <div className="field"><input value={horario} onChange={(e) => setHorario(e.target.value)} placeholder="Seg a Sáb, 09h às 17h" /></div>
      </div>

      <div className="cfg-save">
        <button className="btn" onClick={save}>Salvar configurações</button>
        {saved && <span className="badge b-ok"><span className="dot" style={{ background: "var(--ok)" }} /> Salvo</span>}
      </div>
    </div>
  );
}
