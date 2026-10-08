# NEXO · Panel de Integraciones

Dashboard web que integra **tres APIs externas** y muestra el resultado sobre un **globo 3D en tiempo real**, con **alertas por Telegram**.

Proyecto de la materia *Integraciones Web*.

## Qué integra

| Integración | Servicio | Uso |
|---|---|---|
| API REST | [Open-Meteo](https://open-meteo.com) (geocoding + forecast) | Clima actual y pronóstico de 24 h de cualquier ciudad |
| API REST | [DolarAPI](https://dolarapi.com) | Cotizaciones del dólar en Argentina |
| API REST | [ArgentinaDatos](https://argentinadatos.com) | Historial de 30 días para los gráficos |
| Bot / webhook saliente | [Telegram Bot API](https://core.telegram.org/bots/api) | Alertas cuando se supera un umbral |

## Lo que lo hace especial

- **Globo 3D con shaders propios (GLSL):** 70 000 puntos generados con una esfera de Fibonacci y filtrados con una máscara de agua, para dibujar solo los continentes. Al buscar una ciudad, el planeta viaja hasta ella con un marcador y una onda expansiva.
- **La interfaz reacciona al clima:** el color de toda la UI sigue a la temperatura, y si llueve o nieva aparece precipitación en la escena.
- **Vidrio con luz dinámica:** tarjetas con inclinación 3D, borde que sigue al cursor y gráficos que se dibujan al entrar en pantalla.
- **Alertas anti-spam:** cada regla se dispara una vez y se rearma cuando la condición vuelve a la normalidad.
- **Resiliente:** si una API falla, el resto sigue funcionando; las respuestas viejas se descartan si se busca otra ciudad mientras carga.

## Stack

React 19 · TypeScript (strict) · Vite · Three.js + React Three Fiber · Framer Motion · Lenis (scroll suave) · CSS puro.

## Rendimiento

- El globo (Three.js) se carga con `lazy`, así que el texto y el contenido aparecen primero.
- El render 3D se **pausa** cuando el usuario baja y el globo ya no se ve.
- El historial del dólar pesa ~500 KB por casa: se pide **solo al acercarse a la sección** y se **cachea 6 h**.
- `prefers-reduced-motion` desactiva animaciones, scroll suave y movimiento del globo.
- Resolución del canvas limitada (1.75× en desktop, 1.4× en mobile).

## Seguridad

- **CSP estricta** en producción (`script-src 'self'`, `connect-src` solo a las 5 APIs usadas, `object-src 'none'`) y `referrer: no-referrer`.
- **Cero `innerHTML` / `dangerouslySetInnerHTML`**: todo el contenido dinámico pasa por React; el texto enviado a Telegram se escapa.
- **Validación de entradas**: formato del token de BotFather y del chat ID antes de construir la URL; datos de `localStorage` validados antes de usarse.
- **El token del bot vive solo en tu navegador** (`localStorage`) y únicamente se envía a `api.telegram.org`.
  - ⚠️ Como toda app 100 % frontend, es un modelo de confianza personal: no compartas tu navegador ni uses un token de un bot importante. Para producción multiusuario, el envío debería hacerse desde un backend o función serverless.
- Sin dependencias de runtime innecesarias; `npm audit` en limpio.

## Correrlo

```bash
npm install
npm run dev        # desarrollo
npm run build      # type-check + build de producción
npm run preview    # servir el build
```

No requiere API keys.

### Activar las alertas

1. En Telegram, hablá con **@BotFather** → `/newbot` y copiá el token.
2. Abrí tu bot y mandale `/start`.
3. En la sección *Alertas* pegá el token, tocá **Detectar chat**, definí los umbrales y **Guardar reglas**.

## Estructura

```
src/
  App.tsx                 # layout y secciones
  components/Scene.tsx    # globo 3D, atmósfera, precipitación, estrellas (GLSL)
  components/UI.tsx       # Counter, Glass (tilt + spotlight), Spark, Reveal
  components/Alerts.tsx   # configuración de Telegram + motor de reglas
  lib/api.ts              # clientes de API, validación, Telegram
  lib/useLive.ts          # estado en vivo, refresco cada 5 min, descarte de respuestas viejas
public/earth-water.png    # máscara de agua para el globo
```

## Créditos

Máscara de agua de [three-globe](https://github.com/vasturiano/three-globe) (MIT). Datos de Open-Meteo, DolarAPI y ArgentinaDatos.
