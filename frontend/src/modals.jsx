import { useState } from "react";
import { Modal, useModal, StatusBadge } from "./ui.jsx";
import { WaIcon } from "./icons.jsx";
import { useStore } from "./store.jsx";
import { api } from "./api.js";
import {
  UNITS, PROFS, TAG_OPTIONS, STATUS, VALOR_PADRAO, CAPACITY_PADRAO,
  unitColor, unitSoft, todayISO, fmtDate, fmtDateLong, money, waLink, capitalize,
  slotById, slotBookings, slotCapacity, slotWaitlist, clientAttendance,
} from "./helpers.js";

const openWa = (phone, msg) => window.open(waLink(phone, msg), "_blank");

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
export function SlotDetail({ slotId }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const slot = slotById(data, slotId);
  const [capInput, setCapInput] = useState(slot ? slotCapacity(slot) : CAPACITY_PADRAO);
  if (!slot) return <Modal title="Turma"><p>Horário não encontrado.</p></Modal>;
  const cap = slotCapacity(slot);
  const bks = slotBookings(data, slotId);
  const occ = bks.length, full = occ >= cap, uc = unitColor(slot.unit);
  const wl = slotWaitlist(slot);

  const mark = (b, val) => run(api.updateBooking(b.id, { attendance: b.attendance === val ? "" : val }));
  const saveCap = () => {
    if (capInput < occ) return alert(`A capacidade (${capInput}) não pode ser menor que as ${occ} reservas já feitas.`);
    run(api.updateSlotCapacity(slotId, capInput));
  };

  return (
    <Modal title={`Turma — ${slot.time}`} footer={<>
      <button className="btn ghost" onClick={() => open(<DayModal date={slot.date} />)}>← Voltar ao dia</button>
      <div style={{ flex: 1 }} />
      <button className="btn sec" onClick={saveCap}>Salvar capacidade</button>
      {full
        ? <button className="btn terra" onClick={() => open(<WaitlistForm slotId={slotId} />)}>⏰ Lista de espera</button>
        : <button className="btn" onClick={() => open(<BookingForm slotId={slotId} />)}>＋ Adicionar pessoa</button>}
    </>}>
      <div className="info-line"><b>Unidade</b><span><span className="chip" style={{ borderColor: uc, color: uc }}>{slot.unit}</span></span></div>
      <div className="info-line"><b>Data / hora</b><span>{fmtDateLong(slot.date)} · {slot.time}</span></div>
      <div className="info-line"><b>Profissional</b><span>{slot.prof || "—"}</span></div>
      <div className="field" style={{ marginTop: "1rem" }}>
        <label>Capacidade da turma — máx. de pessoas por aula</label>
        <input type="number" min="1" value={capInput} onChange={(e) => setCapInput(parseInt(e.target.value, 10) || 1)} />
        <div className="help" style={{ marginTop: ".5rem" }}>Esse é o limite de vagas. Quando lotar, o horário some das opções do cliente e (futuramente) o WhatsApp não oferece mais essa vaga.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "1rem 0 .3rem" }}>
        <b style={{ color: "var(--brown)" }}>Reservas · {occ}/{cap}</b>
        {full ? <span className="badge b-danger">Turma lotada</span> : <span className="badge b-ok">{cap - occ} vaga(s) livre(s)</span>}
      </div>
      {bks.length ? bks.map((b) => (
        <div className="roster-row" key={b.id}>
          <div className="rr-info"><b>{b.clientName}</b><div className="cli-sub">{b.phone || "sem telefone"} · {STATUS[b.status].label}</div></div>
          <div className="att" title="Marcar presença">
            <button className={`att-btn ${b.attendance === "presente" ? "on-pres" : ""}`} onClick={() => mark(b, "presente")} title="Presente">✓</button>
            <button className={`att-btn ${b.attendance === "falta" ? "on-falt" : ""}`} onClick={() => mark(b, "falta")} title="Faltou">✕</button>
          </div>
          <button className="btn sec sm" onClick={() => open(<ManageBooking booking={b} />)}>Gerir</button>
        </div>
      )) : <div className="empty" style={{ padding: "1.2rem" }}><div className="ic">🪑</div><p>Nenhuma reserva nesta turma ainda.</p></div>}

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
    if (!name.trim()) return alert("Informe o nome.");
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
  const slotExists = !!slotById(data, booking.slotId);
  const save = async () => {
    await run(api.updateBooking(booking.id, { status, attendance, date, time }));
    close();
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
      <div className="info-line"><b>Cliente</b><span>{booking.clientName}</span></div>
      <div className="info-line"><b>Telefone</b><span>{booking.phone || "—"}</span></div>
      <div className="info-line"><b>Unidade</b><span>{booking.unit}</span></div>
      <div className="info-line"><b>Aula</b><span>{fmtDateLong(booking.date)} · {booking.time}</span></div>
      <div className="info-line"><b>Valor</b><span>{money(booking.value)}</span></div>
      <div className="info-line"><b>Pagamento</b><span>{booking.paid ? `Pago (${booking.paymentMethod})` : "Pendente"}</span></div>
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
    if (!name.trim()) return alert("Informe o nome.");
    await run(api.createBooking({ clientName: name.trim(), phone: phone.trim(), unit, value, date, time, slotId: slot ? slot.id : undefined }));
    close();
  };
  return (
    <Modal title="Nova marcação" footer={<>
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save}>Salvar marcação</button>
    </>}>
      <div className="field"><label>Cliente existente</label>
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
  const [weeks, setWeeks] = useState(1);
  const save = async () => {
    const r = await run(api.createSlot({ unit, prof, date, time, capacity, weeks }));
    close();
    if (weeks > 1 && r) setTimeout(() => alert(`${r.created.length} horário(s) criado(s).`), 50);
  };
  return (
    <Modal title="Novo horário na agenda" footer={<>
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save}>Adicionar</button>
    </>}>
      <div className="row2">
        <div className="field"><label>Unidade</label><select value={unit} onChange={(e) => setUnit(e.target.value)}>{meta.units.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div className="field"><label>Profissional</label><select value={prof} onChange={(e) => setProf(e.target.value)}>{meta.profs.map((p) => <option key={p}>{p}</option>)}</select></div>
      </div>
      <div className="row2">
        <div className="field"><label>Data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Hora</label><input value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <div className="field"><label>Capacidade da turma (vagas)</label><input type="number" min="1" value={capacity} onChange={(e) => setCapacity(parseInt(e.target.value, 10) || 1)} /></div>
      <div className="field"><label>Repetir semanalmente</label>
        <select value={weeks} onChange={(e) => setWeeks(parseInt(e.target.value, 10))}>
          <option value={1}>Não repetir (só este dia)</option>
          <option value={2}>Por 2 semanas</option>
          <option value={4}>Por 4 semanas</option>
          <option value={8}>Por 8 semanas</option>
          <option value={12}>Por 12 semanas</option>
        </select>
        <div className="help" style={{ marginTop: ".5rem" }}>Cria o mesmo horário (mesmo dia da semana) repetido. Ex.: toda terça às 14h por 8 semanas. Horários já existentes são ignorados.</div>
      </div>
    </Modal>
  );
}

