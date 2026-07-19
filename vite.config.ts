import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { makePrototypeServer } from "./src/prototype-server";

/** Vite configuration for the throwaway browser specimen and controllable REST server. */
export default defineConfig({
  plugins: [
    react(),
    {
      name: "overseer-prototype-server",
      configureServer(server) {
        server.middlewares.use(makePrototypeServer());
      },
    },
  ],
});
