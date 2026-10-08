import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import Lenis from "lenis";
import { describe, precipType, type Dolar } from "./lib/api";
import { useLive } from "./lib/useLive";
import { Alerts } from "./components/Alerts";
import { Counter, CursorGlow, Glass, Reveal, ScrollBar, Spark } from "./components/UI";

const Scene = lazy(() => import("./components/Scene"));

const ORDER = ["blue", "oficial", "bolsa", "contadoconliqui", "cripto", "tarjeta", "mayorista"];
const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const deg = (n: number) => `${n.toFixed(1)}°`;
const int = (n: number) => String(Math.round(n));

/** El color de toda la interfaz sigue a la temperatura de la ciudad. */
function tintFor(t: number | undefined) {
  if (t === undefined) return "#7cf0ff";
  if (t < 5) return "#7fb8ff";
  if (t < 15) return "#6be4ff";
  if (t < 25) return "#7cf0c8";
  if (t < 32) return "#ffc46b";
  return "#ff7a5c";
}

const words = (text: string) =>
  text.split(" ").map((w, i) => (
    <span className="w" key={i}>
      <motion.span initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 1, delay: 0.15 + i * 0.09, ease: [0.22, 1, 0.36, 1] }}>
        {w}&nbsp;
      </motion.span>
    </span>
  ));

