import { useState, useRef, useEffect } from "react";
import { Modal, useModal, StatusBadge, Select } from "./ui.jsx";
import { WaIcon } from "./icons.jsx";
import { useStore } from "./store.jsx";
import { api } from "./api.js";
import { toast, confirmModal, promptModal } from "./toast.jsx";
import {
  UNITS, PROFS, TAG_OPTIONS, VALOR_PADRAO, CAPACITY_PADRAO, STATUS, BOOKING_KINDS,
  unitColor, unitSoft, todayISO, fmtDate, fmtDateLong, money, waLink, capitalize, faixaHorario, hhmm,
  slotById, slotBookings, slotBookingsAll, slotCapacity, slotWaitlist, clientAttendance, nomeCurto, irmasNaAgenda,
  marcadoresDoAluno, contemBusca,
  bookingKind, bookingKindDe, feriadoDe, feriadoBaseDe, MARCAS_MATRICULA, ehPagamentoDeMatricula, situacaoMensalidade, clientOfBooking,
  competenciasDoAluno, compLabel, mensalidadeDe, matriculaISO,
  compAtual, addComp, precoDaComp, mensalidadeDaComp,
  WEEKDAYS_SHORT, dowMon, datesForWeekdays, addDays, SEMANAS_PADRAO, MESES_PADRAO,
  tipoMensalista, TIPO_MENSALISTA_LABEL,
  validarCPF, formatarCPF,
  proximaCobranca, fraseProximaCobranca,
  PLANOS_MENSALISTA, FREQ_MAX_ESCALA, valorPlanoMeta,
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
/* 3x e 4x por semana são só para mensalista fixo: a opção que não combina
   com a outra escolha aparece travada, com o motivo no lugar da dica. */
const tipoMensalistaOpcoes = (freq) => TIPO_MENSALISTA_OPCOES.map((o) =>
  o.value === "escala" && Number(freq) > FREQ_MAX_ESCALA
    ? { ...o, disabled: true, hint: `não existe escala de ${freq}x — só 1x ou 2x por semana` }
    : o);
const planoOpcoes = (meta, tipo, { value = (f) => f, label = (f) => `${f}x por semana` } = {}) =>
  PLANOS_MENSALISTA.map((p) => ({
    value: value(p.freq),
    label: label(p.freq),
    hint: p.soFixo && tipo === "escala" ? "só para mensalista fixo" : `${p.aulasMes} aulas por mês`,
    icon: "📅",
    meta: money(valorPlanoMeta(meta, p.freq)),
    disabled: !!p.soFixo && tipo === "escala",
  }));

/* Resultado da criação de horários: as aulas duram 2h, então o servidor recusa
   turmas que se sobrepõem na mesma unidade — aqui a gente conta o que aconteceu. */
function avisarCriacao(r, sempre = false) {
  if (!r) return;
  const criados = r.created?.length ?? 0;
  const conflitos = r.conflitos || [];
  /* Datas puladas por serem feriado. Dizer isso em voz alta importa: o pulo
     silencioso foi exatamente como a regra do sábado sumiu da vista — a Inêz
     via a semana faltando na agenda e não sabia por quê. */
  const feriados = r.feriados || [];
  if (feriados.length) {
    const lista = feriados.slice(0, 3).map((f) => `${fmtDate(f.date)} (${f.nome})`).join(", ");
    return toast(
      `${criados} horário(s) criado(s). ${feriados.length} dia(s) pulado(s) por feriado: ${lista}${feriados.length > 3 ? "…" : ""}`,
      "info",
    );
  }
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
    partes.push(`${r.naoReplicadas.length} reserva(s) fora da cópia (reposição / matrícula)`);
    tom = "info";
  }
  toast(`Replicado por ${semanas} semana(s). ${partes.join(". ")}.`, tom);
}

/* ======================= Cartão de horário =======================
   `todosAlunos` = a turma inteira aparece na lista, sem o corte "+N mais".
   É como a visão de SEMANA usa o cartão: ali a Inêz precisa bater o olho na
   coluna do dia e ver quem está em cada turma, sem abrir turma por turma. */
