import { useState } from "react";
import { Modal, useModal, StatusBadge } from "./ui.jsx";
import { WaIcon } from "./icons.jsx";
import { useStore } from "./store.jsx";
import { api } from "./api.js";
import { toast, confirmModal, promptModal } from "./toast.jsx";
import {
  UNITS, PROFS, TAG_OPTIONS, STATUS, VALOR_PADRAO, CAPACITY_PADRAO,
  unitColor, unitSoft, todayISO, fmtDate, fmtDateLong, money, waLink, capitalize, faixaHorario,
  slotById, slotBookings, slotCapacity, slotWaitlist, clientAttendance,
  WEEKDAYS_SHORT, dowMon, datesForWeekdays, addDays,
} from "./helpers.js";

const openWa = (phone, msg) => window.open(waLink(phone, msg), "_blank");

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
  const names = occ ? bks.map((b) => b.clientName.split(" ")[0]).join(", ") : "Livre";
  return (
    <div className={`slot ${cls}`} style={{ "--uc": uc, background: occ ? unitSoft(slot.unit) : undefined }}
      onClick={() => open(<SlotDetail slotId={slot.id} />)}>
      <div className="slot-top">
        <span className="t" style={{ color: occ ? uc : undefined }}>{slot.time}</span>
        <span className={`occ ${full ? "is-full" : occ > 0 ? "is-part" : ""}`}>{occ}/{cap}</span>
      </div>
      <div className="n">{showUnit && <b style={{ color: uc }}>{slot.unit}</b>}{showUnit ? " · " : ""}{names}</div>
      <div className="occbar"><span style={{ width: pct + "%", background: full ? "var(--danger)" : uc }} /></div>
      {wlc > 0 && <div className="wl-badge">⏰ {wlc} na espera</div>}
    </div>
  );
}

/* ======================= Modal do dia ======================= */
export function DayModal({ date }) {
  const { data } = useStore();
  const { open, close } = useModal();
  const slots = data.slots.filter((s) => s.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const title = capitalize(new Date(date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }));
  return (
    <Modal title={title} footer={<>
      <button className="btn ghost" onClick={close}>Fechar</button>
      <button className="btn" onClick={() => open(<SlotForm presetDate={date} />)}>＋ Novo horário</button>
    </>}>
      {slots.length
        ? <div className="day-view" style={{ maxWidth: "none" }}>{slots.map((s) => <SlotCard key={s.id} slot={s} showUnit />)}</div>
        : <div className="empty"><div className="ic">🧶</div><p>Nenhum horário cadastrado neste dia.</p></div>}
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
      <button className="btn ghost" onClick={() => open(<DayModal date={slot.date} />)}>← Voltar ao dia</button>
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
            <div className="cli-sub">{b.phone || "sem telefone"} · {STATUS[b.status].label}</div>
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
export function ManageBooking({ booking }) {
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
      if (!r.pixCode) toast("Cobrança criada na Cora, mas o código Pix não veio no formato esperado — preciso ajustar o parser com o retorno real (teste em stage).", "info");
    } catch (e) { toast("Erro ao gerar cobrança: " + e.message, "error"); }
    setGenBusy(false);
  };
  return (
    <Modal title="Gerir marcação" footer={<>
      {slotExists
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
              <div className="help" style={{ marginTop: ".4rem" }}>Quando a Cora confirmar o pagamento, a reserva vira <b>Confirmada</b> automaticamente.</div>
            </>
          ) : (
            <button className="btn terra sm" onClick={genInvoice} disabled={genBusy}>{genBusy ? "Gerando…" : "💠 Gerar cobrança Pix (Cora)"}</button>
          )}
        </div>
      )}

      <div className="row2" style={{ marginTop: "1rem" }}>
        <div className="field"><label>Alterar status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.keys(STATUS).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
          </select>
        </div>
        <div className="field"><label>Presença</label>
          <select value={attendance} onChange={(e) => setAttendance(e.target.value)}>
            <option value="">— não marcado</option>
            <option value="presente">✓ Presente</option>
            <option value="falta">✕ Faltou</option>
          </select>
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>Remarcar — data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Hora</label><input value={time} onChange={(e) => setTime(e.target.value)} /></div>
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
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {["Pix", "Dinheiro", "Cartão", "Transferência"].map((m) => <option key={m}>{m}</option>)}
        </select>
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
        <select value={id} onChange={(e) => setId(Number(e.target.value))}>
          {pend.length ? pend.map((b) => <option key={b.id} value={b.id}>{b.clientName} · {fmtDate(b.date)} {b.time} · {money(b.value)}</option>)
            : <option value="">Nenhuma pendente</option>}
        </select>
      </div>
      <div className="row2">
        <div className="field"><label>Forma</label><select value={method} onChange={(e) => setMethod(e.target.value)}>{["Pix", "Dinheiro", "Cartão", "Transferência"].map((m) => <option key={m}>{m}</option>)}</select></div>
        <div className="field"><label>Data</label><input type="date" value={pdate} onChange={(e) => setPdate(e.target.value)} /></div>
      </div>
      <div className="help">Confirmar aqui marca a reserva como paga e confirma a aula na agenda.</div>
    </Modal>
  );
}