export default function App() {
  const live = useLive();
  const reduced = useReducedMotion() ?? false;
  const [city, setCity] = useState("");
  const w = live.weather.data?.forPlace === live.place ? live.weather.data : undefined;
  const tint = tintFor(w?.temp);
  const info = w ? describe(w.code) : null;
  const dolarRef = useRef<HTMLElement>(null);
  const nearDolar = useInView(dolarRef, { once: true, margin: "600px 0px" });
  const { loadHistory } = live;
  useEffect(() => {
    if (nearDolar) void loadHistory();
  }, [nearDolar, loadHistory]);

  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ lerp: 0.09 });
    let id = requestAnimationFrame(function raf(t) {
      lenis.raf(t);
      id = requestAnimationFrame(raf);
    });
    return () => {
      cancelAnimationFrame(id);
      lenis.destroy();
    };
  }, [reduced]);

  const quotes = useMemo(() => {
    const list = live.dolares.data ?? [];
    return [...list].sort((a, b) => ORDER.indexOf(a.casa) - ORDER.indexOf(b.casa)).filter((d) => ORDER.includes(d.casa) && d.venta != null);
  }, [live.dolares.data]);

  const blue = quotes.find((q) => q.casa === "blue");
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (city.trim()) void live.search(city.trim());
  };

  const hourlyMin = w ? Math.min(...w.hourly) : 0;
  const hourlyMax = w ? Math.max(...w.hourly) : 0;

  return (
    <div className="app" style={{ "--accent": tint } as CSSProperties}>
      <div className="blobs" aria-hidden="true">
        <i /> <i /> <i />
      </div>
      <Suspense fallback={null}>
        <Scene lat={live.place.latitude} lon={live.place.longitude} precip={w ? precipType(w.code) : 0} tint={tint} reduced={reduced} />
      </Suspense>
      <div className="grain" aria-hidden="true" />
      <CursorGlow />
      <ScrollBar />

      {quotes.length > 0 && (
        <div className="marquee" aria-label="Cotizaciones del dólar en vivo">
          <div className="track">
            {[0, 1].map((k) => (
              <div className="group" key={k} aria-hidden={k === 1}>
                {quotes.map((q) => (
                  <span key={q.casa}>
                    <b>{q.nombre}</b> {ars(q.venta as number)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <nav className="nav">
        <a className="brand" href="#top">
          <span className="orb" /> NEXO
        </a>
        <div className="links">
          <a href="#clima">Clima</a>
          <a href="#dolar">Dólar</a>
          <a href="#alertas">Alertas</a>
        </div>
      </nav>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <motion.p className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
              <span className="live" /> En vivo · {live.updatedAt ? live.updatedAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "conectando"}
            </motion.p>
            <h1>
              {words("El mundo,")}
              <br />
              <span className="nowrap">{words("en")} <em>{words("tiempo real.")}</em></span>
            </h1>
            <motion.p className="lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.9 }}>
              Dos APIs en vivo, un globo 3D y alertas directo a tu Telegram. Buscá cualquier ciudad y mirá cómo el planeta viaja hacia ella.
            </motion.p>

            <motion.form className="search" onSubmit={onSearch} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05, duration: 0.9 }}>
              <label className="sr" htmlFor="city">
                Ciudad
              </label>
              <input id="city" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} placeholder={`Probá con Tokio, Reykjavik, Dubái… (ahora: ${live.place.city})`} autoComplete="off" />
              <button className="btn" disabled={live.searching}>
                {live.searching ? "Viajando…" : "Ir"}
              </button>
            </motion.form>
            {live.searchError && (
              <p className="err" role="alert">
                {live.searchError}
              </p>
            )}

            <motion.div className="chips" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.9 }}>
              <div className="chip">
                <small>{live.place.city}</small>
                <strong>{w ? <Counter value={w.temp} format={deg} /> : "—"}</strong>
              </div>
              <div className="chip">
                <small>Dólar blue</small>
                <strong>{blue?.venta ? <Counter value={blue.venta} format={ars} /> : "—"}</strong>
              </div>
            </motion.div>
          </div>
          <div className="scroll-hint" aria-hidden="true">
            <span /> Scroll
          </div>
        </section>

        <section id="clima" className="section">
          <Reveal>
            <p className="kicker">01 — Clima</p>
            <h2>
              {live.place.city}
              {live.place.country && <span className="muted-t">, {live.place.country}</span>}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <Glass className="pad weather">
              {live.weather.status === "error" && !w ? (
                <p className="err">No pude cargar el clima: {live.weather.error}</p>
              ) : (
                <>
                  <div className="temp-block">
                    <div className="temp">{w ? <Counter value={w.temp} format={int} /> : "··"}<sup>°C</sup></div>
                    <p className="cond">
                      <span className="emoji">{info?.icon}</span> {info?.label}
                    </p>
                  </div>
                  <dl className="stats">
                    <div>
                      <dt>Sensación</dt>
                      <dd>{w ? <Counter value={w.feels} format={deg} /> : "—"}</dd>
                    </div>
                    <div>
                      <dt>Humedad</dt>
                      <dd>{w ? <Counter value={w.humidity} format={(n) => `${Math.round(n)}%`} /> : "—"}</dd>
                    </div>
                    <div>
                      <dt>Viento</dt>
                      <dd>{w ? <Counter value={w.wind} format={(n) => `${Math.round(n)} km/h`} /> : "—"}</dd>
                    </div>
                  </dl>
                  <div className="chart">
                    <div className="chart-head">
                      <span>Próximas 24 h</span>
                      <span className="mono">
                        {Math.round(hourlyMin)}° – {Math.round(hourlyMax)}°
                      </span>
                    </div>
                    <Spark values={w?.hourly ?? []} height={96} />
                  </div>
                </>
              )}
            </Glass>
          </Reveal>
        </section>

        <section id="dolar" className="section" ref={dolarRef}>
          <Reveal>
            <p className="kicker">02 — Dólar</p>
            <h2>Cotizaciones, a 30 días</h2>
          </Reveal>
          {live.dolares.status === "error" && !live.dolares.data && <p className="err">No pude cargar el dólar: {live.dolares.error}</p>}
          <div className="dolar-grid">
            {quotes.map((q, i) => (
              <Reveal key={q.casa} delay={i * 0.06}>
                <DolarCard q={q} series={live.history[q.casa] ?? []} />
              </Reveal>
            ))}
            {live.dolares.status === "loading" && Array.from({ length: 6 }, (_, i) => <div key={i} className="glass skeleton" />)}
          </div>
        </section>

        <section id="alertas" className="section">
          <Reveal>
            <p className="kicker">03 — Alertas</p>
            <h2>Te aviso por Telegram</h2>
          </Reveal>
          <Reveal delay={0.1}>
            <Alerts weather={w} dolares={live.dolares.data} place={live.place} />
          </Reveal>
        </section>
      </main>

      <footer>
        <p>
          Datos: <a href="https://open-meteo.com">Open-Meteo</a> · <a href="https://dolarapi.com">DolarAPI</a> · <a href="https://argentinadatos.com">ArgentinaDatos</a> · <a href="https://core.telegram.org/bots/api">Telegram Bot API</a>
        </p>
        <p>React · Three.js · Framer Motion · GLSL</p>
      </footer>
    </div>
  );
}

function DolarCard({ q, series }: { q: Dolar; series: number[] }) {
  const venta = q.venta as number;
  const change = series.length > 1 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : null;
  const up = (change ?? 0) >= 0;
  const color = change === null ? "var(--accent)" : up ? "#4ade80" : "#fb7185";
  const spread = q.compra ? ((venta - q.compra) / q.compra) * 100 : null;
  return (
    <Glass className="pad quote">
      <div className="q-head">
        <span>{q.nombre}</span>
        {change !== null && (
          <span className="delta" style={{ color }}>
            {up ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="q-price">
        <Counter value={venta} format={ars} />
      </div>
      <p className="q-sub mono">
        Compra {q.compra ? ars(q.compra) : "—"}
        {spread !== null && ` · spread ${spread.toFixed(1)}%`}
      </p>
      <Spark values={series} color={color} height={56} />
    </Glass>
  );
}
