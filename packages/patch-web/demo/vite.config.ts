import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  server: { port: 28150, strictPort: true },
  build: { target: "es2022" },
});
