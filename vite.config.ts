import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and doesn't want vite to clear the console.
//
// EMPYREAN'S PORT SET (project-unique, keep in sync):
//   28149 — vite dev server (this file, tauri.conf.json devUrl, ws.ts).
//           Tauri's default 1420 collides with every other Tauri project
//           running dev on this machine; 28149 was rolled randomly for us.
//    9520 — the backend (HTTP + WS), dev and production alike. Established in
//           released binaries, saved configs, and QR join links — don't move.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 28149,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "chrome120",
    sourcemap: true,
  },
});
