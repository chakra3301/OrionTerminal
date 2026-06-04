import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useVoice } from "@/store/voiceStore";
import { useRosie } from "@/features/rosie/rosieStore";
import { useCompanionMode, type CompanionMode } from "./companionMode";
import { useCompanionDebug } from "./companionDebugStore";
import { useCompanionProactive } from "./companionProactiveStore";
import { dragState } from "./dragState";

// The merged companion (mesh + all 10 clips, built by scripts/build-companion-glb.mjs).
// null → holographic placeholder (also the graceful fallback if it fails to load).
const MODEL_URL: string | null = "/companion/companion.glb";

// Framing knobs. FIT_HEIGHT is how much of the camera frame her standing height
// fills — kept well under the visible frustum (~2.46u) so limbs/hair don't clip
// off the canvas edges while she moves.
const FIT_HEIGHT = 1.7;
const MODEL_FACING = 0; // radians; flip to Math.PI if she faces away

// Her resting loop. Idle_15 is the authored calm idle.
const IDLE_CLIP = "Idle_15";

// Clips she randomly plays as idle fidgets, then eases back to the idle loop.
// Falls are excluded (they end prone — would snap upright on the return); Arise
// is reserved for a future spawn-in one-shot.
const FIDGET_CLIPS = [
  "Agree_Gesture",
  "All_Night_Dance",
  "FunnyDancing_02",
  "Angry_To_Tantrum_Sit",
  "Crawl_and_Look_Back",
  "Depressed_Full_Turn_Left",
  "Walking",
  "Running",
  "Confident_Walk",
  "Formal_Bow",
  "Ground_Flip_and_Sweep_Up",
  "Idle_10",
  "Angry_Ground_Stomp_1",
];
const FIDGET_MIN_GAP = 120; // seconds — a random fidget every ~2–5 min (subtle,
const FIDGET_MAX_GAP = 300; // not constant; she mostly just idles in Idle_15)

// Event clips (user mapping). Spawn-in plays once when she appears; the error
// reaction when a R.O.S.I.E turn fails. (Spawn = Fall4 as requested; if it ends
// prone we can chain "Arise" to recover.)
const SPAWN_CLIPS = ["Fall4"];
const ERROR_CLIP = "Angry_To_Tantrum_Sit";
const GESTURE_CLIP = "Agree_Gesture"; // played when she proactively asks something
// Modes where she idly looks around (procedural head motion layered on Idle_15).
const LOOK_AROUND_MODES = new Set<CompanionMode>([
  "thinking",
  "working",
  "listening",
]);

const MODE_COLOR: Record<CompanionMode, string> = {
  idle: "#00e0ff",
  listening: "#39ff88",
  thinking: "#b14cff",
  working: "#e6ff3a",
  speaking: "#00e0ff",
};
const MODE_ENERGY: Record<CompanionMode, number> = {
  idle: 0.15,
  listening: 0.4,
  thinking: 0.5,
  working: 0.85,
  speaking: 0.6,
};

/** Live mic amplitude (0..1), only meaningful while she's listening. */
function listenAmplitude(): number {
  return useVoice.getState().amplitude;
}

// ── Holographic placeholder (fallback if the model fails to load) ──────────
function Placeholder({ mode }: { mode: CompanionMode }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const energy = useRef(0.15);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const target =
      MODE_ENERGY[mode] + (mode === "listening" ? listenAmplitude() * 1.1 : 0);
    energy.current += (Math.min(1, target) - energy.current) * Math.min(1, dt * 6);
    const e = energy.current;
    if (group.current) {
      group.current.position.y = Math.sin(t * 1.2) * 0.06;
      group.current.rotation.y = t * (0.25 + e * 0.9);
    }
    if (shell.current) {
      shell.current.rotation.x = t * 0.4;
      shell.current.rotation.z = -t * 0.25;
      shell.current.scale.setScalar(1.28 + e * 0.22 + Math.sin(t * 3) * 0.03 * e);
    }
    if (core.current) {
      const mat = core.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.6 + e * 2.4 + Math.sin(t * 6) * 0.18 * e;
      core.current.scale.setScalar(1 + e * 0.12);
    }
  });

  const color = MODE_COLOR[mode];
  return (
    <group ref={group}>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
      <mesh ref={shell}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.22} />
      </mesh>
      <pointLight position={[0, 0, 2]} color={color} intensity={2.2} distance={7} />
    </group>
  );
}

