import { useState, useEffect } from "react";
// "toast" abaixo é o aviso de erro global — apelidado porque o portal tem um
// estado local com o mesmo nome (que antes escondia esta função e quebrava os
// avisos de erro silenciosamente).
import { toast as toastErro, confirmModal } from "./toast.jsx";
import { api } from "./api.js";
import { WaIcon } from "./icons.jsx";
import PixQR from "./PixQR.jsx";
import { fmtDate, fmtDateLong, todayISO, addDays, waLink, money, faixaHorario, compLabel } from "./helpers.js";

const CPF_KEY = "fqc_portal_cpf";
// WhatsApp da escola: (31) 98496-6403 — sem o "55", que o waLink já acrescenta
const WA_ESCOLA = "31984966403";
const getStored = () => { try { return localStorage.getItem(CPF_KEY) || ""; } catch { return ""; } };
// chave do portal: prioriza CPF, cai para telefone, depois id
const portalKey = (c) => (c?.cpf || "").replace(/\D/g, "") || (c?.phone || "").replace(/\D/g, "") || String(c?.id || "");

// Dias inteiros entre duas datas 'YYYY-MM-DD' (sem fuso atrapalhar a conta)
const diasEntre = (de, ate) =>
  Math.round((new Date(ate + "T12:00:00Z") - new Date(de + "T12:00:00Z")) / 86400000);

// Segunda-feira da semana de uma data — usada apenas no filtro visual da agenda.
const segundaISO = (iso) => addDays(iso, -((new Date(iso + "T00:00").getDay() + 6) % 7));

