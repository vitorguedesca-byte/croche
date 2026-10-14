import { agruparAgendamentos, faixaHorario, fmtDate } from "./helpers.js";

// O resumo usa somente reservas existentes: agrupar por dia/horário não cria
// recorrência, inclusive para alunas de escala, reposições e aulas avulsas.
export default function Agendamentos({ bookings, duracao, compact = false }) {
  const turmas = agruparAgendamentos(bookings);
  if (!turmas.length) return <p className="agendamentos-empty">Nenhum agendamento futuro.</p>;

  return (
    <ul className={`agendamentos${compact ? " agendamentos-compact" : ""}`}>
      {turmas.map((turma) => (
        <li key={turma.key}>
          <strong>{turma.dia} · <span className="agendamentos-horario">{faixaHorario(turma.time, duracao)}</span></strong>
          <span>{turma.unit || "Unidade não informada"}</span>
          <small>
            {turma.datas.length === 1 ? "Aula" : "Próxima"}: {fmtDate(turma.datas[0])}/{turma.datas[0].slice(0, 4)}
            {turma.datas.length > 1 && ` · ${turma.datas.length} aulas agendadas`}
          </small>
        </li>
      ))}
    </ul>
  );
}
