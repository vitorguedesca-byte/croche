import { useState } from "react";
import { toast } from "./toast.jsx";
import { useStore } from "./store.jsx";
import { useModal } from "./ui.jsx";
import { ReajusteGeral } from "./modals.jsx";
import { api } from "./api.js";
import { WEEKDAYS_PT, DEFAULT_HORARIO, parseHorario, horarioToText, serializeHorario, money } from "./helpers.js";

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
  // A taxa de matrícula saiu da tabela: o valor dela está diluído na mensalidade,
  // e quem se matricula paga a 1ª mensalidade cheia na tela da experimental.
  const [plano1x, setPlano1x] = useState(m.valorPlano1x ?? 120);
  const [plano2x, setPlano2x] = useState(m.valorPlano2x ?? 200);
  const [avulsa, setAvulsa] = useState(m.valorAvulsa ?? 40);
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
            <label>Duração da aula (minutos)</label>
            <input type="number" min="15" max="600" step="15" value={duracao} onChange={(e) => setDuracao(e.target.value)} />
            <div className="help" style={{ marginTop: ".4rem" }}>Usada para mostrar o fim da aula e impedir turmas sobrepostas na mesma unidade.</div>
          </div>
        </div>
        <div className="help" style={{ marginTop: ".2rem" }}>
          Não existe mais taxa de matrícula separada: o valor dela está diluído na mensalidade.
          Na tela da aula experimental a aluna escolhe o plano e já paga a <b>1ª mensalidade cheia</b> —
          é esse pagamento que a matricula, e a próxima cobrança cai no mês seguinte, no mesmo dia.
        </div>
        <div className="cfg-preview">
          🏷️ 1x/semana <b>R$ {plano1x}</b> (4 aulas) · 2x/semana <b>R$ {plano2x}</b> (8 aulas) · extra <b>R$ {avulsa}</b> · aula de <b>{Math.floor(duracao / 60)}h{duracao % 60 ? String(duracao % 60).padStart(2, "0") : ""}</b>
        </div>

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
