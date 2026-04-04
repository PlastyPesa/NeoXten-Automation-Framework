import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

/** Playwright dashboard e2e sets this so preview proxies to the same port as `operator serve`. */
const operatorApiPort = process.env.NEOXTEN_OPERATOR_API_PORT?.trim() || "8787";
const operatorHttpTarget = `http://127.0.0.1:${operatorApiPort}`;
const operatorWsTarget = `ws://127.0.0.1:${operatorApiPort}`;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    proxy: {
      "/api": { target: operatorHttpTarget, changeOrigin: true },
      "/ws": { target: operatorWsTarget, ws: true },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": { target: operatorHttpTarget, changeOrigin: true },
      "/ws": { target: operatorWsTarget, ws: true },
    },
  },
}));
