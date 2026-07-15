import { useState, useEffect } from "react";
import { api, setToken } from "./api.js";

// Tela de acesso ao painel administrativo (usuário + senha).
// Se ainda não existe nenhum admin, mostra "criar primeiro acesso".
export default function AdminLogin() {
  const [mode, setMode] = useState(null); // "login" | "setup" | null(carregando)
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
    if (u.length < 3) return setErr("Usuário deve ter ao menos 3 caracteres.");
    if (password.length < 6) return setErr("Senha deve ter ao menos 6 caracteres.");
    if (mode === "setup" && password !== password2) return setErr("As senhas não conferem.");
    setBusy(true);
    try {
      const r = mode === "setup"
        ? await api.admin.setup(u, password)
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
            : "Acesso restrito à equipe da Inêz."}
        </p>

        {mode === null ? (
          <div style={{ color: "#857A6B", padding: "1rem 0" }}>Carregando…</div>
        ) : (
          <>
            <label style={S.label}>Usuário</label>
            <input style={S.input} value={username} autoFocus autoComplete="username"
              onChange={(e) => setUsername(e.target.value)} placeholder="ex.: inez" />

            <label style={S.label}>Senha</label>
            <input style={S.input} type="password" value={password}
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />

            {mode === "setup" && (<>
              <label style={S.label}>Confirmar senha</label>
              <input style={S.input} type="password" value={password2}
                autoComplete="new-password"
                onChange={(e) => setPassword2(e.target.value)} placeholder="••••••••" />
            </>)}

            {err && <div style={S.err}>{err}</div>}

            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} type="submit">
              {busy ? "Entrando…" : mode === "setup" ? "Criar acesso e entrar" : "Entrar"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg,#F4ECDF,#FBF8F2)", padding: "1.5rem" },
  card: { width: "min(400px,100%)", background: "#fff", border: "1px solid rgba(44,38,32,.12)", borderRadius: "18px", padding: "2.2rem", boxShadow: "0 30px 60px -30px rgba(44,38,32,.35)", display: "flex", flexDirection: "column" },
  logo: { height: 56, width: "auto", margin: "0 auto 1.1rem", display: "block" },
  title: { fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: "1.6rem", color: "#1C5E33", textAlign: "center", margin: 0 },
  sub: { color: "#857A6B", fontSize: ".9rem", textAlign: "center", margin: ".5rem 0 1.5rem" },
  label: { fontSize: ".78rem", fontWeight: 600, color: "#5E4A38", margin: ".7rem 0 .3rem" },
  input: { padding: ".8rem 1rem", borderRadius: "10px", border: "1px solid rgba(44,38,32,.18)", fontSize: "1rem", outline: "none" },
  err: { background: "#fdecec", color: "#b3261e", fontSize: ".85rem", padding: ".6rem .8rem", borderRadius: "8px", marginTop: ".9rem" },
  btn: { marginTop: "1.4rem", padding: ".9rem", borderRadius: "999px", border: "none", background: "#1C5E33", color: "#fff", fontWeight: 600, fontSize: ".95rem", cursor: "pointer" },
};
