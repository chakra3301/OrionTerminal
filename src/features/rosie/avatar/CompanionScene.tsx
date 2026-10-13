import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { CharacterModelBoundary } from "@/features/characters/CharacterModelBoundary";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as THREE from "three";
import { cloneCharacter, fitCharacter, characterBones, HorizontalRootAnchor } from "@/features/characters/modelInstance";
import { CompanionAnimator } from "@/features/characters/companionAnimator";
import { useVoice } from "@/store/voiceStore";
import { useRosie } from "@/features/rosie/rosieStore";
import { useCompanionMode, type CompanionMode } from "./companionMode";
import { useCompanionDebug } from "./companionDebugStore";
import { useCompanionProactive } from "./companionProactiveStore";
import { dragState } from "./dragState";
import { useCharacterStore } from "@/store/characterStore";
import {
  BUILTIN_CHARACTERS,
  type Character,
} from "@/features/characters/catalog";

const FIT_HEIGHT = 1.7;
const MODEL_FACING = 0;

// Procedural attention stays separate from the authored motion clips.
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

function CharacterCompanion({ url, mode }: { url: string; mode: CompanionMode }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => cloneCharacter(gltf.scene), [gltf.scene]);
  const frameWidth = useThree((s) => s.viewport.width);
  const fit = useMemo(() => fitCharacter(gltf.scene, FIT_HEIGHT, frameWidth * 0.8), [gltf.scene, frameWidth]);
  const bones = useMemo(() => characterBones(scene), [scene]);
  const animator = useRef<CompanionAnimator | null>(null);
  const anchor = useRef<HorizontalRootAnchor | null>(null);
  const swingRef = useRef<THREE.Group>(null);
  const visible = useRosie((s) => s.companionVisible);
  const motion = useRef({
    time: 0, lookW: 0, swingZ: 0, swingVZ: 0, swingX: 0, swingVX: 0,
    lastVisible: true, lastErr: false, lastGesture: 0,
  });
  const lookEuler = useMemo(() => new THREE.Euler(), []);
  const lookQuat = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => {
    const controller = new CompanionAnimator(scene, gltf.animations);
    animator.current = controller;
    anchor.current = new HorizontalRootAnchor(scene, bones.hips);
    useCompanionDebug.getState().setNames(controller.names);
    motion.current.lastVisible = useRosie.getState().companionVisible;
    motion.current.lastErr = Boolean(useRosie.getState().error);
    motion.current.lastGesture = useCompanionProactive.getState().gestureNonce;
    return () => {
      controller.dispose();
      animator.current = null;
      anchor.current = null;
    };
  }, [scene, gltf.animations, bones]);

  useEffect(() => {
    // Hidden canvases do not tick, so remember dismissal outside the frame loop.
    if (!visible) motion.current.lastVisible = false;
  }, [visible]);

  useFrame((_, rawDt) => {
    const controller = animator.current;
    if (!controller) return;
    const dt = Math.min(rawDt, 0.05);
    const r = motion.current;
    r.time += dt;
    const t = r.time;
    const dbg = useCompanionDebug.getState();
    const rosie = useRosie.getState();
    const gesture = useCompanionProactive.getState().gestureNonce;
    if (!dbg.testMode) {
      if (rosie.companionVisible && !r.lastVisible) controller.queue(controller.greeting);
      if (rosie.error && !r.lastErr) controller.queue(controller.error);
      if (gesture !== r.lastGesture) controller.queue(controller.gesture);
    }
    r.lastVisible = rosie.companionVisible;
    r.lastErr = Boolean(rosie.error);
    r.lastGesture = gesture;
    controller.update(dt, mode === "idle", dbg.testMode ? dbg.names[dbg.index] ?? null : null);
    anchor.current?.update();

    const lookTarget = !dbg.testMode && LOOK_AROUND_MODES.has(mode) ? 1 : 0;
    r.lookW += (lookTarget - r.lookW) * Math.min(1, dt * 2.5);
    if (r.lookW > 0.01 && bones.head) {
      const yaw = (Math.sin(t * 0.5) * 0.32 + Math.sin(t * 0.21) * 0.13) * r.lookW;
      const pitch = Math.sin(t * 0.37) * 0.08 * r.lookW;
      lookEuler.set(pitch, yaw, 0);
      lookQuat.setFromEuler(lookEuler);
      bones.head.quaternion.multiply(lookQuat);
      if (bones.neck) {
        lookEuler.set(pitch * 0.4, yaw * 0.4, 0);
        lookQuat.setFromEuler(lookEuler);
        bones.neck.quaternion.multiply(lookQuat);
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
    if (bones.spine) {
      lookEuler.set(held * 0.18, 0, r.swingZ * 0.25);
      lookQuat.setFromEuler(lookEuler);
      bones.spine.quaternion.multiply(lookQuat);
    }
    if (bones.head) {
      lookEuler.set(held * 0.12, 0, r.swingZ * 0.5);
      lookQuat.setFromEuler(lookEuler);
      bones.head.quaternion.multiply(lookQuat);
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
  const selectedId = useCharacterStore((s) => s.selectedId);
  const custom = useCharacterStore((s) => s.custom);
  const selected = useMemo<Character | null>(
    () =>
      [...BUILTIN_CHARACTERS, ...custom].find((c) => c.id === selectedId) ?? BUILTIN_CHARACTERS[0] ?? null,
    [selectedId, custom],
  );
  const placeholder = <Placeholder mode={mode} />;

  const inner = selected ? (
    <CharacterCompanion
      url={selected.custom ? convertFileSrc(selected.filePath) : selected.url}
      mode={mode}
    />
  ) : placeholder;

  const body = (
    <CharacterModelBoundary key={selectedId} fallback={placeholder}>
      <Suspense fallback={placeholder}>{inner}</Suspense>
    </CharacterModelBoundary>
  );
  return (
    <>
      <ModeLight mode={mode} />
      {body}
    </>
  );
}

// On "demand" the scene only renders when something calls invalidate(). This
// ticker invalidates at a capped FPS so the idle avatar animates at ~30fps
// instead of the GPU-pegging 60 — roughly halving her always-on cost while
// she's visible, with no visible difference for a small holographic blob.
function FrameThrottle({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = setInterval(() => invalidate(), 1000 / fps);
    invalidate();
    return () => clearInterval(id);
  }, [fps, invalidate]);
  return null;
}

export function CompanionScene({
  frameloop = "always",
}: {
  // "never" parks the render loop (dismissed / window hidden) so the one
  // long-lived WebGL context costs ~nothing when she isn't on screen.
  // "demand" + FrameThrottle keeps her alive but at a capped framerate.
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
      {frameloop === "demand" && <FrameThrottle fps={30} />}
    </Canvas>
  );
}

const defaultCharacter = BUILTIN_CHARACTERS[0];
if (defaultCharacter) useGLTF.preload(defaultCharacter.url);
