import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Place, Pulse, Quake } from "../lib/api";
import { subsolar } from "../lib/format";

type Props = {
  lat: number;
  lon: number;
  precip: 0 | 1 | 2;
  tint: string;
  reduced: boolean;
  pulse: Pulse[];
  quakes: Quake[];
  onPick: (p: Place) => void;
  onFail: () => void;
};

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const DPR_CAP = typeof window !== "undefined" && window.innerWidth < 760 ? 1.25 : 1.5;
const LOW_KEY = "nexo:lowgpu";

/** lat/lon → vector unitario (mismo mapeo que usó scripts/build-globe.mjs). */
function latLon(lat: number, lon: number, out = new THREE.Vector3()) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return out.set(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
}

/** Reconstruye los puntos de tierra desde el bitset precalculado (globe.bin, ~9 KB). */
function useLandPoints() {
  const [pts, setPts] = useState<{ full: Float32Array; half: Float32Array } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${import.meta.env.BASE_URL}globe.bin`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`globe.bin HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const count = new DataView(buf).getUint32(0, true);
        const bits = new Uint8Array(buf, 4);
        const full: number[] = [];
        const half: number[] = [];
        const golden = Math.PI * (3 - Math.sqrt(5));
        let n = 0;
        for (let i = 0; i < count; i++) {
          if (!(bits[i >> 3] & (1 << (i & 7)))) continue;
          const y = 1 - (2 * (i + 0.5)) / count;
          const r = Math.sqrt(1 - y * y);
          const t = golden * i;
          const x = Math.cos(t) * r;
          const z = Math.sin(t) * r;
          full.push(x, y, z);
          if (n++ % 2 === 0) half.push(x, y, z);
        }
        setPts({ full: new Float32Array(full), half: new Float32Array(half) });
      })
      .catch(() => {
        /* sin máscara: el globo se ve como esfera con atmósfera, sin continentes */
      });
    return () => ctrl.abort();
  }, []);
  return pts;
}

// ---------- shaders ----------
const pointsVert = /* glsl */ `
uniform float uTime; uniform vec3 uMarker; uniform vec3 uSun; uniform float uDpr; uniform float uSize;
varying float vRing; varying float vNear; varying float vFace; varying float vDay;
void main() {
  vec3 n = normalize(position);
  float d = acos(clamp(dot(n, uMarker), -1.0, 1.0));
  float r = fract(uTime * 0.16) * 3.14159;
  float ring = exp(-pow((d - r) * 5.5, 2.0)) * (1.0 - r / 3.14159);
  vRing = ring;
  vNear = smoothstep(0.5, 0.0, d);
  vDay = smoothstep(-0.12, 0.28, dot(n, uSun));
  vec4 mv = modelViewMatrix * vec4(position * (1.0 + ring * 0.018), 1.0);
  vFace = normalize(mat3(modelViewMatrix) * position).z;
  gl_PointSize = (uSize + ring * 2.2 + vNear * 0.5) * uDpr * (7.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const pointsFrag = /* glsl */ `