/* ======================= Nova marcação ======================= */
export function BookingForm({ slotId }) {
  const { data, run } = useStore();
  const { close } = useModal();
  const slot = slotId ? slotById(data, slotId) : null;
  const meta = data.meta;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [unit, setUnit] = useState(slot ? slot.unit : meta.units[0]);
  const [value, setValue] = useState(meta.valorPadrao);
  const [date, setDate] = useState(slot ? slot.date : todayISO());
  const [time, setTime] = useState(slot ? slot.time : "09:00");

  const pickClient = (v) => {
    if (!v) return;
    const [n, p] = v.split("|");
    setName(n); setPhone(p);
    const c = data.clients.find((c) => c.name === n);
    if (c && c.unit) setUnit(c.unit);
  };
  const save = async () => {
    if (!name.trim()) return toast("Informe o nome.", "error");
    await run(api.createBooking({ clientName: name.trim(), phone: phone.trim(), unit, value, date, time, slotId: slot ? slot.id : undefined }));
    close();
  };
  return (
    <Modal title="Nova marcação" footer={<>
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save}>Salvar marcação</button>
    </>}>
      <div className="field"><label>Aluno existente</label>
        <select onChange={(e) => pickClient(e.target.value)}>
          <option value="">— Novo / digitar —</option>
          {data.clients.map((c) => <option key={c.id} value={`${c.name}|${c.phone || ""}`}>{c.name} ({c.unit})</option>)}
        </select>
      </div>
      <div className="row2">
        <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Telefone (DDD)</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="31988880000" /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Unidade</label><select value={unit} onChange={(e) => setUnit(e.target.value)}>{meta.units.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div className="field"><label>Valor (R$)</label><input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Hora</label><input value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <div className="help">A marcação entra como <b>Aguardando pagamento</b>. Após confirmar o pagamento, ela vira <b>Confirmada</b> na agenda.</div>
    </Modal>
  );
}

/* ======================= Seletor de dias da semana ======================= */
function WeekdayChips({ selected, onToggle }) {
  return (
    <div className="wd-chips">
      {WEEKDAYS_SHORT.map((lbl, i) => (
        <button key={lbl} type="button" className={`wd-chip ${selected.has(i) ? "on" : ""}`} onClick={() => onToggle(i)}>{lbl}</button>
      ))}
    </div>
  );
}

