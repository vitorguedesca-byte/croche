import { useEffect, useState } from "react";
import { toast, confirmModal } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { useModal } from "./ui.jsx";
import { ReajusteGeral, FeriadoAulas } from "./modals.jsx";
import { api } from "./api.js";
import { WEEKDAYS_PT, DEFAULT_HORARIO, parseHorario, horarioToText, serializeHorario, money, todayISO, fmtDateLong } from "./helpers.js";

/* ===================== FERIADOS: A ESCOLA NÃO ABRE =====================
   Os nacionais o sistema já sabe — os fixos e os móveis (Carnaval, Sexta-feira
   Santa e Corpus Christi andam com a Páscoa). Aqui se cadastra o que só a
   escola sabe: o feriado municipal, um recesso, uma emenda — e o contrário
   disso, o feriado nacional em que a escola resolve abrir.

   Nada é cancelado ao cadastrar. Se o dia já tem aula marcada, a tela abre a
   lista e pergunta — é a Inêz quem decide. */
function Feriados() {
  const { reload } = useStore();
  const { open } = useModal();
  const [cal, setCal] = useState({});
  const [manuais, setManuais] = useState([]);
  const [date, setDate] = useState("");
  const [nome, setNome] = useState("");
  const [abre, setAbre] = useState(false); // "neste feriado nacional a escola ABRE"
  const [busy, setBusy] = useState(false);
  const [ano, setAno] = useState(() => Number(todayISO().slice(0, 4)));

  const carregar = async () => {
    try {
      const r = await api.feriados.list();
      setCal(r.feriados || {});
      setManuais(r.manuais || []);
    } catch (e) { toast(e.message || "Não foi possível ler os feriados.", "error"); }
  };
  useEffect(() => { carregar(); }, []);

  const manualDe = (d) => manuais.find((f) => f.date === d) || null;
  const doAno = Object.entries(cal)
    .filter(([d]) => d.startsWith(`${ano}-`))
    .sort(([a], [b]) => a.localeCompare(b));
  // As remoções não aparecem no calendário (foram tiradas dele): entram à parte.
  const aberturas = manuais.filter((f) => f.remove && f.date.startsWith(`${ano}-`));

  const salvar = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast("Escolha a data do feriado.", "error");
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.feriados.save({ date, nome, remove: abre });
      setCal(r.feriados || {});
      await carregar();
      await reload(); // a agenda passa a mostrar o dia marcado na hora
      setDate(""); setNome(""); setAbre(false);
      if (r.aulas?.length) open(<FeriadoAulas date={date} nome={nome || "Feriado"} aulas={r.aulas} />);
      else toast(abre ? "Dia liberado — a escola abre." : "Feriado cadastrado.", "ok");
    } catch (e) { toast(e.message || "Não foi possível salvar.", "error"); }
    finally { setBusy(false); }
  };

  const remover = async (f) => {
    const ok = await confirmModal({
      title: "Tirar da lista",
      message: `${fmtDateLong(f.date)} — ${f.nome}\n\nO dia volta a valer o que o calendário nacional disser.`,
      confirmLabel: "Tirar",
    });
    if (!ok) return;
    try {
      await api.feriados.remove(f.date);
      await carregar();
      await reload();
    } catch (e) { toast(e.message || "Não foi possível remover.", "error"); }
  };

  // Reabrir a lista de aulas de um feriado que já está cadastrado
  const verAulas = async (d, n) => {
    try {
      const r = await api.feriados.aulas(d);
      if (!r.aulas?.length) return toast("Nenhuma aula marcada neste dia. 💚", "ok");
      open(<FeriadoAulas date={d} nome={n} aulas={r.aulas} />);
    } catch (e) { toast(e.message || "Não foi possível ler as aulas.", "error"); }
  };

  return (
    <div className="panel cfg-sec">
      <div className="cfg-h">
        <span className="cfg-ic">🚫</span>
        <div>
          <h2>Feriados</h2>
          <p>Em feriado não há aula: o dia é bloqueado na agenda, no portal e no WhatsApp.</p>
        </div>
      </div>

      <div className="row2">
        <div className="field">
          <label>Data</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder={abre ? "ex.: emenda — abrimos normalmente" : "ex.: Aniversário de Ipatinga"} />
        </div>
      </div>
      <label className="hf-toggle" style={{ marginTop: ".2rem" }}>
        <input type="checkbox" checked={abre} onChange={(e) => setAbre(e.target.checked)} />
        <span className="hf-day">Ao contrário: neste feriado nacional a escola <b>abre</b></span>
      </label>
      <div style={{ marginTop: ".7rem" }}>
        <button className="btn sec" type="button" onClick={salvar} disabled={busy}>
          {busy ? "Salvando…" : abre ? "Liberar este dia" : "Marcar como feriado"}
        </button>
      </div>
      <div className="help" style={{ marginTop: ".5rem" }}>
        Feriados nacionais já vêm prontos — inclusive Carnaval, Sexta-feira Santa e Corpus Christi,
        que mudam de data todo ano. Cadastre aqui só o que é da região ou da escola.
      </div>

      <div style={{ marginTop: "1.1rem", borderTop: "1px solid var(--line)", paddingTop: ".9rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          Calendário de
          <input type="number" min="2020" max="2100" value={ano} style={{ width: 100 }}
            onChange={(e) => setAno(Number(e.target.value) || ano)} />
          <span className="cfg-count">{doAno.length} dias sem aula</span>
        </label>
        <div className="fer-lista">
          {doAno.map(([d, n]) => {
            const man = manualDe(d);
            return (
              <div key={d} className="fer-item">
                <span className="fer-data">{d.slice(8, 10)}/{d.slice(5, 7)}</span>
                <span className="fer-nome">{n}</span>
                <span className="fer-fonte">{man ? "cadastrado" : "nacional"}</span>
                <button className="btn ghost sm" type="button" onClick={() => verAulas(d, n)}>Ver aulas</button>
                {man && <button className="btn ghost sm" type="button" onClick={() => remover(man)}>Tirar</button>}
              </div>
            );
          })}
          {aberturas.map((f) => (
            <div key={f.date} className="fer-item abre">
              <span className="fer-data">{f.date.slice(8, 10)}/{f.date.slice(5, 7)}</span>
              <span className="fer-nome">✅ {f.nome} — a escola abre</span>
              <span className="fer-fonte">cadastrado</span>
              <button className="btn ghost sm" type="button" onClick={() => remover(f)}>Tirar</button>
            </div>
          ))}
          {!doAno.length && !aberturas.length && <div className="help">Nenhum feriado neste ano.</div>}
        </div>
      </div>
    </div>
  );
}

/* Interruptor liga/desliga com o efeito escrito por extenso nos dois estados —
   estas travas mudam o que a aluna vê no portal, então vale dizer o que
   acontece antes de virar a chave, não depois. */
function Chave({ on, onToggle, titulo, ligado, desligado }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "flex-start", gap: ".7rem", width: "100%",
        textAlign: "left", padding: ".7rem .9rem", marginBottom: ".5rem",
        borderRadius: 10, cursor: "pointer", transition: "all .18s",
        border: `1.5px solid ${on ? "var(--green-deep)" : "var(--line)"}`,
        background: on ? "rgba(28,94,51,.07)" : "var(--cream)",
      }}
    >
      <span style={{
        flex: "0 0 42px", height: 24, borderRadius: 999, position: "relative", marginTop: 2,
        background: on ? "var(--green-deep)" : "var(--line)", transition: "background .18s",
      }}>
        <span style={{
          position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18,
          borderRadius: "50%", background: "#fff", transition: "left .18s",
        }} />
      </span>
      <span>
        <b style={{ color: on ? "var(--green-deep)" : "var(--muted)" }}>{titulo}</b>
        <div className="help" style={{ marginTop: ".2rem" }}>{on ? ligado : desligado}</div>
      </span>
    </button>
  );
}

