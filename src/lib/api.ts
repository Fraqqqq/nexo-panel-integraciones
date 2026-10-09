import { track, type Source } from "./status";

export type Place = {
  city: string;
  country: string;
  countryCode?: string;
  admin?: string;
  latitude: number;
  longitude: number;
};

export type Weather = {
  /** Ciudad a la que pertenece este dato: evita mezclar clima viejo con ciudad nueva. */
  forPlace: Place;
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  windDir: number;
  pressure: number;
  code: number;
  isDay: boolean;
  /** Segundos respecto de UTC, para calcular la hora local de la ciudad. */
  utcOffset: number;
  timezone: string;
  hourly: { time: string[]; temp: number[]; rain: number[] };
  daily: { date: string[]; code: number[]; max: number[]; min: number[]; rain: number[] };
  sunrise: string;
  sunset: string;
};

export type Dolar = {
  casa: string;
  nombre: string;
  compra: number | null;
  venta: number | null;
  fechaActualizacion: string;
};

export type HistoryPoint = { d: string; v: number };
export type History = { generatedAt: string; series: Record<string, HistoryPoint[]> };
export type Pulse = { place: Place; temp: number; code: number };
export type Run = { id: number; status: string; conclusion: string | null; created_at: string; html_url: string };

export const DEFAULT_PLACE: Place = {
  city: "Buenos Aires",
  country: "Argentina",
  countryCode: "AR",
  latitude: -34.61,
  longitude: -58.38,
};

/** Ciudades del "pulso global": una sola request a Open-Meteo trae las 8. */
export const PULSE_CITIES: Place[] = [
  { city: "Nueva York", country: "EE. UU.", countryCode: "US", latitude: 40.71, longitude: -74.01 },
  { city: "Ciudad de México", country: "México", countryCode: "MX", latitude: 19.43, longitude: -99.13 },
  { city: "São Paulo", country: "Brasil", countryCode: "BR", latitude: -23.55, longitude: -46.63 },
  { city: "Londres", country: "Reino Unido", countryCode: "GB", latitude: 51.51, longitude: -0.13 },
  { city: "El Cairo", country: "Egipto", countryCode: "EG", latitude: 30.04, longitude: 31.24 },
  { city: "Dubái", country: "Emiratos Árabes", countryCode: "AE", latitude: 25.2, longitude: 55.27 },
  { city: "Tokio", country: "Japón", countryCode: "JP", latitude: 35.68, longitude: 139.69 },
  { city: "Sídney", country: "Australia", countryCode: "AU", latitude: -33.87, longitude: 151.21 },
];

export class HttpError extends Error {
  constructor(
    public status: number,
    host: string,
  ) {
    super(`HTTP ${status} (${host})`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch + JSON con timeout, reintentos con backoff exponencial y jitter (0.6 s, 1.2 s, …)
 * y registro de latencia por integración. Los 4xx (salvo 429) no se reintentan.
 */
async function getJSON<T>(source: Source, url: string, tries = 3, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const t0 = performance.now();
    try {
      const timeout = AbortSignal.timeout(10_000);
      const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!res.ok) throw new HttpError(res.status, new URL(url, location.href).hostname);
      const json = (await res.json()) as T;
      track(source, true, performance.now() - t0);
      return json;
    } catch (e) {
      last = e;
      if (signal?.aborted) throw e; // cancelado por cambio de ciudad: no se reintenta ni se marca como caída
      const permanent = e instanceof HttpError && e.status < 500 && e.status !== 429;
      if (permanent || i === tries - 1) break;
      await sleep(600 * 2 ** i + Math.random() * 300);
    }
  }
  track(source, false);
  throw last instanceof Error ? last : new Error("Error de red");
}

// ---------- validación ----------
export function isPlace(v: unknown): v is Place {
  const p = v as Place;
  return (
    !!p &&
    typeof p.city === "string" &&
    p.city.length < 120 &&
    typeof p.country === "string" &&
    Number.isFinite(p.latitude) &&
    Math.abs(p.latitude) <= 90 &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.longitude) <= 180
  );
}

