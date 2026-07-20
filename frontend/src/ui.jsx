import { createContext, useContext, useState, useCallback } from "react";
import { STATUS } from "./helpers.js";

/* ---------- Modal global ---------- */
const ModalContext = createContext(null);

export function ModalProvider({ children }) {
  const [node, setNode] = useState(null);
  const open = useCallback((el) => setNode(el), []);
  const close = useCallback(() => setNode(null), []);
  return (
    <ModalContext.Provider value={{ open, close }}>
      {children}
      {node && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          {node}
        </div>
      )}
    </ModalContext.Provider>
  );
}
export const useModal = () => useContext(ModalContext);

/* Estrutura visual padrão de um modal */
export function Modal({ title, children, footer, size, subheader }) {
  const { close } = useModal();
  return (
    <div className={`modal${size ? " modal-" + size : ""}`} onClick={(e) => e.stopPropagation()}>
      <div className="modal-h">
        <h3>{title}</h3>
        <button onClick={close}>×</button>
      </div>
      {subheader && <div className="modal-sub">{subheader}</div>}
      <div className="modal-b">{children}</div>
      {footer && <div className="modal-f">{footer}</div>}
    </div>
  );
}

export function StatusBadge({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  return (
    <span className={`badge ${s.badge}`}>
      <span className="dot" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}
