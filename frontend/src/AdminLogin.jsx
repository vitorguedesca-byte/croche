import { useState, useEffect } from "react";
import { api, setToken } from "./api.js";

// Tela de acesso ao painel administrativo (usuário + senha).
// Se ainda não existe nenhum admin, mostra "criar primeiro acesso".
export default function AdminLogin() {
  const [mode, setMode] = useState(null); // "login" | "setup" | "register" | null(carregando)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.admin.exists()
      .then((r) => setMode(r.exists ? "login" : "setup"))
      .catch(() => {
        // Backend antigo/desligado: não tem o endpoint. Assume primeiro acesso e avisa.
        setMode("setup");
        setErr("Não consegui falar com o servidor. Reinicie o backend (npm run dev) e recarregue a página.");
      });
  }, []);

  async function submit(e) {
    e && e.preventDefault();
    setErr("");
    const u = username.trim();
    const isCreate = mode === "setup" || mode === "register";
    if (u.length < 3) return setErr("Usuário deve ter ao menos 3 caracteres.");
    if (password.length < 4) return setErr("Senha deve ter ao menos 4 caracteres.");
    if (isCreate && password !== password2) return setErr("As senhas não conferem.");
    setBusy(true);
    try {
      const r = mode === "setup"
        ? await api.admin.setup(u, password)
        : mode === "register"
        ? await api.admin.register(u, password)
        : await api.admin.login(u, password);
      setToken(r.token);
      window.location.reload(); // recarrega já autenticado
    } catch (e2) {
      setErr(e2.message || "Não foi possível entrar.");
      setBusy(false);
    }
  }

  return (
    <div style={S.wrap}>
      <form style={S.card} onSubmit={submit}>
        <img src="/logo-1.PNG" alt="Fios que Curam" style={S.logo} />
        <h1 style={S.title}>Painel Fios que Curam</h1>
        <p style={S.sub}>
          {mode === "setup"
            ? "Crie o primeiro acesso do painel. Guarde bem essas credenciais."
            : mode === "register"
            ? "Cadastre um novo acesso para a equipe da Inêz."
            : "Acesso restrito à equipe da Inêz."}
        </p>

        {mode === null ? (
          <div style={{ color: "var(--muted)", padding: "1rem 0" }}>Carregando…</div>
        ) : (
          <>
            <label style={S.label}>Usuário</label>
            <input style={S.input} value={username} autoFocus autoComplete="username"
              onChange={(e) => setUsername(e.target.value)} placeholder="ex.: inez" />

            <label style={S.label}>Senha</label>
            <input style={S.input} type="password" value={password}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />

            {(mode === "setup" || mode === "register") && (<>
              <label style={S.label}>Confirmar senha</label>
              <input style={S.input} type="password" value={password2}
                autoComplete="new-password"
                onChange={(e) => setPassword2(e.target.value)} placeholder="••••••••" />
            </>)}

            {err && <div style={S.err}>{err}</div>}

            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} type="submit">
              {busy
                ? (mode === "login" ? "Entrando…" : "Cadastrando…")
                : mode === "setup" ? "Criar acesso e entrar"
                : mode === "register" ? "Cadastrar e entrar"
                : "Entrar"}
            </button>

            {mode !== "setup" && (
              <button type="button" style={S.linkBtn}
                onClick={() => {
                  setErr(""); setPassword(""); setPassword2("");
                  setMode(mode === "register" ? "login" : "register");
                }}>
                {mode === "register"
                  ? "Já tem acesso? Entrar"
                  : "Não tem acesso? Cadastrar"}
              </button>
            )}
          </>
        )}
      </form>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg,var(--cream),var(--offwhite))", padding: "1.5rem" },
  card: { width: "min(400px,100%)", background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "2.2rem", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column" },
  logo: { height: 56, width: "auto", margin: "0 auto 1.1rem", display: "block" },
  title: { fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: "1.6rem", color: "var(--green-deep)", textAlign: "center", margin: 0 },
  sub: { color: "var(--muted)", fontSize: ".9rem", textAlign: "center", margin: ".5rem 0 1.5rem" },
  label: { fontSize: ".82rem", fontWeight: 700, color: "var(--brown)", margin: ".7rem 0 .35rem" },
  input: { padding: ".65rem .8rem", borderRadius: "10px", border: "1px solid var(--line)", fontSize: "1rem", outline: "none", background: "#fff", color: "var(--ink)" },
  err: { background: "rgba(194,84,63,.1)", color: "var(--danger)", fontSize: ".85rem", padding: ".6rem .8rem", borderRadius: "10px", marginTop: ".9rem" },
  btn: { marginTop: "1.4rem", padding: ".8rem 1.1rem", borderRadius: "10px", border: "none", background: "var(--green-deep)", color: "#fff", fontWeight: 700, fontSize: ".95rem", cursor: "pointer", transition: ".15s" },
  linkBtn: { marginTop: "1rem", padding: ".4rem", background: "none", border: "none", color: "var(--green-deep)", fontWeight: 600, fontSize: ".85rem", cursor: "pointer", textAlign: "center" },
};
