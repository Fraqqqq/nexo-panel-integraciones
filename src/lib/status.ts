import { useSyncExternalStore } from "react";

/** Salud de cada integración, alimentada por cada request real (latencia, último éxito, fallos seguidos). */
export type Source = "meteo" | "geo" | "air" | "dolar" | "history" | "fx" | "worldbank" | "wiki" | "holidays" | "quakes" | "github";
export type Health = { ok: boolean; ms?: number; at: number; fails: number; lastOk?: number };

let snapshot: Partial<Record<Source, Health>> = {};
const subs = new Set<() => void>();

export function track(src: Source, ok: boolean, ms?: number) {
  const prev = snapshot[src];
  const now = Date.now();
  snapshot = {
    ...snapshot,
    [src]: {
      ok,
      ms: ok && ms !== undefined ? Math.round(ms) : prev?.ms,
      at: now,
      fails: ok ? 0 : (prev?.fails ?? 0) + 1,
      lastOk: ok ? now : prev?.lastOk,
    },
  };
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const useStatus = () => useSyncExternalStore(subscribe, () => snapshot);

const subOnline = (f: () => void) => {
  window.addEventListener("online", f);
  window.addEventListener("offline", f);
  return () => {
    window.removeEventListener("online", f);
    window.removeEventListener("offline", f);
  };
};
export const useOnline = () => useSyncExternalStore(subOnline, () => navigator.onLine);

/** Re-render periódico para tiempos relativos ("hace 3 min") y relojes. */
let tick = 0;
const tickSubs = new Set<() => void>();
setInterval(() => {
  tick++;
  tickSubs.forEach((f) => f());
}, 1000);
export const useTick = () =>
  useSyncExternalStore(
    (f) => {
      tickSubs.add(f);
      return () => tickSubs.delete(f);
    },
    () => tick,
  );
