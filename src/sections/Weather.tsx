import { describe, type Air, type Place, type Weather } from "../lib/api";
import { cardinal, deg, int, tintFor, weekday } from "../lib/format";
import type { Res } from "../lib/useLive";
import { useTick } from "../lib/status";
import { Chart, Counter, Glass, Reveal, Scramble } from "../components/UI";

/** "2026-10-08T06:58" (hora local de la ciudad) → ms tratando la hora local como UTC. */
const localMs = (s: string) => Date.parse(`${s}:00Z`);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

function useCityNow(offsetSec: number) {
  useTick();
  return Date.now() + offsetSec * 1000; // "ahora" de la ciudad, expresado en UTC
}

function LocalClock({ w }: { w: Weather }) {
  const now = useCityNow(w.utcOffset);
  const d = new Date(now);
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  const sign = w.utcOffset >= 0 ? "+" : "−";
  const off = Math.abs(w.utcOffset) / 3600;
  return (
    <p className="clock">
      <span className="mono">
        {h}
        <span className="blink">:</span>
        {m}
      </span>
      <small>
        hora local · UTC{sign}
        {Number.isInteger(off) ? off : off.toFixed(1)}
      </small>
    </p>
  );
}

function SunArc({ w }: { w: Weather }) {
  const now = useCityNow(w.utcOffset);
  const rise = localMs(w.sunrise);
  const set = localMs(w.sunset);
  const f = (now - rise) / (set - rise);
  const day = f >= 0 && f <= 1;
  const k = Math.min(1, Math.max(0, f));
  const x = 150 - 130 * Math.cos(Math.PI * k);
  const y = 100 - 80 * Math.sin(Math.PI * k);
  const untilRise = (now < rise ? rise : rise + 86_400_000) - now;
  const hours = Math.floor(untilRise / 3_600_000);
  const mins = Math.round((untilRise % 3_600_000) / 60_000);
  return (
    <div className="sun">
      <svg viewBox="0 0 300 118" aria-hidden="true">
        <path d="M20 100 A130 80 0 0 1 280 100" className="sun-track" pathLength={1} />
        <path d="M20 100 A130 80 0 0 1 280 100" className="sun-done" pathLength={1} style={{ strokeDasharray: `${k} 1` }} />
        <line x1="6" y1="100" x2="294" y2="100" className="sun-horizon" />
        <circle cx={x} cy={day ? y : 100} r={day ? 9 : 6} className={day ? "sun-dot" : "moon-dot"} />
      </svg>
      <div className="sun-meta">
        <span>
          ↑ <b className="mono">{hhmm(rise)}</b>
        </span>
        <span className="sun-state">{day ? `${Math.round(k * 100)}% del día` : `Noche · amanece en ${hours} h ${mins} min`}</span>
        <span>
          ↓ <b className="mono">{hhmm(set)}</b>
        </span>
      </div>
    </div>
  );
}

function Forecast({ w }: { w: Weather }) {
  const lo = Math.min(...w.daily.min);
  const hi = Math.max(...w.daily.max);
  const span = hi - lo || 1;
  return (
    <ol className="forecast" aria-label="Pronóstico de 7 días">
      {w.daily.date.map((d, i) => {
        const min = w.daily.min[i];
        const max = w.daily.max[i];
        return (
          <li key={d}>
            <span className="f-day">{i === 0 ? "Hoy" : weekday(d)}</span>
            <span className="f-icon" title={describe(w.daily.code[i]).label}>
              {describe(w.daily.code[i]).icon}
            </span>
            <span className="f-rain mono">{w.daily.rain[i] >= 20 ? `${w.daily.rain[i]}%` : ""}</span>
            <span className="f-min mono">{Math.round(min)}°</span>
            <span className="f-track">
              <span
                className="f-fill"
                style={{
                  left: `${((min - lo) / span) * 100}%`,
                  width: `${Math.max(4, ((max - min) / span) * 100)}%`,
                  background: `linear-gradient(90deg, ${tintFor(min)}, ${tintFor(max)})`,
                }}
              />
            </span>
            <span className="f-max mono">{Math.round(max)}°</span>
          </li>
        );
      })}
    </ol>
  );
}

