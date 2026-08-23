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
      {Object.keys(byDay).length === 0 && <div className="pt-cal-empty">Não há horários livres nesta unidade no momento.<br />Chame a gente no WhatsApp. 💚</div>}
      {selDay && (
        <div className="pt-times">
          <div className="pt-times-h">Horários em {capitalize(fmtDateLong(selDay))}</div>
          <div className="pt-times-grid">
            {dayslots.map((s) => (
              <button key={s.id} className={`pt-time ${value?.id === s.id ? "on" : ""}`} onClick={() => onPick(s)}>
                {s.time}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* Escolha do plano na hora da matrícula.

   São duas decisões independentes, e é isso que a tela precisa deixar claro —
   juntar as quatro combinações num cardápio só ("fixo 1x", "fixo 2x", "escala
   1x", "escala 2x") esconde que a diferença entre fixo e escala não tem nada a
   ver com quantas aulas ela faz:

   • FIXO   — o mesmo dia e horário toda semana, a escola deixa marcado para você.
   • ESCALA — ela escolhe a aula durante a semana, marcando a próxima no dia da
              aula dela.

   Em ambos: de segunda a sexta, até as 18h. */
function EscolhaDePlano({ tipo, setTipo, freq, setFreq, valor1x, valor2x }) {
  const Opcao = ({ on, onClick, titulo, linhas, preco }) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left", cursor: "pointer",
        padding: ".85rem 1rem", marginBottom: ".55rem", borderRadius: 12,
        border: `2px solid ${on ? "var(--green-deep)" : "var(--line)"}`,
        background: on ? "rgba(28,94,51,.07)" : "#fff",
        transition: "all .18s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: ".6rem" }}>
        <b style={{ color: on ? "var(--green-deep)" : "inherit" }}>{on ? "● " : "○ "}{titulo}</b>
        {preco && <span style={{ color: "var(--terracota)", fontWeight: 700, whiteSpace: "nowrap" }}>{preco}</span>}
      </div>
      <div style={{ fontSize: ".92rem", color: "var(--muted)", marginTop: ".25rem" }}>{linhas}</div>
    </button>
  );

  return (
    <div style={{ marginTop: "1.4rem" }}>
      <label className="pt-label">Como você quer fazer as suas aulas?</label>
      <Opcao
        on={tipo === "fixo"} onClick={() => setTipo("fixo")}
        titulo="Fixo"
        linhas="Você tem sempre o mesmo dia e horário na semana, já reservados para você. É só chegar."
      />
      <Opcao
        on={tipo === "escala"} onClick={() => setTipo("escala")}
        titulo="Escala"
        linhas="Você escolhe a aula durante a semana, marcando a próxima no dia da sua aula. Bom para quem tem a semana variável."
      />

      <label className="pt-label" style={{ marginTop: "1.1rem" }}>Quantas aulas por semana?</label>
      <Opcao
        on={Number(freq) === 1} onClick={() => setFreq(1)}
        titulo="1x por semana"
        linhas="4 aulas por mês"
        preco={`${money(valor1x)}/mês`}
      />
      <Opcao
        on={Number(freq) === 2} onClick={() => setFreq(2)}
        titulo="2x por semana"
        linhas="8 aulas por mês"
        preco={`${money(valor2x)}/mês`}
      />

      <div className="pt-hint" style={{ marginTop: ".2rem" }}>
        Nos dois casos as aulas são de segunda a sexta, até as 18h.
        A primeira mensalidade vence <b>no mês que vem</b>, no mesmo dia em que você pagar a matrícula — e todo mês nesse dia.
      </div>
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
  const [birthday, setBirthday] = useState("");
  /* Plano escolhido já aqui: tipo (fixo/escala) × frequência (1x/2x por semana).
     Pagando a taxa, ela sai desta tela matriculada nesse plano — a 1ª
     mensalidade cai no mês seguinte, no mesmo dia. */
  const [tipo, setTipo] = useState("fixo");
  const [freq, setFreq] = useState(1);

  const [booking, setBooking] = useState(null);
  const [inscricao, setInscricao] = useState(null); // { valorMensal, primeiroVencimento }
  const [pix, setPix] = useState(null);   // { code } do Sicredi, ou null (fallback chave estática)
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3800); };

  // taxa fixa de matrícula — a aula experimental em si é gratuita
  const matricula = meta.taxaMatricula ?? 20;
  const valorPlano = (f) => (Number(f) === 2 ? (meta.valorPlano2x ?? 200) : (meta.valorPlano1x ?? 120));
  const mensalidade = valorPlano(freq);

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return flash("Informe a sua data de nascimento.");
    if (birthday >= todayISO()) return flash("A data de nascimento precisa ser no passado.");
    setBusy(true);
    try {
      const b = booking || await api.createBooking({
        clientName: name.trim(), phone: phone.trim(), cpf: cpf.trim(), email: email.trim(), birthday,
        unit: slot.unit, slotId: slot.id, firstClass: true, // o valor vem da taxa de matrícula no servidor
        // plano escolhido: fica guardado como intenção e vira matrícula ao pagar
        weeklyFreq: freq, mensalistaTipo: tipo,
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
      // O servidor confirma a taxa E matricula a aluna no plano escolhido,
      // devolvendo em `matricula` o valor mensal e o 1º vencimento.
      const r = await api.payBooking(booking.id, { value: matricula });
      setInscricao(r?.matricula || null);
      setStep("done");
    } catch (e) { flash(e.message || "Erro ao confirmar."); }
    finally { setBusy(false); }
  };

  const restart = () => {
    setStep("unit"); setUnit(null); setSlot(null);
    setName(""); setPhone(""); setCpf(""); setEmail(""); setBirthday("");
    setTipo("fixo"); setFreq(1); setBooking(null); setInscricao(null); setPix(null);
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
            <div className="pt-fc-resume">📍 <b>{slot.unit}</b> · {capitalize(fmtDateLong(slot.date))} · <b>{slot.time}</b></div>

            <div className="pt-matricula">
              <p>A <b>aula experimental é gratuita</b> 💚 Para reservar a sua vaga, pedimos apenas a taxa de matrícula de <b>{money(matricula)}</b>.</p>
              <p>💬 Fez a aula e não quis continuar? <b>Devolvemos os {money(matricula)} integralmente</b>, depois da aula — e nada é cobrado.</p>
              <p>🧵 Quis continuar? Esse valor já fica como a sua <b>matrícula</b> — você não paga de novo.</p>
            </div>
            <div className="pt-atencao">
              <span className="t">⚠️ Atenção</span>
              A aula experimental é <b>uma só</b>: se você faltar, ela não é remarcada e o valor da matrícula não é devolvido.
              Mas a sua <b>primeira aula oficial</b> você marca normalmente pela área do aluno. Até lá! 💛
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
              <label className="pt-label" style={{ marginTop: ".9rem" }}>Sua data de nascimento</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} type="date" max={todayISO()} value={birthday} onChange={(e) => setBirthday(e.target.value)} />

              <EscolhaDePlano
                tipo={tipo} setTipo={setTipo}
                freq={freq} setFreq={setFreq}
                valor1x={meta.valorPlano1x ?? 120}
                valor2x={meta.valorPlano2x ?? 200}
              />

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
              <div className="pt-fc-resume" style={{ textAlign: "left" }}>
                🧵 Seu plano: <b>{tipo === "escala" ? "Escala" : "Fixo"} · {freq}x por semana</b> — {money(mensalidade)}/mês.<br />
                A primeira mensalidade só vence <b>no mês que vem</b>, no mesmo dia de hoje.
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
              ⏰ <b>{slot.time}{meta.duracaoAulaMin ? ` às ${fimDaAula(slot.time, meta.duracaoAulaMin)}` : ""}</b>
            </div>
            <p className="pt-hint">Sua aula experimental está reservada e você já está cadastrada 💛</p>
            <div className="pt-matricula" style={{ textAlign: "left" }}>
              <p><b>Seu plano</b></p>
              <p>🧵 <b>{tipo === "escala" ? "Escala" : "Fixo"} · {freq}x por semana</b> — {money(inscricao?.valorMensal ?? mensalidade)}/mês.</p>
              {inscricao?.primeiroVencimento
                ? <p>🗓 A primeira mensalidade vence em <b>{fmtDate(inscricao.primeiroVencimento)}</b>, e todo mês nesse mesmo dia.</p>
                : <p>🗓 A primeira mensalidade vence no mês que vem, no mesmo dia de hoje — e todo mês nesse dia.</p>}
              <p>📅 Depois da experimental, você marca as suas aulas pela <b>área do aluno</b>, entrando com o seu CPF.</p>
              <p>💬 Se preferir não seguir, é só avisar depois da aula: devolvemos os {money(matricula)} integralmente e cancelamos a mensalidade — você não paga nada.</p>
            </div>
            <button className="pt-link" onClick={restart}>Marcar outra aula</button>
          </div>
        )}

        {onBack && step !== "done" && <div style={{ textAlign: "center", marginTop: "1.5rem" }}><button className="pt-link" onClick={onBack}>{fromSite ? "← Voltar ao site" : "← Voltar ao painel"}</button></div>}
      </div>
    </div>
  );
}
