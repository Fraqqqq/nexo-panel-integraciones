import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// CSP estricta solo en producción (en dev Vite necesita scripts inline para el HMR).
// El navegador ya no habla con Telegram: las alertas corren en GitHub Actions.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org https://flagcdn.com",
  [
    "connect-src 'self'",
    "https://api.open-meteo.com https://geocoding-api.open-meteo.com https://air-quality-api.open-meteo.com",
    "https://dolarapi.com https://api.frankfurter.dev https://api.worldbank.org",
    "https://es.wikipedia.org https://date.nager.at https://earthquake.usgs.gov https://api.github.com",
  ].join(" "),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const security = (): Plugin => ({
  name: "nexo-security-headers",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    { tag: "meta", attrs: { name: "referrer", content: "strict-origin-when-cross-origin" }, injectTo: "head-prepend" },
  ],
});

export default defineConfig({
  plugins: [react(), security()],
  base: "./",
  define: {
    __BUILD__: JSON.stringify({
      sha: (process.env.GITHUB_SHA ?? "local").slice(0, 7),
      date: new Date().toISOString(),
    }),
  },
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
