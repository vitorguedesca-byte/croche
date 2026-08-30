import { useState, useRef, useEffect } from "react";
import { Modal, useModal, StatusBadge, Select } from "./ui.jsx";
import { WaIcon } from "./icons.jsx";
import { useStore } from "./store.jsx";
import { api } from "./api.js";
import { toast, confirmModal, promptModal } from "./toast.jsx";
import {
  UNITS, PROFS, TAG_OPTIONS, VALOR_PADRAO, CAPACITY_PADRAO,
  unitColor, unitSoft, todayISO, fmtDate, fmtDateLong, money, waLink, capitalize, faixaHorario, hhmm,
  slotById, slotBookings, slotBookingsAll, slotCapacity, slotWaitlist, clientAttendance, nomeCurto,
  marcadoresDoAluno,
  bookingKind, MARCAS_MATRICULA, ehPagamentoDeMatricula, situacaoMensalidade, clientOfBooking,
  competenciasDoAluno, compLabel, mensalidadeDe, matriculaISO,
  compAtual, addComp, precoDaComp, mensalidadeDaComp,
  WEEKDAYS_SHORT, dowMon, datesForWeekdays, addDays,
  ehSabadoISO, tipoMensalista, TIPO_MENSALISTA_LABEL,
  motivoForaDaRegra, motivoForaDaRegraDow,
} from "./helpers.js";

const openWa = (phone, msg) => window.open(waLink(phone, msg), "_blank");

/* Opções reaproveitadas pelos seletores (<Select> em ui.jsx) */
const FORMAS_PAGAMENTO = [
  { value: "Pix", label: "Pix", icon: "⚡" },
  { value: "Dinheiro", label: "Dinheiro", icon: "💵" },
  { value: "Cartão", label: "Cartão", icon: "💳" },
  { value: "Transferência", label: "Transferência", icon: "🏦" },
];
const unitOptions = (meta) => meta.units.map((u) => ({ value: u, label: u, icon: "📍" }));
const profOptions = (meta) => meta.profs.map((p) => ({ value: p, label: p, icon: "👩‍🏫" }));
/* Os dois jeitos de a mensalista ocupar a agenda (ver backend/src/regrasAula.js) */
const TIPO_MENSALISTA_OPCOES = [
  { value: "fixo", label: "Fixo", hint: "dia e hora fixos — você monta a agenda dela", icon: "📌" },
  { value: "escala", label: "Escala", hint: "ela marca a própria aula, no dia da aula dela", icon: "🙋" },
];

/* Resultado da criação de horários: as aulas duram 2h, então o servidor recusa
   turmas que se sobrepõem na mesma unidade — aqui a gente conta o que aconteceu. */
function avisarCriacao(r, sempre = false) {
  if (!r) return;
  const criados = r.created?.length ?? 0;
  const conflitos = r.conflitos || [];
  if (conflitos.length) {
    const lista = conflitos.slice(0, 3).map((c) => `${fmtDate(c.date)} (choca com ${c.conflitaCom})`).join(", ");
    return toast(
      `${criados} horário(s) criado(s). ${conflitos.length} recusado(s) por sobreposição: ${lista}${conflitos.length > 3 ? "…" : ""}`,
      "info",
    );
  }
  if (sempre || criados !== 1) toast(`${criados} horário(s) criado(s).`);
}

/* Resultado da replicação da turma inteira (horário + alunas).
   Além do que deu certo, conta o que ficou de fora: choque de horário na
   unidade e alunas puladas (turma lotada, regra do plano, reposição…). */
function avisarReplicacao(r, semanas) {
  if (!r) return;
  const partes = [];
  if (r.slots) partes.push(`${r.slots} horário(s) criado(s)`);
  if (r.aulas) partes.push(`${r.aulas} aula(s) copiada(s)`);
  if (!partes.length) partes.push("nada novo a criar — já estava tudo na agenda");
  let tom = "success";
  if (r.conflitos?.length) {
    partes.push(`${r.conflitos.length} semana(s) sem criar por sobreposição de horário`);
    tom = "info";
  }
  if (r.pulos?.length) {
    // agrupa por motivo para não despejar uma linha por aluna/semana
    const porMotivo = {};
    r.pulos.forEach((p) => { porMotivo[p.motivo] = (porMotivo[p.motivo] || 0) + 1; });
    const resumo = Object.entries(porMotivo).slice(0, 2).map(([m, n]) => `${n}× ${m}`).join("; ");
    partes.push(`${r.pulos.length} aula(s) pulada(s): ${resumo}`);
    tom = "info";
  }
  if (r.naoReplicadas?.length) {
    partes.push(`${r.naoReplicadas.length} reserva(s) fora da cópia (reposição / experimental)`);
    tom = "info";
  }
  toast(`Replicado por ${semanas} semana(s). ${partes.join(". ")}.`, tom);
}

/* ======================= Cartão de horário =======================
   `todosAlunos` = a turma inteira aparece na lista, sem o corte "+N mais".
   É como a visão de SEMANA usa o cartão: ali a Inêz precisa bater o olho na
   coluna do dia e ver quem está em cada turma, sem abrir turma por turma. */
export function SlotCard({ slot, showUnit, todosAlunos = false }) {
  const { data } = useStore();
  const { open } = useModal();
  const uc = unitColor(slot.unit);
  const cap = slotCapacity(slot);
  const bks = slotBookings(data, slot.id);
  const occ = bks.length;
  const full = occ >= cap;
  const wlc = slotWaitlist(slot).length;
  const cls = occ === 0 ? "free" : full ? "full" : "partial";
  const pct = Math.round((occ / cap) * 100);
  const todas = slotBookingsAll(data, slot.id); // inclui canceladas
  return (
    <div className={`slot ${cls}`} style={{ "--uc": uc, background: occ ? unitSoft(slot.unit) : undefined }}
      onClick={() => open(<SlotDetail slotId={slot.id} />)}>
      <div className="slot-top">
        <span className="t" style={{ color: occ ? uc : undefined }}>{hhmm(slot.time)}</span>
        <span className={`occ ${full ? "is-full" : occ > 0 ? "is-part" : ""}`}>{occ}/{cap}</span>
      </div>
      {showUnit && <div className="n"><b style={{ color: uc }}>{slot.unit}</b></div>}
      {todas.length ? (
        <div className={`sc-roster ${todosAlunos ? "sc-todos" : ""}`}>
          {(todosAlunos ? todas : todas.slice(0, 5)).map((b) => {
            const k = bookingKind(b);
            // 🎂 aniversário perto do dia da aula · 🙋 mensalista de escala
            const marcas = marcadoresDoAluno(data, b, slot.date);
            const dica = [b.clientName, ...marcas.map((m) => m.label), k ? k.label : null].filter(Boolean).join(" · ");
            return (
              <div key={b.id} className={`sc-al ${b.status === "cancelada" ? "canc" : ""}`} title={dica}>
                <span className="sc-dot" style={{ background: k ? k.color : "var(--pink)" }} />
                {marcas.map((m) => (
                  <span key={m.k} className={`sc-marca ${m.forte ? "" : "fraca"}`} aria-label={m.label}>{m.ic}</span>
                ))}
                <span className="sc-nm">{todosAlunos ? nomeCurto(b.clientName) : b.clientName.split(" ")[0]}</span>
                {k && <span className="sc-tag">{k.ic}</span>}
              </div>
            );
          })}
          {!todosAlunos && todas.length > 5 && <div className="sc-more">+{todas.length - 5} mais</div>}
        </div>
      ) : <div className="n">Livre</div>}
      <div className="occbar"><span style={{ width: pct + "%", background: full ? "var(--danger)" : uc }} /></div>
      {wlc > 0 && <div className="wl-badge">⏰ {wlc} na espera</div>}
    </div>
  );
}

/* ======================= Modal do dia ======================= */
export function DayModal({ date, unit = "Todas" }) {
  const { data } = useStore();
  const { open, close } = useModal();
  const todas = unit === "Todas";
  const slots = data.slots
    .filter((s) => s.date === date && (todas || s.unit === unit))
    .sort((a, b) => a.time.localeCompare(b.time));
  const title = capitalize(new Date(date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }));
  return (
    <Modal title={title} subheader={!todas ? <div className="day-sub">📍 Unidade: <b>{unit}</b></div> : undefined} footer={<>
      <button className="btn ghost" onClick={close}>Fechar</button>
      <button className="btn" onClick={() => open(<SlotForm presetDate={date} presetUnit={unit} />)}>＋ Novo horário</button>
    </>}>
      {slots.length
        ? <div className="day-view" style={{ maxWidth: "none" }}>{slots.map((s) => <SlotCard key={s.id} slot={s} showUnit={todas} />)}</div>
        : <div className="empty"><div className="ic">🧶</div><p>Nenhum horário{todas ? "" : ` de ${unit}`} cadastrado neste dia.</p></div>}
    </Modal>
  );
}

/* ======================= Detalhe da turma ======================= */
// Etiqueta do tipo do aluno numa reserva (mostrada na turma da agenda)
function bookingTag(data, b) {
  if (b.paymentMethod === "Reposição") return { label: "🔁 Reposição", cls: "b-warn" };
  const c = (data.clients || []).find((x) => x.name === b.clientName);
  if (c?.plan === "mensalista") return { label: "📅 Mensalista", cls: "b-ok" };
  if (c?.firstClass) return { label: "✨ Novo(a)", cls: "b-terra" };
  return { label: "💠 Avulso", cls: "b-muted" };
}

export function SlotDetail({ slotId }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  const slot = slotById(data, slotId);
  const [capInput, setCapInput] = useState(slot ? slotCapacity(slot) : CAPACITY_PADRAO);
  const [repBusy, setRepBusy] = useState(false);
  // Atalho de 1 clique: repete a turma como ela está (alunas junto) na semana que vem.
  const replicarProxima = async () => {
    if (repBusy) return;
    setRepBusy(true);
    try {
      const r = await run(api.replicateSlot(slotId, 1, true));
      avisarReplicacao(r, 1);
    } catch { /* o run já avisou do erro */ } finally { setRepBusy(false); }
  };
  if (!slot) return <Modal title="Turma"><p>Horário não encontrado.</p></Modal>;
  const cap = slotCapacity(slot);
  const bks = slotBookings(data, slotId);
  const occ = bks.length, full = occ >= cap, uc = unitColor(slot.unit);
  const wl = slotWaitlist(slot);

  const mark = (b, val) => run(api.updateBooking(b.id, { attendance: b.attendance === val ? "" : val }));
  const saveCap = () => {
    if (capInput < occ) return toast(`A capacidade (${capInput}) não pode ser menor que as ${occ} reservas já feitas.`, "error");
    run(api.updateSlotCapacity(slotId, capInput));
  };
  const del = async () => {
    // Exclusão em lote "pega-tudo": além dos criados juntos (mesma série),
    // considera TODOS os horários futuros equivalentes — mesma unidade, hora e
    // dia da semana — mesmo que tenham sido criados em levas separadas.
    const t = todayISO();
    const dow = new Date(slot.date + "T00:00").getDay();
    const sibs = data.slots.filter((s) => s.id !== slot.id && s.date >= t && (
      (slot.seriesId && s.seriesId === slot.seriesId) ||
      (s.unit === slot.unit && s.time === slot.time && new Date(s.date + "T00:00").getDay() === dow)
    ));
    if (!sibs.length) {
      const msg = occ > 0
        ? `Este horário tem ${occ} reserva(s). Excluir o horário também remove essas reservas. Continuar?`
        : "Excluir este horário da agenda?";
      if (!(await confirmModal({ title: "Excluir horário", message: msg, confirmLabel: "Excluir", tone: "danger" }))) return;
      await run(api.deleteSlot(slotId));
      close();
      return;
    }
    const allRes = occ + sibs.reduce((n, s) => n + slotBookings(data, s.id).length, 0);
    const diaSemana = capitalize(new Date(slot.date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long" }));
    const ultimo = sibs.reduce((m, s) => (s.date > m ? s.date : m), slot.date);
    const ans = await confirmModal({
      title: "Excluir horário em lote",
      message: `Há mais ${sibs.length} horário(s) de ${diaSemana} às ${slot.time} em ${slot.unit} na agenda daqui em diante (até ${fmtDate(ultimo)}).` +
        (occ > 0 ? `\n\nEste horário tem ${occ} reserva(s).` : "") +
        (allRes > 0 ? `\nExcluindo todos, ${allRes} reserva(s) ao todo serão removidas.` : "") +
        `\n\nQuer excluir só este horário ou todos?`,
      confirmLabel: `Excluir todos (${sibs.length + 1})`,
      altLabel: "Só este",
      tone: "danger",
    });
    if (!ans) return;
    const r = await run(api.deleteSlot(slotId, ans === "alt" ? null : "match"));
    if (ans !== "alt") toast(`${r?.deleted ?? sibs.length + 1} horário(s) excluído(s).`);
    close();
  };

  return (
    <Modal title={`Turma — ${faixaHorario(slot.time, data.meta?.duracaoAulaMin)}`} footer={<>
      <button className="btn ghost" onClick={() => open(<DayModal date={slot.date} unit={slot.unit} />)}>← Voltar ao dia</button>
      <div style={{ flex: 1 }} />
      <button className="btn sec" onClick={saveCap}>Salvar capacidade</button>
      {full
        ? <button className="btn terra" onClick={() => open(<WaitlistForm slotId={slotId} />)}>⏰ Lista de espera</button>
        : <button className="btn" onClick={() => open(<BookingForm slotId={slotId} />)}>＋ Adicionar pessoa</button>}
    </>}>
      <div className="info-line"><b>Unidade</b><span><span className="chip" style={{ borderColor: uc, color: uc }}>{slot.unit}</span></span></div>
      <div className="info-line"><b>Data / hora</b><span>{fmtDateLong(slot.date)} · {faixaHorario(slot.time, data.meta?.duracaoAulaMin)}</span></div>
      <div className="info-line"><b>Profissional</b><span>{slot.prof || "—"}</span></div>
      <div style={{ display: "flex", gap: ".5rem", marginTop: ".8rem", flexWrap: "wrap" }}>
        <button className="btn sec sm" onClick={() => open(<EditSlotForm slot={slot} />)}>✏️ Editar turma</button>
        <button className="btn sec sm" onClick={replicarProxima} disabled={repBusy}
          title="Repete esta turma (com as alunas) na semana que vem">
          {repBusy ? "Replicando…" : "⏭️ Próxima semana"}
        </button>
        <button className="btn sec sm" onClick={() => open(<ReplicateTurmaForm slot={slot} />)}
          title="Repetir esta turma por várias semanas">🗓 Replicar por X semanas</button>
        <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={del}>🗑 Excluir horário</button>
      </div>
      <div className="help" style={{ marginTop: ".45rem" }}>
        Replicar repete a turma <b>com as {occ} aluna(s)</b> no mesmo dia da semana e horário. As aulas copiadas
        nascem <b>não pagas</b>; reposições e aulas experimentais não são replicadas.
      </div>
      <div className="field" style={{ marginTop: "1rem" }}>
        <label>Capacidade da turma — máx. de pessoas por aula</label>
        <input type="number" min="1" value={capInput} onChange={(e) => setCapInput(parseInt(e.target.value, 10) || 1)} />
        <div className="help" style={{ marginTop: ".5rem" }}>Esse é o limite de vagas. Quando lotar, o horário some das opções do aluno e (futuramente) o WhatsApp não oferece mais essa vaga.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "1rem 0 .3rem" }}>
        <b style={{ color: "var(--brown)" }}>Reservas · {occ}/{cap}</b>
        {full ? <span className="badge b-danger">Turma lotada</span> : <span className="badge b-ok">{cap - occ} vaga(s) livre(s)</span>}
      </div>
      {bks.length ? bks.map((b) => {
        const tag = bookingTag(data, b);
        return (
        <div className="roster-row" key={b.id}>
          <div className="rr-info">
            <b>{b.clientName}</b>
            {tag && <span className={`badge ${tag.cls} ml`}>{tag.label}</span>}
            <div className="cli-sub">{b.phone || "sem telefone"}</div>
          </div>
          <div className="att" title="Marcar presença">
            <button className={`att-btn ${b.attendance === "presente" ? "on-pres" : ""}`} onClick={() => mark(b, "presente")} title="Presente">✓</button>
            <button className={`att-btn ${b.attendance === "falta" ? "on-falt" : ""}`} onClick={() => mark(b, "falta")} title="Faltou">✕</button>
          </div>
          <button className="btn sec sm" onClick={() => open(<ManageBooking booking={b} />)}>Gerir</button>
        </div>
        );
      }) : <div className="empty" style={{ padding: "1.2rem" }}><div className="ic">🪑</div><p>Nenhuma reserva nesta turma ainda.</p></div>}

      {wl.length > 0 && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "1.3rem 0 .4rem" }}>
          <b style={{ color: "var(--brown)" }}>⏰ Lista de espera · {wl.length}</b>
        </div>
        {wl.map((w) => (
          <div className="roster-row" key={w.id}>
            <div className="rr-info"><b>{w.name}</b><div className="cli-sub">{w.phone || "sem telefone"}</div></div>
            <button className="btn wa sm" onClick={() => openWa(w.phone, `Olá ${w.name}! Abriu uma vaga na turma de ${fmtDate(slot.date)} às ${slot.time} em ${slot.unit}. Quer garantir? 💚`)}>Avisar</button>
            {!full && <button className="btn sm" onClick={() => run(api.promoteWaitlist(w.id))}>Promover</button>}
            <button className="btn ghost sm" onClick={() => run(api.removeWaitlist(w.id))} title="Remover">✕</button>
          </div>
        ))}
      </>}
    </Modal>
  );
}