/* ======================= Perfil da aluna (histórico) ======================= */
export function ClientProfile({ client }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const c = data.clients.find((x) => x.id === client.id) || client;
  const at = clientAttendance(data, c.name);
  const hist = data.bookings.filter((b) => b.clientName === c.name).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const total = hist.filter((b) => b.status !== "cancelada").length;
  const pago = hist.filter((b) => b.paid).reduce((s, b) => s + b.value, 0);
  const resetPin = async () => {
    if (!window.confirm(`Redefinir o PIN de ${c.name}?\n\nO PIN atual será apagado e ela criará um novo no próximo acesso ao portal.`)) return;
    await run(api.resetPin(c.id));
    alert("PIN redefinido. O(a) aluno(a) criará um novo PIN no próximo acesso. 💚");
  };
  return (
    <Modal title={c.name} footer={<>
      <button className="btn wa" onClick={() => openWa(c.phone, `Olá ${c.name}! 💚`)}><WaIcon /> WhatsApp</button>
      {c.hasPin && <button className="btn ghost" onClick={resetPin}>🔑 Redefinir PIN</button>}
      <div style={{ flex: 1 }} />
      <button className="btn sec" onClick={() => open(<ClientForm client={c} />)}>Editar cadastro</button>
    </>}>
      <div className="info-line"><b>Telefone</b><span>{c.phone || "—"}</span></div>
      <div className="info-line"><b>Unidade</b><span><span className="chip">{c.unit || "—"}</span>{c.firstClass ? <span className="badge b-terra" style={{ marginLeft: ".4rem" }}>✨ Aluno(a) novo(a)</span> : null}</span></div>
      <div className="info-line"><b>Nível · Aniversário</b><span>{c.level || "—"}{c.birthday ? " · 🎂 " + fmtDate(c.birthday) : ""}</span></div>
      <div className="info-line"><b>Etiquetas</b><span className="tags" style={{ justifyContent: "flex-end" }}>{(c.tags || []).length ? c.tags.map((t) => <span key={t} className="chip">{t}</span>) : "—"}</span></div>
      <div className="info-line"><b>Acesso ao portal (PIN)</b><span>{c.hasPin ? <span className="badge b-ok">PIN cadastrado</span> : <span className="badge b-muted">Sem PIN ainda</span>}</span></div>
      {c.notes ? <div className="help" style={{ margin: ".7rem 0" }}>{c.notes}</div> : null}
      <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", gap: ".6rem", margin: "1rem 0" }}>
        <div className="card stat" style={{ padding: ".8rem 1rem" }}><div className="lbl">Aulas</div><div className="val" style={{ fontSize: "1.6rem" }}>{total}</div></div>
        <div className="card stat" style={{ padding: ".8rem 1rem" }}><div className="lbl">Presenças</div><div className="val" style={{ fontSize: "1.6rem" }}>{at.pres}</div><div className="foot">{at.falt} falta(s)</div></div>
        <div className="card stat" style={{ padding: ".8rem 1rem" }}><div className="lbl">Pago</div><div className="val terra" style={{ fontSize: "1.3rem" }}>{money(pago)}</div></div>
      </div>
      <b style={{ color: "var(--brown)" }}>Histórico de aulas</b>
      <div style={{ marginTop: ".6rem" }}>
        {hist.length ? hist.map((b) => (
          <div className="roster-row" key={b.id} style={{ cursor: "pointer" }} onClick={() => open(<ManageBooking booking={b} />)}>
            <div className="rr-info"><b>{fmtDate(b.date)} · {b.time}</b><div className="cli-sub">{b.unit}{b.attendance === "presente" ? " · ✓ presente" : b.attendance === "falta" ? " · ✕ faltou" : ""}{b.paid ? " · pago" : ""}</div></div>
            <StatusBadge status={b.status} />
          </div>
        )) : <div className="cli-sub" style={{ padding: ".5rem 0" }}>Sem histórico ainda.</div>}
      </div>
    </Modal>
  );
}

