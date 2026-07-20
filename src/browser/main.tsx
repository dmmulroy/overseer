import { StrictMode } from "react";
import { RegistryProvider } from "@effect/atom-react";
import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { router } from "./route-tree.tsx";
import { ThemeProvider } from "../ui/theme-provider.tsx";
import "../ui/theme.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Overseer root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <RegistryProvider defaultIdleTTL={5 * 60 * 1_000}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </RegistryProvider>
  </StrictMode>,
);