const AQI = [
  { max: 50, label: "Buena", color: "#4ade80", tip: "Ideal para actividades al aire libre." },
  { max: 100, label: "Moderada", color: "#facc15", tip: "Aceptable; personas muy sensibles, con moderación." },
  { max: 150, label: "Dañina para sensibles", color: "#fb923c", tip: "Grupos sensibles deberían reducir el esfuerzo al aire libre." },
  { max: 200, label: "Dañina", color: "#f87171", tip: "Todos pueden empezar a sentir efectos." },
  { max: 300, label: "Muy dañina", color: "#c084fc", tip: "Evitar actividades al aire libre." },
  { max: Infinity, label: "Peligrosa", color: "#e11d48", tip: "Alerta sanitaria." },
];
const UV = [
  { max: 2, label: "Bajo", tip: "No hace falta protección." },
  { max: 5, label: "Moderado", tip: "Protector solar si estás mucho tiempo afuera." },
  { max: 7, label: "Alto", tip: "Protector, gorra y sombra al mediodía." },
  { max: 10, label: "Muy alto", tip: "Evitá el sol entre las 11 y las 16 h." },
  { max: Infinity, label: "Extremo", tip: "Evitá la exposición directa." },
];

function AirCard({ air }: { air: Res<Air> }) {
  const a = air.data;
  if (!a) {
    return (
      <Glass className="pad air">
        <h3 className="card-t">Calidad del aire</h3>
        {air.status === "error" ? <p className="hint">Open-Meteo Air Quality no respondió.</p> : <div className="skeleton-line" />}
      </Glass>
    );
  }
  const q = AQI.find((x) => a.aqi <= x.max) ?? AQI[AQI.length - 1];
  const uv = UV.find((x) => a.uv <= x.max) ?? UV[UV.length - 1];
  return (
    <Glass className="pad air" tilt={2}>
      <div className="air-main">
        <h3 className="card-t">Calidad del aire · US AQI</h3>
        <div className="aqi" style={{ color: q.color }}>
          <Counter value={a.aqi} format={int} />
          <span>{q.label}</span>
        </div>
        <div className="aqi-scale" aria-hidden="true">
          <span className="aqi-mark" style={{ left: `${Math.min(a.aqi, 300) / 3}%`, background: q.color }} />
        </div>
        <p className="hint">{q.tip}</p>
      </div>
      <dl className="air-grid">
        <div>
          <dt>PM2.5</dt>
          <dd>
            <Counter value={a.pm25} format={(n) => n.toFixed(1)} /> <small>µg/m³</small>
          </dd>
        </div>
        <div>
          <dt>PM10</dt>
          <dd>
            <Counter value={a.pm10} format={(n) => n.toFixed(1)} /> <small>µg/m³</small>
          </dd>
        </div>
        <div>
          <dt>Ozono</dt>
          <dd>
            <Counter value={a.o3} format={int} /> <small>µg/m³</small>
          </dd>
        </div>
        <div className="uv">
          <dt>Índice UV · {uv.label}</dt>
          <dd>
            <Counter value={a.uv} format={(n) => n.toFixed(1)} />
          </dd>
          <span className="uv-pips" aria-hidden="true">
            {Array.from({ length: 11 }, (_, i) => (
              <i key={i} className={i < Math.round(a.uv) ? "on" : ""} />
            ))}
          </span>
          <small>{uv.tip}</small>
        </div>
      </dl>
    </Glass>
  );
}

