import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { toast } from "./toast.jsx";

export function ExportarAlunosLeadsExcel({ className, disabled, title, children }) {
  const [gerando, setGerando] = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const pedido = useRef(null);

  useEffect(() => () => pedido.current?.abort(), []);
  useEffect(() => {
    if (!arquivo) return;
    const expirar = setTimeout(() => setArquivo(null), 60_000);
    return () => {
      clearTimeout(expirar);
      // O Safari pode ler o arquivo depois do clique, inclusive ao sair da tela.
      setTimeout(() => URL.revokeObjectURL(arquivo.url), 60_000);
    };
  }, [arquivo]);

  async function preparar() {
    if (pedido.current) return;
    const controller = new AbortController();
    pedido.current = controller;
    setGerando(true);
    try {
      const { blob, nome } = await api.prepararAlunosLeadsExcel(controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      setArquivo({ url, nome });
      // Se a rede demorar, o link continua disponível para um novo toque.
      if (navigator.userActivation?.isActive) {
        const link = document.createElement("a");
        link.href = url;
        link.download = nome;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (error) {
      if (!controller.signal.aborted) toast(`Não foi possível baixar o Excel: ${error.message}`, "error");
    } finally {
      pedido.current = null;
      if (!controller.signal.aborted) setGerando(false);
    }
  }

  if (arquivo && !disabled) return (
    <a className={className} href={arquivo.url} download={arquivo.nome} title={title} style={{ textDecoration: "none" }}>
      ⬇ Baixar Excel (.xlsx)
    </a>
  );

  return (
    <button className={className} type="button" disabled={disabled || gerando} onClick={preparar} title={title}>
      {gerando ? "⏳ Gerando Excel…" : children}
    </button>
  );
}
