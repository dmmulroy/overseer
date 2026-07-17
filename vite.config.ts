import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [foldkit()],
  server: {
    host: "127.0.0.1",
    port: 4183,
    strictPort: true,
  },
});
