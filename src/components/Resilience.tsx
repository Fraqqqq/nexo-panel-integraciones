import { Component, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useOnline, useTick } from "../lib/status";
import { ago } from "../lib/format";

/** Si el 3D falla (shader, driver, contexto perdido), la página sigue funcionando con un orbe en CSS. */
export class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[NEXO] 3D desactivado:", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const OrbFallback = () => (
  <div className="orb-fallback" aria-hidden="true">
    <span />
  </div>
);

export function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

type BannerProps = { failing: string[]; lastOk?: number };

/** Aviso flotante: sin conexión, o alguna API caída mostrando el último dato válido. */
export function StatusBanner({ failing, lastOk }: BannerProps) {
  const online = useOnline();
  useTick();
  const msg = !online
    ? `Sin conexión · mostrando datos de ${ago(lastOk)}`
    : failing.length
      ? `${failing.join(" y ")} no ${failing.length > 1 ? "responden" : "responde"} · último dato ${ago(lastOk)} · reintentando`
      : null;
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          className={`banner ${online ? "warn" : "off"}`}
          role="status"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          <span className="dot" /> {msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
