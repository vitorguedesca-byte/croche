// Contrato de autorização. Perfis desconhecidos nunca herdam o acesso Admin.
export const MODULES = [
  { key: "dashboard", label: "Painel", readOnly: true },
  { key: "agenda", label: "Agenda e marcações" },
  { key: "alunos", label: "Alunos e aniversariantes" },
  { key: "funil", label: "Funil de leads" },
  { key: "whatsapp", label: "Disparo WhatsApp" },
  { key: "financeiro", label: "Financeiro" },
  { key: "relatorios", label: "Relatórios (inclui valores financeiros)", readOnly: true },
  { key: "campanhas", label: "Campanhas e códigos" },
  { key: "depoimentos", label: "Depoimentos" },
  { key: "configuracoes", label: "Configurações e feriados" },
];
export const FULL_ACCESS = Object.fromEntries(MODULES.map(m => [m.key, 2]));
export const BUILTIN_PROFILES = [
  { id: "admin", name: "Admin", description: "Acesso total a todas as ações, usuários e perfis.", permissions: FULL_ACCESS, locked: true },
  { id: "instrutora", name: "Instrutora", description: "Somente consulta à agenda.", permissions: { agenda: 1 }, locked: true },
];
export function validatePermissions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Informe as permissões do perfil.");
  const result = {};
  for (const [key, level] of Object.entries(value)) {
    const mod = MODULES.find(m => m.key === key);
    if (!mod || !Number.isInteger(level) || level < 0 || level > (mod.readOnly ? 1 : 2)) throw new Error("Permissão inválida: " + key);
    result[key] = level;
  }
  if (!Object.values(result).some(v => v > 0)) throw new Error("Libere ao menos um módulo.");
  return result;
}
export function permissionsFor(user) {
  if (!user || user.active === false) return {};
  if (user.role === "admin") return { ...FULL_ACCESS };
  if (user.role === "instrutora") return { agenda: 1 };
  if (user.role !== "equipe") return {};
  // Personalizado: sem perfil vinculado, valem os módulos gravados no usuário.
  const source = user.profile ? user.profile.permissions : user.profileId ? null : user.permissions;
  if (!source) return {};
  try { return validatePermissions(JSON.parse(source)); } catch { return {}; }
}
export function can(user, module, level = 1) {
  return (permissionsFor(user)[module] || 0) >= level;
}
export function requirement(method, path) {
  const level = ["GET", "HEAD"].includes(method) ? 1 : 2;
  if (/^\/api\/admin\/(me|logout)$/.test(path) || path === "/api/state") return [];
  if (path.startsWith("/api/admin/") || path.startsWith("/api/undo")) return [["admin", 2]];
  if (/^\/api\/(invoices|mensalidades|pix-alertas|sicredi)(\/|$)/.test(path) || /^\/api\/bookings\/\d+\/(pay|invoice)$/.test(path) || /^\/api\/clients\/\d+\/(invoice|mensalidade-valor|matricula\/refund)$/.test(path)) return [["financeiro", level]];
  if (path.startsWith("/api/relatorios/")) return [["relatorios", 1]];
  if (path.startsWith("/api/wa/")) return [["whatsapp", level]];
  if (path.startsWith("/api/funil")) return [["funil", level]];
  if (/^\/api\/vouchers(\/|$)/.test(path) || /^\/api\/clients\/\d+\/voucher$/.test(path)) return [["campanhas", level]];
  if (/^\/api\/(settings|feriados)(\/|-|$)/.test(path)) return [["configuracoes", level]];
  if (path.startsWith("/api/testimonials")) return [["depoimentos", level]];
  if (/^\/api\/(slots|bookings|agenda|waitlist)(\/|$)/.test(path) || /^\/api\/clients\/\d+\/(batch-book|batch-unbook|makeup-book|extra-book|presente-book)$/.test(path)) return [["agenda", level]];
  if (/^\/api\/(clients|presentes|makeup)(\/|$)/.test(path)) return [["alunos", level]];
  return [["admin", 2]]; // rotas novas exigem Admin até terem classificação explícita
}
export function allowed(user, method, path) {
  if (user.role === "admin" && user.active !== false) return true;
  return requirement(method, path).every(([module, level]) => module !== "admin" && can(user, module, level));
}

// /state alimenta várias telas. Não basta esconder o item do menu.
export function filterState(state, user) {
  if (user.role === "admin") return state;
  const finance = can(user, "financeiro") || can(user, "relatorios");
  const students = can(user, "alunos") || finance;
  const contacts = can(user, "whatsapp") || can(user, "campanhas") || can(user, "funil");
  const schedule = can(user, "agenda") || can(user, "dashboard") || students;
  return {
    ...state,
    clients: students ? state.clients.map(({ monthlyValue, matriculaAt, matriculaRefundAt, ...c }) => finance ? { ...c, monthlyValue, matriculaAt, matriculaRefundAt } : c) : contacts ? state.clients.map(({ id, name, phone, unit, plan, status, firstClass, weeklyFreq, mensalistaTipo, tags }) => ({ id, name, phone, unit, plan, status, firstClass, weeklyFreq, mensalistaTipo, tags })) : schedule ? state.clients.map(({ id, name, plan, status, firstClass, weeklyFreq, mensalistaTipo }) => ({ id, name, plan, status, firstClass, weeklyFreq, mensalistaTipo, tags: [] })) : [],
    slots: schedule ? state.slots.map(s => ({ ...s, waitlist: can(user, "agenda", 2) ? s.waitlist : [] })) : [],
    bookings: schedule ? state.bookings.map(b => {
      if (finance) return b;
      const { value, taxaMatricula, paid, paymentMethod, paymentDate, txid, pixCode, boletoUrl, ...rest } = b;
      return can(user, "agenda", 2) || students ? rest : Object.fromEntries(["id", "clientName", "unit", "date", "time", "prof", "slotId", "status", "attendance"].map(k => [k, rest[k]]));
    }) : [],
    invoices: finance ? state.invoices : [],
    precos: finance ? state.precos : [],
    makeups: students || can(user, "agenda", 2) ? state.makeups : [],
    presentes: students || can(user, "agenda", 2) ? state.presentes : [],
    waRecebidas: can(user, "whatsapp") ? state.waRecebidas : [],
    pixAlertas: can(user, "financeiro") ? state.pixAlertas : [],
    funilAvisos: can(user, "funil") ? state.funilAvisos : [],
  };
}