/* ======================= Lista de espera (form) ======================= */
export function WaitlistForm({ slotId }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const slot = slotById(data, slotId);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const save = async () => {
    if (!name.trim()) return toast("Informe o nome.", "error");
    await run(api.addWaitlist(slotId, { name: name.trim(), phone: phone.trim() }));
    open(<SlotDetail slotId={slotId} />);
  };
  return (
    <Modal title="Entrar na lista de espera" footer={<>
      <button className="btn ghost" onClick={() => open(<SlotDetail slotId={slotId} />)}>← Voltar</button>
      <div style={{ flex: 1 }} />
      <button className="btn" onClick={save}>Adicionar à fila</button>
    </>}>
      <div className="help" style={{ marginBottom: "1rem" }}>A turma de <b>{slot && fmtDate(slot.date)} às {slot && slot.time}</b> ({slot && slot.unit}) está lotada. A pessoa entra na fila e você é avisada quando abrir vaga.</div>
      <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da pessoa" /></div>
      <div className="field"><label>WhatsApp (com DDD)</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="31988880000" /></div>
    </Modal>
  );
}

/* ======================= Gerir marcação ======================= */
export function ManageBooking({ booking, onBack }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  const [pix, setPix] = useState(booking.pixCode || "");
  const [genBusy, setGenBusy] = useState(false);
  const slotExists = !!slotById(data, booking.slotId);
  /* Duas reservas — e só essas duas — carregam dinheiro próprio: a experimental
     (é a 1ª mensalidade da aluna) e a aula extra, que é compra avulsa. Toda
     aula comum já está paga dentro da mensalidade do mês; cobrar por ela era o
     R$ 20 fantasma que saiu do sistema em 30/08/2026. */
  const cobraNaReserva = ehPagamentoDeMatricula(booking.paymentMethod) || booking.paymentMethod === "Avulsa";
  /* Este modal é só de CONSULTA + as três ações que a Inêz de fato usa:
     cobrar o Pix, liberar a vaga e tirar a aluna da turma.
     Editar status / presença / data / hora à mão saiu daqui em 26/08/2026: o
     status anda sozinho pelo pagamento, a presença se marca dentro da turma
     (✓/✕ na lista) e remarcar é liberar a vaga e marcar de novo — assim as
     regras de reposição e de capacidade sempre passam pelo caminho certo. */
  // Libera a vaga aplicando as regras de reposição (mesmo caminho do portal).
  const liberar = async () => {
    const motivo = await promptModal({
      title: "Liberar vaga",
      message: `Liberar a aula de ${booking.clientName} em ${fmtDate(booking.date)} às ${booking.time}?\n\nA vaga fica livre e o sistema avalia se gera crédito de reposição.`,
      label: "Motivo informado pela aluna (opcional)",
      confirmLabel: "Liberar vaga",
    });
    if (motivo === null) return;
    try {
      const r = await run(api.releaseBooking(booking.id, motivo));
      toast(r?.credito ? "Vaga liberada e 1 crédito de reposição concedido. 💚"
        : r?.devolvido ? "Reposição cancelada e o crédito voltou para a aluna."
        : `Vaga liberada.${r?.motivo ? " " + r.motivo : ""}`, r?.credito ? "success" : "info");
      close();
    } catch { /* erro já reportado pelo run */ }
  };
  const del = async () => {
    // aulas marcadas juntas (replicação) compartilham seriesId; "demais" = as de hoje em diante
    const t = todayISO();
    const sibs = booking.seriesId
      ? (data.bookings || []).filter((b) => b.seriesId === booking.seriesId && b.id !== booking.id && b.date >= t)
      : [];
    if (!sibs.length) {
      const msg = `Tirar ${booking.clientName} da turma de ${fmtDate(booking.date)} às ${booking.time}?` +
        (booking.paid ? "\n\nAtenção: esta aula consta como paga." : "") +
        "\n\nA vaga volta a ficar livre na turma. Não gera crédito de reposição.";
      if (!(await confirmModal({ title: "Excluir aluno(a)", message: msg, confirmLabel: "Excluir", tone: "danger" }))) return;
      await run(api.deleteBooking(booking.id));
      close();
      return;
    }
    const pagas = (booking.paid ? 1 : 0) + sibs.filter((b) => b.paid).length;
    const ans = await confirmModal({
      title: "Excluir aluno(a) — turma replicada",
      message: `Esta aula veio de uma replicação: ${booking.clientName} tem mais ${sibs.length} aula(s) da mesma marcação daqui em diante.` +
        (pagas > 0 ? `\n\nAtenção: ${pagas} dessas aula(s) consta(m) como paga(s).` : "") +
        `\n\nQuer tirá-la só desta aula ou de todas da marcação?`,
      confirmLabel: `Excluir todas (${sibs.length + 1})`,
      altLabel: "Só esta",
      tone: "danger",
    });
    if (!ans) return;
    await run(api.deleteBooking(booking.id, ans !== "alt"));
    close();
  };
  const genInvoice = async () => {
    setGenBusy(true);
    try {
      const r = await api.createInvoice(booking.id, {});
      setPix(r.pixCode || "");
      if (!r.pixCode) toast("Cobrança criada no Sicredi, mas o código Pix não veio na resposta. Tente gerar de novo.", "info");
    } catch (e) { toast("Erro ao gerar cobrança: " + e.message, "error"); }
    setGenBusy(false);
  };
  return (
    <Modal title="Gerir marcação" footer={<>
      {onBack
        ? <button className="btn ghost" onClick={onBack}>← Voltar ao perfil</button>
        : slotExists
          ? <button className="btn ghost" onClick={() => open(<SlotDetail slotId={booking.slotId} />)}>← Voltar à turma</button>
          : <button className="btn ghost" onClick={close}>Fechar</button>}
      <div style={{ flex: 1 }} />
      <button className="btn wa" onClick={() => openWa(booking.phone, `Olá ${booking.clientName}! 💚`)}><WaIcon /> WhatsApp</button>
      {/* Confirmar pagamento só existe quando a reserva TEM dinheiro próprio:
          a experimental (1ª mensalidade) e a aula extra. Nas demais, quem se
          paga é a mensalidade do mês — não a aula. */}
      {cobraNaReserva && !booking.paid && <button className="btn terra" onClick={() => open(<ConfirmPayment booking={booking} />)}>Confirmar pagamento</button>}
    </>}>
      <div className="info-line"><b>Aluno</b><span>{booking.clientName}</span></div>
      <div className="info-line"><b>Telefone</b><span>{booking.phone || "—"}</span></div>
      <div className="info-line"><b>Unidade</b><span>{booking.unit}</span></div>
      <div className="info-line"><b>Aula</b><span>{fmtDateLong(booking.date)} · {faixaHorario(booking.time, data.meta?.duracaoAulaMin)}</span></div>
      {/* A aula não tem preço próprio: só a reserva da experimental carrega
          dinheiro (é a 1ª mensalidade da aluna). Nas demais, o que importa é
          como está a mensalidade do mês dela. */}
      {cobraNaReserva ? (<>
        <div className="info-line"><b>{ehPagamentoDeMatricula(booking.paymentMethod) ? "1ª mensalidade" : "Aula extra"}</b><span>{money(booking.value)}</span></div>
        <div className="info-line"><b>Pagamento</b><span>{booking.paid ? `Pago (${booking.paymentMethod})` : "Pendente"}</span></div>
      </>) : (() => {
        const sit = situacaoMensalidade(data, clientOfBooking(data, booking));
        return (
          <div className="info-line"><b>Mensalidade · {compLabel(compAtual())}</b><span>
            <span className={`badge ${sit.cls}`}>{sit.label}</span>
            {sit.valor > 0 ? ` ${money(sit.valor)}` : ""}
          </span></div>
        );
      })()}
      {/* Só leitura: o status anda sozinho pelo pagamento e a presença se marca na turma. */}
      <div className="info-line"><b>Situação</b><span><StatusBadge status={booking.status} /></span></div>
      <div className="info-line"><b>Presença</b><span>
        {booking.attendance === "presente" ? "✓ Presente" : booking.attendance === "falta" ? "✕ Faltou" : "○ Não marcada"}
      </span></div>

      {cobraNaReserva && !booking.paid && (
        <div className="field" style={{ marginTop: ".9rem" }}>
          {pix ? (
            <>
              <label>Pix da reserva (copia-e-cola)</label>
              <textarea readOnly value={pix} rows={3} style={{ resize: "vertical", fontSize: ".8rem" }} onFocus={(e) => e.target.select()} />
              <div style={{ display: "flex", gap: ".5rem", marginTop: ".5rem", flexWrap: "wrap" }}>
                <button className="btn sec sm" onClick={() => navigator.clipboard?.writeText(pix)}>📋 Copiar Pix</button>
                <button className="btn wa sm" onClick={() => openWa(booking.phone, `Olá ${booking.clientName}! 💚 Para confirmar sua reserva de ${fmtDate(booking.date)} às ${booking.time}, é só pagar o Pix abaixo:\n\n${pix}`)}><WaIcon /> Enviar no WhatsApp</button>
              </div>
              <div className="help" style={{ marginTop: ".4rem" }}>Assim que o Pix cair no Sicredi, a reserva vira <b>Confirmada</b> automaticamente.</div>
            </>
          ) : (
            <button className="btn terra sm" onClick={genInvoice} disabled={genBusy}>{genBusy ? "Gerando…" : "💠 Gerar cobrança Pix"}</button>
          )}
        </div>
      )}

      <div style={{ marginTop: "1rem", display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
        {booking.status !== "cancelada" && (
          <button className="btn sec sm" onClick={liberar}>🔓 Liberar vaga (a aluna avisou)</button>
        )}
        <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={del}>🗑 Excluir aluno(a)</button>
      </div>
      <div className="help" style={{ marginTop: ".5rem" }}>
        <b>Liberar</b> cancela a aula e aplica as regras de reposição — vira crédito só se o aviso vier
        com 6h de antecedência (ou até 23:59 do dia anterior, se a aula for antes das 10h).
        <br /><b>Excluir aluno(a)</b> tira a pessoa desta turma de vez, sem gerar crédito — a vaga volta a ficar livre.
      </div>
    </Modal>
  );
}

/* ======================= Confirmar pagamento de uma marcação ======================= */
export function ConfirmPayment({ booking }) {
  const { run } = useStore();
  const { close } = useModal();
  const [method, setMethod] = useState("Pix");
  const [pdate, setPdate] = useState(todayISO());
  const [value, setValue] = useState(booking.value);
  const save = async () => {
    await run(api.payBooking(booking.id, { paymentMethod: method, paymentDate: pdate, value }));
    close();
  };
  return (
    <Modal title="Confirmar pagamento" footer={<>
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save}>✓ Confirmar</button>
    </>}>
      <div className="help">Ao confirmar o pagamento, a aula passa a <b>Confirmada</b> e aparece reservada na agenda.</div>
      <div className="field" style={{ marginTop: "1rem" }}><label>Forma de pagamento</label>
        <Select value={method} onChange={setMethod} options={FORMAS_PAGAMENTO} />
      </div>
      <div className="field"><label>Data do pagamento</label><input type="date" value={pdate} onChange={(e) => setPdate(e.target.value)} /></div>
      <div className="field"><label>Valor</label><input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} /></div>
    </Modal>
  );
}

/* ======================= Registrar recebimento (avulso) ======================= */
export function PaymentRegister() {
  const { data, run } = useStore();
  const { close } = useModal();
  // Só reservas com dinheiro próprio: experimental (1ª mensalidade) e aula extra.
  const pend = data.bookings.filter((b) => b.status === "aguardando" &&
    (ehPagamentoDeMatricula(b.paymentMethod) || b.paymentMethod === "Avulsa"));
  const [id, setId] = useState(pend[0]?.id || "");
  const [method, setMethod] = useState("Pix");
  const [pdate, setPdate] = useState(todayISO());
  const save = async () => {
    if (!id) return close();
    await run(api.payBooking(id, { paymentMethod: method, paymentDate: pdate }));
    close();
  };
  return (
    <Modal title="Registrar recebimento" footer={<>
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save}>Registrar</button>
    </>}>
      <div className="field"><label>Marcação aguardando pagamento</label>
        <Select
          value={id}
          onChange={(v) => setId(Number(v))}
          placeholder="Nenhuma pendente"
          options={pend.map((b) => ({
            value: b.id,
            label: b.clientName,
            hint: `${fmtDate(b.date)} · ${b.time}`,
            icon: "🧶",
            meta: money(b.value),
          }))}
        />
      </div>
      <div className="row2">
        <div className="field"><label>Forma</label><Select value={method} onChange={setMethod} options={FORMAS_PAGAMENTO} /></div>
        <div className="field"><label>Data</label><input type="date" value={pdate} onChange={(e) => setPdate(e.target.value)} /></div>
      </div>
      <div className="help">Confirmar aqui marca a reserva como paga e confirma a aula na agenda.</div>
    </Modal>
  );
}

