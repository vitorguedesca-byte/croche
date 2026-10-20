import { useCallback, useEffect, useState } from "react";
import { api, getSession } from "./api.js";
import { Select, Modal, useModal } from "./ui.jsx";
import { useStore } from "./store.jsx";
import { toast, confirmModal } from "./toast.jsx";
import "./acessos.css";

const date = v => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "Ainda não entrou";
const ACTIONS = { primeiro_admin: "Primeiro Admin criado", usuario_criado: "Usuário criado", usuario_alterado: "Usuário alterado", sessoes_encerradas: "Sessões encerradas", perfil_criado: "Perfil criado", perfil_alterado: "Perfil alterado", perfil_excluido: "Perfil excluído" };

function UserForm({ user, profiles, onSaved }) {
  const { close } = useModal();
  const [form, setForm] = useState({ username: user?.username || "", nome: user?.nome || "", password: "", role: user?.role || "instrutora", profileId: user?.profileId || null, active: user?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const profile = form.role === "equipe" ? String(form.profileId || "") : form.role;
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const body = { ...form };
      if (user && !body.password) delete body.password;
      await (user ? api.admin.updateUser(user.id, body) : api.admin.addUser(body));
      close(); await onSaved(); toast(user ? "Acesso atualizado." : "Usuário criado.", "ok");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title={user ? "Editar usuário" : "Novo usuário"} size="md">
    <form className="access-form" onSubmit={save}>
      <label htmlFor="access-name">Nome de exibição<input id="access-name" value={form.nome} maxLength={120} onChange={e => set("nome", e.target.value)} autoComplete="name" /></label>
      <label htmlFor="access-user">Usuário de acesso<input id="access-user" required minLength={3} maxLength={60} value={form.username} autoComplete="off" onChange={e => set("username", e.target.value)} /></label>
      <div><label htmlFor="access-profile">Perfil</label><Select id="access-profile" value={profile} options={profiles.map(p => ({ value: String(p.id), label: p.name, hint: p.description }))} onChange={v => setForm(f => ({ ...f, role: ["admin", "instrutora"].includes(v) ? v : "equipe", profileId: ["admin", "instrutora"].includes(v) ? null : Number(v) }))} /></div>
      {form.role === "admin" && <p className="access-note">Admin pode realizar todas as ações, inclusive gerenciar usuários e perfis.</p>}
      <label htmlFor="access-pass">{user ? "Nova senha (deixe vazia para manter)" : "Senha inicial"}<input id="access-pass" type="password" autoComplete="new-password" value={form.password} required={!user} minLength={8} onChange={e => set("password", e.target.value)} /></label>
      <p className="access-muted">Mínimo de 8 caracteres. A troca de senha encerra as sessões abertas.</p>
      {user && <label className="access-check"><input type="checkbox" checked={form.active} onChange={e => set("active", e.target.checked)} /> Usuário ativo</label>}
      {user?.id === getSession()?.id && <p className="access-note">Você está editando seu próprio acesso. Bloquear ou trocar a senha exigirá novo login.</p>}
      {error && <p className="access-error" role="alert">{error}</p>}
      <div className="access-actions"><button className="btn ghost" type="button" onClick={close} disabled={busy}>Cancelar</button><button className="btn" disabled={busy}>{busy ? "Salvando…" : "Salvar usuário"}</button></div>
    </form>
  </Modal>;
}

function ProfileForm({ profile, modules, onSaved }) {
  const { close } = useModal();
  const [name, setName] = useState(profile?.name || "");
  const [description, setDescription] = useState(profile?.description || "");
  const [permissions, setPermissions] = useState(profile?.permissions || { agenda: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const body = { name, description, permissions };
      await (profile ? api.admin.updateProfile(profile.id, body) : api.admin.createProfile(body));
      close(); await onSaved(); toast("Perfil salvo. As permissões já valem para os usuários vinculados.", "ok");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title={profile ? "Editar perfil" : "Novo perfil"} size="md"><form className="access-form" onSubmit={save}>
    <label htmlFor="profile-name">Nome do perfil<input id="profile-name" required minLength={3} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Atendimento ou Financeiro" /></label>
    <label htmlFor="profile-desc">Descrição<input id="profile-desc" maxLength={250} value={description} onChange={e => setDescription(e.target.value)} /></label>
    <p className="access-note">Escolha o acesso a cada módulo. Somente Admin gerencia usuários, perfis e o histórico de acessos. Relatórios incluem dados financeiros.</p>
    <fieldset className="access-permissions"><legend>Permissões por módulo</legend>{modules.map(m => <div className="access-permission" key={m.key}>
      <label htmlFor={`perm-${m.key}`}>{m.label}</label>
      <Select id={`perm-${m.key}`} value={permissions[m.key] || 0} onChange={v => setPermissions(p => ({ ...p, [m.key]: Number(v) }))} options={[
        { value: 0, label: "Sem acesso" }, { value: 1, label: "Somente consulta" }, ...(!m.readOnly ? [{ value: 2, label: "Consultar e editar" }] : []),
      ]} />
    </div>)}</fieldset>
    {error && <p className="access-error" role="alert">{error}</p>}
    <div className="access-actions"><button className="btn ghost" type="button" onClick={close} disabled={busy}>Cancelar</button><button className="btn" disabled={busy}>{busy ? "Salvando…" : "Salvar perfil"}</button></div>
  </form></Modal>;
}

export default function Usuarios() {
  const { open } = useModal();
  const { reload } = useStore();
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState("usuarios");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [profileFilter, setProfileFilter] = useState("todos");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [u, p, c, a] = await Promise.all([api.admin.users(), api.admin.profiles(), api.admin.catalog(), api.admin.audit()]);
      setUsers(u); setProfiles(p); setCatalog(c); setAudit(a); setError("");
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const saved = async () => { await reload(); await load(); };
  const allProfiles = [...(catalog?.builtinProfiles || []), ...profiles];
  async function action(title, message, fn) {
    if (busy || !await confirmModal({ title, message, confirmLabel: "Confirmar" })) return;
    setBusy(true);
    try { await fn(); await saved(); toast("Alteração concluída.", "ok"); } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  }
  const norm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const list = users.filter(u => norm(`${u.nome} ${u.username}`).includes(norm(search)) && (status === "todos" || u.active === (status === "ativos")) && (profileFilter === "todos" || (u.role === "equipe" ? String(u.profileId) : u.role) === profileFilter));
  if (loading) return <div className="panel" role="status">Carregando acessos…</div>;
  if (error) return <div className="panel"><p role="alert">{error}</p><button className="btn" onClick={load}>Tentar novamente</button></div>;
  return <div className="access-page">
    <div className="access-summary"><div><b>{users.filter(u => u.active).length}</b><span>usuários ativos</span></div><div><b>{users.filter(u => u.role === "admin" && u.active).length}</b><span>Admins ativos</span></div><div><b>{allProfiles.length}</b><span>perfis disponíveis</span></div></div>
    <p className="access-note">Admin tem acesso total. Alterações de perfil passam a valer nas próximas requisições; bloqueios e trocas de senha encerram o acesso.</p>
    <div className="seg access-tabs" aria-label="Gestão de acessos">{[["usuarios", "Usuários"], ["perfis", "Perfis e permissões"], ["historico", "Histórico"]].map(([v, label]) => <button key={v} className={tab === v ? "on" : ""} onClick={() => setTab(v)} aria-pressed={tab === v}>{label}</button>)}</div>
    {tab === "usuarios" && <section className="panel">
      <div className="access-heading"><h2>Usuários do painel</h2><button className="btn" onClick={() => open(<UserForm profiles={allProfiles} onSaved={saved} />)}>＋ Novo usuário</button></div>
      <div className="access-filters"><input aria-label="Buscar usuários" placeholder="Buscar por nome ou usuário" value={search} onChange={e => setSearch(e.target.value)} /><Select value={status} onChange={setStatus} options={[{ value: "todos", label: "Todos os status" }, { value: "ativos", label: "Ativos" }, { value: "bloqueados", label: "Bloqueados" }]} /><Select value={profileFilter} onChange={setProfileFilter} options={[{ value: "todos", label: "Todos os perfis" }, ...allProfiles.map(p => ({ value: String(p.id), label: p.name }))]} /></div>
      <div className="access-users">{list.map(u => <article className="access-user" key={u.id}>
        <div><h3>{u.nome || u.username}{u.id === getSession()?.id && <small> · você</small>}</h3><span className="access-muted">{u.username}</span><div className="access-tags"><span className="chip">{u.profileName}</span><span className={`badge ${u.active ? "b-ok" : "b-danger"}`}>{u.active ? "Ativo" : "Bloqueado"}</span></div><p className="access-muted">Último acesso: {date(u.lastLoginAt)} · {u.sessions} sessão(ões)</p></div>
        <div className="access-actions"><button className="btn sec sm" disabled={busy} onClick={() => open(<UserForm user={u} profiles={allProfiles} onSaved={saved} />)}>Editar acesso</button><button className="btn ghost sm" disabled={busy} onClick={() => action(u.active ? "Bloquear usuário" : "Reativar usuário", `${u.nome || u.username}: ${u.active ? "o acesso será bloqueado e as sessões serão encerradas." : "poderá entrar novamente com a senha atual."}`, () => api.admin.updateUser(u.id, { active: !u.active }))}>{u.active ? "Bloquear" : "Reativar"}</button><button className="btn ghost sm" disabled={busy || !u.sessions} onClick={() => action("Encerrar sessões", `Todos os acessos abertos de ${u.username} serão encerrados.`, () => api.admin.revoke(u.id))}>Encerrar sessões</button></div>
      </article>)}</div>{!list.length && <p className="access-empty">Nenhum usuário encontrado com estes filtros.</p>}
    </section>}
    {tab === "perfis" && <section className="panel"><div className="access-heading"><h2>Perfis e permissões</h2><button className="btn" onClick={() => open(<ProfileForm modules={catalog.modules} onSaved={saved} />)}>＋ Novo perfil</button></div>
      <div className="access-profile-grid">{allProfiles.map(p => <article className="access-profile-card" key={p.id}><h3>{p.name}</h3><p>{p.description || "Perfil personalizado da equipe."}</p><ul>{catalog.modules.filter(m => p.permissions[m.key] > 0).map(m => <li key={m.key}>{m.label}: <strong>{p.id === "admin" ? "Total" : p.permissions[m.key] === 2 ? "Editar" : "Consultar"}</strong></li>)}</ul>{p.locked ? <small>Perfil do sistema · permissões fixas</small> : <><small>{p.userCount} usuário(s) vinculado(s)</small><div className="access-actions"><button className="btn sec sm" onClick={() => open(<ProfileForm profile={p} modules={catalog.modules} onSaved={saved} />)}>Editar perfil</button><button className="btn ghost sm" disabled={busy || p.userCount > 0} title={p.userCount ? "Troque o perfil dos usuários antes de excluir" : "Excluir perfil"} onClick={() => action("Excluir perfil", `Excluir o perfil ${p.name}?`, () => api.admin.deleteProfile(p.id))}>Excluir</button></div></>}</article>)}</div>
    </section>}
    {tab === "historico" && <section className="panel"><div className="access-heading"><h2>Últimas 100 alterações de acesso</h2><button className="btn sec sm" onClick={load}>Atualizar</button></div><p className="access-muted">Horário de Brasília. Senhas e tokens não são registrados.</p><ol className="access-history">{audit.map(a => <li key={a.id}><b>{ACTIONS[a.action] || a.action}</b><span>{a.target} · por {a.actor}</span><time>{date(a.createdAt)}</time></li>)}</ol>{!audit.length && <p className="access-empty">Nenhuma alteração registrada.</p>}</section>}
  </div>;
}
