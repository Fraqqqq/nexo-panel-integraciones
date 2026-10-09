import { useCallback, useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import config from "../../alerts.config.json";
import { fetchRuns, fetchTemp, type Dolar, type Run } from "../lib/api";
import { ago, ars } from "../lib/format";
import { useStatus, useTick, type Source } from "../lib/status";
import { Glass, Reveal, Scramble } from "../components/UI";

type Rule = (typeof config.rules)[number] & { casa?: string };

const SOURCES: Array<{ src: Source; name: string; host: string }> = [
  { src: "meteo", name: "Open-Meteo · forecast", host: "api.open-meteo.com" },
  { src: "geo", name: "Open-Meteo · geocoding", host: "geocoding-api.open-meteo.com" },
  { src: "air", name: "Open-Meteo · calidad del aire", host: "air-quality-api.open-meteo.com" },
  { src: "dolar", name: "DolarAPI", host: "dolarapi.com" },
  { src: "history", name: "ArgentinaDatos (snapshot)", host: "build diario · mismo origen" },
  { src: "fx", name: "Frankfurter · BCE", host: "api.frankfurter.dev" },
  { src: "worldbank", name: "Banco Mundial", host: "api.worldbank.org" },
  { src: "wiki", name: "Wikipedia REST", host: "es.wikipedia.org" },
  { src: "holidays", name: "Nager.Date", host: "date.nager.at" },
  { src: "quakes", name: "USGS · sismos", host: "earthquake.usgs.gov" },
  { src: "github", name: "GitHub REST API", host: "api.github.com" },
];

function Flow() {
  return (
    <div className="flow" aria-label="Flujo: Open-Meteo y DolarAPI alimentan a GitHub Actions, que avisa por Telegram">
      <div className="flow-col">
        <span className="node">Open-Meteo</span>
        <span className="node">DolarAPI</span>
      </div>
      <span className="wire" aria-hidden="true">
        <i />
      </span>
      <span className="node core">
        GitHub Actions
        <small>cron · cada {config.checkEveryMinutes} min</small>
      </span>
      <span className="wire" aria-hidden="true">
        <i />
      </span>
      <span className="node tg">Telegram</span>
    </div>
  );
}

function Health() {
  const status = useStatus();
  useTick();
  return (
    <Glass className="pad" tilt={3}>
      <h3 className="card-t">Salud de las integraciones</h3>
      <ul className="health">
        {SOURCES.map((s) => {
          const h = status[s.src];
          const state = !h ? "idle" : h.ok ? "ok" : "bad";
          return (
            <li key={s.src} className={state}>
              <span className="dot" />
              <span className="h-name">
                {s.name}
                <em>{s.host}</em>
              </span>
              <span className="mono h-ms">{h?.ms !== undefined ? `${h.ms} ms` : "—"}</span>
              <span className="mono h-at">{state === "idle" ? "sin uso aún" : state === "bad" ? `falló ${ago(h?.at)}` : ago(h?.at)}</span>
            </li>
          );
        })}
      </ul>
      <p className="hint">Latencia real de cada request de esta sesión. Cada llamada tiene timeout, reintentos con backoff exponencial y no bloquea a las demás.</p>
    </Glass>
  );
}

function Gauge({ rule, value }: { rule: Rule; value: number | undefined }) {
  const isDolar = rule.source === "dolar";
  const fmt = (v: number) => (isDolar ? ars(v) : `${v.toFixed(1)}°C`);
  if (value === undefined) {
    return (
      <li className="gauge">
        <div className="g-head">
          <span>{rule.label}</span>
          <span className="mono">—</span>
        </div>
      </li>
    );
  }
  const margin = Math.abs(rule.value) * 0.1 + (isDolar ? 0 : 5);
  const lo = Math.min(value, rule.value) - margin;
  const hi = Math.max(value, rule.value) + margin;
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const fired = rule.op === ">" ? value > rule.value : value < rule.value;
  const diff = Math.abs(rule.value - value);
  return (
    <li className={`gauge ${fired ? "fired" : ""}`}>
      <div className="g-head">
        <span>
          {rule.label} {rule.op} <b className="mono">{fmt(rule.value)}</b>
        </span>
        <span className={`pill ${fired ? "bad" : "ok"}`}>{fired ? "disparada" : `en rango · falta ${isDolar ? ars(diff) : `${diff.toFixed(1)}°`}`}</span>
      </div>
      <div className="g-track">
        <span className="g-zone" style={rule.op === ">" ? { left: `${at(rule.value)}%`, right: 0 } : { left: 0, width: `${at(rule.value)}%` }} />
        <span className="g-tick" style={{ left: `${at(rule.value)}%` }} />
        <span className="g-val" style={{ left: `${at(value)}%` }}>
          <em className="mono">{fmt(value)}</em>
        </span>
      </div>
    </li>
  );
}

function Runs({ runs, error }: { runs: Run[] | null; error: boolean }) {
  useTick();
  const last = runs?.[0];
  const color = (r: Run) => (r.status !== "completed" ? "run" : r.conclusion === "success" ? "ok" : r.conclusion === "failure" ? "bad" : "idle");
  return (
    <div className="runs">
      <div className="runs-head">
        <span>Últimas ejecuciones</span>
        <a href={`https://github.com/${config.repo}/actions/workflows/alerts.yml`} target="_blank" rel="noreferrer noopener" data-cursor="ver">
          ver en GitHub ↗
        </a>
      </div>
      {error ? (
        <p className="hint">No pude consultar la API de GitHub (límite de 60 consultas/hora por IP). Se reintenta solo.</p>
      ) : !runs ? (
        <div className="skeleton-line" />
      ) : runs.length === 0 ? (
        <p className="hint">Todavía no hay ejecuciones: el primer chequeo corre en los próximos minutos.</p>
      ) : (
        <>
          <ol className="run-dots">
            {[...runs].reverse().map((r) => (
              <li key={r.id}>
                <a
                  href={r.html_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={color(r)}
                  title={`${new Date(r.created_at).toLocaleString("es-AR")} · ${r.conclusion ?? r.status}`}
                  aria-label={`Ejecución del ${new Date(r.created_at).toLocaleString("es-AR")}: ${r.conclusion ?? r.status}`}
                />
              </li>
            ))}
          </ol>
          {last && (
            <p className="mono run-last">
              último chequeo {ago(Date.parse(last.created_at))} · {last.status !== "completed" ? "en curso" : last.conclusion === "success" ? "ok" : last.conclusion}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function SystemSection({ dolares }: { dolares?: Dolar[] }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { margin: "300px 0px" });
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runsError, setRunsError] = useState(false);
  const [temp, setTemp] = useState<number>();

  const load = useCallback(async () => {
    try {
      setRuns(await fetchRuns(config.repo));
      setRunsError(false);
    } catch {
      setRunsError(true);
    }
    fetchTemp(config.city.latitude, config.city.longitude).then(setTemp, () => {
      /* el medidor muestra "—" */
    });
  }, []);

  // Una consulta inicial siempre (no depende de que el navegador dispare el IntersectionObserver)…
  useEffect(() => {
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [load]);
  // …y refresco periódico solo mientras la sección está cerca de la pantalla (límite: 60 req/h por IP).
  useEffect(() => {
    if (!inView) return;
    const id = setInterval(load, 90_000);
    return () => clearInterval(id);
  }, [inView, load]);

  const valueOf = (r: Rule) => (r.source === "dolar" ? (dolares?.find((d) => d.casa === r.casa)?.venta ?? undefined) : temp);

  return (
    <section id="sistema" className="section" ref={ref}>
      <Reveal>
        <p className="kicker">
          <Scramble text="04 — Sistema" />
        </p>
        <h2>
          Alertas 24/7, <span className="muted-t">sin la pestaña abierta</span>
        </h2>
      </Reveal>

      <Reveal delay={0.05}>
        <Flow />
      </Reveal>

      <div className="system-grid">
        <Reveal delay={0.1}>
          <Glass className="pad" tilt={3}>
            <h3 className="card-t">Reglas activas · {config.city.name}</h3>
            <ul className="gauges">
              {(config.rules as Rule[]).map((r) => (
                <Gauge key={r.id} rule={r} value={valueOf(r)} />
              ))}
            </ul>
            <Runs runs={runs} error={runsError} />
          </Glass>
        </Reveal>
        <Reveal delay={0.15}>
          <Health />
        </Reveal>
      </div>

      <Reveal delay={0.2}>
        <details className="setup glass">
          <summary data-cursor="abrir">¿Cómo funciona y cómo lo activo en mi copia?</summary>
          <div className="setup-body">
            <ol className="steps">
              <li>
                Un workflow de GitHub Actions (<code>.github/workflows/alerts.yml</code>) corre cada {config.checkEveryMinutes} minutos y ejecuta{" "}
                <code>scripts/alerts.mjs</code>.
              </li>
              <li>
                Las reglas están en <code>alerts.config.json</code> (público). El token del bot y el chat ID son <b>secrets</b> del repo: nunca llegan al
                navegador.
              </li>
              <li>
                Cada regla avisa una vez al dispararse y otra al volver a la normalidad; el estado se guarda entre ejecuciones con <code>actions/cache</code>.
              </li>
              <li>
                Para activarlo: creá un bot con <b>@BotFather</b>, mandale <code>/start</code> y cargá <code>TELEGRAM_BOT_TOKEN</code> y{" "}
                <code>TELEGRAM_CHAT_ID</code> en <i>Settings → Secrets and variables → Actions</i>.
              </li>
            </ol>
          </div>
        </details>
      </Reveal>
    </section>
  );
}