// ---------- geocoding ----------
type GeoHit = { name: string; country?: string; country_code?: string; admin1?: string; latitude: number; longitude: number };
const toPlace = (h: GeoHit): Place => ({
  city: h.name,
  country: h.country ?? "",
  countryCode: h.country_code,
  admin: h.admin1,
  latitude: h.latitude,
  longitude: h.longitude,
});

export async function suggest(name: string, signal?: AbortSignal): Promise<Place[]> {
  const q = name.trim().slice(0, 80);
  if (q.length < 2) return [];
  const t0 = performance.now();
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=es`, { signal });
  if (!res.ok) {
    track("geo", false);
    throw new HttpError(res.status, "geocoding-api.open-meteo.com");
  }
  const data = (await res.json()) as { results?: GeoHit[] };
  track("geo", true, performance.now() - t0);
  return (data.results ?? []).map(toPlace);
}

export async function geocode(name: string): Promise<Place> {
  const q = name.trim().slice(0, 80);
  if (q.length < 2) throw new Error("Escribí al menos 2 letras");
  const data = await getJSON<{ results?: GeoHit[] }>(
    "geo",
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=es`,
  );
  const hit = data.results?.[0];
  if (!hit) throw new Error(`No encontré "${q}"`);
  return toPlace(hit);
}

// ---------- clima ----------
export async function fetchWeather(p: Place): Promise<Weather> {
  const d = await getJSON<{
    utc_offset_seconds: number;
    timezone: string;
    current: {
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      wind_direction_10m: number;
      pressure_msl: number;
      weather_code: number;
      is_day: number;
    };
    hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[] };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[];
      sunrise: string[];
      sunset: string[];
    };
  }>(
    "meteo",
    `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code,is_day` +
      `&hourly=temperature_2m,precipitation_probability&forecast_hours=24` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&forecast_days=7` +
      `&timezone=auto`,
  );
  const c = d.current;
  return {
    forPlace: p,
    temp: c.temperature_2m,
    feels: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    windDir: c.wind_direction_10m,
    pressure: c.pressure_msl,
    code: c.weather_code,
    isDay: c.is_day === 1,
    utcOffset: d.utc_offset_seconds,
    timezone: d.timezone,
    hourly: { time: d.hourly.time, temp: d.hourly.temperature_2m, rain: d.hourly.precipitation_probability.map((v) => v ?? 0) },
    daily: {
      date: d.daily.time,
      code: d.daily.weather_code,
      max: d.daily.temperature_2m_max,
      min: d.daily.temperature_2m_min,
      rain: d.daily.precipitation_probability_max.map((v) => v ?? 0),
    },
    sunrise: d.daily.sunrise[0],
    sunset: d.daily.sunset[0],
  };
}

export async function fetchPulse(): Promise<Pulse[]> {
  const lat = PULSE_CITIES.map((c) => c.latitude).join(",");
  const lon = PULSE_CITIES.map((c) => c.longitude).join(",");
  const rows = await getJSON<Array<{ current: { temperature_2m: number; weather_code: number } }>>(
    "meteo",
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`,
  );
  return rows.map((r, i) => ({ place: PULSE_CITIES[i], temp: r.current.temperature_2m, code: r.current.weather_code }));
}

/** Temperatura actual de un punto (la ciudad configurada para las alertas). */
export async function fetchTemp(lat: number, lon: number): Promise<number> {
  const d = await getJSON<{ current: { temperature_2m: number } }>(
    "meteo",
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=auto`,
  );
  return d.current.temperature_2m;
}

// ---------- dólar ----------
export const fetchDolares = () => getJSON<Dolar[]>("dolar", "https://dolarapi.com/v1/dolares");

/** Snapshot de 30 días generado en el build (scripts/build-data.mjs): ~6 KB en vez de 3,5 MB. */
export const fetchHistory = () => getJSON<History>("history", `${import.meta.env.BASE_URL}data/history.json`, 2);

// ---------- calidad del aire (Open-Meteo Air Quality) ----------
export type Air = { aqi: number; pm25: number; pm10: number; o3: number; uv: number };
export async function fetchAir(p: Place, signal?: AbortSignal): Promise<Air> {
  const d = await getJSON<{ current: { us_aqi: number; pm2_5: number; pm10: number; ozone: number; uv_index: number } }>(
    "air",
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.latitude}&longitude=${p.longitude}&current=us_aqi,pm2_5,pm10,ozone,uv_index&timezone=auto`,
    3,
    signal,
  );
  const c = d.current;
  return { aqi: c.us_aqi, pm25: c.pm2_5, pm10: c.pm10, o3: c.ozone, uv: c.uv_index };
}