// ── Animation rig ──────────────────────────────────────────────────────────
type Rig = {
  mixer: THREE.AnimationMixer | null;
  clips: Record<string, THREE.AnimationClip>;
  idle: THREE.AnimationAction | null;
  action: THREE.AnimationAction | null; // current fidget / one-shot
  fadeOutAt: number;
  fading: boolean;
  nextAt: number;
  last: string;
  queue: string[]; // pending priority one-shots (spawn-in, error reaction)
  hips?: THREE.Bone;
  hipsRest?: THREE.Vector3;
  head?: THREE.Bone;
  neck?: THREE.Bone;
  spine?: THREE.Bone;
  lookW: number; // eased look-around weight
  // Drag ragdoll spring (pendulum swing of the whole body).
  swingZ: number;
  swingVZ: number;
  swingX: number;
  swingVX: number;
  lastVisible: boolean;
  lastErr: boolean;
  lastGesture: number;
  testAction: THREE.AnimationAction | null;
  testName: string;
};

const _lookEuler = new THREE.Euler();
const _lookQuat = new THREE.Quaternion();

/** Play a clip once (LoopOnce + clamp), crossfading out the idle loop. */
function startClipOnce(
  r: Rig,
  m: THREE.AnimationMixer,
  name: string,
  t: number,
) {
  const clip = r.clips[name];
  if (!clip) return;
  const a = m.clipAction(clip);
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  a.fadeIn(0.3).play();
  if (r.idle) r.idle.fadeOut(0.3);
  r.action = a;
  r.last = name;
  r.fadeOutAt = t + 0.3 + clip.duration;
  r.fading = false;
}