function statusText(b) {
  if (b.status === "cancelada") return "Cancelada";
  if (b.attendance === "presente") return "Presente ✓";
  if (b.attendance === "falta") return "Faltou";
  return "Agendada";
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
  // Aulas que a aluna acabou de liberar nesta tela. A aula sai da lista na hora,
  // sem depender do recarregamento — se a resposta do servidor demorar (ou vier
  // atrasada), ela não fica olhando para uma aula que já cancelou.
  const [liberadasAgora, setLiberadasAgora] = useState({});
  /* O que ela está escolhendo no calendário:
     "normal" = aula do plano · "repor" = gasta 1 crédito · "extra" = usa a aula
     extra já paga. Era um booleano ("repondo") e virou modo quando a aula extra
     passou a ser comprada aqui dentro. */
  const [modo, setModo] = useState("normal");
  /* Recorte de "Minhas próximas aulas". A mensalista tem aula marcada semana a
     semana até onde a agenda foi montada — mostrar tudo virava uma parede de
     cartões iguais. Começa no MÊS: é o horizonte que ela realmente planeja, e
     sempre tem algo dentro (a semana pode estar vazia numa sexta à noite). */
  const [periodo, setPeriodo] = useState("mes"); // semana | mes | todas
  const marcarLiberada = (id, campos) => setLiberadasAgora((m) => ({ ...m, [id]: { status: "cancelada", ...campos } }));

  const load = async (p) => {
    setLoading(true); setErr("");
    try {
      const d = await api.portal.get(p);
      setData(d); setPhone(p);
    } catch (e) { setErr(e.message || "Não consegui carregar."); setData(null); }
    finally { setLoading(false); }
  };

  // Recarga silenciosa: atualiza os dados sem piscar a tela e, se a rede
  // tropeçar, não faz nada. O `load` acima zera `data` quando falha — o que
  // jogaria a aluna de volta para o login no meio de uma atualização de fundo.
  const refreshSilencioso = async (p = phone) => {
    try { setData(await api.portal.get(p)); } catch {}
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
    setAuthStep("phone"); setPin(""); setPinConfirm(""); setErr(""); setLiberadasAgora({});
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
  // O que ela liberou agora vale por cima do que veio do servidor, até o
  // recarregamento trazer o mesmo estado.
  const bookings = data.bookings.map((b) => (liberadasAgora[b.id] ? { ...b, ...liberadasAgora[b.id] } : b));
  const ativos = bookings.filter((b) => b.status !== "cancelada");
  const prox = ativos.filter((b) => b.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  /* Fim de cada recorte, sempre contando de HOJE para a frente:
     semana = até o domingo desta semana
     mês    = até o último dia do mês corrente */
  const fimDaSemana = addDays(segundaISO(t), 6);
  const fimDoMes = (() => {
    const [y, m] = t.split("-").map(Number);
    return `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  })();
  const limitePeriodo = periodo === "semana" ? fimDaSemana : periodo === "mes" ? fimDoMes : null;
  const proxFiltradas = limitePeriodo ? prox.filter((b) => b.date <= limitePeriodo) : prox;
  const PERIODOS = [
    ["semana", "Semana", prox.filter((b) => b.date <= fimDaSemana).length],
    ["mes", "Mês", prox.filter((b) => b.date <= fimDoMes).length],
    ["todas", "Todas", prox.length],
  ];
  const passadas = ativos.filter((b) => b.date < t).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  // Aulas que ela liberou (cancelou ou avisou que não vai): continuam visíveis
  // para ela ter certeza de que o aviso foi registrado.
  const liberadas = bookings
    .filter((b) => b.status === "cancelada" && b.date >= t)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const nome = ((data.client && data.client.name) || "").split(" ")[0] || "aluno(a)";
  const meta = data.meta || {};
  const cliente = data.client || {};
  // Regras do plano, calculadas pelo backend (sábado, 18h e a janela da escala).
  // Os horários que ela não pode marcar já vêm de fora da lista `available`; o
  // que sobra para a tela é explicar a janela da escala quando está fechada.
  const regras = data.regras || {};
  const mensalistaEscala = cliente.plan === "mensalista" && cliente.mensalistaTipo === "escala";
  const podeMarcarAulaNormal = cliente.plan !== "mensalista" || mensalistaEscala;
  const temGradeRegular = ativos.some((b) => b.date >= t && b.paymentMethod === "Mensalista");
  // Depois do Pix a aluna já é mensalista, mas ainda precisa escolher os 1 ou 2
  // padrões que serão reservados por 12 meses. Escala não monta grade: marca
  // cada ocorrência separadamente.
  const precisaMontarGrade = cliente.plan === "mensalista" && cliente.mensalistaTipo !== "escala" && !!cliente.weeklyFreq && !temGradeRegular;
  const podeConverter = (cliente.plan !== "mensalista" && cliente.matriculaStatus !== "devolvida") || precisaMontarGrade;

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
    try {
      const r = await api.portal.cancel(phone, b.id);
      marcarLiberada(b.id, {});           // sai da lista na hora
      setAbsenceFor((f) => (f === b.id ? null : f));
      flash(avisoLiberacao(r, "Aula cancelada."));
      await load(phone);
    } catch (e) { toastErro(e.message, "error"); } finally { setBusy(false); }
  };
  const doAbsence = async (b) => {
    setBusy(true);
    const motivo = absenceText.trim();
    try {
      const r = await api.portal.absence(phone, b.id, motivo);
      marcarLiberada(b.id, { absenceReason: motivo || "Avisou que não poderá ir" });
      flash(avisoLiberacao(r, "Aviso enviado. Obrigada por avisar! 💚"));
      setAbsenceFor(null); setAbsenceText("");
      await load(phone);
    } catch (e) { toastErro(e.message, "error"); } finally { setBusy(false); }
  };
  const doBook = async (slot) => {
    const quando = `${slot.unit}\n${fmtDateLong(slot.date)} às ${slot.time}`;
    const cfg = {
      repor: { title: "Confirmar reposição", message: `Usar 1 crédito de reposição nesta aula?\n\n${quando}`, confirmLabel: "Usar crédito", okMsg: "Reposição marcada! Te espero lá. 💚" },
      // A aula extra já está paga a esta altura — aqui ela só escolhe o horário.
      extra: { title: "Confirmar aula extra", message: `Usar a sua aula extra já paga neste horário?\n\n${quando}`, confirmLabel: "Marcar aula extra", okMsg: "Aula extra marcada! Te espero lá. 💚" },
      normal: {
        title: "Confirmar marcação",
        message: `Marcar somente esta aula em ${quando}?`,
        confirmLabel: "Marcar esta aula",
        okMsg: mensalistaEscala
          ? "Aula marcada! Esta marcação vale somente para a data escolhida. 💚"
          : "Aula marcada! Toque em “Pagar reserva” para confirmar. 💚",
      },
    }[modo];
    if (!(await confirmModal({ title: cfg.title, message: cfg.message, confirmLabel: cfg.confirmLabel }))) return;
    setBusy(true);
    try {
      await api.portal.book(phone, slot.id, data.client && data.client.name, modo);
      flash(cfg.okMsg);
      setModo("normal"); setScreen("home"); await load(phone);
    } catch (e) { toastErro(e.message, "error"); } finally { setBusy(false); }
  };
  // Leva a aluna até o calendário (que agora é onde se marca a aula)
  const irParaAgenda = () => {
    setScreen("home");
    setTimeout(() => document.getElementById("pt-agenda")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
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

      {screen === "enroll" ? (
        <EnrollScreen data={data} phone={phone} busy={busy} setBusy={setBusy} flash={flash} kiosk={kiosk}
          onBack={() => setScreen("home")} onDone={async () => { setScreen("home"); await load(phone); }} />
      ) : screen === "pay" && payBooking ? (
        <PaymentScreen booking={payBooking} meta={data.meta || {}} onBack={() => setScreen("home")} flash={flash} />
      ) : (<>
        <ProximaAulaCard booking={prox[0]} meta={meta} />

        <div className="pt-actions">
          {podeMarcarAulaNormal && (
            <button className="pt-big" onClick={() => { setModo("normal"); irParaAgenda(); }}>📅<span>Marcar nova aula</span></button>
          )}
          <a className="pt-big pt-big-wa" href={waLink(WA_ESCOLA, `Olá! Sou ${(data.client && data.client.name) || ""} e gostaria de falar sobre as minhas aulas. 💚`)} target="_blank" rel="noreferrer"><WaIcon size={26} /><span>Falar com a escola</span></a>
        </div>

        {podeConverter && <ContinuarCard cliente={cliente} meta={meta} montarGrade={precisaMontarGrade} onContinuar={() => setScreen("enroll")} />}

        <MensalidadeCard
          invoices={data.invoices}
          cliente={cliente}
          meta={meta}
          phone={phone}
          flash={flash}
          kiosk={kiosk}
          onPago={refreshSilencioso}
        />

        <RepoCard makeup={data.makeup} onRepor={() => { setModo("repor"); irParaAgenda(); }} />

        {cliente.plan === "mensalista" && cliente.status !== "cancelado" && (
          <AulaExtraCard
            extra={data.extra}
            valor={data.valorAulaExtra}
            phone={phone}
            flash={flash}
            onMudou={refreshSilencioso}
            onEscolherHorario={() => { setModo("extra"); irParaAgenda(); }}
          />
        )}

        <MiniAgenda
          bookings={ativos}
          available={data.available}
          unit={data.client && data.client.unit}
          meta={meta}
          regras={regras}
          podeMarcarNormal={podeMarcarAulaNormal}
          busy={busy}
          modo={modo}
          saldo={(data.makeup && data.makeup.saldo) || 0}
          onBook={doBook}
          onSairModo={() => setModo("normal")}
        />

        <h2 className="pt-h2">Minhas próximas aulas</h2>
        {/* Só aparece quando há mais aula do que cabe no recorte mais curto —
            senão o filtro seria um controle para não fazer nada. */}
        {prox.length > PERIODOS[0][2] && (
          <div className="pt-filtro">
            {PERIODOS.map(([k, label, n]) => (
              <button key={k} className={periodo === k ? "on" : ""} onClick={() => setPeriodo(k)}>
                {label} <span className="pt-filtro-n">{n}</span>
              </button>
            ))}
          </div>
        )}
        {proxFiltradas.length ? proxFiltradas.map((b) => (
          <div className="pt-aula" key={b.id}>
            <div className="pt-when"><b>{fmtDateLong(b.date)}</b><span>{b.time} · {b.unit}</span></div>
            <div className={`pt-status ${b.status}`}>{statusText(b)}</div>
            {/* A aula não se paga sozinha: ela já está dentro da mensalidade.
                Só a experimental (1ª mensalidade) e a aula extra têm valor
                próprio — o resto era o R$ 20 fantasma, fora desde 30/08/2026. */}
            {b.status === "aguardando" && b.value > 0 && (
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
        )) : prox.length ? (
          /* Tem aula marcada, só não neste recorte — dizer "você não tem aulas"
             aqui seria mentira e assustaria à toa. */
          <div className="pt-empty">
            Nenhuma aula {periodo === "semana" ? "no resto desta semana" : "no resto deste mês"}.<br />
            <button className="pt-link" onClick={() => setPeriodo("todas")}>Ver todas as {prox.length} aulas marcadas</button>
          </div>
        ) : <div className="pt-empty">Você não tem aulas marcadas.<br />Toque em <b>Marcar nova aula</b> para começar. 🧶</div>}

        {liberadas.length > 0 && (<>
          <h2 className="pt-h2">Aulas que você liberou</h2>
          {liberadas.map((b) => {
            const avisou = !!(b.absenceReason || "").trim();
            return (
              <div className="pt-aula pt-liberada" key={b.id}>
                <div className="pt-when"><b>{fmtDateLong(b.date)}</b><span>{b.time} · {b.unit}</span></div>
                <div className={`pt-status ${avisou ? "avisou" : "cancelada"}`}>
                  {avisou ? "🔔 Você avisou que não poderá ir" : "✕ Aula cancelada por você"}
                </div>
                {avisou && b.absenceReason !== "Avisou que não poderá ir" && (
                  <div className="pt-lib-motivo">“{b.absenceReason}”</div>
                )}
                <div className="pt-lib-ok">✓ Registrado — avisamos a escola e a vaga ficou livre.</div>
              </div>
            );
          })}
        </>)}

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
        <a className="pt-btn pt-btn-wa" href={waLink(WA_ESCOLA, `Olá! Fiz o Pix da reserva da minha aula de ${fmtDate(booking.date)} às ${booking.time} (${booking.unit}), no valor de ${money(booking.value)}. Segue o comprovante 👇`)} target="_blank" rel="noreferrer">📲 Já paguei — enviar comprovante</a>
      </>) : meta.pixKey ? (<>
        <div className="pt-pix">
          <div className="pt-pix-row"><span>Chave Pix</span><b>{meta.pixKey}</b></div>
          {meta.pixName ? <div className="pt-pix-row"><span>Recebedor</span><b>{meta.pixName}</b></div> : null}
          <button className="pt-pix-copy" onClick={copyPix}>📋 Copiar chave Pix</button>
        </div>
        <a className="pt-btn pt-btn-wa" href={waLink(WA_ESCOLA, `Olá! Fiz o Pix da reserva da minha aula de ${fmtDate(booking.date)} às ${booking.time} (${booking.unit}), no valor de ${money(booking.value)}. Segue o comprovante 👇`)} target="_blank" rel="noreferrer">📲 Já paguei — enviar comprovante</a>
      </>) : <div className="pt-empty" style={{ fontSize: "1rem" }}>A chave Pix ainda não foi cadastrada. Chame a gente no WhatsApp.</div>}
    </div>

    <div className="pt-pay">
      <div className="pt-pay-opt-h">💳 Pagar com cartão</div>
      <div className="pt-sub2" style={{ marginBottom: ".9rem" }}>Para pagar no cartão, chame a gente no WhatsApp que enviamos o link de pagamento. 💚</div>
      <a className="pt-btn" href={waLink(WA_ESCOLA, `Olá! Quero pagar no cartão a reserva da minha aula de ${fmtDate(booking.date)} às ${booking.time} (${booking.unit}), no valor de ${money(booking.value)}.`)} target="_blank" rel="noreferrer"><WaIcon /> Quero o link de pagamento no cartão</a>
    </div>

    <div className="pt-pay-note">🔒 Sua vaga é confirmada assim que o pagamento cair.</div>
  </>);
}

/* Calendário do portal: consulta e marcação no mesmo lugar.
   Cada dia mostra se ela tem aula e se sobrou vaga; ao tocar no dia, aparecem
   as aulas dela e os horários livres para marcar. */
function MiniAgenda({ bookings, available, unit, meta, regras, podeMarcarNormal, busy, modo, saldo, onBook, onSairModo }) {
  const t = todayISO();
  const [off, setOff] = useState(0);
  const [dia, setDia] = useState(null);
  const repondo = modo === "repor";
  const extrando = modo === "extra";
  // Mensalista escala: só marca a próxima aula NO DIA da aula dela. Sábado e os
  // horários a partir das 18h nem chegam aqui — o backend já não os manda.
  // Reposição e aula extra são sempre escolhas unitárias, fora da grade de 12 meses.
  const foraDoPlano = repondo || extrando;
  const janela = (regras && regras.janela) || { aberta: true, motivo: "" };
  const janelaFechada = !foraDoPlano && regras && regras.tipo === "escala" && !janela.aberta;

  const aulasPorDia = {};
  bookings.forEach((b) => { (aulasPorDia[b.date] = aulasPorDia[b.date] || []).push(b); });

  const gradeJaReservada = !foraDoPlano && !podeMarcarNormal;
  const vagasPorDia = {};
  (available || []).forEach((s) => { (vagasPorDia[s.date] = vagasPorDia[s.date] || []).push(s); });
  Object.values(vagasPorDia).forEach((a) => a.sort((x, y) => x.time.localeCompare(y.time)));
  Object.values(aulasPorDia).forEach((a) => a.sort((x, y) => x.time.localeCompare(y.time)));

  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + off);
  const y = base.getFullYear(), m = base.getMonth();
  const firstISO = new Date(y, m, 1).toISOString().slice(0, 10);
  const startDow = (new Date(firstISO + "T00:00").getDay() + 6) % 7;
  const gridStart = addDays(firstISO, -startDow);
  const dows = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const dd = new Date(date + "T00:00");
    const out = dd.getMonth() !== m;
    // dias de outro mês ficam só de enfeite na grade: sem marca e sem clique
    const minhas = out ? null : aulasPorDia[date];
    const vagas = !out && date >= t ? vagasPorDia[date] : null;
    const clicavel = !!(minhas || vagas);
    const titulo = [
      minhas ? `Sua aula: ${minhas.map((b) => b.time).join(", ")}` : "",
      vagas ? `${vagas.length} horário(s) com vaga` : "",
    ].filter(Boolean).join(" · ");
    cells.push(
      <div
        className={`mini-cell ${out ? "out" : ""} ${date === t ? "today" : ""} ${clicavel ? "clicavel" : ""} ${dia === date ? "sel" : ""}`}
        key={i} title={titulo}
        role={clicavel ? "button" : undefined} tabIndex={clicavel ? 0 : undefined}
        onClick={clicavel ? () => setDia(dia === date ? null : date) : undefined}
        onKeyDown={clicavel ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDia(dia === date ? null : date); } } : undefined}
      >
        <span>{dd.getDate()}</span>
        <span className="mini-marks">
          {minhas ? <span className={`mini-dot ${date >= t ? "up" : "past"}`} /> : null}
          {vagas ? <span className="mini-dot livre" /> : null}
        </span>
      </div>
    );
  }
  const label = base.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const minhasDoDia = dia ? aulasPorDia[dia] || [] : [];
  const vagasDoDia = dia && dia >= t ? vagasPorDia[dia] || [] : [];
  const bloqueioDoDia = dia
    ? janelaFechada
      ? janela.motivo
      : gradeJaReservada
        ? "Sua grade regular já está reservada por 12 meses. Cancelamentos, reposições e aulas extras são feitos uma aula por vez."
        : ""
    : "";

  return (
    <div className="mini-agenda" id="pt-agenda">
      <div className="mini-head">
        <button className="mini-nav" onClick={() => { setOff(off - 1); setDia(null); }} aria-label="Mês anterior">←</button>
        <b>Minha agenda{unit ? ` · ${unit}` : ""} — {label.charAt(0).toUpperCase() + label.slice(1)}</b>
        <button className="mini-nav" onClick={() => { setOff(off + 1); setDia(null); }} aria-label="Próximo mês">→</button>
      </div>

      {repondo && (
        <div className="mini-repo-aviso">
          🔁 Escolhendo a sua <b>aula de reposição</b> — você tem {saldo} crédito{saldo === 1 ? "" : "s"}.
          <button className="pt-link" onClick={onSairModo}>Deixar para depois</button>
        </div>
      )}

      {extrando && (
        <div className="mini-repo-aviso" style={{ borderLeftColor: "var(--green-mid)" }}>
          ➕ Escolhendo o horário da sua <b>aula extra já paga</b> — ela não ocupa vaga das aulas do seu plano.
          <button className="pt-link" onClick={onSairModo}>Deixar para depois</button>
        </div>
      )}

      {janelaFechada && (
        <div className="mini-repo-aviso" style={{ borderLeftColor: "var(--warn)" }}>
          🗓️ {janela.motivo}
        </div>
      )}

      {gradeJaReservada && (
        <div className="mini-dica">
          Sua grade regular foi reservada por <b>12 meses</b>. Para alterar uma data, cancele somente aquela aula e use a reposição individual.
        </div>
      )}

      <div className="mini-grid">
        {dows.map((d, i) => <div className="mini-dow" key={i}>{d}</div>)}
        {cells}
      </div>
      <div className="mini-legend">
        <span><span className="mini-dot up" /> Sua aula</span>
        <span><span className="mini-dot past" /> Aula realizada</span>
        <span><span className="mini-dot livre" /> Tem vaga</span>
      </div>

      {dia ? (
        <div className="mini-dia">
          <div className="mini-dia-h">{fmtDateLong(dia)}</div>
          {minhasDoDia.length > 0 && (
            <div className="mini-dia-bloco">
              <div className="mini-dia-t">Sua aula neste dia</div>
              {minhasDoDia.map((b) => (
                <div className="mini-minha" key={b.id}>
                  <b>{faixaHorario(b.time, meta.duracaoAulaMin)}</b>
                  <span>{b.unit} · {statusText(b)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mini-dia-bloco">
            <div className="mini-dia-t">{vagasDoDia.length ? "Horários com vaga" : "Sem vaga livre neste dia"}</div>
            {vagasDoDia.length ? (
              <>
                <div className="mini-vagas">
                  {vagasDoDia.map((s) => (
                    <button className="pt-time" key={s.id} onClick={() => onBook(s)} disabled={busy || !!bloqueioDoDia}
                      title={bloqueioDoDia || undefined}>
                      {faixaHorario(s.time, meta.duracaoAulaMin)}
                      <small>{s.unit} · {s.free} vaga{s.free === 1 ? "" : "s"}</small>
                    </button>
                  ))}
                </div>
                {bloqueioDoDia && <div className="pt-sub2" style={{ marginTop: ".5rem" }}>{bloqueioDoDia}</div>}
              </>
            ) : (
              <div className="pt-sub2">Toque em outro dia marcado com o ponto verde ou chame a gente no WhatsApp. 💚</div>
            )}
          </div>
          <button className="pt-link" onClick={() => setDia(null)}>Fechar o dia</button>
        </div>
      ) : (
        <div className="mini-dica">Toque em um dia do calendário para ver a sua aula e os horários com vaga.</div>
      )}
    </div>
  );
}

/* Convite para continuar no curso, mostrado a quem fez a experimental. */
function ContinuarCard({ cliente, meta, montarGrade = false, onContinuar }) {
  const jaPagou = cliente.matriculaStatus === "paga";
  return (
    <div className="pt-repo" style={{ borderLeftColor: "var(--terracota)" }}>
      <div className="pt-repo-top">
        <div>
          <div className="pt-repo-t">🧵 {montarGrade ? "Montar minha grade" : "Continuar com a gente"}</div>
          <div className="pt-sub2">
            {montarGrade
              ? `Escolha ${cliente.weeklyFreq} horário${cliente.weeklyFreq > 1 ? "s" : ""} semanal${cliente.weeklyFreq > 1 ? "is" : ""}. As aulas serão reservadas automaticamente por 12 meses.`
              : "Gostou da aula experimental? Escolha o seu plano, pague a primeira mensalidade e monte a sua grade de 12 meses."}
          </div>
          {jaPagou && <div className="pt-sub2" style={{ marginTop: ".4rem" }}>✅ A sua primeira mensalidade já está paga — não cobramos de novo.</div>}
        </div>
      </div>
      <button className="pt-btn" style={{ marginTop: ".8rem" }} onClick={onContinuar}>{montarGrade ? "Escolher meus horários" : "Quero continuar"}</button>
    </div>
  );
}

/* Escolha do plano → 1ª aula oficial → 1ª mensalidade. É o fluxo do tablet da sala. */
function EnrollScreen({ data, phone, busy, setBusy, flash, kiosk, onBack, onDone }) {
  const meta = data.meta || {};
  const gradeDoPlanoPago = data.client?.plan === "mensalista" && !!data.client?.weeklyFreq;
  const [freq, setFreq] = useState(gradeDoPlanoPago ? Number(data.client.weeklyFreq) : null);
  const [slotsEscolhidos, setSlotsEscolhidos] = useState([]); // 1 ou 2 padrões semanais
  const [resultado, setResultado] = useState(null);
  const t = todayISO();

  const planos = [
    { freq: 1, valor: meta.valorPlano1x ?? 120, titulo: "1x por semana", detalhe: "4 aulas no mês" },
    { freq: 2, valor: meta.valorPlano2x ?? 200, titulo: "2x por semana", detalhe: "8 aulas no mês" },
  ];
  const byDay = {};
  (data.available || [])
    .filter((s) => s.date >= t)
    /* Toda turma futura entra. Havia aqui um filtro que escondia o sábado, para
       a aluna não escolher uma data que levaria erro na confirmação — as duas
       regras de data (sábado e 18h) saíram do plano em 30/08 e 26/08/2026, e a
       1ª aula oficial pode cair em qualquer turma da grade. */
    .forEach((s) => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  const days = Object.keys(byDay).sort();

  const confirmar = async () => {
    if (slotsEscolhidos.length !== freq) return flash(`Escolha ${freq} horário${freq > 1 ? "s" : ""} semanal${freq > 1 ? "is" : ""}.`);
    const resumo = slotsEscolhidos
      .map((s) => `• ${fmtDateLong(s.date)} às ${s.time}, em ${s.unit}`)
      .join("\n");
    if (!(await confirmModal({
      title: "Confirmar matrícula",
      message: `Plano de ${freq}x por semana — ${money(planos.find((p) => p.freq === freq).valor)} por mês.\n\n` +
        `Sua grade semanal:\n${resumo}\n\n` +
        `Esses horários serão reservados automaticamente por 12 meses. Em feriado a escola não abre, ` +
        `então esses dias ficam de fora da grade — eles não geram crédito de reposição.`,
      confirmLabel: "Confirmar",
    }))) return;
    setBusy(true);
    try {
      const r = await api.portal.enroll(phone, { weeklyFreq: freq, slotIds: slotsEscolhidos.map((s) => s.id) });
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
      {resultado.grade?.total > 0 && (
        <div className="pt-fc-resume">
          📅 <b>{resultado.grade.total} aulas regulares reservadas</b> para os próximos 12 meses.
          {resultado.grade.feriados?.length ? <> {resultado.grade.feriados.length} data(s) de feriado ficaram sem aula — nesses dias a escola não abre.</> : null}
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
    <h2 className="pt-h2">{gradeDoPlanoPago ? "Escolha os horários da sua grade" : "Escolha o seu plano"}</h2>
    {gradeDoPlanoPago ? (
      <div className="pt-fc-resume">Seu plano já está confirmado: <b>{freq}x por semana</b> · {money(planos.find((p) => p.freq === freq).valor)}/mês.</div>
    ) : (
      <div className="pt-unit-pick">
        {planos.map((p) => (
          <button key={p.freq} className={`pt-unit-card ${freq === p.freq ? "on" : ""}`} onClick={() => { setFreq(p.freq); setSlotsEscolhidos([]); }}>
            <div className="ic">🧶</div><b>{p.titulo}</b>
            <span>{p.detalhe}</span>
            <span className="pt-plano-val">{money(p.valor)}/mês</span>
          </button>
        ))}
      </div>
    )}

    {freq && (<>
      <h2 className="pt-h2">Monte a sua grade semanal</h2>
      <p className="pt-sub2" style={{ marginBottom: "1rem" }}>
        Escolha {freq} horário{freq > 1 ? "s" : ""}. A grade será repetida automaticamente por <b>12 meses</b>.
      </p>
      {days.length ? days.map((d) => (
        <div className="pt-day" key={d}>
          <div className="pt-day-h">{fmtDateLong(d)}</div>
          {byDay[d].map((s) => (
            <button key={s.id} className={`pt-slot ${slotsEscolhidos.some((x) => x.id === s.id) ? "on" : ""}`} onClick={() => {
              setSlotsEscolhidos((atuais) => {
                if (atuais.some((x) => x.id === s.id)) return atuais.filter((x) => x.id !== s.id);
                if (atuais.length >= freq) return [...atuais.slice(1), s];
                return [...atuais, s];
              });
            }}>
              <div><b>{faixaHorario(s.time, meta.duracaoAulaMin)}</b><span> · {s.unit}</span></div>
              <span className="pt-vagas">{s.free} vaga{s.free === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      )) : <div className="pt-empty">Não há horários livres no momento.<br />Chame a gente no WhatsApp. 💚</div>}
    </>)}

    {freq && slotsEscolhidos.length === freq && (
      <button className="pt-btn" onClick={confirmar} disabled={busy}>
        {busy ? "Confirmando…" : `Confirmar plano ${freq}x e grade de 12 meses →`}
      </button>
    )}
  </>);
}

/* Contagem para a próxima aula — o primeiro cartão que ela vê ao entrar. */
function ProximaAulaCard({ booking, meta }) {
  if (!booking) {
    return (
      <div className="pt-next pt-next-off">
        <div className="pt-next-l">Nenhuma aula marcada</div>
        <div className="pt-next-d">Escolha um dia no calendário abaixo e garanta a sua vaga. 🧶</div>
      </div>
    );
  }
  const dias = diasEntre(todayISO(), booking.date);
  const chamada = dias <= 0 ? "É hoje!" : dias === 1 ? "É amanhã!" : `Faltam ${dias} dias`;
  const complemento = dias <= 0 ? "Te espero lá! 💚" : dias === 1 ? "Já pode separar o material. 💚" : "Se programe! 💚";
  return (
    <div className="pt-next">
      <div className="pt-next-n">{dias <= 0 ? "hoje" : dias}</div>
      <div>
        <div className="pt-next-l">{chamada} para a sua próxima aula</div>
        <div className="pt-next-d">
          <b>{fmtDateLong(booking.date)}</b> · {faixaHorario(booking.time, meta.duracaoAulaMin)}
          {booking.unit ? <> · 📍 {booking.unit}</> : null}
        </div>
        <div className="pt-next-s">{complemento}</div>
      </div>
    </div>
  );
}

/* Mensalidade: onde a aluna encontra o Pix do mês.
   As cobranças nascem sozinhas alguns dias antes do vencimento (ver
   rodadaMensalidades no server) — este cartão é a vitrine delas, mais o botão de
   gerar um código novo quando o anterior expirou no vencimento. */
function MensalidadeCard({ invoices, cliente, meta, phone, flash, kiosk, onPago }) {
  const [pixNovo, setPixNovo] = useState({}); // { [invoiceId]: pixCode } reemitidos nesta tela
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");
  const [verHistorico, setVerHistorico] = useState(false);

  const t = todayISO();
  const lista = invoices || [];
  // A mais antiga em aberto é a que ela precisa pagar primeiro.
  const abertas = lista
    .filter((i) => i.status === "pendente")
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
  const atual = abertas[0];
  const pagas = lista.filter((i) => i.status === "pago");

  // Mensalidade antiga não tem pixExpiresOn: nela a validade era o vencimento.
  const validoAte = (i) => i.pixExpiresOn || i.dueDate;
  /* Só mostramos o QR guardado se ele ainda vale E se cobra o valor certo. Um QR
     emitido antes de a multa entrar cobraria menos do que a conta mostrada logo
     acima dele — melhor pedir um novo (`pixAtualizado` vem do backend). */
  const pixGuardadoServe = (i) => i.pixCode && validoAte(i) >= t && i.pixAtualizado !== false;
  const pixCode = atual ? pixNovo[atual.id] || (pixGuardadoServe(atual) ? atual.pixCode : null) : null;

  // Com o QR na tela a confirmação chega sozinha pelo webhook do Sicredi.
  // Recarregar de tempos em tempos faz o "pago ✓" aparecer sem ela tocar em nada.
  useEffect(() => {
    if (!pixCode) return;
    let voltas = 0;
    const id = setInterval(() => {
      if (++voltas > 30) { clearInterval(id); return; } // ~10 min e desiste
      onPago();
    }, 20000);
    return () => clearInterval(id);
  }, [pixCode]);

  // Aluna avulsa que nunca teve mensalidade não precisa ver o assunto.
  if (cliente.plan !== "mensalista" && !lista.length) return null;

  const gerarPix = async () => {
    setGerando(true); setErro("");
    try {
      const inv = await api.portal.invoicePix(phone, atual.id);
      if (inv.pixCode) {
        setPixNovo((m) => ({ ...m, [atual.id]: inv.pixCode }));
        flash("Código Pix atualizado! 💚");
        onPago && onPago(); // recarrega a mensalidade para a conta bater com o QR
      }
      else setErro("Não consegui gerar o código agora. Chame a gente no WhatsApp. 💚");
    } catch (e) {
      setErro(e.message || "Não consegui gerar o código agora.");
    } finally { setGerando(false); }
  };

  const atrasada = !!atual && atual.dueDate < t;
  const diasAtraso = atrasada ? diasEntre(atual.dueDate, t) : 0;
  const original = atual ? atual.amountCents / 100 : 0;
  /* Em atraso, o que se paga é o total COM multa e juros — e é esse valor que o
     Pix cobra. O backend manda a conta pronta em `encargos`; sem ela (resposta
     antiga em cache) cai no valor original, em vez de mostrar número errado. */
  const enc = atual && atual.encargos;
  const valor = enc ? enc.total : original;
  const msgComprovante = atual
    ? `Olá! Fiz o Pix da mensalidade de ${compLabel(atual.competencia)}, no valor de ${money(valor)}. Segue o comprovante 👇`
    : "";

  return (
    <div className="pt-repo" style={{ borderLeftColor: atrasada ? "var(--danger)" : atual ? "var(--warn)" : "var(--green-mid)" }}>
      <div className="pt-repo-top">
        <div>
          <div className="pt-repo-t">💠 Minha mensalidade</div>
          {atual ? (
            <div className="pt-sub2">
              <b className="pt-no-caps">{compLabel(atual.competencia)}</b> · vence em <b>{fmtDate(atual.dueDate)}</b>
            </div>
          ) : (
            <div className="pt-sub2">
              Você está em dia — nenhuma mensalidade em aberto. 💚
              {cliente.plan === "mensalista" && <> A próxima chega aqui sozinha, com vencimento no dia {meta.vencimentoDia || 10}.</>}
            </div>
          )}
        </div>
        {atual && <div className="pt-mens-val">{money(valor)}</div>}
      </div>

      {atual && (
        <div className={`pt-mens-status ${atrasada ? "atraso" : "aberta"}`}>
          {atrasada
            ? `⚠️ Em atraso há ${diasAtraso} ${diasAtraso === 1 ? "dia" : "dias"}`
            : atual.dueDate === t
              ? "Vence hoje"
              : `Em aberto — faltam ${diasEntre(t, atual.dueDate)} dia(s) para o vencimento`}
        </div>
      )}

      {/* A conta aberta: ninguém deve descobrir o acréscimo só ao abrir o QR. */}
      {enc && enc.atrasada && (
        <div className="pt-pix" style={{ marginTop: ".7rem" }}>
          <div className="pt-pix-row"><span>Mensalidade</span><b>{money(original)}</b></div>
          <div className="pt-pix-row"><span>Multa por atraso</span><b>{money(enc.multa)}</b></div>
          <div className="pt-pix-row"><span>Juros ({enc.dias} {enc.dias === 1 ? "dia" : "dias"})</span><b>{money(enc.juros)}</b></div>
          <div className="pt-pix-row" style={{ borderTop: "1px solid var(--line)", paddingTop: ".5rem", marginTop: ".2rem" }}>
            <span><b>Total a pagar</b></span><b style={{ color: "var(--danger)" }}>{money(enc.total)}</b>
          </div>
        </div>
      )}

      {abertas.length > 1 && (
        <div className="pt-sub2" style={{ marginTop: ".5rem" }}>
          Você tem <b>{abertas.length} mensalidades em aberto</b>. Comece por esta, a mais antiga.
        </div>
      )}

      {/* Mensalidade combinada direto com a escola: o mês anterior teve baixa
          manual, então esta nasceu sem Pix. Nada de QR nem de botão que falharia —
          a aluna vê o combinado dela e o caminho do WhatsApp. */}
      {atual && atual.semPix ? (
        <>
          <p className="pt-hint" style={{ marginTop: ".8rem" }}>
            Esta mensalidade está combinada direto com a escola — não há Pix para ela.
            Qualquer dúvida sobre o pagamento, é só chamar a gente. 💚
          </p>
          <a className="pt-btn pt-btn-wa" href={waLink(WA_ESCOLA, `Olá! Queria falar sobre a minha mensalidade de ${atual ? compLabel(atual.competencia) : ""}. 💚`)} target="_blank" rel="noreferrer">
            <WaIcon size={20} /> Falar com a escola
          </a>
        </>
      ) : atual && (pixCode ? (<>
        <PixQR code={pixCode} size={kiosk ? 300 : 230} legenda="Aponte a câmera do seu celular para pagar" />
        <details className="pt-pix-det">
          <summary>Prefiro copiar o código</summary>
          <div className="pt-pix-code">{pixCode}</div>
          <button className="pt-pix-copy" onClick={async () => {
            try { await navigator.clipboard.writeText(pixCode); flash("Código Pix copiado! 📋"); }
            catch { flash("Não consegui copiar. Use o QR Code."); }
          }}>📋 Copiar código Pix</button>
        </details>
        <p className="pt-hint">A baixa é automática: assim que o Pix cair, esta tela mostra “pago”. 💚</p>
        <a className="pt-btn pt-btn-wa" href={waLink(WA_ESCOLA, msgComprovante)} target="_blank" rel="noreferrer">
          <WaIcon size={20} /> Já paguei — enviar comprovante
        </a>
      </>) : (<>
        {/* O Sicredi expira a cobrança no fim do dia do vencimento, então quem
            atrasa precisa de um código novo — é este botão. */}
        <p className="pt-hint" style={{ marginTop: ".8rem" }}>
          {!atual.pixCode
            ? "O código Pix ainda não foi gerado para esta mensalidade."
            : enc && enc.atrasada
              ? "O código Pix precisa ser atualizado com a multa e os juros. Gere um novo para pagar o valor certo."
              : "O código Pix desta mensalidade expirou no vencimento. Gere um novo para pagar agora."}
        </p>
        {erro && <div className="pt-err">{erro}</div>}
        <button className="pt-btn" onClick={gerarPix} disabled={gerando}>
          {gerando ? "Gerando…" : "💠 Gerar código Pix"}
        </button>
        {meta.pixKey && (
          <details className="pt-pix-det">
            <summary>Prefiro pagar na chave Pix</summary>
            <div className="pt-pix">
              <div className="pt-pix-row"><span>Chave Pix</span><b>{meta.pixKey}</b></div>
              {meta.pixName ? <div className="pt-pix-row"><span>Recebedor</span><b>{meta.pixName}</b></div> : null}
              <div className="pt-pix-row"><span>Valor</span><b>{money(valor)}</b></div>
            </div>
            <a className="pt-btn pt-btn-wa" href={waLink(WA_ESCOLA, msgComprovante)} target="_blank" rel="noreferrer">
              <WaIcon size={20} /> Enviar comprovante
            </a>
          </details>
        )}
      </>))}

      {pagas.length > 0 && (<>
        <button className="pt-link" style={{ marginTop: ".8rem" }} onClick={() => setVerHistorico(!verHistorico)}>
          {verHistorico ? "Ocultar o histórico" : `Ver as ${pagas.length} mensalidade${pagas.length === 1 ? "" : "s"} já paga${pagas.length === 1 ? "" : "s"}`}
        </button>
        {verHistorico && (
          <div className="pt-mens-hist">
            {pagas.map((i) => (
              <div className="pt-mens-linha" key={i.id}>
                <span className="pt-no-caps">{compLabel(i.competencia)}</span>
                <b>{money(i.amountCents / 100)}</b>
                {/* paidAt aceita data ou timestamp completo — o corte garante 'YYYY-MM-DD' */}
                <span className="pt-mens-ok">✓ pago{i.paidAt ? ` em ${fmtDate(String(i.paidAt).slice(0, 10))}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </>)}
    </div>
  );
}

/* Saldo e regras de reposição — só aparece para quem é mensalista. */
/* ===================== Aula extra (comprada no portal) =====================
   A aluna paga o Pix primeiro e só depois escolhe o horário — o calendário só
   abre quando o Sicredi confirma. Enquanto espera, a tela consulta o status a
   cada 5s; o webhook é o caminho normal, mas a consulta também pergunta ao
   banco, então um webhook atrasado não deixa ninguém preso aqui. */
const EXTRA_POLL_MS = 5000;

function AulaExtraCard({ extra, valor, phone, flash, onMudou, onEscolherHorario }) {
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState(extra || null);
  useEffect(() => { setPass(extra || null); }, [extra]);

  const pendente = pass && pass.status === "pendente";
  const pago = pass && pass.status === "pago";

  // Enquanto o Pix não cai, pergunta de tempos em tempos. Para sozinho quando
  // confirma (ou quando o card sai da tela).
  useEffect(() => {
    if (!pendente) return;
    let vivo = true;
    const id = setInterval(async () => {
      try {
        const r = await api.portal.extraStatus(phone);
        if (!vivo) return;
        if (r && r.status !== "pendente") {
          setPass(r.status === "nenhum" ? null : r);
          if (r.status === "pago") flash("Pagamento confirmado! Agora é só escolher o horário. 💚");
          onMudou && onMudou();
        }
      } catch { /* rede instável: tenta de novo no próximo tique */ }
    }, EXTRA_POLL_MS);
    return () => { vivo = false; clearInterval(id); };
  }, [pendente, phone]);

  const comprar = async () => {
    if (!(await confirmModal({
      title: "Comprar aula extra",
      message: `Aula extra por ${money(valor || 0)}.\n\n` +
        "Antes de continuar, dois avisos:\n" +
        "• A aula extra NÃO gera crédito de reposição — se você não puder ir, ela não é reposta.\n" +
        "• O valor NÃO é devolvido.\n\n" +
        "Depois de pagar o Pix, você escolhe o dia e o horário.",
      confirmLabel: "Gerar o Pix",
    }))) return;
    setBusy(true);
    try {
      const r = await api.portal.extraCheckout(phone);
      setPass(r);
      if (r.jaPago) flash("Você já tem uma aula extra paga esperando horário. 💚");
      onMudou && onMudou();
    } catch (e) { toastErro(e.message, "error"); } finally { setBusy(false); }
  };

  const desistir = async () => {
    if (!(await confirmModal({
      title: "Cancelar a compra",
      message: "Cancelar esta cobrança de aula extra?\n\nSe você já pagou o Pix, não cancele — chame a gente no WhatsApp.",
      confirmLabel: "Cancelar a cobrança", cancelLabel: "Voltar", tone: "danger",
    }))) return;
    setBusy(true);
    try { await api.portal.extraCancelar(phone); setPass(null); onMudou && onMudou(); }
    catch (e) { toastErro(e.message, "error"); } finally { setBusy(false); }
  };

  return (
    <div className="pt-repo" style={{ borderLeftColor: "var(--green-mid)" }}>
      <div className="pt-repo-top">
        <div>
          <div className="pt-repo-t">➕ Aula extra</div>
          <div className="pt-sub2">
            {pago ? "Sua aula extra está paga! Escolha o dia e o horário."
              : pendente ? "Assim que o seu Pix cair, o calendário abre para você escolher o horário."
              : "Quer praticar mais, além das aulas do seu plano? Compre uma aula extra por aqui."}
          </div>
        </div>
        {!pendente && <div className="pt-pay-val">{money(valor || 0)}</div>}
      </div>

      {pago ? (
        <button className="pt-btn" style={{ marginTop: ".8rem" }} onClick={onEscolherHorario}>
          📅 Escolher o horário da minha aula extra
        </button>
      ) : pendente ? (<>
        {pass.pixCode ? (<>
          <PixQR code={pass.pixCode} size={220} legenda="Aponte a câmera do seu celular para pagar" />
          <details className="pt-pix-det">
            <summary>Prefiro copiar o código</summary>
            <div className="pt-pix-code">{pass.pixCode}</div>
            <button className="pt-pix-copy" onClick={() => navigator.clipboard?.writeText(pass.pixCode)}>📋 Copiar código Pix</button>
          </details>
        </>) : (
          <div className="pt-sub2" style={{ marginTop: ".8rem" }}>Gerando o seu Pix…</div>
        )}
        <div className="pt-sub2" style={{ marginTop: ".8rem" }}>
          ⏳ Aguardando a confirmação do pagamento… Esta tela se atualiza sozinha, pode deixar aberta.
        </div>
        <button className="pt-link" style={{ marginTop: ".6rem" }} onClick={desistir} disabled={busy}>
          Cancelar esta cobrança
        </button>
      </>) : (<>
        <div className="pt-sub2" style={{ marginTop: ".8rem" }}>
          ⚠️ A aula extra <b>não gera crédito de reposição</b> e o <b>valor não é devolvido</b>.
        </div>
        <button className="pt-btn" style={{ marginTop: ".8rem" }} onClick={comprar} disabled={busy}>
          {busy ? "Gerando o Pix…" : `Comprar aula extra · ${money(valor || 0)}`}
        </button>
        <a className="pt-link" style={{ display: "block", marginTop: ".6rem", textAlign: "center" }} target="_blank" rel="noreferrer"
          href={waLink(WA_ESCOLA, "Olá! Tenho uma dúvida sobre a aula extra. 💚")}>
          Prefiro falar com a escola antes
        </a>
      </>)}
    </div>
  );
}

function RepoCard({ makeup, onRepor }) {
  const [abrir, setAbrir] = useState(false);
  if (!makeup) return null;
  // aluna avulsa não tem reposição: não polui o portal dela com o assunto
  if (!makeup.elegivel && /mensalistas/.test(makeup.motivo || "")) return null;

  const { saldo, elegivel, motivo, regras } = makeup;
  const disponiveis = (makeup.creditos || []).filter((c) => c.situacao === "disponivel");
  const proximo = disponiveis.map((c) => c.expiresOn).sort()[0];
  // Créditos que já existem mas cuja aula ainda não chegou: só valem depois dela.
  const aguardando = makeup.aguardando || 0;
  // Mesmo com crédito na mão, são no máximo 2 reposições dentro do mesmo mês.
  const mes = makeup.mes || {};
  const noLimite = (mes.restantes ?? regras.maxPorMes) <= 0;

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
          {elegivel && aguardando > 0 && (
            <div className="pt-sub2">
              ⏳ {aguardando === 1 ? "Mais 1 crédito seu ainda está esperando" : `Mais ${aguardando} créditos seus ainda estão esperando`} a aula acontecer
              {makeup.aguardandoDesde ? <> — dá para marcar a partir de <b>{fmtDate(makeup.aguardandoDesde)}</b>.</> : "."}
            </div>
          )}
          {elegivel && saldo > 0 && noLimite && (
            <div className="pt-sub2">Você já marcou as <b>{regras.maxPorMes} reposições deste mês</b>. Guarde o crédito para o mês que vem ou chame a gente no WhatsApp. 💚</div>
          )}
        </div>
        <div className={`pt-repo-n ${saldo > 0 && elegivel ? "on" : ""}`}>{elegivel ? saldo : "—"}</div>
      </div>

      {elegivel && saldo > 0 && !noLimite && (
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
          <li>São até <b>{regras.maxPorMes} reposições por mês</b>: no máximo {regras.maxPorMes} créditos por mês e no máximo {regras.maxPorMes} aulas de reposição marcadas dentro do mesmo mês.</li>
          <li>O crédito vale até o <b>fim do mês seguinte</b> ao da aula que você liberou.</li>
          <li>A reposição é marcada <b>depois que a data da aula liberada passa</b> — repor é remarcar uma aula que deixou de acontecer, não adiantar a próxima.</li>
          <li><b>Não se repõe a reposição:</b> se você liberar a sua aula de reposição, o crédito se encerra ali.</li>
          <li>A aula de reposição <b>não ocupa</b> vaga das aulas do seu plano na semana.</li>
          <li>É preciso estar com a inscrição ativa.</li>
        </ul>
      )}
    </div>
  );
}

/* A antiga tela de lista de horários saiu: a marcação passou a acontecer no
   próprio calendário (MiniAgenda), sem trocar de tela — assim o "voltar" nunca
   tira a aluna do portal. */