/* ======================= Cliente (novo/editar) ======================= */
export function ClientForm({ client }) {
  const { data, run } = useStore();
  const { close } = useModal();
  const meta = data.meta;
  const [name, setName] = useState(client?.name || "");
  const [phone, setPhone] = useState(client?.phone || "");
  const [cpf, setCpf] = useState(client?.cpf || "");
  const [unit, setUnit] = useState(client?.unit || meta.units[0]);
  const [tags, setTags] = useState(client?.tags || []);
  const [notes, setNotes] = useState(client?.notes || "");
  const [birthday, setBirthday] = useState(client?.birthday || "");
  const [level, setLevel] = useState(client?.level || "");
  const [firstClass, setFirstClass] = useState(client ? !!client.firstClass : true);
  const toggle = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  const save = async () => {
    if (!name.trim()) return alert("Informe o nome.");
    const payload = { name: name.trim(), phone: phone.trim(), cpf: cpf.trim(), unit, tags, notes: notes.trim(), birthday, level, firstClass };
    await run(client ? api.updateClient(client.id, payload) : api.createClient(payload));
    close();
  };
  const del = async () => {
    if (confirm("Excluir este cliente?")) { await run(api.deleteClient(client.id)); close(); }
  };
  return (
    <Modal title={client ? "Editar cliente" : "Novo cliente"} footer={<>
      {client && <button className="btn danger" onClick={del}>Excluir</button>}
      <div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={close}>Cancelar</button>
      <button className="btn" onClick={save}>Salvar</button>
    </>}>
      <div className="row2">
        <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Telefone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="31988880000" /></div>
      </div>
      <div className="field"><label>CPF <span style={{ color: "var(--muted)", fontWeight: 400 }}>(usado no login do portal do aluno)</span></label><input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" inputMode="numeric" /></div>
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
      <div className="field"><label>Etiquetas</label>
        <div className="tags">
          {TAG_OPTIONS.map((t) => (
            <label key={t} className="chip" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={tags.includes(t)} onChange={() => toggle(t)} style={{ marginRight: ".3rem" }} />{t}
            </label>
          ))}
        </div>
      </div>
      <div className="field"><label>Observações</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
    </Modal>
  );
}
