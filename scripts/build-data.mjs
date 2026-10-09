// Snapshot del historial del dólar (últimos 30 días por casa).
// ArgentinaDatos devuelve la historia completa (~500 KB por casa); acá se recorta a ~3 KB
// y se publica junto al sitio. El deploy diario lo mantiene fresco.
import { mkdirSync, writeFileSync } from "node:fs";

const CASAS = ["blue", "oficial", "bolsa", "contadoconliqui", "cripto", "tarjeta", "mayorista"];
const DAYS = 30;

async function getJSON(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

const series = {};
for (const casa of CASAS) {
  try {
    const rows = await getJSON(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${casa}`);
    series[casa] = rows
      .slice(-DAYS)
      .filter((r) => typeof r.venta === "number" && Number.isFinite(r.venta))
      .map((r) => ({ d: r.fecha, v: r.venta }));
  } catch (e) {
    // Un fallo externo no debe romper el deploy: la UI simplemente no muestra ese gráfico.
    console.warn(`historial ${casa}: ${e.message}`);
  }
}

mkdirSync(new URL("../public/data/", import.meta.url), { recursive: true });
const json = JSON.stringify({ generatedAt: new Date().toISOString(), series });
writeFileSync(new URL("../public/data/history.json", import.meta.url), json);
console.log(`history.json: ${Object.keys(series).length} casas, ${json.length} bytes`);
