import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
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

/* ============================================================
   <Select> — seletor próprio, substitui o <select> nativo.

   Motivo: a lista aberta de um <select> nativo é desenhada pelo
   sistema operacional e não aceita CSS. Este componente desenha
   tudo, então segue a paleta do Fios que Curam.

   options: [{ value, label, hint, icon, dot, meta, disabled }]
   defaultOption: { label, icon }  -> item destacado no topo, value ""
   grid: lista de números em grade (ex.: dia de vencimento)
   searchable: campo de busca (automático acima de 10 opções)
   compact: altura menor, para barras de filtro
   ============================================================ */

const ChevIcon = () => (
  <svg className="fsel-chev" viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 7.5 10 12.5 15 7.5" />
  </svg>
);
const CheckIcon = () => (
  <svg className="o-check" viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10.5 8 14.5 16 6" />
  </svg>
);
const SearchIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2"
       strokeLinecap="round" aria-hidden="true">
    <circle cx="9" cy="9" r="5.5" /><path d="M13.2 13.2 17 17" />
  </svg>
);

const same = (a, b) => String(a ?? "") === String(b ?? "");

export function Select({
  value, onChange, options = [], placeholder = "Selecione",
  defaultOption, grid = false, searchable, compact = false,
  disabled = false, id, name,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);

  const rootRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);

  const useSearch = searchable ?? (options.length > 10 && !grid);

  const visible = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) =>
      `${o.label ?? ""} ${o.hint ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  const selected = options.find((o) => same(o.value, value));
  const isDefault = defaultOption && (value === "" || value == null);

  /* posiciona o popup (portal, para não ser cortado pelo overflow do modal) */
  const place = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const popH = popRef.current?.offsetHeight ?? 300;
    const below = window.innerHeight - r.bottom;
    const up = below < popH + 14 && r.top > below;
    setPos({
      left: r.left,
      width: r.width,
      top: up ? undefined : r.bottom + 6,
      bottom: up ? window.innerHeight - r.top + 6 : undefined,
      up,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && useSearch) searchRef.current?.focus();
  }, [open, useSearch]);

  /* mantém a opção ativa visível ao navegar pelo teclado */
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector(".fsel-opt.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openPop() {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => same(o.value, value))));
    setOpen(true);
  }

  function pick(o) {
    if (o?.disabled) return;
    setOpen(false);
    onChange && onChange(o ? o.value : "");
  }

  function onKey(e) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault(); openPop();
      }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); rootRef.current?.querySelector("button")?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(visible.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(visible.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (visible[active]) pick(visible[active]); }
    else if (e.key === "Tab") setOpen(false);
  }

  /* no modo grade a célula mostra só o número, mas o campo fechado
     precisa da frase inteira — daí o triggerLabel opcional */
  const triggerLabel = isDefault
    ? (defaultOption.label ?? placeholder)
    : (selected?.triggerLabel ?? selected?.label ?? placeholder);
  const empty = !selected && !isDefault;

  const pop = open && pos && createPortal(
    <div
      ref={popRef}
      className={`fsel-pop${pos.up ? " up" : ""}`}
      role="listbox"
      style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
      onKeyDown={onKey}
    >
      {useSearch && (
        <div className="fsel-search">
          <SearchIcon />
          <input
            ref={searchRef}
            value={query}
            placeholder="Buscar..."
            autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          />
        </div>
      )}

      {defaultOption && (
        <button
          type="button"
          className={`fsel-default${isDefault ? " selected" : ""}`}
          onClick={() => pick(null)}
        >
          <span className="o-ic">{defaultOption.icon ?? "⚙️"}</span>
          <span>{defaultOption.label}</span>
        </button>
      )}

      <div className={grid ? "fsel-grid" : "fsel-list"}>
        {visible.length === 0 && <div className="fsel-empty">Nada encontrado</div>}
        {visible.map((o, i) => {
          const sel = same(o.value, value) && !isDefault;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={sel}
              disabled={o.disabled}
              className={`fsel-opt${sel ? " selected" : ""}${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.dot
                ? <span className="o-dot" style={{ background: o.dot }} />
                : o.icon ? <span className="o-ic">{o.icon}</span> : null}
              <span className="o-body">
                <span className="o-label">{o.label}</span>
                {o.hint && <span className="o-hint">{o.hint}</span>}
              </span>
              {o.meta && <span className="o-meta">{o.meta}</span>}
              <CheckIcon />
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );

  return (
    <div className={`fsel${open ? " open" : ""}${compact ? " fsel-compact" : ""}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        className={`fsel-trigger${empty ? " is-placeholder" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPop())}
        onKeyDown={onKey}
      >
        {!isDefault && selected?.dot
          ? <span className="t-dot" style={{ background: selected.dot }} />
          : (isDefault ? defaultOption.icon : selected?.icon)
            ? <span className="t-ic">{isDefault ? defaultOption.icon : selected.icon}</span>
            : null}
        <span className="t-txt">{triggerLabel}</span>
        {!isDefault && selected?.meta && <span className="t-meta">{selected.meta}</span>}
        <ChevIcon />
      </button>
      {pop}
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
