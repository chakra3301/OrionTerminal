import { useEffect, useMemo, useRef } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { resolveClips } from "./catalog";

// One skinned character: clone (so the same cached GLB can render in several
// canvases), normalize to a unit height standing on the floor, loop its idle,
// and fire a one-shot "select" clip + spin when `selectSignal` changes.
export function CharacterModel({
  url,
  selectSignal = 0,
  turntable = true,
  fitHeight = 1.7,
  onReady,
}: {
  url: string;
  selectSignal?: number;
  turntable?: boolean;
  fitHeight?: number;
  onReady?: () => void;
}) {
  const gltf = useGLTF(url);
  const group = useRef<THREE.Group>(null);
  const spin = useRef(0); // remaining extra spin (radians)

  // Clone the scene + retarget the skeleton for this instance.
  const scene = useMemo(() => cloneSkeleton(gltf.scene), [gltf.scene]);

  // Fit to ~1.7 units tall and center the bounding box on the origin, so the
  // camera (aimed at 0,0,0) frames the whole body and the turntable spins
  // around the body's center rather than its feet.
  const fit = useMemo(() => {
    // The clone's world matrices are identity until updated; quantized geometry
    // bakes its dequant scale into node transforms, so measuring before this
    // gives a wildly wrong box (giant / off-frame models).
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const scale = fitHeight / (size.y || 1);
    return {
      scale,
      x: -center.x * scale,
      y: -center.y * scale,
      z: -center.z * scale,
    };
  }, [scene, fitHeight]);

  const { actions, names, mixer } = useAnimations(gltf.animations, scene);
  const clips = useMemo(() => resolveClips(names), [names]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  // Loop idle on mount.
  useEffect(() => {
    if (!clips.idle) return;
    const idle = actions[clips.idle];
    idle?.reset().fadeIn(0.3).play();
    return () => {
      idle?.fadeOut(0.2);
    };
  }, [actions, clips.idle]);

  // Fire the select one-shot when the signal bumps (skip initial 0).
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    spin.current = Math.PI * 2;
    if (!clips.select || clips.select === clips.idle) return;

    const select = actions[clips.select];
    const idle = clips.idle ? actions[clips.idle] : null;
    if (!select) return;
    select.reset();
    select.setLoop(THREE.LoopOnce, 1);
    select.clampWhenFinished = true;
    idle?.fadeOut(0.15);
    select.fadeIn(0.15).play();

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== select) return;
      select.fadeOut(0.3);
      idle?.reset().fadeIn(0.3).play();
    };
    mixer.addEventListener("finished", onFinished);
    return () => mixer.removeEventListener("finished", onFinished);
  }, [selectSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    if (!group.current) return;
    if (turntable) group.current.rotation.y += dt * 0.4;
    if (spin.current > 0) {
      const step = Math.min(spin.current, dt * 9);
      group.current.rotation.y += step;
      spin.current -= step;
    }
  });

  return (
    <group ref={group}>
      <primitive
        object={scene}
        scale={fit.scale}
        position={[fit.x, fit.y, fit.z]}
      />
    </group>
  );
}
