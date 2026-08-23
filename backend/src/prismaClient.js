import { PrismaClient } from "@prisma/client";

// Instância única do Prisma reutilizada por toda a aplicação.
export const prisma = new PrismaClient();

export const UNITS = ["Ipatinga", "Timóteo"];
export const PROFS = ["Equipe FQC"];
export const VALOR_PADRAO = 80;
export const CAPACITY_PADRAO = 4;

export function profFor(unit) {
  return "Equipe FQC";
}