export function SlotCard({ slot, showUnit, todosAlunos = false, somenteLeitura = false }) {
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
      onClick={() => open(somenteLeitura ? <TurmaView slotId={slot.id} /> : <SlotDetail slotId={slot.id} />)}>
      <div className="slot-top">
        <span className="t" style={{ color: occ ? uc : undefined }}>{hhmm(slot.time)}</span>
        <span className={`occ ${full ? "is-full" : occ > 0 ? "is-part" : ""}`}>{occ}/{cap}</span>
      </div>
      {showUnit && <div className="n"><b style={{ color: uc }}>{slot.unit}</b></div>}
      {todas.length ? (
        <div className={`sc-roster ${todosAlunos ? "sc-todos" : ""}`}>
          {(todosAlunos ? todas : todas.slice(0, 5)).map((b) => {
            const k = bookingKindDe(data, b);
            // 🎂 aniversário perto do dia da aula · 🙋 mensalista de escala
            const marcas = marcadoresDoAluno(data, b, slot.date);
            const dica = [b.clientName, ...marcas.map((m) => m.label), k ? k.label : null].filter(Boolean).join(" · ");
            return (
              /* Reposição ganha destaque próprio (sc-repo): na agenda ela some
                 no meio da turma, e é justamente a aula que a Inêz precisa
                 reconhecer de longe — é vaga de outra aluna sendo ocupada, não
                 aula do plano de quem está ali. */
              <div key={b.id} className={`sc-al ${b.status === "cancelada" ? "canc" : ""} ${k ? "sc-" + k.key : ""}`} title={dica}>
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
export function DayModal({ date, unit = "Todas", somenteLeitura = false }) {
  const { data, reload, run } = useStore();
  const { open, close } = useModal();
  const [ferBusy, setFerBusy] = useState("");
  const todas = unit === "Todas";
  const slots = data.slots
    .filter((s) => s.date === date && (todas || s.unit === unit))
    .sort((a, b) => a.time.localeCompare(b.time));
  const title = capitalize(new Date(date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }));
  const unidades = todas ? (data.meta?.units || []) : [unit];
  const feriadosDoDia = unidades
    .map((u) => ({ unit: u, nome: feriadoBaseDe(data, date, u), fechado: !!feriadoDe(data, date, u) }))
    .filter((f) => f.nome);
  const fer = !todas ? feriadoDe(data, date, unit) : feriadosDoDia.filter((f) => f.fechado).map((f) => f.nome).join(" / ");
  const alternarFeriado = async (f) => {
    if (somenteLeitura || ferBusy) return;
    setFerBusy(f.unit);
    try {
      const r = await api.feriados.definirAulas(date, f.unit, f.fechado);
      await reload();
      if (!f.fechado && r.aulas?.length) open(<FeriadoAulas date={date} unit={f.unit} nome={f.nome} aulas={r.aulas} />);
      else toast(f.fechado ? `Aulas ativadas em ${f.unit}.` : `Dia fechado em ${f.unit}.`, "ok");
    } catch (e) { toast(e.message || "Não foi possível alterar o feriado.", "error"); }
    finally { setFerBusy(""); }
  };
  const sub = (
    <>
      {feriadosDoDia.map((f) => (
        <div className={`day-feriado ${f.fechado ? "" : "aberto"}`} key={f.unit}>
          <span>{f.fechado ? "🚫" : "✅"} <b>{f.nome}</b>{todas ? ` · ${f.unit}` : ""}</span>
          {!somenteLeitura && (
            <label className="hf-toggle" style={{ margin: 0 }}>
              <input type="checkbox" checked={!f.fechado} disabled={ferBusy === f.unit}
                onChange={() => alternarFeriado(f)} />
              <span className="hf-day">Terá aula</span>
            </label>
          )}
        </div>
      ))}
      {!todas && <div className="day-sub">📍 Unidade: <b>{unit}</b></div>}
    </>
  );
  const excluirDia = async () => {
    const dow = new Date(date + "T00:00").getDay();
    const diaSemana = capitalize(new Date(date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long" }));
    const futurosMesmoDow = (data.slots || []).filter(
      (s) => s.date >= todayISO() && (todas || s.unit === unit) && new Date(s.date + "T00:00").getDay() === dow
    );
    const datasDistintas = [...new Set(futurosMesmoDow.map((s) => s.date))];
    const temMais = datasDistintas.length > 1;

    const msg = temMais
      ? `Há ${datasDistintas.length} ${diaSemana}s futuras cadastradas na agenda (${todas ? "todas as unidades" : unit}).\n\n` +
        `Deseja excluir apenas os ${slots.length} horário(s) deste dia selecionado (${fmtDate(date)}) ou excluir em lote todas as ${datasDistintas.length} ${diaSemana}s futuras?`
      : `Excluir todos os ${slots.length} horário(s) do dia ${fmtDate(date)}?`;

    const ans = await confirmModal({
      title: `Excluir dia — ${title}`,
      message: msg,
      confirmLabel: temMais ? `Excluir em lote (${datasDistintas.length} dias)` : "Excluir este dia",
      altLabel: temMais ? "Só este dia" : undefined,
      cancelLabel: "Cancelar",
      tone: "danger",
    });
    if (!ans) return;
    const batch = ans !== "alt" && temMais;
    const r = await run(api.deleteDay({ date, unit: todas ? undefined : unit, batch }));
    toast(`✅ ${r?.deleted ?? 0} horário(s) excluído(s).`);
    close();
  };

  return (
    <Modal title={title} subheader={feriadosDoDia.length || !todas ? sub : undefined} footer={<>
      <button className="btn ghost" onClick={close}>Fechar</button>
      {!somenteLeitura && slots.length > 0 && (
        <button className="btn ghost" style={{ color: "var(--danger)" }} onClick={excluirDia} title="Excluir horários deste dia (individual ou em lote)">
          🗑 Excluir dia
        </button>
      )}
      {!somenteLeitura && slots.length > 0 && (
        <button className="btn sec" onClick={() => open(<ReplicateTurmaForm date={date} unit={unit} />)}>🗓 Replicação</button>
      )}
      {!somenteLeitura && !fer && <button className="btn" onClick={() => open(<SlotForm presetDate={date} presetUnit={unit} />)}>＋ Novo horário</button>}
    </>}>
      {slots.length
        ? <div className="day-view" style={{ maxWidth: "none" }}>{slots.map((s) => <SlotCard key={s.id} slot={s} showUnit={todas} somenteLeitura={somenteLeitura} />)}</div>
        : <div className="empty"><div className="ic">🧶</div><p>Nenhum horário{todas ? "" : ` de ${unit}`} cadastrado neste dia.</p></div>}
    </Modal>
  );
}

/* ================== Legenda da Turma (Cores / Emojis) ================== */
export function TurmaLegend() {
  return (
    <div className="turma-legend">
      {Object.values(BOOKING_KINDS).map((t) => (
        <span key={t.key} className="lg">
          <span className="lgdot" style={{ background: t.color }} />
          {t.ic} {t.label}
        </span>
      ))}
      <span className="lg-sep" />
      <span className="lg" title="Aniversário no dia ou na semana da aula">
        🎂 Aniversário
      </span>
      <span className="lg" title="Mensalista que escolhe suas aulas por escala">
        🙋 Escala
      </span>
      <span className="lg-sep" />
      {Object.keys(STATUS).map((k) => (
        <span key={k} className="lg">
          <span className="lgdot" style={{ background: STATUS[k].dot }} />
          {STATUS[k].label}
        </span>
      ))}
    </div>
  );
}

/* ================== Turma em modo consulta (instrutoras) ==================
   Mesma turma do SlotDetail, sem nada que mexa: quem abre aqui está vendo quem
   tem aula, não operando a agenda. Presença aparece como estado, não como
   botão — a chamada continua sendo feita por quem tem acesso de gestão. */
export function TurmaView({ slotId }) {
  const { data } = useStore();
  const { close } = useModal();
  const slot = slotById(data, slotId);
  if (!slot) return <Modal title="Turma"><p>Horário não encontrado.</p></Modal>;
  const cap = slotCapacity(slot);
  const todas = slotBookingsAll(data, slotId);
  const ativas = todas.filter((b) => b.status !== "cancelada");
  const uc = unitColor(slot.unit);
  const wl = slotWaitlist(slot);

  return (
    <Modal
      title={`${hhmm(slot.time)} · ${slot.unit}`}
      subheader={
        <div className="day-sub" style={{ color: uc }}>
          📅 {fmtDateLong(slot.date)} · {faixaHorario(slot.time, data.meta.duracaoAulaMin)} ·{" "}
          <b>{ativas.length}/{cap}</b> {ativas.length === 1 ? "aluna" : "alunas"}
        </div>
      }
      footer={<button className="btn ghost" onClick={close}>Fechar</button>}
    >
      <TurmaLegend />
      {todas.length ? (
        <div className="tv-lista">
          {todas.map((b) => {
            const k = bookingKindDe(data, b);
            const marcas = marcadoresDoAluno(data, b, slot.date);
            return (
              <div key={b.id} className={`tv-al ${b.status === "cancelada" ? "canc" : ""}`}
                style={k ? { "--kc": k.color } : undefined}>
                <span className="tv-nm">
                  {marcas.map((m) => <span key={m.k} className="tv-marca" title={m.label}>{m.ic}</span>)}
                  {b.clientName}
                </span>
                <span className="tv-sp">
                  {k && <span className={`badge ${k.cls}`}>{k.ic} {k.label}</span>}
                  {b.attendance === "presente" && <span className="badge b-ok">✓ presente</span>}
                  {b.attendance === "falta" && <span className="badge b-danger">✕ faltou</span>}
                  <StatusBadge status={b.status} />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty"><div className="ic">🧶</div><p>Nenhuma aluna neste horário ainda.</p></div>
      )}
      {wl.length > 0 && (
        <div className="tv-espera">⏰ {wl.length} na lista de espera</div>
      )}
      <p className="tv-nota">Seu acesso é de consulta: aqui você acompanha a agenda, sem alterar nada.</p>
    </Modal>
  );
}

/* ======================= Detalhe da turma ======================= */
export function SlotDetail({ slotId }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  const slot = slotById(data, slotId);
  const [capInput, setCapInput] = useState(slot ? slotCapacity(slot) : CAPACITY_PADRAO);
  if (!slot) return <Modal title="Turma"><p>Horário não encontrado.</p></Modal>;
  const cap = slotCapacity(slot);
  const todas = slotBookingsAll(data, slotId);
  const bks = todas.filter((b) => b.status !== "cancelada");
  const occ = bks.length, full = occ >= cap, uc = unitColor(slot.unit);
  const wl = slotWaitlist(slot);

  const mark = (b, val) => run(api.updateBooking(b.id, { attendance: b.attendance === val ? "" : val }));
  /* A capacidade também é em lote: o tamanho da sala é da turma, não do dia.
     Como toda ação do painel, ela pergunta antes e mantém a saída "só esta".
     Datas cujas reservas já passam da nova capacidade ficam de fora sozinhas —
     o backend as devolve em `apertadas` em vez de derrubar a alteração toda. */
  const saveCap = async () => {
    if (capInput < occ) return toast(`A capacidade (${capInput}) não pode ser menor que as ${occ} reservas já feitas.`, "error");
    const irmas = irmasNaAgenda(data, slot);
    let lote = false;
    if (irmas.length) {
      const ans = await confirmModal({
        title: "Capacidade em lote",
        message: `Há mais ${irmas.length} ocorrência(s) futura(s) desta turma na agenda.\n\nAplicar a capacidade de ${capInput} a todas?`,
        confirmLabel: `Aplicar às ${irmas.length + 1}`,
        altLabel: "Só esta",
      });
      if (!ans) return;
      lote = ans !== "alt";
    }
    const r = await run(api.updateSlotCapacity(slotId, capInput, lote));
    const apertadas = r?.apertadas || [];
    if (lote)
      toast(
        `Capacidade aplicada a ${r?.alteradas ?? irmas.length + 1} turma(s).` +
        (apertadas.length ? `\n${apertadas.length} data(s) ficaram de fora: já têm mais reservas que isso.` : "")
      );
  };
  const del = async () => {
    const sibs = irmasNaAgenda(data, slot);
    const diaSemana = capitalize(new Date(slot.date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long" }));
    if (!sibs.length) {
      const msg = `Excluir a turma de ${diaSemana}, ${fmtDate(slot.date)} às ${slot.time} em ${slot.unit}?` +
        (occ > 0 ? `\n\nEsta turma tem ${occ} reserva(s) que também serão removidas.` : "");
      if (!(await confirmModal({ title: "Excluir turma / horário", message: msg, confirmLabel: "Excluir turma", tone: "danger" }))) return;
      await run(api.deleteSlot(slotId));
      close();
      return;
    }
    const allRes = occ + sibs.reduce((n, s) => n + slotBookings(data, s.id).length, 0);
    const ultimo = sibs.reduce((m, s) => (s.date > m ? s.date : m), slot.date);
    const ans = await confirmModal({
      title: "Excluir turma / horário",
      message: `Há mais ${sibs.length} turma(s) de ${diaSemana} às ${slot.time} em ${slot.unit} nas próximas semanas (até ${fmtDate(ultimo)}).\n\n` +
        (allRes > 0 ? `Ao todo, ${allRes} reserva(s) de alunas serão removidas.\n\n` : "") +
        `Deseja excluir apenas esta turma selecionada (${fmtDate(slot.date)}) ou excluir em lote todas as ${sibs.length + 1} turmas futuras?`,
      confirmLabel: `Excluir em lote (${sibs.length + 1} turmas)`,
      altLabel: "Só este registro",
      cancelLabel: "Cancelar",
      tone: "danger",
    });
    if (!ans) return;
    const r = await run(api.deleteSlot(slotId, ans === "alt" ? null : "match"));
    toast(`✅ ${r?.deleted ?? (ans === "alt" ? 1 : sibs.length + 1)} turma(s) excluída(s).`);
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
        <button className="btn sec sm" onClick={() => open(<ReplicateTurmaForm slot={slot} />)}
          title="Replicar turma, dia, semana ou mês">🗓 Replicação</button>
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

      <TurmaLegend />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "1rem 0 .3rem" }}>
        <b style={{ color: "var(--brown)" }}>Reservas · {occ}/{cap}</b>
        {full ? <span className="badge b-danger">Turma lotada</span> : <span className="badge b-ok">{cap - occ} vaga(s) livre(s)</span>}
      </div>
      {todas.length ? todas.map((b) => {
        const k = bookingKindDe(data, b);
        const marcas = marcadoresDoAluno(data, b, slot.date);
        const c = clientOfBooking(data, b);
        const isCanc = b.status === "cancelada";
        return (
        <div className={`roster-row ${isCanc ? "canc" : ""}`} key={b.id} style={isCanc ? { opacity: 0.65 } : undefined}>
          <span className="sc-dot" style={{ width: "9px", height: "9px", borderRadius: "50%", background: isCanc ? "var(--danger)" : k ? k.color : "var(--pink)", flex: "none" }} />
          <div className="rr-info">
            <div style={{ display: "flex", alignItems: "center", gap: ".35rem", flexWrap: "wrap" }}>
              {marcas.map((m) => (
                <span key={m.k} className={`sc-marca ${m.forte ? "" : "fraca"}`} title={m.label} style={{ fontSize: ".95rem", cursor: "help" }}>
                  {m.ic}
                </span>
              ))}
              <b style={isCanc ? { textDecoration: "line-through" } : undefined}>{b.clientName}</b>
              {k && <span className={`badge ${k.cls} ml`}>{k.ic} {k.label}</span>}
              {!k && c?.plan === "mensalista" && <span className="badge b-ok ml">📅 Mensalista</span>}
              {!k && (!c || c.plan !== "mensalista") && <span className="badge b-muted ml">💠 Avulso</span>}
              <StatusBadge status={b.status} />
            </div>
            <div className="cli-sub">
              {b.phone || "sem telefone"}
              {isCanc && b.absenceReason && ` · Motivo: “${b.absenceReason}”`}
            </div>
          </div>
          {!isCanc && (
            <div className="att" title="Marcar presença">
              <button className={`att-btn ${b.attendance === "presente" ? "on-pres" : ""}`} onClick={() => mark(b, "presente")} title="Presente">✓</button>
              <button className={`att-btn ${b.attendance === "falta" ? "on-falt" : ""}`} onClick={() => mark(b, "falta")} title="Faltou">✕</button>
            </div>
          )}
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
  /* Duas reservas — e só essas duas — carregam dinheiro próprio: a de matrícula
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
    const t = todayISO();
    const dow = new Date(booking.date + "T00:00").getDay();
    const diaSemana = capitalize(new Date(booking.date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long" }));
    const sibs = (data.bookings || []).filter(
      (b) =>
        b.clientName === booking.clientName &&
        b.id !== booking.id &&
        b.unit === booking.unit &&
        b.time === booking.time &&
        b.date >= t &&
        ((booking.seriesId && b.seriesId === booking.seriesId) || new Date(b.date + "T00:00").getDay() === dow)
    );
    if (!sibs.length) {
      const msg = `Tirar ${booking.clientName} da aula de ${diaSemana}, ${fmtDate(booking.date)} às ${booking.time}?` +
        (booking.paid ? "\n\nAtenção: esta aula consta como paga." : "") +
        "\n\nA vaga volta a ficar livre na turma. Não gera crédito de reposição.";
      if (!(await confirmModal({ title: "Excluir aluno(a) da turma", message: msg, confirmLabel: "Excluir da turma", tone: "danger" }))) return;
      await run(api.deleteBooking(booking.id));
      toast(`✅ ${booking.clientName} removida desta turma.`);
      close();
      return;
    }
    const pagas = (booking.paid ? 1 : 0) + sibs.filter((b) => b.paid).length;
    const ans = await confirmModal({
      title: "Excluir aluno(a) da turma",
      message: `${booking.clientName} tem mais ${sibs.length} aula(s) agendada(s) nas próximas semanas neste mesmo dia e horário (${diaSemana}s às ${booking.time} em ${booking.unit}).` +
        (pagas > 0 ? `\n\nAtenção: ${pagas} dessas aula(s) consta(m) como paga(s).` : "") +
        `\n\nDeseja excluir a aluna apenas deste registro selecionado (${fmtDate(booking.date)}) ou excluir em lote de todas as ${sibs.length + 1} aulas semanais futuras?`,
      confirmLabel: `Excluir em lote (${sibs.length + 1} aulas)`,
      altLabel: "Só este registro",
      cancelLabel: "Cancelar",
      tone: "danger",
    });
    if (!ans) return;
    const r = await run(api.deleteBooking(booking.id, ans !== "alt"));
    toast(`✅ ${r?.deleted ?? (ans === "alt" ? 1 : sibs.length + 1)} aula(s) de ${booking.clientName} excluída(s).`);
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
          a de matrícula (1ª mensalidade) e a aula extra. Nas demais, quem se
          paga é a mensalidade do mês — não a aula. */}
      {cobraNaReserva && !booking.paid && <button className="btn terra" onClick={() => open(<ConfirmPayment booking={booking} />)}>Confirmar pagamento</button>}
    </>}>
      <div className="info-line"><b>Aluno</b><span>{booking.clientName}</span></div>
      <div className="info-line"><b>Telefone</b><span>{booking.phone || "—"}</span></div>
      <div className="info-line"><b>Unidade</b><span>{booking.unit}</span></div>
      <div className="info-line"><b>Aula</b><span>{fmtDateLong(booking.date)} · {faixaHorario(booking.time, data.meta?.duracaoAulaMin)}</span></div>
      {/* A aula não tem preço próprio: só a reserva da matrícula carrega
          dinheiro (é a 1ª mensalidade da aluna). Nas demais, o que importa é
          como está a mensalidade do mês dela. */}
      {cobraNaReserva ? (<>
        {/* Quando houve taxa de matrícula, o valor da reserva é a SOMA. Mostrar
            só o total aqui faria a Inêz ler "1ª mensalidade R$ 140" e achar que
            o plano mudou de preço — então as parcelas aparecem separadas. */}
        {ehPagamentoDeMatricula(booking.paymentMethod) && Number(booking.taxaMatricula) > 0 ? (<>
          <div className="info-line"><b>1ª mensalidade</b><span>{money(booking.value - booking.taxaMatricula)}</span></div>
          <div className="info-line"><b>Taxa de matrícula</b><span>{money(booking.taxaMatricula)}</span></div>
          <div className="info-line"><b>Total cobrado</b><span><b>{money(booking.value)}</b></span></div>
        </>) : (
          <div className="info-line"><b>{ehPagamentoDeMatricula(booking.paymentMethod) ? "1ª mensalidade" : "Aula extra"}</b><span>{money(booking.value)}</span></div>
        )}
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
      {booking.status === "cancelada" && (
        <div className="info-line"><b>Situação</b><span><StatusBadge status={booking.status} /></span></div>
      )}
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
  // Só reservas com dinheiro próprio: matrícula (1ª mensalidade) e aula extra.
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

/* ======================= Dar baixa em Lead (1ª aula / matrícula paga por fora) ======================= */
export function BaixarLeadModal({ client, onComplete }) {
  const { data, run } = useStore();
  const { close } = useModal();
  const [busy, setBusy] = useState(false);

  // Busca agendamentos associados
  const clientDigits = (client.phone || "").replace(/\D/g, "");
  const bookings = (data?.bookings || []).filter(
    (b) => b.clientName === client.name || (clientDigits && b.phone && b.phone.replace(/\D/g, "").endsWith(clientDigits.slice(-8)))
  );
  const isMensalista = client.plan === "mensalista" || client.matriculaStatus === "pendente" || (client.weeklyFreq && client.weeklyFreq > 0);

  const valorPadrao = isMensalista
    ? (Number(valorPlanoMeta(data?.meta, client.weeklyFreq)) || valorPlanoMeta({}, client.weeklyFreq))
    : (bookings[0]?.value ? Number(bookings[0].value) : (Number(data?.meta?.valorAvulsa) || 40));

  const [value, setValue] = useState(valorPadrao);
  const [method, setMethod] = useState("Pix");
  const [pdate, setPdate] = useState(todayISO());

  const bk = bookings[0];

  const confirmar = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const res = await run(api.baixarLead(client.id, {
        paymentMethod: method,
        paymentDate: pdate,
        value: Number(value) || valorPadrao,
      }));
      toast(res?.message || `Baixa registrada! ${client.name} agora está ativa.`, "success");
      close();
      if (onComplete) onComplete(res);
    } catch {
      // erro exibido pelo run
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Dar baixa · ${client.name}`}
      footer={
        <>
          <button className="btn ghost" disabled={busy} onClick={close}>Cancelar</button>
          <button className="btn" disabled={busy} onClick={confirmar}>✓ Confirmar baixa</button>
        </>
      }
    >
      <div className="help" style={{ marginBottom: "1rem" }}>
        Registra que a aluna realizou o pagamento por fora (dinheiro, Pix, cartão ou transferência). O cadastro será ativado, sairá de <b>Leads</b> e o valor entrará nos <b>Recebimentos</b> do mês.
      </div>

      <div style={{ background: "rgba(0,0,0,.03)", padding: ".75rem 1rem", borderRadius: "8px", marginBottom: "1rem", border: "1px solid rgba(0,0,0,.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".3rem" }}>
          <span className="cli-sub">Tipo de entrada:</span>
          <b>{isMensalista ? `📅 Mensalista (${client.weeklyFreq || 1}x/semana)` : "🧺 Aula Avulsa"}</b>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".3rem" }}>
          <span className="cli-sub">Unidade:</span>
          <span>{client.unit || "—"}</span>
        </div>
        {bk && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="cli-sub">Aula agendada:</span>
            <span>{fmtDate(bk.date)} às {bk.time} {bk.status === "cancelada" ? "(reserva expirada no WhatsApp)" : `(${bk.status})`}</span>
          </div>
        )}
      </div>

      <div className="row2">
        <div className="field">
          <label>Forma de pagamento</label>
          <Select value={method} onChange={setMethod} options={FORMAS_PAGAMENTO} />
        </div>
        <div className="field">
          <label>Data do pagamento</label>
          <input type="date" value={pdate} onChange={(e) => setPdate(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Valor cobrado (R$)</label>
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
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
    const qDigits = query.replace(/\D/g, "");
    const phoneMatch = qDigits ? (c.phone || "").replace(/\D/g, "").includes(qDigits) : false;
    return contemBusca([c.name, c.unit], query) || phoneMatch;
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
  /* Repetição (igual à criação de horários): dias da semana × nº de semanas.
     Nasce EM LOTE — o dia da semana da data escolhida já vem marcado e o
     horizonte é o padrão de 12 meses. A marcação de uma aula só continua a um
     clique de distância: basta desmarcar o dia. Ver SEMANAS_PADRAO.

     Com uma exceção, que é o combinado: só a MENSALISTA FIXA tem grade para
     replicar. A avulsa vem para uma aula, e a mensalista de escala marca cada
     ocorrência sozinha pelo portal — pré-marcar 52 datas para qualquer uma das
     duas inventaria aula que ninguém contratou. Enquanto não há aluna escolhida
     o lote fica ligado, porque a marcação nova do painel é da grade; escolher
     uma avulsa ou uma aluna de escala desliga (ver o efeito mais abaixo). */
  const [weekdays, setWeekdays] = useState(() => new Set([dowMon(slot ? slot.date : todayISO())]));
  const [weeks, setWeeks] = useState(SEMANAS_PADRAO);
  /* Enquanto a Inêz não mexer nos dias, eles seguem a data escolhida — trocar
     a data para uma quinta e continuar repetindo na terça seria uma agenda que
     ninguém pediu. Depois do primeiro toque nos chips, a escolha dela manda. */
  const mexeuNosDias = useRef(false);
  const toggleWd = (i) => {
    mexeuNosDias.current = true;
    setWeekdays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  };
  /* Quem manda no padrão: a data escolhida diz QUAL dia repetir, a aluna diz SE
     repete. Enquanto a Inêz não tocar nos chips, os dois seguem sozinhos. */
  const tipo = tipoMensalista(selectedClient);
  const temGrade = !selectedClient || tipo === "fixo";
  useEffect(() => {
    if (!mexeuNosDias.current) setWeekdays(temGrade ? new Set([dowMon(date)]) : new Set());
  }, [date, temGrade]);
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
    /* Marcações administrativas podem ser unitárias ou em lote. A frequência
       contratada monta a grade inicial, mas não bloqueia ajustes posteriores. */
    // value 0: a aula não tem preço próprio — quem se paga é a mensalidade do mês.
    const payload = { clientName: name.trim(), phone: phone.trim(), unit, value: 0, date, time, slotId: slot && !repetindo ? slot.id : undefined };
    if (repetindo) payload.dates = dates;
    const r = await run(api.createBooking(payload));
    close();
    if (repetindo) {
      const p = r?.pulos || {};
      const puladas = (p.lotada || 0) + (p.jaMarcada || 0) + (p.liberada || 0);
      const fer = r?.feriados?.length || 0;
      toast(
        `✅ ${r?.created?.length ?? 0} aula(s) marcada(s).` +
        (puladas
          ? `\nPuladas: ${p.lotada || 0} turma(s) lotada(s) · ${p.jaMarcada || 0} já marcada(s)` +
            (p.liberada ? ` · ${p.liberada} liberada(s) pela aluna` : "") + "."
          : "") +
        (fer ? `\n${fer} dia(s) em feriado — a escola não abre.` : "")
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
          <span className="field-subtext">(desmarque tudo para marcar só nesta data)</span>
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

      {repetindo ? (
        <div className="repeat-info-box">
          <div className="repeat-info-title">
            <span>📅</span> <b>{dates.length} marcações recorrentes agendadas</b>
          </div>
          <div className="repeat-info-desc">
            Serão criadas aulas às <b>{time}</b> a partir de <b>{fmtDate(date)}</b>. Turmas lotadas e aulas já marcadas serão puladas automaticamente.
          </div>
        </div>
      ) : (
        <div className="repeat-info-box">
          <div className="repeat-info-title"><span>📌</span> <b>Só nesta data</b></div>
          <div className="repeat-info-desc">
            Vai marcar uma aula só, em <b>{fmtDate(date)}</b>.{" "}
            {tipo === "escala"
              ? <>{selectedClient.name} é mensalista de <b>escala</b> — ela marca cada aula pelo portal, por isso a repetição não vem ligada.</>
              : selectedClient && !tipo
                ? <>{selectedClient.name} não é mensalista: aula avulsa não tem grade para repetir.</>
                : <>Para voltar ao padrão da escola, marque o dia da semana acima.</>}
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
  // Nasce em lote, como todo o resto do painel: o dia da semana da data já vem
  // marcado, por 12 meses. Desmarcar tudo cria o horário avulso. Ver SEMANAS_PADRAO.
  const [weekdays, setWeekdays] = useState(() => new Set([dowMon(presetDate || todayISO())]));
  const [weeks, setWeeks] = useState(SEMANAS_PADRAO);
  const mexeuNosDias = useRef(false);
  const toggleWd = (i) => {
    mexeuNosDias.current = true;
    setWeekdays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  };
  useEffect(() => {
    if (!mexeuNosDias.current) setWeekdays(new Set([dowMon(date)]));
  }, [date]);

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
        <label>Repetir nos dias da semana <span className="help" style={{ fontWeight: 400 }}>(desmarque tudo para criar só nesta data)</span></label>
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
            : `Vai criar um horário só, nesta data. Marque o dia da semana para repetir a turma pelos próximos ${MESES_PADRAO} meses.`}
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
  /* Editar é em LOTE por padrão, como incluir e excluir: mudar "a turma das
     09:00 de terça" quer dizer a turma, não aquela terça. O escape é este
     seletor. Mudar a DATA é a única alteração que só existe em unidade — uma
     data nova é um dia da semana novo, e o backend recusa o lote nesse caso. */
  const [emLote, setEmLote] = useState(true);
  const mudouData = date !== slot.date;

  /* As mesmas irmãs que o backend vai alcançar (ver irmasDaTurma no server.js).
     Contamos aqui só para dizer à Inêz quantas turmas ela vai mexer. */
  const irmas = irmasNaAgenda(data, slot);
  const loteVale = emLote && !mudouData && irmas.length > 0;

  const mudou = unit !== slot.unit || (prof || "") !== (slot.prof || "") || date !== slot.date || hhmm(slot.time) !== time;

  const save = async () => {
    if (!time) return toast("Informe o horário.", "error");
    if (bks.length || loteVale) {
      const reservasLote = loteVale
        ? irmas.reduce((n, s) => n + slotBookings(data, s.id).length, 0)
        : 0;
      const ok = await confirmModal({
        title: loteVale ? "Editar turma em lote" : "Editar turma",
        message: loteVale
          ? `A alteração vale para esta e mais ${irmas.length} ocorrência(s) futura(s) desta turma.` +
            (bks.length + reservasLote > 0
              ? `\n\n${bks.length + reservasLote} reserva(s) ao todo serão movidas junto para o novo horário/unidade.`
              : "") +
            `\n\nContinuar?`
          : `Esta turma tem ${bks.length} reserva(s).\n\nAo salvar, todas serão movidas para o novo dia/horário/unidade. Continuar?`,
        confirmLabel: loteVale ? `Salvar nas ${irmas.length + 1}` : "Salvar e mover",
      });
      if (!ok) return;
    }
    const r = await run(api.updateSlot(slot.id, { unit, prof, date, time }, loteVale));
    const apertadas = r?.apertadas || [];
    toast(
      (loteVale ? `${r?.alteradas ?? irmas.length + 1} turma(s) atualizada(s). 💚` : "Turma atualizada. 💚") +
      (apertadas.length ? `\n${apertadas.length} data(s) ficaram de fora: já têm mais reservas que a nova capacidade.` : "")
    );
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
      <div className="field" style={{ marginTop: ".2rem" }}>
        <label>Alcance da alteração</label>
        {mudouData ? (
          <div className="help">
            Você mudou a <b>data</b>: isso move <b>só esta aula</b>. Uma data nova é um dia da semana novo —
            aplicar isso à turma inteira empilharia as próximas ocorrências todas no mesmo dia.
          </div>
        ) : irmas.length === 0 ? (
          <div className="help">Esta é a única ocorrência futura desta turma na agenda. A alteração vale só para ela.</div>
        ) : (
          <>
            <Select
              value={emLote ? "lote" : "uma"}
              onChange={(v) => setEmLote(v === "lote")}
              options={[
                { value: "lote", label: `Esta e as próximas (${irmas.length + 1})`, icon: "🗓" },
                { value: "uma", label: "Só esta aula", icon: "📌" },
              ]}
            />
            <div className="help" style={{ marginTop: ".5rem" }}>
              {emLote
                ? <>Alcança as ocorrências <b>futuras</b> de {capitalize(new Date(slot.date + "T00:00").toLocaleDateString("pt-BR", { weekday: "long" }))} às {hhmm(slot.time)} em {slot.unit}. Aulas já realizadas ficam como estão.</>
                : <>Muda só {fmtDate(slot.date)}. As outras ocorrências da turma continuam no horário atual.</>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ======================= REPLICAÇÃO ÚNICA DA AGENDA ======================= */
export function ReplicateTurmaForm({ slot = null, date: presetDate, unit: presetUnit = "Todas" }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  const date = slot?.date || presetDate;
  const unit = slot?.unit || presetUnit;
  const [scope, setScope] = useState(slot ? "class" : "day");
  /* Horizonte padrão do painel: 12 meses ≈ 52 semanas (ver SEMANAS_PADRAO). O
     escopo inicial ("class" ou "day") conta em SEMANAS; só "month" conta em
     meses, e a troca de escopo reajusta a unidade logo abaixo. */
  const [repetitions, setRepetitions] = useState(SEMANAS_PADRAO);
  const [comAlunas, setComAlunas] = useState(true);
  const [busy, setBusy] = useState(false);

  const iniSemana = addDays(date, -dowMon(date));
  const fontes = data.slots.filter((s) => {
    if (scope === "class") return slot && s.id === slot.id;
    if (unit !== "Todas" && s.unit !== unit) return false;
    if (scope === "day") return s.date === date;
    if (scope === "week") return s.date >= iniSemana && s.date <= addDays(iniSemana, 6);
    return s.date.slice(0, 7) === date.slice(0, 7);
  });
  const fonteIds = new Set(fontes.map((s) => s.id));
  const regulares = data.bookings.filter((b) => fonteIds.has(b.slotId) && b.status !== "cancelada" && b.paymentMethod === "Mensalista");
  const alunasEscala = new Set((data.clients || []).filter((c) => c.mensalistaTipo === "escala").map((c) => c.name));
  const regularesEscala = regulares.filter((b) => alunasEscala.has(b.clientName));
  const regularesFixas = regulares.filter((b) => !alunasEscala.has(b.clientName));
  const periodo = scope === "month"
    ? `${repetitions} mês(es), cerca de ${Math.round(repetitions * 4.35)} semana(s)`
    : `${repetitions} semana(s)`;
  const escopos = [
    ["class", "Turma", "esta turma completa"],
    ["day", "Dia", "todos os horários deste dia"],
    ["week", "Semana", "a semana completa"],
    ["month", "Mês", "o mês completo"],
  ];

  const save = async () => {
    if (busy) return;
    if (!fontes.length) return toast("Não há horários neste período para replicar.", "error");
    setBusy(true);
    try {
      const r = await run(api.replicateAgenda({
        scope,
        repetitions,
        date,
        unit,
        slotId: slot?.id,
        withStudents: comAlunas,
      }));
      toast(
        `✅ Replicação concluída: ${r.slots} horário(s) e ${r.aulas} aula(s) criados.` +
        (r.capacidades ? ` ${r.capacidades} turma(s) existente(s) receberam a capacidade total da origem.` : "") +
        (r.feriados?.length ? ` ${r.feriados.length} ocorrência(s) em feriado fechado foram puladas.` : "") +
        (r.pulos?.length ? ` ${r.pulos.length} ocorrência(s) não puderam ser criadas.` : ""),
        "ok",
      );
      slot ? open(<SlotDetail slotId={slot.id} />) : close();
    } catch { /* o run já avisou do erro */ } finally { setBusy(false); }
  };

  const atalhos = scope === "month" ? [1, 3, 6, MESES_PADRAO] : [1, 4, 12, 26, SEMANAS_PADRAO];
  return (
    <Modal title="Replicação" footer={<>
      <button className="btn ghost" onClick={() => slot ? open(<SlotDetail slotId={slot.id} />) : close()}>← Voltar</button>
      <div style={{ flex: 1 }} />
      <button className="btn" onClick={save} disabled={busy}>
        {busy ? "Replicando…" : `Replicar ${periodo}`}
      </button>
    </>}>
      <div className="cfg-preview" style={{ marginTop: 0, marginBottom: "1rem" }}>
        Base: <b>{fmtDateLong(date)}</b>{unit !== "Todas" ? <> · <b>{unit}</b></> : <> · todas as unidades</>}
        {slot ? <> · {faixaHorario(slot.time, data.meta?.duracaoAulaMin)}</> : null}
      </div>

      <div className="field">
        <label>O que será replicado</label>
        <div className="wd-chips">
          {escopos.map(([value, label, hint]) => (
            <button key={value} type="button" disabled={value === "class" && !slot}
              className={`wd-chip ${scope === value ? "on" : ""}`}
              title={hint} onClick={() => { setScope(value); setRepetitions(value === "month" ? MESES_PADRAO : SEMANAS_PADRAO); }}>
              {label}
            </button>
          ))}
        </div>
        <div className="help" style={{ marginTop: ".45rem" }}>
          {escopos.find(([value]) => value === scope)?.[2]} · <b>{fontes.length} horário(s)</b> na origem.
        </div>
      </div>

      <div className="field">
        <label>{scope === "month" ? "Por quantos meses" : "Por quantas semanas"}</label>
        <div className="wd-chips" style={{ marginBottom: ".6rem" }}>
          {atalhos.map((n) => (
            <button key={n} type="button" className={`wd-chip ${repetitions === n ? "on" : ""}`} onClick={() => setRepetitions(n)}>
              {n === 1 ? "Próximo" : `${n} ${scope === "month" ? "meses" : "sem"}`}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span style={{ fontSize: ".85rem", color: "var(--muted)" }}>ou</span>
          <input type="number" min="1" max={scope === "month" ? 24 : 52} value={repetitions} style={{ width: 90 }}
            onChange={(e) => setRepetitions(Math.min(scope === "month" ? 24 : 52, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
          <span style={{ fontSize: ".85rem", color: "var(--muted)" }}>{periodo}</span>
        </div>
      </div>

      <div className="field">
        <label>O que replicar</label>
        <label style={{ display: "flex", alignItems: "center", gap: ".5rem", fontWeight: 400, cursor: "pointer" }}>
          <input type="checkbox" checked={comAlunas} onChange={(e) => setComAlunas(e.target.checked)} style={{ width: "auto" }} />
          <span>Levar as mensalistas fixas junto <span className="help" style={{ fontWeight: 400 }}>(alunas de escala nunca são replicadas)</span></span>
        </label>
      </div>

      <div className="help">
        Serão processados até <b>{fontes.length * repetitions} horário(s)</b> ao longo de <b>{periodo}</b>.
        {" "}A capacidade total dos horários do <b>dia-base</b> será aplicada às turmas equivalentes, mesmo quando elas já existirem e tiverem alunas cadastradas.
        {comAlunas ? <>
          {" "}Há <b>{regularesFixas.length} marcação(ões) fixa(s) replicável(is)</b> na origem.
          {regularesEscala.length ? <> <b>{regularesEscala.length} marcação(ões) de escala</b> serão ignoradas.</> : null}
          {" "}Reposições, aulas extras, experimentais e avulsas <b>nunca</b> serão copiadas.
        </> : null}
        {" "}Feriados fechados serão pulados; se a chave “Terá aula” estiver ligada, o dia será tratado normalmente.
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
  const tabelaPlanos = PLANOS_MENSALISTA.map((p) => ({ freq: p.freq, valor: valorPlanoMeta(data.meta, p.freq) }));

  const toggle = (id) => setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const todos = () => setMarcados(marcados.length === individuais.length ? [] : individuais.map((c) => c.id));

  const salvar = async () => {
    if (!valido) return toast("Informe o reajuste.", "error");
    if (!atualizarTabela && !marcados.length) return toast("Nada foi marcado para reajustar.", "error");

    const linhas = [];
    if (atualizarTabela) {
      linhas.push(`Tabela: ${tabelaPlanos.map((p) => `${p.freq}x/semana ${money(p.valor)} → ${money(aplicar(p.valor))}`).join(" · ")}.`);
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
      toast(`Reajuste aplicado.${r.tabela ? ` Tabela: ${PLANOS_MENSALISTA.map((p) => money(r.tabela[`plano${p.freq}x`])).join(" / ")}.` : ""}`, "success");
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
                ? <>{tabelaPlanos.map((p, i) => (
                    <span key={p.freq}>{i ? " · " : ""}{p.freq}x/semana <b>{money(p.valor)} → {money(aplicar(p.valor))}</b></span>
                  ))}.
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
  "Registrar pagamento manual (dinheiro, transferência ou acerto). A baixa quita a mensalidade do mês sem interferir nos meses seguintes.";

export async function baixarMensalidade(inv, run, nome = "", clientInvoices = []) {
  const comp = inv.competencia;
  const mesAtual = compAtual();
  const compAnt = addComp(comp, -1);
  const antPaga = (clientInvoices || []).some(
    (i) => i.clientId === inv.clientId && i.competencia === compAnt && i.status === "pago"
  );
  const ehMesSeguinte = comp > mesAtual || (antPaga && comp >= mesAtual);

  let msg;
  if (comp > mesAtual || antPaga) {
    msg =
      `ℹ️ A mensalidade anterior (${compLabel(compAnt)}) já está paga.\n\n` +
      `Confirmar a baixa da mensalidade de ${compLabel(comp)}${nome ? ` de ${nome}` : ""} (mês seguinte) como PAGA?\n\n` +
      `Ela sai de "a receber" e entra no recebido do mês, no Financeiro.`;
  } else {
    msg =
      `Marcar a mensalidade de ${compLabel(comp)}${nome ? ` de ${nome}` : ""} como PAGA?\n\n` +
      `Ela sai de "a receber" e entra no recebido do mês, no Financeiro.\n\n` +
      `A mensalidade do próximo mês será gerada normalmente com Pix.`;
  }

  const ok = await confirmModal({
    title: "Dar baixa na mensalidade",
    message: msg,
    confirmLabel: "✓ Dar baixa",
    cancelLabel: "Voltar",
  });
  if (!ok) return false;
  try {
    await run(api.payInvoice(inv.id));
    toast(`Baixa registrada com sucesso para a mensalidade de ${compLabel(comp)}.`, "success");
    return true;
  } catch {
    return false; // o erro já foi mostrado pelo run
  }
}

/* ================== Alterar Vencimento da Mensalidade ================== */
export function AlterarVencimentoModal({ invoice, clientName }) {
  const { run } = useStore();
  const { close } = useModal();
  const [dueDate, setDueDate] = useState(invoice?.dueDate || todayISO());
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e?.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return toast("Informe uma data de vencimento válida (AAAA-MM-DD).", "error");
    setBusy(true);
    try {
      await run(api.updateInvoice(invoice.id, { dueDate }));
      toast("Data de vencimento atualizada com sucesso!", "success");
      close();
    } catch {
      // erro exibido pelo run
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Alterar vencimento · ${compLabel(invoice.competencia)}`}
      subheader={clientName ? <div className="cli-sub">Aluno(a): <b>{clientName}</b></div> : null}
      footer={<>
        <button className="btn ghost" onClick={close} disabled={busy}>Cancelar</button>
        <button className="btn sec" onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar vencimento"}</button>
      </>}
    >
      <div className="field">
        <label>Nova data de vencimento do boleto</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        <div className="help" style={{ marginTop: ".45rem" }}>
          Ao alterar a data para hoje ou uma data futura, o boleto sai do estado de atraso e os encargos (multa/juros) são recalculados automaticamente.
        </div>
      </div>
    </Modal>
  );
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
    try { await baixarMensalidade(inv, run, client.name, data.invoices); }
    finally { setBusy(false); }
  };
  /* Gerar Pix da mensalidade caso ainda não tenha QR gerado */
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
              </span>
              {inv && inv.status === "pendente" && (
                <span className="hist-act">
                  <button className="btn ghost sm" disabled={busy} title="Corrigir ou alterar a data de vencimento deste boleto" onClick={() => open(<AlterarVencimentoModal invoice={inv} clientName={client.name} />)}>
                    ✏️ Vencimento
                  </button>
                  {!inv.pixCode && (
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
  add(c.trialDate, "✨", "Primeira aula", "");
  add(c.matriculaAt, "🎟️", "Matriculada — 1ª mensalidade paga", "");
  add(c.matriculaRefundAt, "↩️", "Matrícula devolvida", "");
  return out.sort((a, b) => b.d.localeCompare(a.d)).slice(0, 14);
}

export function ClientProfile({ client, initialTab }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  const c = data.clients.find((x) => x.id === client.id) || client;
  const at = clientAttendance(data, c.name);
  const clientDigits = (c.phone || "").replace(/\D/g, "");
  const hist = data.bookings.filter((b) => b.clientName === c.name || (clientDigits && b.phone && b.phone.replace(/\D/g, "").endsWith(clientDigits.slice(-8)))).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const hasPaid = hist.some((b) => b.paid || b.status === "concluida" || (b.status === "confirmada" && b.paymentMethod)) || c.matriculaStatus === "paga" || c.matriculaStatus === "convertida";
  const total = hist.filter((b) => b.status !== "cancelada").length;
  const pago = hist.filter((b) => b.paid).reduce((s, b) => s + b.value, 0);
  const t = todayISO();
  const futuras = hist.filter((b) => b.date >= t && b.status !== "cancelada");
  const proxima = futuras.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const temAulaFutura = futuras.length > 0;
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
      {ehMensalista && temAulaFutura && <button className="btn sec" onClick={() => open(<BatchUnbookForm client={c} />)}>🗑 Tirar em lote</button>}
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
              : c.status === "lead" && !hasPaid
              ? <span className="badge b-warn" style={{ background: "#fff3cd", color: "#856404", border: "1px solid #ffeeba" }}>⚠️ Pagamento não realizado</span>
              : c.status === "lead" && hasPaid
              ? <span className="badge b-ok" style={{ background: "rgba(34,197,94,0.12)", color: "#15803d", border: "1px solid rgba(34,197,94,0.3)" }}>✓ Pagamento confirmado</span>
              : <span className="badge b-ok">Ativa</span>}
            {c.firstClass ? <span className="badge b-terra">✨ Novo(a)</span> : null}
            {/* Ficha nascida na conversa do WhatsApp: os dados foram digitados
                pela própria aluna, sem revisão de ninguém da escola. */}
            {c.origem === "whatsapp" ? <span className="badge b-info" title="Cadastro feito pela própria aluna na conversa do WhatsApp">💬 Cadastro via WhatsApp</span> : null}
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
            {c.status === "lead" && !hasPaid && (
              <div style={{ background: "#fff3cd", color: "#856404", padding: ".75rem 1rem", borderRadius: 8, marginBottom: "1rem", border: "1px solid #ffeeba", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                <div>
                  <b style={{ display: "block", fontSize: ".95rem" }}>⚠️ Lead — Pagamento não realizado</b>
                  <span style={{ fontSize: ".84rem" }}>A aluna iniciou o agendamento mas o pagamento não foi confirmado. O acesso ao portal da aluna está bloqueado.</span>
                </div>
                <div style={{ display: "flex", gap: ".5rem", flexShrink: 0 }}>
                  <button className="btn sm" onClick={() => open(<BaixarLeadModal client={c} />)}>
                    ✓ Dar baixa
                  </button>
                  <button className="btn wa sm" style={{ whiteSpace: "nowrap" }} onClick={() => openWa(c.phone, `Olá ${c.name}! Tudo bem? 💚 Vi que você iniciou o agendamento da sua aula de crochê na Fios que Curam mas ainda não recebemos a confirmação do pagamento. Posso te ajudar a garantir sua vaga?`)}>
                    Cobrar no WhatsApp
                  </button>
                </div>
              </div>
            )}
            {c.status === "lead" && hasPaid && (
              <div style={{ background: "rgba(34,197,94,0.08)", color: "#15803d", padding: ".75rem 1rem", borderRadius: 8, marginBottom: "1rem", border: "1px solid rgba(34,197,94,0.25)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                <div>
                  <b style={{ display: "block", fontSize: ".95rem" }}>✓ Pagamento confirmado</b>
                  <span style={{ fontSize: ".84rem" }}>A aula/matrícula desta aluna foi paga! O cadastro pode ser concluído como aluna ativa.</span>
                </div>
                <div style={{ display: "flex", gap: ".5rem", flexShrink: 0 }}>
                  <button className="btn sm ok" onClick={() => open(<BaixarLeadModal client={c} />)}>
                    ✓ Concluir ativação
                  </button>
                </div>
              </div>
            )}
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
    : PLANOS_MENSALISTA.some((p) => p.freq === c.weeklyFreq) ? valorPlanoMeta(meta, c.weeklyFreq)
    : (meta.mensalidadeValor ?? 0);
  const freq = c.weeklyFreq ? `${c.weeklyFreq}x por semana` : "plano antigo";
  const tipo = tipoMensalista(c);
  return (<>
    <span className="badge b-ok">📅 {freq}</span>{" "}
    <span className="badge b-info">{tipo === "escala" ? "🙋" : "📌"} {TIPO_MENSALISTA_LABEL[tipo]}</span>{" "}
    <span className="cli-sub">{money(valor)}/mês</span>
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
  /* O que ela pagou para entrar: 1ª mensalidade + taxa de matrícula. A reserva
     da matrícula guarda as duas coisas (`value` é o total, `taxaMatricula` é
     a parte da taxa), então os números aqui são os que ela pagou de fato — não
     os da tabela de hoje, que pode ter mudado desde então. */
  const reservaMatricula = (data.bookings || [])
    .filter((b) => b.clientName === client.name && MARCAS_MATRICULA.includes(b.paymentMethod))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const valorEntrada = reservaMatricula?.value ?? mensalidadeDe(client, data.meta);
  const taxaPaga = Number(reservaMatricula?.taxaMatricula || 0);
  // A TAXA NÃO VOLTA: devolve-se a mensalidade que estava dentro do pagamento.
  const valorDevolucao = Math.max(0, valorEntrada - taxaPaga);
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
    /* O valor a devolver vem escrito na confirmação porque é você quem faz o
       Pix de volta, na frente da aluna. Fazer essa subtração de cabeça, com
       alguém esperando, é onde o erro acontece. */
    if (!(await confirmModal({
      title: "Devolver a mensalidade",
      message: (taxaPaga > 0
        ? `Ela pagou ${money(valorEntrada)} (mensalidade ${money(valorDevolucao)} + taxa de matrícula ${money(taxaPaga)}).\n\n` +
          `➜ Devolver ${money(valorDevolucao)} para ${client.name}.\n` +
          `A taxa de matrícula de ${money(taxaPaga)} NÃO é devolvida.\n\n`
        : `Confirmar a devolução INTEGRAL de ${money(valorEntrada)} para ${client.name}?\n\n`) +
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
        ? `Devolução registrada: devolver ${money(d.devolver ?? valorDevolucao)}` +
          (d.taxaRetida ? ` (taxa de ${money(d.taxaRetida)} retida)` : "") +
          `. ${d.aulas} aula(s) e ${d.mensalidades} mensalidade(s) canceladas.`
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
        {taxaPaga > 0 ? <>Mensalidade <b>{money(valorDevolucao)}</b> + taxa de matrícula <b>{money(taxaPaga)}</b>. </> : null}
        {client.trialDate ? <>Primeira aula em <b>{fmtDate(client.trialDate)}</b>. </> : null}
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

/* Matricular: fixa escolhe a grade de 12 meses; escala não recebe recorrência. */
export function EnrollForm({ client }) {
  const { data, run } = useStore();
  const { open } = useModal();
  const meta = data.meta || {};
  const [freq, setFreq] = useState(1);
  const [tipo, setTipo] = useState("fixo");
  const [slotIds, setSlotIds] = useState([""]);
  const [busy, setBusy] = useState(false);
  const t = todayISO();
  const livres = data.slots
    .filter((s) => s.date >= t && slotBookings(data, s.id).length < slotCapacity(s))
    // Sem regra de data no plano (sábado saiu em 30/08, 18h em 26/08), a 1ª aula
    // oficial pode cair em qualquer turma livre da grade.
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const valor = valorPlanoMeta(meta, freq);
  const ehEscala = tipo === "escala";

  const salvar = async () => {
    const escolhidos = ehEscala ? [] : slotIds.slice(0, freq).filter(Boolean);
    if (!ehEscala && (escolhidos.length !== freq || new Set(escolhidos.map(Number)).size !== freq))
      return toast(`Escolha ${freq} horário${freq > 1 ? "s" : ""} diferente${freq > 1 ? "s" : ""} para a grade.`, "error");
    if (!(await confirmModal({
      title: "Confirmar matrícula",
      message: `Matricular ${client.name} no plano de ${freq}x por semana (${money(valor)}/mês), como mensalista ${tipo}?\n\n` +
        (ehEscala
          ? `Mensalistas de escala não recebem grade replicada: cada aula será marcada individualmente.\n\n`
          : `A grade escolhida será reservada automaticamente por 12 meses. Feriados fechados serão pulados e não contarão como aula.\n\n`) +
        "A primeira mensalidade será gerada agora.",
      confirmLabel: "Matricular",
    }))) return;
    setBusy(true);
    try {
      const r = await run(api.enroll(client.id, { weeklyFreq: freq, mensalistaTipo: tipo, slotIds: escolhidos.map(Number) }));
      toast(`Matrícula concluída — ${ehEscala ? "aulas marcadas individualmente" : `${r.grade?.total || 0} aulas reservadas por 12 meses`} · ${money(r.valorMensal)}/mês.${r.invoice ? "" : " Atenção: a mensalidade não foi gerada."}`,
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
        Se ela já pagou a 1ª mensalidade pela tela de matrícula, o mês corrente entra como quitado.
      </div>
      <div className="field" style={{ marginTop: "1rem" }}>
        <label>Plano</label>
        <Select
          value={freq}
          onChange={(v) => { const n = Number(v); setFreq(n); setSlotIds(Array(n).fill("")); }}
          options={planoOpcoes(meta, tipo)}
        />
      </div>
      <div className="field">
        <label>Tipo de mensalista</label>
        <Select
          value={tipo}
          onChange={setTipo}
          options={tipoMensalistaOpcoes(freq)}
        />
      </div>
      {ehEscala && (
        <div className="help" style={{ marginBottom: ".8rem" }}>
          Aluna de <b>escala</b>: nenhuma aula será replicada. Ela marcará cada data individualmente pelo portal.
        </div>
      )}
      {!ehEscala && Array.from({ length: freq }, (_, i) => (
        <div className="field" key={i}>
          <label>{freq === 1 ? "Horário semanal" : `${i + 1}º horário semanal`}</label>
          <Select
            value={slotIds[i] || ""}
            onChange={(v) => setSlotIds((atuais) => atuais.map((x, j) => j === i ? v : x))}
            defaultOption={{ label: "Escolha uma turma", icon: "🗓️" }}
            options={livres.slice(0, 80).map((s) => {
              const vagas = slotCapacity(s) - slotBookings(data, s.id).length;
              return {
                value: s.id,
                label: `${fmtDate(s.date)} · ${faixaHorario(s.time, meta.duracaoAulaMin)}`,
                hint: `${s.unit} — ${vagas} vaga(s) · repete por 12 meses`,
                icon: "🧶",
              };
            })}
          />
        </div>
      ))}
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
  /* Crédito cuja aula de origem voltou para a agenda não vale mais: a aluna
     tem a aula: não há o que repor. O backend é quem manda (ver
     creditosComAulaDeVolta no server.js) — aqui a conta é repetida só para o
     painel não oferecer um botão que a API vai recusar. */
  const aulasAtivas = new Set(
    (data.bookings || [])
      .filter((b) => b.clientName === client.name && b.status !== "cancelada")
      .map((b) => `${b.date} ${(b.time || "").slice(0, 5)}`)
  );
  const creditos = (data.makeups || [])
    .filter((m) => m.clientId === client.id)
    .map((m) => ({
      ...m,
      situacao: m.usedBookingId ? "usado"
        : aulasAtivas.has(`${m.originDate} ${(m.originTime || "").slice(0, 5)}`) ? "revogado"
        : m.expiresOn < t ? "expirado"
        : "disponivel",
    }));
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

  const rotulo = {
    disponivel: ["b-ok", "disponível"],
    usado: ["b-muted", "usado"],
    expirado: ["b-danger", "expirou"],
    revogado: ["b-muted", "aula voltou"],
  };

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
  /* Reposição e aula extra usam uma única turma e nunca criam recorrência. */
  const marcar = async (s) => {
    if (!(await confirmModal({ title: titulo, message: confirmar(s), confirmLabel: titulo }))) return;
    try {
      await run(acao(s, false)); // run já avisa o erro na tela
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
          return (
            <div className="roster-row row-click" key={s.id} onClick={() => marcar(s)}>
              <div className="rr-info">
                <b>{fmtDate(s.date)} · {faixaHorario(s.time, data.meta?.duracaoAulaMin)}</b>
                <div className="cli-sub">
                  {s.unit} · {slotCapacity(s) - slotBookings(data, s.id).length} vaga(s)
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
      ajuda="Não há vaga reservada para reposição — aparecem só as turmas que já têm vaga livre. Máximo de 2 reposições dentro do mesmo mês. O crédito só fica válido depois que a data da aula liberada passa, e a reposição é sempre uma ocorrência única."
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
      ajuda="Cortesia: entra confirmada, sem cobrança, sem consumir crédito e sem recorrência. Quando a aluna compra a aula extra pelo portal dela, o Pix é gerado lá e ela mesma escolhe o horário."
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
  /* A primeira marcação da aluna é a única do lado da aluna que vai em lote, e
     ela nasce com o horizonte da grade da escola: 12 meses. Se aqui fosse menor
     que a replicação da turma, a aluna nova acabaria com a agenda terminando
     antes da turma dela. Ver SEMANAS_PADRAO. */
  const [weeks, setWeeks] = useState(SEMANAS_PADRAO);
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
    /* Datas que ela LIBEROU nesta turma. O backend não remarca aula liberada
       (situacaoNaTurma), então contá-las como agendáveis prometia na tela um
       número de aulas que nunca seria criado. */
    const liberadas = data.bookings.filter((b) => b.clientName === client.name && b.status === "cancelada");

    return [...map.values()]
      .map((g) => {
        const noPeriodo = new Set(datesForWeekdays(t, [g.dow], weeks));
        const relevantes = g.slots.filter((s) => noPeriodo.has(s.date));
        let ok = 0, cheias = 0, jaAgendadas = 0, jaLiberadas = 0;
        const mesmaAula = (b, s) => b.date === s.date && b.time === s.time && b.unit === s.unit;
        relevantes.forEach((s) => {
          if (minhas.some((b) => mesmaAula(b, s))) jaAgendadas++;
          else if (liberadas.some((b) => mesmaAula(b, s))) jaLiberadas++;
          else if (slotBookings(data, s.id).length >= slotCapacity(s)) cheias++;
          else ok++;
        });
        // vagas da próxima ocorrência, para dar uma noção de lotação
        const prox = relevantes.sort((a, b) => a.date.localeCompare(b.date))[0];
        const proxVagas = prox ? slotCapacity(prox) - slotBookings(data, prox.id).length : null;
        const proxCap = prox ? slotCapacity(prox) : null;
        const prof = prox?.prof || g.slots[0]?.prof || "";
        return { ...g, total: relevantes.length, ok, cheias, jaAgendadas, jaLiberadas, prox, proxVagas, proxCap, prof, datas: relevantes.map((s) => s.date) };
      })
      .filter((g) => g.total > 0)
      .sort((a, b) => a.dow - b.dow || a.time.localeCompare(b.time));
  })();

  const toggle = (key) => setPicked((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const escolhidos = grupos.filter((g) => picked.has(g.key));
  const totalAgendar = escolhidos.reduce((n, g) => n + g.ok, 0);

  const save = async () => {
    if (!escolhidos.length) return toast("Escolha ao menos uma turma.", "error");
    setBusy(true);
    try {
      // a API agenda um horário por chamada — agrupamos as datas por horário
      const porHorario = new Map();
      escolhidos.forEach((g) => {
        if (!porHorario.has(g.time)) porHorario.set(g.time, []);
        porHorario.get(g.time).push(...g.datas);
      });
      let agendadas = 0;
      const p = { semTurma: 0, cheia: 0, jaAgendado: 0, feriado: 0, liberada: 0 };
      for (const [time, datas] of porHorario) {
        const r = await run(api.batchBook(client.id, { unit, time, dates: [...new Set(datas)] }));
        agendadas += r?.agendadas ?? 0;
        const rp = r?.pulos || {};
        p.semTurma += rp.semTurma || 0; p.cheia += rp.cheia || 0; p.jaAgendado += rp.jaAgendado || 0;
        p.feriado += rp.feriado || 0; p.liberada += rp.liberada || 0;
      }
      close();
      toast(
        `✅ ${agendadas} aula(s) agendada(s).\n` +
        `Puladas: ${p.semTurma} sem turma · ${p.cheia} lotada(s) · ${p.jaAgendado} já agendada(s)` +
        (p.liberada ? ` · ${p.liberada} liberada(s) pela aluna` : "") +
        (p.feriado ? ` · ${p.feriado} em feriado (a escola não abre)` : "") + "."
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
        A frequência do plano define a grade inicial, mas não bloqueia esta operação da ADMIN.
      </div>

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
                  
                  <div className="bb-vagas">
                    {g.proxVagas != null && (
                      <span className={`badge ${g.proxVagas === 0 ? "b-danger" : g.proxVagas <= 1 ? "b-warn" : "b-ok"}`}>
                        {g.proxVagas}/{g.proxCap} vaga(s)
                      </span>
                    )}
                  </div>
                  <div className="bb-foot">
                    <b>{g.ok}</b> de {g.total} data(s) livre(s)
                    {(g.cheias > 0 || g.jaAgendadas > 0 || g.jaLiberadas > 0) && (
                      <div className="bb-skip">
                        {g.cheias > 0 && <>· {g.cheias} lotada(s) </>}
                        {g.jaAgendadas > 0 && <>· {g.jaAgendadas} já agendada(s) </>}
                        {g.jaLiberadas > 0 && <>· {g.jaLiberadas} liberada(s) pela aluna</>}
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

/* ============ Tirar aulas em lote (mensalista) ============
   O contrário do "Agendar em lote": aqui as turmas listadas são as que o aluno
   JÁ tem marcadas daqui para frente. Só aula futura entra na lista — o que já
   aconteceu fica no histórico, aconteça o que acontecer nesta tela. */
export function BatchUnbookForm({ client }) {
  const { data, run } = useStore();
  const { open, close } = useModal();
  // Até onde olhar. "todas" é o padrão porque o caso comum é sair da turma de
  // vez; recortar por semanas serve para tirar só um pedaço (viagem, licença).
  const [horizonte, setHorizonte] = useState("todas");
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const t = todayISO();
  const ate = horizonte === "todas" ? null : addDays(t, Number(horizonte) * 7 - 1);

  /* Turmas em que ela está: agrupadas por unidade + dia da semana + horário,
     que é como a Inêz pensa ("ela sai da terça das 14h em Boa Vista"). */
  const grupos = (() => {
    const map = new Map();
    data.bookings
      .filter((b) => b.clientName === client.name && b.status !== "cancelada"
        && b.date >= t && (!ate || b.date <= ate))
      .forEach((b) => {
        const dow = dowMon(b.date);
        const key = `${b.unit}|${dow}|${b.time}`;
        if (!map.has(key)) map.set(key, { key, unit: b.unit, dow, time: b.time, aulas: [] });
        map.get(key).aulas.push(b);
      });
    return [...map.values()]
      .map((g) => {
        const aulas = g.aulas.sort((a, b) => a.date.localeCompare(b.date));
        return {
          ...g, aulas,
          repo: aulas.filter((b) => b.paymentMethod === "Reposição").length,
          extra: aulas.filter((b) => b.paymentMethod === "Avulsa").length,
        };
      })
      .sort((a, b) => a.dow - b.dow || a.time.localeCompare(b.time) || a.unit.localeCompare(b.unit));
  })();

  const toggle = (key) => setPicked((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const escolhidos = grupos.filter((g) => picked.has(g.key));
  const totalRemover = escolhidos.reduce((n, g) => n + g.aulas.length, 0);

  const save = async () => {
    if (!escolhidos.length) return toast("Escolha ao menos uma turma.", "error");
    const resumo = escolhidos
      .map((g) => `• ${WEEKDAYS_SHORT[g.dow]} ${hhmm(g.time)} · ${g.unit} — ${g.aulas.length} aula(s), de ${fmtDate(g.aulas[0].date)} a ${fmtDate(g.aulas[g.aulas.length - 1].date)}`)
      .join("\n");
    /* Duas saídas, e a diferença é dinheiro/direito da aluna — por isso as duas
       aparecem escritas aqui, e não numa opção escondida na tela anterior. */
    const escolha = await confirmModal({
      title: `Tirar ${totalRemover} aula(s) de ${client.name}`,
      message:
        `${resumo}\n\n` +
        "Aulas já passadas não são tocadas.\n\n" +
        "SÓ TIRAR DA AGENDA: as aulas somem, sem crédito. É o caso de troca de turma ou marcação errada.\n\n" +
        "TIRAR E DAR CRÉDITO: as aulas ficam canceladas no histórico e viram crédito de reposição onde as regras permitirem (antecedência e limite do mês continuam valendo).\n\n" +
        "Não dá para desfazer.",
      confirmLabel: "Só tirar da agenda",
      altLabel: "Tirar e dar crédito",
      cancelLabel: "Voltar",
      tone: "danger",
    });
    if (!escolha) return;
    const credito = escolha === "alt";

    setBusy(true);
    try {
      // a API trabalha uma turma (unidade + horário) por chamada
      const porTurma = new Map();
      escolhidos.forEach((g) => {
        const k = `${g.unit}|${g.time}`;
        if (!porTurma.has(k)) porTurma.set(k, { unit: g.unit, time: g.time, dates: [] });
        porTurma.get(k).dates.push(...g.aulas.map((b) => b.date));
      });
      let removidas = 0, creditos = 0, semCredito = 0;
      for (const { unit, time, dates } of porTurma.values()) {
        const r = await run(api.batchUnbook(client.id, { unit, time, dates: [...new Set(dates)], credito }));
        removidas += r?.removidas ?? 0;
        creditos += r?.creditos ?? 0;
        semCredito += r?.semCredito ?? 0;
      }
      close();
      toast(
        `✅ ${removidas} aula(s) tirada(s) da agenda.` +
        (credito ? `\n${creditos} crédito(s) de reposição gerado(s)` + (semCredito ? ` · ${semCredito} sem crédito (fora das regras).` : ".") : "")
      );
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Tirar aulas em lote — ${client.name}`} footer={<>
      <button className="btn ghost" onClick={() => open(<ClientProfile client={client} />)}>← Voltar</button>
      <button className="btn danger" onClick={save} disabled={busy || !totalRemover}>🗑 Tirar {totalRemover} aula(s)</button>
    </>}>
      <div className="cfg-preview" style={{ marginTop: 0, marginBottom: "1rem" }}>
        Escolha as turmas de que <b>{client.name}</b> vai sair. Só aparecem as aulas <b>de hoje em diante</b> — o histórico não muda.
      </div>

      <div className="field">
        <label>Até quando</label>
        <div className="seg">
          {[["todas", "Todas as futuras"], ["4", "4 semanas"], ["8", "8 semanas"], ["12", "12 semanas"]].map(([v, label]) => (
            <button key={v} type="button" className={horizonte === v ? "on" : ""}
              onClick={() => { setHorizonte(v); setPicked(new Set()); }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Turmas em que ela está <span className="cfg-count">{grupos.length}</span></label>
        {grupos.length === 0 ? (
          <div className="empty" style={{ padding: "1.6rem 1rem" }}>
            <div className="ic">🧶</div>
            <p><b>{client.name}</b> não tem aula marcada {horizonte === "todas" ? "daqui para frente" : `nas próximas ${horizonte} semanas`}.</p>
          </div>
        ) : (
          <div className="bb-grid">
            {grupos.map((g) => {
              const on = picked.has(g.key);
              return (
                <button key={g.key} type="button" className={`bb-card rm ${on ? "on" : ""}`}
                  onClick={() => toggle(g.key)}>
                  <div className="bb-top">
                    <span className="bb-dia">{WEEKDAYS_SHORT[g.dow]}</span>
                    <span className="bb-hora">{hhmm(g.time)}</span>
                    {on && <span className="bb-check">✓</span>}
                  </div>
                  <div className="bb-prof">{g.unit}</div>
                  <div className="bb-foot">
                    <b>{g.aulas.length}</b> aula(s) · de {fmtDate(g.aulas[0].date)} a {fmtDate(g.aulas[g.aulas.length - 1].date)}
                    {(g.repo > 0 || g.extra > 0) && (
                      <div className="bb-skip">
                        {g.repo > 0 && <>· {g.repo} reposição </>}
                        {g.extra > 0 && <>· {g.extra} extra (paga)</>}
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
        <div className="cfg-warn" style={{ marginTop: ".2rem" }}>
          ⚠️ Vai sair de {escolhidos.map((g) => `${WEEKDAYS_SHORT[g.dow]} ${hhmm(g.time)}`).join(" · ")} — <b>{totalRemover} aula(s)</b>.
          {escolhidos.some((g) => g.extra > 0) && <> Aula extra já paga <b>não</b> devolve o valor.</>}
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
  // Plano: "avulso" | "1" … "4" (mensalista 1x a 4x por semana; 3x/4x só fixo)
  const [plano, setPlano] = useState(client?.plan === "mensalista" ? String(client.weeklyFreq || 1) : "avulso");
  // Tipo de mensalista: "fixo" (agenda montada pela Inêz) | "escala" (ela marca)
  const [tipoMens, setTipoMens] = useState(client?.mensalistaTipo === "escala" ? "escala" : "fixo");
  const [customMonthly, setCustomMonthly] = useState(client?.monthlyValue != null ? "individual" : "tabela");
  const [monthlyValue, setMonthlyValue] = useState(client?.monthlyValue != null ? String(client.monthlyValue) : "");
  const toggle = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const save = async () => {
    if (!name.trim()) return toast("Informe o nome.", "error");
    const limpoCpf = (cpf || "").replace(/\D/g, "");
    if (limpoCpf && !validarCPF(limpoCpf)) {
      return toast("CPF inválido. Verifique os números digitados antes de salvar.", "error");
    }

    const eraMensal = client?.plan === "mensalista";
    const querMensal = plano !== "avulso";
    const mudouFreq = eraMensal && querMensal && Number(plano) !== (client.weeklyFreq || 1);
    const precisaMatricular = querMensal && (!client || !eraMensal || mudouFreq);

    if (querMensal && tipoMens === "escala" && Number(plano) > FREQ_MAX_ESCALA)
      return toast(`O plano de ${plano}x por semana é só para mensalista fixo. Na escala, escolha 1x ou 2x.`, "error");
    const valorDoPlano = (f) => valorPlanoMeta(meta, f);
    const valorIndivNum = querMensal && customMonthly === "individual" && String(monthlyValue).trim() !== ""
      ? Number(String(monthlyValue).replace(",", "."))
      : null;

    const payload = {
      name: name.trim(), phone: phone.trim(), email: email.trim(), cpf: formatarCPF(cpf) || cpf.trim(), unit, tags, notes: notes.trim(),
      birthday, firstClass, status, mensalistaTipo: tipoMens,
      billingDay: billingDay === "" ? null : Number(billingDay),
      monthlyValue: valorIndivNum,
    };

    /* Próxima mensalidade JÁ com o que está sendo salvo: quem muda o dia de
       vencimento na mesma gravação em que inativa/reativa espera ler a data
       nova, não a antiga. */
    const proxCobranca = client && proximaCobranca(data, {
      ...client,
      plan: querMensal ? "mensalista" : "avulso",
      billingDay: payload.billingDay,
    });

    /* Inativar não é só mudar um rótulo: derruba a agenda e a cobrança dela.
       Por isso a confirmação diz em números o que vai acontecer. Todas as
       mensalidades pendentes são canceladas automaticamente. */
    if (client && status === "cancelado" && client.status !== "cancelado") {
      const t = todayISO();
      const aulas = (data.bookings || []).filter(
        (b) => b.clientName === client.name && b.date >= t && b.status !== "cancelada"
      ).length;
      const pendentes = (data.invoices || []).filter(
        (i) => i.clientId === client.id && i.status === "pendente"
      ).length;
      const ok = await confirmModal({
        title: "Inativar e encerrar inscrição",
        message: `${client.name} será movida para a aba "Ex-Alunos". Ao salvar:\n\n` +
          `• ${aulas} aula(s) futura(s) serão excluídas da grade sem deixar resíduos\n` +
          (pendentes
            ? `• ${pendentes} mensalidade(s) em aberto serão canceladas\n`
            : "• Nenhuma mensalidade pendente em aberto\n") +
          /* A pergunta seguinte é sempre "e ela continua sendo cobrada?".
             Ex-aluna não gera boleto nenhum, e a data diz para quando a
             cobrança volta se você reativar. */
          (proxCobranca
            ? `• Nenhuma mensalidade nova será gerada enquanto ela estiver inativa — ao reativar, a próxima seria a ${fraseProximaCobranca(proxCobranca)}\n`
            : "• Nenhuma cobrança nova será gerada enquanto ela estiver inativa\n") +
          "\nVocê poderá reverter com Ctrl+Z ou restaurar o cadastro e as aulas na aba Ex-Alunos.",
        confirmLabel: "Inativar e limpar grade", cancelLabel: "Voltar", tone: "danger",
      });
      if (!ok) return;
    }

    /* REATIVAR pela ficha (Inativa → Ativa). O contrário do bloco acima: a
       cobrança volta, e a confirmação diz em que dia. */
    if (client && status !== "cancelado" && client.status === "cancelado") {
      const ok = await confirmModal({
        title: "Reativar inscrição",
        message: `${client.name} volta para a lista de alunas ativas.\n\n` +
          (proxCobranca
            ? `• A cobrança volta: ${fraseProximaCobranca(proxCobranca)}\n`
            : "• Ela não é mensalista, então nenhuma mensalidade recorrente será gerada\n") +
          "\nAs aulas guardadas no encerramento são restauradas pelo botão \"Restaurar\" da aba Ex-Alunos.",
        confirmLabel: "Reativar", cancelLabel: "Voltar", tone: "ok",
      });
      if (!ok) return;
    }

    /* TROCA de plano de quem já é mensalista. Vale a partir do mês que vem, nas
       duas pontas — dinheiro e aulas. O aviso diz exatamente isso em números,
       porque é a pergunta que a Inêz faria depois de salvar: "a partir de
       quando ela paga o valor novo?". */
    if (mudouFreq) {
      const de = client.weeklyFreq || 1;
      const para = Number(plano);
      const vDe = valorDoPlano(de);
      const vPara = valorDoPlano(para);
      const desde = compLabel(addComp(compAtual(), 1));
      const individual = valorIndivNum != null || client.monthlyValue != null;
      const valorIndivEfetivo = valorIndivNum != null ? valorIndivNum : client.monthlyValue;
      // Valor já combinado para este mês (troca anterior, desconto) é o que fica
      const combinadoMes = precoDaComp(data.precos, client.id, compAtual());
      const valorMesAtual = combinadoMes ? combinadoMes.amountCents / 100 : vDe;

      const linhas = [
        `${client.name} sai do plano de ${de}x por semana e entra no de ${para}x.`,
        "",
        `A partir de ${desde}:`,
        individual
          ? `• Mensalidade: continua ${money(valorIndivEfetivo)} — ela tem valor individual, que manda sobre a tabela do plano`
          : `• Mensalidade: ${money(vDe)} → ${money(vPara)} (${vPara > vDe ? "+" : "−"}${money(Math.abs(vPara - vDe))})`,
        `• Aulas por semana: ${de} → ${para}`,
        "",
        /* A troca não mexe na agenda: a grade de 12 meses continua com os
           horários que já tinha. Sem este aviso, "Aulas por semana: 4 → 2"
           parece prometer que 2 horários somem sozinhos — e ela seguiria com 4. */
        tipoMens === "escala"
          ? "A agenda não muda: ela continua marcando as próprias aulas pelo portal."
          : para > de
            ? `A agenda NÃO ganha horário sozinha: marque na agenda o${para - de > 1 ? "s" : ""} ${para - de} horário${para - de > 1 ? "s" : ""} novo${para - de > 1 ? "s" : ""} da semana dela.`
            : `A agenda NÃO perde horário sozinha: exclua da agenda o${de - para > 1 ? "s" : ""} ${de - para} horário${de - para > 1 ? "s" : ""} da semana que ela deixa de fazer.`,
        "",
        `${compLabel(compAtual())} não muda: a mensalidade deste mês fica em ` +
          `${individual ? money(valorIndivEfetivo) : money(valorMesAtual)}.`,
      ];
      const ok = await confirmModal({
        title: "Trocar o plano de mensalista",
        message: linhas.join("\n"),
        confirmLabel: `Trocar para ${para}x por semana`,
        cancelLabel: "Voltar",
      });
      if (!ok) return;
    } else if (precisaMatricular) {
      const valor = valorIndivNum != null ? valorIndivNum : valorDoPlano(plano);
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
      const r = id ? await run(api.enroll(id, {
        weeklyFreq: Number(plano),
        mensalistaTipo: tipoMens,
        billingDay: billingDay === "" ? undefined : Number(billingDay),
        monthlyValue: valorIndivNum,
      })) : null;
      /* O backend devolve `troca` quando foi mudança de plano (e não matrícula
         nova). Repetimos o resultado no aviso: a Inêz acabou de confirmar uma
         tela de números e precisa ver que foi isso mesmo que gravou. */
      const t = r?.troca;
      if (t) {
        toast(
          `📅 Plano trocado: ${t.freqDe}x → ${t.freqPara}x por semana.\n` +
          (t.temValorIndividual
            ? `A mensalidade não muda (valor individual de ${money(t.valorIndividual)}).`
            : `${money(t.valorDe)} → ${money(t.valorPara)} a partir de ${compLabel(t.valeAPartirDe)}.`) +
          (t.fixouMesCorrente != null
            ? ` ${compLabel(t.mesCorrente)} fica em ${money(t.fixouMesCorrente)}.`
            : ""),
          "success"
        );
      } else {
        toast(`📅 Mensalista ${tipoMens} ${plano}x/semana.` +
          (r?.primeiroVencimento ? ` 1ª mensalidade vence ${fmtDate(r.primeiroVencimento)}.` : ""));
      }
    } else if (saved?.encerrado) {
      const e = saved.encerrado;
      toast(`Aluna inativada e movida para Ex-Alunos. ${e.aulas} aula(s) excluídas da grade. ↩️ (Ctrl+Z para desfazer)` +
        (e.extrasPagas ? ` Atenção: ela tem ${e.extrasPagas} aula(s) extra(s) já paga(s).` : ""), "info");
    } else {
      toast("Cadastro salvo. 💚");
    }
    onDone && onDone();
  };

  return { meta, client, name, setName, phone, setPhone, email, setEmail, cpf, setCpf,
    unit, setUnit, tags, toggle, notes, setNotes, birthday, setBirthday,
    firstClass, setFirstClass, status, setStatus, plano, setPlano, tipoMens, setTipoMens,
    customMonthly, setCustomMonthly, monthlyValue, setMonthlyValue,
    billingDay, setBillingDay, save };
}

function ClientFormFields({ f }) {
  const { meta, client } = f;
  const cpfLimpo = (f.cpf || "").replace(/\D/g, "");
  const cpfValido = cpfLimpo.length === 11 && validarCPF(cpfLimpo);
  const cpfInvalido = cpfLimpo.length === 11 && !validarCPF(cpfLimpo);
  const cpfMuitoLongo = cpfLimpo.length > 11;
  return (
    <>
      <div className="row2">
        <div className="field"><label>Nome</label><input value={f.name} onChange={(e) => f.setName(e.target.value)} /></div>
        <div className="field"><label>Telefone</label><input value={f.phone} onChange={(e) => f.setPhone(e.target.value)} placeholder="31988880000" /></div>
      </div>
      <div className="row2">
        <div className="field">
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>CPF <span style={{ color: "var(--muted)", fontWeight: 400 }}>(login do portal)</span></span>
            {cpfValido && <span style={{ color: "var(--ok)", fontSize: ".8rem", fontWeight: 600 }}>✓ CPF válido</span>}
            {cpfInvalido && <span style={{ color: "var(--danger)", fontSize: ".8rem", fontWeight: 600 }}>⚠ CPF inválido</span>}
            {cpfMuitoLongo && <span style={{ color: "var(--danger)", fontSize: ".8rem", fontWeight: 600 }}>⚠ mais de 11 dígitos</span>}
          </label>
          <input
            value={f.cpf}
            onChange={(e) => f.setCpf(formatarCPF(e.target.value))}
            placeholder="000.000.000-00"
            inputMode="numeric"
            style={cpfInvalido || cpfMuitoLongo ? { borderColor: "var(--danger)", background: "rgba(220,53,69,.06)" } : {}}
          />
        </div>
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
              ...planoOpcoes(meta, f.tipoMens, { value: String, label: (n) => `Mensalista — ${n}x por semana` }),
            ]}
          />
          {f.plano !== "avulso" && client?.plan !== "mensalista" && (
            <div className="help" style={{ marginTop: ".4rem" }}>Ao salvar, a matrícula é feita e a 1ª mensalidade é gerada automaticamente.</div>
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
            Ao salvar como <b>Inativa</b>, as aulas futuras dela e as mensalidades
            em aberto são canceladas. Ela deixa de ganhar e de usar créditos de reposição.
          </div>
        </div>
      </div>

      {f.plano !== "avulso" && (
        <div style={{
          margin: ".5rem 0 1rem 0",
          padding: ".9rem 1rem",
          borderRadius: 8,
          border: "1.5px solid var(--primary, #1c5e33)",
          background: "rgba(28, 94, 51, 0.04)"
        }}>
          <div style={{ fontWeight: 600, color: "var(--primary, #1c5e33)", marginBottom: ".6rem", display: "flex", alignItems: "center", gap: ".4rem" }}>
            <span>⚙️</span> Regras e Mensalidade do Plano
          </div>

          <div className="row2" style={{ marginBottom: ".6rem" }}>
            <div className="field" style={{ margin: 0 }}>
              <label style={{ display: "block", marginBottom: ".3rem" }}>Regra / Tipo de mensalista</label>
              <Select value={f.tipoMens} onChange={f.setTipoMens} options={tipoMensalistaOpcoes(f.plano)} />
              <div className="help" style={{ marginTop: ".3rem" }}>
                {f.tipoMens === "fixo" ? "Dia e horário fixos toda semana." : "Aluna agenda aulas pelo portal conforme as vagas."}
              </div>
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label style={{ display: "block", marginBottom: ".3rem" }}>Dia de vencimento (Boleto / PIX)</label>
              <Select
                value={f.billingDay}
                onChange={f.setBillingDay}
                grid
                defaultOption={{ label: `Dia ${meta.vencimentoDia || 10} — padrão`, icon: "⚙️" }}
                options={Array.from({ length: 28 }, (_, i) => ({
                  value: i + 1,
                  label: String(i + 1),
                  triggerLabel: `Dia ${i + 1} de cada mês`,
                }))}
              />
              <div className="help" style={{ marginTop: ".3rem" }}>Dia do mês em que vence a mensalidade.</div>
            </div>
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label style={{ display: "block", marginBottom: ".3rem" }}>Valor da Mensalidade</label>
            <div style={{ display: "flex", gap: ".5rem", marginBottom: ".5rem" }}>
              <button
                type="button"
                onClick={() => f.setCustomMonthly("tabela")}
                style={{
                  flex: 1,
                  padding: ".45rem .8rem",
                  borderRadius: 6,
                  cursor: "pointer",
                  border: `1.5px solid ${f.customMonthly === "tabela" ? "var(--primary, #1c5e33)" : "var(--line, #e2e8f0)"}`,
                  background: f.customMonthly === "tabela" ? "rgba(28,94,51,0.1)" : "#fff",
                  color: f.customMonthly === "tabela" ? "var(--primary, #1c5e33)" : "var(--text, #333)",
                  fontWeight: f.customMonthly === "tabela" ? 600 : 400,
                  fontSize: ".85rem",
                }}
              >
                📋 Tabela ({money(valorPlanoMeta(meta, f.plano))}/mês)
              </button>
              <button
                type="button"
                onClick={() => f.setCustomMonthly("individual")}
                style={{
                  flex: 1,
                  padding: ".45rem .8rem",
                  borderRadius: 6,
                  cursor: "pointer",
                  border: `1.5px solid ${f.customMonthly === "individual" ? "var(--primary, #1c5e33)" : "var(--line, #e2e8f0)"}`,
                  background: f.customMonthly === "individual" ? "rgba(28,94,51,0.1)" : "#fff",
                  color: f.customMonthly === "individual" ? "var(--primary, #1c5e33)" : "var(--text, #333)",
                  fontWeight: f.customMonthly === "individual" ? 600 : 400,
                  fontSize: ".85rem",
                }}
              >
                ✏️ Valor Individual (personalizado)
              </button>
            </div>
            {f.customMonthly === "individual" ? (
              <div style={{ marginTop: ".4rem" }}>
                <label style={{ fontSize: ".85rem", color: "var(--muted)", display: "block", marginBottom: ".2rem" }}>
                  Valor personalizado por mês (R$):
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={String(valorPlanoMeta(meta, f.plano))}
                  value={f.monthlyValue}
                  onChange={(e) => f.setMonthlyValue(e.target.value)}
                  style={{ width: "100%", fontWeight: 600 }}
                />
                <div className="help" style={{ marginTop: ".3rem" }}>
                  Este valor específico terá prioridade sobre a tabela geral para esta aluna.
                </div>
              </div>
            ) : (
              <div className="help">
                A aluna pagará o valor vigente da tabela geral do curso ({money(valorPlanoMeta(meta, f.plano))}/mês).
              </div>
            )}
          </div>
        </div>
      )}
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

/* ================= Aulas marcadas num dia que virou feriado =================
   Cadastrar o feriado não cancela nada: quem decide é a Inêz, olhando quem
   seria atingida. O cancelamento em massa NÃO gera crédito de reposição
   (Vitor, 02/09/2026): a mensalidade já é calculada sobre os dias em que a
   escola abre, e creditar o feriado pagaria a aluna duas vezes pelo mesmo dia.
   A outra saída é fechar aqui e remarcar turma por turma. */
export function FeriadoAulas({ date, unit, nome, aulas = [] }) {
  const { reload } = useStore();
  const { close } = useModal();
  const [busy, setBusy] = useState(false);

  const cancelarTudo = async () => {
    if (busy) return;
    const ok = await confirmModal({
      title: "Cancelar as aulas do feriado",
      message: `${aulas.length} aula(s) de ${fmtDateLong(date)} serão canceladas.\n\n` +
        "Feriado não gera crédito de reposição: a mensalidade já considera os dias em que a escola abre, " +
        "então não há aula perdida para repor.",
      confirmLabel: "Cancelar as aulas",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.feriados.cancelarAulas(date, unit);
      await reload();
      toast(`${r.canceladas} aula(s) cancelada(s). Feriado não gera crédito de reposição.`, "ok");
      close();
    } catch (e) {
      toast(e.message || "Não foi possível cancelar.", "error");
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title="Aulas marcadas neste feriado"
      subheader={<div className="day-sub">🚫 <b>{nome}</b> · {fmtDateLong(date)}{unit ? <> · {unit}</> : null}</div>}
      footer={<>
        <button className="btn ghost" onClick={close}>Deixar como está</button>
        <button className="btn danger" onClick={cancelarTudo} disabled={busy}>
          {busy ? "Cancelando…" : `Cancelar ${aulas.length} aula(s)`}
        </button>
      </>}
    >
      <p className="help" style={{ marginBottom: ".7rem" }}>
        O dia virou feriado e a escola não abre, mas estas aulas já estavam marcadas.
        Cancelar aqui limpa a agenda do dia. <b>Nenhuma delas gera crédito de reposição</b> —
        a mensalidade já considera os dias em que a escola abre.
      </p>
      <div className="tv-lista">
        {aulas.map((b) => (
          <div key={b.id} className="tv-al">
            <span className="tv-nm">{hhmm(b.time)} · {b.clientName}</span>
            <span className="tv-sp">
              <span className="badge b-muted">📍 {b.unit}</span>
              <span className="badge b-muted">sem crédito</span>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
