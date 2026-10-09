// Motor de alertas 24/7. Lo ejecuta GitHub Actions cada 15 minutos (.github/workflows/alerts.yml).
// - Reglas: alerts.config.json (público, sin secretos).
// - Credenciales: TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID como secrets del repo; nunca tocan el navegador.
// - Estado: .alert-state/state.json, persistido entre ejecuciones con actions/cache.
//   Cada regla avisa una vez al dispararse y otra al volver a la normalidad (sin spam).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync("alerts.config.json", "utf8"));
const TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const CHAT = process.env.TELEGRAM_CHAT_ID?.trim();
const STATE_DIR = ".alert-state";
const STATE_FILE = `${STATE_DIR}/state.json`;
const DRY = !TOKEN || !CHAT;

const summary = (line) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const ars = (n) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

async function getJSON(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).hostname}`);
      return await res.json();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

async function telegram(html) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  // Nunca se loguea la URL (contiene el token); solo la descripción del error.
  if (!json.ok) throw new Error(`Telegram: ${json.description ?? res.status}`);
}

const { latitude, longitude, name } = cfg.city;
const [dolares, weather] = await Promise.all([
  getJSON("https://dolarapi.com/v1/dolares"),
  getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&timezone=auto`),
]);
const temp = weather.current.temperature_2m;

const valueOf = (rule) => (rule.source === "dolar" ? dolares.find((d) => d.casa === rule.casa)?.venta : temp);
const fmt = (rule, v) => (rule.source === "dolar" ? ars(v) : `${v}°C`);
const where = (rule) => (rule.source === "temp" ? ` en ${esc(name)}` : "");

// Ejecución manual con "prueba": confirma que el bot y el chat están bien configurados.
if (process.env.NEXO_TEST === "true") {
  if (DRY) {
    console.error("Faltan los secrets TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID.");
    process.exit(1);
  }
  const blue = dolares.find((d) => d.casa === "blue")?.venta;
  await telegram(
    `<b>✅ NEXO conectado</b>
Las alertas van a llegar a este chat.

Ahora: ${esc(name)} ${temp}°C · dólar blue ${blue ? ars(blue) : "—"}`,
  );
  summary("Mensaje de prueba enviado.");
}

// Resumen del mundo: clima de varias ciudades (una sola request), dólar y sismos del día.
if (process.env.NEXO_DIGEST === "true" && !DRY) {
  const cities = cfg.digest?.cities ?? [];
  const flag = (cc) => String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  const icon = (code) =>
    code === 0 ? "☀️" : code <= 2 ? "⛅" : code === 3 ? "☁️" : code <= 48 ? "🌫️" : code <= 67 || (code >= 80 && code <= 82) ? "🌧️" : code <= 77 || code === 85 || code === 86 ? "❄️" : "⛈️";
  const [rows, quakes] = await Promise.all([
    getJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${cities.map((c) => c.latitude).join(",")}&longitude=${cities
        .map((c) => c.longitude)
        .join(",")}&current=temperature_2m,weather_code&timezone=auto`,
    ),
    getJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson").catch(() => null),
  ]);
  const list = Array.isArray(rows) ? rows : [rows];
  const lines = cities.map((c, i) => {
    const cur = list[i]?.current;
    return cur ? `${flag(c.cc)} ${esc(c.name)}  <b>${Math.round(cur.temperature_2m)}°</b> ${icon(cur.weather_code)}` : `${flag(c.cc)} ${esc(c.name)}  —`;
  });
  const casa = (k) => dolares.find((d) => d.casa === k)?.venta;
  const fx = [["Blue", "blue"], ["Oficial", "oficial"], ["MEP", "bolsa"]]
    .filter(([, k]) => casa(k))
    .map(([n, k]) => `${n} <b>${ars(casa(k))}</b>`)
    .join(" · ");
  let sismos = "";
  if (quakes?.features?.length) {
    const top = [...quakes.features].sort((a, b) => b.properties.mag - a.properties.mag)[0].properties;
    sismos = `\n\n🌐 Sismos M4.5+ en 24 h: <b>${quakes.features.length}</b> (mayor M${top.mag.toFixed(1)}, ${esc(top.place)})`;
  }
  const fecha = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });
  await telegram(`<b>🌎 Resumen NEXO</b> · ${fecha}\n\n${lines.join("\n")}\n\n💵 ${fx}${sismos}`);
  summary("Resumen del mundo enviado.");
}

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
summary(`### Chequeo ${new Date().toISOString()}${DRY ? " (modo simulación: faltan secrets)" : ""}`);
summary("| Regla | Valor | Umbral | Estado |\n|---|---|---|---|");

let failures = 0;
for (const rule of cfg.rules) {
  const v = valueOf(rule);
  if (typeof v !== "number") {
    summary(`| ${rule.id} | — | ${rule.op} ${rule.value} | sin dato |`);
    continue;
  }
  const active = rule.op === ">" ? v > rule.value : v < rule.value;
  const was = state[rule.id] === true;
  let msg = null;
  if (active && !was) {
    msg = `<b>🔔 ${esc(rule.label)}${where(rule)}</b>\nAhora: <b>${fmt(rule, v)}</b> (umbral ${rule.op} ${fmt(rule, rule.value)})`;
  } else if (!active && was) {
    msg = `<b>✅ ${esc(rule.label)}${where(rule)} volvió a la normalidad</b>\nAhora: ${fmt(rule, v)}`;
  }
  if (msg && !DRY) {
    try {
      await telegram(msg);
      state[rule.id] = active;
    } catch (e) {
      failures++;
      console.error(`${rule.id}: ${e.message}`);
    }
  } else if (!msg) {
    state[rule.id] = active;
  }
  summary(`| ${rule.id} | ${fmt(rule, v)} | ${rule.op} ${fmt(rule, rule.value)} | ${active ? "🔴 disparada" : "🟢 en rango"}${msg ? (DRY ? " · (simulado)" : " · aviso enviado") : ""} |`);
}

mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify(state));
if (failures) process.exit(1);
