import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

export function Counter({ value, format }: { value: number; format: (n: number) => string }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const el = useRef<HTMLSpanElement>(null);
  const [initial] = useState(() => format(value));
  const fmt = useRef(format);
  useEffect(() => {
    fmt.current = format;
  });

  // El texto se escribe directo en el nodo: cero re-renders de React durante la animación.
  useEffect(
    () =>
      mv.on("change", (v) => {
        if (el.current) el.current.textContent = fmt.current(v);
      }),
    [mv],
  );
  useEffect(() => {
    if (reduced) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 1.4, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, reduced, mv]);

  return (
    <span ref={el} className="num">
      {initial}
    </span>
  );
}

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Texto que se "decodifica" carácter por carácter al entrar en pantalla. */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/";
export function Scramble({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const [out, setOut] = useState(text);

  useEffect(() => {
    if (!inView || reduced) return;
    let frame = 0;
    const total = 24;
    const id = setInterval(() => {
      frame++;
      const revealed = Math.floor((frame / total) * text.length);
      setOut(
        [...text].map((c, i) => (i < revealed || c === " " || c === "—" ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(""),
      );
      if (frame >= total) {
        clearInterval(id);
        setOut(text);
      }
    }, 30);
    return () => clearInterval(id);
  }, [inView, reduced, text]);

  return (
    <span ref={ref} className={className} aria-label={text}>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}

/** Tarjeta de vidrio: inclinación 3D + luz que sigue al cursor. */
export function Glass({ children, className = "", tilt = 6 }: { children?: ReactNode; className?: string; tilt?: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(0, { stiffness: 160, damping: 18 });
  const ry = useSpring(0, { stiffness: 160, damping: 18 });

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    if (!reduced) {
      ry.set((x - 0.5) * tilt * 2);
      rx.set((0.5 - y) * tilt * 2);
    }
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.div ref={ref} className={`glass ${className}`} onPointerMove={onMove} onPointerLeave={onLeave} style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}>
      {children}
    </motion.div>
  );
}

/** Envuelve un control para que "atraiga" al cursor. */
export function Magnetic({ children, strength = 0.3 }: { children: ReactNode; strength?: number }) {
  const reduced = useReducedMotion();
  const x = useSpring(0, { stiffness: 220, damping: 14, mass: 0.4 });
  const y = useSpring(0, { stiffness: 220, damping: 14, mass: 0.4 });
  return (
    <motion.span
      className="magnetic"
      style={{ x, y }}
      onPointerMove={(e) => {
        if (reduced || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}

type ChartProps = {
  values: number[];
  labels: string[];
  format: (n: number) => string;
  label: string;
  color?: string;
  height?: number;
  /** Barras de fondo 0–100 (p. ej. probabilidad de lluvia). */
  bars?: number[];
  barFormat?: (n: number) => string;
};

/** Curva suave con relleno, que se dibuja al aparecer y muestra un tooltip con mouse o flechas del teclado. */
export function Chart({ values, labels, format, label, color = "var(--accent)", height = 96, bars, barFormat }: ChartProps) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const n = values.length;

  const geo = useMemo(() => {
    if (n < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 8;
    const pts = values.map((v, i) => [(i / (n - 1)) * W, height - pad - ((v - min) / span) * (height - pad * 2)] as const);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    return { pts, line: d, area: `${d} L${W},${height} L0,${height} Z` };
  }, [values, n, height]);

  if (!geo) return <div className="chart-empty" style={{ height }} />;

  const pick = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setHover(Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (n - 1)));
  };
  const hx = hover !== null ? (hover / (n - 1)) * 100 : 0;
  const hy = hover !== null ? (geo.pts[hover][1] / height) * 100 : 0;

  return (
    <div
      className="chart-wrap"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={`${label}. Desde ${format(values[0])} hasta ${format(values[n - 1])}; mínimo ${format(Math.min(...values))}, máximo ${format(Math.max(...values))}.`}
      onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
      onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
        else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
        else return;
        e.preventDefault();
      }}
    >
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".38" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {bars?.map((b, i) => {
          const bw = W / bars.length;
          const bh = (Math.max(0, Math.min(100, b)) / 100) * height * 0.45;
          return <rect key={i} x={i * bw + bw * 0.2} y={height - bh} width={bw * 0.6} height={bh} rx={1.5} className="chart-bar" />;
        })}
        <motion.path d={geo.area} fill={`url(#${id})`} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.4 }} />
        <motion.path
          d={geo.line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      {hover !== null && (
        <>
          <span className="chart-rule" style={{ left: `${hx}%` }} />
          <span className="chart-dot" style={{ left: `${hx}%`, top: `${hy}%`, background: color }} />
          <span className={`chart-tip ${hx > 70 ? "left" : ""}`} style={{ left: `${hx}%` }}>
            <b>{format(values[hover])}</b>
            <span>
              {labels[hover]}
              {bars && barFormat ? ` · ${barFormat(bars[hover])}` : ""}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

/** Cursor propio: halo de luz + anillo que reacciona a elementos interactivos. Solo con mouse. */
export function Cursor() {
  const reduced = useReducedMotion();
  const [fine] = useState(() => window.matchMedia("(pointer: fine)").matches);
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const rx = useSpring(x, { stiffness: 500, damping: 40, mass: 0.4 });
  const ry = useSpring(y, { stiffness: 500, damping: 40, mass: 0.4 });
  const gx = useSpring(x, { stiffness: 120, damping: 20, mass: 0.6 });
  const gy = useSpring(y, { stiffness: 120, damping: 20, mass: 0.6 });
  const glowX = useTransform(gx, (v) => v - 260);
  const glowY = useTransform(gy, (v) => v - 260);
  const [mode, setMode] = useState<{ hover: boolean; label?: string; down: boolean }>({ hover: false, down: false });

  useEffect(() => {
    if (!fine) return;
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>("a, button, input, select, [data-cursor], .chart-wrap, .glabel");
      setMode((m) => ({ ...m, hover: !!el, label: el?.dataset.cursor }));
    };
    const down = () => setMode((m) => ({ ...m, down: true }));
    const up = () => setMode((m) => ({ ...m, down: false }));
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerover", over, { passive: true });
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, [fine, x, y]);

  if (!fine) return null;
  return (
    <>
      <motion.div className="cursor-glow" style={{ x: glowX, y: glowY }} aria-hidden="true" />
      {!reduced && (
        <motion.div className={`cursor-ring ${mode.hover ? "is-hover" : ""} ${mode.label ? "has-label" : ""}`} style={{ x: rx, y: ry }} aria-hidden="true">
          <motion.span className="ring" animate={{ scale: mode.down ? 0.75 : mode.hover ? (mode.label ? 2.6 : 1.7) : 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} />
          {mode.label && <span className="ring-label">{mode.label}</span>}
        </motion.div>
      )}
    </>
  );
}

export function ScrollBar() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => setP(window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight));
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return <div className="scrollbar" style={{ transform: `scaleX(${p})` }} aria-hidden="true" />;
}
