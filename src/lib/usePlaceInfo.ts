import { useEffect, useState } from "react";
import { fetchAir, fetchCountry, fetchFx, fetchHolidays, fetchWiki, type Air, type Country, type Fx, type Holiday, type Place, type Wiki } from "./api";
import { currencyOf } from "./country";
import type { Res } from "./useLive";

export type PlaceInfo = {
  air: Res<Air>;
  country: Res<Country>;
  fx: Res<Fx | null>;
  wiki: Res<Wiki | null>;
  holidays: Res<Holiday[]>;
};

const LOADING: PlaceInfo = {
  air: { status: "loading" },
  country: { status: "loading" },
  fx: { status: "loading" },
  wiki: { status: "loading" },
  holidays: { status: "loading" },
};

const TTL = 10 * 60 * 1000;
/** Caché en memoria por ciudad: volver a una ciudad ya visitada no repite ninguna request. */
const cache = new Map<string, { at: number; info: PlaceInfo }>();

const settle = <T,>(p: Promise<T>): Promise<Res<T>> =>
  p.then(
    (data) => ({ status: "ok" as const, data, at: Date.now() }),
    (e: unknown) => ({ status: "error" as const, error: e instanceof Error ? e.message : "Error" }),
  );

/**
 * Datos de contexto de la ciudad (aire, país, moneda, Wikipedia, feriados).
 * Cinco APIs en paralelo e independientes: cada tarjeta aparece apenas llega su dato.
 * Al cambiar de ciudad se cancelan las requests en vuelo (AbortController).
 */
export function usePlaceInfo(place: Place, enabled: boolean) {
  const [info, setInfo] = useState<PlaceInfo>(LOADING);

  useEffect(() => {
    if (!enabled) return;
    const key = `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) {
      setInfo(hit.info);
      return;
    }

    const ctrl = new AbortController();
    const { signal } = ctrl;
    const cc = place.countryCode;
    const cur = currencyOf(cc);
    const acc: PlaceInfo = { ...LOADING };
    setInfo(LOADING);

    const put = <K extends keyof PlaceInfo>(k: K) => (r: PlaceInfo[K]) => {
      if (signal.aborted) return;
      acc[k] = r;
      setInfo((i) => ({ ...i, [k]: r }));
    };

    void Promise.all([
      settle(fetchAir(place, signal)).then(put("air")),
      settle(cc ? fetchCountry(cc, signal) : Promise.reject(new Error("Ciudad sin país asociado"))).then(put("country")),
      settle(cur && cur !== "ARS" ? fetchFx(cur, signal) : Promise.resolve(null)).then(put("fx")),
      settle(fetchWiki(place.city, signal)).then(put("wiki")),
      settle(cc ? fetchHolidays(cc, signal) : Promise.resolve([])).then(put("holidays")),
    ]).then(() => {
      if (!signal.aborted) cache.set(key, { at: Date.now(), info: { ...acc } });
    });

    return () => ctrl.abort();
  }, [place, enabled]);

  return info;
}
