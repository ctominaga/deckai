import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve("apps/web"),
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8788", "/health": "http://127.0.0.1:8788" } },
  build: { outDir: path.resolve("dist-app"), emptyOutDir: true }
});
