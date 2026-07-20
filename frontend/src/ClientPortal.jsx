import { useState, useEffect } from "react";
import { toast, confirmModal } from "./toast.jsx";
import { api } from "./api.js";
import { WaIcon } from "./icons.jsx";
import PixQR from "./PixQR.jsx";
import { fmtDate, fmtDateLong, todayISO, addDays, waLink, money, faixaHorario } from "./helpers.js";

const CPF_KEY = "fqc_portal_cpf";
const INEZ_WA = "5531000000000"; // número da Inêz (ajustável)
const getStored = () => { try { return localStorage.getItem(CPF_KEY) || ""; } catch { return ""; } };
// chave do portal: prioriza CPF, cai para telefone, depois id
const portalKey = (c) => (c?.cpf || "").replace(/\D/g, "") || (c?.phone || "").replace(/\D/g, "") || String(c?.id || "");

function statusText(b) {
  if (b.status === "aguardando") return "Aguardando pagamento";
  if (b.status === "confirmada") return "Confirmada ✓";
  if (b.status === "concluida") return "Concluída";
  return b.status;
}

function PortalShell({ children }) {
  return <div className="pt-bg"><div className="pt-container">{children}</div></div>;
}

function PinBoxes({ value, onChange, idp }) {
  const digits = Array.from({ length: 4 }, (_, i) => value[i] || "");
  return (
    <div className="pt-pin">
      {digits.map((d, i) => (
        <input key={i} id={`ptpin-${idp}-${i}`} type="tel" inputMode="numeric" maxLength={1} value={d} className="pt-pin-box"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 1);
            const next = value.split(""); next[i] = v;
            onChange(next.join("").slice(0, 4));
            if (v && i < 3) { const el = document.getElementById(`ptpin-${idp}-${i + 1}`); if (el) el.focus(); }
          }}
          onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) { const el = document.getElementById(`ptpin-${idp}-${i - 1}`); if (el) el.focus(); } }}
        />
      ))}
    </div>
  );
}

// No tablet da sala, o portal desloga sozinho depois desse tempo parado —
// senão a próxima aluna pega o aparelho com os dados da anterior na tela.
const KIOSK_IDLE_MS = 3 * 60 * 1000;

