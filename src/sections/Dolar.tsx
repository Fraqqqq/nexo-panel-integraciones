import { useState } from "react";
import type { Dolar, History } from "../lib/api";
import { ars, pct, shortDate, usd } from "../lib/format";
import type { Res } from "../lib/useLive";
import { Chart, Counter, Glass, Reveal, Scramble } from "../components/UI";

const UP = "#4ade80";
const DOWN = "#fb7185";

function Brecha({ blue, oficial }: { blue?: Dolar; oficial?: Dolar }) {
  if (!blue?.venta || !oficial?.venta) return <Glass className="pad skeleton" />;
  const gap = (blue.venta / oficial.venta - 1) * 100;
  const max = Math.max(blue.venta, oficial.venta);
  return (
    <Glass className="pad brecha" tilt={3}>
      <h3 className="card-t">Brecha blue / oficial</h3>
      <div className="big-num">
        <Counter value={gap} format={(n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`} />
      </div>
      <div className="bars">
        {[
          { label: "Blue", v: blue.venta },
          { label: "Oficial", v: oficial.venta },
        ].map((b) => (
          <div key={b.label} className="bar-row">
            <span>{b.label}</span>
            <span className="bar">
              <span style={{ transform: `scaleX(${b.v / max})` }} />
            </span>
            <span className="mono">{ars(b.v)}</span>
          </div>
        ))}
      </div>
      <p className="hint">{Math.abs(gap) < 3 ? "Brecha mínima: los mercados están prácticamente unificados." : "Diferencia entre el mercado informal y el oficial."}</p>
    </Glass>
  );
}

function Converter({ quotes }: { quotes: Dolar[] }) {
  const [amount, setAmount] = useState("100");
  const [toArs, setToArs] = useState(true);
  const [casa, setCasa] = useState("blue");
  const q = quotes.find((x) => x.casa === casa) ?? quotes[0];
  const n = Number(amount.replace(",", "."));
  const valid = Number.isFinite(n) && n >= 0;
  // Vender dólares → te pagan "compra"; comprar dólares → pagás "venta".
  const rate = toArs ? (q?.compra ?? q?.venta) : q?.venta;
  const result = valid && rate ? (toArs ? n * rate : n / rate) : 0;

  return (
    <Glass className="pad converter" tilt={3}>
      <h3 className="card-t">Conversor</h3>
      <div className="conv-row">
        <label className="conv-in">
          <span className="sr">Monto en {toArs ? "dólares" : "pesos"}</span>
          <span className="cur">{toArs ? "US$" : "$"}</span>
          <input inputMode="decimal" maxLength={14} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
        </label>
        <button type="button" className="swap" onClick={() => setToArs((v) => !v)} aria-label="Invertir conversión" data-cursor="⇄">
          ⇄
        </button>
        <div className="conv-out" aria-live="polite">
          {valid && rate ? <Counter value={result} format={toArs ? ars : usd} /> : "—"}
        </div>
      </div>
      <div className="casas" role="radiogroup" aria-label="Tipo de cambio">
        {quotes.map((x) => (
          <button key={x.casa} type="button" role="radio" aria-checked={x.casa === casa} className={`chip-btn ${x.casa === casa ? "on" : ""}`} onClick={() => setCasa(x.casa)}>
            {x.nombre}
          </button>
        ))}
      </div>
      <p className="hint mono">
        {q && rate ? `1 US$ = ${ars(rate)} · ${toArs ? "precio de compra (vendés dólares)" : "precio de venta (comprás dólares)"}` : ""}
      </p>
    </Glass>
  );
}

function DolarCard({ q, series }: { q: Dolar; series?: History["series"][string] }) {
  const venta = q.venta as number;
  const values = series?.map((p) => p.v) ?? [];
  const change = values.length > 1 ? ((values[values.length - 1] - values[0]) / values[0]) * 100 : null;
  const up = (change ?? 0) >= 0;
  const color = change === null ? "var(--accent)" : up ? UP : DOWN;
  const spread = q.compra ? ((venta - q.compra) / q.compra) * 100 : null;
  return (
    <Glass className="pad quote">
      <div className="q-head">
        <span>{q.nombre}</span>
        {change !== null && (
          <span className="delta" style={{ color }}>
            {up ? "▲" : "▼"} {pct(Math.abs(change))}
          </span>
        )}
      </div>
      <div className="q-price">
        <Counter value={venta} format={ars} />
      </div>
      <p className="q-sub mono">
        Compra {q.compra ? ars(q.compra) : "—"}
        {spread !== null && ` · spread ${pct(spread)}`}
      </p>
      {series ? (
        <Chart values={values} labels={series.map((p) => shortDate(p.d))} format={ars} color={color} height={64} label={`Dólar ${q.nombre}, últimos 30 días`} />
      ) : (
        <div className="skeleton-line" />
      )}
    </Glass>
  );
}

export function DolarSection({ res, quotes, history, sectionRef }: { res: Res<Dolar[]>; quotes: Dolar[]; history: History | null; sectionRef: React.Ref<HTMLElement> }) {
  const blue = quotes.find((q) => q.casa === "blue");
  const oficial = quotes.find((q) => q.casa === "oficial");
  return (
    <section id="dolar" className="section" ref={sectionRef}>
      <Reveal>
        <p className="kicker">
          <Scramble text="03 — Dólar" />
        </p>
        <h2>
          Cotizaciones, <span className="muted-t">a 30 días</span>
        </h2>
      </Reveal>
      {res.status === "error" && !res.data && <p className="err">No pude cargar el dólar: {res.error}. Reintento automáticamente.</p>}

      <div className="dolar-top">
        <Reveal delay={0.05}>
          <Brecha blue={blue} oficial={oficial} />
        </Reveal>
        <Reveal delay={0.1}>{quotes.length ? <Converter quotes={quotes} /> : <Glass className="pad skeleton" />}</Reveal>
      </div>

      <div className="dolar-grid">
        {quotes.map((q, i) => (
          <Reveal key={q.casa} delay={i * 0.05}>
            <DolarCard q={q} series={history?.series[q.casa]} />
          </Reveal>
        ))}
        {res.status === "loading" && Array.from({ length: 6 }, (_, i) => <div key={i} className="glass skeleton" />)}
      </div>
      {history && <p className="foot-note mono">Historial: snapshot de ArgentinaDatos generado en el build del {new Date(history.generatedAt).toLocaleDateString("es-AR")}.</p>}
    </section>
  );
}
