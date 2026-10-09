// Precalcula qué puntos de una esfera Fibonacci caen sobre tierra firme.
// Salida: public/globe.bin = [uint32 count][bitset de `count` bits]  (~9 KB en vez de un PNG de 430 KB).
// El cliente reconstruye las posiciones con la misma fórmula, así que solo viaja 1 bit por punto.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const COUNT = 70_000;
const png = PNG.sync.read(readFileSync(new URL("./assets/earth-water.png", import.meta.url)));
const { width, height, data } = png;

const out = new Uint8Array(4 + Math.ceil(COUNT / 8));
new DataView(out.buffer).setUint32(0, COUNT, true);

const golden = Math.PI * (3 - Math.sqrt(5));
let land = 0;
for (let i = 0; i < COUNT; i++) {
  const y = 1 - (2 * (i + 0.5)) / COUNT;
  const r = Math.sqrt(1 - y * y);
  const t = golden * i;
  const x = Math.cos(t) * r;
  const z = Math.sin(t) * r;
  let theta = Math.atan2(z, -x);
  if (theta < 0) theta += Math.PI * 2;
  const px = Math.min(width - 1, Math.floor((theta / (Math.PI * 2)) * width));
  const py = Math.min(height - 1, Math.floor((Math.acos(y) / Math.PI) * height));
  // En la máscara el agua es blanca y la tierra negra.
  if (data[(py * width + px) * 4] < 110) {
    out[4 + (i >> 3)] |= 1 << (i & 7);
    land++;
  }
}

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/globe.bin", import.meta.url), out);
console.log(`globe.bin: ${land}/${COUNT} puntos de tierra, ${out.byteLength} bytes`);
