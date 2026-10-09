export const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const usd = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export const deg = (n: number) => `${n.toFixed(1)}°`;
export const int = (n: number) => String(Math.round(n));
export const pct = (n: number) => `${n.toFixed(1)}%`;

/** "2026-10-08" → "8 oct" */
export const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");

/** "2026-10-08" → "Jue" */
export const weekday = (iso: string) => {
  const s = new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function ago(ts: number | undefined, now = Date.now()) {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return "recién";
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

/** Código de país ISO normalizado (Windows no dibuja emojis de bandera, así que se muestra como badge). */
export const countryCode = (cc?: string) => (cc && /^[A-Za-z]{2}$/.test(cc) ? cc.toUpperCase() : "··");

const CARDINAL = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
export const cardinal = (deg: number) => CARDINAL[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// ---------- contraste WCAG ----------
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
/** Texto que garantiza el mejor contraste sobre un fondo de color de acento. */
export const readableOn = (bg: string) => (contrast(bg, "#05060b") >= contrast(bg, "#ffffff") ? "#05060b" : "#ffffff");

/** El color de toda la interfaz sigue a la temperatura de la ciudad. */
export function tintFor(t: number | undefined) {
  if (t === undefined) return "#7cf0ff";
  if (t < 5) return "#8fbfff";
  if (t < 15) return "#6be4ff";
  if (t < 25) return "#7cf0c8";
  if (t < 32) return "#ffc46b";
  return "#ff8a6b";
}

/** Punto subsolar aproximado (lat/lon donde el sol está en el cénit) para el terminador día/noche. */
export function subsolar(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86_400_000;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const lon = -15 * (hours - 12);
  return { lat: decl, lon: ((lon + 540) % 360) - 180 };
}