export default function Config() {
  const { data, run } = useStore();
  const { open } = useModal();
  const m = data.meta;
  const [cap, setCap] = useState(m.capacidadePadrao);

  // Per-unit hours: { [unitName]: 7-day array }
  // Initialized from m.horarioUnidades (new) falling back to global m.horarioFunc
  const [unitHours, setUnitHours] = useState(() => {
    const saved = m.horarioUnidades || {};
    const globalDays = parseHorario(m.horarioFunc).days;
    const result = {};
    for (const unit of m.units || []) {
      result[unit] = saved[unit]
        ? parseHorario(saved[unit]).days
        : globalDays.map((d) => ({ ...d }));
    }
    return result;
  });

  const getUnitDays = (unit) =>
    unitHours[unit] || DEFAULT_HORARIO.map((d) => ({ ...d }));

  const setUnitDay = (unit, i, patch) =>
    setUnitHours((prev) => ({
      ...prev,
      [unit]: getUnitDays(unit).map((d, j) => (j === i ? { ...d, ...patch } : d)),
    }));

  const [units, setUnits] = useState((m.units || []).join("\n"));
  const [profs, setProfs] = useState((m.profs || []).join("\n"));
  const [pixKey, setPixKey] = useState(m.pixKey || "");
  const [pixName, setPixName] = useState(m.pixName || "");
  // Cartão "Cobrança das mensalidades" foi removido da tela; os valores continuam
  // sendo preservados no salvamento para não zerar o vencimento usado nos boletos.
  const [mensalidadeValor] = useState(m.mensalidadeValor || "");
  const [vencimentoDia] = useState(m.vencimentoDia || 10);
  const [plano1x, setPlano1x] = useState(m.valorPlano1x ?? 120);
  const [plano2x, setPlano2x] = useState(m.valorPlano2x ?? 200);
  const [avulsa, setAvulsa] = useState(m.valorAvulsa ?? 40);
  /* Taxa de matrícula: somada UMA vez à 1ª mensalidade da aluna nova (site e
     WhatsApp). Zerar aqui desliga a taxa — o 1º pagamento volta a ser só a
     mensalidade. Ver `valorPrimeiroPagamento` no server.js. */
  const [taxaMatricula, setTaxaMatricula] = useState(m.taxaMatricula ?? 20);
  const [duracao, setDuracao] = useState(m.duracaoAulaMin ?? 120);
  // Travas de cobrança — nascem desligadas, a Inêz vira a chave quando quiser
  const [travaAtraso, setTravaAtraso] = useState(!!m.travaAtraso);
  const [pixExpira, setPixExpira] = useState(!!m.pixExpira);
  const [cobrarEncargos, setCobrarEncargos] = useState(!!m.cobrarEncargos);
  const [geracaoAuto, setGeracaoAuto] = useState(!!m.geracaoAuto);
  const [waAvisosAuto, setWaAvisosAuto] = useState(!!m.waAvisosAuto);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const unitsList = units.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!unitsList.length) return toast("Cadastre ao menos uma unidade.", "error");
    const profsList = profs.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!profsList.length) return toast("Cadastre ao menos um profissional.", "error");

    // Serialize per-unit schedules — only units currently in the list
    const horarioUnidades = {};
    for (const unit of unitsList) {
      horarioUnidades[unit] = JSON.parse(serializeHorario(getUnitDays(unit)));
    }

    const payload = {
      capacidadePadrao: Math.max(1, parseInt(cap, 10) || m.capacidadePadrao),
      horarioUnidades,
      pixKey: pixKey.trim(),
      pixName: pixName.trim(),
      mensalidadeValor: Number(mensalidadeValor) || 0,
      vencimentoDia: Math.min(28, Math.max(1, parseInt(vencimentoDia, 10) || 10)),
      valorPlano1x: Number(plano1x) || 0,
      valorPlano2x: Number(plano2x) || 0,
      valorAvulsa: Number(avulsa) || 0,
      // `|| 0` é o certo aqui: zero DESLIGA a taxa, e é uma escolha válida
      taxaMatricula: Math.max(0, Number(taxaMatricula) || 0),
      duracaoAulaMin: Math.min(600, Math.max(15, parseInt(duracao, 10) || 120)),
      travaAtraso,
      pixExpira,
      cobrarEncargos,
      geracaoAuto,
      waAvisosAuto,
      units: unitsList,
      profs: profsList,
    };
    await run(api.updateSettings(payload));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const unitsList = units.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const profsList = profs.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

  return (
    <div className="config-wrap">
      <div className="cfg-cols">
      {/* PAGAMENTO / PIX */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">💠</span><div><h2>Pagamento (Pix)</h2><p>A chave usada pelas alunas para pagar a mensalidade.</p></div></div>
        <div className="row2">
          <div className="field"><label>Chave Pix</label><input value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="ex.: 31988880000, e-mail, CPF ou chave aleatória" /></div>
          <div className="field"><label>Nome do recebedor</label><input value={pixName} onChange={(e) => setPixName(e.target.value)} placeholder="Fios que Curam" /></div>
        </div>
        {pixKey.trim()
          ? <div className="cfg-preview">🔑 Alunas verão: <b>{pixName.trim() || "—"}</b> · chave <b>{pixKey.trim()}</b></div>
          : <div className="cfg-warn">⚠️ Sem chave Pix cadastrada, as alunas não conseguem pagar a mensalidade.</div>}

        {/* As travas de atraso, desligadas até você confirmar que quer cobrar assim */}
        <div style={{ marginTop: "1.1rem", borderTop: "1px solid var(--line)", paddingTop: ".9rem" }}>
          <label style={{ display: "block", marginBottom: ".6rem" }}>Cobrança em atraso</label>
          <Chave
            on={travaAtraso}
            onToggle={() => setTravaAtraso(!travaAtraso)}
            titulo="Mensalidade vencida bloqueia a reposição"
            ligado="A aluna com mensalidade em atraso não ganha nem usa crédito de reposição."
            desligado="A aluna repõe normalmente, mesmo com mensalidade em atraso."
          />
          <Chave
            on={pixExpira}
            onToggle={() => setPixExpira(!pixExpira)}
            titulo="Pix da mensalidade expira no vencimento"
            ligado="Passado o vencimento, o QR morre e a aluna precisa pedir um novo pelo portal."
            desligado="O QR continua pagável depois do vencimento — ninguém fica sem como pagar."
          />
          <Chave
            on={cobrarEncargos}
            onToggle={() => setCobrarEncargos(!cobrarEncargos)}
            titulo="Cobrar multa e juros por atraso"
            ligado="A mensalidade vencida passa a custar mais, e o Pix é reemitido com o valor atualizado."
            desligado="A mensalidade vencida continua custando o valor original, sem acréscimo."
          />

          {/* Multa e juros são FIXOS no código (backend/src/regrasAula.js) — não
              viram campo aqui de propósito. Mostramos só para você conferir. */}
          <div className="cfg-preview" style={{ marginTop: ".8rem" }}>
            ⚖️ {cobrarEncargos ? "Cobrando hoje:" : "Se você ligar a chave acima:"}{" "}
            <b>{money(m.multaAtraso ?? 5)} de multa</b> (uma vez, a partir do 1º dia)
            {" "}e <b>{(m.jurosDia ?? 0.001).toString().replace(".", ",")}% de juros ao dia</b> sobre o valor original.
            O Pix é reemitido com o valor atualizado quando a aluna abre o portal.
            <div className="help" style={{ marginTop: ".35rem" }}>
              Esses dois valores são fixos no sistema — para alterar, fale com quem cuida do código.
              {!cobrarEncargos && " Com a chave desligada, ninguém paga acréscimo nenhum."}
            </div>
          </div>
        </div>
      </div>

      {/* TABELA DE PREÇOS */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">🏷️</span><div><h2>Tabela de preços</h2><p>Valores do curso. Alimentam os planos, a matrícula e as aulas extras.</p></div></div>
        <div className="row2">
          <div className="field"><label>Plano 1x por semana (R$/mês)</label><input type="number" min="0" step="0.01" value={plano1x} onChange={(e) => setPlano1x(e.target.value)} /></div>
          <div className="field"><label>Plano 2x por semana (R$/mês)</label><input type="number" min="0" step="0.01" value={plano2x} onChange={(e) => setPlano2x(e.target.value)} /></div>
        </div>
        <div className="row2">
          <div className="field"><label>Aula extra avulsa (R$)</label><input type="number" min="0" step="0.01" value={avulsa} onChange={(e) => setAvulsa(e.target.value)} /></div>
          <div className="field">
            <label>Taxa de matrícula (R$)</label>
            <input type="number" min="0" step="0.01" value={taxaMatricula} onChange={(e) => setTaxaMatricula(e.target.value)} />
            <div className="help" style={{ marginTop: ".4rem" }}>
              Cobrada <b>uma vez só</b>, somada à 1ª mensalidade da aluna nova — no site e no WhatsApp.
              Deixe <b>0</b> para não cobrar taxa nenhuma.
            </div>
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Duração da aula (minutos)</label>
            <input type="number" min="15" max="600" step="15" value={duracao} onChange={(e) => setDuracao(e.target.value)} />
            <div className="help" style={{ marginTop: ".4rem" }}>Usada para mostrar o fim da aula e impedir turmas sobrepostas na mesma unidade.</div>
          </div>
          <div className="field" />
        </div>
        <div className="help" style={{ marginTop: ".2rem" }}>
          Na tela da aula experimental (e na conversa do WhatsApp) a aluna escolhe o plano e paga a{" "}
          <b>1ª mensalidade</b>{Number(taxaMatricula) > 0 ? <> mais a <b>taxa de matrícula</b></> : null} — é esse pagamento
          que a matricula, e a próxima cobrança cai no mês seguinte, no mesmo dia
          {Number(taxaMatricula) > 0 ? <>, já <b>sem a taxa</b></> : null}.
          {Number(taxaMatricula) > 0
            ? <> Se ela desistir depois da 1ª aula, a <b>mensalidade volta</b> e a <b>taxa não</b>.</>
            : null}
        </div>
        <div className="cfg-preview">
          🏷️ 1x/semana <b>R$ {plano1x}</b> (4 aulas) · 2x/semana <b>R$ {plano2x}</b> (8 aulas) · extra <b>R$ {avulsa}</b> · aula de <b>{Math.floor(duracao / 60)}h{duracao % 60 ? String(duracao % 60).padStart(2, "0") : ""}</b>
        </div>
        {Number(taxaMatricula) > 0 && (
          <div className="cfg-preview">
            🎟️ 1º pagamento da aluna nova: 1x/semana <b>R$ {(Number(plano1x) || 0) + Number(taxaMatricula)}</b> ·
            2x/semana <b>R$ {(Number(plano2x) || 0) + Number(taxaMatricula)}</b> (mensalidade + taxa de R$ {taxaMatricula})
          </div>
        )}

        {/* Quem cria as mensalidades. Desligada, a mensalidade só existe depois
            que você manda criar — que é o que dá tempo de combinar o valor do
            mês antes de a cobrança nascer. */}
        <div style={{ marginTop: "1.1rem", borderTop: "1px solid var(--line)", paddingTop: ".9rem" }}>
          <label style={{ display: "block", marginBottom: ".6rem" }}>Emissão das mensalidades</label>
          <Chave
            on={geracaoAuto}
            onToggle={() => setGeracaoAuto(!geracaoAuto)}
            titulo="Gerar as mensalidades do mês automaticamente"
            ligado="O sistema cria sozinho a mensalidade de cada mensalista ativa, 5 dias antes do vencimento dela."
            desligado="Nenhuma mensalidade nasce sozinha — você gera pelo botão na aba Mensalidades, quando quiser."
          />
          {!geracaoAuto && (
            <div className="cfg-preview" style={{ marginTop: ".8rem" }}>
              🧾 Com a chave desligada, use <b>🧾 Gerar boleto</b> na aba Mensalidades (por aluna) ou o botão de gerar o mês inteiro.
              <div className="help" style={{ marginTop: ".35rem" }}>
                É o modo indicado para combinar desconto ou promoção antes de a cobrança existir — mensalidade já emitida
                pode ser alterada, mas a aluna talvez já tenha visto o valor antigo.
              </div>
            </div>
          )}
        </div>

        {/* Mensagens que a ESCOLA inicia. Nasceu desligada porque o primeiro
            disparo alcançaria alunas que nunca receberam mensagem automática
            daqui — e número que recebe mensagem não pedida bloqueia. */}
        <div style={{ marginTop: "1.1rem", borderTop: "1px solid var(--line)", paddingTop: ".9rem" }}>
          <label style={{ display: "block", marginBottom: ".6rem" }}>Mensagens automáticas no WhatsApp</label>
          <Chave
            on={waAvisosAuto}
            onToggle={() => setWaAvisosAuto(!waAvisosAuto)}
            titulo="A escola manda mensagem sozinha"
            ligado="Saem o lembrete da véspera da aula, o aviso de mensalidade a vencer, a cobrança do atraso e a retomada de conversa parada."
            desligado="Nenhuma mensagem sai por iniciativa da escola. O bot continua respondendo normalmente quem falar com ele."
          />
          <div className="cfg-preview" style={{ marginTop: ".8rem" }}>
            💬 {waAvisosAuto ? "Enviando hoje:" : "Se você ligar a chave acima:"}{" "}
            <b>lembrete da véspera</b> (uma vez por aula, com botão de avisar que não vai),
            {" "}<b>mensalidade a vencer</b> (2 dias antes), <b>cobrança</b> (1 dia depois do vencimento)
            {" "}e <b>retomada</b> de conversa parada (uma vez, 30 min depois).
            <div className="help" style={{ marginTop: ".35rem" }}>
              Nada sai fora do horário de 8h às 20h, e cada mensagem sai uma vez só por aula ou mensalidade.
              Ligar vale já na hora seguinte. A reserva segurada pelo bot não passa por esta chave: ela precisa
              expirar sozinha, senão a vaga fica presa.
            </div>
          </div>
        </div>

        {/* Mudar os campos acima muda a TABELA — vale para quem entrar depois e
            para quem paga o preço de tabela. O reajuste é outra coisa: aplica um
            percentual (ou valor fixo) de uma vez, e deixa você escolher se as
            alunas com valor individual entram junto. */}
        <div style={{ marginTop: "1rem", borderTop: "1px solid var(--line)", paddingTop: ".9rem", display: "flex", alignItems: "center", gap: ".8rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <b style={{ fontSize: ".95rem" }}>Reajuste geral</b>
            <div className="help" style={{ marginTop: ".2rem" }}>
              Aplica um percentual (ou valor fixo) na tabela e, se você quiser, nas mensalistas
              com valor individual. Não mexe em mensalidade já emitida.
            </div>
          </div>
          <button className="btn sec" type="button" onClick={() => open(<ReajusteGeral />)}>📈 Aplicar reajuste</button>
        </div>
      </div>

      {/* PADRÕES DE RESERVA */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">🧶</span><div><h2>Padrões de reserva</h2><p>Aplicados automaticamente ao criar horários e marcações.</p></div></div>
        {/* O "valor padrão da reserva" saiu daqui em 30/08/2026: a aula não tem
            preço próprio — quem se paga é a mensalidade do mês. Os únicos valores
            por aula que sobraram (1ª mensalidade e aula extra) estão na tabela
            de preços acima. */}
        <div className="field"><label>Capacidade padrão das turmas (vagas)</label><input type="number" min="1" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
      </div>

      {/* FERIADOS — em feriado não há aula */}
      <Feriados />

      {/* UNIDADES & PROFISSIONAIS */}
      <div className="panel cfg-sec">
        <div className="cfg-h"><span className="cfg-ic">📍</span><div><h2>Unidades &amp; Profissionais</h2><p>Alimentam as opções em toda a agenda e nas marcações. Uma por linha.</p></div></div>
        <div className="row2">
          <div className="field">
            <label>Unidades <span className="cfg-count">{unitsList.length}</span></label>
            <textarea value={units} onChange={(e) => setUnits(e.target.value)} style={{ minHeight: 110 }} placeholder={"Ipatinga\nTimóteo"} />
          </div>
          <div className="field">
            <label>Profissionais <span className="cfg-count">{profsList.length}</span></label>
            <textarea value={profs} onChange={(e) => setProfs(e.target.value)} style={{ minHeight: 110 }} placeholder={"Equipe FQC\nOutro nome"} />
          </div>
        </div>
      </div>

      {/* HORÁRIO POR UNIDADE */}
      {unitsList.length === 0 && (
        <div className="panel cfg-sec">
          <div className="cfg-h"><span className="cfg-ic">🕒</span><div><h2>Horário de funcionamento</h2><p>Cadastre ao menos uma unidade acima para configurar os horários.</p></div></div>
        </div>
      )}
      {unitsList.map((unit) => {
        const days = getUnitDays(unit);
        return (
          <div key={unit} className="panel cfg-sec">
            <div className="cfg-h">
              <span className="cfg-ic">🕒</span>
              <div>
                <h2>Horário — {unit}</h2>
                <p>Dias e horários de funcionamento desta unidade. Exibido para as alunas.</p>
              </div>
            </div>
            <div className="hf-list">
              {WEEKDAYS_PT.map((dia, i) => (
                <div key={dia} className={`hf-row ${days[i].open ? "" : "off"}`}>
                  <label className="hf-toggle">
                    <input type="checkbox" checked={days[i].open} onChange={(e) => setUnitDay(unit, i, { open: e.target.checked })} />
                    <span className="hf-day">{dia}</span>
                  </label>
                  {days[i].open ? (
                    <div className="hf-times">
                      <input type="time" value={days[i].from} onChange={(e) => setUnitDay(unit, i, { from: e.target.value })} />
                      <span className="hf-sep">às</span>
                      <input type="time" value={days[i].to} onChange={(e) => setUnitDay(unit, i, { to: e.target.value })} />
                    </div>
                  ) : <span className="hf-closed">Fechado</span>}
                </div>
              ))}
            </div>
            <div className="cfg-preview" style={{ marginTop: ".9rem" }}>🕒 Alunas verão: <b>{horarioToText(days)}</b></div>
          </div>
        );
      })}

      </div>

      <div className="cfg-save">
        <button className="btn" onClick={save}>Salvar configurações</button>
        {saved && <span className="badge b-ok"><span className="dot" style={{ background: "var(--ok)" }} /> Salvo</span>}
      </div>
    </div>
  );
}
