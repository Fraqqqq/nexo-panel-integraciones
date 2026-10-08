import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PLACE,
  fetchDolares,
  fetchHistory,
  fetchWeather,
  geocode,
  isPlace,
  type Dolar,
  type Place,
  type Weather,
} from "./api";

export type Res<T> = { status: "loading" | "ok" | "error"; data?: T; error?: string };

const REFRESH_MS = 5 * 60 * 1000;
const HISTORY_CASAS = ["blue", "oficial", "bolsa", "contadoconliqui", "cripto", "tarjeta", "mayorista"];

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

function storedPlace() {
  const p = loadJSON<unknown>("nexo:place", null);
  return isPlace(p) ? p : DEFAULT_PLACE;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "Error desconocido");

export function useLive() {
  const [place, setPlace] = useState<Place>(storedPlace);
  const [weather, setWeather] = useState<Res<Weather>>({ status: "loading" });
  const [dolares, setDolares] = useState<Res<Dolar[]>>({ status: "loading" });
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const placeRef = useRef(place);
  placeRef.current = place;
  const reqId = useRef(0);
  const historyStarted = useRef(false);

  const loadWeather = useCallback(async (p: Place) => {
    const id = ++reqId.current; // descarta respuestas viejas si se busca otra ciudad mientras carga
    try {
      const data = await fetchWeather(p);
      if (id === reqId.current) setWeather({ status: "ok", data: { ...data, forPlace: p } });
    } catch (e) {
      if (id === reqId.current) setWeather((w) => (w.data ? w : { status: "error", error: msg(e) }));
    }
  }, []);

  const loadDolares = useCallback(async () => {
    try {
      setDolares({ status: "ok", data: await fetchDolares() });
    } catch (e) {
      setDolares((d) => (d.data ? d : { status: "error", error: msg(e) }));
    }
  }, []);

  /** El historial pesa: se pide una sola vez, cuando la sección del dólar se acerca a la pantalla. */
  const loadHistory = useCallback(async () => {
    if (historyStarted.current) return;
    historyStarted.current = true;
    for (const casa of HISTORY_CASAS) {
      const v = await fetchHistory(casa);
      setHistory((h) => ({ ...h, [casa]: v }));
    }
  }, []);

  useEffect(() => {
    void loadWeather(place).then(() => setUpdatedAt(new Date()));
  }, [place, loadWeather]);

  useEffect(() => {
    void loadDolares();
    const id = setInterval(() => {
      void loadWeather(placeRef.current);
      void loadDolares();
      setUpdatedAt(new Date());
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadDolares, loadWeather]);

  const search = useCallback(async (name: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      const p = await geocode(name);
      saveJSON("nexo:place", p);
      setPlace(p);
    } catch (e) {
      setSearchError(msg(e));
    } finally {
      setSearching(false);
    }
  }, []);

  return { place, weather, dolares, history, loadHistory, updatedAt, search, searching, searchError };
}
