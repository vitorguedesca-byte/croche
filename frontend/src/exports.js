// Exportação de dados (CSV) e backup (JSON) — tudo no navegador.
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const stamp = () => new Date().toISOString().slice(0, 10);

export function exportBookingsCsv(data) {
  const head = ["Aluno", "Telefone", "Unidade", "Data", "Hora", "Status", "Presenca", "Valor", "Pago", "Forma", "Data pgto"];
  const rows = [...data.bookings]
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map((b) => [b.clientName, b.phone, b.unit, b.date, b.time, b.status, b.attendance || "", b.value, b.paid ? "Sim" : "Nao", b.paymentMethod || "", b.paymentDate || ""]);
  const csv = [head, ...rows].map((r) => r.map(cell).join(";")).join("\n");
  download(`fios-marcacoes-${stamp()}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
}

export function exportClientsCsv(data) {
  const head = ["Nome", "Telefone", "Unidade", "Etiquetas", "Observacoes"];
  const rows = data.clients.map((c) => [c.name, c.phone, c.unit, (c.tags || []).join(", "), c.notes || ""]);
  const csv = [head, ...rows].map((r) => r.map(cell).join(";")).join("\n");
  download(`fios-alunos-${stamp()}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
}

export function downloadBackup(data) {
  download(`fios-backup-${stamp()}.json`, JSON.stringify(data, null, 2), "application/json");
}
