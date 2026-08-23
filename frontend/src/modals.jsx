import { useState, useRef, useEffect } from "react";
import { Modal, useModal, StatusBadge, Select } from "./ui.jsx";
import { WaIcon } from "./icons.jsx";
import { useStore } from "./store.jsx";
import { api } from "./api.js";
import { toast, confirmModal, promptModal } from "./toast.jsx";
import {
  UNITS, PROFS, TAG_OPTIONS, STATUS, VALOR_PADRAO, CAPACITY_PADRAO,
  unitColor, unitSoft, todayISO, fmtDate, fmtDateLong, money, waLink, capitalize, faixaHorario, hhmm,
  slotById, slotBookings, slotBookingsAll, slotCapacity, slotWaitlist, clientAttendance,
  bookingKind, competenciasDoAluno, compLabel, mensalidadeDe, matriculaISO,
  WEEKDAYS_SHORT, dowMon, datesForWeekdays, addDays,
  NOITE_A_PARTIR, ehSabadoISO, ehNoite, tipoMensalista, TIPO_MENSALISTA_LABEL,
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
  { value: "escala", label: "Escala", hint: "ela marca a própria aula, no dia da aula dela", icon: "🔄" },
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

/* ======================= Cartão de horário ======================= */
export function SlotCard({ slot, showUnit }) {
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
        <div className="sc-roster">
          {todas.slice(0, 5).map((b) => {
            const k = bookingKind(b);
            return (
              <div key={b.id} className={`sc-al ${b.status === "cancelada" ? "canc" : ""}`} title={`${b.clientName}${k ? " · " + k.label : ""}`}>
                <span className="sc-dot" style={{ background: k ? k.color : "var(--pink)" }} />
                <span className="sc-nm">{b.clientName.split(" ")[0]}</span>
                {k && <span className="sc-tag">{k.ic}</span>}
              </div>
            );
          })}
          {todas.length > 5 && <div className="sc-more">+{todas.length - 5} mais</div>}
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
      <div style={{ display: "flex", gap: ".5rem", marginTop: ".8rem" }}>
        <button className="btn sec sm" onClick={() => open(<EditSlotForm slot={slot} />)}>✏️ Editar turma</button>
        <button className="btn sec sm" onClick={() => open(<ReplicateSlotForm slot={slot} />)}>🔁 Replicar</button>
        <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={del}>🗑 Excluir horário</button>
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
  const [status, setStatus] = useState(booking.status);
  const [attendance, setAttendance] = useState(booking.attendance || "");
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState(booking.time);
  const [pix, setPix] = useState(booking.pixCode || "");
  const [genBusy, setGenBusy] = useState(false);
  const slotExists = !!slotById(data, booking.slotId);
  const save = async () => {
    await run(api.updateBooking(booking.id, { status, attendance, date, time }));
    close();
  };
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
      const msg = `Excluir a aula de ${booking.clientName} em ${fmtDate(booking.date)} às ${booking.time}?` +
        (booking.paid ? "\n\nAtenção: esta aula consta como paga." : "") +
        "\n\nA vaga volta a ficar livre na turma.";
      if (!(await confirmModal({ title: "Excluir aula", message: msg, confirmLabel: "Excluir", tone: "danger" }))) return;
      await run(api.deleteBooking(booking.id));
      close();
      return;
    }
    const pagas = (booking.paid ? 1 : 0) + sibs.filter((b) => b.paid).length;
    const ans = await confirmModal({
      title: "Excluir aula replicada",
      message: `Esta aula foi marcada de forma replicada: ${booking.clientName} tem mais ${sibs.length} aula(s) da mesma marcação daqui em diante.` +
        (pagas > 0 ? `\n\nAtenção: ${pagas} dessas aula(s) consta(m) como paga(s).` : "") +
        `\n\nQuer excluir só esta aula ou todas da marcação?`,
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
      {!booking.paid && <button className="btn terra" onClick={() => open(<ConfirmPayment booking={booking} />)}>Confirmar pagamento</button>}
      <button className="btn" onClick={save}>Salvar</button>
    </>}>
      <div className="info-line"><b>Aluno</b><span>{booking.clientName}</span></div>
      <div className="info-line"><b>Telefone</b><span>{booking.phone || "—"}</span></div>
      <div className="info-line"><b>Unidade</b><span>{booking.unit}</span></div>
      <div className="info-line"><b>Aula</b><span>{fmtDateLong(booking.date)} · {faixaHorario(booking.time, data.meta?.duracaoAulaMin)}</span></div>
      <div className="info-line"><b>Valor</b><span>{money(booking.value)}</span></div>
      <div className="info-line"><b>Pagamento</b><span>{booking.paid ? `Pago (${booking.paymentMethod})` : "Pendente"}</span></div>

      {!booking.paid && (
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

      <div className="row2" style={{ marginTop: "1rem" }}>
        <div className="field"><label>Alterar status</label>
          <Select
            value={status}
            onChange={setStatus}
            options={Object.keys(STATUS).map((k) => ({ value: k, label: STATUS[k].label, dot: STATUS[k].dot }))}
          />
        </div>
        <div className="field"><label>Presença</label>
          <Select
            value={attendance}
            onChange={setAttendance}
            defaultOption={{ label: "Não marcado", icon: "○" }}
            options={[
              { value: "presente", label: "Presente", dot: "var(--ok)" },
              { value: "falta", label: "Faltou", dot: "var(--danger)" },
            ]}
          />
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>Remarcar — data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Hora</label><input type="time" value={hhmm(time)} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <div style={{ marginTop: "1rem", display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
        {booking.status !== "cancelada" && (
          <button className="btn sec sm" onClick={liberar}>🔁 Liberar vaga (a aluna avisou)</button>
        )}
        <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={del}>🗑 Excluir aula</button>
      </div>
      <div className="help" style={{ marginTop: ".5rem" }}>
        <b>Liberar</b> cancela a aula e aplica as regras de reposição — vira crédito só se o aviso vier
        com 6h de antecedência (ou até 23:59 do dia anterior, se a aula for antes das 10h).
        <br /><b>Excluir</b> apaga a marcação de vez, sem gerar crédito.
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
  const pend = data.bookings.filter((b) => b.status === "aguardando");
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
  const [value, setValue] = useState(meta.valorPadrao);
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
    const payload = { clientName: name.trim(), phone: phone.trim(), unit, value, date, time, slotId: slot && !repetindo ? slot.id : undefined };
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

/* ====== Mensalidades do aluno (fechamento + pagamento) ======
   Mês a mês desde a primeira matrícula. Meses sem boleto aparecem como
   "não gerado" — o sistema não cria cobrança retroativa. */
function MensalidadesPanel({ client }) {
  const { data } = useStore();
  const comps = competenciasDoAluno(client);
  const invs = (data.invoices || []).filter((i) => i.clientId === client.id);
  const valorPadrao = mensalidadeDe(client, data.meta);
  const totalPago = invs.filter((i) => i.status === "pago").reduce((s, i) => s + i.amountCents / 100, 0);
  // Em aberto vale pelo total do dia: a vencida já carrega multa e juros.
  const emAberto = invs.filter((i) => i.status === "pendente")
    .reduce((s, i) => s + (i.encargos ? i.encargos.total : i.amountCents / 100), 0);
  const ini = matriculaISO(client);
  return (
    <div className="prof-panel">
      <div className="prof-panel-h">
        <b>🧾 Mensalidades · fechamento</b>
        <span className="cli-sub">{ini ? `desde ${fmtDate(ini)}` : "sem matrícula"}</span>
      </div>
      <div className="cli-sub" style={{ marginBottom: ".5rem" }}>
        <b style={{ color: "var(--green-deep)" }}>{money(totalPago)}</b> pago
        {emAberto ? <> · <b style={{ color: "var(--warn)" }}>{money(emAberto)}</b> em aberto</> : null}
      </div>
      <div>
        {comps.map((comp) => {
          const inv = invs.find((i) => i.competencia === comp);
          const valor = inv ? inv.amountCents / 100 : valorPadrao;
          return (
            <div className="hist-row" key={comp}>
              <span className="hist-comp">{compLabel(comp)}</span>
              <span className="hist-val" title={inv?.encargos?.atrasada
                ? `${money(valor)} + multa ${money(inv.encargos.multa)} + juros ${money(inv.encargos.juros)}`
                : undefined}>
                {inv?.encargos?.atrasada ? money(inv.encargos.total) : money(valor)}
              </span>
              <span className="hist-st">
                {!inv ? <span className="badge b-muted">não gerado</span>
                  : inv.status === "pago" ? <span className="badge b-ok">✓ {inv.paidAt ? fmtDate(String(inv.paidAt).slice(0, 10)) : "pago"}</span>
                  : inv.status === "cancelado" ? <span className="badge b-danger">cancelado</span>
                  : inv.encargos?.atrasada ? <span className="badge b-danger">⚠️ {inv.encargos.dias} dia(s) de atraso</span>
                  : <span className="badge b-warn">⏳ vence {fmtDate(inv.dueDate)}</span>}
              </span>
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
  add(c.matriculaAt, "🎟️", "Taxa de matrícula paga", "");
  add(c.matriculaRefundAt, "↩️", "Taxa de matrícula devolvida", "");
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

/* ============ Plano e taxa de matrícula (admin) ============ */
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
    <span className="badge b-info">{tipo === "escala" ? "🔄" : "📌"} {TIPO_MENSALISTA_LABEL[tipo]}</span>{" "}
    <span className="cli-sub">{money(valor)}/mês</span>
    {(c.podeSabado || c.podeNoite) && (
      <> <span className="cli-sub" title="Direito herdado: ela já estava nesse horário quando a regra mudou.">
        · pode {[c.podeSabado && "sábado", c.podeNoite && `${NOITE_A_PARTIR}+`].filter(Boolean).join(" e ")}
      </span></>
    )}
  </>);
}

const MATRICULA_ROTULO = {
  pendente: ["b-warn", "Taxa pendente"],
  paga: ["b-ok", "Taxa paga — aguardando decisão"],
  convertida: ["b-ok", "Virou matrícula"],
  devolvida: ["b-muted", "Taxa devolvida"],
};

function MatriculaBlock({ client }) {
  const { data, run } = useStore();
  const { open } = useModal();
  if (client.matriculaStatus === "nao_aplica") return null;
  const [cls, txt] = MATRICULA_ROTULO[client.matriculaStatus] || ["b-muted", client.matriculaStatus];
  const taxa = data.meta?.taxaMatricula ?? 20;
  /* A devolução vale também depois da conversão: a aluna nova agora já sai
     matriculada ao pagar a taxa, então "não quis continuar" precisa desfazer
     essa matrícula — e não só registrar o estorno. */
  const podeDevolver = client.matriculaStatus === "paga" || client.matriculaStatus === "convertida";
  const podeConverter = client.plan !== "mensalista" && client.matriculaStatus !== "devolvida";

  const devolver = async () => {
    const t = todayISO();
    const aulas = (data.bookings || []).filter(
      (b) => b.clientName === client.name && b.date >= t && b.status !== "cancelada" && b.paymentMethod !== "Matrícula"
    ).length;
    const mensalidades = (data.invoices || []).filter((i) => i.clientId === client.id && i.status === "pendente").length;
    if (!(await confirmModal({
      title: "Devolver a taxa",
      message: `Confirmar a devolução INTEGRAL de ${money(taxa)} para ${client.name}?\n\n` +
        (client.plan === "mensalista" ? "• A matrícula é desfeita — ela volta a ser avulsa\n" : "") +
        (aulas ? `• ${aulas} aula(s) futura(s) serão canceladas\n` : "") +
        (mensalidades ? `• ${mensalidades} mensalidade(s) em aberto serão canceladas\n` : "") +
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
        <b style={{ color: "var(--brown)" }}>🎟️ Matrícula · {money(taxa)}</b>
        <span className={`badge ${cls}`}>{txt}</span>
      </div>
      <div className="cli-sub">
        {client.trialDate ? <>Aula experimental em <b>{fmtDate(client.trialDate)}</b>. </> : null}
        {client.matriculaAt ? <>Taxa paga em {fmtDate(client.matriculaAt)}. </> : null}
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
    // A 1ª aula oficial já é aula de mensalista: sábado e horário a partir das
    // 18h saíram do plano e não entram para quem está começando agora.
    .filter((s) => !ehSabadoISO(s.date) && !ehNoite(s.time))
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
        A taxa de matrícula já paga vira a matrícula da aluna. O sistema gera a 1ª mensalidade e
        passa a emitir boleto todo mês, com vencimento no dia {meta.vencimentoDia || 10}.
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
        <div className="help" style={{ marginBottom: ".4rem" }}>Sábado e horários a partir das {NOITE_A_PARTIR} não fazem parte do plano — por isso não aparecem na lista.</div>
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
                Nos dois tipos: sem sábado e sem horário a partir das {NOITE_A_PARTIR}.
                Na <b>escala</b>, a aluna marca a próxima aula no dia da aula dela.
                {(client?.podeSabado || client?.podeNoite) && (
                  <> Esta aluna tem direito herdado a {[client.podeSabado && "sábado", client.podeNoite && `horário a partir das ${NOITE_A_PARTIR}`].filter(Boolean).join(" e ")}.</>
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