/* ======================= Busca de Alunas (Combobox Autocomplete) ======================= */
function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function StudentSearchCombobox({ clients, selectedClient, onSelect, onClear }) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = (clients || []).filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, "");
    const nameMatch = (c.name || "").toLowerCase().includes(q);
    const phoneMatch = qDigits ? (c.phone || "").replace(/\D/g, "").includes(qDigits) : false;
    const unitMatch = (c.unit || "").toLowerCase().includes(q);
    return nameMatch || phoneMatch || unitMatch;
  });

  if (selectedClient) {
    return (
      <div className="student-selected-card">
        <div className="student-avatar">{getInitials(selectedClient.name)}</div>
        <div className="student-info">
          <div className="student-name">{selectedClient.name}</div>
          <div className="student-meta">
            {selectedClient.phone && <span>📱 {selectedClient.phone}</span>}
            {selectedClient.unit && (
              <span
                className="student-unit-pill"
                style={{ background: unitSoft(selectedClient.unit), color: unitColor(selectedClient.unit) }}
              >
                {selectedClient.unit}
              </span>
            )}
          </div>
        </div>
        <button type="button" className="btn-trocar-aluna" onClick={onClear} title="Trocar aluna selecionada">
          Trocar aluna ✕
        </button>
      </div>
    );
  }

  return (
    <div className="student-search-container" ref={containerRef}>
      <div className="student-search-input-wrap">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          className="student-search-input"
          placeholder="Buscar aluna por nome, telefone ou unidade..."
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
        />
        {query && (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => setQuery("")}
            title="Limpar busca"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && (
        <div className="student-search-dropdown">
          <div className="student-dropdown-header">
            Alunas cadastradas ({filtered.length})
          </div>
          <div className="student-dropdown-list">
            {filtered.length === 0 ? (
              <div className="student-dropdown-empty">
                Nenhuma aluna encontrada para "{query}"
              </div>
            ) : (
              filtered.slice(0, 12).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="student-dropdown-item"
                  onClick={() => {
                    onSelect(c);
                    setIsOpen(false);
                    setQuery("");
                  }}
                >
                  <div className="student-avatar">{getInitials(c.name)}</div>
                  <div className="student-item-details">
                    <div className="student-item-name">{c.name}</div>
                    <div className="student-item-sub">
                      {c.phone && <span>📱 {c.phone}</span>}
                      {c.unit && (
                        <span
                          className="student-unit-pill"
                          style={{ background: unitSoft(c.unit), color: unitColor(c.unit) }}
                        >
                          {c.unit}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="student-dropdown-footer">
            <button
              type="button"
              className="student-manual-btn"
              onClick={() => {
                onClear();
                setIsOpen(false);
              }}
            >
              ＋ Digitar dados de nova aluna manualmente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================= Nova marcação ======================= */
export function BookingForm({ slotId }) {
  const { data, run } = useStore();
  const { close } = useModal();
  const slot = slotId ? slotById(data, slotId) : null;
  const meta = data.meta;
  const [selectedClient, setSelectedClient] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [unit, setUnit] = useState(slot ? slot.unit : meta.units[0]);
  const [date, setDate] = useState(slot ? slot.date : todayISO());
  const [time, setTime] = useState(slot ? slot.time : "09:00");
  // repetição (igual à criação de horários): dias da semana × nº de semanas
  const [weekdays, setWeekdays] = useState(() => new Set());
  const [weeks, setWeeks] = useState(4);
  const toggleWd = (i) => setWeekdays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const dates = weekdays.size ? datesForWeekdays(date, [...weekdays], weeks) : [date];
  const repetindo = dates.length > 1;

  const handleSelectClient = (c) => {
    setSelectedClient(c);
    setName(c.name);
    setPhone(c.phone || "");
    if (c.unit) setUnit(c.unit);
  };

  const handleClearClient = () => {
    setSelectedClient(null);
    setName("");
    setPhone("");
  };

  const save = async () => {
    if (!name.trim()) return toast("Informe o nome.", "error");
    /* Se a aluna escolhida é mensalista, avisa quando a marcação cai fora do
       plano (sábado / a partir das 18h). Este caminho é da Inêz, então é só
       aviso — quem decide é ela. A regra dura vive no portal e no backend. */
    const cli = selectedClient || data.clients.find((c) => c.name === name.trim());
    const foraDatas = cli ? dates.filter((d) => motivoForaDaRegra(cli, { date: d, time })) : [];
    if (foraDatas.length) {
      const motivo = motivoForaDaRegra(cli, { date: foraDatas[0], time });
      const ok = await confirmModal({
        title: "Marcação fora do plano",
        message: `${cli.name} é mensalista e ${motivo}.\n\n` +
          `${foraDatas.length} data(s) desta marcação caem nessa situação. Marcar assim abre uma exceção.`,
        confirmLabel: "Marcar mesmo assim",
        cancelLabel: "Voltar",
        tone: "danger",
      });
      if (!ok) return;
    }
    // value 0: a aula não tem preço próprio — quem se paga é a mensalidade do mês.
    const payload = { clientName: name.trim(), phone: phone.trim(), unit, value: 0, date, time, slotId: slot && !repetindo ? slot.id : undefined };
    if (repetindo) payload.dates = dates;
    const r = await run(api.createBooking(payload));
    close();
    if (repetindo) {
      const p = r?.pulos || {};
      const puladas = (p.lotada || 0) + (p.jaMarcada || 0);
      toast(
        `✅ ${r?.created?.length ?? 0} aula(s) marcada(s).` +
        (puladas ? `\nPuladas: ${p.lotada || 0} turma(s) lotada(s) · ${p.jaMarcada || 0} já marcada(s).` : "")
      );
    }
  };

  return (
    <Modal title="Nova marcação" footer={<>
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save} disabled={!dates.length}>
        Salvar marcação{repetindo ? ` (${dates.length})` : ""}
      </button>
    </>}>
      <div className="field">
        <label>Buscar aluna cadastrada</label>
        <StudentSearchCombobox
          clients={data.clients}
          selectedClient={selectedClient}
          onSelect={handleSelectClient}
          onClear={handleClearClient}
        />
      </div>
      <div className="row2">
        <div className="field">
          <label>Nome</label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (selectedClient && e.target.value !== selectedClient.name) {
                setSelectedClient(null);
              }
            }}
            placeholder="Nome da aluna"
          />
        </div>
        <div className="field">
          <label>Telefone (DDD)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="31988880000"
          />
        </div>
      </div>
      <div className="field">
        <label>Unidade</label>
        <Select value={unit} onChange={setUnit} options={unitOptions(meta)} />
      </div>
      <div className="row2">
        <div className="field">
          <label>{repetindo ? "Semana inicial (a partir de)" : "Data"}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Hora</label>
          <input type="time" value={hhmm(time)} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>
          Repetir nos dias da semana{" "}
          <span className="field-subtext">(deixe em branco para marcar só na data)</span>
        </label>
        <WeekdayChips selected={weekdays} onToggle={toggleWd} />
        {weekdays.size > 0 && (
          <div className="repeat-weeks-row">
            <span>por</span>
            <input
              type="number"
              min="1"
              max="52"
              value={weeks}
              onChange={(e) => setWeeks(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="weeks-input"
            />
            <span>semana(s)</span>
          </div>
        )}
      </div>

      {repetindo && (
        <div className="repeat-info-box">
          <div className="repeat-info-title">
            <span>📅</span> <b>{dates.length} marcações recorrentes agendadas</b>
          </div>
          <div className="repeat-info-desc">
            Serão criadas aulas às <b>{time}</b> a partir de <b>{fmtDate(date)}</b>. Turmas lotadas e aulas já marcadas serão puladas automaticamente.
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ======================= Seletor de dias da semana ======================= */
function WeekdayChips({ selected, onToggle }) {
  return (
    <div className="wd-chips">
      {WEEKDAYS_SHORT.map((lbl, i) => {
        const active = selected.has(i);
        return (
          <button
            key={lbl}
            type="button"
            className={`wd-chip ${active ? "on" : ""}`}
            onClick={() => onToggle(i)}
          >
            {active && <span className="chip-check">✓</span>}
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

/* ======================= Novo horário (com recorrência) ======================= */
export function SlotForm({ presetDate, presetUnit }) {
  const { data, run } = useStore();
  const { close } = useModal();
  const meta = data.meta;
  const [unit, setUnit] = useState(presetUnit && presetUnit !== "Todas" ? presetUnit : meta.units[0]);
  const [prof, setProf] = useState(""); // vazio por padrão — a instrutora é escolhida a cada horário
  const [date, setDate] = useState(presetDate || todayISO());
  const [time, setTime] = useState("09:00");
  const [capacity, setCapacity] = useState(meta.capacidadePadrao);
  const [weekdays, setWeekdays] = useState(() => new Set());
  const [weeks, setWeeks] = useState(4);
  const toggleWd = (i) => setWeekdays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const dates = weekdays.size ? datesForWeekdays(date, [...weekdays], weeks) : [date];
  const save = async () => {
    const r = await run(api.createSlot({ unit, prof, time, capacity, dates }));
    close();
    avisarCriacao(r);
  };
  return (
    <Modal title="Novo horário na agenda" footer={<>
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save} disabled={!dates.length}>Adicionar{dates.length > 1 ? ` (${dates.length})` : ""}</button>
    </>}>
      <div className="row2">
        <div className="field"><label>Unidade</label><Select value={unit} onChange={setUnit} options={unitOptions(meta)} /></div>
        <div className="field"><label>Profissional <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span></label>
          <Select
            value={prof}
            onChange={setProf}
            defaultOption={{ label: "Sem instrutor definido", icon: "—" }}
            options={profOptions(meta)}
          />
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>{weekdays.size ? "Semana inicial (a partir de)" : "Data"}</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Hora</label><input type="time" value={hhmm(time)} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <div className="field"><label>Capacidade da turma (vagas)</label><input type="number" min="1" value={capacity} onChange={(e) => setCapacity(parseInt(e.target.value, 10) || 1)} /></div>
      <div className="field">
        <label>Repetir nos dias da semana <span className="help" style={{ fontWeight: 400 }}>(deixe em branco para criar só na data)</span></label>
        <WeekdayChips selected={weekdays} onToggle={toggleWd} />
        {weekdays.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: ".6rem", marginTop: ".7rem" }}>
            <span style={{ fontSize: ".85rem", color: "var(--muted)" }}>por</span>
            <input type="number" min="1" max="52" value={weeks} onChange={(e) => setWeeks(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ width: 70 }} />
            <span style={{ fontSize: ".85rem", color: "var(--muted)" }}>semana(s)</span>
          </div>
        )}
        <div className="help" style={{ marginTop: ".5rem" }}>
          {weekdays.size
            ? `Serão criados ${dates.length} horário(s) às ${time}. Horários já existentes são ignorados.`
            : "Ex.: marque Seg e Qua por 4 semanas para criar 8 horários. Horários já existentes são ignorados."}
        </div>
      </div>
    </Modal>
  );
}

/* ======================= Replicar horário existente ======================= */
/* ======================= Editar turma (horário/prof/unidade/data) ======================= */
export function EditSlotForm({ slot }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const meta = data.meta;
  const bks = slotBookings(data, slot.id);
  const [unit, setUnit] = useState(slot.unit);
  const [prof, setProf] = useState(slot.prof || "");
  const [date, setDate] = useState(slot.date);
  const [time, setTime] = useState(hhmm(slot.time) || "09:00");

  const mudou = unit !== slot.unit || (prof || "") !== (slot.prof || "") || date !== slot.date || hhmm(slot.time) !== time;

  const save = async () => {
    if (!time) return toast("Informe o horário.", "error");
    if (bks.length) {
      const ok = await confirmModal({
        title: "Editar turma",
        message: `Esta turma tem ${bks.length} reserva(s).\n\nAo salvar, todas serão movidas para o novo dia/horário/unidade. Continuar?`,
        confirmLabel: "Salvar e mover",
      });
      if (!ok) return;
    }
    await run(api.updateSlot(slot.id, { unit, prof, date, time }));
    toast("Turma atualizada. 💚");
    open(<SlotDetail slotId={slot.id} />);
  };

  return (
    <Modal title="Editar turma" footer={<>
      <button className="btn ghost" onClick={() => open(<SlotDetail slotId={slot.id} />)}>← Voltar</button>
      <button className="btn" onClick={save} disabled={!mudou}>Salvar alterações</button>
    </>}>
      <div className="cfg-preview" style={{ marginTop: 0, marginBottom: "1rem" }}>
        Editando <b>{fmtDateLong(slot.date)}</b> · {faixaHorario(slot.time, meta.duracaoAulaMin)} · {slot.unit}
        {bks.length ? <> · <b>{bks.length} reserva(s)</b> serão movidas junto</> : null}
      </div>
      <div className="row2">
        <div className="field"><label>Unidade</label><Select value={unit} onChange={setUnit} options={unitOptions(meta)} /></div>
        <div className="field"><label>Profissional</label>
          <Select
            value={prof}
            onChange={setProf}
            defaultOption={{ label: "Sem instrutor definido", icon: "—" }}
            options={profOptions(meta)}
          />
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>Data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Horário</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <div className="help">Só altera <b>esta</b> turma. Para mudar várias de uma vez, exclua e recrie com a replicação, ou use “Replicar”.</div>
    </Modal>
  );
}

/* ======================= Replicar a TURMA INTEIRA (com alunas) =======================
   O que a Inêz quer na prática: "essa turma de quinta às 14h continua igual nas
   próximas semanas". Então o padrão aqui é levar as alunas junto — replicar só o
   horário vazio virou uma opção (e o modal antigo continua para dias específicos).

   As cópias nascem NÃO PAGAS: cada aula tem o seu próprio pagamento.
   Reposição e aula experimental nunca são copiadas (ver o endpoint no backend). */
export function ReplicateTurmaForm({ slot }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const [weeks, setWeeks] = useState(4);
  const [comAlunas, setComAlunas] = useState(true);
  const [busy, setBusy] = useState(false);
  const bks = slotBookings(data, slot.id);
  // as que realmente vão junto (reposição/experimental ficam de fora)
  const vaoJunto = bks.filter((b) => b.paymentMethod !== "Reposição" && !MARCAS_MATRICULA.includes(b.paymentMethod || ""));
  const foraCount = bks.length - vaoJunto.length;
  const ultima = addDays(slot.date, weeks * 7);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await run(api.replicateSlot(slot.id, weeks, comAlunas));
      open(<SlotDetail slotId={slot.id} />);
      avisarReplicacao(r, weeks);
    } catch { /* o run já avisou do erro */ } finally { setBusy(false); }
  };

  const atalhos = [1, 2, 4, 8, 12];
  return (
    <Modal title="Replicar turma" footer={<>
      <button className="btn ghost" onClick={() => open(<SlotDetail slotId={slot.id} />)}>← Voltar</button>
      <div style={{ flex: 1 }} />
      <button className="btn" onClick={save} disabled={busy}>
        {busy ? "Replicando…" : `Replicar por ${weeks} semana(s)`}
      </button>
    </>}>
      <div className="cfg-preview" style={{ marginTop: 0, marginBottom: "1rem" }}>
        Replicando <b>{slot.unit}</b> · {fmtDateLong(slot.date)} · <b>{faixaHorario(slot.time, data.meta?.duracaoAulaMin)}</b>
        {comAlunas && <> · <b>{vaoJunto.length} aluna(s)</b> por semana</>}
      </div>

      <div className="field">
        <label>Por quantas semanas</label>
        <div className="wd-chips" style={{ marginBottom: ".6rem" }}>
          {atalhos.map((n) => (
            <button key={n} type="button" className={`wd-chip ${weeks === n ? "on" : ""}`} onClick={() => setWeeks(n)}>
              {n === 1 ? "Próxima" : `${n} sem`}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span style={{ fontSize: ".85rem", color: "var(--muted)" }}>ou</span>
          <input type="number" min="1" max="52" value={weeks} style={{ width: 90 }}
            onChange={(e) => setWeeks(Math.min(52, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
          <span style={{ fontSize: ".85rem", color: "var(--muted)" }}>semana(s) — até {fmtDate(ultima)}</span>
        </div>
      </div>

      <div className="field">
        <label>O que replicar</label>
        <label style={{ display: "flex", alignItems: "center", gap: ".5rem", fontWeight: 400, cursor: "pointer" }}>
          <input type="checkbox" checked={comAlunas} onChange={(e) => setComAlunas(e.target.checked)} style={{ width: "auto" }} />
          <span>Levar as alunas junto <span className="help" style={{ fontWeight: 400 }}>(desmarque para repetir só o horário, vazio)</span></span>
        </label>
      </div>

      {comAlunas && (
        <div className="help">
          Serão criadas até <b>{vaoJunto.length * weeks} aula(s)</b> ({vaoJunto.length} × {weeks} semana(s)), sempre
          na mesma unidade, dia da semana e horário.
          {foraCount > 0 && <> {foraCount} reserva(s) desta turma <b>não</b> vão junto (reposição / aula experimental).</>}
          {" "}As cópias nascem <b>aguardando e não pagas</b>. Quem já estiver marcada é ignorada, e a semana em que
          a turma estiver lotada ou o horário chocar é pulada — o aviso no fim mostra o que ficou de fora.
        </div>
      )}
      {!comAlunas && <div className="help">Cria só o horário vazio nas próximas {weeks} semana(s).</div>}

      <div style={{ marginTop: "1rem" }}>
        <button className="btn ghost sm" onClick={() => open(<ReplicateSlotForm slot={slot} />)}>
          Outras opções de repetição (diária, dias específicos)
        </button>
      </div>
    </Modal>
  );
}

/* ======================= Replicar só o horário (diária / dias específicos) ======================= */
export function ReplicateSlotForm({ slot }) {
  const { run } = useStore();
  const { open } = useModal();
  const [mode, setMode] = useState("weekly"); // weekly | daily | weekdays
  const [count, setCount] = useState(4);
  const [weekdays, setWeekdays] = useState(() => new Set([dowMon(slot.date)]));
  const toggleWd = (i) => setWeekdays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  let dates = [];
  if (mode === "weekly") dates = Array.from({ length: count }, (_, i) => addDays(slot.date, (i + 1) * 7));
  else if (mode === "daily") dates = Array.from({ length: count }, (_, i) => addDays(slot.date, i + 1));
  else dates = datesForWeekdays(slot.date, [...weekdays], count).filter((d) => d !== slot.date);

  const save = async () => {
    const r = await run(api.createSlot({ unit: slot.unit, prof: slot.prof, time: slot.time, capacity: slot.capacity, dates, baseSlotId: slot.id }));
    open(<SlotDetail slotId={slot.id} />);
    avisarCriacao(r, true);
  };

  const modes = [["weekly", "Semanal"], ["daily", "Diária"], ["weekdays", "Dias específicos"]];
  return (
    <Modal title="Replicar horário" footer={<>
      <button className="btn ghost" onClick={() => open(<SlotDetail slotId={slot.id} />)}>← Voltar</button>
      <button className="btn" onClick={save} disabled={!dates.length}>Criar {dates.length} horário(s)</button>
    </>}>
      <div className="cfg-preview" style={{ marginTop: 0, marginBottom: "1rem" }}>
        Replicando <b>{slot.unit}</b> · {fmtDateLong(slot.date)} · <b>{slot.time}</b> (capacidade {slot.capacity})
      </div>
      <div className="field">
        <label>Tipo de repetição</label>
        <div className="wd-chips">
          {modes.map(([m, lbl]) => (
            <button key={m} type="button" className={`wd-chip ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>{lbl}</button>
          ))}
        </div>
      </div>
      {mode === "weekdays" && (
        <div className="field">
          <label>Em quais dias da semana</label>
          <WeekdayChips selected={weekdays} onToggle={toggleWd} />
        </div>
      )}
      <div className="field">
        <label>{mode === "weekly" ? "Por quantas semanas" : mode === "daily" ? "Por quantos dias" : "Por quantas semanas"}</label>
        <input type="number" min="1" max="52" value={count} onChange={(e) => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ width: 90 }} />
      </div>
      <div className="help">
        {mode === "weekly" && `Cria nas próximas ${count} semana(s), no mesmo dia e hora.`}
        {mode === "daily" && `Cria nos próximos ${count} dia(s), no mesmo horário.`}
        {mode === "weekdays" && `Cria nos dias marcados durante ${count} semana(s).`}
        {" "}O horário original não é duplicado; horários já existentes são ignorados.
      </div>
    </Modal>
  );
}

/* ======================= Perfil da aluna (histórico) ======================= */
const iniciais = (n) => (n || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/* ============ Alterar o valor da mensalidade de uma aluna ============
   O mesmo modal serve para três coisas que a Inêz pensa como uma só:

   • RECORRENTE — o valor dela muda para sempre. O mês corrente só entra se você
     marcar: a mensalidade dele pode já ter sido emitida no valor antigo, e mudar
     sem pedir seria alterar uma cobrança que a aluna já viu.
   • UM OU MAIS MESES — desconto pontual ou promoção de N meses. Vale só nas
     competências marcadas e acaba sozinho: passado o período, a mensalidade
     volta ao valor recorrente sem ninguém precisar lembrar de desfazer.
   • LIMPAR — tira o combinado de um mês e devolve ele ao valor recorrente.

   Mês com mensalidade PAGA nunca é alterado: o dinheiro já entrou. O modal
   mostra esses meses travados em vez de deixar você descobrir depois. */

const ESCOPOS = [
  { value: "recorrente", label: "De agora em diante", hint: "vira o valor fixo dela, todo mês", icon: "♾️" },
  { value: "mes_atual", label: "Só o mês atual", hint: "desconto pontual; volta ao normal no mês seguinte", icon: "📆" },
  { value: "proximo_mes", label: "Só o próximo mês", hint: "desconto pontual, já combinado", icon: "⏭️" },
  { value: "promocao", label: "Promoção — meses seguidos", hint: "ex.: 3 meses com desconto; acaba sozinha", icon: "🎁" },
  { value: "competencias", label: "Meses escolhidos", hint: "você marca um a um quais recebem o valor", icon: "🗓️" },
];

// Janela de meses oferecida para marcação: 6 atrás (mensalidade em aberto de
// meses passados ainda pode ser negociada) até 12 à frente.
const JANELA_ATRAS = 6;
const JANELA_FRENTE = 12;

export function AlterarMensalidade({ client, compInicial }) {
  const { data, run } = useStore();
  const { close } = useModal();
  const atual = compAtual();
  const recorrenteAtual = mensalidadeDe(client, data.meta);
  const invs = (data.invoices || []).filter((i) => i.clientId === client.id);
  const invDe = (comp) => invs.find((i) => i.competencia === comp);

  const [valor, setValor] = useState(String(recorrenteAtual || ""));
  /* Vindo da tela Mensalistas (com um mês na mão), o gesto é "mexer no valor
     DESTE mês". Sem mês nenhum, o gesto é "mudar quanto ela paga". */
  const [escopo, setEscopo] = useState(
    !compInicial ? "recorrente" : compInicial === atual ? "mes_atual" : "competencias"
  );
  const [aplicarNoMesAtual, setAplicarNoMesAtual] = useState(false);
  const [meses, setMeses] = useState("3");
  const [inicio, setInicio] = useState(atual);
  const [marcados, setMarcados] = useState(compInicial ? [compInicial] : [atual]);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  const janela = Array.from({ length: JANELA_ATRAS + 1 + JANELA_FRENTE }, (_, i) => addComp(atual, i - JANELA_ATRAS));
  const novoValor = Number(String(valor).replace(",", "."));
  // R$ 0 não é aceito: não existe Pix de zero. Mês de cortesia se resolve
  // cancelando a mensalidade daquele mês, não zerando o valor.
  const valido = Number.isFinite(novoValor) && novoValor > 0;

  // Quais meses a escolha atual atinge — é o que alimenta a prévia
  const alvos =
    escopo === "recorrente" ? (aplicarNoMesAtual ? [atual] : [])
    : escopo === "mes_atual" ? [atual]
    : escopo === "proximo_mes" ? [addComp(atual, 1)]
    : escopo === "promocao" ? Array.from({ length: Math.max(1, Math.min(24, parseInt(meses, 10) || 1)) }, (_, i) => addComp(inicio, i))
    : [...marcados].sort();

  const pagos = alvos.filter((c) => invDe(c)?.status === "pago");
  const efetivos = alvos.filter((c) => invDe(c)?.status !== "pago");
  const jaEmitidos = efetivos.filter((c) => invDe(c)?.status === "pendente");

  const toggleMes = (comp) =>
    setMarcados((m) => (m.includes(comp) ? m.filter((x) => x !== comp) : [...m, comp]));

  const salvar = async () => {
    if (!valido) return toast("Informe um valor válido.", "error");
    if ((escopo === "competencias") && !marcados.length) return toast("Marque ao menos um mês.", "error");

    // Confirmação em números: alterar valor mexe em cobrança, e o que a tela
    // deixa claro aqui é o que ela não vai precisar explicar depois.
    const linhas = [];
    if (escopo === "recorrente") {
      linhas.push(`${client.name} passa a pagar ${money(novoValor)} por mês, no lugar de ${money(recorrenteAtual)}.`);
      linhas.push(aplicarNoMesAtual
        ? `A mensalidade de ${compLabel(atual)} também passa para ${money(novoValor)}.`
        : `A mensalidade de ${compLabel(atual)} continua como está — o novo valor começa em ${compLabel(addComp(atual, 1))}.`);
    } else {
      linhas.push(`${efetivos.length} mês(es) passam a custar ${money(novoValor)}: ${efetivos.map(compLabel).join(", ")}.`);
      linhas.push(`Depois disso ela volta ao valor de sempre (${money(recorrenteAtual)}).`);
    }
    if (jaEmitidos.length) linhas.push(`${jaEmitidos.length} mensalidade(s) já emitida(s) serão atualizadas e o Pix reemitido.`);
    if (pagos.length) linhas.push(`${pagos.length} mês(es) já pagos NÃO serão alterados: ${pagos.map(compLabel).join(", ")}.`);

    if (!(await confirmModal({
      title: "Alterar mensalidade",
      message: linhas.join("\n\n"),
      confirmLabel: "Alterar",
    }))) return;

    setBusy(true);
    try {
      const r = await run(api.alterarMensalidade(client.id, {
        valor: novoValor, escopo, aplicarNoMesAtual,
        meses: Number(meses) || 1, inicio,
        competencias: escopo === "competencias" ? marcados : undefined,
        motivo,
      }));
      toast(
        escopo === "recorrente"
          ? `Mensalidade de ${client.name} agora é ${money(novoValor)}/mês.`
          : `${money(novoValor)} aplicado em ${r.competencias.length - (r.bloqueados?.length || 0)} mês(es).`,
        "success"
      );
      close();
    } finally { setBusy(false); }
  };

  // Tira o combinado de um mês: ele volta a seguir o valor recorrente
  const limpar = async (comp) => {
    if (!(await confirmModal({
      title: "Remover valor combinado",
      message: `${compLabel(comp)} volta a custar ${money(recorrenteAtual)}, o valor normal de ${client.name}.`,
      confirmLabel: "Remover",
    }))) return;
    await run(api.alterarMensalidade(client.id, { escopo: "limpar", competencias: [comp] }));
    toast(`${compLabel(comp)} voltou ao valor normal.`);
  };

  const combinados = (data.precos || [])
    .filter((p) => p.clientId === client.id && p.competencia >= addComp(atual, -JANELA_ATRAS))
    .sort((a, b) => a.competencia.localeCompare(b.competencia));

  return (
    <Modal
      size="md"
      title="Alterar mensalidade"
      subheader={<>
        <b>{client.name}</b> · hoje paga <b style={{ color: "var(--terracota)" }}>{money(recorrenteAtual)}</b>/mês
        {client.monthlyValue != null ? " (valor individual)" : client.weeklyFreq ? ` (tabela — ${client.weeklyFreq}x/semana)` : ""}
      </>}
      footer={<>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={close}>Cancelar</button>
        <button className="btn" onClick={salvar} disabled={busy || !valido}>{busy ? "Salvando…" : "Alterar"}</button>
      </>}
    >
      <div className="row2">
        <div className="field">
          <label>Novo valor (R$)</label>
          <input type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
          {valido && novoValor !== recorrenteAtual && (
            <div className="help" style={{ marginTop: ".4rem" }}>
              {novoValor < recorrenteAtual
                ? <>↓ {money(recorrenteAtual - novoValor)} a menos ({Math.round((1 - novoValor / (recorrenteAtual || 1)) * 100)}% de desconto)</>
                : <>↑ {money(novoValor - recorrenteAtual)} a mais</>}
            </div>
          )}
        </div>
        <div className="field">
          <label>Vale para</label>
          <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
        </div>
      </div>

      {escopo === "recorrente" && (
        <div className="field">
          <button
            type="button"
            onClick={() => setAplicarNoMesAtual(!aplicarNoMesAtual)}
            style={{
              display: "flex", alignItems: "flex-start", gap: ".6rem", width: "100%", textAlign: "left",
              padding: ".65rem .85rem", borderRadius: 10, cursor: "pointer", transition: "all .18s",
              border: `1.5px solid ${aplicarNoMesAtual ? "var(--green-deep)" : "var(--line)"}`,
              background: aplicarNoMesAtual ? "rgba(28,94,51,.07)" : "var(--cream)",
            }}
          >
            <span style={{ fontSize: "1.05rem" }}>{aplicarNoMesAtual ? "✅" : "⬜"}</span>
            <span>
              <b style={{ color: aplicarNoMesAtual ? "var(--green-deep)" : "var(--muted)" }}>
                Aplicar também na mensalidade de {compLabel(atual)}
              </b>
              <div className="help" style={{ marginTop: ".2rem" }}>
                {invDe(atual)?.status === "pago"
                  ? `A de ${compLabel(atual)} já está paga — ela não será alterada de qualquer forma.`
                  : invDe(atual)
                    ? "A mensalidade deste mês já foi emitida: o valor é corrigido e o Pix reemitido."
                    : `Sem esta marcação, o valor novo começa a valer em ${compLabel(addComp(atual, 1))}.`}
              </div>
            </span>
          </button>
        </div>
      )}

      {escopo === "promocao" && (
        <div className="row2">
          <div className="field">
            <label>Por quantos meses</label>
            <Select
              value={String(meses)}
              onChange={setMeses}
              options={[2, 3, 4, 6, 12].map((n) => ({ value: String(n), label: `${n} meses`, icon: "🎁" }))}
            />
          </div>
          <div className="field">
            <label>Começando em</label>
            <Select
              value={inicio}
              onChange={setInicio}
              options={Array.from({ length: 13 }, (_, i) => addComp(atual, i)).map((c) => ({
                value: c, label: compLabel(c), icon: "📆",
              }))}
            />
          </div>
        </div>
      )}

      {escopo === "competencias" && (
        <div className="field">
          <label>Meses que recebem este valor <span className="cfg-count">{marcados.length}</span></label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", marginTop: ".3rem" }}>
            {janela.map((comp) => {
              const inv = invDe(comp);
              const pago = inv?.status === "pago";
              const on = marcados.includes(comp);
              return (
                <button
                  key={comp}
                  type="button"
                  disabled={pago}
                  onClick={() => toggleMes(comp)}
                  title={pago ? "Já paga — não pode ser alterada" : inv ? "Mensalidade já emitida — o Pix será reemitido" : "Ainda sem boleto"}
                  style={{
                    padding: ".35rem .7rem", borderRadius: 999, fontSize: ".82rem",
                    cursor: pago ? "not-allowed" : "pointer", opacity: pago ? 0.45 : 1,
                    border: `1.5px solid ${on ? "var(--green-deep)" : "var(--line)"}`,
                    background: on ? "rgba(28,94,51,.1)" : "var(--cream)",
                    color: on ? "var(--green-deep)" : "var(--muted)",
                    fontWeight: on ? 600 : 400, transition: "all .15s",
                  }}
                >
                  {compLabel(comp)}{pago ? " ✓" : inv ? " ⏳" : ""}
                </button>
              );
            })}
          </div>
          <div className="help" style={{ marginTop: ".45rem" }}>
            ✓ = já paga (travada) · ⏳ = boleto já emitido (será atualizado e o Pix reemitido)
          </div>
        </div>
      )}

      <div className="field">
        <label>Motivo <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span></label>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: indicou uma amiga, promoção de aniversário" />
      </div>

      {/* Prévia: o que vai acontecer, mês a mês */}
      {alvos.length > 0 && valido && (
        <div className="cfg-preview" style={{ marginTop: ".2rem" }}>
          <b>Ficará assim:</b>
          <div style={{ marginTop: ".4rem" }}>
            {alvos.map((comp) => {
              const inv = invDe(comp);
              const pago = inv?.status === "pago";
              const antes = mensalidadeDaComp(client, comp, data.meta, data.precos);
              return (
                <div key={comp} className="hist-row">
                  <span className="hist-comp">{compLabel(comp)}</span>
                  <span className="hist-val">
                    {pago ? money(inv.amountCents / 100)
                      : <>{antes !== novoValor && <span style={{ textDecoration: "line-through", color: "var(--muted)", marginRight: ".4rem" }}>{money(antes)}</span>}<b>{money(novoValor)}</b></>}
                  </span>
                  <span className="hist-st">
                    {pago ? <span className="badge b-ok">já paga — não muda</span>
                      : inv ? <span className="badge b-warn">boleto atualizado</span>
                      : <span className="badge b-muted">quando for gerado</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {escopo !== "recorrente" && (
            <div className="help" style={{ marginTop: ".45rem" }}>
              Depois desses meses, {client.name.split(" ")[0]} volta a pagar {money(recorrenteAtual)}.
            </div>
          )}
        </div>
      )}

      {/* Combinados que já existem — para poder desfazer sem adivinhação */}
      {combinados.length > 0 && (
        <div className="field" style={{ marginTop: ".6rem" }}>
          <label>Valores já combinados</label>
          {combinados.map((p) => (
            <div key={p.id} className="hist-row">
              <span className="hist-comp">{compLabel(p.competencia)}</span>
              <span className="hist-val"><b>{money(p.amountCents / 100)}</b>{p.motivo ? <span className="cli-sub"> · {p.motivo}</span> : null}</span>
              <span className="hist-st">
                <button className="btn ghost sm" onClick={() => limpar(p.competencia)}>Remover</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ============ Reajuste geral das mensalidades ============
   Duas coisas diferentes acontecem aqui, e a tela separa as duas porque errar
   isso custa dinheiro:

   1. A TABELA (plano 1x/2x) sobe. É ela que define o valor de quem entrar
      depois e de quem hoje paga o preço de tabela — essas alunas são reajustadas
      automaticamente, sem precisar de lista.
   2. Quem tem VALOR INDIVIDUAL não é arrastada junto. Esse valor foi combinado
      (desconto de amiga, acerto antigo) e subir sozinho seria desfazer um acordo
      sem ninguém notar. Por isso a lista aparece e você marca quem entra.

   O reajuste vale do próximo boleto em diante: mensalidade já emitida não é
   mexida — quem já recebeu o Pix não deve receber outro cobrando mais. */
export function ReajusteGeral() {
  const { data, run } = useStore();
  const { close } = useModal();
  const [tipo, setTipo] = useState("percentual");
  const [valor, setValor] = useState("10");
  const [atualizarTabela, setAtualizarTabela] = useState(true);
  const [marcados, setMarcados] = useState([]);
  const [busy, setBusy] = useState(false);

  const n = Number(String(valor).replace(",", "."));
  const valido = Number.isFinite(n) && n !== 0;
  const aplicar = (base) => Math.max(0, Math.round((tipo === "percentual" ? base * (1 + n / 100) : base + n) * 100) / 100);

  const mensalistas = data.clients.filter((c) => c.plan === "mensalista" && c.status !== "cancelado");
  const individuais = mensalistas.filter((c) => c.monthlyValue != null).sort((a, b) => a.name.localeCompare(b.name));
  const naTabela = mensalistas.filter((c) => c.monthlyValue == null);
  const p1 = data.meta?.valorPlano1x ?? 120;
  const p2 = data.meta?.valorPlano2x ?? 200;

  const toggle = (id) => setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const todos = () => setMarcados(marcados.length === individuais.length ? [] : individuais.map((c) => c.id));

  const salvar = async () => {
    if (!valido) return toast("Informe o reajuste.", "error");
    if (!atualizarTabela && !marcados.length) return toast("Nada foi marcado para reajustar.", "error");

    const linhas = [];
    if (atualizarTabela) {
      linhas.push(`Tabela: 1x/semana ${money(p1)} → ${money(aplicar(p1))} · 2x/semana ${money(p2)} → ${money(aplicar(p2))}.`);
      linhas.push(`${naTabela.length} aluna(s) que pagam o preço de tabela passam a pagar o valor novo. Quem se matricular a partir de agora também.`);
    }
    if (marcados.length) linhas.push(`${marcados.length} aluna(s) com valor individual serão reajustadas.`);
    if (individuais.length - marcados.length > 0) {
      linhas.push(`${individuais.length - marcados.length} aluna(s) com valor individual ficam como estão.`);
    }
    linhas.push("As mensalidades já emitidas não mudam — o reajuste vale do próximo boleto em diante.");

    if (!(await confirmModal({ title: "Aplicar reajuste", message: linhas.join("\n\n"), confirmLabel: "Aplicar" }))) return;

    setBusy(true);
    try {
      const r = await run(api.reajuste({ tipo, valor: n, atualizarTabela, individuais: marcados }));
      toast(`Reajuste aplicado.${r.tabela ? ` Tabela: ${money(r.tabela.plano1x)} / ${money(r.tabela.plano2x)}.` : ""}`, "success");
      close();
    } finally { setBusy(false); }
  };

  return (
    <Modal
      size="md"
      title="Reajuste geral"
      subheader={<>{mensalistas.length} mensalista(s) ativa(s) · {naTabela.length} no preço de tabela · {individuais.length} com valor individual</>}
      footer={<>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={close}>Cancelar</button>
        <button className="btn" onClick={salvar} disabled={busy || !valido}>{busy ? "Aplicando…" : "Aplicar reajuste"}</button>
      </>}
    >
      <div className="row2">
        <div className="field">
          <label>Tipo de reajuste</label>
          <Select
            value={tipo}
            onChange={setTipo}
            options={[
              { value: "percentual", label: "Percentual", hint: "ex.: 10% sobre o valor de cada uma", icon: "％" },
              { value: "reais", label: "Valor fixo (R$)", hint: "ex.: R$ 15 a mais para todo mundo", icon: "💵" },
            ]}
          />
        </div>
        <div className="field">
          <label>{tipo === "percentual" ? "Percentual (%)" : "Valor (R$)"}</label>
          <input type="number" step={tipo === "percentual" ? "0.5" : "1"} value={valor} onChange={(e) => setValor(e.target.value)} />
          <div className="help" style={{ marginTop: ".4rem" }}>Use número negativo para reduzir.</div>
        </div>
      </div>

      <div className="field">
        <button
          type="button"
          onClick={() => setAtualizarTabela(!atualizarTabela)}
          style={{
            display: "flex", alignItems: "flex-start", gap: ".6rem", width: "100%", textAlign: "left",
            padding: ".65rem .85rem", borderRadius: 10, cursor: "pointer", transition: "all .18s",
            border: `1.5px solid ${atualizarTabela ? "var(--green-deep)" : "var(--line)"}`,
            background: atualizarTabela ? "rgba(28,94,51,.07)" : "var(--cream)",
          }}
        >
          <span style={{ fontSize: "1.05rem" }}>{atualizarTabela ? "✅" : "⬜"}</span>
          <span>
            <b style={{ color: atualizarTabela ? "var(--green-deep)" : "var(--muted)" }}>Reajustar a tabela de preços</b>
            <div className="help" style={{ marginTop: ".2rem" }}>
              {valido
                ? <>1x/semana <b>{money(p1)} → {money(aplicar(p1))}</b> · 2x/semana <b>{money(p2)} → {money(aplicar(p2))}</b>.
                    Atinge as {naTabela.length} aluna(s) sem valor próprio e todas as matrículas novas.</>
                : "Define o valor de quem entrar depois e de quem hoje paga o preço de tabela."}
            </div>
          </span>
        </button>
      </div>

      {individuais.length > 0 && (
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            Alunas com valor individual <span className="cfg-count">{marcados.length}/{individuais.length}</span>
            <div style={{ flex: 1 }} />
            <button className="btn ghost sm" type="button" onClick={todos}>
              {marcados.length === individuais.length ? "Desmarcar todas" : "Marcar todas"}
            </button>
          </label>
          <div className="help" style={{ marginBottom: ".4rem" }}>
            Elas têm valor combinado. Marque só quem deve receber o reajuste — as demais ficam como estão.
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {individuais.map((c) => {
              const on = marcados.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: ".6rem", width: "100%", textAlign: "left",
                    padding: ".45rem .7rem", marginBottom: ".3rem", borderRadius: 8, cursor: "pointer",
                    border: `1.5px solid ${on ? "var(--green-deep)" : "var(--line)"}`,
                    background: on ? "rgba(28,94,51,.07)" : "var(--cream)",
                  }}
                >
                  <span>{on ? "✅" : "⬜"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: ".9rem" }}>{c.name}</b>
                    <span className="cli-sub"> · {c.weeklyFreq ? `${c.weeklyFreq}x/semana` : "plano antigo"}</span>
                  </span>
                  <span className="cli-sub" style={{ whiteSpace: "nowrap" }}>
                    {money(c.monthlyValue)}
                    {on && valido && <> → <b style={{ color: "var(--terracota)" }}>{money(aplicar(c.monthlyValue))}</b></>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="cfg-warn" style={{ marginTop: ".4rem" }}>
        ⚠️ Não há "desfazer": o sistema não guarda qual era o valor de cada aluna antes.
        Confira a conta acima antes de aplicar.
      </div>
    </Modal>
  );
}

/* ====== Baixa manual de uma mensalidade ======

   Toda baixa dada pelo painel é manual: o Pix pago cai sozinho pelo webhook do
   Sicredi, sem passar por aqui. Então clicar em "Baixar" é dizer "recebi por
   fora" — e quem paga por fora não usa Pix. Por isso a mensalidade SEGUINTE
   nasce sem QR, e a aluna não recebe cobrança daquele mês.

   O aviso está no texto da confirmação de propósito: é a última tela antes da
   consequência, e ela não tem desfazer automático (o caminho de volta é o botão
   "Gerar Pix" da mensalidade seguinte). Devolve true quando a baixa aconteceu.

   Usado no perfil da aluna (MensalidadesPanel) e na aba Mensalistas — o mesmo
   ato precisa ter o mesmo efeito nos dois lugares. */
export const NOTA_BAIXA_MANUAL =
  "Ao dar baixa, a próxima mensalidade (a vencer) nasce sem Pix: nenhum código é enviado para o WhatsApp da aluna nem aparece no portal dela. Use quando ela acertar por fora (dinheiro, transferência, combinado).";

export async function baixarMensalidade(inv, run, nome = "") {
  const prox = compLabel(addComp(inv.competencia, 1));
  const ok = await confirmModal({
    title: "Dar baixa na mensalidade",
    message:
      `Marcar a mensalidade de ${compLabel(inv.competencia)}${nome ? ` de ${nome}` : ""} como PAGA?\n\n` +
      `Ela sai de "a receber" e entra no recebido do mês, no Financeiro.\n\n` +
      `⚠️ A mensalidade de ${prox} não terá Pix: a aluna não recebe o código no WhatsApp nem vê o QR no portal. ` +
      `Se precisar do Pix desse mês mesmo assim, use o botão "Gerar Pix" na mensalidade dele.`,
    confirmLabel: "✓ Dar baixa",
    cancelLabel: "Voltar",
  });
  if (!ok) return false;
  try {
    const r = await run(api.payInvoice(inv.id));
    toast(
      r?.proximaSemPix
        ? `Baixa registrada. A mensalidade de ${compLabel(r.proximaSemPix)} ficou sem Pix.`
        : "Baixa registrada. A próxima mensalidade nascerá sem Pix.",
      "success"
    );
    return true;
  } catch {
    return false; // o erro já foi mostrado pelo run
  }
}

/* ====== Mensalidades do aluno (fechamento + pagamento) ======
   Mês a mês desde a primeira matrícula. Meses sem boleto aparecem como
   "não gerado" — o sistema não cria cobrança retroativa. */
function MensalidadesPanel({ client }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const [busy, setBusy] = useState(false);
  const comps = competenciasDoAluno(client);
  const invs = (data.invoices || []).filter((i) => i.clientId === client.id);
  const valorPadrao = mensalidadeDe(client, data.meta);
  const totalPago = invs.filter((i) => i.status === "pago").reduce((s, i) => s + i.amountCents / 100, 0);
  // Em aberto vale pelo total do dia: a vencida já carrega multa e juros.
  const emAberto = invs.filter((i) => i.status === "pendente")
    .reduce((s, i) => s + (i.encargos ? i.encargos.total : i.amountCents / 100), 0);
  const ini = matriculaISO(client);
  /* Meses futuros só aparecem quando têm algo combinado (promoção, desconto já
     acertado) — senão a lista viraria um calendário de meses vazios. */
  const futurosComCombinado = (data.precos || [])
    .filter((p) => p.clientId === client.id && p.competencia > compAtual())
    .map((p) => p.competencia)
    .sort()
    .reverse();
  const linhas = [...futurosComCombinado, ...comps];
  const temAberto = invs.some((i) => i.status === "pendente");

  const baixar = async (inv) => {
    setBusy(true);
    try { await baixarMensalidade(inv, run, client.name); }
    finally { setBusy(false); }
  };
  /* Saída da supressão: pedir o Pix limpa a marca no backend e emite o QR. */
  const gerarPix = async (inv) => {
    setBusy(true);
    try {
      const r = await run(api.reemitirPix(inv.id));
      if (r?.pixCode) { navigator.clipboard?.writeText(r.pixCode); toast("Pix gerado e copiado! 📋", "success"); }
      else toast("Pix gerado.", "success");
    } catch { /* erro já reportado pelo run */ }
    finally { setBusy(false); }
  };

  return (
    <div className="prof-panel">
      <div className="prof-panel-h">
        <b>🧾 Mensalidades · fechamento</b>
        <span className="cli-sub">{ini ? `desde ${fmtDate(ini)}` : "sem matrícula"}</span>
      </div>
      <div className="cli-sub" style={{ marginBottom: ".5rem", display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
        <span>
          <b style={{ color: "var(--green-deep)" }}>{money(totalPago)}</b> pago
          {emAberto ? <> · <b style={{ color: "var(--warn)" }}>{money(emAberto)}</b> em aberto</> : null}
          {" · "}mensalidade <b style={{ color: "var(--terracota)" }}>{money(valorPadrao)}</b>
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn sec sm" onClick={() => open(<AlterarMensalidade client={client} />)}>
          💰 Alterar valor
        </button>
      </div>

      {/* O aviso fica na tela, e não só na confirmação: quem chega aqui para dar
          baixa precisa saber da consequência antes de mirar no botão. */}
      {temAberto && (
        <div className="cfg-warn" style={{ marginBottom: ".6rem" }}>
          ⚠️ <b>Baixar</b> marca a mensalidade como paga por fora. A próxima mensalidade
          (a vencer) <b>não terá Pix</b> — nenhum código é enviado para o WhatsApp da aluna
          nem aparece no portal dela. Se precisar do Pix desse mês, use <b>💠 Gerar Pix</b> nele.
        </div>
      )}

      <div>
        {linhas.map((comp) => {
          const inv = invs.find((i) => i.competencia === comp);
          const combinado = precoDaComp(data.precos, client.id, comp);
          // Sem boleto ainda, o valor que aparece é o que ele vai nascer cobrando
          const valor = inv ? inv.amountCents / 100 : (combinado ? combinado.amountCents / 100 : valorPadrao);
          return (
            <div className="hist-row" key={comp}>
              <span className="hist-comp">
                {compLabel(comp)}
                {combinado && <span className="cli-sub"> · {combinado.origem === "promocao" ? "promoção" : "combinado"}{combinado.motivo ? `: ${combinado.motivo}` : ""}</span>}
              </span>
              <span className="hist-val" title={inv?.encargos?.atrasada
                ? `${money(valor)} + multa ${money(inv.encargos.multa)} + juros ${money(inv.encargos.juros)}`
                : combinado ? `Valor combinado para este mês (o normal é ${money(valorPadrao)})` : undefined}>
                {inv?.encargos?.atrasada ? money(inv.encargos.total) : money(valor)}
              </span>
              <span className="hist-st">
                {!inv ? <span className={combinado ? "badge b-warn" : "badge b-muted"}>{combinado ? "🎁 valor combinado" : "não gerado"}</span>
                  : inv.status === "pago" ? <span className="badge b-ok" title={inv.baixaManual ? "Baixa dada no painel — recebido por fora do Pix" : "Confirmado pelo Sicredi"}>
                      ✓ {inv.paidAt ? fmtDate(String(inv.paidAt).slice(0, 10)) : "pago"}{inv.baixaManual ? " · baixa manual" : ""}
                    </span>
                  : inv.status === "cancelado" ? <span className="badge b-danger">cancelado</span>
                  : inv.encargos?.atrasada ? <span className="badge b-danger">⚠️ {inv.encargos.dias} dia(s) de atraso</span>
                  : <span className="badge b-warn">⏳ vence {fmtDate(inv.dueDate)}</span>}
                {inv?.status === "pendente" && inv.semPix && (
                  <span className="badge b-muted ml" title="A mensalidade anterior teve baixa manual, então esta nasceu sem Pix. O botão ao lado gera o código assim mesmo.">
                    💠 sem Pix
                  </span>
                )}
              </span>
              {inv && inv.status === "pendente" && (
                <span className="hist-act">
                  {inv.semPix && (
                    <button className="btn sec sm" disabled={busy} onClick={() => gerarPix(inv)}>💠 Gerar Pix</button>
                  )}
                  <button className="btn sm" disabled={busy} onClick={() => baixar(inv)}>✓ Baixar</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Últimas movimentações do aluno: aulas, pagamentos, mensalidades, reposição. */
function atividadesDoAluno(data, c) {
  const out = [];
  const add = (d, ic, t, s) => { if (d) out.push({ d: String(d).slice(0, 10), ic, t, s }); };
  data.bookings.filter((b) => b.clientName === c.name).forEach((b) => {
    add(b.createdAt, "🆕", `Aula marcada — ${fmtDate(b.date)} às ${b.time}`, b.unit);
    if (b.status === "cancelada") add(b.date, "❌", `Aula cancelada — ${fmtDate(b.date)}`, b.absenceReason || b.unit);
    if (b.paid && b.paymentDate) add(b.paymentDate, "💰", `Pagou a aula — ${money(b.value)}`, b.paymentMethod || "");
  });
  (data.invoices || []).filter((i) => i.clientId === c.id).forEach((i) => {
    if (i.paidAt) add(i.paidAt, "🧾", `Mensalidade paga — ${compLabel(i.competencia)}`, money(i.amountCents / 100));
    else if (i.status === "pendente") add(i.dueDate, "⏳", `Mensalidade em aberto — ${compLabel(i.competencia)}`, `vence ${fmtDate(i.dueDate)}`);
  });
  (data.makeups || []).filter((k) => k.clientId === c.id).forEach((k) => {
    add(k.originDate, "🔁", "Crédito de reposição gerado", `vale até ${fmtDate(k.expiresOn)}`);
    if (k.usedAt) add(k.usedAt, "✅", "Reposição marcada", "crédito usado");
  });
  add(c.trialDate, "✨", "Aula experimental", "");
  add(c.matriculaAt, "🎟️", "Matriculada — 1ª mensalidade paga", "");
  add(c.matriculaRefundAt, "↩️", "Matrícula devolvida", "");
  return out.sort((a, b) => b.d.localeCompare(a.d)).slice(0, 14);
}

export function ClientProfile({ client, initialTab }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  const c = data.clients.find((x) => x.id === client.id) || client;
  const at = clientAttendance(data, c.name);
  const hist = data.bookings.filter((b) => b.clientName === c.name).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const total = hist.filter((b) => b.status !== "cancelada").length;
  const pago = hist.filter((b) => b.paid).reduce((s, b) => s + b.value, 0);
  const t = todayISO();
  const proxima = hist.filter((b) => b.date >= t && b.status !== "cancelada").sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const ehMensalista = c.plan === "mensalista";
  const temMatricula = c.matriculaStatus && c.matriculaStatus !== "nao_aplica";
  const pendentes = (data.invoices || []).filter((i) => i.clientId === c.id && i.status === "pendente").length;
  const [tab, setTab] = useState(initialTab || "principal");
  const form = useClientForm(c, () => setTab("principal"));
  const atividades = atividadesDoAluno(data, c);

  const abas = [
    { k: "principal", ic: "⭐", label: "Principal", n: null },
    { k: "aulas", ic: "📋", label: "Aulas", n: hist.length },
    ...(ehMensalista ? [{ k: "mens", ic: "🧾", label: "Mensalidades", n: pendentes || null }] : []),
    ...(ehMensalista || temMatricula ? [{ k: "repo", ic: "🔁", label: "Reposição", n: null }] : []),
    { k: "editar", ic: "✏️", label: "Editar", n: null },
  ];

  const resetPin = async () => {
    if (!(await confirmModal({ title: "Redefinir PIN", message: `Redefinir o PIN de ${c.name}?\n\nO PIN atual será apagado e ela criará um novo no próximo acesso ao portal.`, confirmLabel: "Redefinir", tone: "danger" }))) return;
    await run(api.resetPin(c.id));
    toast("PIN redefinido. O(a) aluno(a) criará um novo PIN no próximo acesso. 💚");
  };
  const del = async () => {
    if (!(await confirmModal({ title: "Excluir cadastro", message: `Excluir ${c.name}?\n\nAs aulas futuras serão removidas da agenda; o histórico de aulas passadas é mantido.`, confirmLabel: "Excluir", tone: "danger" }))) return;
    await run(api.deleteClient(c.id));
    toast("Cadastro excluído.");
    close();
  };

  const rodape = tab === "editar" ? (
    <>
      <button className="btn danger" onClick={del}>🗑 Excluir</button>
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={() => setTab("principal")}>Cancelar</button>
      <button className="btn" onClick={form.save}>Salvar alterações</button>
    </>
  ) : (
    <>
      <button className="btn wa" onClick={() => openWa(c.phone, `Olá ${c.name}! 💚`)}><WaIcon /> WhatsApp</button>
      {ehMensalista && <button className="btn" onClick={() => open(<BatchBookForm client={c} />)}>📅 Agendar em lote</button>}
      {c.hasPin && <button className="btn ghost" onClick={resetPin}>🔑 Redefinir PIN</button>}
      <div style={{ flex: 1 }} />
      <button className="btn sec" onClick={() => setTab("editar")}>✏️ Editar cadastro</button>
    </>
  );

  const abasEl = (
    <div className="seg seg-tabs prof-tabs">
      {abas.map((a) => (
        <button key={a.k} className={tab === a.k ? "on" : ""} onClick={() => setTab(a.k)}>
          {a.ic} {a.label}{a.n ? <span className="seg-count">{a.n}</span> : null}
        </button>
      ))}
    </div>
  );

  const cartaoIdentidade = (
    <aside className="prof-side">
      <div className="prof-id">
        <span className="prof-av">{iniciais(c.name)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="prof-id-n">{c.name}</div>
          <div className="prof-chips">
            <span className="chip">{c.unit || "—"}</span>
            {c.status === "cancelado"
              ? <span className="badge b-danger">Inscrição cancelada</span>
              : <span className="badge b-ok">Ativa</span>}
            {c.firstClass ? <span className="badge b-terra">✨ Novo(a)</span> : null}
          </div>
        </div>
      </div>
      <div className="prof-card">
        <h4>Contato e cadastro</h4>
        <div className="prof-dl">
          <div><span className="k">Telefone</span><span className="v">{c.phone || "—"}</span></div>
          {c.cpf ? <div><span className="k">CPF</span><span className="v">{c.cpf}</span></div> : null}
          {c.email ? <div><span className="k">Email</span><span className="v">{c.email}</span></div> : null}
          <div><span className="k">Aniversário</span><span className="v">{c.birthday ? "🎂 " + fmtDate(c.birthday) : "—"}</span></div>
          <div><span className="k">Plano</span><span className="v">{planoLabel(c, data.meta)}</span></div>
          {c.plan === "mensalista" && (
            <div>
              <span className="k">Mensalidade</span>
              <span className="v" style={{ display: "flex", alignItems: "center", gap: ".4rem", justifyContent: "flex-end" }}>
                <b style={{ color: "var(--terracota)" }}>{money(mensalidadeDe(c, data.meta))}</b>
                <button className="btn ghost sm" onClick={() => open(<AlterarMensalidade client={c} />)}>Alterar</button>
              </span>
            </div>
          )}
          <div><span className="k">Vencimento boleto/PIX</span><span className="v">{c.billingDay ? `Dia ${c.billingDay}` : `Dia ${data.meta?.vencimentoDia || 10} (padrão)`}</span></div>
          <div><span className="k">Portal (PIN)</span><span className="v">{c.hasPin ? <span className="badge b-ok">cadastrado</span> : <span className="badge b-muted">sem PIN</span>}</span></div>
          {(c.tags || []).length ? <div><span className="k">Etiquetas</span><span className="v tags" style={{ justifyContent: "flex-end" }}>{c.tags.map((x) => <span key={x} className="chip">{x}</span>)}</span></div> : null}
        </div>
      </div>
      {c.notes ? <div className="prof-card"><h4>Observações</h4><div className="cli-sub" style={{ lineHeight: 1.45 }}>{c.notes}</div></div> : null}
    </aside>
  );

  return (
    <Modal size="lg" title={c.name} subheader={abasEl} footer={rodape}>
      {tab === "principal" && (
        <div className="prin">
          {cartaoIdentidade}
          <div className="prin-main">
            <div className="prof-kpis">
              <div className="prof-kpi"><div className="l">Aulas</div><div className="v">{total}</div></div>
              <div className="prof-kpi"><div className="l">Presenças</div><div className="v">{at.pres}</div><div className="f">{at.falt} falta(s)</div></div>
              <div className="prof-kpi"><div className="l">Pago em aulas</div><div className="v terra">{money(pago)}</div></div>
              <div className="prof-kpi">
                <div className="l">Próxima aula</div>
                <div className="v" style={{ fontSize: proxima ? "1.15rem" : "1.45rem" }}>{proxima ? fmtDate(proxima.date) : "—"}</div>
                <div className="f">{proxima ? `${proxima.time} · ${proxima.unit}` : "nada agendado"}</div>
              </div>
            </div>
            <div className="prof-panel">
              <div className="prof-panel-h">
                <b>🔔 Últimas movimentações</b>
                {pendentes ? <span className="badge b-warn">{pendentes} mensalidade(s) em aberto</span> : null}
              </div>
              <div className="feed">
                {atividades.length ? atividades.map((a, i) => (
                  <div className="feed-row" key={i}>
                    <span className="feed-ic">{a.ic}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="feed-t">{a.t}</div>
                      {a.s ? <div className="feed-s">{a.s}</div> : null}
                    </div>
                    <span className="feed-d">{fmtDate(a.d)}</span>
                  </div>
                )) : <div className="prof-empty">Nenhuma movimentação registrada.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "aulas" && (
        <div className="prof-panel">
          <div className="prof-panel-h">
            <b>📋 Histórico de aulas</b>
            <span className="cli-sub">{hist.length} no total</span>
          </div>
          {hist.length ? hist.map((b) => {
            const k = bookingKind(b);
            return (
              <div className="prof-hist" key={b.id} onClick={() => open(<ManageBooking booking={b} onBack={() => open(<ClientProfile client={client} />)} />)}>
                <div style={{ minWidth: 0 }}>
                  <div className="d">{fmtDate(b.date)} · {b.time}</div>
                  <div className="s">{b.unit}{b.attendance === "presente" ? " · ✓ presente" : b.attendance === "falta" ? " · ✕ faltou" : ""}</div>
                </div>
                <div className="r">
                  {k && <span className={`badge ${k.cls}`}>{k.ic} {k.label}</span>}
                  {b.paid && <span className="cli-sub">{money(b.value)}</span>}
                  <StatusBadge status={b.status} />
                </div>
              </div>
            );
          }) : <div className="prof-empty">Sem histórico ainda.</div>}
        </div>
      )}

      {tab === "mens" && <MensalidadesPanel client={c} />}

      {tab === "repo" && (
        <div className="prof-panel">
          {temMatricula && <MatriculaBlock client={c} />}
          {ehMensalista && <MakeupBlock client={c} />}
        </div>
      )}

      {tab === "editar" && <ClientFormFields f={form} />}
    </Modal>
  );
}

/* ============ Plano e matrícula (admin) ============ */
export function planoLabel(c, meta = {}) {
  if (c.plan !== "mensalista") return <span className="badge b-muted">Avulso</span>;
  const valor = c.monthlyValue != null ? c.monthlyValue
    : c.weeklyFreq === 2 ? (meta.valorPlano2x ?? 200)
    : c.weeklyFreq === 1 ? (meta.valorPlano1x ?? 120)
    : (meta.mensalidadeValor ?? 0);
  const freq = c.weeklyFreq ? `${c.weeklyFreq}x por semana` : "plano antigo";
  const tipo = tipoMensalista(c);
  return (<>
    <span className="badge b-ok">📅 {freq}</span>{" "}
    <span className="badge b-info">{tipo === "escala" ? "🙋" : "📌"} {TIPO_MENSALISTA_LABEL[tipo]}</span>{" "}
    <span className="cli-sub">{money(valor)}/mês</span>
    {c.podeSabado && (
      <> <span className="cli-sub" title="Direito herdado: ela já estava marcando no sábado quando a regra mudou.">
        · pode sábado
      </span></>
    )}
  </>);
}

const MATRICULA_ROTULO = {
  pendente: ["b-warn", "1ª mensalidade pendente"],
  paga: ["b-ok", "1ª mensalidade paga — aguardando decisão"],
  convertida: ["b-ok", "Matriculada"],
  devolvida: ["b-muted", "Mensalidade devolvida"],
};

function MatriculaBlock({ client }) {
  const { data, run } = useStore();
  const { open } = useModal();
  if (client.matriculaStatus === "nao_aplica") return null;
  const [cls, txt] = MATRICULA_ROTULO[client.matriculaStatus] || ["b-muted", client.matriculaStatus];
  /* Não existe mais taxa de matrícula: o que ela pagou para entrar foi a 1ª
     mensalidade, no valor cheio do plano. Mostra o que de fato foi cobrado —
     a reserva da experimental guarda esse valor. */
  const reservaMatricula = (data.bookings || [])
    .filter((b) => b.clientName === client.name && MARCAS_MATRICULA.includes(b.paymentMethod))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const valorEntrada = reservaMatricula?.value ?? mensalidadeDe(client, data.meta);
  /* A devolução vale também depois da conversão: a aluna nova já sai matriculada
     ao pagar, então "não quis continuar" precisa desfazer essa matrícula — e não
     só registrar o estorno. */
  const podeDevolver = client.matriculaStatus === "paga" || client.matriculaStatus === "convertida";
  const podeConverter = client.plan !== "mensalista" && client.matriculaStatus !== "devolvida";

  const devolver = async () => {
    const t = todayISO();
    const aulas = (data.bookings || []).filter(
      (b) => b.clientName === client.name && b.date >= t && b.status !== "cancelada" && !MARCAS_MATRICULA.includes(b.paymentMethod)
    ).length;
    const compMatricula = (client.matriculaAt || t).slice(0, 7);
    const mensalidades = (data.invoices || []).filter((i) => i.clientId === client.id
      && (i.status === "pendente" || (i.status === "pago" && i.competencia === compMatricula))).length;
    if (!(await confirmModal({
      title: "Devolver a mensalidade",
      message: `Confirmar a devolução INTEGRAL de ${money(valorEntrada)} para ${client.name}?\n\n` +
        (client.plan === "mensalista" ? "• A matrícula é desfeita — ela volta a ser avulsa\n" : "") +
        (aulas ? `• ${aulas} aula(s) futura(s) serão canceladas\n` : "") +
        (mensalidades ? `• ${mensalidades} mensalidade(s) serão canceladas (inclusive a do mês da matrícula, que está paga)\n` : "") +
        "\nO sistema só registra — o Pix de volta você faz por fora.",
      confirmLabel: "Devolver e desfazer", tone: "danger",
    }))) return;
    try {
      const r = await run(api.refundMatricula(client.id));
      const d = r?.desfez;
      toast(d
        ? `Devolução registrada. ${d.aulas} aula(s) e ${d.mensalidades} mensalidade(s) canceladas.`
        : "Devolução registrada.");
    }
    catch { /* run já avisou */ }
  };

  return (
    <div style={{ margin: "1rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".5rem", gap: ".5rem", flexWrap: "wrap" }}>
        <b style={{ color: "var(--brown)" }}>🎟️ Matrícula · {money(valorEntrada)}</b>
        <span className={`badge ${cls}`}>{txt}</span>
      </div>
      <div className="cli-sub">
        {client.trialDate ? <>Aula experimental em <b>{fmtDate(client.trialDate)}</b>. </> : null}
        {client.matriculaAt ? <>1ª mensalidade paga em {fmtDate(client.matriculaAt)}. </> : null}
        {client.matriculaRefundAt ? <>Devolvida em {fmtDate(client.matriculaRefundAt)}.</> : null}
      </div>
      <div style={{ display: "flex", gap: ".5rem", marginTop: ".6rem", flexWrap: "wrap" }}>
        {podeConverter && <button className="btn sm" onClick={() => open(<EnrollForm client={client} />)}>🧵 Matricular como mensalista</button>}
        {podeDevolver && <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={devolver}>↩️ Registrar devolução</button>}
      </div>
    </div>
  );
}

/* Matricular: escolhe o plano e (opcionalmente) já agenda a 1ª aula oficial. */
export function EnrollForm({ client }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const meta = data.meta || {};
  const [freq, setFreq] = useState(1);
  const [tipo, setTipo] = useState("fixo");
  const [slotId, setSlotId] = useState("");
  const [busy, setBusy] = useState(false);
  const t = todayISO();
  const livres = data.slots
    .filter((s) => s.date >= t && slotBookings(data, s.id).length < slotCapacity(s))
    // A 1ª aula oficial já é aula de mensalista: sábado saiu do plano e não
    // entra para quem está começando agora. A turma das 18h entra normalmente.
    .filter((s) => !ehSabadoISO(s.date))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const valor = freq === 2 ? (meta.valorPlano2x ?? 200) : (meta.valorPlano1x ?? 120);

  const salvar = async () => {
    if (!(await confirmModal({
      title: "Confirmar matrícula",
      message: `Matricular ${client.name} no plano de ${freq}x por semana (${money(valor)}/mês), como mensalista ${tipo}?\n\n` +
        (slotId ? "A 1ª aula oficial será agendada e " : "") + "a primeira mensalidade será gerada agora.",
      confirmLabel: "Matricular",
    }))) return;
    setBusy(true);
    try {
      const r = await run(api.enroll(client.id, { weeklyFreq: freq, mensalistaTipo: tipo, slotId: slotId || undefined }));
      toast(`Matrícula concluída — ${money(r.valorMensal)}/mês.${r.invoice ? "" : " Atenção: a mensalidade não foi gerada."}`,
        r.invoice ? "success" : "info");
      open(<ClientProfile client={client} />);
    } catch { /* run já avisou */ }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Matricular como mensalista" footer={<>
      <button className="btn ghost" onClick={() => open(<ClientProfile client={client} />)}>← Voltar ao perfil</button>
      <div style={{ flex: 1 }} />
      <button className="btn" onClick={salvar} disabled={busy}>{busy ? "Matriculando…" : "Matricular"}</button>
    </>}>
      <div className="help">
        Matricular gera a mensalidade e passa a emitir o Pix todo mês, com vencimento no dia {meta.vencimentoDia || 10}.
        Se ela já pagou a 1ª mensalidade pela tela da aula experimental, o mês corrente entra como quitado.
      </div>
      <div className="field" style={{ marginTop: "1rem" }}>
        <label>Plano</label>
        <Select
          value={freq}
          onChange={(v) => setFreq(Number(v))}
          options={[
            { value: 1, label: "1x por semana", hint: "4 aulas por mês", icon: "📅", meta: money(meta.valorPlano1x ?? 120) },
            { value: 2, label: "2x por semana", hint: "8 aulas por mês", icon: "📅", meta: money(meta.valorPlano2x ?? 200) },
          ]}
        />
      </div>
      <div className="field">
        <label>Tipo de mensalista</label>
        <Select
          value={tipo}
          onChange={setTipo}
          options={TIPO_MENSALISTA_OPCOES}
        />
      </div>
      <div className="field">
        <label>1ª aula oficial <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span></label>
        <div className="help" style={{ marginBottom: ".4rem" }}>Sábado não faz parte do plano — por isso não aparece na lista.</div>
        <Select
          value={slotId}
          onChange={setSlotId}
          defaultOption={{ label: "Agendar depois", icon: "⏳" }}
          options={livres.slice(0, 60).map((s) => {
            const vagas = slotCapacity(s) - slotBookings(data, s.id).length;
            return {
              value: s.id,
              label: `${fmtDate(s.date)} · ${faixaHorario(s.time, meta.duracaoAulaMin)}`,
              hint: `${s.unit} — ${vagas} vaga(s)`,
              icon: "🧶",
            };
          })}
        />
      </div>
      <div className="info-line"><b>Mensalidade</b><span><b style={{ color: "var(--terracota)" }}>{money(valor)}</b>/mês</span></div>
    </Modal>
  );
}

/* ============ Reposição: saldo, histórico e marcação (admin) ============ */
function MakeupBlock({ client }) {
  const { data } = useStore();
  const { open } = useModal();
  const t = todayISO();
  // o /api/state já traz todos os créditos; filtra os desta aluna
  const creditos = (data.makeups || [])
    .filter((m) => m.clientId === client.id)
    .map((m) => ({ ...m, situacao: m.usedBookingId ? "usado" : m.expiresOn < t ? "expirado" : "disponivel" }));
  const saldo = creditos.filter((m) => m.situacao === "disponivel").length;
  // espelha elegivelReposicao do backend, só para a tela avisar antes de tentar
  const emAtraso = (data.invoices || []).some((i) => i.clientId === client.id && i.status === "pendente" && i.dueDate < t);
  // teto de 2 reposições marcadas dentro do mês corrente (o backend também barra)
  const comp = t.slice(0, 7);
  const reposNoMes = (data.bookings || []).filter(
    (b) => b.clientName === client.name && b.paymentMethod === "Reposição" && b.status !== "cancelada" && (b.date || "").slice(0, 7) === comp
  ).length;
  const noLimite = reposNoMes >= 2;
  const bloqueio = client.status === "cancelado"
    ? "Inscrição cancelada — sem direito a reposição."
    : emAtraso ? "Mensalidade em atraso — sem direito a reposição."
    : noLimite ? `Já são ${reposNoMes} reposições marcadas neste mês — o limite é 2.` : "";

  const rotulo = { disponivel: ["b-ok", "disponível"], usado: ["b-muted", "usado"], expirado: ["b-danger", "expirou"] };

  return (
    <div style={{ margin: "1rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".5rem" }}>
        <b style={{ color: "var(--brown)" }}>🔁 Reposição · {saldo} crédito(s)</b>
        <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={() => open(<ExtraBookForm client={client} />)}>
            ➕ Aula extra
          </button>
          <button className="btn sec sm" disabled={!saldo || !!bloqueio} onClick={() => open(<MakeupBookForm client={client} />)}>
            Marcar reposição
          </button>
        </div>
      </div>
      {bloqueio
        ? <div className="help" style={{ color: "var(--danger)" }}>{bloqueio}</div>
        : <div className="help">Máx. 2 créditos por mês e 2 reposições marcadas por mês ({reposNoMes}/2 neste mês); o crédito vale até o fim do mês seguinte ao da aula liberada.</div>}
      {creditos.length > 0 && (
        <div style={{ marginTop: ".6rem" }}>
          {creditos.slice(0, 6).map((m) => {
            const [cls, txt] = rotulo[m.situacao];
            return (
              <div className="roster-row" key={m.id}>
                <div className="rr-info">
                  <b>Liberou {fmtDate(m.originDate)} · {m.originTime}</b>
                  <div className="cli-sub">{m.competencia} · vale até {fmtDate(m.expiresOn)}{m.usedAt ? ` · usado em ${fmtDate(m.usedAt)}` : ""}</div>
                </div>
                <span className={`badge ${cls}`}>{txt}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Escolha de turma para marcar o aluno — só turmas futuras com vaga livre.
   Serve tanto para a reposição (consome crédito) quanto para a aula extra (paga). */
function SlotPicker({ client, titulo, ajuda, confirmar, acao, sucesso }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const t = todayISO();
  const livres = data.slots
    .filter((s) => s.date >= t && slotBookings(data, s.id).length < slotCapacity(s))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  /* Sábado e horário a partir das 18h saíram do plano de mensalista. Aqui quem
     marca é a Inêz, então a turma continua na lista: ela vê o aviso e decide.
     Confirmando, a chamada vai com `forcar` e o backend deixa passar. */
  const marcar = async (s) => {
    const fora = motivoForaDaRegra(client, s);
    if (!(await confirmModal({
      title: titulo,
      message: confirmar(s) + (fora ? `\n\n⚠️ Atenção: ${fora}. Marcando assim mesmo, você está abrindo uma exceção para ${client.name}.` : ""),
      confirmLabel: fora ? "Marcar mesmo assim" : titulo,
      tone: fora ? "danger" : undefined,
    }))) return;
    try {
      await run(acao(s, !!fora)); // run já avisa o erro na tela
      toast(sucesso);
      open(<ClientProfile client={client} />);
    } catch { /* erro já reportado pelo run */ }
  };
  return (
    <Modal title={titulo} footer={<>
      <button className="btn ghost" onClick={() => open(<ClientProfile client={client} />)}>← Voltar ao perfil</button>
    </>}>
      <div className="help">{ajuda}</div>
      <div style={{ marginTop: ".8rem" }}>
        {livres.length ? livres.slice(0, 40).map((s) => {
          const fora = motivoForaDaRegra(client, s);
          return (
            <div className="roster-row row-click" key={s.id} onClick={() => marcar(s)}>
              <div className="rr-info">
                <b>{fmtDate(s.date)} · {faixaHorario(s.time, data.meta?.duracaoAulaMin)}</b>
                <div className="cli-sub">
                  {s.unit} · {slotCapacity(s) - slotBookings(data, s.id).length} vaga(s)
                  {fora && <> · <span style={{ color: "var(--warn)" }}>⚠️ fora do plano ({fora})</span></>}
                </div>
              </div>
              <button className="btn sec sm">Escolher</button>
            </div>
          );
        }) : <div className="empty" style={{ padding: "1.2rem" }}><div className="ic">🪑</div><p>Nenhuma turma com vaga livre no momento.</p></div>}
      </div>
    </Modal>
  );
}

export function MakeupBookForm({ client }) {
  return (
    <SlotPicker
      client={client}
      titulo="Marcar reposição"
      ajuda="Não há vaga reservada para reposição — aparecem só as turmas que já têm vaga livre. Máximo de 2 reposições dentro do mesmo mês. O crédito só fica válido depois que a data da aula liberada passa, e a reposição não ocupa vaga do plano semanal."
      confirmar={(s) => `Marcar ${client.name} em reposição?\n\n${s.unit}\n${fmtDateLong(s.date)} às ${s.time}\n\nIsso consome 1 crédito.`}
      acao={(s, forcar) => api.makeupBook(client.id, s.id, forcar)}
      sucesso="Reposição marcada. 💚"
    />
  );
}

/* Aula extra pelo painel = CORTESIA. A aluna que compra sozinha faz isso no
   portal (paga o Pix e escolhe o horário depois); este caminho entra sem
   cobrança, para você marcar o que combinou por fora. */
export function ExtraBookForm({ client }) {
  return (
    <SlotPicker
      client={client}
      titulo="Marcar aula extra"
      ajuda="Cortesia: entra confirmada, sem cobrança, sem consumir crédito e sem ocupar vaga do plano semanal. Quando a aluna compra a aula extra pelo portal dela, o Pix é gerado lá e ela mesma escolhe o horário."
      confirmar={(s) => `Marcar ${client.name} em uma aula extra de cortesia (sem cobrança)?\n\n${s.unit}\n${fmtDateLong(s.date)} às ${s.time}`}
      acao={(s, forcar) => api.extraBook(client.id, s.id, forcar)}
      sucesso="Aula extra marcada. 💚"
    />
  );
}

/* ======================= Cliente (novo/editar) ======================= */
/* ============ Agendar aulas em lote (mensalista) ============ */
export function BatchBookForm({ client }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  const meta = data.meta;
  const [unit, setUnit] = useState(client.unit || meta.units[0]);
  const [weeks, setWeeks] = useState(4);
  // turmas escolhidas: chave "dow|HH:MM"
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const t = todayISO();

  /* Turmas recorrentes que EXISTEM nesta unidade: agrupadas por dia da semana + horário.
     Para cada grupo mostramos, dentro do período escolhido, quantas datas dão certo
     e quantas seriam puladas (lotada / já agendada). */
  const grupos = (() => {
    const map = new Map();
    data.slots
      .filter((s) => s.unit === unit && s.date >= t)
      .forEach((s) => {
        const dow = dowMon(s.date);
        const key = `${dow}|${s.time}`;
        if (!map.has(key)) map.set(key, { key, dow, time: s.time, slots: [] });
        map.get(key).slots.push(s);
      });

    const minhas = data.bookings.filter((b) => b.clientName === client.name && b.status !== "cancelada");

    return [...map.values()]
      .map((g) => {
        const noPeriodo = new Set(datesForWeekdays(t, [g.dow], weeks));
        const relevantes = g.slots.filter((s) => noPeriodo.has(s.date));
        let ok = 0, cheias = 0, jaAgendadas = 0;
        relevantes.forEach((s) => {
          if (minhas.some((b) => b.date === s.date && b.time === s.time && b.unit === s.unit)) jaAgendadas++;
          else if (slotBookings(data, s.id).length >= slotCapacity(s)) cheias++;
          else ok++;
        });
        // vagas da próxima ocorrência, para dar uma noção de lotação
        const prox = relevantes.sort((a, b) => a.date.localeCompare(b.date))[0];
        const proxVagas = prox ? slotCapacity(prox) - slotBookings(data, prox.id).length : null;
        const proxCap = prox ? slotCapacity(prox) : null;
        const prof = prox?.prof || g.slots[0]?.prof || "";
        // Sábado / a partir das 18h: a turma continua na lista, mas marcada, e
        // escolhê-la exige confirmar a exceção (quem manda na agenda é a Inêz).
        const fora = motivoForaDaRegraDow(client, g.dow, g.time);
        return { ...g, total: relevantes.length, ok, cheias, jaAgendadas, prox, proxVagas, proxCap, prof, fora, datas: relevantes.map((s) => s.date) };
      })
      .filter((g) => g.total > 0)
      .sort((a, b) => a.dow - b.dow || a.time.localeCompare(b.time));
  })();

  const toggle = (key) => setPicked((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const escolhidos = grupos.filter((g) => picked.has(g.key));
  const totalAgendar = escolhidos.reduce((n, g) => n + g.ok, 0);

  /* Teto do plano: cada turma escolhida acrescenta 1 aula por semana. Se a soma
     passar do 1x/2x contratado, o backend pula as datas que sobram — então é
     melhor dizer isso aqui, antes de você clicar. */
  const limiteSemanal = Number(client.weeklyFreq) || 0;
  const estouraTeto = limiteSemanal > 0 && escolhidos.length > limiteSemanal;

  const save = async () => {
    if (!escolhidos.length) return toast("Escolha ao menos uma turma.", "error");
    // Turmas fora do plano (sábado / a partir das 18h) precisam de confirmação
    // explícita: sem ela, o backend pula essas datas em vez de agendar.
    const excecoes = escolhidos.filter((g) => g.fora);
    let forcar = false;
    if (excecoes.length || estouraTeto) {
      const linhas = [
        ...excecoes.map((g) => `${WEEKDAYS_SHORT[g.dow]} ${hhmm(g.time)} — ${g.fora}`),
        ...(estouraTeto ? [`${escolhidos.length} turmas por semana, mas o plano dela é de ${limiteSemanal}x por semana`] : []),
      ];
      forcar = await confirmModal({
        title: estouraTeto && !excecoes.length ? "Acima do plano contratado" : "Turma fora do plano",
        message: `${linhas.join("\n")}\n\n` +
          `Agendar ${client.name} assim abre uma exceção à regra do plano de mensalista.\n` +
          "Voltando, o agendamento respeita o plano e pula o que passar do limite.",
        confirmLabel: "Agendar mesmo assim",
        cancelLabel: "Voltar e desmarcar",
        tone: "danger",
      });
      if (!forcar) return;
    }
    setBusy(true);
    try {
      // a API agenda um horário por chamada — agrupamos as datas por horário
      const porHorario = new Map();
      escolhidos.forEach((g) => {
        if (!porHorario.has(g.time)) porHorario.set(g.time, []);
        porHorario.get(g.time).push(...g.datas);
      });
      let agendadas = 0;
      const p = { semTurma: 0, cheia: 0, jaAgendado: 0, foraDaRegra: 0, teto: 0 };
      for (const [time, datas] of porHorario) {
        const r = await run(api.batchBook(client.id, { unit, time, dates: [...new Set(datas)], forcar }));
        agendadas += r?.agendadas ?? 0;
        const rp = r?.pulos || {};
        p.semTurma += rp.semTurma || 0; p.cheia += rp.cheia || 0; p.jaAgendado += rp.jaAgendado || 0;
        p.foraDaRegra += rp.foraDaRegra || 0; p.teto += rp.teto || 0;
      }
      close();
      toast(
        `✅ ${agendadas} aula(s) agendada(s).\n` +
        `Puladas: ${p.semTurma} sem turma · ${p.cheia} lotada(s) · ${p.jaAgendado} já agendada(s)` +
        (p.foraDaRegra ? ` · ${p.foraDaRegra} fora do plano` : "") +
        (p.teto ? ` · ${p.teto} acima do plano semanal` : "") + "."
      );
    } finally { setBusy(false); }
  };

  const uc = unitColor(unit);

  return (
    <Modal title={`Agendar em lote — ${client.name}`} footer={<>
      <button className="btn ghost" onClick={() => open(<ClientProfile client={client} />)}>← Voltar</button>
      <button className="btn" onClick={save} disabled={busy || !totalAgendar}>Agendar {totalAgendar} aula(s)</button>
    </>}>
      <div className="cfg-preview" style={{ marginTop: 0, marginBottom: "1rem" }}>
        Escolha abaixo as <b>turmas que já existem</b> em que o(a) mensalista <b>{client.name}</b> vai entrar. Não cria turmas novas.
        {limiteSemanal > 0 && <> O plano dela é de <b>{limiteSemanal}x por semana</b> — escolha até {limiteSemanal} turma{limiteSemanal > 1 ? "s" : ""}.</>}
      </div>
      {estouraTeto && (
        <div className="cfg-warn" style={{ marginBottom: "1rem" }}>
          ⚠️ Você escolheu <b>{escolhidos.length}</b> turmas por semana, mas o plano de <b>{client.name}</b> é de <b>{limiteSemanal}x por semana</b>.
          Ao salvar, o que passar do limite é pulado — a não ser que você confirme a exceção.
        </div>
      )}

      <div className="row2">
        <div className="field">
          <label>Unidade</label>
          <Select
            value={unit}
            onChange={(v) => { setUnit(v); setPicked(new Set()); }}
            options={unitOptions(meta)}
          />
        </div>
        <div className="field">
          <label>Por quantas semanas</label>
          <input type="number" min="1" max="52" value={weeks}
            onChange={(e) => setWeeks(Math.max(1, Math.min(52, parseInt(e.target.value, 10) || 1)))} />
        </div>
      </div>

      <div className="field">
        <label>Turmas disponíveis em {unit} <span className="cfg-count">{grupos.length}</span></label>
        {grupos.length === 0 ? (
          <div className="empty" style={{ padding: "1.6rem 1rem" }}>
            <div className="ic">🧶</div>
            <p>Nenhuma turma cadastrada em <b>{unit}</b> nas próximas {weeks} semana(s).<br />
              Crie os horários na Agenda antes de agendar em lote.</p>
          </div>
        ) : (
          <div className="bb-grid">
            {grupos.map((g) => {
              const on = picked.has(g.key);
              const lotadaSempre = g.ok === 0;
              return (
                <button key={g.key} type="button"
                  className={`bb-card ${on ? "on" : ""} ${lotadaSempre ? "off" : ""}`}
                  style={on ? { "--uc": uc } : undefined}
                  onClick={() => !lotadaSempre && toggle(g.key)}
                  disabled={lotadaSempre}>
                  <div className="bb-top">
                    <span className="bb-dia">{WEEKDAYS_SHORT[g.dow]}</span>
                    <span className="bb-hora">{hhmm(g.time)}</span>
                    {on && <span className="bb-check">✓</span>}
                  </div>
                  {g.fora && <div className="bb-prof" style={{ color: "var(--warn)" }} title={g.fora}>⚠️ fora do plano</div>}
                  
                  <div className="bb-vagas">
                    {g.proxVagas != null && (
                      <span className={`badge ${g.proxVagas === 0 ? "b-danger" : g.proxVagas <= 1 ? "b-warn" : "b-ok"}`}>
                        {g.proxVagas}/{g.proxCap} vaga(s)
                      </span>
                    )}
                  </div>
                  <div className="bb-foot">
                    <b>{g.ok}</b> de {g.total} data(s) livre(s)
                    {(g.cheias > 0 || g.jaAgendadas > 0) && (
                      <div className="bb-skip">
                        {g.cheias > 0 && <>· {g.cheias} lotada(s) </>}
                        {g.jaAgendadas > 0 && <>· {g.jaAgendadas} já agendada(s)</>}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {escolhidos.length > 0 && (
        <div className="cfg-preview" style={{ marginTop: ".2rem" }}>
          📅 {escolhidos.map((g) => `${WEEKDAYS_SHORT[g.dow]} ${hhmm(g.time)}`).join(" · ")} — <b>{totalAgendar} aula(s)</b> nas próximas {weeks} semana(s).
        </div>
      )}
    </Modal>
  );
}

/* ====== Formulário do aluno: estado reutilizável ======
   Usado tanto pelo modal "Novo aluno" quanto pela aba "Editar" do perfil,
   para que editar o cadastro não precise abrir outro modal. */
function useClientForm(client, onDone) {
  const { data, run } = useStore();
  const meta = data.meta;
  const [name, setName] = useState(client?.name || "");
  const [phone, setPhone] = useState(client?.phone || "");
  const [email, setEmail] = useState(client?.email || "");
  const [cpf, setCpf] = useState(client?.cpf || "");
  const [unit, setUnit] = useState(client?.unit || meta.units[0]);
  const [tags, setTags] = useState(client?.tags || []);
  const [notes, setNotes] = useState(client?.notes || "");
  const [birthday, setBirthday] = useState(client?.birthday || "");
  const [firstClass, setFirstClass] = useState(client ? !!client.firstClass : true);
  const [status, setStatus] = useState(client?.status || "ativo");
  const [billingDay, setBillingDay] = useState(client?.billingDay != null ? String(client.billingDay) : "");
  // Plano: "avulso" | "1" | "2" (mensalista 1x/2x por semana)
  const [plano, setPlano] = useState(client?.plan === "mensalista" ? String(client.weeklyFreq || 1) : "avulso");
  // Tipo de mensalista: "fixo" (agenda montada pela Inêz) | "escala" (ela marca)
  const [tipoMens, setTipoMens] = useState(client?.mensalistaTipo === "escala" ? "escala" : "fixo");
  const toggle = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const save = async () => {
    if (!name.trim()) return toast("Informe o nome.", "error");
    const payload = {
      name: name.trim(), phone: phone.trim(), email: email.trim(), cpf: cpf.trim(), unit, tags, notes: notes.trim(),
      birthday, firstClass, status, mensalistaTipo: tipoMens,
      billingDay: billingDay === "" ? null : Number(billingDay)
    };

    /* Inativar não é só mudar um rótulo: derruba a agenda e a cobrança dela.
       Por isso a confirmação diz em números o que vai acontecer. A mensalidade
       do mês CORRENTE fica de fora — é dívida do mês que ela cursou. */
    if (client && status === "cancelado" && client.status !== "cancelado") {
      const t = todayISO();
      const comp = t.slice(0, 7);
      const aulas = (data.bookings || []).filter(
        (b) => b.clientName === client.name && b.date >= t && b.status !== "cancelada"
      ).length;
      const futuras = (data.invoices || []).filter(
        (i) => i.clientId === client.id && i.status === "pendente" && i.competencia > comp
      ).length;
      const doMes = (data.invoices || []).filter(
        (i) => i.clientId === client.id && i.status === "pendente" && i.competencia <= comp
      ).length;
      const ok = await confirmModal({
        title: "Encerrar a inscrição",
        message: `${client.name} deixa de ser aluna. Ao salvar:\n\n` +
          `• ${aulas} aula(s) futura(s) serão canceladas\n` +
          `• ${futuras} mensalidade(s) dos próximos meses serão canceladas\n` +
          (doMes
            ? `• ${doMes} mensalidade(s) deste mês (ou anteriores) CONTINUAM em aberto — se quiser perdoar, cancele na aba Mensalidades\n`
            : "") +
          "\nEla também deixa de ganhar e usar créditos de reposição.",
        confirmLabel: "Encerrar inscrição", cancelLabel: "Voltar", tone: "danger",
      });
      if (!ok) return;
    }

    const eraMensal = client?.plan === "mensalista";
    const querMensal = plano !== "avulso";
    const mudouFreq = eraMensal && querMensal && Number(plano) !== (client.weeklyFreq || 1);
    const precisaMatricular = querMensal && (!client || !eraMensal || mudouFreq);

    if (precisaMatricular) {
      const valor = Number(plano) === 2 ? (meta.valorPlano2x ?? 200) : (meta.valorPlano1x ?? 120);
      // O dia da matrícula vira o dia de vencimento dela, e a 1ª mensalidade
      // cai no mês seguinte — a não ser que você já tenha fixado um dia acima.
      const dia = billingDay === "" ? Number(todayISO().slice(8, 10)) : Number(billingDay);
      const ok = await confirmModal({
        title: "Matricular como mensalista",
        message: `${name.trim()} entrará no plano de ${plano}x por semana (${money(valor)}/mês), como mensalista ${tipoMens}.\n\n` +
          `A 1ª mensalidade vence no dia ${Math.min(28, dia)} do mês que vem, e todo mês nesse dia.`,
        confirmLabel: "Salvar e matricular",
      });
      if (!ok) return;
    }
    if (eraMensal && !querMensal) payload.plan = "avulso"; // voltou a ser avulso

    const saved = await run(client ? api.updateClient(client.id, payload) : api.createClient(payload));
    if (precisaMatricular) {
      const id = client ? client.id : saved?.id;
      const r = id ? await run(api.enroll(id, { weeklyFreq: Number(plano), mensalistaTipo: tipoMens, billingDay: billingDay === "" ? undefined : Number(billingDay) })) : null;
      toast(`📅 Mensalista ${tipoMens} ${plano}x/semana.` +
        (r?.primeiroVencimento ? ` 1ª mensalidade vence ${fmtDate(r.primeiroVencimento)}.` : ""));
    } else if (saved?.encerrado) {
      const e = saved.encerrado;
      toast(`Inscrição encerrada. ${e.aulas} aula(s) e ${e.mensalidades} mensalidade(s) canceladas.` +
        (e.extrasPagas ? ` Atenção: ela tem ${e.extrasPagas} aula(s) extra(s) já paga(s).` : ""));
    } else {
      toast("Cadastro salvo. 💚");
    }
    onDone && onDone();
  };

  return { meta, client, name, setName, phone, setPhone, email, setEmail, cpf, setCpf,
    unit, setUnit, tags, toggle, notes, setNotes, birthday, setBirthday,
    firstClass, setFirstClass, status, setStatus, plano, setPlano, tipoMens, setTipoMens,
    billingDay, setBillingDay, save };
}

function ClientFormFields({ f }) {
  const { meta, client } = f;
  return (
    <>
      <div className="row2">
        <div className="field"><label>Nome</label><input value={f.name} onChange={(e) => f.setName(e.target.value)} /></div>
        <div className="field"><label>Telefone</label><input value={f.phone} onChange={(e) => f.setPhone(e.target.value)} placeholder="31988880000" /></div>
      </div>
      <div className="row2">
        <div className="field"><label>CPF <span style={{ color: "var(--muted)", fontWeight: 400 }}>(login do portal)</span></label><input value={f.cpf} onChange={(e) => f.setCpf(e.target.value)} placeholder="000.000.000-00" inputMode="numeric" /></div>
        <div className="field"><label>Email</label><input value={f.email} onChange={(e) => f.setEmail(e.target.value)} placeholder="aluno@email.com" inputMode="email" /></div>
      </div>
      <div className="field"><label>Unidade</label><Select value={f.unit} onChange={f.setUnit} options={unitOptions(meta)} /></div>
      <div className="row2">
        <div className="field"><label>Aniversário</label><input type="date" value={f.birthday} onChange={(e) => f.setBirthday(e.target.value)} /></div>
        <div className="field"><label>Primeira aula?</label>
          <button
            type="button"
            onClick={() => f.setFirstClass(!f.firstClass)}
            style={{
              display: "flex", alignItems: "center", gap: ".6rem",
              padding: ".45rem .9rem", borderRadius: 8, cursor: "pointer",
              border: `1.5px solid ${f.firstClass ? "var(--green-deep)" : "var(--line)"}`,
              background: f.firstClass ? "rgba(28,94,51,.08)" : "var(--cream)",
              color: f.firstClass ? "var(--green-deep)" : "var(--muted)",
              fontWeight: f.firstClass ? 600 : 400, fontSize: ".9rem",
              transition: "all .18s",
            }}
          >
            <span style={{ fontSize: "1.1rem" }}>{f.firstClass ? "✨" : "👩"}</span>
            {f.firstClass ? "Sim — aluno(a) novo(a)" : "Não — já é aluno(a)"}
          </button>
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>Plano</label>
          <Select
            value={f.plano}
            onChange={f.setPlano}
            options={[
              { value: "avulso", label: "Avulso", hint: "paga por aula, sem mensalidade", icon: "🧺" },
              { value: "1", label: "Mensalista — 1x por semana", hint: "4 aulas por mês", icon: "📅", meta: money(meta.valorPlano1x ?? 120) },
              { value: "2", label: "Mensalista — 2x por semana", hint: "8 aulas por mês", icon: "📅", meta: money(meta.valorPlano2x ?? 200) },
            ]}
          />
          {f.plano !== "avulso" && client?.plan !== "mensalista" && (
            <div className="help" style={{ marginTop: ".4rem" }}>Ao salvar, a matrícula é feita e a 1ª mensalidade é gerada automaticamente.</div>
          )}
          {f.plano !== "avulso" && (
            <div style={{ marginTop: ".7rem" }}>
              <label style={{ display: "block", marginBottom: ".3rem" }}>Tipo de mensalista</label>
              <Select value={f.tipoMens} onChange={f.setTipoMens} options={TIPO_MENSALISTA_OPCOES} />
              <div className="help" style={{ marginTop: ".4rem" }}>
                Nos dois tipos: sem sábado. Na <b>escala</b>, a aluna marca a próxima aula
                no dia da aula dela.
                {client?.podeSabado && (
                  <> Esta aluna tem direito herdado a sábado.</>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="field"><label>Situação da inscrição</label>
          <Select
            value={f.status}
            onChange={f.setStatus}
            options={[
              { value: "ativo", label: "Ativa", hint: "está fazendo o curso", dot: "var(--ok)" },
              { value: "cancelado", label: "Inativa", hint: "desistiu ou não é mais aluna", dot: "var(--danger)" },
            ]}
          />
          <div className="help" style={{ marginTop: ".4rem" }}>
            Ao salvar como <b>Inativa</b>, as aulas futuras dela são canceladas e as mensalidades
            dos próximos meses também. A do mês corrente continua em aberto. Ela deixa de ganhar e
            de usar créditos de reposição.
          </div>
        </div>
      </div>
      <div className="field">
        <label>Dia de vencimento (Boleto / PIX)</label>
        <Select
          value={f.billingDay}
          onChange={f.setBillingDay}
          grid
          defaultOption={{ label: `Dia ${meta.vencimentoDia || 10} — padrão do sistema`, icon: "⚙️" }}
          options={Array.from({ length: 28 }, (_, i) => ({
            value: i + 1,
            label: String(i + 1),
            triggerLabel: `Dia ${i + 1} de cada mês`,
          }))}
        />
        <div className="help" style={{ marginTop: ".4rem" }}>Dia do mês em que vence a mensalidade para a emissão do boleto ou PIX.</div>
      </div>
      {/* O campo de etiquetas some enquanto não houver nenhuma para escolher —
          a única que existia ("Lead") saiu do sistema. Se voltar a haver
          etiqueta, basta preencher TAG_OPTIONS em helpers.js. */}
      {TAG_OPTIONS.length > 0 && client?.plan !== "mensalista" && (
        <div className="field"><label>Etiquetas</label>
          <div className="tags">
            {TAG_OPTIONS.map((t) => (
              <label key={t} className="chip" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={f.tags.includes(t)} onChange={() => f.toggle(t)} style={{ marginRight: ".3rem" }} />{t}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field"><label>Observações</label><textarea value={f.notes} onChange={(e) => f.setNotes(e.target.value)} /></div>
    </>
  );
}

/* Modal separado — usado só para CRIAR aluno (editar acontece dentro do perfil). */
export function ClientForm({ client }) {
  const { run } = useStore();
  const { close } = useModal();
  const f = useClientForm(client, close);
  const del = async () => {
    if (await confirmModal({ title: "Excluir aluno", message: `Excluir ${client.name}?\n\nAs aulas futuras serão removidas da agenda; o histórico de aulas passadas é mantido.`, confirmLabel: "Excluir", tone: "danger" })) { await run(api.deleteClient(client.id)); close(); }
  };
  return (
    <Modal size="md" title={client ? "Editar aluno" : "Novo aluno"} footer={<>
      {client && <button className="btn danger" onClick={del}>Excluir</button>}
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={f.save}>Salvar</button>
    </>}>
      <ClientFormFields f={f} />
    </Modal>
  );
}
