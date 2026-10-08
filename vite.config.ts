import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// CSP estricta solo en producción (en dev Vite necesita scripts inline para el HMR).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://dolarapi.com https://api.argentinadatos.com https://api.telegram.org",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const security = (): Plugin => ({
  name: "nexo-security-headers",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    { tag: "meta", attrs: { name: "referrer", content: "no-referrer" }, injectTo: "head-prepend" },
  ],
});

export default defineConfig({
  plugins: [react(), security()],
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/framer-motion") || id.includes("node_modules/motion")) return "motion";
        },
      },
    },
  },
});
