export type Place = { city: string; country: string; latitude: number; longitude: number };

export type Weather = {
  /** Ciudad a la que pertenece este dato: evita mezclar clima viejo con ciudad nueva. */
  forPlace: Place;
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  code: number;
  isDay: boolean;
  hourly: number[];
  hourlyTimes: string[];
};

export type Dolar = {
  casa: string;
  nombre: string;
  compra: number | null;
  venta: number | null;
  fechaActualizacion: string;
};

export const DEFAULT_PLACE: Place = {
  city: "Buenos Aires",
  country: "Argentina",
  latitude: -34.61,
  longitude: -58.38,
};

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${new URL(url).hostname})`);
  return res.json() as Promise<T>;
}

export async function geocode(name: string): Promise<Place> {
  name = name.trim().slice(0, 80);
  if (name.length < 2) throw new Error("Escribí al menos 2 letras");
  const data = await getJSON<{ results?: Array<{ name: string; country?: string; latitude: number; longitude: number }> }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=es`,
  );
  const hit = data.results?.[0];
  if (!hit) throw new Error(`No encontré "${name}"`);
  return { city: hit.name, country: hit.country ?? "", latitude: hit.latitude, longitude: hit.longitude };
}

export function isPlace(v: unknown): v is Place {
  const p = v as Place;
  return (
    !!p &&
    typeof p.city === "string" &&
    typeof p.country === "string" &&
    Number.isFinite(p.latitude) &&
    Math.abs(p.latitude) <= 90 &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.longitude) <= 180
  );
}

export async function fetchWeather(p: Place): Promise<Omit<Weather, "forPlace">> {
  const d = await getJSON<{
    current: {
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      weather_code: number;
      is_day: number;
    };
    hourly: { time: string[]; temperature_2m: number[] };
  }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
      `&hourly=temperature_2m&forecast_hours=24&timezone=auto`,
  );
  const c = d.current;
  return {
    temp: c.temperature_2m,
    feels: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    code: c.weather_code,
    isDay: c.is_day === 1,
    hourly: d.hourly.temperature_2m,
    hourlyTimes: d.hourly.time,
  };
}

export async function fetchDolares(): Promise<Dolar[]> {
  return getJSON<Dolar[]>("https://dolarapi.com/v1/dolares");
}

const HISTORY_TTL = 6 * 60 * 60 * 1000;

/**
 * Últimos 30 días de venta. El endpoint devuelve toda la historia (~500 KB por casa),
 * así que se cachea 6 h en localStorage y solo se pide cuando la sección entra en pantalla.
 * Falla en silencio: es un extra visual.
 */
export async function fetchHistory(casa: string): Promise<number[]> {
  const key = `nexo:h:${casa}`;
  try {
    const cached = JSON.parse(localStorage.getItem(key) ?? "null") as { t: number; v: number[] } | null;
    if (cached && Date.now() - cached.t < HISTORY_TTL && Array.isArray(cached.v)) return cached.v;
  } catch {
    /* cache ilegible: se ignora */
  }
  try {
    const rows = await getJSON<Array<{ venta: number | null }>>(
      `https://api.argentinadatos.com/v1/cotizaciones/dolares/${encodeURIComponent(casa)}`,
    );
    const v = rows
      .slice(-30)
      .map((r) => r.venta)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
    } catch {
      /* sin storage: no pasa nada */
    }
    return v;
  } catch {
    return [];
  }
}

// ---------- Telegram Bot API ----------
type TgResponse<T> = { ok: boolean; result?: T; description?: string };

// Formato oficial de los tokens de BotFather; se valida antes de armar la URL.
export const isToken = (t: string) => /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(t);
export const isChatId = (c: string) => /^-?\d{1,16}$/.test(c);

async function tg<T>(token: string, method: string, body?: unknown): Promise<T> {
  if (!isToken(token)) throw new Error("El token no tiene el formato de BotFather (123456:ABC…)");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as TgResponse<T>;
  if (!json.ok) throw new Error(json.description ?? `Telegram HTTP ${res.status}`);
  return json.result as T;
}

export const sendTelegram = (token: string, chatId: string, html: string) => {
  if (!isChatId(chatId)) return Promise.reject(new Error("El Chat ID debe ser numérico"));
  return tg(token, "sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true });
};

/** Busca el chat más reciente que le escribió al bot (hay que mandarle /start antes). */
export async function detectChatId(token: string): Promise<{ id: string; name: string }> {
  const updates = await tg<Array<{ message?: { chat: { id: number; first_name?: string; title?: string } } }>>(
    token,
    "getUpdates",
  );
  const last = [...updates].reverse().find((u) => u.message)?.message?.chat;
  if (!last) throw new Error("Todavía no hay mensajes: abrí el bot en Telegram y mandale /start");
  return { id: String(last.id), name: last.first_name ?? last.title ?? "chat" };
}

export const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

// ---------- Códigos WMO ----------
export const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: "Despejado", icon: "☀️" },
  1: { label: "Mayormente despejado", icon: "🌤️" },
  2: { label: "Parcialmente nublado", icon: "⛅" },
  3: { label: "Nublado", icon: "☁️" },
  45: { label: "Niebla", icon: "🌫️" },
  48: { label: "Niebla con escarcha", icon: "🌫️" },
  51: { label: "Llovizna leve", icon: "🌦️" },
  53: { label: "Llovizna", icon: "🌦️" },
  55: { label: "Llovizna intensa", icon: "🌧️" },
  61: { label: "Lluvia leve", icon: "🌧️" },
  63: { label: "Lluvia", icon: "🌧️" },
  65: { label: "Lluvia fuerte", icon: "🌧️" },
  71: { label: "Nevada leve", icon: "🌨️" },
  73: { label: "Nevada", icon: "❄️" },
  75: { label: "Nevada fuerte", icon: "❄️" },
  80: { label: "Chubascos leves", icon: "🌦️" },
  81: { label: "Chubascos", icon: "🌧️" },
  82: { label: "Chubascos fuertes", icon: "⛈️" },
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
