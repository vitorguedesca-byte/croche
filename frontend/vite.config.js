import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em desenvolvimento, /api é redirecionado para o backend Express (porta 4000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:4000",
      "/depoimentos": "http://localhost:4000",
    },
  },
});
