import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SNOISE_GLSL } from "./snoise";
import { useCoreReactions, sparkEnvelope } from "./coreReactions";
import { LiquidGlassPost } from "./LiquidGlassPost";

export type CoreMode = "launch" | "idle";

// ── art-direction constants ────────────────────────────────────────────────
// Red energy ramp. Token palette tops out at --neon-magenta #ff3ea5, so these
// are splash-local: magenta rim → red body → white-hot at the chaotic peak.
const COL_LOW = new THREE.Color("#4a0010"); // deep crimson (idle body)
const COL_MID = new THREE.Color("#ff1830"); // hot red
const COL_HOT = new THREE.Color("#fff2f2"); // white-hot (snap peak)
const COL_MAGENTA = new THREE.Color("#ff3ea5"); // shell rim accent
const COL_PARTICLE = new THREE.Color("#ff2a40");

const easeInCubic = (t: number) => t * t * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// ── core wireframe shaders (GPU vertex displacement) ───────────────────────
const CORE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uChaos;
  uniform float uFreq;
  varying float vDisp;
  ${SNOISE_GLSL}
  void main(){
    vec3 dir = normalize(position);
    float n  = snoise(dir * uFreq + uTime * 0.45);
    float n2 = snoise(dir * (uFreq * 2.1) - uTime * 0.7);
    float disp = (n * 0.7 + n2 * 0.3);
    vDisp = disp;
    vec3 displaced = position + normal * disp * uChaos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;
const CORE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uLow;
  uniform vec3 uMid;
  uniform vec3 uHot;
  uniform float uHeat;
  uniform float uOpacity;
  varying float vDisp;
  void main(){
    float t = clamp(vDisp * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uLow, uMid, smoothstep(0.15, 0.75, t));
    float hot = clamp(t * uHeat, 0.0, 1.0);
    col = mix(col, uHot, hot * hot);
    gl_FragColor = vec4(col, uOpacity);
  }
`;

// ── particle (matrix field) shaders ────────────────────────────────────────
const PT_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAssemble;
  uniform float uMode;      // 0 launch, 1 idle
  uniform float uSize;
  uniform float uSpark;     // keystroke envelope
  attribute vec3 aFar;
  attribute float aSeed;
  varying float vVis;
  void main(){
    float stream = fract(aSeed * 13.0 + uTime * (0.05 + aSeed * 0.09));
    float prog = mix(uAssemble, stream, uMode);
    vec3 pos = mix(aFar, position, prog);
    // a spark nudges particles outward, like the core throwing off energy
    pos += normalize(position) * uSpark * (0.12 + aSeed * 0.18);
    float vis = (uMode > 0.5)
      ? smoothstep(0.0, 0.18, stream) * (1.0 - smoothstep(0.82, 1.0, stream))
      : prog;
    vVis = vis;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.5 + aSeed) / max(0.1, -mv.z) * (1.0 + uSpark * 1.3);
  }
`;
const PT_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSpark;
  varying float vVis;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d) * vVis * uOpacity;
    if (a < 0.01) discard;
    // sparks flash toward white-hot and brighten
    vec3 col = mix(uColor, vec3(1.0, 0.86, 0.86), clamp(uSpark * 0.6, 0.0, 1.0));
    gl_FragColor = vec4(col, a * (1.0 + uSpark * 0.6));
  }
