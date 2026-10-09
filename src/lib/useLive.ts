import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PLACE,
  fetchDolares,
  fetchHistory,
  fetchPulse,
  fetchQuakes,
  fetchWeather,
  geocode,
  isPlace,
  type Dolar,
  type History,
  type Place,
  type Pulse,
  type Quake,
  type Weather,
} from "./api";

export type Res<T> = { status: "loading" | "ok" | "error"; data?: T; error?: string; at?: number };

const REFRESH_MS = 5 * 60 * 1000;

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage bloqueado: la app funciona igual */
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "Error desconocido");
const urlCity = () => new URLSearchParams(location.search).get("ciudad")?.slice(0, 80) ?? null;

function storedPlace() {
  const p = loadJSON<unknown>("nexo:place", null);
  return isPlace(p) ? p : DEFAULT_PLACE;
}

/** Mantiene ?ciudad= sincronizado para que el link sea compartible. */
function syncUrl(p: Place) {
  const url = new URL(location.href);
  url.searchParams.set("ciudad", p.city);
  history.replaceState(null, "", url);
}

export function useLive() {
  const [place, setPlace] = useState<Place>(storedPlace);
  const [weather, setWeather] = useState<Res<Weather>>({ status: "loading" });
  const [dolares, setDolares] = useState<Res<Dolar[]>>({ status: "loading" });
  const [history, setHistory] = useState<History | null>(null);
  const [pulse, setPulse] = useState<Pulse[]>([]);
  const [quakes, setQuakes] = useState<Quake[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const placeRef = useRef(place);
  const reqId = useRef(0);
  const historyStarted = useRef(false);

  useEffect(() => {
    placeRef.current = place;
  }, [place]);

  const loadWeather = useCallback(async (p: Place) => {
    const id = ++reqId.current; // descarta respuestas viejas si se busca otra ciudad mientras carga
    try {
      const data = await fetchWeather(p);
      if (id === reqId.current) setWeather({ status: "ok", data, at: Date.now() });
    } catch (e) {
      // Si ya había datos se conservan (el banner avisa que están desactualizados).
      if (id === reqId.current) setWeather((w) => (w.data?.forPlace === p ? { ...w, error: msg(e) } : { status: "error", error: msg(e) }));
    }
  }, []);

  const loadDolares = useCallback(async () => {
    try {
      setDolares({ status: "ok", data: await fetchDolares(), at: Date.now() });
    } catch (e) {
      setDolares((d) => (d.data ? { ...d, error: msg(e) } : { status: "error", error: msg(e) }));
    }
  }, []);

  const loadPulse = useCallback(async () => {
    try {
      setPulse(await fetchPulse());
    } catch {
      /* extra decorativo: sin pulso el globo sigue funcionando */
    }
  }, []);

  const loadQuakes = useCallback(async () => {
    try {
      setQuakes(await fetchQuakes());
    } catch {
      /* sin sismos el globo sigue funcionando */
    }
  }, []);

  /** Se pide una sola vez, cuando la sección del dólar se acerca a la pantalla. */
  const loadHistory = useCallback(async () => {
    if (historyStarted.current) return;
    historyStarted.current = true;
    try {
      setHistory(await fetchHistory());
    } catch {
      historyStarted.current = false; // permite reintentar en la próxima visita a la sección
    }
  }, []);

  const goTo = useCallback((p: Place) => {
    saveJSON("nexo:place", p);
    syncUrl(p);
    setSearchError(null);
    setPlace(p);
  }, []);

  const search = useCallback(
    async (name: string) => {
      setSearching(true);
      setSearchError(null);
      try {
        goTo(await geocode(name));
      } catch (e) {
        setSearchError(msg(e));
      } finally {
        setSearching(false);
      }
    },
    [goTo],
  );

  useEffect(() => {
    void loadWeather(place);
  }, [place, loadWeather]);

  useEffect(() => {
    const fromUrl = urlCity();
    if (fromUrl && fromUrl.toLowerCase() !== placeRef.current.city.toLowerCase()) void search(fromUrl);

    void loadDolares();
    void loadPulse();
    void loadQuakes();
    let last = Date.now();
    const refresh = () => {
      if (Date.now() - last < 60_000) return; // como mucho un refresco por minuto
      last = Date.now();
      void loadWeather(placeRef.current);
      void loadDolares();
      void loadPulse();
      void loadQuakes();
    };
    const id = setInterval(refresh, REFRESH_MS);
    // Al volver la conexión o la pestaña, se refresca sin esperar al próximo ciclo.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadDolares, loadPulse, loadQuakes, loadWeather, search]);

  return { place, weather, dolares, history, pulse, quakes, loadHistory, goTo, search, searching, searchError };
}
