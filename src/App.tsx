import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, MotionConfig, useInView, useReducedMotion } from "framer-motion";
import Lenis from "lenis";
import { precipType } from "./lib/api";
import { ars, deg, readableOn, tintFor } from "./lib/format";
import { useLive } from "./lib/useLive";
import { usePlaceInfo } from "./lib/usePlaceInfo";
import { useTick } from "./lib/status";
import { Counter, Cursor, Magnetic, ScrollBar } from "./components/UI";
import { Search } from "./components/Search";
import { Preloader } from "./components/Preloader";
import { hasWebGL, OrbFallback, SceneBoundary, StatusBanner } from "./components/Resilience";
import { WeatherSection } from "./sections/Weather";
import { DolarSection } from "./sections/Dolar";
import { SystemSection } from "./sections/System";
import { DestinoSection } from "./sections/Destino";

const Scene = lazy(() => import("./components/Scene"));

const ORDER = ["blue", "oficial", "bolsa", "contadoconliqui", "cripto", "tarjeta", "mayorista"];
const NAV = [
  { id: "clima", label: "Clima" },
  { id: "destino", label: "Destino" },
  { id: "dolar", label: "Dólar" },
  { id: "sistema", label: "Sistema" },
];
const NAV_IDS = NAV.map((n) => n.id);

const words = (text: string, start = 0) =>
  text.split(" ").map((w, i) => (
    <span className="w" key={i}>
      <motion.span initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 1, delay: 0.15 + (start + i) * 0.09, ease: [0.22, 1, 0.36, 1] }}>
        {w}&nbsp;
      </motion.span>
    </span>
  ));