// ---------- país (Banco Mundial) ----------
export type Country = {
  name: string;
  capital: string;
  region: string;
  income: string;
  population?: number;
  gdpPc?: number;
  lifeExp?: number;
  internet?: number;
  year?: string;
};
const WB_IND = { "SP.POP.TOTL": "population", "NY.GDP.PCAP.CD": "gdpPc", "SP.DYN.LE00.IN": "lifeExp", "IT.NET.USER.ZS": "internet" } as const;
export async function fetchCountry(cc: string, signal?: AbortSignal): Promise<Country> {
  const code = encodeURIComponent(cc.toUpperCase());
  type Info = { name: string; capitalCity: string; region: { value: string }; incomeLevel: { value: string } };
  type Ind = { indicator: { id: keyof typeof WB_IND }; value: number | null; date: string };
  const [info, ind] = await Promise.all([
    getJSON<[unknown, Info[] | undefined]>("worldbank", `https://api.worldbank.org/v2/country/${code}?format=json`, 2, signal),
    getJSON<[unknown, Ind[] | undefined]>(
      "worldbank",
      `https://api.worldbank.org/v2/country/${code}/indicator/${Object.keys(WB_IND).join(";")}?source=2&format=json&mrnev=1`,
      2,
      signal,
    ),
  ]);
  const c = info[1]?.[0];
  if (!c) throw new Error("País sin datos en el Banco Mundial");
  const out: Country = { name: c.name, capital: c.capitalCity, region: c.region.value, income: c.incomeLevel.value };
  for (const row of ind[1] ?? []) {
    const key = WB_IND[row.indicator.id];
    if (key && typeof row.value === "number") {
      out[key] = row.value;
      if (key === "population") out.year = row.date;
    }
  }
  return out;
}

// ---------- tipo de cambio (Frankfurter, datos del BCE) ----------
export type Fx = { currency: string; rate: number; date: string };
export async function fetchFx(currency: string, signal?: AbortSignal): Promise<Fx> {
  if (currency === "USD") return { currency, rate: 1, date: new Date().toISOString().slice(0, 10) };
  const d = await getJSON<{ date: string; rates: Record<string, number> }>(
    "fx",
    `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${encodeURIComponent(currency)}`,
    3,
    signal,
  );
  const rate = d.rates[currency];
  if (!rate) throw new Error(`Sin cotización para ${currency}`);
  return { currency, rate, date: d.date };
}

