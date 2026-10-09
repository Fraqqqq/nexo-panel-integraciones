import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useStatus, type Source } from "../lib/status";

const LINES: Array<{ src: Source; name: string; host: string }> = [
  { src: "meteo", name: "Open-Meteo", host: "api.open-meteo.com" },
  { src: "dolar", name: "DolarAPI", host: "dolarapi.com" },
  { src: "quakes", name: "USGS", host: "earthquake.usgs.gov" },
];

/** Pantalla de arranque: muestra las conexiones reales a cada API (con latencia) mientras carga. */
export function Preloader({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const status = useStatus();
  const [pct, setPct] = useState(0);

  // Mientras carga, avanza hacia 90 %; al estar listo salta a 100 y sale.
  // La salida no depende del intervalo (el navegador lo frena si la ventana no tiene foco).
  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => setPct((p) => Math.min(90, p + Math.max(0.5, (90 - p) * 0.06))), 30);
    return () => clearInterval(id);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    setPct(100);
    const t = setTimeout(onDone, 450);
    return () => clearTimeout(t);
  }, [ready, onDone]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = "";
    };
  }, []);

  return (
    <motion.div
      className="preloader"
      role="status"
      aria-live="polite"
      exit={{ clipPath: "inset(0 0 100% 0)" }}
      transition={{ duration: 0.9, ease: [0.76, 0, 0.24, 1] }}
    >
      <div className="pl-inner">
        <div className="pl-brand">
          {"NEXO".split("").map((c, i) => (
            <motion.span key={i} initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ delay: 0.05 * i, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
              {c}
            </motion.span>
          ))}
        </div>
        <ul className="pl-log">
          {LINES.map((l) => {
            const h = status[l.src];
            const state = !h ? "wait" : h.ok ? "ok" : "bad";
            return (
              <li key={l.src} className={state}>
                <span className="dot" />
                <span>
                  {l.name} <em>{l.host}</em>
                </span>
                <span className="mono">{state === "wait" ? "conectando…" : state === "ok" ? `${h?.ms} ms` : "sin respuesta"}</span>
              </li>
            );
          })}
          <li className={ready ? "ok" : "wait"}>
            <span className="dot" />
            <span>
              Globo 3D <em>19.904 puntos · GLSL</em>
            </span>
            <span className="mono">{ready ? "listo" : "compilando…"}</span>
          </li>
        </ul>
        <div className="pl-bar">
          <span style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <div className="pl-pct mono">{String(Math.floor(pct)).padStart(3, "0")}</div>
      </div>
    </motion.div>
  );
}
