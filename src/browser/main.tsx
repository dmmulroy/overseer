import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./shell/app-shell.tsx";
import { ThemeProvider } from "../ui/theme-provider.tsx";
import "../ui/theme.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Overseer root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  </StrictMode>,
);
