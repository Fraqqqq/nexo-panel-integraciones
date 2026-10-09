import type { Place, Quake } from "../lib/api";
import { compact, countryName, currencyOf, incomeEs, money, regionEs } from "../lib/country";
import { ago, ars, shortDate } from "../lib/format";
import type { PlaceInfo } from "../lib/usePlaceInfo";
import { useTick } from "../lib/status";
import { Counter, Glass, Reveal, Scramble } from "../components/UI";

type Props = { place: Place; info: PlaceInfo; blue?: number; quakes: Quake[]; onPick: (p: Place) => void };

function WikiCard({ info, place }: { info: PlaceInfo; place: Place }) {
  const w = info.wiki.data;
  if (info.wiki.status === "loading") return <Glass className="wiki skeleton" />;
  if (!w) {
    return (
      <Glass className="pad wiki empty">
        <h3 className="card-t">Wikipedia</h3>
        <p className="hint">No hay un artículo en español para “{place.city}”.</p>
      </Glass>
    );
  }
  return (
    <Glass className="wiki" tilt={2}>
      {w.image && (
        <div className="wiki-img">
          <img
            src={w.image}
            alt={`Imagen de ${w.title}`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            key={w.image}
          />
        </div>
      )}
      <div className="wiki-body pad">
        <h3 className="card-t">Wikipedia</h3>
        <h4>{w.title}</h4>
        <p className="wiki-text">{w.extract}</p>
        <a href={w.url} target="_blank" rel="noreferrer noopener" className="link" data-cursor="leer">
          Leer el artículo ↗
        </a>
      </div>
    </Glass>
  );
}

function CountryCard({ info, place }: { info: PlaceInfo; place: Place }) {
  const c = info.country.data;
  const cc = place.countryCode?.toLowerCase();
  return (
    <Glass className="pad country" tilt={3}>
      <div className="country-head">
        {cc && /^[a-z]{2}$/.test(cc) && <img className="flag-img" src={`https://flagcdn.com/w80/${cc}.png`} alt="" width={40} height={27} loading="lazy" />}
        <div>
          <h3 className="card-t">País · Banco Mundial</h3>
          <h4>{countryName(place.countryCode) || place.country || "—"}</h4>
        </div>
      </div>
      {!c ? (
        info.country.status === "loading" ? (
          <div className="skeleton-line tall" />
        ) : (
          <p className="hint">Sin datos del Banco Mundial para esta ubicación.</p>
        )
      ) : (
        <>
          <p className="country-meta">
            Capital <b>{c.capital || "—"}</b> · {regionEs(c.region)} · {incomeEs(c.income)}
          </p>
          <dl className="ind-grid">
            <div>
              <dt>Población</dt>
              <dd>{c.population ? compact(c.population) : "—"}</dd>
            </div>
            <div>
              <dt>PBI per cápita</dt>
              <dd>{c.gdpPc ? `US$ ${compact(c.gdpPc)}` : "—"}</dd>
            </div>
            <div>
              <dt>Esperanza de vida</dt>
              <dd>{c.lifeExp ? `${c.lifeExp.toFixed(1)} años` : "—"}</dd>
            </div>
            <div>
              <dt>Usa internet</dt>
              <dd>{c.internet ? `${Math.round(c.internet)}%` : "—"}</dd>
              <span className="meter">
                <span style={{ transform: `scaleX(${(c.internet ?? 0) / 100})` }} />
              </span>
            </div>
          </dl>
          {c.year && <p className="foot-note mono">Último dato disponible: {c.year}</p>}
        </>
      )}
    </Glass>
  );
}

function MoneyCard({ info, place, blue }: { info: PlaceInfo; place: Place; blue?: number }) {
  const cur = currencyOf(place.countryCode);
  const fx = info.fx.data;
  const BUDGET = 100_000;
  return (
    <Glass className="pad money-card" tilt={3}>
      <h3 className="card-t">Moneda local · Frankfurter (BCE)</h3>
      {cur === "ARS" ? (
        <>
          <p className="money-big">Peso argentino</p>
          <p className="hint">
            Estás en Argentina: las cotizaciones del dólar están en la{" "}
            <a className="link" href="#dolar">
              sección Dólar
            </a>
            .
          </p>
        </>
      ) : !cur ? (
        <p className="hint">El Banco Central Europeo no publica la moneda local de {countryName(place.countryCode) || "esta ubicación"}.</p>
      ) : !fx ? (
        info.fx.status === "error" ? <p className="hint">Frankfurter no respondió: {info.fx.error}</p> : <div className="skeleton-line tall" />
      ) : (
        <>
          <p className="money-big">
            1 US$ = <Counter value={fx.rate} format={(n) => money(n, cur)} />
          </p>
          {blue && (
            <ul className="money-list">
              <li>
                <span>1 {cur} al blue</span>
                <b className="mono">{money(blue / fx.rate, "ARS")}</b>
              </li>
              <li>
                <span>Con {ars(BUDGET)} (blue) tenés</span>
                <b className="mono">
                  <Counter value={(BUDGET / blue) * fx.rate} format={(n) => money(n, cur)} />
                </b>
              </li>
            </ul>
          )}
          <p className="foot-note mono">Referencia BCE del {shortDate(fx.date)} · cruzado con el dólar blue de DolarAPI</p>
        </>
      )}
    </Glass>
  );
}

function HolidaysCard({ info, place }: { info: PlaceInfo; place: Place }) {
  const list = info.holidays.data?.slice(0, 4) ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  return (
    <Glass className="pad holidays" tilt={3}>
      <h3 className="card-t">Próximos feriados · Nager.Date</h3>
      {info.holidays.status === "loading" ? (
        <div className="skeleton-line tall" />
      ) : list.length === 0 ? (
        <p className="hint">{info.holidays.status === "error" ? "Nager.Date no respondió." : `Sin calendario de feriados para ${countryName(place.countryCode) || "esta ubicación"}.`}</p>
      ) : (
        <ol className="hol-list">
          {list.map((h) => {
            const n = days(h.date);
            const [, m, d] = h.date.split("-");
            return (
              <li key={h.date + h.name}>
                <span className="hol-date">
                  <b>{Number(d)}</b>
                  <small>{new Date(Date.UTC(2000, Number(m) - 1, 1)).toLocaleDateString("es-AR", { month: "short", timeZone: "UTC" }).replace(".", "")}</small>
                </span>
                <span className="hol-name">
                  {h.localName}
                  {h.localName !== h.name && <em>{h.name}</em>}
                </span>
                <span className="pill ok">{n <= 0 ? "hoy" : n === 1 ? "mañana" : `en ${n} días`}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Glass>
  );
}

function QuakesCard({ quakes, onPick }: { quakes: Quake[]; onPick: (p: Place) => void }) {
  useTick();
  const top = quakes.slice(0, 6);
  const sev = (m: number) => (m >= 6 ? "q-high" : m >= 5 ? "q-mid" : "q-low");
  return (
    <Glass className="pad quakes" tilt={2}>
      <div className="quakes-head">
        <div>
          <h3 className="card-t">Planeta · sismos M4.5+ en 24 h · USGS</h3>
          <p className="money-big">
            <Counter value={quakes.length} format={(n) => String(Math.round(n))} /> <span className="muted-t">sismos</span>
          </p>
        </div>
        {quakes[0] && (
          <p className="hint">
            El más fuerte: <b>M{quakes[0].mag.toFixed(1)}</b>, {quakes[0].place}. Están marcados en rojo sobre el globo.
          </p>
        )}
      </div>
      {top.length === 0 ? (
        <div className="skeleton-line" />
      ) : (
        <ul className="quake-list">
          {top.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                data-cursor="ir"
                onClick={() => {
                  onPick({ city: `Sismo M${q.mag.toFixed(1)}`, country: q.place, latitude: q.lat, longitude: q.lon });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <span className={`mag ${sev(q.mag)}`}>{q.mag.toFixed(1)}</span>
                <span className="q-place">{q.place}</span>
                <span className="q-meta mono">
                  {ago(q.time)} · {Math.round(q.depth)} km
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Glass>
  );
}

export function DestinoSection({ place, info, blue, quakes, onPick }: Props) {
  return (
    <section id="destino" className="section">
      <Reveal>
        <p className="kicker">
          <Scramble text="02 — Destino" />
        </p>
        <h2>
          {place.city}, <span className="muted-t">en contexto</span>
        </h2>
      </Reveal>
      <div className="grid-12">
        <Reveal delay={0.05} className="span-7">
          <WikiCard info={info} place={place} />
        </Reveal>
        <Reveal delay={0.1} className="span-5">
          <CountryCard info={info} place={place} />
        </Reveal>
        <Reveal delay={0.12} className="span-6">
          <MoneyCard info={info} place={place} blue={blue} />
        </Reveal>
        <Reveal delay={0.15} className="span-6">
          <HolidaysCard info={info} place={place} />
        </Reveal>
        <Reveal delay={0.18} className="span-12">
          <QuakesCard quakes={quakes} onPick={onPick} />
        </Reveal>
      </div>
    </section>
  );
}