/* ======================= Novo horário (com recorrência) ======================= */
export function SlotForm({ presetDate }) {
  const { data, run } = useStore();
  const { close } = useModal();
  const meta = data.meta;
  const [unit, setUnit] = useState(meta.units[0]);
  const [prof, setProf] = useState(meta.profs[0]);
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
        <div className="field"><label>Unidade</label><select value={unit} onChange={(e) => setUnit(e.target.value)}>{meta.units.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div className="field"><label>Profissional</label><select value={prof} onChange={(e) => setProf(e.target.value)}>{meta.profs.map((p) => <option key={p}>{p}</option>)}</select></div>
      </div>
      <div className="row2">
        <div className="field"><label>{weekdays.size ? "Semana inicial (a partir de)" : "Data"}</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Hora</label><input value={time} onChange={(e) => setTime(e.target.value)} /></div>
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
export function ClientProfile({ client }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  const c = data.clients.find((x) => x.id === client.id) || client;
  const at = clientAttendance(data, c.name);
  const hist = data.bookings.filter((b) => b.clientName === c.name).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const total = hist.filter((b) => b.status !== "cancelada").length;
  const pago = hist.filter((b) => b.paid).reduce((s, b) => s + b.value, 0);
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
  return (
    <Modal title={c.name} footer={<>
      <button className="btn wa" onClick={() => openWa(c.phone, `Olá ${c.name}! 💚`)}><WaIcon /> WhatsApp</button>
      {c.plan === "mensalista" && <button className="btn" onClick={() => open(<BatchBookForm client={c} />)}>📅 Agendar em lote</button>}
      {c.hasPin && <button className="btn ghost" onClick={resetPin}>🔑 Redefinir PIN</button>}
      <button className="btn ghost" style={{ color: "var(--danger)" }} onClick={del}>🗑 Excluir</button>
      <div style={{ flex: 1 }} />
      <button className="btn sec" onClick={() => open(<ClientForm client={c} />)}>Editar cadastro</button>
    </>}>
      <div className="info-line"><b>Telefone</b><span>{c.phone || "—"}</span></div>
      <div className="info-line"><b>Unidade</b><span><span className="chip">{c.unit || "—"}</span>{c.firstClass ? <span className="badge b-terra ml">✨ Aluno(a) novo(a)</span> : null}</span></div>
      <div className="info-line"><b>Nível · Aniversário</b><span>{c.level || "—"}{c.birthday ? " · 🎂 " + fmtDate(c.birthday) : ""}</span></div>
      <div className="info-line"><b>Etiquetas</b><span className="tags" style={{ justifyContent: "flex-end" }}>{(c.tags || []).length ? c.tags.map((t) => <span key={t} className="chip">{t}</span>) : "—"}</span></div>
      <div className="info-line"><b>Acesso ao portal (PIN)</b><span>{c.hasPin ? <span className="badge b-ok">PIN cadastrado</span> : <span className="badge b-muted">Sem PIN ainda</span>}</span></div>
      <div className="info-line"><b>Inscrição</b><span>{c.status === "cancelado" ? <span className="badge b-danger">Cancelada — rompeu com o curso</span> : <span className="badge b-ok">Ativa</span>}</span></div>
      <div className="info-line"><b>Plano</b><span>{planoLabel(c, data.meta)}</span></div>
      {c.notes ? <div className="help" style={{ margin: ".7rem 0" }}>{c.notes}</div> : null}
      <MatriculaBlock client={c} />
      {c.plan === "mensalista" && <MakeupBlock client={c} />}
      <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", gap: ".6rem", margin: "1rem 0" }}>
        <div className="card stat" style={{ padding: ".8rem 1rem" }}><div className="lbl">Aulas</div><div className="val" style={{ fontSize: "1.6rem" }}>{total}</div></div>
        <div className="card stat" style={{ padding: ".8rem 1rem" }}><div className="lbl">Presenças</div><div className="val" style={{ fontSize: "1.6rem" }}>{at.pres}</div><div className="foot">{at.falt} falta(s)</div></div>
        <div className="card stat" style={{ padding: ".8rem 1rem" }}><div className="lbl">Pago</div><div className="val terra" style={{ fontSize: "1.3rem" }}>{money(pago)}</div></div>
      </div>
      <b style={{ color: "var(--brown)" }}>Histórico de aulas</b>
      <div style={{ marginTop: ".6rem" }}>
        {hist.length ? hist.map((b) => (
          <div className="roster-row row-click" key={b.id} onClick={() => open(<ManageBooking booking={b} />)}>
            <div className="rr-info"><b>{fmtDate(b.date)} · {b.time}</b><div className="cli-sub">{b.unit}{b.attendance === "presente" ? " · ✓ presente" : b.attendance === "falta" ? " · ✕ faltou" : ""}{b.paid ? " · pago" : ""}</div></div>
            <StatusBadge status={b.status} />
          </div>
        )) : <div className="cli-sub" style={{ padding: ".5rem 0" }}>Sem histórico ainda.</div>}
      </div>
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
  return <><span className="badge b-ok">📅 {freq}</span> <span className="cli-sub">{money(valor)}/mês</span></>;
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
  const podeDevolver = client.matriculaStatus === "paga";
  const podeConverter = client.plan !== "mensalista" && client.matriculaStatus !== "devolvida";

  const devolver = async () => {
    if (!(await confirmModal({
      title: "Devolver a taxa",
      message: `Confirmar a devolução de ${money(taxa)} para ${client.name}?\n\nO sistema só registra — o Pix de volta você faz por fora.`,
      confirmLabel: "Registrar devolução", tone: "danger",
    }))) return;
    try { await run(api.refundMatricula(client.id)); toast("Devolução registrada."); }
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
  const [slotId, setSlotId] = useState("");
  const [busy, setBusy] = useState(false);
  const t = todayISO();
  const livres = data.slots
    .filter((s) => s.date >= t && slotBookings(data, s.id).length < slotCapacity(s))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const valor = freq === 2 ? (meta.valorPlano2x ?? 200) : (meta.valorPlano1x ?? 120);

  const salvar = async () => {
    if (!(await confirmModal({
      title: "Confirmar matrícula",
      message: `Matricular ${client.name} no plano de ${freq}x por semana (${money(valor)}/mês)?\n\n` +
        (slotId ? "A 1ª aula oficial será agendada e " : "") + "a primeira mensalidade será gerada agora.",
      confirmLabel: "Matricular",
    }))) return;
    setBusy(true);
    try {
      const r = await run(api.enroll(client.id, { weeklyFreq: freq, slotId: slotId || undefined }));
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
        <select value={freq} onChange={(e) => setFreq(Number(e.target.value))}>
          <option value={1}>1x por semana — 4 aulas/mês — {money(meta.valorPlano1x ?? 120)}</option>
          <option value={2}>2x por semana — 8 aulas/mês — {money(meta.valorPlano2x ?? 200)}</option>
        </select>
      </div>
      <div className="field">
        <label>1ª aula oficial <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span></label>
        <select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
          <option value="">— agendar depois</option>
          {livres.slice(0, 60).map((s) => (
            <option key={s.id} value={s.id}>
              {fmtDate(s.date)} · {faixaHorario(s.time, meta.duracaoAulaMin)} · {s.unit} ({slotCapacity(s) - slotBookings(data, s.id).length} vaga(s))
            </option>
          ))}
        </select>
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
  const bloqueio = client.status === "cancelado"
    ? "Inscrição cancelada — sem direito a reposição."
    : emAtraso ? "Mensalidade em atraso — sem direito a reposição." : "";

  const rotulo = { disponivel: ["b-ok", "disponível"], usado: ["b-muted", "usado"], expirado: ["b-danger", "expirou"] };

  return (
    <div style={{ margin: "1rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".5rem" }}>
        <b style={{ color: "var(--brown)" }}>🔁 Reposição · {saldo} crédito(s)</b>
        <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={() => open(<ExtraBookForm client={client} />)}>
            ➕ Aula extra ({money(data.meta?.valorAvulsa ?? 40)})
          </button>
          <button className="btn sec sm" disabled={!saldo || !!bloqueio} onClick={() => open(<MakeupBookForm client={client} />)}>
            Marcar reposição
          </button>
        </div>
      </div>
      {bloqueio
        ? <div className="help" style={{ color: "var(--danger)" }}>{bloqueio}</div>
        : <div className="help">Máx. 2 por mês; o crédito vale até o fim do mês seguinte ao da aula liberada.</div>}
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
  const marcar = async (s) => {
    if (!(await confirmModal({
      title: titulo,
      message: confirmar(s),
      confirmLabel: titulo,
    }))) return;
    try {
      await run(acao(s)); // run já avisa o erro na tela
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
        {livres.length ? livres.slice(0, 40).map((s) => (
          <div className="roster-row row-click" key={s.id} onClick={() => marcar(s)}>
            <div className="rr-info">
              <b>{fmtDate(s.date)} · {faixaHorario(s.time, data.meta?.duracaoAulaMin)}</b>
              <div className="cli-sub">{s.unit} · {slotCapacity(s) - slotBookings(data, s.id).length} vaga(s)</div>
            </div>
            <button className="btn sec sm">Escolher</button>
          </div>
        )) : <div className="empty" style={{ padding: "1.2rem" }}><div className="ic">🪑</div><p>Nenhuma turma com vaga livre no momento.</p></div>}
      </div>
    </Modal>
  );
}

export function MakeupBookForm({ client }) {
  return (
    <SlotPicker
      client={client}
      titulo="Marcar reposição"
      ajuda="Não há vaga reservada para reposição — aparecem só as turmas que já têm vaga livre."
      confirmar={(s) => `Marcar ${client.name} em reposição?\n\n${s.unit}\n${fmtDateLong(s.date)} às ${s.time}\n\nIsso consome 1 crédito.`}
      acao={(s) => api.makeupBook(client.id, s.id)}
      sucesso="Reposição marcada. 💚"
    />
  );
}

export function ExtraBookForm({ client }) {
  const { data } = useStore();
  const valor = data.meta?.valorAvulsa ?? 40;
  return (
    <SlotPicker
      client={client}
      titulo="Marcar aula extra"
      ajuda={`Aula avulsa de ${money(valor)}, cobrada à parte da mensalidade. Não usa crédito de reposição — a aula fica aguardando pagamento.`}
      confirmar={(s) => `Marcar ${client.name} em uma aula extra de ${money(valor)}?\n\n${s.unit}\n${fmtDateLong(s.date)} às ${s.time}`}
      acao={(s) => api.extraBook(client.id, s.id)}
      sucesso="Aula extra marcada — aguardando pagamento."
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
  const [time, setTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState(() => new Set());
  const [weeks, setWeeks] = useState(4);
  const [busy, setBusy] = useState(false);
  const toggleWd = (i) => setWeekdays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const dates = weekdays.size ? datesForWeekdays(todayISO(), [...weekdays], weeks) : [];
  // pré-visualização: quantas dessas datas já têm turma nessa unidade/horário
  const comTurma = dates.filter((d) => data.slots.some((s) => s.date === d && s.time === time && s.unit === unit));

  const save = async () => {
    if (!dates.length) return toast("Marque ao menos um dia da semana.", "error");
    setBusy(true);
    try {
      const r = await run(api.batchBook(client.id, { unit, time, dates }));
      const p = r?.pulos || {};
      close();
      toast(
        `✅ ${r?.agendadas ?? 0} aula(s) agendada(s).\n` +
        `Puladas: ${p.semTurma || 0} sem turma · ${p.cheia || 0} lotada(s) · ${p.jaAgendado || 0} já agendada(s).`
      );
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Agendar em lote — ${client.name}`} footer={<>
      <button className="btn ghost" onClick={() => open(<ClientProfile client={client} />)}>← Voltar</button>
      <button className="btn" onClick={save} disabled={busy || !comTurma.length}>Agendar {comTurma.length} aula(s)</button>
    </>}>
      <div className="cfg-preview" style={{ marginTop: 0, marginBottom: "1rem" }}>
        Agenda o(a) mensalista <b>{client.name}</b> nas turmas <b>já existentes</b> que baterem com o dia/horário. Não cria turmas novas.
      </div>
      <div className="row2">
        <div className="field"><label>Unidade</label><select value={unit} onChange={(e) => setUnit(e.target.value)}>{meta.units.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div className="field"><label>Horário</label><input value={time} onChange={(e) => setTime(e.target.value)} placeholder="09:00" /></div>
      </div>
      <div className="field">
        <label>Dias da semana</label>
        <WeekdayChips selected={weekdays} onToggle={toggleWd} />
      </div>
      <div className="field">
        <label>Por quantas semanas</label>
        <input type="number" min="1" max="52" value={weeks} onChange={(e) => setWeeks(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ width: 90 }} />
      </div>
      <div className="help">
        {weekdays.size
          ? `${dates.length} data(s) no período · ${comTurma.length} com turma existente (serão agendadas). As demais são puladas.`
          : "Marque os dias da semana para ver quantas aulas serão agendadas."}
      </div>
    </Modal>
  );
}

export function ClientForm({ client }) {
  const { data, run } = useStore();
  const { close } = useModal();
  const meta = data.meta;
  const [name, setName] = useState(client?.name || "");
  const [phone, setPhone] = useState(client?.phone || "");
  const [email, setEmail] = useState(client?.email || "");
  const [cpf, setCpf] = useState(client?.cpf || "");
  const [unit, setUnit] = useState(client?.unit || meta.units[0]);
  const [tags, setTags] = useState(client?.tags || []);
  const [notes, setNotes] = useState(client?.notes || "");
  const [birthday, setBirthday] = useState(client?.birthday || "");
  const [level, setLevel] = useState(client?.level || "");
  const [firstClass, setFirstClass] = useState(client ? !!client.firstClass : true);
  const [status, setStatus] = useState(client?.status || "ativo");
  const toggle = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  const save = async () => {
    if (!name.trim()) return toast("Informe o nome.", "error");
    const payload = { name: name.trim(), phone: phone.trim(), email: email.trim(), cpf: cpf.trim(), unit, tags, notes: notes.trim(), birthday, level, firstClass, status };
    await run(client ? api.updateClient(client.id, payload) : api.createClient(payload));
    close();
  };
  const del = async () => {
    if (await confirmModal({ title: "Excluir aluno", message: `Excluir ${client.name}?\n\nAs aulas futuras serão removidas da agenda; o histórico de aulas passadas é mantido.`, confirmLabel: "Excluir", tone: "danger" })) { await run(api.deleteClient(client.id)); close(); }
  };
  return (
    <Modal title={client ? "Editar aluno" : "Novo aluno"} footer={<>
      {client && <button className="btn danger" onClick={del}>Excluir</button>}
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save}>Salvar</button>
    </>}>
      <div className="row2">
        <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Telefone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="31988880000" /></div>
      </div>
      <div className="row2">
        <div className="field"><label>CPF <span style={{ color: "var(--muted)", fontWeight: 400 }}>(login do portal)</span></label><input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" inputMode="numeric" /></div>
        <div className="field"><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aluno@email.com" inputMode="email" /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Unidade</label><select value={unit} onChange={(e) => setUnit(e.target.value)}>{meta.units.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div className="field"><label>Nível de crochê</label>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">— não informado</option>
            {["Iniciante", "Intermediário", "Avançado"].map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>Aniversário</label><input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></div>
        <div className="field"><label>Primeira aula?</label>
          <label className="chip" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", marginTop: ".3rem" }}>
            <input type="checkbox" checked={firstClass} onChange={(e) => setFirstClass(e.target.checked)} style={{ marginRight: ".4rem" }} />
            Sim, é aluno(a) novo(a)
          </label>
        </div>
      </div>
      {client?.plan !== "mensalista" && (
        <div className="field"><label>Etiquetas</label>
          <div className="tags">
            {TAG_OPTIONS.map((t) => (
              <label key={t} className="chip" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={tags.includes(t)} onChange={() => toggle(t)} style={{ marginRight: ".3rem" }} />{t}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field"><label>Situação da inscrição</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ativo">Ativa — está fazendo o curso</option>
          <option value="cancelado">Cancelada — rompeu com o curso</option>
        </select>
        <div className="help" style={{ marginTop: ".4rem" }}>Quem rompe com o curso deixa de ganhar e de usar créditos de reposição.</div>
      </div>
      <div className="field"><label>Observações</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
    </Modal>
  );
}
