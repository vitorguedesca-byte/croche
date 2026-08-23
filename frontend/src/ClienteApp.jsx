import { useState } from "react";
import { toast } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { api } from "./api.js";
import {
  UNITS, VALOR_PADRAO, todayISO, fmtDate, fmtDateLong, money, waLink,
  slotById, slotCapacity, slotOccupancy,
} from "./helpers.js";

/* ===================== INPUT DE PIN ===================== */
function PinInput({ value, onChange }) {
  const digits = Array.from({ length: 4 }, (_, i) => value[i] || "");
  return (
    <div style={{ display: "flex", gap: ".5rem", justifyContent: "center" }}>
      {digits.map((d, i) => (
        <input
          key={i}
          id={`pin-${i}`}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={d}
          style={{ width: 52, height: 60, textAlign: "center", fontSize: "1.6rem", borderRadius: 12, border: "2px solid #ddd", fontWeight: 700 }}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 1);
            const next = value.split("");
            next[i] = v;
            onChange(next.join("").slice(0, 4));
            if (v && i < 3) document.getElementById(`pin-${i + 1}`)?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) document.getElementById(`pin-${i - 1}`)?.focus();
          }}
        />
      ))}
    </div>
  );
}

/* ===================== FLUXO DE LOGIN ===================== */
function LoginFlow({ onAuth }) {
  const [step, setStep] = useState("phone"); // phone | create | enter
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const checkPhone = async () => {
    setErr(""); setLoading(true);
    try {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 8) { setErr("Digite um número de WhatsApp válido."); setLoading(false); return; }
      const r = await api.auth.check(digits);
      if (!r.exists) { setErr("Número não cadastrado. Chame a gente no WhatsApp para fazer o seu cadastro! 💚"); setLoading(false); return; }
      setStep(r.hasPin ? "enter" : "create");
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const createPin = async () => {
    setErr("");
    if (pin.length !== 4) { setErr("O PIN deve ter 4 dígitos."); return; }
    if (pin !== pinConfirm) { setErr("Os PINs não coincidem."); setPinConfirm(""); return; }
    setLoading(true);
    try {
      const r = await api.auth.setPin(phone.replace(/\D/g, ""), pin);
      onAuth(r.client);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const enterPin = async () => {
    setErr("");
    if (pin.length !== 4) { setErr("Digite os 4 dígitos do seu PIN."); return; }
    setLoading(true);
    try {
      const r = await api.auth.login(phone.replace(/\D/g, ""), pin);
      onAuth(r.client);
    } catch (e) { setErr(e.message); setPin(""); }
    finally { setLoading(false); }
  };

  return (
    <div id="clienteApp">
      <div className="cli-wrap" style={{ maxWidth: 400 }}>
        <div className="cli-head">
          <img src="/logo-1.PNG" alt="Fios que Curam" />
          <h1>Área da aluna</h1>
          <p>Acesse suas aulas e marcações.</p>
        </div>

        {step === "phone" && (
          <div className="panel">
            <div className="field">
              <label>Seu WhatsApp (com DDD)</label>
              <input type="tel" value={phone} placeholder="31988880000"
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && checkPhone()} />
            </div>
            {err && <p style={{ color: "#c00", fontSize: ".88rem", marginTop: ".5rem" }}>{err}</p>}
            <button className="btn terra" style={{ width: "100%", justifyContent: "center", marginTop: ".8rem" }} onClick={checkPhone} disabled={loading}>
              {loading ? "Verificando…" : "Continuar →"}
            </button>
          </div>
        )}

        {step === "create" && (
          <div className="panel">
            <p style={{ marginBottom: "1rem", color: "var(--muted)", textAlign: "center" }}>
              Primeiro acesso! Crie um PIN de 4 dígitos para entrar nas próximas vezes.
            </p>
            <label style={{ display: "block", marginBottom: ".5rem", fontWeight: 600, fontSize: ".9rem", textAlign: "center" }}>Escolha seu PIN</label>
            <PinInput value={pin} onChange={setPin} />
            <label style={{ display: "block", margin: "1rem 0 .5rem", fontWeight: 600, fontSize: ".9rem", textAlign: "center" }}>Confirme o PIN</label>
            <PinInput value={pinConfirm} onChange={setPinConfirm} />
            {err && <p style={{ color: "#c00", fontSize: ".88rem", marginTop: ".6rem", textAlign: "center" }}>{err}</p>}
            <button className="btn terra" style={{ width: "100%", justifyContent: "center", marginTop: "1.2rem" }} onClick={createPin} disabled={loading}>
              {loading ? "Salvando…" : "Criar PIN e entrar"}
            </button>
            <button className="btn ghost sm" style={{ width: "100%", justifyContent: "center", marginTop: ".5rem" }} onClick={() => { setStep("phone"); setPin(""); setPinConfirm(""); setErr(""); }}>
              ← Voltar
            </button>
          </div>
        )}

        {step === "enter" && (
          <div className="panel">
            <p style={{ marginBottom: "1rem", color: "var(--muted)", textAlign: "center" }}>Digite seu PIN de 4 dígitos.</p>
            <PinInput value={pin} onChange={setPin} />
            {err && <p style={{ color: "#c00", fontSize: ".88rem", marginTop: ".6rem", textAlign: "center" }}>{err}</p>}
            <button className="btn terra" style={{ width: "100%", justifyContent: "center", marginTop: "1.2rem" }} onClick={enterPin} disabled={loading}>
              {loading ? "Entrando…" : "Entrar"}
            </button>
            <button className="btn ghost sm" style={{ width: "100%", justifyContent: "center", marginTop: ".5rem" }} onClick={() => { setStep("phone"); setPin(""); setErr(""); }}>
              ← Trocar número
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== APP PRINCIPAL DA CLIENTE ===================== */
export default function ClienteApp({ onBack }) {
  const { data, run } = useStore();
  const [authClient, setAuthClient] = useState(null);
  const [bookingMode, setBookingMode] = useState(false);

  if (!authClient) return <LoginFlow onAuth={setAuthClient} />;

  return (
    <div id="clienteApp">
      <div className="cli-wrap">
        <div className="cli-head">
          <img src="/logo-1.PNG" alt="Fios que Curam" />
          <h1>Olá, {authClient.name.split(" ")[0]}! 💚</h1>
          <p>Suas aulas e marcações.</p>
        </div>

        {bookingMode
          ? <BookingFlow client={authClient} data={data} run={run} onDone={() => setBookingMode(false)} />
          : <MyBookings client={authClient} data={data} onNew={() => setBookingMode(true)} />
        }

        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <button className="btn ghost sm" onClick={() => { setAuthClient(null); setBookingMode(false); }}>Sair da conta</button>
          {onBack && <button className="btn ghost sm" style={{ marginLeft: ".5rem" }} onClick={onBack}>← Admin</button>}
        </div>
      </div>
    </div>
  );
}

/* ===================== DASHBOARD: MINHAS AULAS ===================== */
function MyBookings({ client, data, onNew }) {
  if (!data) return <div className="empty"><div className="ic">🧶</div><p>Carregando…</p></div>;

  const phone = (client.phone || "").replace(/\D/g, "");
  const myBookings = data.bookings
    .filter((b) => (b.phone || "").replace(/\D/g, "").endsWith(phone.slice(-8)))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  const statusLabel = {
    aguardando: "⏳ Aguardando pagamento",
    confirmada: "✅ Confirmada",
    concluida: "🎉 Concluída",
    cancelada: "❌ Cancelada",
  };

  return (
    <div>
      <button className="btn terra" style={{ width: "100%", justifyContent: "center", marginBottom: "1.2rem" }} onClick={onNew}>
        + Marcar nova aula
      </button>

      {myBookings.length === 0
        ? <div className="empty"><div className="ic">📝</div><p>Você ainda não tem marcações.</p></div>
        : myBookings.map((b) => (
          <div key={b.id} className="panel" style={{ marginBottom: ".8rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: ".5rem", flexWrap: "wrap" }}>
              <div>
                <b style={{ color: "var(--green-deep)" }}>{fmtDateLong(b.date)}</b>
                <span style={{ marginLeft: ".5rem", color: "var(--muted)" }}>às {b.time}</span>
                <div style={{ fontSize: ".85rem", color: "var(--muted)", marginTop: ".2rem" }}>{b.unit} · com {b.prof}</div>
              </div>
              <span style={{ fontSize: ".8rem", whiteSpace: "nowrap" }}>{statusLabel[b.status] || b.status}</span>
            </div>
            {b.status === "aguardando" && (
              <div className="help" style={{ marginTop: ".7rem", fontSize: ".82rem" }}>
                Reserva: {money(b.value)} — envie o comprovante no WhatsApp para confirmar sua vaga.{" "}
                <a href={waLink("31988880000", `Olá! Vou enviar o comprovante da aula de ${fmtDate(b.date)} às ${b.time}.`)}
                  target="_blank" rel="noreferrer" style={{ color: "var(--green-deep)", fontWeight: 700 }}>
                  Enviar agora 💬
                </a>
              </div>
            )}
          </div>
        ))
      }
    </div>
  );
}

/* ===================== NOVA MARCAÇÃO ===================== */
function BookingFlow({ client, data, run, onDone }) {
  const [unit, setUnit] = useState(null);
  const [slotId, setSlotId] = useState(null);
  const [waitId, setWaitId] = useState(null);
  const [done, setDone] = useState(null);

  const submitBooking = async () => {
    const slot = slotById(data, slotId);
    try {
      await run(api.createBooking({ clientName: client.name, phone: client.phone, unit: slot.unit, slotId: slot.id }));
      setDone({ type: "booking", slot });
    } catch (e) { toast(e.message, "error"); }
  };

  const submitWait = async () => {
    const slot = slotById(data, waitId);
    await run(api.addWaitlist(slot.id, { name: client.name, phone: client.phone }));
    setDone({ type: "wait", slot });
  };

  if (done) return (
    <div className="panel" style={{ textAlign: "center" }}>
      <div style={{ fontSize: "3rem" }}>{done.type === "wait" ? "⏰" : "💚"}</div>
      <h2 style={{ color: "var(--green-deep)", margin: ".5rem 0" }}>
        {done.type === "wait" ? "Na lista de espera!" : "Reserva solicitada!"}
      </h2>
      <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
        {done.type === "wait"
          ? `Lista de espera para ${fmtDateLong(done.slot.date)} às ${done.slot.time}.`
          : `Aula de ${fmtDateLong(done.slot.date)} às ${done.slot.time} reservada. Aguardando pagamento.`}
      </p>
      <button className="btn ghost sm" onClick={onDone}>← Minhas aulas</button>
    </div>
  );

  const backBtn = <button className="btn ghost sm" onClick={onDone} style={{ marginBottom: "1rem" }}>← Minhas aulas</button>;

  if (!unit) return (
    <div>
      {backBtn}
      <div className="unit-pick">
        {UNITS.map((u) => (
          <div key={u} className="unit-card" onClick={() => setUnit(u)}>
            <div className="ic">📍</div><b>{u}</b><span>Aulas presenciais</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (waitId) {
    const slot = slotById(data, waitId);
    return (
      <div>
        {backBtn}
        <div className="panel">
          <div className="help" style={{ marginBottom: "1rem" }}>⏰ Turma de <b>{fmtDateLong(slot.date)} às {slot.time}</b> lotada. Quer entrar na lista de espera?</div>
          <button className="btn terra" style={{ width: "100%", justifyContent: "center" }} onClick={submitWait}>Entrar na lista de espera</button>
          <button className="btn ghost sm" style={{ width: "100%", justifyContent: "center", marginTop: ".5rem" }} onClick={() => setWaitId(null)}>← Voltar aos horários</button>
        </div>
      </div>
    );
  }

  if (!slotId) {
    const t = todayISO();
    const free = data.slots.filter((s) => s.unit === unit && s.date >= t)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 24);
    const byDay = {};
    free.forEach((s) => { (byDay[s.date] = byDay[s.date] || []).push(s); });
    return (
      <div>
        <button className="btn ghost sm" onClick={() => setUnit(null)} style={{ marginBottom: "1rem" }}>← Trocar unidade ({unit})</button>
        {Object.keys(byDay).length
          ? Object.keys(byDay).map((d) => (
            <div className="panel" key={d}>
              <h3 style={{ color: "var(--green-deep)", fontSize: "1rem", marginBottom: ".7rem", textTransform: "capitalize" }}>{fmtDateLong(d)}</h3>
              <div className="slot-list">{byDay[d].map((s) => {
                const vagas = slotCapacity(s) - slotOccupancy(data, s.id);
                return vagas > 0
                  ? <button key={s.id} className="slot-btn" onClick={() => setSlotId(s.id)}><b>{s.time}</b><span>com {s.prof}</span><span className={`vagas ${vagas <= 1 ? "few" : ""}`}>{vagas} vaga{vagas !== 1 ? "s" : ""} restante{vagas !== 1 ? "s" : ""}</span></button>
                  : <button key={s.id} className="slot-btn lotada" onClick={() => setWaitId(s.id)}><b>{s.time}</b><span>com {s.prof}</span><span className="vagas few">Lotada · lista de espera</span></button>;
              })}</div>
            </div>
          ))
          : <div className="empty"><div className="ic">🧶</div><p>Sem horários disponíveis no momento.</p></div>
        }
      </div>
    );
  }

  const slot = slotById(data, slotId);
  return (
    <div>
      {backBtn}
      <div className="panel">
        <div className="help" style={{ marginBottom: "1rem" }}>📍 <b>{slot.unit}</b> · {fmtDateLong(slot.date)} · <b>{slot.time}</b> · com {slot.prof}</div>
        <p style={{ fontSize: ".88rem", color: "var(--muted)", marginBottom: "1rem" }}>Reserva de {money(VALOR_PADRAO)}. Confirme para solicitar a vaga.</p>
        <button className="btn terra" style={{ width: "100%", justifyContent: "center" }} onClick={submitBooking}>Solicitar reserva</button>
        <button className="btn ghost sm" style={{ width: "100%", justifyContent: "center", marginTop: ".5rem" }} onClick={() => setSlotId(null)}>← Voltar aos horários</button>
      </div>
    </div>
  );
}
