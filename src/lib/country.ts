/** Moneda local por país, solo para las monedas que publica el BCE (las que cotiza Frankfurter). */
const EUR = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SK SI AD MC SM VA ME XK".split(" ");
const MAP: Record<string, string> = {
  ...Object.fromEntries(EUR.map((c) => [c, "EUR"])),
  US: "USD", EC: "USD", SV: "USD", PA: "USD", PR: "USD",
  AU: "AUD", BG: "BGN", BR: "BRL", CA: "CAD", CH: "CHF", LI: "CHF", CN: "CNY", CZ: "CZK",
  DK: "DKK", GL: "DKK", FO: "DKK", GB: "GBP", HK: "HKD", HU: "HUF", ID: "IDR", IL: "ILS",
  IN: "INR", IS: "ISK", JP: "JPY", KR: "KRW", MX: "MXN", MY: "MYR", NO: "NOK", NZ: "NZD",
  PH: "PHP", PL: "PLN", RO: "RON", SE: "SEK", SG: "SGD", TH: "THB", TR: "TRY", ZA: "ZAR",
  AR: "ARS",
};
export const currencyOf = (cc?: string) => (cc ? MAP[cc.toUpperCase()] : undefined);

const REGION: Record<string, string> = {
  "East Asia & Pacific": "Asia oriental y Pacífico",
  "Europe & Central Asia": "Europa y Asia central",
  "Latin America & Caribbean": "América Latina y el Caribe",
  "Middle East & North Africa": "Medio Oriente y Norte de África",
  "Middle East, North Africa, Afghanistan & Pakistan": "Medio Oriente y Norte de África",
  "North America": "América del Norte",
  "South Asia": "Asia del Sur",
  "Sub-Saharan Africa": "África subsahariana",
};
const INCOME: Record<string, string> = {
  "High income": "Ingreso alto",
  "Upper middle income": "Ingreso medio alto",
  "Lower middle income": "Ingreso medio bajo",
  "Low income": "Ingreso bajo",
};
export const regionEs = (r: string) => REGION[r.trim()] ?? r.trim();
export const incomeEs = (r: string) => INCOME[r.trim()] ?? r.trim();

let names: Intl.DisplayNames | null = null;
/** Nombre del país en español a partir del código ISO. */
export function countryName(cc?: string) {
  if (!cc) return "";
  try {
    names ??= new Intl.DisplayNames(["es"], { type: "region" });
    return names.of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
}

export const money = (n: number, currency: string) => {
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: n < 100 ? 2 : 0 });
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
};

export const compact = (n: number) => n.toLocaleString("es-AR", { notation: "compact", maximumFractionDigits: 1 });
