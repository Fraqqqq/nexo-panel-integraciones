import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { detectChatId, escapeHtml, isChatId, isToken, sendTelegram, type Dolar, type Place, type Weather } from "../lib/api";
import { loadJSON, saveJSON } from "../lib/useLive";
import { Glass } from "./UI";

type Config = { token: string; chatId: string; dolarMax: string; tempMax: string };
type LogItem = { id: number; ok: boolean; text: string; at: string };

const EMPTY: Config = { token: "", chatId: "", dolarMax: "", tempMax: "" };
const money = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Error desconocido");

type Inputs = { weather?: Weather; dolares?: Dolar[]; place: Place };

export function Alerts({ weather, dolares, place }: Inputs) {
  const [cfg, setCfg] = useState<Config>(() => loadJSON("nexo:tg", EMPTY));
  const [log, setLog] = useState<LogItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const fired = useRef<Record<string, boolean>>(loadJSON("nexo:fired", {}));
  const seq = useRef(0);

  const push = useCallback((ok: boolean, text: string) => {
    setLog((l) => [{ id: ++seq.current, ok, text, at: new Date().toLocaleTimeString("es-AR") }, ...l].slice(0, 6));
  }, []);

  const ready = isToken(cfg.token.trim()) && isChatId(cfg.chatId.trim());
  const set = (k: keyof Config) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg((c) => ({ ...c, [k]: e.target.value }));

  const save = () => {
    saveJSON("nexo:tg", cfg);
    fired.current = {};
    saveJSON("nexo:fired", {});
    push(true, "Reglas guardadas");
  };

  // Motor de reglas: dispara una vez y se rearma cuando la condición se normaliza.
  useEffect(() => {
    const saved = loadJSON<Config>("nexo:tg", EMPTY);
    if (!isToken(saved.token) || !isChatId(saved.chatId)) return;
    const blue = dolares?.find((d) => d.casa === "blue");
    const rules: Array<[string, boolean, string]> = [];
    const dMax = Number(saved.dolarMax);
    if (saved.dolarMax !== "" && blue?.venta != null) {
      rules.push(["dolar", blue.venta > dMax, `<b>💵 Dólar blue sobre el umbral</b>\nVenta: <b>${money(blue.venta)}</b>\nUmbral: ${money(dMax)}`]);
    }
    const tMax = Number(saved.tempMax);
    // Solo se evalúa si el dato corresponde a la ciudad actual (evita alertas con clima de otra ciudad).
    if (saved.tempMax !== "" && weather && weather.forPlace === place) {
      rules.push([
        `temp:${place.city}`,
        weather.temp > tMax,
        `<b>🌡️ Alerta de temperatura</b>\n${escapeHtml(place.city)}: <b>${weather.temp}°C</b>\nUmbral: ${tMax}°C`,
      ]);
    }
    for (const [key, active, html] of rules) {
      if (active && !fired.current[key]) {
        fired.current[key] = true; // se marca antes de enviar para no duplicar en renders rápidos
        saveJSON("nexo:fired", fired.current);
        sendTelegram(saved.token, saved.chatId, html)
          .then(() => push(true, `Alerta enviada: ${key.split(":")[0]}`))
          .catch((e) => {
            fired.current[key] = false;
            saveJSON("nexo:fired", fired.current);
            push(false, `Telegram: ${errMsg(e)}`);
          });
      } else if (!active && fired.current[key]) {
        fired.current[key] = false;
        saveJSON("nexo:fired", fired.current);
      }
    }
  }, [weather, dolares, place, push]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      push(false, errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const test = () =>
    run("test", async () => {
      await sendTelegram(cfg.token.trim(), cfg.chatId.trim(), "<b>✅ NEXO conectado</b>\nLas alertas llegarán a este chat.");
      push(true, "Mensaje de prueba enviado");
    });

  const detect = () =>
    run("detect", async () => {
      const c = await detectChatId(cfg.token.trim());
      setCfg((s) => ({ ...s, chatId: c.id }));
      push(true, `Chat detectado: ${c.name}`);
    });

  return (
    <div className="alerts-grid">
      <Glass className="pad" tilt={3}>
        <h3>Conectar Telegram</h3>
        <ol className="steps">
          <li>
            Hablá con <b>@BotFather</b> → <code>/newbot</code> y copiá el token.
          </li>
          <li>Abrí tu bot nuevo y mandale <code>/start</code>.</li>
          <li>Pegá el token y tocá <b>Detectar chat</b>.</li>
        </ol>
        <label>
          Token del bot
          <input type="password" autoComplete="off" spellCheck={false} maxLength={80} placeholder="123456:ABC-DEF…" value={cfg.token} onChange={set("token")} />
        </label>
        <label>
          Chat ID
          <input inputMode="numeric" maxLength={20} placeholder="se completa solo" value={cfg.chatId} onChange={set("chatId")} />
        </label>
        <div className="row">
          <button className="btn ghost" onClick={detect} disabled={!cfg.token.trim() || busy !== null}>
            {busy === "detect" ? "Buscando…" : "Detectar chat"}
          </button>
          <button className="btn ghost" onClick={test} disabled={!ready || busy !== null}>
            {busy === "test" ? "Enviando…" : "Enviar prueba"}
          </button>
        </div>
        <p className="hint">El token vive solo en este navegador (localStorage) y únicamente se usa para hablar con api.telegram.org.</p>
      </Glass>

      <Glass className="pad" tilt={3}>
        <h3>Reglas de alerta</h3>
        <label>
          Dólar blue (venta) mayor a
          <input type="number" min="0" placeholder="1500" value={cfg.dolarMax} onChange={set("dolarMax")} />
        </label>
        <label>
          Temperatura en {place.city} mayor a (°C)
          <input type="number" placeholder="35" value={cfg.tempMax} onChange={set("tempMax")} />
        </label>
        <button className="btn" onClick={save}>
          Guardar reglas
        </button>
        <p className="hint">Cada alerta se envía una sola vez y se rearma cuando la condición vuelve a la normalidad: cero spam.</p>

        <ul className="log" aria-live="polite">
          <AnimatePresence initial={false}>
            {log.map((l) => (
              <motion.li key={l.id} className={l.ok ? "ok" : "bad"} initial={{ opacity: 0, x: -16, height: 0 }} animate={{ opacity: 1, x: 0, height: "auto" }} exit={{ opacity: 0 }}>
                <span className="dot" />
                <span>{l.text}</span>
                <time>{l.at}</time>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Glass>
    </div>
  );
}
