// Camada de acesso à API do backend.

// ----- token de sessão do painel admin -----
let TOKEN = null;
try { TOKEN = localStorage.getItem("fqc_admin_token"); } catch {}
export function setToken(t) {
  TOKEN = t || null;
  try { t ? localStorage.setItem("fqc_admin_token", t) : localStorage.removeItem("fqc_admin_token"); } catch {}
}
export function getToken() { return TOKEN; }

async function req(method, url, body) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, {
    method,
    headers,
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
  deleteSlot: (id, series) => req("DELETE", `/api/slots/${id}${series ? "?series=1" : ""}`),

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
  getMakeup: (clientId) => req("GET", `/api/clients/${clientId}/makeup`),
  makeupBook: (clientId, slotId) => req("POST", `/api/clients/${clientId}/makeup-book`, { slotId }),
  extraBook: (clientId, slotId) => req("POST", `/api/clients/${clientId}/extra-book`, { slotId }),
  enroll: (clientId, data) => req("POST", `/api/clients/${clientId}/enroll`, data),
  refundMatricula: (clientId) => req("POST", `/api/clients/${clientId}/matricula/refund`, {}),
  releaseBooking: (id, reason) => req("POST", `/api/bookings/${id}/release`, { reason: reason || "" }),
  gerarMensalidade: (clientId, competencia) => req("POST", `/api/clients/${clientId}/invoice`, competencia ? { competencia } : {}),
  gerarMensalidadesMes: () => req("POST", "/api/invoices/gerar-mes"),
  payInvoice: (id) => req("POST", `/api/invoices/${id}/pay`),
  cancelInvoice: (id) => req("POST", `/api/invoices/${id}/cancel`),

  addWaitlist: (slotId, data) => req("POST", `/api/slots/${slotId}/waitlist`, data),
  removeWaitlist: (id) => req("DELETE", `/api/waitlist/${id}`),
  promoteWaitlist: (id) => req("POST", `/api/waitlist/${id}/promote`),

  updateSettings: (data) => req("PUT", "/api/settings", data),

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
    cancel: (phone, bookingId) => req("POST", `/api/portal/${encodeURIComponent(phone)}/cancel/${bookingId}`),
    absence: (phone, bookingId, reason) => req("POST", `/api/portal/${encodeURIComponent(phone)}/absence/${bookingId}`, { reason }),
  },
};