`;

function buildParticleGeometry(count: number): THREE.BufferGeometry {
  const near = new Float32Array(count * 3);
  const far = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // random direction on the sphere
    v.set(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ).normalize();
    const rNear = 1.05 + Math.random() * 0.7; // settle just outside the core
    near[i * 3] = v.x * rNear;
    near[i * 3 + 1] = v.y * rNear;
    near[i * 3 + 2] = v.z * rNear;
    // scattered far start — pushed out with lateral jitter so they "rush in
    // from the edges"
    const rFar = 5.5 + Math.random() * 5.5;
    far[i * 3] = v.x * rFar + (Math.random() * 2 - 1) * 1.6;
    far[i * 3 + 1] = v.y * rFar + (Math.random() * 2 - 1) * 1.6;
    far[i * 3 + 2] = v.z * rFar + (Math.random() * 2 - 1) * 1.6;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(near, 3));
  g.setAttribute("aFar", new THREE.BufferAttribute(far, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  return g;
}

function Scene({
  mode,
  reduced,
  particleCount,
}: {
  mode: CoreMode;
  reduced: boolean;
  particleCount: number;
}) {
  const group = useRef<THREE.Group>(null);
  const innerSpin = useRef<THREE.Group>(null);
  const shellSpin = useRef<THREE.Group>(null);
  const start = useRef<number>(0);

  const coreUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uChaos: { value: 0.12 },
      uFreq: { value: 1.7 },
      uLow: { value: COL_LOW.clone() },
      uMid: { value: COL_MID.clone() },
      uHot: { value: COL_HOT.clone() },
      uHeat: { value: 0.2 },
      uOpacity: { value: 0.95 },
    }),
    [],
  );
  const shellUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uChaos: { value: 0.08 },
      uFreq: { value: 1.1 },
      uLow: { value: COL_MAGENTA.clone().multiplyScalar(0.5) },
      uMid: { value: COL_MAGENTA.clone() },
      uHot: { value: COL_HOT.clone() },
      uHeat: { value: 0.15 },
      uOpacity: { value: 0.4 },
    }),
    [],
  );
  const ptUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAssemble: { value: mode === "idle" ? 1 : 0 },
      uMode: { value: mode === "idle" ? 1 : 0 },
      uSize: { value: 9.0 },
      uSpark: { value: 0 },
      uColor: { value: COL_PARTICLE.clone() },
      uOpacity: { value: 0.9 },
    }),
    [mode],
  );

  const coreMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        uniforms: coreUniforms,
        wireframe: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [coreUniforms],
  );
  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        uniforms: shellUniforms,
        wireframe: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [shellUniforms],
  );
  const ptMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: PT_VERT,
        fragmentShader: PT_FRAG,
        uniforms: ptUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [ptUniforms],
  );

  const coreGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 6), []);
  const shellGeo = useMemo(() => new THREE.IcosahedronGeometry(1.42, 2), []);
  const ptGeo = useMemo(
    () => buildParticleGeometry(reduced ? Math.min(particleCount, 140) : particleCount),
    [particleCount, reduced],
  );

  useFrame((state) => {
    if (start.current === 0) start.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - start.current;

    // Keystroke spark envelope (login interactivity) — read imperatively so
    // typing never re-renders the React tree.
    const env = sparkEnvelope(
      useCoreReactions.getState().impulses,
      performance.now(),
    );
    // Publish the envelope so the liquid-glass post pass flares with typing.
    state.scene.userData.spark = reduced ? env * 0.5 : env;

    if (reduced) {
      // Static-ish gentle glow: no assembly burst, minimal churn. Sparks still
      // register, but gently (no chaos flailing for reduced-motion users).
      coreUniforms.uTime.value = t * 0.15;
      coreUniforms.uChaos.value = 0.06;
      coreUniforms.uHeat.value = 0.22 + env * 0.3;
      shellUniforms.uTime.value = t * 0.12;
      shellUniforms.uHeat.value = 0.15 + env * 0.2;
      ptUniforms.uTime.value = t;
      ptUniforms.uAssemble.value = 1;
      ptUniforms.uSpark.value = env * 0.5;
      if (group.current) group.current.rotation.y = t * 0.08;
      return;
    }

    // assembly one-shot (launch) — slow build then violent snap at ~0.85s
    const assemble = mode === "idle" ? 1 : easeInCubic(clamp01(t / 0.85));
    // gaussian burst centred on the snap
    const burst = mode === "idle" ? 0 : Math.exp(-Math.pow((t - 0.85) / 0.16, 2));

    coreUniforms.uTime.value = t;
    coreUniforms.uChaos.value =
      mode === "idle" ? 0.1 : 0.12 + burst * 0.55 + (1 - assemble) * 0.15;
    coreUniforms.uHeat.value = mode === "idle" ? 0.22 : 0.22 + burst * 0.95;
    coreUniforms.uOpacity.value = mode === "idle" ? 0.85 : 0.4 + assemble * 0.55;

    shellUniforms.uTime.value = t;
    shellUniforms.uChaos.value = mode === "idle" ? 0.08 : 0.06 + burst * 0.3;
    shellUniforms.uHeat.value = mode === "idle" ? 0.15 : 0.15 + burst * 0.6;
    shellUniforms.uOpacity.value = mode === "idle" ? 0.34 : 0.18 + assemble * 0.24;

    ptUniforms.uTime.value = t;
    ptUniforms.uAssemble.value = assemble;
    ptUniforms.uOpacity.value = mode === "idle" ? 0.75 : 0.5 + assemble * 0.5;
    ptUniforms.uSpark.value = env;

    // Each keystroke flares the core (hotter + a touch more chaotic).
    coreUniforms.uHeat.value += env * 0.5;
    coreUniforms.uChaos.value += env * 0.1;
    shellUniforms.uHeat.value += env * 0.35;

    const spin = mode === "idle" ? 0.06 : 0.06 + burst * 1.4 + (1 - assemble) * 0.4;
    if (group.current) group.current.rotation.y += (spin + env * 0.35) * 0.016;
    if (innerSpin.current) {
      innerSpin.current.rotation.x += 0.003 + burst * 0.02;
      innerSpin.current.rotation.z += 0.002;
    }
    if (shellSpin.current) {
      shellSpin.current.rotation.y -= 0.004 + burst * 0.015;
      shellSpin.current.rotation.x -= 0.0025;
    }
  });

  return (
    <group ref={group}>
      <points geometry={ptGeo} material={ptMat} />
      <group ref={innerSpin}>
        <mesh geometry={coreGeo} material={coreMat} />
      </group>
      <group ref={shellSpin}>
        <mesh geometry={shellGeo} material={shellMat} />
      </group>
      <pointLight position={[0, 0, 3]} color={COL_MID} intensity={3} distance={9} />
    </group>
  );
}

export function EnergyCore({
  mode = "launch",
  reduced = false,
  particleCount = 1600,
}: {
  mode?: CoreMode;
  reduced?: boolean;
  particleCount?: number;
}) {
  return (
    <Canvas
      // Cold-start splash and the calm login backdrop both fully unmount once
      // the shell takes over, so "always" here costs nothing in normal use.
      frameloop="always"
      camera={{ position: [0, 0, 3.4], fov: 52 }}
      dpr={[1, 1.75]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.4} />
      <Scene mode={mode} reduced={reduced} particleCount={particleCount} />
      <LiquidGlassPost />
    </Canvas>
  );
}
