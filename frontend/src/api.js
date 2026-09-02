// Camada de acesso à API do backend.

// ----- token de sessão do painel admin -----
let TOKEN = null;
// Perfil de quem entrou: "admin" (tudo) ou "instrutora" (só a Agenda, e só ver).
// É uma conveniência da tela — quem manda de verdade é o backend, que recusa
// qualquer rota fora da lista da instrutora mesmo sem passar por botão nenhum.
let ROLE = "admin";
let NOME = "";
try {
  TOKEN = localStorage.getItem("fqc_admin_token");
  ROLE = localStorage.getItem("fqc_admin_role") || "admin";
  NOME = localStorage.getItem("fqc_admin_nome") || "";
} catch {}
export function setToken(t, role, nome) {
  TOKEN = t || null;
  ROLE = t ? (role || "admin") : "admin";
  NOME = t ? (nome || "") : "";
  try {
    if (t) {
      localStorage.setItem("fqc_admin_token", t);
      localStorage.setItem("fqc_admin_role", ROLE);
      localStorage.setItem("fqc_admin_nome", NOME);
    } else {
      localStorage.removeItem("fqc_admin_token");
      localStorage.removeItem("fqc_admin_role");
      localStorage.removeItem("fqc_admin_nome");
    }
  } catch {}
}
export function getToken() { return TOKEN; }
export function getRole() { return TOKEN ? ROLE : "admin"; }
export function getNome() { return NOME; }
export function isInstrutora() { return getRole() === "instrutora"; }

