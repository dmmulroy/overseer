import React from "react";
import ReactDOM from "react-dom/client";

import { PrototypeApp } from "@/prototype-app";
import { ThemeProvider } from "@/ui/theme-provider";
import "@/ui/theme.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Missing #root application mount");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <PrototypeApp />
    </ThemeProvider>
  </React.StrictMode>,
);
