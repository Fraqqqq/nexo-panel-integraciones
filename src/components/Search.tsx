import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PULSE_CITIES, suggest, type Place } from "../lib/api";
import { countryCode } from "../lib/format";
import { Magnetic } from "./UI";

type Props = {
  current: Place;
  busy: boolean;
  error: string | null;
  onPick: (p: Place) => void;
  onSubmitText: (q: string) => void;
};

const byName = (n: string) => PULSE_CITIES.find((c) => c.city === n) as Place;
const QUICK: Place[] = [
  byName("Tokio"),
  { city: "Reikiavik", country: "Islandia", countryCode: "IS", latitude: 64.14, longitude: -21.9 },
  byName("Dubái"),
  byName("Nueva York"),
];

/** Buscador con autocompletado (geocoding de Open-Meteo), navegable con teclado y atajo "/". */
export function Search({ current, busy, error, onPick, onSubmitText }: Props) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      suggest(q, ctrl.signal)
        .then((r) => {
          setItems(r);
          setActive(0);
          setOpen(true);
        })
        .catch(() => {
          /* abortado o sin red: el submit igual funciona */
        });
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (p: Place) => {
    onPick(p);
    setQ("");
    setItems([]);
    setOpen(false);
    input.current?.blur();
  };

  const visible = open && q.trim().length >= 2 && items.length > 0;

  return (
    <div className="search-wrap">
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (visible && items[active]) choose(items[active]);
          else if (q.trim()) {
            onSubmitText(q.trim());
            setQ("");
            setOpen(false);
          }
        }}
      >
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>
        <label className="sr" htmlFor="city">
          Buscar ciudad
        </label>
        <input
          ref={input}
          id="city"
          role="combobox"
          aria-expanded={visible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={visible ? `${listId}-${active}` : undefined}
          maxLength={80}
          value={q}
          autoComplete="off"
          spellCheck={false}
          placeholder={`Buscá una ciudad… (ahora: ${current.city})`}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length < 2) setItems([]);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!visible) return;
            if (e.key === "ArrowDown") setActive((a) => (a + 1) % items.length);
            else if (e.key === "ArrowUp") setActive((a) => (a - 1 + items.length) % items.length);
            else if (e.key === "Escape") setOpen(false);
            else return;
            e.preventDefault();
          }}
        />
        <kbd className="kbd" aria-hidden="true">
          /
        </kbd>
        <Magnetic>
          <button className="btn" disabled={busy} data-cursor="ir">
            {busy ? "Viajando…" : "Ir"}
          </button>
        </Magnetic>
      </form>

      <AnimatePresence>
        {visible && (
          <motion.ul
            id={listId}
            role="listbox"
            className="suggest glass"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {items.map((p, i) => (
              <li
                key={`${p.city}-${p.latitude}-${p.longitude}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
              >
                <span className="cc">{countryCode(p.countryCode)}</span>
                <span className="s-name">{p.city}</span>
                <span className="s-meta">{[p.admin, p.country].filter(Boolean).join(", ")}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}

      <div className="quick" aria-label="Destinos rápidos">
        <span>Probá:</span>
        {QUICK.map((p) => (
          <button key={p.city} type="button" className="chip-btn" onClick={() => choose(p)}>
            <span className="cc">{countryCode(p.countryCode)}</span> {p.city}
          </button>
        ))}
      </div>
    </div>
  );
}