/** Resalta en la navegación la sección que está en pantalla. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)), {
      rootMargin: "-45% 0px -50% 0px",
    });
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    const top = () => window.scrollY < window.innerHeight * 0.5 && setActive(null);
    window.addEventListener("scroll", top, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", top);
    };
  }, [ids]);
  return active;
}

function HeroClock({ offset }: { offset?: number }) {
  useTick();
  if (offset === undefined) return <>—</>;
  const d = new Date(Date.now() + offset * 1000);
  return (
    <span className="num">
      {d.getUTCHours().toString().padStart(2, "0")}
      <span className="blink">:</span>
      {d.getUTCMinutes().toString().padStart(2, "0")}
    </span>
  );
}

export default function App() {
  const live = useLive();
  const reduced = useReducedMotion() ?? false;
  const [webgl, setWebgl] = useState(hasWebGL);
  const [loading, setLoading] = useState(true);
  const [minTimePassed, setMinTimePassed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const active = useActiveSection(NAV_IDS);
  const linksRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ x: 0, w: 0 });
  // Píldora de la sección activa: se mide el link y se anima con CSS (sin depender de layout animations).
  useEffect(() => {
    const measure = () => {
      const el = linksRef.current?.querySelector<HTMLAnchorElement>("a.on");
      setPill((p) => (el ? { x: el.offsetLeft, w: el.offsetWidth } : { ...p, w: 0 }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  const w = live.weather.data?.forPlace === live.place ? live.weather.data : undefined;
  const tint = tintFor(w?.temp);

  const dolarRef = useRef<HTMLElement>(null);
  const nearDolar = useInView(dolarRef, { once: true, margin: "600px 0px" });
  const { loadHistory } = live;
  useEffect(() => {
    if (nearDolar) void loadHistory();
  }, [nearDolar, loadHistory]);

  // Preloader: se va cuando llegan los datos (mínimo 0,9 s para que se lea; máximo 3,5 s pase lo que pase).
  useEffect(() => {
    const a = setTimeout(() => setMinTimePassed(true), 900);
    const b = setTimeout(() => setTimedOut(true), 3500);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  const dataReady = live.weather.status !== "loading" && live.dolares.status !== "loading";
  const ready = (dataReady && minTimePassed) || timedOut;
  const finishLoading = useCallback(() => setLoading(false), []);
  // El contexto de la ciudad (5 APIs) se pide después del arranque: no compite con la primera pintura.
  const info = usePlaceInfo(live.place, !loading);

  useEffect(() => {
    if (reduced || loading) return;
    const lenis = new Lenis({ lerp: 0.09, anchors: true });
    let id = requestAnimationFrame(function raf(t) {
      lenis.raf(t);
      id = requestAnimationFrame(raf);
    });
    return () => {
      cancelAnimationFrame(id);
      lenis.destroy();
    };
  }, [reduced, loading]);

  const quotes = useMemo(() => {
    const list = live.dolares.data ?? [];
    return [...list].filter((d) => ORDER.includes(d.casa) && d.venta != null).sort((a, b) => ORDER.indexOf(a.casa) - ORDER.indexOf(b.casa));
  }, [live.dolares.data]);
  const blue = quotes.find((q) => q.casa === "blue");

  const failing = [live.weather.error && "Open-Meteo", live.dolares.error && "DolarAPI"].filter(Boolean) as string[];
  const lastOk = Math.min(live.weather.at ?? Infinity, live.dolares.at ?? Infinity);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app" style={{ "--accent": tint, "--on-accent": readableOn(tint) } as CSSProperties}>
        <a className="skip" href="#clima">
          Saltar al contenido
        </a>
        <AnimatePresence>{loading && <Preloader ready={ready} onDone={finishLoading} />}</AnimatePresence>

        <div className="blobs" aria-hidden="true" />
        {webgl ? (
          <SceneBoundary fallback={<OrbFallback />}>
            <Suspense fallback={null}>
              <Scene
                lat={live.place.latitude}
                lon={live.place.longitude}
                precip={w ? precipType(w.code) : 0}
                tint={tint}
                reduced={reduced}
                pulse={live.pulse}
                quakes={live.quakes}
                onPick={live.goTo}
                onFail={() => setWebgl(false)}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          <OrbFallback />
        )}
        <div className="grain" aria-hidden="true" />
        <Cursor />
        <ScrollBar />

        {quotes.length > 0 && (
          <div className="marquee" aria-label="Cotizaciones del dólar y temperaturas en vivo">
            <div className="track">
              {[0, 1].map((k) => (
                <div className="group" key={k} aria-hidden={k === 1}>
                  {quotes.map((q) => (
                    <span key={q.casa}>
                      <b>{q.nombre}</b> {ars(q.venta as number)}
                    </span>
                  ))}
                  {live.pulse.map((p) => (
                    <span key={p.place.city}>
                      <b>{p.place.city}</b> {Math.round(p.temp)}°
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <nav className="nav" aria-label="Secciones">
          <a className="brand" href="#top" data-cursor="inicio">
            <span className="orb" /> NEXO
          </a>
          <div className="links" ref={linksRef}>
            <span className="nav-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w, opacity: pill.w ? 1 : 0 }} aria-hidden="true" />
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} className={active === n.id ? "on" : ""} aria-current={active === n.id ? "true" : undefined}>
                {n.label}
              </a>
            ))}
          </div>
        </nav>

        <main id="top">
          <section className="hero">
            <div className="hero-copy">
              <motion.p className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
                <span className="live" /> En vivo · 12 APIs · alertas 24/7
              </motion.p>
              <h1>
                {words("El mundo,")}
                <br />
                <span className="nowrap">
                  {words("en", 2)} <em>{words("tiempo real.", 3)}</em>
                </span>
              </h1>
              <motion.p className="lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.9 }}>
                Clima, aire, dólar, sismos y contexto de cualquier ciudad sobre un globo 3D con día y noche reales. Buscá una ciudad, o tocá una del mapa, y mirá cómo el planeta viaja hacia ella.
              </motion.p>

              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05, duration: 0.9 }}>
                <Search current={live.place} busy={live.searching} error={live.searchError} onPick={live.goTo} onSubmitText={live.search} />
              </motion.div>

              <motion.div className="chips" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.9 }}>
                <div className="chip">
                  <small>{live.place.city}</small>
                  <strong>{w ? <Counter value={w.temp} format={deg} /> : "—"}</strong>
                </div>
                <div className="chip">
                  <small>Hora local</small>
                  <strong>
                    <HeroClock offset={w?.utcOffset} />
                  </strong>
                </div>
                <div className="chip">
                  <small>Dólar blue</small>
                  <strong>{blue?.venta ? <Counter value={blue.venta} format={ars} /> : "—"}</strong>
                </div>
              </motion.div>
            </div>
            <a className="scroll-hint" href="#clima" data-cursor="bajar">
              <span /> Scroll
            </a>
          </section>

          <WeatherSection place={live.place} res={live.weather} w={w} air={info.air} />
          <DestinoSection place={live.place} info={info} blue={blue?.venta ?? undefined} quakes={live.quakes} onPick={live.goTo} />
          <DolarSection res={live.dolares} quotes={quotes} history={live.history} sectionRef={dolarRef} />
          <SystemSection dolares={live.dolares.data} />
        </main>

        <footer>
          <div className="wordmark" aria-hidden="true">
            NEXO
          </div>
          <div className="foot-row">
            <p>
              Datos: <a href="https://open-meteo.com">Open-Meteo</a> · <a href="https://dolarapi.com">DolarAPI</a> ·{" "}
              <a href="https://argentinadatos.com">ArgentinaDatos</a> · <a href="https://frankfurter.dev">Frankfurter</a> ·{" "}
              <a href="https://data.worldbank.org">Banco Mundial</a> · <a href="https://es.wikipedia.org">Wikipedia</a> ·{" "}
              <a href="https://date.nager.at">Nager.Date</a> · <a href="https://earthquake.usgs.gov">USGS</a> · Alertas:{" "}
              <a href="https://core.telegram.org/bots/api">Telegram Bot API</a> + GitHub Actions
            </p>
            <p className="mono">
              build {__BUILD__.sha} · {new Date(__BUILD__.date).toLocaleDateString("es-AR")} ·{" "}
              <a href="https://github.com/Fraqqqq/nexo-panel-integraciones" target="_blank" rel="noreferrer noopener">
                código ↗
              </a>
            </p>
          </div>
          <div className="foot-row">
            <p>
              Hecho por <b>Franco Albrecht</b> · React · Three.js · GLSL · Framer Motion
            </p>
            <Magnetic>
              <a className="btn ghost" href="#top" data-cursor="subir">
                ↑ Volver arriba
              </a>
            </Magnetic>
          </div>
        </footer>

        <StatusBanner failing={failing} lastOk={Number.isFinite(lastOk) ? lastOk : undefined} />
      </div>
    </MotionConfig>
  );
}
