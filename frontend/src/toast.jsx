import { useState, useEffect, useCallback, useRef } from "react";

/* ================================================================
   Toast + diálogo de confirmação no padrão visual do sistema.
   Substituem os alert()/confirm() nativos do navegador.

   Uso imperativo (fora de componentes também):
     import { toast, confirmModal } from "./toast.jsx";
     toast("Salvo com sucesso");                 // sucesso (💚)
     toast("Algo deu errado", "error");          // erro   (⚠️)
     toast("Dica", "info");                       // info   (💬)
     if (await confirmModal({ title, message, confirmLabel, tone: "danger" })) { ... }
   Com `altLabel`, mostra um terceiro botão que resolve a promise com "alt"
   (ex.: excluir "todos" vs "só este").

   promptModal({ title, message, label }) mostra o mesmo diálogo com um campo
   de texto: resolve com o texto digitado (string, possivelmente vazia) ou
   com null se a pessoa cancelar.

   Basta montar <ToastHost /> uma vez na raiz do app (ver main.jsx).
================================================================ */

let _push = null; // registrado pelo ToastHost montado
let _ask = null;

export function toast(message, type = "success", opts = {}) {
  if (_push) _push({ message, type, ...opts });
  else console.log(`[toast:${type}]`, message);
}
toast.error = (m, o) => toast(m, "error", o);
toast.info = (m, o) => toast(m, "info", o);

export function confirmModal(opts) {
  const o = typeof opts === "string" ? { message: opts } : (opts || {});
  if (_ask) return _ask(o);
  // fallback caso o host ainda não esteja montado
  return Promise.resolve(window.confirm(o.message || "Confirmar?"));
}

// Confirmação com campo de texto. Resolve com a string digitada ou null se cancelar.
export function promptModal(opts) {
  const o = { ...(opts || {}), prompt: true };
  if (_ask) return _ask(o);
  return Promise.resolve(window.prompt(o.message || "", "")); // fallback
}

const iconFor = (t) => (t === "error" ? "⚠️" : t === "info" ? "💬" : "💚");

export function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [promptText, setPromptText] = useState("");
  const idRef = useRef(0);

  const push = useCallback((t) => {
    const id = ++idRef.current;
    setToasts((l) => [...l, { id, ...t }]);
    const ttl = t.duration ?? (t.type === "error" ? 6000 : 4200);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), ttl);
  }, []);

  const ask = useCallback(
    (o) => new Promise((resolve) => { setPromptText(""); setDialog({ ...o, resolve }); }),
    []
  );

  useEffect(() => {
    _push = push;
    _ask = ask;
    return () => { _push = null; _ask = null; };
  }, [push, ask]);

  const dismiss = (id) => setToasts((l) => l.filter((x) => x.id !== id));
  const closeDialog = (val) =>
    setDialog((d) => { if (d) d.resolve(val); return null; });

  useEffect(() => {
    if (!dialog) return;
    const onEsc = (e) => { if (e.key === "Escape") closeDialog(dialog.prompt ? null : false); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [dialog]);

  return (
    <>
      <div className="toast-host">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}`}
            role="status"
            onClick={() => dismiss(t.id)}
            title="Dispensar"
          >
            <span className="toast-ic">{iconFor(t.type)}</span>
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>

      {dialog && (
        <div
          // overlay-top: o modal global é montado depois deste no DOM e usa o
          // mesmo z-index, então sem isto a confirmação fica atrás dele.
          className="overlay overlay-top"
          onClick={(e) => { if (e.target === e.currentTarget) closeDialog(dialog.prompt ? null : false); }}
        >
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <h3>{dialog.title || "Confirmar"}</h3>
              <button onClick={() => closeDialog(dialog.prompt ? null : false)} aria-label="Fechar">×</button>
            </div>
            <div className="modal-b">
              <p className="confirm-msg">{dialog.message}</p>
              {dialog.prompt && (
                <div className="field" style={{ marginTop: ".9rem" }}>
                  {dialog.label && <label>{dialog.label}</label>}
                  <textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    placeholder={dialog.placeholder || ""}
                    rows={3}
                    autoFocus
                  />
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className="btn ghost" onClick={() => closeDialog(dialog.prompt ? null : false)}>
                {dialog.cancelLabel || "Cancelar"}
              </button>
              {dialog.altLabel && (
                <button className="btn sec" onClick={() => closeDialog("alt")}>
                  {dialog.altLabel}
                </button>
              )}
              <button
                className={`btn ${dialog.tone === "danger" ? "danger" : ""}`}
                onClick={() => closeDialog(dialog.prompt ? promptText : true)}
                autoFocus={!dialog.prompt}
              >
                {dialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
