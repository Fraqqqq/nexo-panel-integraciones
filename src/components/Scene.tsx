import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

type Props = {
  lat: number;
  lon: number;
  precip: 0 | 1 | 2;
  tint: string;
  reduced: boolean;
};

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

/** lat/lon → vector unitario (mismo mapeo que usa la máscara equirectangular). */
function latLon(lat: number, lon: number, out = new THREE.Vector3()) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return out.set(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
}

/** Puntos de una esfera Fibonacci filtrados con la máscara de agua: solo queda la tierra. */
function useLandPoints(count: number) {
  const [points, setPoints] = useState<Float32Array | null>(null);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}earth-water.png`;
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      const out: number[] = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < count; i++) {
        const y = 1 - (2 * (i + 0.5)) / count;
        const r = Math.sqrt(1 - y * y);
        const t = golden * i;
        const x = Math.cos(t) * r;
        const z = Math.sin(t) * r;
        const phi = Math.acos(y);
        let theta = Math.atan2(z, -x);
        if (theta < 0) theta += Math.PI * 2;
        const px = Math.min(width - 1, Math.floor((theta / (Math.PI * 2)) * width));
        const py = Math.min(height - 1, Math.floor((phi / Math.PI) * height));
        if (data[(py * width + px) * 4] < 110) out.push(x, y, z);
      }
      if (alive) setPoints(new Float32Array(out));
    };
    return () => {
      alive = false;
    };
  }, [count]);
  return points;
}

const pointsVert = /* glsl */ `
uniform float uTime; uniform vec3 uMarker; uniform float uDpr; uniform float uSize;
varying float vRing; varying float vNear; varying float vFace;
void main() {
  vec3 p = position;
  float d = acos(clamp(dot(normalize(p), uMarker), -1.0, 1.0));
  float r = fract(uTime * 0.16) * 3.14159;
  float ring = exp(-pow((d - r) * 5.5, 2.0)) * (1.0 - r / 3.14159);
  vRing = ring;
  vNear = smoothstep(0.5, 0.0, d);
  vec4 mv = modelViewMatrix * vec4(p * (1.0 + ring * 0.018), 1.0);
  vFace = normalize(mat3(modelViewMatrix) * p).z;
  gl_PointSize = (uSize + ring * 2.2 + vNear * 0.5) * uDpr * (7.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const pointsFrag = /* glsl */ `
uniform vec3 uTint; varying float vRing; varying float vNear; varying float vFace;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d);
  vec3 base = mix(uTint, vec3(0.55, 0.45, 1.0), 0.35);
  vec3 col = mix(base, vec3(1.0, 0.72, 0.45), vNear * 0.4) + vRing * vec3(0.2, 0.35, 0.4);
  float face = smoothstep(-0.2, 0.6, vFace);
  gl_FragColor = vec4(col, a * (0.15 + 0.85 * face) * (0.2 + vRing * 0.45 + vNear * 0.1));
}`;

const coreVert = /* glsl */ `
varying vec3 vN;
void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const coreFrag = /* glsl */ `
uniform vec3 uTint; varying vec3 vN;
void main() {
  float f = pow(1.0 - abs(vN.z), 2.6);
  gl_FragColor = vec4(mix(vec3(0.012, 0.02, 0.05), uTint * 0.4, f), 1.0);
}`;
const atmoFrag = /* glsl */ `
uniform vec3 uTint; varying vec3 vN;
void main() {
  float i = pow(max(0.68 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), 4.0);
  gl_FragColor = vec4(uTint * i * 0.85, i);
}`;

function Globe({ lat, lon, tint, reduced }: Omit<Props, "precip">) {
  const group = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const pts = useLandPoints(70_000);
  const marker = useMemo(() => latLon(lat, lon), [lat, lon]);
  const targetTint = useMemo(() => new THREE.Color(tint), [tint]);
  const { viewport } = useThree();

  const shared = useMemo(
    () => ({
      uTime: { value: 0 },
      uMarker: { value: new THREE.Vector3(0, 0, 1) },
      uDpr: { value: Math.min(window.devicePixelRatio, 1.75) },
      uSize: { value: 1.15 },
      uTint: { value: new THREE.Color(tint) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const markerPose = useMemo(() => {
    const q = new THREE.Quaternion().setFromUnitVectors(Y, marker);
    const qz = new THREE.Quaternion().setFromUnitVectors(Z, marker);
    return { q, qz };
  }, [marker]);

  const tmp = useMemo(
    () => ({ target: new THREE.Quaternion(), look: new THREE.Quaternion(), wob: new THREE.Quaternion(), e: new THREE.Euler(), pos: new THREE.Vector3() }),
    [],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    shared.uTime.value = t;
    shared.uMarker.value.copy(marker);
    shared.uTint.value.lerp(targetTint, 1 - Math.exp(-dt * 3));

    // La cámara apunta al marcador: el globo "vuela" hacia la ciudad buscada.
    tmp.look.setFromUnitVectors(marker, Z);
    const k = reduced ? 0 : 1;
    tmp.e.set(state.pointer.y * -0.18 * k, Math.sin(t * 0.15) * 0.22 * k + state.pointer.x * 0.28 * k, 0);
    tmp.wob.setFromEuler(tmp.e);
    tmp.target.copy(tmp.wob).multiply(tmp.look);
    group.current.quaternion.slerp(tmp.target, 1 - Math.exp(-dt * 2.4));

    // Scroll: el globo se corre y se achica para dejar leer las tarjetas.
    const p = Math.min(window.scrollY / window.innerHeight, 1);
    const wide = viewport.width > viewport.height * 1.05;
    const base = Math.min(1, viewport.width / 2.5);
    const s = THREE.MathUtils.lerp(base, base * 0.7, p);
    const x0 = wide ? viewport.width * 0.2 : 0;
    const y0 = wide ? 0 : viewport.height * 0.16;
    tmp.pos.set(THREE.MathUtils.lerp(x0, x0 * 1.25, p), THREE.MathUtils.lerp(y0, y0 + viewport.height * 0.12, p), -p * 0.8);
    group.current.position.lerp(tmp.pos, 1 - Math.exp(-dt * 4));
    group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x, s, 1 - Math.exp(-dt * 4)));

    // Anillo pulsante del marcador
    const pulse = (t * 0.9) % 1;
    ring.current.scale.setScalar(0.4 + pulse * 2.4);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.7;
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.985, 64, 64]} />
        <shaderMaterial vertexShader={coreVert} fragmentShader={coreFrag} uniforms={{ uTint: shared.uTint }} />
      </mesh>
      <mesh scale={1.16}>
        <sphereGeometry args={[1, 64, 64]} />
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
      {pts && (
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[pts, 3]} />
          </bufferGeometry>
          <shaderMaterial
            vertexShader={pointsVert}
            fragmentShader={pointsFrag}
            uniforms={shared}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      )}
      {/* marcador: núcleo + haz + anillo */}
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

function Precip({ type }: { type: 0 | 1 | 2 }) {
  const mat = useRef<THREE.ShaderMaterial>(null!);
  const { positions, seeds } = useMemo(() => {
    const n = 1800;
    const positions = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      positions.set([(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 7, Math.random() * 4.5 - 1], i * 3);
      seeds[i] = Math.random();
    }
    return { positions, seeds };
  }, []);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uType: { value: 1 }, uDpr: { value: Math.min(window.devicePixelRatio, 1.75) } }), []);
  useFrame((s) => {
    uniforms.uTime.value = s.clock.elapsedTime;
    uniforms.uType.value = type;
  });
  return (
    <points visible={type > 0} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial ref={mat} vertexShader={precipVert} fragmentShader={precipFrag} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Stars({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Points>(null!);
  const positions = useMemo(() => {
    const n = 2600;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(14 + Math.random() * 20);
      a.set([v.x, v.y, v.z], i * 3);
    }
    return a;
  }, []);
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

export default function Scene({ lat, lon, precip, tint, reduced }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const on = () => {
      wrap.current?.style.setProperty("--p", String(Math.min(window.scrollY / (window.innerHeight * 0.9), 1)));
      // Lejos del hero el globo es casi invisible: se frena el render para ahorrar GPU/batería.
      setPaused(window.scrollY > window.innerHeight * 1.6);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div className="scene" ref={wrap} aria-hidden="true">
      <Canvas
        dpr={[1, window.innerWidth < 760 ? 1.4 : 1.75]}
        frameloop={paused ? "never" : "always"}
        camera={{ position: [0, 0, 4.2], fov: 45 }}
        gl={{ antialias: false, powerPreference: "high-performance", alpha: true }}
        eventSource={document.getElementById("root") as HTMLElement}
        eventPrefix="client"
      >
        <Stars reduced={reduced} />
        <Globe lat={lat} lon={lon} tint={tint} reduced={reduced} />
        <Precip type={precip} />
      </Canvas>
    </div>
  );
}