// ---------- Wikipedia ----------
export type Wiki = { title: string; extract: string; image?: string; url: string };
export async function fetchWiki(title: string, signal?: AbortSignal): Promise<Wiki | null> {
  try {
    const d = await getJSON<{
      type: string;
      title: string;
      extract: string;
      thumbnail?: { source: string };
      originalimage?: { source: string };
      content_urls: { desktop: { page: string } };
    }>("wiki", `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, 2, signal);
    if (d.type === "disambiguation" || !d.extract) return null;
    // Miniatura en un tamaño estándar de Wikimedia: 500 px en celular (~70 KB), 960 px en pantallas grandes.
    // Nunca la original, que puede pesar varios MB.
    const width = window.innerWidth < 760 ? 500 : 960;
    const image = d.thumbnail?.source.replace(/\/(\d+)px-/, `/${width}px-`);
    return { title: d.title, extract: d.extract, image, url: d.content_urls.desktop.page };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

// ---------- feriados (Nager.Date) ----------
export type Holiday = { date: string; localName: string; name: string };
export async function fetchHolidays(cc: string, signal?: AbortSignal): Promise<Holiday[]> {
  const t0 = performance.now();
  const timeout = AbortSignal.timeout(10_000);
  const res = await fetch(`https://date.nager.at/api/v3/NextPublicHolidays/${encodeURIComponent(cc.toUpperCase())}`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  // 204/404: el país no está cubierto por Nager.Date (no es un error del servicio).
  if (res.status === 204 || res.status === 404) {
    track("holidays", true, performance.now() - t0);
    return [];
  }
  if (!res.ok) {
    track("holidays", false);
    throw new HttpError(res.status, "date.nager.at");
  }
  const rows = (await res.json()) as Holiday[];
  track("holidays", true, performance.now() - t0);
  return rows;
}

// ---------- sismos (USGS) ----------
export type Quake = { id: string; mag: number; place: string; time: number; lat: number; lon: number; depth: number; url: string };
export async function fetchQuakes(): Promise<Quake[]> {
  const d = await getJSON<{
    features: Array<{
      id: string;
      properties: { mag: number; place: string; time: number; url: string };
      geometry: { coordinates: [number, number, number] };
    }>;
  }>("quakes", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson");
  return d.features
    .map((f) => ({
      id: f.id,
      mag: f.properties.mag,
      place: f.properties.place ?? "Ubicación desconocida",
      time: f.properties.time,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2],
      url: f.properties.url,
    }))
    .sort((a, b) => b.mag - a.mag);
}

// ---------- GitHub Actions (estado del cron de alertas) ----------
export async function fetchRuns(repo: string): Promise<Run[]> {
  const data = await getJSON<{ workflow_runs?: Run[] }>(
    "github",
    `https://api.github.com/repos/${repo}/actions/workflows/alerts.yml/runs?per_page=8&exclude_pull_requests=true`,
    1,
  );
  return data.workflow_runs ?? [];
}

// ---------- códigos WMO ----------
const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: "Despejado", icon: "☀️" },
  1: { label: "Mayormente despejado", icon: "🌤️" },
  2: { label: "Parcialmente nublado", icon: "⛅" },
  3: { label: "Nublado", icon: "☁️" },
  45: { label: "Niebla", icon: "🌫️" },
  48: { label: "Niebla con escarcha", icon: "🌫️" },
  51: { label: "Llovizna leve", icon: "🌦️" },
  53: { label: "Llovizna", icon: "🌦️" },
  55: { label: "Llovizna intensa", icon: "🌧️" },
  56: { label: "Llovizna helada", icon: "🌧️" },
  57: { label: "Llovizna helada", icon: "🌧️" },
  61: { label: "Lluvia leve", icon: "🌧️" },
  63: { label: "Lluvia", icon: "🌧️" },
  65: { label: "Lluvia fuerte", icon: "🌧️" },
  66: { label: "Lluvia helada", icon: "🌧️" },
  67: { label: "Lluvia helada", icon: "🌧️" },
  71: { label: "Nevada leve", icon: "🌨️" },
  73: { label: "Nevada", icon: "❄️" },
  75: { label: "Nevada fuerte", icon: "❄️" },
  77: { label: "Granizo fino", icon: "🌨️" },
  80: { label: "Chubascos leves", icon: "🌦️" },
  81: { label: "Chubascos", icon: "🌧️" },
  82: { label: "Chubascos fuertes", icon: "⛈️" },
  85: { label: "Chubascos de nieve", icon: "🌨️" },
  86: { label: "Chubascos de nieve", icon: "🌨️" },
  95: { label: "Tormenta", icon: "⛈️" },
  96: { label: "Tormenta con granizo", icon: "⛈️" },
  99: { label: "Tormenta fuerte", icon: "⛈️" },
};

export const describe = (code: number) => WMO[code] ?? { label: "—", icon: "🌐" };

/** 0 = nada, 1 = lluvia, 2 = nieve */
export function precipType(code: number): 0 | 1 | 2 {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 2;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 1;
  return 0;
}
