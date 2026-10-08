import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

export function Counter({ value, format }: { value: number; format: (n: number) => string }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const [text, setText] = useState(() => format(value));
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => mv.on("change", (v) => setText(fmt.current(v))), [mv]);
  useEffect(() => {
    if (reduced) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 1.4, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, reduced, mv]);

  return <span className="num">{text}</span>;
}

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 36, filter: "blur(10px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Tarjeta de vidrio: inclinación 3D + luz que sigue al cursor. */
export function Glass({ children, className = "", tilt = 6 }: { children: ReactNode; className?: string; tilt?: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 160, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 160, damping: 18 });

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
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
    <motion.div
      ref={ref}
      className={`glass ${className}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
    >
      {children}
    </motion.div>
  );
}

/** Curva suave con relleno degradado que se "dibuja" al entrar en pantalla. */
export function Spark({
  values,
  color = "var(--accent)",
  height = 64,
  className,
}: {
  values: number[];
  color?: string;
  height?: number;
  className?: string;
}) {
  const id = useId();
  const W = 300;
  const { line, area } = useMemo(() => {
    if (values.length < 2) return { line: "", area: "" };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 6;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * W, height - pad - ((v - min) / span) * (height - pad * 2)] as const);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    return { line: d, area: `${d} L${W},${height} L0,${height} Z` };
  }, [values, height]);

  if (!line) return <div className={className} style={{ height }} />;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height, width: "100%", overflow: "visible" } as CSSProperties} role="img" aria-label="Gráfico de evolución">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".38" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path d={area} fill={`url(#${id})`} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.4 }} />
      <motion.path
        d={line}
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
  );
}

/** Luz que persigue al cursor (solo con mouse). */
export function CursorGlow() {
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const sx = useSpring(x, { stiffness: 120, damping: 20, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 120, damping: 20, mass: 0.6 });
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [x, y]);
  const tx = useTransform(sx, (v) => v - 260);
  const ty = useTransform(sy, (v) => v - 260);
  return <motion.div className="cursor-glow" style={{ x: tx, y: ty }} aria-hidden="true" />;
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
