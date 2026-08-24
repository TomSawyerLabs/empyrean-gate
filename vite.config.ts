import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const uprisingDir = process.env.EMPYREAN_UPRISING_DIR
  ? resolve(process.env.EMPYREAN_UPRISING_DIR)
  : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "empyrean-gate", "uprising");

function uprisingArchive() {
  return {
    name: "empyrean-uprising-archive",
    configureServer(server: { middlewares: { use: (handler: (req: { url?: string }, res: {
      statusCode: number;
      setHeader: (name: string, value: string) => void;
      end: (body?: string) => void;
    }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (url.pathname === "/__empyrean/uprising") {
          const fixtures = existsSync(uprisingDir)
            ? readdirSync(uprisingDir)
                .filter((name) => name.toLowerCase().endsWith(".eg.data"))
                .sort((a, b) => a.localeCompare(b))
                .map((name) => ({
                  name,
                  size: statSync(join(uprisingDir, name)).size,
                  url: `/__empyrean/uprising/${encodeURIComponent(name)}`,
                }))
            : [];
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ directory: uprisingDir, fixtures }));
          return;
        }
        if (url.pathname.startsWith("/__empyrean/uprising/")) {
          const name = basename(decodeURIComponent(url.pathname.slice("/__empyrean/uprising/".length)));
          const file = join(uprisingDir, name);
          if (!name.toLowerCase().endsWith(".eg.data") || !existsSync(file)) {
            res.statusCode = 404;
            res.end("Archive not found");
            return;
          }
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Length", String(statSync(file).size));
          createReadStream(file).pipe(res as never);
          return;
        }
        next();
      });
    },
  };
}

// Tauri expects a fixed dev port and doesn't want vite to clear the console.
//
// EMPYREAN'S PORT SET (project-unique, keep in sync):
//   28149 — vite dev server (this file, tauri.conf.json devUrl, ws.ts).
//           Tauri's default 1420 collides with every other Tauri project
//           running dev on this machine; 28149 was rolled randomly for us.
//    9520 — the backend (HTTP + WS), dev and production alike. Established in
//           released binaries, saved configs, and QR join links — don't move.
export default defineConfig({
  plugins: [react(), uprisingArchive()],
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
    // Not Chromium alone. The desktop app is WebView2, but the SAME bundle is
    // served over the LAN to iPads and phones — QR join, "Add to Home Screen",
    // remote mic — so WebKit is a first-class target, not an afterthought.
    // Naming Safari here is what makes esbuild downlevel syntax and keep CSS it
    // would otherwise assume Chromium could handle.
    //
    // safari16 = iPadOS 16 (Sept 2022), which is also the floor for container
    // queries. Anything older falls back rather than breaking; see the
    // `@container live-cluster` note in styles.css.
    target: ["chrome120", "safari16"],
    sourcemap: true,
  },
});
