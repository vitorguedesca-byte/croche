import { useState, useEffect } from "react";
import { api } from "./api.js";
import { todayISO, addDays, fmtDate, fmtDateLong, money, capitalize, fimDaAula } from "./helpers.js";

const DOW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/* Calendário mensal (cliente): dias com horário livre ficam clicáveis;
   ao escolher o dia, os horários aparecem como botões. */
function PtAgenda({ available, value, onPick }) {
  const t = todayISO();
  const byDay = {};
  available.forEach((s) => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  Object.values(byDay).forEach((arr) => arr.sort((a, b) => a.time.localeCompare(b.time)));
  const firstAvail = Object.keys(byDay).sort()[0] || t;

  const [monthRef, setMonthRef] = useState((value?.date || firstAvail).slice(0, 7) + "-01");
  const [selDay, setSelDay] = useState(value?.date || null);

  const refd = new Date(monthRef + "T00:00");
  const y = refd.getFullYear(), m = refd.getMonth();
  const firstISO = new Date(y, m, 1).toISOString().slice(0, 10);
  const startDow = (new Date(firstISO + "T00:00").getDay() + 6) % 7;
  const gridStart = addDays(firstISO, -startDow);
  const monthLabel = capitalize(refd.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  const thisMonth = t.slice(0, 7);
  const canPrev = monthRef.slice(0, 7) > thisMonth;

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const dd = new Date(date + "T00:00");
    const out = dd.getMonth() !== m;
    const has = !out && (byDay[date]?.length || 0) > 0;
    cells.push(
      <div
        key={i}
        className={`pt-cal-cell ${out ? "out" : ""} ${has ? "has" : ""} ${selDay === date ? "sel" : ""}`}
        onClick={has ? () => setSelDay(date) : undefined}
      >
        {out ? "" : dd.getDate()}{has && <span className="dot" />}
      </div>
    );
  }

  const dayslots = selDay ? byDay[selDay] || [] : [];

  return (
    <div>
      <div className="pt-cal-head">
        <button className="pt-cal-nav" disabled={!canPrev} onClick={() => canPrev && setMonthRef(new Date(y, m - 1, 1).toISOString().slice(0, 10))}>←</button>
        <b>{monthLabel}</b>
        <button className="pt-cal-nav" onClick={() => setMonthRef(new Date(y, m + 1, 1).toISOString().slice(0, 10))}>→</button>
      </div>
      <div className="pt-cal-grid">
        {DOW.map((d) => <div key={d} className="pt-cal-dow">{d}</div>)}
        {cells}
      </div>
      {Object.keys(byDay).length === 0 && <div className="pt-cal-empty">Não há horários livres nesta unidade no momento.<br />Fale com a Inêz no WhatsApp. 💚</div>}
      {selDay && (
        <div className="pt-times">
          <div className="pt-times-h">Horários em {capitalize(fmtDateLong(selDay))}</div>
          <div className="pt-times-grid">
            {dayslots.map((s) => (
              <button key={s.id} className={`pt-time ${value?.id === s.id ? "on" : ""}`} onClick={() => onPick(s)}>
                {s.time}<small>com {s.prof}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FirstClassBooking({ onBack, fromSite }) {
  const [meta, setMeta] = useState({ units: [], valorPadrao: 20, pixKey: "", pixName: "" });
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true);
  // A 1ª aula OFICIAL não é marcada aqui: pela regra do curso, ela é agendada
  // no fim da aula experimental (portal da sala ou com a Inêz), junto com a
  // escolha do plano e o pagamento da 1ª mensalidade.
  const [step, setStep] = useState("unit"); // unit | cal1 | pay | done
  const [unit, setUnit] = useState(null);
  const [slot, setSlot] = useState(null); // horário da aula experimental

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");

  const [booking, setBooking] = useState(null);
  const [pix, setPix] = useState(null);   // { code } do Sicredi, ou null (fallback chave estática)
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3800); };

  // taxa fixa de matrícula — a aula experimental em si é gratuita
  const matricula = meta.taxaMatricula ?? 20;

  const loadAvail = async (u) => {
    setLoading(true);
    try { const r = await api.availableSlots(u); setAvailable(r.available); setMeta(r.meta); }
    catch (e) { flash(e.message || "Não consegui carregar os horários."); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadAvail(); }, []);

  const stepNum = { unit: 1, cal1: 2, pay: 3, done: 4 }[step];

  // Passo 3: gera a cobrança da matrícula (Sicredi) e cria a reserva provisória
  const gerarPix = async () => {
    if (!name.trim() || phone.replace(/\D/g, "").length < 10) return flash("Preencha seu nome e WhatsApp com DDD.");
    if (cpf.replace(/\D/g, "").length !== 11) return flash("Informe um CPF válido (11 números).");
    if (!/\S+@\S+\.\S+/.test(email.trim())) return flash("Informe um email válido.");
    setBusy(true);
    try {
      const b = booking || await api.createBooking({
        clientName: name.trim(), phone: phone.trim(), cpf: cpf.trim(), email: email.trim(),
        unit: slot.unit, slotId: slot.id, firstClass: true, // o valor vem da taxa de matrícula no servidor
      });
      setBooking(b);
      try {
        const inv = await api.createInvoice(b.id, { cpf: cpf.trim(), name: name.trim(), email: email.trim() });
        setPix({ code: inv.pixCode || null });
      } catch {
        setPix({ code: null }); // fallback: mostra a chave Pix estática
      }
    } catch (e) { flash(e.message || "Erro ao gerar a cobrança."); }
    finally { setBusy(false); }
  };

  const copyPix = async () => {
    const val = pix?.code || meta.pixKey;
    try { await navigator.clipboard.writeText(val); flash(pix?.code ? "Pix copia-e-cola copiado! 📋" : "Chave Pix copiada! 📋"); }
    catch { flash("Copie o código acima."); }
  };

  // "JÁ PAGUEI": confirma a taxa de matrícula e encerra — a vaga da experimental fica reservada
  const jaPaguei = async () => {
    setBusy(true);
    try {
      await api.payBooking(booking.id, { value: matricula });
      setStep("done");
    } catch (e) { flash(e.message || "Erro ao confirmar."); }
    finally { setBusy(false); }
  };

  const restart = () => {
    setStep("unit"); setUnit(null); setSlot(null);
    setName(""); setPhone(""); setCpf(""); setEmail(""); setBooking(null); setPix(null);
    loadAvail();
  };

  return (
    <div className="pt-bg">
      <div className="pt-container">
        {toast && <div className="pt-toast">{toast}</div>}
        <div className="pt-fc-head">
          <img src="/logo-1.PNG" className="pt-logo" alt="Fios que Curam" />
          <h1>Sua aula experimental</h1>
          {step !== "done" && (
            <div className="pt-steps">
              <span className={`pt-step ${stepNum >= 1 ? "on" : ""}`}>1 · Unidade</span>
              <span className={`pt-step ${stepNum >= 2 ? "on" : ""}`}>2 · Horário</span>
              <span className={`pt-step ${stepNum >= 3 ? "on" : ""}`}>3 · Matrícula</span>
            </div>
          )}
        </div>

        {/* 1 · UNIDADE */}
        {step === "unit" && (
          <div className="pt-card">
            <h2 className="pt-h2" style={{ marginTop: 0 }}>Escolha a unidade</h2>
            <div className="pt-unit-pick">
              {meta.units.map((u) => (
                <button key={u} className="pt-unit-card" onClick={() => { setUnit(u); setSlot(null); loadAvail(u); setStep("cal1"); }}>
                  <div className="ic">📍</div><b>{u}</b><span>Aulas presenciais</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 2 · HORÁRIO (calendário) */}
        {step === "cal1" && (
          <div className="pt-card">
            <button className="pt-link" onClick={() => { setStep("unit"); setUnit(null); }}>← Trocar unidade ({unit})</button>
            <h2 className="pt-h2">Escolha o dia e o horário</h2>
            {loading ? <div className="pt-cal-empty">Carregando horários…</div>
              : <PtAgenda available={available} value={slot} onPick={(s) => { setSlot(s); setStep("pay"); }} />}
          </div>
        )}

        {/* 3 · MATRÍCULA (Pix) */}
        {step === "pay" && slot && (
          <div className="pt-card">
            <button className="pt-link" onClick={() => { setStep("cal1"); }}>← Trocar horário</button>
            <div className="pt-fc-resume">📍 <b>{slot.unit}</b> · {capitalize(fmtDateLong(slot.date))} · <b>{slot.time}</b> · com {slot.prof}</div>

            <div className="pt-matricula">
              <p>A <b>aula experimental é gratuita</b> 💚 Para reservar a sua vaga, pedimos apenas a taxa de matrícula de <b>{money(matricula)}</b>.</p>
              <p>💬 Fez a aula e não quis continuar? <b>Devolvemos os {money(matricula)} integralmente.</b></p>
              <p>🧵 Quis continuar? Esse valor já fica como a sua <b>matrícula</b> — você não paga de novo.</p>
            </div>
            <div className="pt-atencao">
              <span className="t">⚠️ Atenção</span>
              Em caso de falta sem aviso prévio de no mínimo 6 horas, não devolvemos o valor da matrícula. Mas você poderá agendar sua primeira aula normalmente.<br />
              Até lá! 💛
            </div>

            {!pix ? (<>
              <label className="pt-label">Seu nome</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos te chamar?" />
              <label className="pt-label" style={{ marginTop: ".9rem" }}>Seu WhatsApp (com DDD)</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="31988880000" />
              <label className="pt-label" style={{ marginTop: ".9rem" }}>Seu CPF</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
              <label className="pt-label" style={{ marginTop: ".9rem" }}>Seu email</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
              <button className="pt-btn" onClick={gerarPix} disabled={busy}>{busy ? "Gerando…" : `Gerar Pix da matrícula (${money(matricula)}) →`}</button>
            </>) : (<>
              <div className="pt-pay" style={{ borderLeftColor: "var(--green-mid)" }}>
                <div className="pt-pay-opt-h">💠 Pague a matrícula com Pix</div>
                {pix.code ? (<>
                  <div className="pt-pix-row"><span>Pix copia-e-cola</span><b>{money(matricula)}</b></div>
                  <div className="pt-pix-code">{pix.code}</div>
                </>) : (<div className="pt-pix">
                  <div className="pt-pix-row"><span>Chave Pix</span><b>{meta.pixKey || "—"}</b></div>
                  {meta.pixName ? <div className="pt-pix-row"><span>Recebedor</span><b>{meta.pixName}</b></div> : null}
                  <div className="pt-pix-row"><span>Valor</span><b>{money(matricula)}</b></div>
                </div>)}
                <button className="pt-pix-copy" onClick={copyPix}>📋 Copiar {pix.code ? "código Pix" : "chave Pix"}</button>
              </div>
              <button className="pt-btn" onClick={jaPaguei} disabled={busy}>{busy ? "Confirmando…" : "✅ JÁ PAGUEI — continuar"}</button>
              <p className="pt-hint">Assim que o pagamento for aprovado, sua vaga na aula experimental está garantida. 💚</p>
            </>)}
          </div>
        )}

        {/* 4 · CONCLUÍDO */}
        {step === "done" && slot && (
          <div className="pt-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.6rem" }}>🎉</div>
            <h2 className="pt-h2" style={{ textAlign: "center" }}>Tudo certo, {name.split(" ")[0]}!</h2>
            <div className="pt-fc-resume" style={{ textAlign: "left" }}>
              📍 <b>{slot.unit}</b><br />🗓 {capitalize(fmtDateLong(slot.date))}<br />
              ⏰ <b>{slot.time}{meta.duracaoAulaMin ? ` às ${fimDaAula(slot.time, meta.duracaoAulaMin)}` : ""}</b> · com {slot.prof}
            </div>
            <p className="pt-hint">Sua aula experimental está reservada e você já está cadastrada 💛</p>
            <div className="pt-matricula" style={{ textAlign: "left" }}>
              <p><b>E depois da aula?</b></p>
              <p>🧵 Se quiser continuar, no fim da aula você escolhe o seu plano, paga a primeira mensalidade e já agenda a sua 1ª aula oficial — a matrícula já está paga.</p>
              <p>💬 Se preferir não seguir, devolvemos os {money(matricula)} integralmente.</p>
            </div>
            <button className="pt-link" onClick={restart}>Marcar outra aula</button>
          </div>
        )}

        {onBack && step !== "done" && <div style={{ textAlign: "center", marginTop: "1.5rem" }}><button className="pt-link" onClick={onBack}>{fromSite ? "← Voltar ao site" : "← Voltar ao painel"}</button></div>}
      </div>
    </div>
  );
}
