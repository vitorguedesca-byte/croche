import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { toast } from "./toast.jsx";
import { api } from "./api.js";
import { setUnitOrder } from "./helpers.js";

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const state = await api.getState();
      if (state.meta && state.meta.units) setUnitOrder(state.meta.units);
      setData(state);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    reload();
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
    <StoreContext.Provider value={{ data, error, reload, run }}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