uniform vec3 uTint; varying float vRing; varying float vNear; varying float vFace; varying float vDay;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d);
  vec3 day = mix(uTint, vec3(0.55, 0.45, 1.0), 0.35);
  vec3 night = vec3(1.0, 0.72, 0.45) * 0.95; // lado nocturno: tono cálido tipo luces de ciudad
  vec3 col = mix(night, day, vDay);
  col = mix(col, vec3(1.0, 0.72, 0.45), vNear * 0.4) + vRing * vec3(0.2, 0.35, 0.4);
  float face = smoothstep(-0.2, 0.6, vFace);
  float lum = mix(0.8, 1.0, vDay);
  gl_FragColor = vec4(col, a * lum * (0.15 + 0.85 * face) * (0.2 + vRing * 0.45 + vNear * 0.1));
}`;

const coreVert = /* glsl */ `
varying vec3 vN; varying vec3 vObj;
void main() { vN = normalize(normalMatrix * normal); vObj = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const coreFrag = /* glsl */ `
uniform vec3 uTint; uniform vec3 uSun; varying vec3 vN; varying vec3 vObj;
void main() {
  float f = pow(1.0 - abs(vN.z), 2.6);
  float day = smoothstep(-0.2, 0.4, dot(vObj, uSun));
  vec3 base = mix(vec3(0.006, 0.01, 0.025), vec3(0.016, 0.03, 0.06), day);
  gl_FragColor = vec4(mix(base, uTint * 0.4, f), 1.0);
}`;
const atmoFrag = /* glsl */ `
uniform vec3 uTint; varying vec3 vN;
void main() {
  float i = pow(max(0.68 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), 4.0);
  gl_FragColor = vec4(uTint * i * 0.85, i);
}`;

const arcVert = /* glsl */ `
attribute float aT; attribute float aSeed; uniform float uTime; varying float vA; varying float vHead;
void main() {
  float head = fract(uTime * 0.22 + aSeed * 0.137);
  float d = head - aT;
  float trail = d >= 0.0 ? exp(-d * 10.0) : 0.0;
  vHead = trail;
  vA = 0.08 + trail * 0.85;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const arcFrag = /* glsl */ `
uniform vec3 uTint; varying float vA; varying float vHead;
void main() { gl_FragColor = vec4(mix(uTint, vec3(1.0), vHead * 0.6), vA); }`;

type Shared = {
  uTime: { value: number };
  uMarker: { value: THREE.Vector3 };
  uSun: { value: THREE.Vector3 };
  uDpr: { value: number };
  uSize: { value: number };
  uTint: { value: THREE.Color };
};

/** Arcos tipo "paquete de datos" desde la ciudad actual hacia el pulso global. */
function Arcs({ from, to, shared, reduced }: { from: THREE.Vector3; to: THREE.Vector3[]; shared: Shared; reduced: boolean }) {
  const geo = useMemo(() => {
    const SEG = 64;
    const pos: number[] = [];
    const ts: number[] = [];
    const seeds: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    to.forEach((target, k) => {
      const ang = from.angleTo(target);
      if (ang < 0.05) return;
      const h = 0.04 + 0.18 * (ang / Math.PI);
      const sinA = Math.sin(ang);
      const at = (u: number, out: THREE.Vector3) =>
        out
          .copy(from)
          .multiplyScalar(Math.sin((1 - u) * ang) / sinA)
          .addScaledVector(target, Math.sin(u * ang) / sinA)
          .normalize()
          .multiplyScalar(1.004 + h * Math.sin(Math.PI * u));
      at(0, a);
      for (let s = 1; s <= SEG; s++) {
        at(s / SEG, b);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        ts.push((s - 1) / SEG, s / SEG);
        seeds.push(k, k);
        a.copy(b);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
    return g;
  }, [from, to]);
  // Geometría creada a mano: se libera explícitamente (R3F solo libera lo declarado en JSX).
  useEffect(() => () => geo.dispose(), [geo]);

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uTint: shared.uTint }), [shared]);
  useFrame((s) => {
    uniforms.uTime.value = reduced ? 0.6 : s.clock.elapsedTime;
  });

  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <shaderMaterial vertexShader={arcVert} fragmentShader={arcFrag} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </lineSegments>
  );
}

const quakeVert = /* glsl */ `
attribute float aMag; attribute float aPhase; uniform float uTime; uniform float uDpr; varying float vT;
void main() {
  float t = fract(uTime * 0.45 + aPhase);
  vT = t;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (3.0 + (aMag - 4.5) * 3.5) * (1.0 + t * 2.2) * uDpr * (7.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const quakeFrag = /* glsl */ `
varying float vT;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.3, 0.4, d) * (1.0 - vT);
  float core = smoothstep(0.16, 0.0, d) * (0.5 + 0.5 * (1.0 - vT));
  gl_FragColor = vec4(vec3(1.0, 0.36, 0.3), ring * 0.9 + core);
}`;

/** Sismos M4.5+ (USGS): anillos que pulsan, más grandes cuanto mayor la magnitud. */
function Quakes({ quakes, reduced }: { quakes: Quake[]; reduced: boolean }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    const mag: number[] = [];
    const phase: number[] = [];
    const v = new THREE.Vector3();
    quakes.forEach((q, i) => {
      latLon(q.lat, q.lon, v).multiplyScalar(1.006);
      pos.push(v.x, v.y, v.z);
      mag.push(Math.min(q.mag, 8));
      phase.push((i * 0.618) % 1);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aMag", new THREE.Float32BufferAttribute(mag, 1));
    g.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
    return g;
  }, [quakes]);
  useEffect(() => () => geo.dispose(), [geo]);
  const [uniforms] = useState(() => ({ uTime: { value: 0 }, uDpr: { value: 1 } }));
  useFrame((s) => {
    uniforms.uTime.value = reduced ? 0.3 : s.clock.elapsedTime;
    uniforms.uDpr.value = s.gl.getPixelRatio();
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial vertexShader={quakeVert} fragmentShader={quakeFrag} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

type GlobeProps = Pick<Props, "lat" | "lon" | "tint" | "reduced" | "pulse" | "quakes"> & {
  low: boolean;
  labels: RefObject<(HTMLButtonElement | null)[]>;
};

function Globe({ lat, lon, tint, reduced, low, pulse, quakes, labels }: GlobeProps) {
  const group = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const pts = useLandPoints();
  const marker = useMemo(() => latLon(lat, lon), [lat, lon]);
  const targets = useMemo(() => pulse.map((p) => latLon(p.place.latitude, p.place.longitude)), [pulse]);
  const pulsePositions = useMemo(() => new Float32Array(targets.flatMap((v) => [v.x * 1.004, v.y * 1.004, v.z * 1.004])), [targets]);
  const targetTint = useMemo(() => new THREE.Color(tint), [tint]);
  const { viewport, camera, size } = useThree();

  const [shared] = useState<Shared>(() => ({
    uTime: { value: 0 },
    uMarker: { value: new THREE.Vector3(0, 0, 1) },
    uSun: { value: new THREE.Vector3(0, 0, 1) },
    uDpr: { value: 1 },
    uSize: { value: 1.15 },
    uTint: { value: new THREE.Color(tint) },
  }));

  const markerPose = useMemo(
    () => ({ q: new THREE.Quaternion().setFromUnitVectors(Y, marker), qz: new THREE.Quaternion().setFromUnitVectors(Z, marker) }),
    [marker],
  );

  const [tmp] = useState(() => ({
    target: new THREE.Quaternion(),
    look: new THREE.Quaternion(),
    wob: new THREE.Quaternion(),
    e: new THREE.Euler(),
    pos: new THREE.Vector3(),
    w: new THREE.Vector3(),
    n: new THREE.Vector3(),
    v: new THREE.Vector3(),
    center: new THREE.Vector3(),
    sunAt: -1,
  }));

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    shared.uTime.value = reduced ? 1.2 : t;
    shared.uMarker.value.copy(marker);
    shared.uDpr.value = state.gl.getPixelRatio();
    shared.uTint.value.lerp(targetTint, 1 - Math.exp(-dt * 3));
    if (tmp.sunAt < 0 || t - tmp.sunAt > 30) {
      const s = subsolar();
      latLon(s.lat, s.lon, shared.uSun.value);
      tmp.sunAt = t;
    }

    // El globo "vuela" hasta la ciudad: el marcador queda mirando a cámara.
    tmp.look.setFromUnitVectors(marker, Z);
    const k = reduced ? 0 : 1;
    tmp.e.set(state.pointer.y * -0.18 * k, Math.sin(t * 0.15) * 0.22 * k + state.pointer.x * 0.28 * k, 0);
    tmp.wob.setFromEuler(tmp.e);
    tmp.target.copy(tmp.wob).multiply(tmp.look);
    group.current.quaternion.slerp(tmp.target, 1 - Math.exp(-dt * 2.4));

    // Scroll: el globo se corre y se achica para dejar leer las tarjetas.
    const p = Math.min(window.scrollY / window.innerHeight, 1);
    const wide = viewport.width > viewport.height * 1.05;
    const base = wide ? Math.min(1, viewport.width / 2.5) : Math.min(0.8, viewport.width / 2.3, viewport.height / 4.6);
    const sc = THREE.MathUtils.lerp(base, base * 0.7, p);
    const x0 = wide ? viewport.width * 0.2 : 0;
    // En vertical el globo ocupa la franja superior y el texto va debajo (sin superponerse).
    const y0 = wide ? 0 : viewport.height * 0.27;
    tmp.pos.set(THREE.MathUtils.lerp(x0, x0 * 1.25, p), THREE.MathUtils.lerp(y0, y0 + viewport.height * 0.12, p), -p * 0.8);
    group.current.position.lerp(tmp.pos, 1 - Math.exp(-dt * 4));
    group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x, sc, 1 - Math.exp(-dt * 4)));
    group.current.updateMatrixWorld();

    // Anillo pulsante del marcador
    const pulseT = reduced ? 0.35 : (t * 0.9) % 1;
    ring.current.scale.setScalar(0.4 + pulseT * 2.4);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulseT) * 0.7;

    // Etiquetas HTML del pulso global: proyección 3D → pantalla, ocultas del lado de atrás.
    const els = labels.current;
    if (!els) return;
    tmp.center.setFromMatrixPosition(group.current.matrixWorld);
    targets.forEach((local, i) => {
      const el = els[i];
      if (!el) return;
      tmp.w.copy(local).multiplyScalar(1.02).applyMatrix4(group.current.matrixWorld);
      tmp.n.copy(tmp.w).sub(tmp.center).normalize();
      tmp.v.copy(camera.position).sub(tmp.w).normalize();
      const facing = THREE.MathUtils.clamp((tmp.n.dot(tmp.v) - 0.2) / 0.3, 0, 1);
      tmp.w.project(camera);
      const x = ((tmp.w.x + 1) / 2) * size.width;
      const y = ((1 - tmp.w.y) / 2) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = facing.toFixed(2);
      el.style.pointerEvents = facing > 0.5 ? "auto" : "none";
    });
  });

  const land = pts ? (low ? pts.half : pts.full) : null;

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.985, 64, 64]} />
        <shaderMaterial vertexShader={coreVert} fragmentShader={coreFrag} uniforms={{ uTint: shared.uTint, uSun: shared.uSun }} />
      </mesh>
      <mesh scale={1.16}>
        <sphereGeometry args={[1, 48, 48]} />
        <shaderMaterial
          vertexShader={coreVert}
          fragmentShader={atmoFrag}
          uniforms={{ uTint: shared.uTint }}
          side={THREE.BackSide}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {land && (
        <points key={low ? "low" : "full"}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[land, 3]} />
          </bufferGeometry>
          <shaderMaterial vertexShader={pointsVert} fragmentShader={pointsFrag} uniforms={shared} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
      )}
      {targets.length > 0 && <Arcs from={marker} to={targets} shared={shared} reduced={reduced} />}
      {quakes.length > 0 && <Quakes quakes={quakes} reduced={reduced} />}
      {pulsePositions.length > 0 && (
        <points key={pulsePositions.length}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[pulsePositions, 3]} />
          </bufferGeometry>
          <pointsMaterial size={0.03} color="#ffffff" transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
      )}
      <group position={marker.clone().multiplyScalar(1.005)}>
        <mesh>
          <sphereGeometry args={[0.018, 16, 16]} />
          <meshBasicMaterial color="#ffd9a0" />
        </mesh>
        <group quaternion={markerPose.q}>
          <mesh position={[0, 0.16, 0]}>
            <cylinderGeometry args={[0.002, 0.002, 0.32, 6]} />
            <meshBasicMaterial color="#ffd9a0" transparent opacity={0.65} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
        <group quaternion={markerPose.qz}>
          <mesh ref={ring}>
            <ringGeometry args={[0.045, 0.052, 48]} />
            <meshBasicMaterial color="#ffd9a0" transparent side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