export default function ClientPortal({ onBack, fromSite, kiosk, onSairKiosk }) {
  const [phone, setPhone] = useState("");
  // aparelho compartilhado nunca guarda o CPF de quem usou antes
  const [input, setInput] = useState(kiosk ? "" : getStored);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [authStep, setAuthStep] = useState("phone"); // phone | create | enter
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [screen, setScreen] = useState("home"); // home | book | pay
  const [payBooking, setPayBooking] = useState(null);
  const [absenceFor, setAbsenceFor] = useState(null);
  const [absenceText, setAbsenceText] = useState("");

  const load = async (p) => {
    setLoading(true); setErr("");
    try {
      const d = await api.portal.get(p);
      setData(d); setPhone(p);
    } catch (e) { setErr(e.message || "Não consegui carregar."); setData(null); }
    finally { setLoading(false); }
  };

  const checkCpf = async () => {
    const cpf = input.replace(/\D/g, "");
    if (cpf.length !== 11) { setErr("Digite o seu CPF (11 números)."); return; }
    setLoading(true); setErr("");
    try {
      const r = await api.auth.check(cpf);
      if (!r.exists) { setErr("CPF não cadastrado. Toque em “Agendar aula” na página inicial para fazer a sua primeira aula. 💚"); setLoading(false); return; }
      if (!kiosk) { try { localStorage.setItem(CPF_KEY, cpf); } catch {} }
      setAuthStep(r.hasPin ? "enter" : "create"); setLoading(false);
    } catch (e) { setErr(e.message); setLoading(false); }
  };
  const createPin = async () => {
    if (pin.length !== 4) { setErr("O PIN deve ter 4 números."); return; }
    if (pin !== pinConfirm) { setErr("Os PINs não conferem."); setPinConfirm(""); return; }
    setLoading(true); setErr("");
    try { const r = await api.auth.setPin(input.replace(/\D/g, ""), pin); await load(portalKey(r.client)); }
    catch (e) { setErr(e.message); setLoading(false); }
  };
  const enterPin = async () => {
    if (pin.length !== 4) { setErr("Digite os 4 números do seu PIN."); return; }
    setLoading(true); setErr("");
    try { const r = await api.auth.login(input.replace(/\D/g, ""), pin); await load(portalKey(r.client)); }
    catch (e) { setErr(e.message); setPin(""); setLoading(false); }
  };
  const disconnect = () => {
    try { localStorage.removeItem(CPF_KEY); } catch {}
    setPhone(""); setData(null); setScreen("home"); setInput("");
    setAuthStep("phone"); setPin(""); setPinConfirm(""); setErr("");
  };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  // Quiosque: qualquer toque reinicia a contagem; parado demais, cai fora sozinho.
  useEffect(() => {
    if (!kiosk || !data) return;
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { disconnect(); }, KIOSK_IDLE_MS); };
    const eventos = ["pointerdown", "keydown", "scroll", "touchstart"];
    eventos.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); eventos.forEach((e) => window.removeEventListener(e, reset)); };
  }, [kiosk, data]);

  /* ---------- login (WhatsApp + PIN) ---------- */
  if (!data) {
    return (
      <PortalShell>
        <div className="pt-card pt-connect">
          <img src="/logo-1.PNG" className="pt-logo" alt="Fios que Curam" />
          <h1>Área do aluno(a)</h1>
          {kiosk && <div className="pt-kiosk-tag">🧶 Tablet da sala</div>}
          {authStep === "phone" && (<>
            <p className="pt-sub">Digite o seu CPF para acessar as suas aulas.</p>
            <label className="pt-label">Seu CPF</label>
            <input className="pt-input" inputMode="numeric" placeholder="000.000.000-00" value={input}
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && checkCpf()} />
            {err && <div className="pt-err">{err}</div>}
            <button className="pt-btn" onClick={checkCpf} disabled={loading}>{loading ? "Verificando…" : "Continuar"}</button>
            <p className="pt-hint">É a sua primeira vez? Toque em <b>Agendar aula</b> na página inicial. 💚</p>
          </>)}
          {authStep === "create" && (<>
            <p className="pt-sub">Primeiro acesso! Crie um PIN de 4 números para entrar nas próximas vezes.</p>
            <label className="pt-label" style={{ textAlign: "center" }}>Escolha o seu PIN</label>
            <PinBoxes value={pin} onChange={setPin} idp="a" />
            <label className="pt-label" style={{ textAlign: "center", marginTop: "1rem" }}>Confirme o PIN</label>
            <PinBoxes value={pinConfirm} onChange={setPinConfirm} idp="b" />
            {err && <div className="pt-err">{err}</div>}
            <button className="pt-btn" onClick={createPin} disabled={loading}>{loading ? "Salvando…" : "Criar PIN e entrar"}</button>
            <button className="pt-link" style={{ marginTop: ".6rem" }} onClick={() => { setAuthStep("phone"); setPin(""); setPinConfirm(""); setErr(""); }}>← Voltar</button>
          </>)}
          {authStep === "enter" && (<>
            <p className="pt-sub">Digite o seu PIN de 4 números.</p>
            <PinBoxes value={pin} onChange={setPin} idp="a" />
            {err && <div className="pt-err">{err}</div>}
            <button className="pt-btn" onClick={enterPin} disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button>
            <button className="pt-link" style={{ marginTop: ".6rem" }} onClick={() => { setAuthStep("phone"); setPin(""); setErr(""); }}>← Trocar CPF</button>
          </>)}
          {!kiosk && <a className="pt-link" href="/landing.html" style={{ display: "block", marginTop: "1.2rem" }}>← Voltar ao site</a>}
        </div>
      </PortalShell>
    );
  }

  /* ---------- conectado ---------- */
  const t = todayISO();
  const ativos = data.bookings.filter((b) => b.status !== "cancelada");
  const prox = ativos.filter((b) => b.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const passadas = ativos.filter((b) => b.date < t).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const nome = ((data.client && data.client.name) || "").split(" ")[0] || "aluno(a)";
  const meta = data.meta || {};
  const valorAvulsa = meta.valorAvulsa ?? 40;
  const cliente = data.client || {};
  // quem já fez a experimental e ainda não virou mensalista vê o convite de continuar
  const podeConverter = cliente.plan !== "mensalista" && cliente.matriculaStatus !== "devolvida";

  // Mensagem de retorno ao liberar a aula: diz se virou crédito de reposição ou não.
  const avisoLiberacao = (r, base) => {
    if (r && r.credito) return `${base} Você ganhou 1 crédito de reposição! 💚`;
    if (r && r.devolvido) return `${base} ${r.motivo}`;
    if (r && r.motivo) return `${base} ${r.motivo}`;
    return base;
  };
  const doCancel = async (b) => {
    if (!(await confirmModal({ title: "Cancelar aula", message: `Cancelar a sua aula de ${fmtDateLong(b.date)} às ${b.time}?\n\nA vaga ficará livre para outra pessoa.`, confirmLabel: "Cancelar aula", cancelLabel: "Voltar", tone: "danger" }))) return;
    setBusy(true);
    try { const r = await api.portal.cancel(phone, b.id); flash(avisoLiberacao(r, "Aula cancelada.")); await load(phone); }
    catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const doAbsence = async (b) => {
    setBusy(true);
    try {
      const r = await api.portal.absence(phone, b.id, absenceText.trim());
      flash(avisoLiberacao(r, "Aviso enviado. Obrigada por avisar! 💚"));
      setAbsenceFor(null); setAbsenceText("");
      await load(phone);
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const doBook = async (slot) => {
    const modo = screen === "repor" ? "repor" : screen === "extra" ? "extra" : "normal";
    const quando = `${slot.unit}\n${fmtDateLong(slot.date)} às ${slot.time}`;
    const cfg = {
      repor: { title: "Confirmar reposição", message: `Usar 1 crédito de reposição nesta aula?\n\n${quando}`, confirmLabel: "Usar crédito", okMsg: "Reposição marcada! Te espero lá. 💚" },
      extra: { title: "Confirmar aula extra", message: `Marcar uma aula extra por ${money(valorAvulsa)}?\n\n${quando}\n\nO pagamento é feito à parte da sua mensalidade.`, confirmLabel: `Marcar por ${money(valorAvulsa)}`, okMsg: "Aula extra marcada! Toque em “Pagar reserva” para confirmar. 💚" },
      normal: { title: "Confirmar marcação", message: `Marcar aula em ${quando}?`, confirmLabel: "Marcar", okMsg: "Aula marcada! Toque em “Pagar reserva” para confirmar. 💚" },
    }[modo];
    if (!(await confirmModal({ title: cfg.title, message: cfg.message, confirmLabel: cfg.confirmLabel }))) return;
    setBusy(true);
    try {
      await api.portal.book(phone, slot.id, data.client && data.client.name, modo);
      flash(cfg.okMsg);
      setScreen("home"); await load(phone);
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const openPay = (b) => { setPayBooking(b); setScreen("pay"); };

  return (
    <PortalShell>
      {toast && <div className="pt-toast">{toast}</div>}
      <div className="pt-head">
        <div>
          <div className="pt-hello">Olá, <b>{nome}</b>! 👋</div>
          <div className="pt-sub2">Bem-vinda(o) ao seu portal de aulas.</div>
          {data.client && data.client.unit && <div className="pt-unit">📍 Sua unidade: <b>{data.client.unit}</b></div>}
        </div>
        <div className="pt-head-links">
          <button className="pt-link" onClick={() => load(phone)}>Atualizar</button>
          {kiosk
            ? <button className="pt-btn-terminei" onClick={disconnect}>✓ Terminei</button>
            : <button className="pt-link" onClick={disconnect}>Sair</button>}
        </div>
      </div>

      {screen === "book" || screen === "repor" || screen === "extra" ? (
        <BookScreen data={data} busy={busy} modo={screen} onBack={() => setScreen("home")} onBook={doBook} />
      ) : screen === "enroll" ? (
        <EnrollScreen data={data} phone={phone} busy={busy} setBusy={setBusy} flash={flash} kiosk={kiosk}
          onBack={() => setScreen("home")} onDone={async () => { setScreen("home"); await load(phone); }} />
      ) : screen === "pay" && payBooking ? (
        <PaymentScreen booking={payBooking} meta={data.meta || {}} onBack={() => setScreen("home")} flash={flash} />
      ) : (<>
        <div className="pt-actions">
          <button className="pt-big" onClick={() => setScreen("book")}>📅<span>Marcar nova aula</span></button>
          <a className="pt-big pt-big-wa" href={waLink(INEZ_WA, `Olá Inêz! Sou ${(data.client && data.client.name) || ""} e gostaria de falar sobre as minhas aulas. 💚`)} target="_blank" rel="noreferrer"><WaIcon size={26} /><span>Falar com a Inêz</span></a>
        </div>

        {podeConverter && <ContinuarCard cliente={cliente} meta={meta} onContinuar={() => setScreen("enroll")} />}

        <RepoCard makeup={data.makeup} onRepor={() => setScreen("repor")} />

        {cliente.plan === "mensalista" && cliente.status !== "cancelado" && (
          <div className="pt-repo" style={{ borderLeftColor: "var(--green-mid)" }}>
            <div className="pt-repo-top">
              <div>
                <div className="pt-repo-t">➕ Aula extra</div>
                <div className="pt-sub2">Quer praticar mais? Marque uma aula avulsa por <b>{money(valorAvulsa)}</b>, além das do seu plano.</div>
              </div>
            </div>
            <button className="pt-btn" style={{ marginTop: ".8rem" }} onClick={() => setScreen("extra")}>Marcar aula extra</button>
          </div>
        )}

        <MiniAgenda bookings={ativos} unit={data.client && data.client.unit} />

        <h2 className="pt-h2">Minhas próximas aulas</h2>
        {prox.length ? prox.map((b) => (
          <div className="pt-aula" key={b.id}>
            <div className="pt-when"><b>{fmtDateLong(b.date)}</b><span>{b.time} · {b.unit}</span></div>
            <div className={`pt-status ${b.status}`}>{statusText(b)}</div>
            {b.status === "aguardando" && (
              <button className="pt-pay-cta" onClick={() => openPay(b)}>💳 Pagar reserva · {money(b.value)}</button>
            )}
            <div className="pt-aula-actions">
              <button className="pt-btn-out" onClick={() => { setAbsenceFor(absenceFor === b.id ? null : b.id); setAbsenceText(""); }} disabled={busy}>Não poderei ir</button>
              <button className="pt-btn-danger" onClick={() => doCancel(b)} disabled={busy}>Cancelar</button>
            </div>
            {absenceFor === b.id && (
              <div className="pt-absence">
                <label className="pt-absence-l">Conte rapidinho o motivo (opcional):</label>
                <textarea className="pt-absence-t" value={absenceText} onChange={(e) => setAbsenceText(e.target.value)} placeholder="Ex.: tive um imprevisto, vou ao médico…" />
                <div className="pt-absence-actions">
                  <button className="pt-link" onClick={() => { setAbsenceFor(null); setAbsenceText(""); }}>Voltar</button>
                  <button className="pt-btn-out" onClick={() => doAbsence(b)} disabled={busy}>Enviar aviso</button>
                </div>
              </div>
            )}
          </div>
        )) : <div className="pt-empty">Você não tem aulas marcadas.<br />Toque em <b>Marcar nova aula</b> para começar. 🧶</div>}

        {passadas.length > 0 && (<>
          <h2 className="pt-h2">Aulas anteriores</h2>
          {passadas.slice(0, 6).map((b) => (
            <div className="pt-aula pt-past" key={b.id}>
              <div className="pt-when"><b>{fmtDate(b.date)}</b><span>{b.time} · {b.unit}</span></div>
              <div className="pt-status">{b.attendance === "presente" ? "✓ Presente" : b.attendance === "falta" ? "Faltou" : "Concluída"}</div>
            </div>
          ))}
        </>)}
      </>)}
    </PortalShell>
  );
}

function PaymentScreen({ booking, meta, onBack, flash }) {
  const copyPix = async () => {
    try { await navigator.clipboard.writeText(meta.pixKey); flash("Chave Pix copiada! 📋"); }
    catch { flash("Não consegui copiar. Anote a chave."); }
  };
  return (<>
    <button className="pt-link" onClick={onBack}>← Voltar para minhas aulas</button>
    <h2 className="pt-h2">Pagar reserva</h2>
    <div className="pt-pay">
      <div className="pt-pay-top">
        <div><b>{fmtDateLong(booking.date)}</b><div className="pt-sub2">{booking.time} · {booking.unit}</div></div>
        <div className="pt-pay-val">{money(booking.value)}</div>
      </div>
      <div className="pt-sub2">Escolha como deseja pagar a sua reserva:</div>
    </div>

    <div className="pt-pay">
      <div className="pt-pay-opt-h">💠 Pagar com Pix</div>
      {booking.pixCode ? (<>
        <PixQR code={booking.pixCode} size={220} legenda="Aponte a câmera do seu celular para pagar" />
        <details className="pt-pix-det">
          <summary>Prefiro copiar o código</summary>
          <div className="pt-pix-code">{booking.pixCode}</div>
          <button className="pt-pix-copy" onClick={() => navigator.clipboard?.writeText(booking.pixCode)}>📋 Copiar código Pix</button>
        </details>
        <a className="pt-btn pt-btn-wa" href={waLink(INEZ_WA, `Olá Inêz! Fiz o Pix da reserva da minha aula de ${fmtDate(booking.date)} às ${booking.time} (${booking.unit}), no valor de ${money(booking.value)}. Segue o comprovante 👇`)} target="_blank" rel="noreferrer">📲 Já paguei — enviar comprovante</a>
      </>) : meta.pixKey ? (<>
        <div className="pt-pix">
          <div className="pt-pix-row"><span>Chave Pix</span><b>{meta.pixKey}</b></div>
          {meta.pixName ? <div className="pt-pix-row"><span>Recebedor</span><b>{meta.pixName}</b></div> : null}
          <button className="pt-pix-copy" onClick={copyPix}>📋 Copiar chave Pix</button>
        </div>
        <a className="pt-btn pt-btn-wa" href={waLink(INEZ_WA, `Olá Inêz! Fiz o Pix da reserva da minha aula de ${fmtDate(booking.date)} às ${booking.time} (${booking.unit}), no valor de ${money(booking.value)}. Segue o comprovante 👇`)} target="_blank" rel="noreferrer">📲 Já paguei — enviar comprovante</a>
      </>) : <div className="pt-empty" style={{ fontSize: "1rem" }}>A chave Pix ainda não foi cadastrada. Fale com a Inêz pelo WhatsApp.</div>}
    </div>

    <div className="pt-pay">
      <div className="pt-pay-opt-h">💳 Pagar com cartão</div>
      <div className="pt-sub2" style={{ marginBottom: ".9rem" }}>Para pagar no cartão, fale com a Inêz que ela envia o link de pagamento. 💚</div>
      <a className="pt-btn" href={waLink(INEZ_WA, `Olá Inêz! Quero pagar no cartão a reserva da minha aula de ${fmtDate(booking.date)} às ${booking.time} (${booking.unit}), no valor de ${money(booking.value)}.`)} target="_blank" rel="noreferrer"><WaIcon /> Quero o link de pagamento no cartão</a>
    </div>

    <div className="pt-pay-note">🔒 Sua vaga é confirmada assim que a Inêz receber o pagamento.</div>
  </>);
}

function MiniAgenda({ bookings, unit }) {
  const [off, setOff] = useState(0);
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + off);
  const y = base.getFullYear(), m = base.getMonth(), t = todayISO();
  const byDate = {};
  bookings.forEach((b) => { (byDate[b.date] = byDate[b.date] || []).push(b); });
  const firstISO = new Date(y, m, 1).toISOString().slice(0, 10);
  const startDow = (new Date(firstISO + "T00:00").getDay() + 6) % 7;
  const gridStart = addDays(firstISO, -startDow);
  const dows = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const dd = new Date(date + "T00:00");
    const out = dd.getMonth() !== m;
    const has = byDate[date];
    const future = date >= t;
    cells.push(
      <div className={`mini-cell ${out ? "out" : ""} ${date === t ? "today" : ""}`} key={i} title={has ? `${has.length} aula(s) · ${has.map((b) => b.time).join(", ")}` : ""}>
        <span>{dd.getDate()}</span>
        {has ? <span className={`mini-dot ${future ? "up" : "past"}`} /> : null}
      </div>
    );
  }
  const label = base.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return (
    <div className="mini-agenda">
      <div className="mini-head">
        <button className="mini-nav" onClick={() => setOff(off - 1)} aria-label="Mês anterior">←</button>
        <b>Minha agenda{unit ? ` · ${unit}` : ""} — {label.charAt(0).toUpperCase() + label.slice(1)}</b>
        <button className="mini-nav" onClick={() => setOff(off + 1)} aria-label="Próximo mês">→</button>
      </div>
      <div className="mini-grid">
        {dows.map((d, i) => <div className="mini-dow" key={i}>{d}</div>)}
        {cells}
      </div>
      <div className="mini-legend">
        <span><span className="mini-dot up" /> Próxima aula</span>
        <span><span className="mini-dot past" /> Aula realizada</span>
      </div>
    </div>
  );
}

/* Convite para continuar no curso, mostrado a quem fez a experimental. */
function ContinuarCard({ cliente, meta, onContinuar }) {
  const taxa = meta.taxaMatricula ?? 20;
  const jaPagou = cliente.matriculaStatus === "paga";
  return (
    <div className="pt-repo" style={{ borderLeftColor: "var(--terracota)" }}>
      <div className="pt-repo-top">
        <div>
          <div className="pt-repo-t">🧵 Continuar com a gente</div>
          <div className="pt-sub2">
            Gostou da aula experimental? Escolha o seu plano, pague a primeira mensalidade e já agende a sua 1ª aula oficial.
          </div>
          {jaPagou && <div className="pt-sub2" style={{ marginTop: ".4rem" }}>✅ Sua matrícula de <b>{money(taxa)}</b> já está paga — não cobramos de novo.</div>}
        </div>
      </div>
      <button className="pt-btn" style={{ marginTop: ".8rem" }} onClick={onContinuar}>Quero continuar</button>
    </div>
  );
}

/* Escolha do plano → 1ª aula oficial → 1ª mensalidade. É o fluxo do tablet da sala. */
function EnrollScreen({ data, phone, busy, setBusy, flash, kiosk, onBack, onDone }) {
  const meta = data.meta || {};
  const [freq, setFreq] = useState(null);       // 1 ou 2 aulas por semana
  const [slot, setSlot] = useState(null);       // 1ª aula oficial
  const [resultado, setResultado] = useState(null);
  const t = todayISO();

  const planos = [
    { freq: 1, valor: meta.valorPlano1x ?? 120, titulo: "1x por semana", detalhe: "4 aulas no mês" },
    { freq: 2, valor: meta.valorPlano2x ?? 200, titulo: "2x por semana", detalhe: "8 aulas no mês" },
  ];
  const byDay = {};
  (data.available || []).filter((s) => s.date >= t).forEach((s) => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  const days = Object.keys(byDay).sort();

  const confirmar = async () => {
    if (!(await confirmModal({
      title: "Confirmar matrícula",
      message: `Plano de ${freq}x por semana — ${money(planos.find((p) => p.freq === freq).valor)} por mês.\n\n` +
        `1ª aula oficial: ${fmtDateLong(slot.date)} às ${slot.time}, em ${slot.unit}.\n\n` +
        `A partir daí você recebe o boleto todo mês.`,
      confirmLabel: "Confirmar",
    }))) return;
    setBusy(true);
    try {
      const r = await api.portal.enroll(phone, { weeklyFreq: freq, slotId: slot.id });
      setResultado(r);
    } catch (e) { flash(e.message || "Não consegui concluir."); }
    finally { setBusy(false); }
  };

  if (resultado) {
    const inv = resultado.invoice;
    return (<>
      <h2 className="pt-h2">🎉 Bem-vinda oficialmente!</h2>
      <div className="pt-pay">
        <div className="pt-pay-top">
          <div>
            <b className="pt-no-caps">Plano de {freq}x por semana</b>
            <div className="pt-sub2">{planos.find((p) => p.freq === freq).detalhe}</div>
          </div>
          <div className="pt-pay-val">{money(resultado.valorMensal)}/mês</div>
        </div>
      </div>
      {resultado.booking && (
        <div className="pt-fc-resume">
          Sua 1ª aula oficial: 📍 <b>{resultado.booking.unit}</b> · {fmtDateLong(resultado.booking.date)} · <b>{faixaHorario(resultado.booking.time, meta.duracaoAulaMin)}</b>
        </div>
      )}
      <div className="pt-pay">
        <div className="pt-pay-opt-h">💠 Primeira mensalidade · {money(resultado.valorMensal)}</div>
        {inv?.pixCode ? (<>
          <PixQR code={inv.pixCode} size={kiosk ? 300 : 220}
            legenda="Aponte a câmera do seu celular para pagar" />
          <details className="pt-pix-det">
            <summary>Prefiro copiar o código</summary>
            <div className="pt-pix-code">{inv.pixCode}</div>
            <button className="pt-pix-copy" onClick={() => navigator.clipboard?.writeText(inv.pixCode)}>📋 Copiar código Pix</button>
          </details>
        </>) : (<div className="pt-pix">
          <div className="pt-pix-row"><span>Chave Pix</span><b>{meta.pixKey || "—"}</b></div>
          {meta.pixName ? <div className="pt-pix-row"><span>Recebedor</span><b>{meta.pixName}</b></div> : null}
          <div className="pt-pix-row"><span>Valor</span><b>{money(resultado.valorMensal)}</b></div>
        </div>)}
        <p className="pt-hint">As próximas mensalidades chegam automaticamente todo mês, com vencimento no dia {meta.vencimentoDia || 10}. 💚</p>
      </div>
      <button className="pt-btn" onClick={onDone}>Ir para as minhas aulas</button>
    </>);
  }

  return (<>
    <button className="pt-link" onClick={onBack}>← Voltar</button>
    <h2 className="pt-h2">Escolha o seu plano</h2>
    <div className="pt-unit-pick">
      {planos.map((p) => (
        <button key={p.freq} className={`pt-unit-card ${freq === p.freq ? "on" : ""}`} onClick={() => setFreq(p.freq)}>
          <div className="ic">🧶</div><b>{p.titulo}</b>
          <span>{p.detalhe}</span>
          <span className="pt-plano-val">{money(p.valor)}/mês</span>
        </button>
      ))}
    </div>

    {freq && (<>
      <h2 className="pt-h2">Agende a sua 1ª aula oficial</h2>
      <p className="pt-sub2" style={{ marginBottom: "1rem" }}>Escolha o horário. Aulas de {Math.floor((meta.duracaoAulaMin ?? 120) / 60)} horas.</p>
      {days.length ? days.map((d) => (
        <div className="pt-day" key={d}>
          <div className="pt-day-h">{fmtDateLong(d)}</div>
          {byDay[d].map((s) => (
            <button key={s.id} className={`pt-slot ${slot?.id === s.id ? "on" : ""}`} onClick={() => setSlot(s)}>
              <div><b>{faixaHorario(s.time, meta.duracaoAulaMin)}</b><span> · {s.unit} · com {s.prof}</span></div>
              <span className="pt-vagas">{s.free} vaga{s.free === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      )) : <div className="pt-empty">Não há horários livres no momento.<br />Fale com a Inêz. 💚</div>}
    </>)}

    {freq && slot && (
      <button className="pt-btn" onClick={confirmar} disabled={busy}>
        {busy ? "Confirmando…" : `Confirmar plano ${freq}x e 1ª aula →`}
      </button>
    )}
  </>);
}

/* Saldo e regras de reposição — só aparece para quem é mensalista. */
function RepoCard({ makeup, onRepor }) {
  const [abrir, setAbrir] = useState(false);
  if (!makeup) return null;
  // aluna avulsa não tem reposição: não polui o portal dela com o assunto
  if (!makeup.elegivel && /mensalistas/.test(makeup.motivo || "")) return null;

  const { saldo, elegivel, motivo, regras } = makeup;
  const disponiveis = (makeup.creditos || []).filter((c) => c.situacao === "disponivel");
  const proximo = disponiveis.map((c) => c.expiresOn).sort()[0];

  return (
    <div className="pt-repo">
      <div className="pt-repo-top">
        <div>
          <div className="pt-repo-t">🔁 Reposição</div>
          <div className="pt-sub2">
            {elegivel
              ? saldo > 0
                ? <>Você tem <b>{saldo}</b> {saldo === 1 ? "crédito disponível" : "créditos disponíveis"}.</>
                : "Você não tem créditos no momento."
              : motivo}
          </div>
          {elegivel && proximo && <div className="pt-sub2">Usar até <b>{fmtDate(proximo)}</b>.</div>}
        </div>
        <div className={`pt-repo-n ${saldo > 0 && elegivel ? "on" : ""}`}>{elegivel ? saldo : "—"}</div>
      </div>

      {elegivel && saldo > 0 && (
        <button className="pt-btn" style={{ marginTop: ".8rem" }} onClick={onRepor}>Marcar aula de reposição</button>
      )}

      <button className="pt-link" style={{ marginTop: ".6rem" }} onClick={() => setAbrir(!abrir)}>
        {abrir ? "Ocultar as regras" : "Como funciona a reposição?"}
      </button>
      {abrir && (
        <ul className="pt-repo-regras">
          <li>A reposição não é obrigatória e não temos vagas reservadas para ela.</li>
          <li>A vaga só existe quando outra aluna libera a aula dela com antecedência.</li>
          <li>Para o seu aviso virar crédito: avise com no mínimo <b>{regras.horasMin} horas</b> de antecedência. Se a aula for de manhã (antes das {regras.manhaAte}), avise até <b>23:59 do dia anterior</b>.</li>
          <li>São até <b>{regras.maxPorMes} reposições por mês</b>, mesmo que você libere mais aulas.</li>
          <li>O crédito vale até o <b>fim do mês seguinte</b> ao da aula que você liberou.</li>
          <li>É preciso estar com o curso em dia — mensalidade paga e inscrição ativa.</li>
        </ul>
      )}
    </div>
  );
}

function BookScreen({ data, busy, modo, onBack, onBook }) {
  const meta = data.meta || {};
  const byDay = {};
  data.available.forEach((s) => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  const days = Object.keys(byDay).sort();
  const saldo = (data.makeup && data.makeup.saldo) || 0;
  const titulo = { repor: "Escolha a aula de reposição", extra: "Escolha a aula extra", book: "Horários disponíveis" }[modo];
  const ajuda = {
    repor: <>Você tem <b>{saldo}</b> crédito{saldo === 1 ? "" : "s"}. Estes são os horários com vaga livre hoje — não há vaga reservada para reposição.</>,
    extra: <>Aula avulsa de <b>{money(meta.valorAvulsa ?? 40)}</b>, cobrada à parte da mensalidade. Não usa crédito de reposição.</>,
    book: "Toque no horário que você quer marcar.",
  }[modo];
  return (<>
    <button className="pt-link" onClick={onBack}>← Voltar</button>
    <h2 className="pt-h2">{titulo}</h2>
    <p className="pt-sub2" style={{ marginBottom: "1rem" }}>{ajuda}</p>
    {days.length ? days.map((d) => (
      <div className="pt-day" key={d}>
        <div className="pt-day-h">{fmtDateLong(d)}</div>
        {byDay[d].map((s) => (
          <button className="pt-slot" key={s.id} onClick={() => onBook(s)} disabled={busy}>
            <div><b>{faixaHorario(s.time, meta.duracaoAulaMin)}</b><span> · {s.unit} · com {s.prof}</span></div>
            <span className="pt-vagas">{s.free} vaga{s.free === 1 ? "" : "s"}</span>
          </button>
        ))}
      </div>
    )) : <div className="pt-empty">Não há horários livres no momento.<br />Fale com a Inêz no WhatsApp. 💚</div>}
  </>);
}