function RosieModel({ mode }: { mode: CompanionMode }) {
  const { scene, animations } = useGLTF(MODEL_URL as string);
  const rig = useRef<Rig>({
    mixer: null,
    clips: {},
    idle: null,
    action: null,
    fadeOutAt: 0,
    fading: false,
    nextAt: 75, // first random fidget ~75s in (not right after the entrance)
    last: "",
    queue: [],
    lookW: 0,
    swingZ: 0,
    swingVZ: 0,
    swingX: 0,
    swingVX: 0,
    lastVisible: false,
    lastErr: false,
    lastGesture: 0,
    testAction: null,
    testName: "",
  });
  const swingRef = useRef<THREE.Group>(null);

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    return { scale: FIT_HEIGHT / (size.y || 1), center };
  }, [scene]);

  useEffect(() => {
    const r = rig.current;
    const m = new THREE.AnimationMixer(scene);
    r.mixer = m;
    r.clips = {};
    for (const c of animations) r.clips[c.name] = c;
    r.action = null;
    r.fading = false;
    r.nextAt = 75;
    r.last = "";
    r.queue = [];
    r.lookW = 0;
    r.lastVisible = false;
    r.lastErr = false;
    r.lastGesture = useCompanionProactive.getState().gestureNonce;
    r.testAction = null;
    r.testName = "";

    // Register clip names for the clip-test overlay.
    useCompanionDebug.getState().setNames(Object.keys(r.clips).sort());

    // Start her resting idle loop.
    const idleClip = r.clips[IDLE_CLIP] ?? animations[0];
    if (idleClip) {
      const a = m.clipAction(idleClip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      r.idle = a;
    }

    // Bones we drive directly: root (keep her planted) + head/neck (look-around).
    scene.traverse((o) => {
      const b = o as THREE.Bone;
      if (!b.isBone) return;
      if (b.name === "Hips") {
        r.hips = b;
        r.hipsRest = b.position.clone();
      } else if (b.name === "Head") r.head = b;
      else if (b.name === "neck") r.neck = b;
      else if (b.name === "Spine") r.spine = b;
    });

    return () => {
      m.stopAllAction();
      r.mixer = null;
      r.idle = null;
      r.action = null;
    };
  }, [scene, animations]);

  useFrame((state, rawDt) => {
    const r = rig.current;
    const m = r.mixer;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05); // clamp post-pause spikes
    const t = state.clock.elapsedTime;
    m.update(dt);

    const dbg = useCompanionDebug.getState();
    if (dbg.testMode) {
      // Clip-test mode: loop whichever clip is selected, overriding everything.
      const want = dbg.names[dbg.index];
      if (want && want !== r.testName && r.clips[want]) {
        // Hard-reset every action first. `clipAction` returns a CACHED action
        // per clip, so the selected clip may BE the idle/fidget action —
        // fading specific actions would fade out the very one we're starting,
        // and fade-without-stop leaks weight-0 actions as you cycle. stopAllAction
        // sidesteps both (test mode overrides everything anyway).
        m.stopAllAction();
        r.action = null;
        r.fading = false;
        const a = m.clipAction(r.clips[want]);
        a.reset();
        a.setLoop(THREE.LoopRepeat, Infinity);
        a.clampWhenFinished = false;
        a.fadeIn(0.25).play();
        r.testAction = a;
        r.testName = want;
      }
    } else {
      // Leaving test mode → stop the test clip and restore the idle loop.
      if (r.testName) {
        r.testAction?.stop();
        r.testAction = null;
        r.testName = "";
        r.action?.stop();
        r.action = null;
        r.fading = false;
        r.idle?.reset().fadeIn(0.3).play();
        r.nextAt = t + 4;
      }

      // Event triggers: spawn-in when she appears, frustrated reaction on a
      // failed R.O.S.I.E turn. Queued as priority one-shots (play in any mode).
      const rs = useRosie.getState();
      if (rs.companionVisible && !r.lastVisible) {
        r.queue.push(...SPAWN_CLIPS);
        r.fadeOutAt = t; // cut any current fidget so the entrance plays now
      }
      r.lastVisible = rs.companionVisible;
      const hasErr = !!rs.error;
      if (hasErr && !r.lastErr) {
        r.queue.push(ERROR_CLIP);
        r.fadeOutAt = t;
      }
      r.lastErr = hasErr;
      const gestureNonce = useCompanionProactive.getState().gestureNonce;
      if (gestureNonce !== r.lastGesture) {
        r.lastGesture = gestureNonce;
        r.queue.push(GESTURE_CLIP);
        r.fadeOutAt = t;
      }

      // Fidget / one-shot machine. When the active clip ends, crossfade back to
      // the idle loop — re-enabling the idle action first, since three.js
      // disables an action once it fades to weight 0 (a bare fadeIn won't revive
      // it → nothing drives the bones → the T-pose).
      if (r.action) {
        if ((mode !== "idle" && !r.fading) || (!r.fading && t >= r.fadeOutAt)) {
          r.action.fadeOut(0.4);
          if (r.idle && r.queue.length === 0) {
            r.idle.enabled = true;
            r.idle.fadeIn(0.4);
          }
          r.fading = true;
        }
        if (r.fading && r.action.getEffectiveWeight() < 0.02) {
          r.action.stop();
          r.action = null;
          r.fading = false;
          r.nextAt =
            t + FIDGET_MIN_GAP + Math.random() * (FIDGET_MAX_GAP - FIDGET_MIN_GAP);
        }
      } else if (r.queue.length > 0) {
        startClipOnce(r, m, r.queue.shift()!, t);
      } else if (mode === "idle" && t >= r.nextAt) {
        const pool = FIDGET_CLIPS.filter((n) => r.clips[n] && n !== r.last);
        const name = pool[Math.floor(Math.random() * pool.length)];
        if (name) startClipOnce(r, m, name, t);
      }
    }

    // Keep her planted: lock root horizontal drift so locomotion clips play in
    // place (vertical stays free for sit/flip). Applied after mixer.update.
    if (r.hips && r.hipsRest) {
      r.hips.position.x = r.hipsRest.x;
      r.hips.position.z = r.hipsRest.z;
    }

    // Idle look-around: subtle organic head turn layered on top of whatever the
    // mixer produced, while she's thinking / working / listening.
    const lookTarget = !dbg.testMode && LOOK_AROUND_MODES.has(mode) ? 1 : 0;
    r.lookW += (lookTarget - r.lookW) * Math.min(1, dt * 2.5);
    if (r.lookW > 0.01 && r.head) {
      const yaw = (Math.sin(t * 0.5) * 0.32 + Math.sin(t * 0.21) * 0.13) * r.lookW;
      const pitch = Math.sin(t * 0.37) * 0.08 * r.lookW;
      _lookEuler.set(pitch, yaw, 0);
      _lookQuat.setFromEuler(_lookEuler);
      r.head.quaternion.multiply(_lookQuat);
      if (r.neck) {
        _lookEuler.set(pitch * 0.4, yaw * 0.4, 0);
        _lookQuat.setFromEuler(_lookEuler);
        r.neck.quaternion.multiply(_lookQuat);
      }
    }

    // Drag ragdoll: a damped-spring pendulum swing of the whole body toward the
    // drag motion. Velocity decays when she's held still so she settles upright;
    // on release the spring keeps its momentum and flops back to 0. Layered as a
    // parent-group rotation (rig-axis-independent → no T-pose risk).
    const ds = dragState;
    ds.vx -= ds.vx * Math.min(1, dt * 7);
    ds.vy -= ds.vy * Math.min(1, dt * 7);
    const tZ = ds.dragging ? THREE.MathUtils.clamp(-ds.vx * 0.22, -0.7, 0.7) : 0;
    const tX = ds.dragging ? THREE.MathUtils.clamp(ds.vy * 0.16, -0.5, 0.5) : 0;
    const K = 95;
    const C = 11; // < critical (≈19.5) → underdamped, so she overshoots/flops
    r.swingVZ += (K * (tZ - r.swingZ) - C * r.swingVZ) * dt;
    r.swingZ += r.swingVZ * dt;
    r.swingVX += (K * (tX - r.swingX) - C * r.swingVX) * dt;
    r.swingX += r.swingVX * dt;
    if (swingRef.current) {
      swingRef.current.rotation.z = r.swingZ;
      swingRef.current.rotation.x = r.swingX;
    }
    // Secondary floppiness: head/spine lag a bit beyond the body swing + a slump
    // while she's actually held, so she reads as limp rather than a rigid figure.
    const held = ds.dragging ? 1 : 0;
    if (r.spine) {
      _lookEuler.set(held * 0.18, 0, r.swingZ * 0.25);
      _lookQuat.setFromEuler(_lookEuler);
      r.spine.quaternion.multiply(_lookQuat);
    }
    if (r.head) {
      _lookEuler.set(held * 0.12, 0, r.swingZ * 0.5);
      _lookQuat.setFromEuler(_lookEuler);
      r.head.quaternion.multiply(_lookQuat);
    }
  });

  return (
    <group ref={swingRef}>
      <group rotation={[0, MODEL_FACING, 0]} scale={fit.scale}>
        <group position={[-fit.center.x, -fit.center.y, -fit.center.z]}>
          <primitive object={scene} />
        </group>
      </group>
    </group>
  );
}