const precipVert = /* glsl */ `
attribute float aSeed; uniform float uTime; uniform float uType; uniform float uDpr;
void main() {
  vec3 p = position;
  float speed = uType < 1.5 ? 5.0 : 0.55;
  p.y = mod(p.y - uTime * speed * (0.6 + aSeed * 0.8) + 3.5, 7.0) - 3.5;
  if (uType > 1.5) p.x += sin(uTime * 0.8 + aSeed * 20.0) * 0.18;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (uType < 1.5 ? 1.5 : 3.4 * (0.5 + aSeed)) * uDpr * (5.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const precipFrag = /* glsl */ `
uniform float uType;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(0.75, 0.88, 1.0, smoothstep(0.5, 0.0, d) * (uType < 1.5 ? 0.4 : 0.75));
}`;

function makePrecip(n: number) {
  const positions = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    positions.set([(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 7, Math.random() * 4.5 - 1], i * 3);
    seeds[i] = Math.random();
  }
  return { positions, seeds };
}

function Precip({ type }: { type: 0 | 1 | 2 }) {
  const [{ positions, seeds }] = useState(() => makePrecip(1800));
  const [uniforms] = useState(() => ({ uTime: { value: 0 }, uType: { value: 1 }, uDpr: { value: 1 } }));
  useFrame((s) => {
    uniforms.uTime.value = s.clock.elapsedTime;
    uniforms.uType.value = type;
    uniforms.uDpr.value = s.gl.getPixelRatio();
  });
  return (
    <points visible={type > 0} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial vertexShader={precipVert} fragmentShader={precipFrag} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function makeStars(count: number) {
  const a = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(14 + Math.random() * 20);
    a.set([v.x, v.y, v.z], i * 3);
  }
  return a;
}

function Stars({ reduced, count }: { reduced: boolean; count: number }) {
  const ref = useRef<THREE.Points>(null!);
  const [positions] = useState(() => makeStars(count));
  useFrame((_, dt) => {
    if (!reduced) ref.current.rotation.y += dt * 0.006;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={1.15} sizeAttenuation={false} color="#a8bcff" transparent opacity={0.55} depthWrite={false} />
    </points>
  );
}

/** Mide FPS reales tras el arranque; si el equipo no llega, baja la calidad (y lo recuerda en la sesión). */
function QualityProbe({ onLow }: { onLow: () => void }) {
  const acc = useRef({ t: 0, frames: 0, done: false });
  useFrame((_, dt) => {
    const a = acc.current;
    if (a.done) return;
    a.t += dt;
    if (a.t < 1) return; // se ignora el primer segundo (compilación de shaders, carga)
    a.frames++;
    if (a.t > 3.5) {
      a.done = true;
      if (a.frames / (a.t - 1) < 50) onLow();
    }
  });
  return null;
}

function readLow() {
  try {
    return sessionStorage.getItem(LOW_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Scene({ lat, lon, precip, tint, reduced, pulse, quakes, onPick, onFail }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLButtonElement | null)[]>([]);
  const [paused, setPaused] = useState(false);
  const [low, setLow] = useState(readLow);

  useEffect(() => {
    const on = () => {
      wrap.current?.style.setProperty("--p", String(Math.min(window.scrollY / (window.innerHeight * 0.9), 1)));
      // Lejos del hero el globo es casi invisible: se frena el render para ahorrar GPU/batería.
      setPaused(window.scrollY > window.innerHeight * 0.85);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const goLow = () => {
    setLow(true);
    try {
      sessionStorage.setItem(LOW_KEY, "1");
    } catch {
      /* sin storage */
    }
  };

  return (
    <div className="scene" ref={wrap} data-quality={low ? "low" : "high"}>
      <Canvas
        aria-hidden="true"
        dpr={low ? 1 : [1, DPR_CAP]}
        frameloop={paused ? "never" : "always"}
        camera={{ position: [0, 0, 4.2], fov: 45 }}
        gl={{ antialias: false, powerPreference: "high-performance", alpha: true }}
        eventSource={document.getElementById("root") as HTMLElement}
        eventPrefix="client"
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            onFail();
          });
        }}
      >
        {!low && <QualityProbe onLow={goLow} />}
        <Stars key={low ? "s-low" : "s-high"} reduced={reduced} count={low ? 1200 : 2600} />
        <Globe lat={lat} lon={lon} tint={tint} reduced={reduced} low={low} pulse={pulse} quakes={quakes} labels={labels} />
        {!low && !reduced && <Precip type={precip} />}
      </Canvas>
      <div className="globe-labels">
        {pulse.map((p, i) => (
          <button
            key={p.place.city}
            ref={(el) => {
              labels.current[i] = el;
            }}
            className="glabel"
            tabIndex={-1}
            onClick={() => onPick(p.place)}
            title={`Ir a ${p.place.city}`}
          >
            <b>{Math.round(p.temp)}°</b>
            <span>{p.place.city}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