export function WeatherSection({ place, res, w, air }: { place: Place; res: Res<Weather>; w?: Weather; air: Res<Air> }) {
  const info = w ? describe(w.code) : null;
  const hourLabels = w?.hourly.time.map((t) => `${t.slice(11, 13)} h`) ?? [];
  const delta = w ? w.feels - w.temp : 0;

  return (
    <section id="clima" className="section">
      <Reveal>
        <p className="kicker">
          <Scramble text="01 — Clima" />
        </p>
        <h2>
          {place.city}
          {place.country && <span className="muted-t">, {place.country}</span>}
        </h2>
      </Reveal>

      {res.status === "error" && !w ? (
        <Glass className="pad">
          <p className="err">No pude cargar el clima: {res.error}. Reintento automáticamente en unos minutos.</p>
        </Glass>
      ) : (
        <div className="grid-12">
          <Reveal delay={0.05} className="span-7">
            <Glass className="pad w-main">
              <div className="temp">
                {w ? <Counter value={w.temp} format={int} /> : <span className="skel-text">··</span>}
                <sup>°C</sup>
              </div>
              <p className="cond">
                <span className="emoji">{info?.icon}</span> {info?.label ?? "Cargando…"}
              </p>
              {w && <LocalClock w={w} />}
            </Glass>
          </Reveal>

          <Reveal delay={0.1} className="span-5">
            <Glass className="pad w-sun">
              <h3 className="card-t">Sol</h3>
              {w ? <SunArc w={w} /> : <div className="skeleton-line" />}
            </Glass>
          </Reveal>

          <Reveal delay={0.15} className="span-12">
            <dl className="stats">
              <Glass className="stat" tilt={4}>
                <dt>Sensación</dt>
                <dd>{w ? <Counter value={w.feels} format={deg} /> : "—"}</dd>
                <small>{w ? (Math.abs(delta) < 0.5 ? "igual a la real" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}° vs real`) : ""}</small>
              </Glass>
              <Glass className="stat" tilt={4}>
                <dt>Humedad</dt>
                <dd>{w ? <Counter value={w.humidity} format={(n) => `${Math.round(n)}%`} /> : "—"}</dd>
                <span className="meter">
                  <span style={{ transform: `scaleX(${(w?.humidity ?? 0) / 100})` }} />
                </span>
              </Glass>
              <Glass className="stat" tilt={4}>
                <dt>Viento</dt>
                <dd>{w ? <Counter value={w.wind} format={(n) => `${Math.round(n)} km/h`} /> : "—"}</dd>
                {w && (
                  <small className="wind">
                    <span className="arrow" style={{ transform: `rotate(${w.windDir + 180}deg)` }} aria-hidden="true">
                      ↑
                    </span>
                    del {cardinal(w.windDir)}
                  </small>
                )}
              </Glass>
              <Glass className="stat" tilt={4}>
                <dt>Presión</dt>
                <dd>{w ? <Counter value={w.pressure} format={(n) => `${Math.round(n)} hPa`} /> : "—"}</dd>
                <small>{w ? (w.pressure > 1018 ? "alta · estable" : w.pressure < 1008 ? "baja · inestable" : "normal") : ""}</small>
              </Glass>
            </dl>
          </Reveal>

          <Reveal delay={0.18} className="span-12">
            <AirCard air={air} />
          </Reveal>

          <Reveal delay={0.2} className="span-7">
            <Glass className="pad w-chart">
              <div className="chart-head">
                <h3 className="card-t">Próximas 24 h</h3>
                <span className="legend">
                  <i className="l-line" /> temperatura <i className="l-bar" /> prob. de lluvia
                </span>
              </div>
              <Chart
                values={w?.hourly.temp ?? []}
                labels={hourLabels}
                bars={w?.hourly.rain}
                format={deg}
                barFormat={(n) => `lluvia ${n}%`}
                label="Temperatura de las próximas 24 horas"
                height={130}
              />
            </Glass>
          </Reveal>

          <Reveal delay={0.25} className="span-5">
            <Glass className="pad w-week" tilt={3}>
              <h3 className="card-t">7 días</h3>
              {w ? <Forecast w={w} /> : <div className="skeleton-line tall" />}
            </Glass>
          </Reveal>
        </div>
      )}
    </section>
  );
}
