import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { StoreProvider } from "./store.jsx";
import { ModalProvider } from "./ui.jsx";
import { ToastHost } from "./toast.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StoreProvider>
      <ModalProvider>
        <App />
        <ToastHost />
      </ModalProvider>
    </StoreProvider>
  </React.StrictMode>
);
