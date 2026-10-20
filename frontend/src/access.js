import { canAccess, getSession } from "./api.js";
export const VIEW_MODULE = {
  dashboard: "dashboard", agenda: "agenda", marcacoes: "agenda", clientes: "alunos", aniversariantes: "alunos",
  funil: "funil", disparo: "whatsapp", financeiro: "financeiro", mensalistas: "financeiro", recebimentos: "financeiro",
  "rel-vendas": "relatorios", "rel-vagas": "relatorios", "rel-presentes": "relatorios", campanhas: "campanhas",
  depoimentos: "depoimentos", config: "configuracoes",
};
export function canView(view) {
  const role = getSession()?.role;
  if (role === "instrutora") return view === "agenda";
  return view === "acessos" ? role === "admin" : canAccess(VIEW_MODULE[view]);
}
export const canEditView = view => view === "acessos" ? getSession()?.role === "admin" : canAccess(VIEW_MODULE[view], 2);
