import { useState, useEffect } from "react";
import { api } from "./api.js";
import { fmtDate, fmtDateLong, money, waLink } from "./helpers.js";
import { WaIcon } from "./icons.jsx";

const INEZ_WA = "5531000000000"; // número da Inêz (ajustável)

export default function FirstClassBooking({ onBack, fromSite }) {
  const [meta, setMeta] = useState({ units: [], valorPadrao: 80, pixKey: "", pixName: "" });
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("unit"); // unit | slot | dados | pay
  const [unit, setUnit] = useState(null);
  const [slot, setSlot] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [booking, setBooking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const loadAvail = async (u) => {
    setLoading(true);
    try { const r = await api.availableSlots(u); setAvailable(r.available); setMeta(r.meta); }
    catch (e) { flash(e.message || "Não consegui carregar os horários."); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadAvail(); }, []);

  const stepNum = step === "unit" ? 1 : step === "slot" ? 2 : 3;

  const submit = async () => {
    if (!name.trim() || phone.replace(/\D/g, "").length < 10) { flash("Preencha seu nome e WhatsApp com DDD."); return; }
    if (cpf.replace(/\D/g, "").length !== 11) { flash("Informe um CPF válido (11 números) — é com ele que você acessa o portal depois."); return; }
    setBusy(true);
    try {
      const b = await api.createBooking({ clientName: name.trim(), phone: phone.trim(), cpf: cpf.trim(), unit: slot.unit, slotId: slot.id });
      setBooking(b); setStep("pay");
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const copyPix = async () => {
    try { await navigator.clipboard.writeText(meta.pixKey); flash("Chave Pix copiada! 📋"); }
    catch { flash("Anote a chave acima."); }
  };
  const restart = () => { setStep("unit"); setUnit(null); setSlot(null); setName(""); setPhone(""); setBooking(null); loadAvail(); };

  const byDay = {};
  available.forEach((s) => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  const days = Object.keys(byDay).sort();

  return (
    <div className="pt-bg">
      <div className="pt-container">
        {toast && <div className="pt-toast">{toast}</div>}
        <div className="pt-fc-head">
          <img src="/logo-1.PNG" className="pt-logo" alt="Fios que Curam" />
          <h1>Marque sua aula</h1>
          {step !== "pay" && (
            <div className="pt-steps">
              <span className={`pt-step ${stepNum >= 1 ? "on" : ""}`}>1 · Unidade</span>
              <span className={`pt-step ${stepNum >= 2 ? "on" : ""}`}>2 · Horário</span>
              <span className={`pt-step ${stepNum >= 3 ? "on" : ""}`}>3 · Seus dados</span>
            </div>
          )}
        </div>

        {step === "unit" && (
          <div className="pt-card">
            <h2 className="pt-h2" style={{ marginTop: 0 }}>Escolha a unidade</h2>
            <div className="pt-unit-pick">
              {meta.units.map((u) => (
                <button key={u} className="pt-unit-card" onClick={() => { setUnit(u); setStep("slot"); loadAvail(u); }}>
                  <div className="ic">📍</div><b>{u}</b><span>Aulas presenciais</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "slot" && (<>
          <button className="pt-link" onClick={() => { setStep("unit"); setUnit(null); }}>← Trocar unidade ({unit})</button>
          <h2 className="pt-h2">Escolha o horário</h2>
          {loading ? <div className="pt-empty">Carregando horários…</div>
            : days.length ? days.map((d) => (
              <div className="pt-day" key={d}>
                <div className="pt-day-h">{fmtDateLong(d)}</div>
                {byDay[d].map((s) => (
                  <button className="pt-slot" key={s.id} onClick={() => { setSlot(s); setStep("dados"); }}>
                    <div><b>{s.time}</b><span> · com {s.prof}</span></div>
                    <span className="pt-vagas">{s.vagas} vaga{s.vagas === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            )) : <div className="pt-empty">Não há horários livres em {unit} no momento.<br />Fale com a Inêz no WhatsApp. 💚</div>}
        </>)}

        {step === "dados" && (
          <div className="pt-card">
            <button className="pt-link" onClick={() => setStep("slot")}>← Trocar horário</button>
            <div className="pt-fc-resume">📍 <b>{slot.unit}</b> · {fmtDateLong(slot.date)} · <b>{slot.time}</b> · com {slot.prof}</div>
            <label className="pt-label">Seu nome</label>
            <input className="pt-input" style={{ textAlign: "left", fontSize: "1.15rem" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos te chamar?" />
            <label className="pt-label" style={{ marginTop: "1rem" }}>Seu WhatsApp (com DDD)</label>
            <input className="pt-input" style={{ textAlign: "left", fontSize: "1.15rem" }} inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="31988880000" />
            <label className="pt-label" style={{ marginTop: "1rem" }}>Seu CPF</label>
            <input className="pt-input" style={{ textAlign: "left", fontSize: "1.15rem" }} inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
            <button className="pt-btn" onClick={submit} disabled={busy}>{busy ? "Marcando…" : "Continuar para o pagamento →"}</button>
            <p className="pt-hint">A reserva ({money(meta.valorPadrao)}) garante a sua vaga. A aula é confirmada após o pagamento. 💚</p>
          </div>
        )}

        {step === "pay" && booking && (<>
          <h2 className="pt-h2" style={{ textAlign: "center" }}>Quase lá! Falta o pagamento 💚</h2>
          <div className="pt-pay">
            <div className="pt-pay-top">
              <div><b>{fmtDateLong(booking.date)}</b><div className="pt-sub2">{booking.time} · {booking.unit}</div></div>
              <div className="pt-pay-val">{money(booking.value)}</div>
            </div>
            <div className="pt-sub2">Olá, <b>{name.split(" ")[0]}</b>! Sua vaga está reservada. Escolha como pagar:</div>
          </div>
          <div className="pt-pay">
            <div className="pt-pay-opt-h">💠 Pagar com Pix</div>
            {meta.pixKey ? (<>
              <div className="pt-pix">
                <div className="pt-pix-row"><span>Chave Pix</span><b>{meta.pixKey}</b></div>
                {meta.pixName ? <div className="pt-pix-row"><span>Recebedor</span><b>{meta.pixName}</b></div> : null}
                <button className="pt-pix-copy" onClick={copyPix}>📋 Copiar chave Pix</button>
              </div>
              <a className="pt-btn pt-btn-wa" href={waLink(INEZ_WA, `Olá Inêz! Marquei minha aula de ${fmtDate(booking.date)} às ${booking.time} (${booking.unit}) e fiz o Pix de ${money(booking.value)}. Segue o comprovante 👇`)} target="_blank" rel="noreferrer">📲 Já paguei — enviar comprovante</a>
            </>) : <div className="pt-empty" style={{ fontSize: "1rem" }}>Fale com a Inêz pelo WhatsApp para combinar o Pix.</div>}
          </div>
          <div className="pt-pay-note">🔒 Sua vaga é confirmada assim que a Inêz receber o pagamento.</div>
          <div style={{ textAlign: "center" }}><button className="pt-link" onClick={restart}>Marcar outra aula</button></div>
        </>)}

        {onBack && <div style={{ textAlign: "center", marginTop: "1.5rem" }}><button className="pt-link" onClick={onBack}>{fromSite ? "← Voltar ao site" : "← Voltar ao painel"}</button></div>}
      </div>
    </div>
  );
}