async function req(method, url, body) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, {
    method,
    headers,
    // sem cache: depois de cancelar/marcar uma aula, a tela precisa ler o estado
    // novo do servidor, nunca uma resposta guardada pelo navegador
    cache: "no-store",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = "Erro na requisição";
    try { msg = (await res.json()).error || msg; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  getState: () => req("GET", "/api/state"),

  createSlot: (data) => req("POST", "/api/slots", data),
  updateSlotCapacity: (id, capacity) => req("PATCH", `/api/slots/${id}`, { capacity }),
  updateSlot: (id, data) => req("PATCH", `/api/slots/${id}`, data),
  // repete a turma inteira (horário + alunas) nas próximas `weeks` semanas
  replicateSlot: (id, weeks, alunas = true) => req("POST", `/api/slots/${id}/replicate`, { weeks, alunas }),
  replicateAgenda: (data) => req("POST", "/api/agenda/replicate", data),
  // mode: falsy = só este · "series" = mesmos da série · "match" = todos os
  // futuros equivalentes (mesma unidade/hora/dia da semana), pega-tudo
  deleteSlot: (id, mode) => req("DELETE", `/api/slots/${id}${mode === "match" ? "?match=1" : mode ? "?series=1" : ""}`),

  createBooking: (data) => req("POST", "/api/bookings", data),
  updateBooking: (id, data) => req("PATCH", `/api/bookings/${id}`, data),
  deleteBooking: (id, series) => req("DELETE", `/api/bookings/${id}${series ? "?series=1" : ""}`),
  payBooking: (id, data) => req("POST", `/api/bookings/${id}/pay`, data),
  createInvoice: (id, data) => req("POST", `/api/bookings/${id}/invoice`, data),

  createClient: (data) => req("POST", "/api/clients", data),
  updateClient: (id, data) => req("PATCH", `/api/clients/${id}`, data),
  deleteClient: (id) => req("DELETE", `/api/clients/${id}`),

  // mensalidades (mensalistas)
  batchBook: (clientId, data) => req("POST", `/api/clients/${clientId}/batch-book`, data),
  // Tira o aluno de várias aulas futuras da mesma turma. `credito: true` libera
  // a vaga como no portal (gera reposição onde couber); false apaga a aula.
  batchUnbook: (clientId, data) => req("POST", `/api/clients/${clientId}/batch-unbook`, data),
  getMakeup: (clientId) => req("GET", `/api/clients/${clientId}/makeup`),
  // `forcar` = a Inêz viu o aviso ("sábado não faz parte do plano dela") e
  // decidiu marcar assim mesmo. O portal da aluna nunca manda esse campo.
  makeupBook: (clientId, slotId, forcar) => req("POST", `/api/clients/${clientId}/makeup-book`, { slotId, forcar: !!forcar }),
  extraBook: (clientId, slotId, forcar) => req("POST", `/api/clients/${clientId}/extra-book`, { slotId, forcar: !!forcar }),
  enroll: (clientId, data) => req("POST", `/api/clients/${clientId}/enroll`, data),
  refundMatricula: (clientId) => req("POST", `/api/clients/${clientId}/matricula/refund`, {}),
  releaseBooking: (id, reason) => req("POST", `/api/bookings/${id}/release`, { reason: reason || "" }),
  gerarMensalidade: (clientId, competencia) => req("POST", `/api/clients/${clientId}/invoice`, competencia ? { competencia } : {}),
  gerarMensalidadesMes: () => req("POST", "/api/invoices/gerar-mes"),
  // Baixa manual: marca paga E suprime o Pix da mensalidade seguinte (a aluna
  // acerta por fora). `manual: false` só para conciliação, sem essa consequência.
  payInvoice: (id, opts = {}) => req("POST", `/api/invoices/${id}/pay`, opts),
  cancelInvoice: (id) => req("POST", `/api/invoices/${id}/cancel`),

  /* Alterar o valor da mensalidade. `data.escopo` diz o alcance:
     recorrente (para sempre) | mes_atual | proximo_mes | competencias (meses
     escolhidos) | promocao (N meses seguidos) | limpar (volta ao recorrente). */
  alterarMensalidade: (clientId, data) => req("POST", `/api/clients/${clientId}/mensalidade-valor`, data),
  // Reemite o Pix da mensalidade (o QR some quando o valor muda)
  reemitirPix: (invoiceId) => req("POST", `/api/invoices/${invoiceId}/pix`),
  reajustePreview: (data) => req("POST", "/api/mensalidades/reajuste/preview", data),
  reajuste: (data) => req("POST", "/api/mensalidades/reajuste", data),

  addWaitlist: (slotId, data) => req("POST", `/api/slots/${slotId}/waitlist`, data),
  removeWaitlist: (id) => req("DELETE", `/api/waitlist/${id}`),
  promoteWaitlist: (id) => req("POST", `/api/waitlist/${id}/promote`),

  updateSettings: (data) => req("PUT", "/api/settings", data),

  /* Feriados: em feriado a escola não abre. `list` traz o calendário já
     resolvido (nacionais + o que a Inêz cadastrou) e só as datas manuais, que
     são as editáveis. `save` devolve as aulas já marcadas naquele dia — quem
     decide cancelar é a Inêz, por `cancelarAulas`. */
  feriados: {
    list: () => req("GET", "/api/feriados"),
    save: (data) => req("POST", "/api/feriados", data),
    remove: (date) => req("DELETE", `/api/feriados/${date}`),
    aulas: (date) => req("GET", `/api/feriados/${date}/aulas`),
    cancelarAulas: (date, unit) => req("POST", `/api/feriados/${date}/cancelar-aulas`, { unit }),
    dia: (date, unit) => req("GET", `/api/feriados-dia?date=${encodeURIComponent(date)}&unit=${encodeURIComponent(unit)}`),
    definirAulas: (date, unit, hasClasses) => req("POST", "/api/feriados-dia", { date, unit, hasClasses }),
  },

  availableSlots: (unit) => req("GET", `/api/slots/available${unit ? `?unit=${encodeURIComponent(unit)}` : ""}`),

  resetPin: (clientId) => req("DELETE", `/api/clients/${clientId}/pin`),

  testimonials: {
    list:   ()         => req("GET",   "/api/testimonials"),
    create: (data)     => req("POST",  "/api/testimonials", data),
    update: (id, data) => req("PATCH", `/api/testimonials/${id}`, data),
    remove: (id)       => req("DELETE",`/api/testimonials/${id}`),
    uploadPhoto: async (id, file) => {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch(`/api/testimonials/${id}/photo`, { method: "POST", body: fd });
      if (!res.ok) { let msg = "Erro"; try { msg = (await res.json()).error || msg; } catch {} throw new Error(msg); }
      return res.json();
    },
  },

  auth: {
    check:  (cpf)       => req("POST", "/api/auth/check",   { cpf }),
    setPin: (cpf, pin)  => req("POST", "/api/auth/set-pin", { cpf, pin }),
    login:  (cpf, pin)  => req("POST", "/api/auth/login",   { cpf, pin }),
  },

  // Login do painel administrativo
  admin: {
    exists:  ()                   => req("GET",  "/api/admin/exists"),
    setup:   (username, password) => req("POST", "/api/admin/setup", { username, password }),
    register:(username, password) => req("POST", "/api/admin/register", { username, password }),
    login:   (username, password) => req("POST", "/api/admin/login", { username, password }),
    logout:  ()                   => req("POST", "/api/admin/logout"),
    users:   ()                   => req("GET",  "/api/admin/users"),
    addUser: (username, password) => req("POST", "/api/admin/users", { username, password }),
  },

  portal: {
    get: (phone) => req("GET", `/api/portal/${encodeURIComponent(phone)}`),
    book: (phone, slotId, name, modo) => req("POST", `/api/portal/${encodeURIComponent(phone)}/book`, {
      slotId, name, reposicao: modo === "repor", extra: modo === "extra",
    }),
    enroll: (phone, data) => req("POST", `/api/portal/${encodeURIComponent(phone)}/enroll`, data),
    // Aula extra: ela compra primeiro (Pix) e só escolhe o horário depois que cai
    extraCheckout: (phone) => req("POST", `/api/portal/${encodeURIComponent(phone)}/extra/checkout`, {}),
    extraStatus: (phone) => req("GET", `/api/portal/${encodeURIComponent(phone)}/extra/status`),
    extraCancelar: (phone) => req("POST", `/api/portal/${encodeURIComponent(phone)}/extra/cancelar`, {}),
    cancel: (phone, bookingId) => req("POST", `/api/portal/${encodeURIComponent(phone)}/cancel/${bookingId}`),
    absence: (phone, bookingId, reason) => req("POST", `/api/portal/${encodeURIComponent(phone)}/absence/${bookingId}`, { reason }),
    // Pix da mensalidade: devolve o código atual ou reemite, se já tinha vencido
    invoicePix: (phone, invoiceId) => req("POST", `/api/portal/${encodeURIComponent(phone)}/invoice/${invoiceId}/pix`),
  },
};
