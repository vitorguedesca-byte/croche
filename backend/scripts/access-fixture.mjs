// Banco em memória exclusivo dos testes. Não importa prismaClient nem lê .env.
export function memoryPrisma() {
  let data = { adminUser: [], accessProfile: [], accessAudit: [] };
  let pending = Promise.resolve();
  const db = {};
  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  for (const key of Object.keys(data)) {
    const enrich = (row, include) => {
      if (!row) return null;
      const result = structuredClone(row);
      if (include?.profile) result.profile = data.accessProfile.find(p => p.id === result.profileId) || null;
      if (include?._count) result._count = { users: data.adminUser.filter(u => u.profileId === result.id).length };
      return result;
    };
    db[key] = {
      async findUnique({ where, include } = {}) { return enrich(data[key].find(r => matches(r, where)), include); },
      async findMany({ where, include, orderBy, take } = {}) {
        let rows = data[key].filter(r => matches(r, where)).map(r => enrich(r, include));
        if (orderBy) { const [field, direction] = Object.entries(orderBy)[0]; rows.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === "desc" ? -1 : 1)); }
        return take ? rows.slice(0, take) : rows;
      },
      async count({ where } = {}) { return data[key].filter(r => matches(r, where)).length; },
      async create({ data: values, include }) {
        if ((key === "adminUser" && data[key].some(u => u.username === values.username)) || (key === "accessProfile" && data[key].some(p => p.name === values.name))) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        const row = { id: Math.max(0, ...data[key].map(r => r.id)) + 1, createdAt: new Date(), ...(key === "adminUser" ? { active: true, profileId: null, sessionVersion: 0, lastLoginAt: null, nome: null } : {}), ...values };
        data[key].push(row); return enrich(row, include);
      },
      async update({ where, data: values, include }) {
        const row = data[key].find(r => matches(r, where));
        if (!row) throw new Error("not found");
        if (key === "adminUser" && values.username && data[key].some(u => u.id !== row.id && u.username === values.username)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        for (const [k, v] of Object.entries(values)) row[k] = v && typeof v === "object" && "increment" in v ? row[k] + v.increment : v;
        return enrich(row, include);
      },
      async delete({ where }) { const index = data[key].findIndex(r => matches(r, where)); return data[key].splice(index, 1)[0]; },
    };
  }
  db.$transaction = fn => {
    const run = pending.then(async () => { const backup = structuredClone(data); try { return await fn(db); } catch (e) { data = backup; throw e; } });
    pending = run.catch(() => {}); return run;
  };
  return db;
}
