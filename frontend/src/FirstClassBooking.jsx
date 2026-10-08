import { useState, useEffect } from "react";
import { api } from "./api.js";
import { todayISO, addDays, fmtDate, fmtDateLong, money, capitalize, fimDaAula, validarCPF, formatarCPF, waLink, mesmaSemana, aulasSeChocam, PLANOS_MENSALISTA, FREQ_MAX_ESCALA, valorPlanoMeta } from "./helpers.js";

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

   3x e 4x por semana só existem no fixo (23/09/2026). */
function EscolhaDePlano({
  modalidade,
  setModalidade,
  tipo,
  setTipo,
  onModalidadeChange,
  valorAvulsa,
  valorDoPlano,
  taxa = 0,
  duracaoMin = 120,
}) {
  /* "Só a avulsa mesmo?" (Inêz, 08/10/2026): tocar em AVULSO abre a conta do
     preço por aula na escala (1x e 2x) antes de trocar. Mesma mensagem do
     robô do WhatsApp (textoConfirmarAvulsa no backend). */
  const [perguntaAvulsa, setPerguntaAvulsa] = useState(false);
  const comparativo = PLANOS_MENSALISTA
    .filter((p) => p.freq <= FREQ_MAX_ESCALA)
    .map((p) => ({ ...p, valor: Number(valorDoPlano(p.freq)) || 0 }))
    .filter((p) => p.valor > 0)
    .map((p) => ({ ...p, porAula: Math.round((p.valor / p.aulasMes) * 100) / 100 }));
  const horas = Number(duracaoMin) / 60;
  const duracao = Number.isInteger(horas) ? `${horas} hora${horas === 1 ? "" : "s"}` : `${duracaoMin} minutos`;
  const escolherAvulsa = () => { setPerguntaAvulsa(false); setModalidade("avulso"); onModalidadeChange?.("avulso"); };

  const Opcao = ({ on, onClick, titulo, linhas, preco, alerta }) => (
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
      {alerta && (
        <div style={{ fontSize: ".84rem", color: "var(--danger)", fontWeight: 600, marginTop: ".35rem" }}>
          {alerta}
        </div>
      )}
    </button>
  );

  return (
    <div style={{ marginTop: "1.4rem" }}>
      <label className="pt-label">Como você quer fazer as suas aulas?</label>
      
      {/* 1. AVULSO */}
      <Opcao
        on={modalidade === "avulso"}
        onClick={() => { if (modalidade !== "avulso") setPerguntaAvulsa(true); }}
        titulo="🧺 AVULSO"
        linhas="Aula avulsa única, sem mensalidade nem taxa de matrícula."
        preco={money(valorAvulsa)}
        alerta="OBS: não devolveremos o valor da aula avulsa em caso de falta."
      />

      {/* 2. MENSAIS — 1x a 4x (3x e 4x desde 23/09/2026, só no fixo) */}
      {PLANOS_MENSALISTA.map((p) => {
        const v = valorDoPlano(p.freq);
        return (
          <Opcao
            key={p.freq}
            on={modalidade === `mensal${p.freq}`}
            onClick={() => {
              setModalidade(`mensal${p.freq}`);
              // escala só existe em 1x e 2x: quem escolhe 3x/4x é fixo
              if (p.freq > FREQ_MAX_ESCALA) setTipo("fixo");
              onModalidadeChange?.(`mensal${p.freq}`);
            }}
            titulo={`📅 MENSAL ${p.freq}X POR SEMANA`}
            linhas={taxa > 0 ? `${p.aulasMes} aulas por mês · 1º pagamento: ${money(v + taxa)}` : `${p.aulasMes} aulas por mês`}
            preco={`${money(v)}/mês`}
          />
        );
      })}

      {modalidade !== "avulso" && (
        <div style={{ marginTop: "1.1rem", padding: ".9rem", background: "rgba(28,94,51,.03)", border: "1px solid var(--line)", borderRadius: 10 }}>
          <label className="pt-label" style={{ marginTop: 0, marginBottom: ".4rem" }}>Regra de agendamento:</label>
          <Opcao
            on={tipo === "fixo"} onClick={() => setTipo("fixo")}
            titulo="Fixo"
            linhas="Você tem sempre o mesmo dia e horário na semana, já reservados para você. É só chegar."
          />
          {Number(modalidade.replace("mensal", "")) > FREQ_MAX_ESCALA ? (
            <div style={{ padding: ".7rem 1rem", marginBottom: ".55rem", borderRadius: 12, border: "2px dashed var(--line)", color: "var(--muted)", fontSize: ".9rem" }}>
              <b>Escala</b> — disponível só nos planos de 1x e 2x por semana. No plano de {modalidade.replace("mensal", "")}x os seus horários ficam fixos.
            </div>
          ) : (
            <Opcao
              on={tipo === "escala"} onClick={() => setTipo("escala")}
              titulo="Escala"
              linhas="Você escolhe a aula durante a semana, marcando a próxima no dia da sua aula. Bom para quem tem a semana variável."
            />
          )}
          {/* Aqui dizia "de segunda a sexta, até as 18h" — as duas regras saíram
              do plano (18h em 26/08, sábado em 30/08/2026). */}
          <div className="pt-hint" style={{ marginTop: ".3rem" }}>
            {taxa > 0
              ? <>Você paga a <b>primeira mensalidade agora</b>, junto da <b>taxa de matrícula de {money(taxa)}</b> (uma vez só). A próxima mensalidade vence <b>no mês que vem</b>, no mesmo dia — e daí em diante é só a mensalidade.</>
              : <>Você paga a <b>primeira mensalidade agora</b> e a próxima só vence <b>no mês que vem</b>, no mesmo dia — e todo mês nesse dia.</>}
          </div>
        </div>
      )}

      {perguntaAvulsa && (
        <div className="overlay" onClick={() => setPerguntaAvulsa(false)}>
          <div className="pt-card" role="dialog" aria-modal="true" style={{ maxWidth: 460, width: "100%", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>🧺 Só a aula avulsa mesmo?</h3>
            <p>Você quer pagar <b>somente a aula avulsa</b> ({money(valorAvulsa)} por uma aula de {duracao})?</p>
            {comparativo.length > 0 && (<>
              <p>Temos também a opção de <b>mensalista na escala</b>: toda semana você agenda a sua próxima aula, nos dias e horários disponíveis — e cada aula fica mais em conta:</p>
              <ul style={{ margin: ".3rem 0 0 1.1rem", padding: 0 }}>
                {comparativo.map((p) => (
                  <li key={p.freq} style={{ marginBottom: ".3rem" }}>
                    <b>{p.freq}x por semana</b> — {money(p.valor)}/mês ÷ {p.aulasMes} aulas = <b style={{ color: "var(--green-deep)" }}>{money(p.porAula)} por aula</b>
                  </li>
                ))}
              </ul>
            </>)}
            <p className="pt-hint" style={{ marginTop: ".8rem" }}>Se quiser continuar como aluna depois da avulsa, é só pagar a matrícula e a mensalidade normalmente. 💚</p>
            <button type="button" className="pt-btn" style={{ marginTop: "1rem" }} onClick={() => setPerguntaAvulsa(false)}>💚 Ver os planos</button>
            <button type="button" className="pt-btn pt-btn-out" style={{ width: "100%", marginTop: ".6rem" }} onClick={escolherAvulsa}>🧺 Quero só a avulsa</button>
          </div>
        </div>
      )}

      {modalidade === "avulso" && (
        <div className="pt-hint" style={{ marginTop: ".4rem", color: "var(--terracota)" }}>
          🧺 <b>Aula avulsa:</b> você paga {money(valorAvulsa)} hoje referente a esta aula. Não há cobrança de taxa de matrícula nem mensalidade recorrente.
        </div>
      )}
    </div>
  );
}

/* Os demais horários da semana, no plano 2x a 4x: todos na MESMA semana da 1ª
   aula e na mesma unidade. Some da lista o que já foi escolhido e o que se
   sobrepõe, no mesmo dia, a uma aula dela (manhã e tarde no mesmo dia vale).
   É com esses horários que a grade de 12 meses é montada quando o Pix cai. */
function horariosDaSemanaPossiveis(available, firstSlot, escolhidos, dur) {
  const ja = [firstSlot, ...escolhidos];
  return available.filter((s) =>
    s.unit === firstSlot.unit &&
    mesmaSemana(s.date, firstSlot.date) &&
    !ja.some((j) => j.id === s.id) &&
    !ja.some((j) => j.date === s.date && aulasSeChocam(j.time, s.time, dur)));
}

function PtAgendaSemana({ available, firstSlot, value = [], onChange, quantos, dur }) {
  if (!firstSlot || quantos < 1) return null;
  const possiveis = horariosDaSemanaPossiveis(available, firstSlot, value, dur);
  const falta = quantos - value.length;
  const proxima = value.length + 2; // posição da aula que ela escolhe agora

  const byDay = {};
  possiveis.forEach((s) => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  Object.values(byDay).forEach((arr) => arr.sort((a, b) => a.time.localeCompare(b.time)));
  const days = Object.keys(byDay).sort();

  return (
    <div style={{ marginTop: "1.2rem", padding: "1.1rem", background: "rgba(28,94,51,.04)", border: "1.5px solid var(--green-mid, #2d7a46)", borderRadius: 12 }}>
      <div style={{ fontWeight: 700, color: "var(--green-deep, #1c5e33)", marginBottom: ".35rem", display: "flex", alignItems: "center", gap: ".4rem", fontSize: "1rem" }}>
        <span>🗓️</span> {quantos === 1 ? "Escolha sua 2ª aula na mesma semana" : `Escolha as outras ${quantos} aulas da semana`}
      </div>
      <div style={{ fontSize: ".88rem", color: "var(--muted)", marginBottom: ".85rem" }}>
        Para o plano de <b>{quantos + 1}x por semana</b>, escolha {quantos === 1 ? "o segundo horário" : `mais ${quantos} horários`} na mesma semana da primeira aula ({fmtDate(firstSlot.date)}).
        {" "}Eles se repetem toda semana.
      </div>

      {value.map((v, i) => (
        <div key={v.id} style={{ padding: ".6rem .9rem", marginBottom: ".45rem", background: "#fff", borderRadius: 8, border: "1.5px solid var(--green-deep, #1c5e33)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}>
          <div>
            <span style={{ color: "var(--green-deep)", fontWeight: 700 }}>✓ {i + 2}ª aula:</span>{" "}
            <b>{capitalize(fmtDateLong(v.date))} às {v.time}</b>
          </div>
          <button type="button" className="pt-link" style={{ fontSize: ".85rem", margin: 0 }} onClick={() => onChange(value.filter((x) => x.id !== v.id))}>
            Trocar
          </button>
        </div>
      ))}

      {falta > 0 && (days.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: ".75rem", marginTop: value.length ? ".6rem" : 0 }}>
          <div style={{ fontSize: ".9rem", fontWeight: 600 }}>Escolha a sua {proxima}ª aula:</div>
          {days.map((d) => (
            <div key={d} style={{ background: "#fff", padding: ".6rem .85rem", borderRadius: 8, border: "1px solid var(--line)" }}>
              <div style={{ fontSize: ".88rem", fontWeight: 600, color: "var(--terracota)", marginBottom: ".4rem" }}>
                {capitalize(fmtDateLong(d))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".45rem" }}>
                {byDay[d].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="pt-time"
                    onClick={() => onChange([...value, s])}
                    style={{ padding: ".4rem .85rem", fontSize: ".92rem" }}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: ".4rem", padding: ".85rem 1rem", borderRadius: 10, background: "#fff3cd", color: "#856404", border: "1px solid #ffeeba", fontSize: ".9rem", lineHeight: 1.45 }}>
          ⚠️ Não há mais horários com vaga nesta mesma semana na unidade {firstSlot.unit}.
          {" "}Você pode seguir com {value.length ? "os horários escolhidos" : "a primeira aula"}: a escola combina com você {falta > 1 ? `os outros ${falta} horários` : "o horário que falta"} pelo WhatsApp.
        </div>
      ))}
    </div>
  );
}

export default function FirstClassBooking({ onBack, fromSite }) {
  const [meta, setMeta] = useState({ units: [], pixKey: "", pixName: "" });
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true);
  // Esta tela marca a PRIMEIRA aula da aluna e a matricula no mesmo passo:
  // ela escolhe unidade, horário e plano e paga a 1ª mensalidade. As aulas
  // seguintes ela marca sozinha pela área do aluno.
  const [step, setStep] = useState("unit"); // unit | cal1 | pay | done
  const [unit, setUnit] = useState(null);
  const [slot, setSlot] = useState(null); // horário da primeira aula
  const [extras, setExtras] = useState([]); // demais horários da semana, no plano 2x a 4x

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  /* Modalidade escolhida: "avulso" | "mensal1" … "mensal4".
     Para mensalista: tipo (fixo/escala). */
  const [modalidade, setModalidade] = useState("mensal1");
  const [tipo, setTipo] = useState("escala");
  const isAvulso = modalidade === "avulso";
  const freq = isAvulso ? 1 : (Number(modalidade.replace("mensal", "")) || 1);

  const [booking, setBooking] = useState(null);
  const [inscricao, setInscricao] = useState(null); // { valorMensal, primeiroVencimento }
  const [pix, setPix] = useState(null);   // { code } do Sicredi, ou null (fallback chave estática)
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3800); };

  /* Código de promoção (campanha da escola). A prévia vem do servidor — é lá
     que a conta é feita — e é refeita quando ela troca de plano, porque o
     desconto depende do plano. A vaga na campanha só é ocupada ao gerar o Pix. */
  const [codigo, setCodigo] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return (p.get("cupom") || p.get("voucher") || p.get("codigo") || p.get("c") || "").trim().toUpperCase();
    } catch { return ""; }
  });
  const [voucher, setVoucher] = useState(null); // { codigo, beneficios, descricao, pagamento }
  const [erroVoucher, setErroVoucher] = useState("");
  const [validando, setValidando] = useState(false);

  const valorPlano = (f) => valorPlanoMeta(meta, f);
  const valorAvulsa = meta.valorAvulsa ?? 40;
  const mensalidade = isAvulso ? valorAvulsa : valorPlano(freq);
  const taxa = isAvulso ? 0 : Math.max(0, Number(meta.taxaMatricula) || 0);
  const pv = voucher?.pagamento || null; // 1º pagamento com o código, pelo servidor
  const mensalidadeHoje = pv && !isAvulso ? pv.mensalidade : mensalidade;
  const taxaHoje = pv && !isAvulso ? pv.taxa : taxa;
  const total = pv ? pv.total : isAvulso ? valorAvulsa : (mensalidade + taxa);

  const validarCodigo = async (cod, mod = modalidade, silencioso = false) => {
    const c = String(cod || "").trim();
    if (!c) return;
    const avulsa = mod === "avulso";
    const cpfDig = cpf.replace(/\D/g, "");
    setValidando(true); setErroVoucher("");
    try {
      const r = await api.vouchers.validar({
        codigo: c, modalidade: avulsa ? "avulso" : "mensal",
        weeklyFreq: avulsa ? null : (Number(mod.replace("mensal", "")) || 1),
        unit: slot?.unit || unit, cpf: cpfDig,
      });
      setVoucher(r);
      if (!silencioso) flash("Código aplicado! 🎟️");
    } catch (e) {
      /* Código só de aula experimental com um plano mensal escolhido: em vez
         de só recusar, troca para a opção AVULSO, que é onde ele vale. */
      if (!avulsa && /AVULSO/.test(e.message || "")) {
        try {
          const r = await api.vouchers.validar({ codigo: c, modalidade: "avulso", unit: slot?.unit || unit, cpf: cpfDig });
          setModalidade("avulso"); setExtras([]); setVoucher(r);
          flash("Este código é da aula experimental — mudamos para a opção AVULSO. 🎟️");
          return;
        } catch { /* fica o erro original */ }
      }
      setVoucher(null);
      setErroVoucher(e.message || "Não consegui conferir o código.");
    } finally { setValidando(false); }
  };
  // trocou de plano com um código aplicado: refaz a conta para o plano novo
  useEffect(() => {
    if (voucher && !booking) validarCodigo(voucher.codigo, modalidade, true);
  }, [modalidade]);

  // Se o código veio pela URL, valida assim que entrar no passo de pagamento
  useEffect(() => {
    if (codigo && !voucher && !booking && step === "pay") {
      validarCodigo(codigo, modalidade, true);
    }
  }, [step, codigo]);

  const loadAvail = async (u) => {
    setLoading(true);
    try { const r = await api.availableSlots(u); setAvailable(r.available); setMeta(r.meta); }
    catch (e) { flash(e.message || "Não consegui carregar os horários."); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadAvail(); }, []);

  const stepNum = { unit: 1, cal1: 2, pay: 3, done: 4 }[step];

  // Passo 3: gera a cobrança da 1ª mensalidade ou aula avulsa (Sicredi) e cria a reserva provisória
  const gerarPix = async () => {
    if (!name.trim() || phone.replace(/\D/g, "").length < 10) return flash("Preencha seu nome e WhatsApp com DDD.");
    const cpfLimpo = cpf.replace(/\D/g, "");
    if (!validarCPF(cpfLimpo)) return flash("Informe um CPF válido (verifique os números digitados).");
    if (!/\S+@\S+\.\S+/.test(email.trim())) return flash("Informe um email válido.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return flash("Informe a sua data de nascimento.");
    if (birthday >= todayISO()) return flash("A data de nascimento precisa ser no passado.");
    if (!isAvulso && tipo === "escala" && freq > FREQ_MAX_ESCALA)
      return flash(`O plano de ${freq}x por semana é só com horário fixo.`);
    /* Faltou escolher horário da semana: só deixa seguir se a semana não tem
       mais nenhum com vaga — aí a escola combina com ela (e a ficha avisa). */
    if (!isAvulso && extras.length < freq - 1 &&
        horariosDaSemanaPossiveis(available, slot, extras, meta.duracaoAulaMin).length) {
      const falta = freq - 1 - extras.length;
      return flash(`Escolha ${falta > 1 ? `mais ${falta} horários` : "mais 1 horário"} na mesma semana para o plano de ${freq}x por semana.`);
    }
    setBusy(true);
    try {
      const b = booking || await api.createBooking({
        clientName: name.trim(), phone: phone.trim(), cpf: cpf.trim(), email: email.trim(), birthday,
        unit: slot.unit, slotId: slot.id,
        extraSlotIds: isAvulso ? [] : extras.slice(0, freq - 1).map((s) => s.id),
        firstClass: true,
        plan: isAvulso ? "avulso" : "mensalista",
        modalidade: isAvulso ? "avulso" : "mensal",
        value: isAvulso ? valorAvulsa : undefined,
        weeklyFreq: isAvulso ? null : freq,
        mensalistaTipo: isAvulso ? null : tipo,
        voucher: voucher?.codigo || undefined,
      });
      if (!booking) window.metaTrack?.("Lead", { content_name: isAvulso ? "aula avulsa" : "matricula", value: total, currency: "BRL" }, `lead-${b.id}`);
      setBooking(b);
      /* O código zerou o pagamento: o servidor já confirmou a vaga (não existe
         Pix de R$ 0), então vai direto para o "tudo certo". */
      if (b.pago) {
        setInscricao(b.matricula || null);
        setStep("done");
        flash("Vaga confirmada! 🎉");
        return;
      }
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

  // Consulta a API Pix do Sicredi para checar se o pagamento foi confirmado
  const verificarPagamento = async (silencioso = false) => {
    if (!booking?.id) return;
    if (!silencioso) setBusy(true);
    try {
      const r = await api.payBooking(booking.id, {});
      if (r?.pago || r?.paid) {
        setInscricao(r?.matricula || null);
        setStep("done");
        flash("Pagamento aprovado pelo banco! Sua vaga está garantida. 🎉");
      }
    } catch (e) {
      if (!silencioso) {
        flash(e.message || "Pagamento Pix ainda não identificado. Aguarde alguns instantes e tente novamente.");
      }
    } finally {
      if (!silencioso) setBusy(false);
    }
  };

  // Anúncios: pagamento aprovado = Purchase. O backend manda o mesmo eventID (metaCapi.js).
  useEffect(() => {
    if (step === "done" && booking?.id) window.metaTrack?.("Purchase", { value: total, currency: "BRL" }, `purchase-${booking.id}`);
  }, [step, booking?.id]);

  // Polling suave a cada 5s enquanto o Pix estiver na tela para reconhecer o pagamento automático
  useEffect(() => {
    if (step !== "pay" || !pix || !booking?.id) return;
    let vivo = true;
    const t = setInterval(async () => {
      if (!vivo) return;
      try {
        const r = await api.payBooking(booking.id, {});
        if (vivo && (r?.pago || r?.paid)) {
          setInscricao(r?.matricula || null);
          setStep("done");
          flash("Pagamento aprovado pelo banco! Sua vaga está garantida. 🎉");
        }
      } catch {
        // Silencioso durante a espera
      }
    }, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [step, pix, booking?.id]);

  const restart = () => {
    setStep("unit"); setUnit(null); setSlot(null); setExtras([]);
    setName(""); setPhone(""); setCpf(""); setEmail(""); setBirthday("");
    setModalidade("mensal1"); setTipo("escala"); setBooking(null); setInscricao(null); setPix(null);
    setCodigo(""); setVoucher(null); setErroVoucher("");
    loadAvail();
  };

  return (
    <div className="pt-bg">
      <div className="pt-container">
        {toast && <div className="pt-toast">{toast}</div>}
        <div className="pt-fc-head">
          <img src="/logo-1.PNG" className="pt-logo" alt="Fios que Curam" />
          <h1>{isAvulso ? "Sua aula avulsa" : "Sua matrícula"}</h1>
          {step !== "done" && (
            <div className="pt-steps">
              <span className={`pt-step ${stepNum >= 1 ? "on" : ""}`}>1 · Unidade</span>
              <span className={`pt-step ${stepNum >= 2 ? "on" : ""}`}>2 · Horário</span>
              <span className={`pt-step ${stepNum >= 3 ? "on" : ""}`}>3 · {isAvulso ? "Opção e pagamento" : "Plano e pagamento"}</span>
            </div>
          )}
        </div>

        {/* 1 · UNIDADE */}
        {step === "unit" && (
          <div className="pt-card">
            <h2 className="pt-h2" style={{ marginTop: 0 }}>Escolha a unidade</h2>
            <div className="pt-unit-pick">
              {meta.units.map((u) => (
                <button key={u} className="pt-unit-card" onClick={() => { setUnit(u); setSlot(null); setExtras([]); loadAvail(u); setStep("cal1"); }}>
                  <div className="ic">📍</div><b>{u}</b><span>Aulas presenciais</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 2 · HORÁRIO (calendário) */}
        {step === "cal1" && (
          <div className="pt-card">
            <button className="pt-link" onClick={() => { setStep("unit"); setUnit(null); setExtras([]); }}>← Trocar unidade ({unit})</button>
            <h2 className="pt-h2">Escolha o dia e o horário</h2>
            {loading ? <div className="pt-cal-empty">Carregando horários…</div>
              : <PtAgenda available={available} value={slot} onPick={(s) => { setSlot(s); setExtras([]); setStep("pay"); }} />}
          </div>
        )}

        {/* 3 · PAGAMENTO (Pix) */}
        {step === "pay" && slot && (
          <div className="pt-card">
            <button className="pt-link" onClick={() => { setStep("cal1"); setExtras([]); }}>← Trocar horário</button>
            <div className="pt-fc-resume">
              <div>📍 <b>{slot.unit}</b> · {isAvulso ? "Aula avulsa" : "1ª aula"}: {capitalize(fmtDateLong(slot.date))} · <b>{slot.time}</b></div>
              {!isAvulso && extras.map((x, i) => (
                <div key={x.id} style={{ marginTop: ".35rem", color: "var(--green-deep, #1c5e33)", fontWeight: 600 }}>
                  ➕ {i + 2}ª aula: {capitalize(fmtDateLong(x.date))} · <b>{x.time}</b>
                </div>
              ))}
            </div>

            <div className="pt-matricula" style={{ lineHeight: 1.55 }}>
              {!isAvulso ? (<>
                <p style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--green-deep)" }}>
                  Prontinho{name ? `, ${name.split(" ")[0]}` : ""}! 💚 Agora escolha a sua mensalidade:
                </p>
                <p style={{ margin: ".35rem 0" }}>
                  {PLANOS_MENSALISTA.map((p) => (
                    <span key={p.freq}>
                      {["", "1️⃣", "2️⃣", "3️⃣", "4️⃣"][p.freq]} <b>{p.freq}x por semana</b> — {money(valorPlano(p.freq))}/mês (1º pagamento: {money(valorPlano(p.freq) + (Number(meta.taxaMatricula) || 20))})<br />
                    </span>
                  ))}
                </p>
                <p style={{ margin: ".35rem 0" }}>
                  No primeiro pagamento entra a taxa de matrícula de {money(Number(meta.taxaMatricula) || 20)}, cobrada uma vez só. A partir do mês seguinte é só a mensalidade.
                </p>
                <p style={{ margin: ".35rem 0" }}>
                  A sua primeira aula já está inclusa. Se decidir não continuar depois dela, devolvemos a mensalidade inteira — só a taxa de matrícula não volta.
                </p>
              </>) : (<>
                <p style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--terracota)" }}>
                  🧺 Aula Avulsa — {money(valorAvulsa)}
                </p>
                <p style={{ margin: ".35rem 0" }}>
                  Esta reserva garante a sua aula avulsa individual. Não há taxa de matrícula nem mensalidade recorrente.
                </p>
                <p style={{ margin: ".35rem 0", color: "var(--danger)", fontWeight: 700 }}>
                  ⚠️ OBS: não devolveremos o valor da aula avulsa em caso de falta.
                </p>
              </>)}
            </div>

            {!isAvulso && (
              <div className="pt-atencao">
                <span className="t">⚠️ Atenção</span>
                Se você faltar, essa aula <b>não é remarcada</b> automaticamente — mas a sua mensalidade continua valendo,
                {tipo === "fixo"
                  ? <> e as <b>próximas aulas</b> já ficam reservadas para você, toda semana, nos mesmos horários. Até lá! 💛</>
                  : <> e as <b>próximas aulas</b> você marca normalmente pela área do aluno. Até lá! 💛</>}
              </div>
            )}

            {!pix ? (<>
              <label className="pt-label">Seu nome</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos te chamar?" />
              <label className="pt-label" style={{ marginTop: ".9rem" }}>Seu WhatsApp (com DDD)</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="31988880000" />
              <label className="pt-label" style={{ marginTop: ".9rem" }}>Seu CPF</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} inputMode="numeric" value={cpf} onChange={(e) => setCpf(formatarCPF(e.target.value))} placeholder="000.000.000-00" />
              <label className="pt-label" style={{ marginTop: ".9rem" }}>Seu email</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
              <label className="pt-label" style={{ marginTop: ".9rem" }}>Sua data de nascimento</label>
              <input className="pt-input" style={{ textAlign: "left", fontSize: "1.1rem" }} type="date" max={todayISO()} value={birthday} onChange={(e) => setBirthday(e.target.value)} />

              <EscolhaDePlano
                modalidade={modalidade} setModalidade={setModalidade}
                tipo={tipo} setTipo={setTipo}
                // trocar de plano muda quantos horários ela escolhe: recomeça a escolha
                onModalidadeChange={() => setExtras([])}
                valorAvulsa={valorAvulsa}
                valorDoPlano={valorPlano}
                // com código que isenta a matrícula, os textos do plano já saem sem a taxa
                taxa={taxaHoje}
                duracaoMin={meta.duracaoAulaMin}
              />

              {!isAvulso && freq > 1 && (
                <PtAgendaSemana
                  available={available}
                  firstSlot={slot}
                  value={extras}
                  onChange={setExtras}
                  quantos={freq - 1}
                  dur={meta.duracaoAulaMin}
                />
              )}

              {/* Cupom ou código de desconto: sempre visível para a aluna encontrar facilmente */}
              <div style={{ marginTop: "1.2rem" }}>
                {voucher ? (
                  <div style={{ padding: ".85rem 1rem", borderRadius: 12, border: "2px solid var(--green-deep)", background: "rgba(28,94,51,.06)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: ".5rem", alignItems: "baseline" }}>
                      <b style={{ color: "var(--green-deep)", fontSize: "1rem" }}>🎟️ Cupom {voucher.codigo} aplicado!</b>
                      <button type="button" className="pt-link" style={{ margin: 0, fontSize: ".85rem", color: "var(--danger, #c32)" }}
                        onClick={() => { setVoucher(null); setCodigo(""); setErroVoucher(""); }}>Remover</button>
                    </div>
                    {voucher.descricao && <div style={{ fontSize: ".92rem", marginTop: ".25rem" }}>{voucher.descricao}</div>}
                    <ul style={{ margin: ".35rem 0 0 1.1rem", fontSize: ".92rem", color: "var(--green-deep)", fontWeight: 600 }}>
                      {voucher.beneficios.map((t) => <li key={t}>{t}</li>)}
                    </ul>
                  </div>
                ) : (
                  <div style={{
                    padding: ".9rem 1rem",
                    borderRadius: 12,
                    border: "1.5px dashed var(--green-mid, #2d7a46)",
                    background: "rgba(28,94,51,.03)",
                  }}>
                    <label className="pt-label" style={{ marginTop: 0, marginBottom: ".4rem", display: "flex", alignItems: "center", gap: ".4rem", color: "var(--green-deep)", fontSize: ".95rem" }}>
                      <span>🎟️</span> <b>Tem um cupom ou código de desconto?</b>
                    </label>
                    <div style={{ display: "flex", gap: ".5rem" }}>
                      <input
                        className="pt-input"
                        style={{ textAlign: "left", fontSize: "1.05rem", textTransform: "uppercase", margin: 0, background: "#fff" }}
                        value={codigo}
                        onChange={(e) => { setCodigo(e.target.value.toUpperCase()); if (erroVoucher) setErroVoucher(""); }}
                        placeholder="Digite o código (ex: OUTUBRO100)"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); validarCodigo(codigo); } }}
                      />
                      <button
                        type="button"
                        className="pt-btn pt-btn-out"
                        style={{ width: "auto", margin: 0, padding: "0 1.15rem", whiteSpace: "nowrap", fontWeight: 700 }}
                        onClick={() => validarCodigo(codigo)}
                        disabled={validando || !codigo.trim()}
                      >
                        {validando ? "…" : "Aplicar"}
                      </button>
                    </div>
                    {erroVoucher && <div className="pt-err" style={{ marginTop: ".5rem" }}>{erroVoucher}</div>}
                  </div>
                )}
              </div>

              {/* O resumo do que vai ser cobrado fica ANTES do botão */}
              {!isAvulso && (taxa > 0 || pv) ? (
                <div className="pt-pix" style={{ marginTop: "1rem" }}>
                  <div className="pt-pix-row"><span>1ª mensalidade ({freq}x por semana)</span>
                    <b>{pv && mensalidadeHoje !== mensalidade ? <><s style={{ color: "var(--muted)", fontWeight: 400 }}>{money(mensalidade)}</s> {money(mensalidadeHoje)}</> : money(mensalidade)}</b></div>
                  {taxa > 0 && (
                    <div className="pt-pix-row"><span>Taxa de matrícula (uma vez só)</span>
                      <b>{pv && taxaHoje === 0 ? <><s style={{ color: "var(--muted)", fontWeight: 400 }}>{money(taxa)}</s> isenta 🎟️</> : money(taxaHoje)}</b></div>
                  )}
                  <div className="pt-pix-row"><span><b>Total a pagar hoje</b></span><b>{money(total)}</b></div>
                </div>
              ) : isAvulso ? (
                <div className="pt-pix" style={{ marginTop: "1rem" }}>
                  <div className="pt-pix-row"><span>🧺 Aula {pv && pv.total < valorAvulsa ? "experimental" : "Avulsa"}</span>
                    <b>{pv && pv.total < valorAvulsa ? <><s style={{ color: "var(--muted)", fontWeight: 400 }}>{money(valorAvulsa)}</s> {pv.total === 0 ? "grátis 🎟️" : money(pv.total)}</> : money(total)}</b></div>
                  <div className="pt-pix-row"><span>Taxa de matrícula</span><b>R$ 0,00 (não cobrada)</b></div>
                  <div className="pt-pix-row"><span><b>Total a pagar hoje</b></span><b>{money(total)}</b></div>
                </div>
              ) : null}

              <button className="pt-btn" onClick={gerarPix} disabled={busy || validando}>
                {busy ? "Gerando…" : total === 0 ? "Confirmar minha vaga →" : `Gerar Pix de ${money(total)} →`}
              </button>
            </>) : (<>
              <div className="pt-pay" style={{ borderLeftColor: "var(--green-mid)" }}>
                <div className="pt-pay-opt-h">💠 Pague com Pix</div>
                {pix.code ? (<>
                  <div className="pt-pix-row"><span>Pix copia-e-cola</span><b>{money(total)}</b></div>
                  <div className="pt-pix-code">{pix.code}</div>
                </>) : (<div className="pt-pix">
                  <div className="pt-pix-row"><span>Chave Pix</span><b>{meta.pixKey || "—"}</b></div>
                  {meta.pixName ? <div className="pt-pix-row"><span>Recebedor</span><b>{meta.pixName}</b></div> : null}
                  <div className="pt-pix-row"><span>Valor</span><b>{money(total)}</b></div>
                </div>)}
                <button className="pt-pix-copy" onClick={copyPix}>📋 Copiar {pix.code ? "código Pix" : "chave Pix"}</button>
              </div>
              {/* Na avulsa o quadro de cima já diz o valor e o aviso de falta — repetir aqui só alongava a tela */}
              {!isAvulso && (
                <div className="pt-fc-resume" style={{ textAlign: "left" }}>
                  🧵 Seu plano: <b>{tipo === "escala" ? "Escala" : "Fixo"} · {freq}x por semana</b> — {money(mensalidade)}/mês.<br />
                  {taxa > 0
                    ? <>Este Pix é a mensalidade deste mês ({money(mensalidadeHoje)}){taxaHoje > 0 ? <> mais a taxa de matrícula ({money(taxaHoje)})</> : <> — a taxa de matrícula ficou isenta pelo código</>}. A <b>próxima</b> vence no mês que vem, no mesmo dia de hoje.</>
                    : <>Este Pix é a mensalidade deste mês. A <b>próxima</b> só vence no mês que vem, no mesmo dia de hoje.</>}
                </div>
              )}
              {/* Sem o Pix do banco (só a chave fixa) o sistema não tem como ver o
                  pagamento: "verificar" não acharia nada. Aí o caminho é o comprovante. */}
              {pix.code && (
                <button className="pt-btn" onClick={() => verificarPagamento(false)} disabled={busy}>
                  {busy ? "Consultando banco… ⏳" : "🔍 Já fiz o Pix — verificar pagamento"}
                </button>
              )}
              <a
                className="pt-btn pt-btn-wa"
                style={{ marginTop: pix.code ? ".6rem" : undefined }}
                href={waLink("31984966403", `Olá! Fiz o Pix da ${isAvulso ? "minha aula avulsa" : "matrícula da minha primeira aula"} de ${fmtDate(slot?.date || "")} às ${slot?.time || ""} (${slot?.unit || ""}), no valor de ${money(total)}. Segue o comprovante 👇`)}
                target="_blank"
                rel="noreferrer"
              >
                📲 Enviar comprovante no WhatsApp
              </a>
              <p className="pt-hint">{pix.code
                ? "A baixa é automática: assim que o Pix for confirmado pelo banco, sua vaga fica garantida. Você também pode clicar no botão acima a qualquer momento para verificar. 💚"
                : "Depois de pagar, envie o comprovante no WhatsApp: a escola confere e confirma a sua vaga. 💚"}</p>

              <div style={{ marginTop: "1.3rem", paddingTop: ".9rem", borderTop: "1px dashed var(--line)", textAlign: "center" }}>
                <button
                  type="button"
                  className="pt-link"
                  style={{ fontSize: ".92rem", color: "var(--muted)", textDecoration: "underline", cursor: "pointer", margin: 0 }}
                  onClick={async () => {
                    if (booking?.id) {
                      try { await api.cancelPendingBooking(booking.id); } catch {}
                    }
                    setPix(null);
                    setBooking(null);
                  }}
                >
                  ← Esqueci de colocar o cupom / Alterar plano ou dados
                </button>
              </div>
            </>)}
          </div>
        )}

        {/* 4 · CONCLUÍDO */}
        {step === "done" && slot && (
          <div className="pt-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.6rem" }}>🎉</div>
            <h2 className="pt-h2" style={{ textAlign: "center" }}>Tudo certo, {name.split(" ")[0]}!</h2>
            <div className="pt-fc-resume" style={{ textAlign: "left" }}>
              <div>📍 <b>{slot.unit}</b></div>
              <div style={{ marginTop: ".25rem" }}>
                🗓 <b>{isAvulso ? "Aula avulsa:" : "1ª aula:"}</b> {capitalize(fmtDateLong(slot.date))} às <b>{slot.time}{meta.duracaoAulaMin ? ` às ${fimDaAula(slot.time, meta.duracaoAulaMin)}` : ""}</b>
              </div>
              {!isAvulso && extras.map((x, i) => (
                <div key={x.id} style={{ marginTop: ".25rem", color: "var(--green-deep, #1c5e33)" }}>
                  🗓 <b>{i + 2}ª aula:</b> {capitalize(fmtDateLong(x.date))} às <b>{x.time}{meta.duracaoAulaMin ? ` às ${fimDaAula(x.time, meta.duracaoAulaMin)}` : ""}</b>
                </div>
              ))}
            </div>
            <p className="pt-hint">{isAvulso ? "Sua vaga para a aula avulsa está garantida! 💚" : "Sua vaga está garantida e sua matrícula confirmada! 💚"}</p>

            {/* Chamada para o Portal da Aluna */}
            <div style={{
              margin: "1.2rem 0",
              padding: "1.2rem",
              background: "linear-gradient(135deg, rgba(28,94,51,.08) 0%, rgba(28,94,51,.02) 100%)",
              border: "2px solid var(--green-mid, #2d7a46)",
              borderRadius: 12,
              textAlign: "left"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".4rem" }}>
                <span style={{ fontSize: "1.4rem" }}>📱</span>
                <b style={{ color: "var(--green-deep, #1c5e33)", fontSize: "1.05rem" }}>Seu próximo passo: Acesse o Portal da Aluna</b>
              </div>
              <p style={{ margin: "0 0 .8rem 0", fontSize: ".93rem", color: "var(--ink)", lineHeight: 1.5 }}>
                Acesse o <b>Portal da Aluna</b> informando seu CPF e <b>cadastre seu PIN de 4 dígitos</b> (sua senha de acesso exclusiva). Pelo portal você visualiza suas aulas e informações! 💚
              </p>
              <button
                type="button"
                className="pt-btn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: ".5rem",
                  width: "100%",
                  padding: ".85rem 1rem",
                  fontSize: "1rem",
                  fontWeight: 700,
                  boxShadow: "0 4px 12px rgba(28,94,51,.25)",
                  cursor: "pointer"
                }}
                onClick={() => {
                  const onlyCpf = (cpf || "").replace(/\D/g, "");
                  if (onlyCpf) {
                    try { localStorage.setItem("fqc_portal_cpf", onlyCpf); } catch {}
                    window.location.href = "/portal?cpf=" + onlyCpf;
                  } else {
                    window.location.href = "/portal";
                  }
                }}
              >
                🔐 Acessar Portal da Aluna e cadastrar PIN →
              </button>
              <div style={{ marginTop: ".6rem", fontSize: ".82rem", color: "var(--muted)", textAlign: "center" }}>
                Link direto: <a href="/portal" style={{ color: "var(--green-deep)", fontWeight: 600, textDecoration: "underline" }}>fiosquecuram.com.br/portal</a>
              </div>
            </div>

            <div className="pt-matricula" style={{ textAlign: "left" }}>
              <p><b>{isAvulso ? "Sua aula avulsa" : "Seu plano"}</b></p>
              {isAvulso ? (<>
                <p>🧺 <b>Aula Avulsa individual</b> — {money(valorAvulsa)}.</p>
                <p>✅ Sua aula <b>já está confirmada{total > 0 ? " e paga" : ""}</b>.{voucher && total === 0 ? <> Cortesia do código <b>{voucher.codigo}</b>. 🎟️</> : null}</p>
                <p>⚠️ <b>OBS:</b> Lembramos que não devolveremos o valor da aula avulsa em caso de falta.</p>
              </>) : (<>
                <p>🧵 <b>{tipo === "escala" ? "Escala" : "Fixo"} · {freq}x por semana</b> — {money(inscricao?.valorMensal ?? mensalidade)}/mês.</p>
                <p>✅ A mensalidade deste mês <b>já está paga</b>.</p>
                {inscricao?.primeiroVencimento
                  ? <p>🗓 A próxima vence em <b>{fmtDate(inscricao.primeiroVencimento)}</b>, e todo mês nesse mesmo dia.</p>
                  : <p>🗓 A próxima vence no mês que vem, no mesmo dia de hoje — e todo mês nesse dia.</p>}
                {/* Fixo: a grade de 12 meses é montada quando o Pix cai — não há o
                    que marcar. Escala: ela marca cada aula pelo portal. */}
                {tipo === "fixo"
                  ? <p>📅 As próximas aulas <b>já estão reservadas</b> para você, toda semana, nos mesmos horários. Você acompanha tudo pela <b>área do aluno</b>, entrando com o seu CPF.</p>
                  : <p>📅 As próximas aulas você marca pela <b>área do aluno</b>, entrando com o seu CPF.</p>}
                {/* A regra (Vitor, 01/09/2026): desistindo depois da 1ª aula, a
                    MENSALIDADE volta inteira; a taxa de matrícula não. O texto
                    antigo dizia o contrário do topo desta mesma página. */}
                {voucher && <p>🎟️ Código <b>{voucher.codigo}</b>: {voucher.beneficios.join(" · ")}.</p>}
                {taxaHoje > 0
                  ? <p>💬 Se decidir não continuar depois da primeira aula, é só avisar: devolvemos a mensalidade de {money(mensalidadeHoje)} e cancelamos as próximas cobranças. Só a taxa de matrícula ({money(taxaHoje)}) não é devolvida.</p>
                  : <p>💬 Se decidir não continuar depois da primeira aula, é só avisar: devolvemos a mensalidade e cancelamos as próximas cobranças.</p>}
              </>)}
            </div>
            <button className="pt-link" onClick={restart}>Marcar outra aula</button>
          </div>
        )}

        {onBack && step !== "done" && <div style={{ textAlign: "center", marginTop: "1.5rem" }}><button className="pt-link" onClick={onBack}>{fromSite ? "← Voltar ao site" : "← Voltar ao painel"}</button></div>}
      </div>
    </div>
  );
}
