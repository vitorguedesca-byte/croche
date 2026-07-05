// Camada de acesso à API do backend.
async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = "Erro na requisição";
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  getState: () => req("GET", "/api/state"),

  createSlot: (data) => req("POST", "/api/slots", data),
  updateSlotCapacity: (id, capacity) => req("PATCH", `/api/slots/${id}`, { capacity }),
  deleteSlot: (id) => req("DELETE", `/api/slots/${id}`),

  createBooking: (data) => req("POST", "/api/bookings", data),
  updateBooking: (id, data) => req("PATCH", `/api/bookings/${id}`, data),
  payBooking: (id, data) => req("POST", `/api/bookings/${id}/pay`, data),

  createClient: (data) => req("POST", "/api/clients", data),
  updateClient: (id, data) => req("PATCH", `/api/clients/${id}`, data),
  deleteClient: (id) => req("DELETE", `/api/clients/${id}`),

  addWaitlist: (slotId, data) => req("POST", `/api/slots/${slotId}/waitlist`, data),
  removeWaitlist: (id) => req("DELETE", `/api/waitlist/${id}`),
  promoteWaitlist: (id) => req("POST", `/api/waitlist/${id}/promote`),

  updateSettings: (data) => req("PUT", "/api/settings", data),

  availableSlots: (unit) => req("GET", `/api/slots/available${unit ? `?unit=${encodeURIComponent(unit)}` : ""}`),

  resetPin: (clientId) => req("DELETE", `/api/clients/${clientId}/pin`),

  auth: {
    check:  (cpf)       => req("POST", "/api/auth/check",   { cpf }),
    setPin: (cpf, pin)  => req("POST", "/api/auth/set-pin", { cpf, pin }),
    login:  (cpf, pin)  => req("POST", "/api/auth/login",   { cpf, pin }),
  },

  portal: {
    get: (phone) => req("GET", `/api/portal/${encodeURIComponent(phone)}`),
    book: (phone, slotId, name) => req("POST", `/api/portal/${encodeURIComponent(phone)}/book`, { slotId, name }),
    cancel: (phone, bookingId) => req("POST", `/api/portal/${encodeURIComponent(phone)}/cancel/${bookingId}`),
    absence: (phone, bookingId, reason) => req("POST", `/api/portal/${encodeURIComponent(phone)}/absence/${bookingId}`, { reason }),
  },
};
