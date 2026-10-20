import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { toast } from "./toast.jsx";
import { api, setSession, getToken } from "./api.js";
import { setUnitOrder } from "./helpers.js";

const StoreContext = createContext(null);

// De quanto em quanto tempo o painel se atualiza sozinho (polling).
const REFRESH_MS = 25000;

export function StoreProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const inFlight = useRef(false); // evita buscas sobrepostas

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const state = await api.getState();
      if (state.access) setSession(state.access);
      if (state.meta && state.meta.units) setUnitOrder(state.meta.units);
      setData(state);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e) {
      if (e.status === 401) setData(null);
      setError(e.message);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  // Carga inicial
  useEffect(() => { if (getToken()) reload(); }, [reload]);

  // Polling automático — pausa quando a aba está em segundo plano e busca
  // na hora quando ela volta ao foco (economiza requisições e bateria).
  useEffect(() => {
    let timer = null;
    const start = () => { stop(); timer = setInterval(() => { if (!document.hidden && getToken()) reload(); }, REFRESH_MS); };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const onVisible = () => { if (!document.hidden) { if (getToken()) reload(); start(); } else stop(); };
    start();
    document.addEventListener("visibilitychange", onVisible);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisible); };
  }, [reload]);

  // executa uma ação na API e recarrega o estado; mostra alerta em caso de erro
  const run = useCallback(
    async (promise) => {
      try {
        const r = await promise;
        await reload();
        return r;
      } catch (e) {
        toast(e.message || "Ocorreu um erro.", "error");
        throw e;
      }
    },
    [reload]
  );

  return (
    <StoreContext.Provider value={{ data, error, reload, run, refreshing, lastUpdated }}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
