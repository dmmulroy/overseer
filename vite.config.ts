import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Build the browser shell with React and Tailwind CSS. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