/** Falls back to the placeholder if the model fails to load. */
class ModelBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A mode-colored aura light so her state reads at a glance (cyan idle, green
 * listening, violet thinking, yellow working) without swapping mocap clips. */
function ModeLight({ mode }: { mode: CompanionMode }) {
  const ref = useRef<THREE.PointLight>(null);
  const energy = useRef(0.2);
  useFrame((_, dt) => {
    const target =
      MODE_ENERGY[mode] + (mode === "listening" ? listenAmplitude() * 1.1 : 0);
    energy.current += (Math.min(1, target) - energy.current) * Math.min(1, dt * 6);
    if (ref.current) ref.current.intensity = 1.6 + energy.current * 4.5;
  });
  return (
    <pointLight
      ref={ref}
      position={[1.6, 1.4, 2.2]}
      color={MODE_COLOR[mode]}
      distance={12}
    />
  );
}

function Avatar() {
  const mode = useCompanionMode();
  const placeholder = <Placeholder mode={mode} />;
  const body = !MODEL_URL ? (
    placeholder
  ) : (
    <ModelBoundary fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <RosieModel mode={mode} />
      </Suspense>
    </ModelBoundary>
  );
  return (
    <>
      <ModeLight mode={mode} />
      {body}
    </>
  );
}

export function CompanionScene({
  frameloop = "always",
}: {
  // "never" parks the render loop (dismissed / window hidden) so the one
  // long-lived WebGL context costs ~nothing when she isn't on screen.
  frameloop?: "always" | "demand" | "never";
}) {
  return (
    <Canvas
      frameloop={frameloop}
      camera={{ position: [0, 0.15, 3.2], fov: 42 }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[2, 3, 4]} intensity={1.1} />
      <Avatar />
    </Canvas>
  );
}

if (MODEL_URL) useGLTF.preload(MODEL_URL);
