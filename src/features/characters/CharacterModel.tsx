import { useEffect, useMemo, useRef } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { resolveClips, versionedCharacterUrl } from "./catalog";
import { cloneCharacter, fitCharacter } from "./modelInstance";
import { prepareCompanion } from "./companionRig";
import type { CompanionId } from "./companionProfiles";

// One skinned character for previews: normalized to a unit height, idling,
// and greeting + a half turn when `selectSignal` changes. Built-in companions
// use the baked sleeve gestures and live hair/sleeve springs.
export function CharacterModel({
  url,
  companion,
  selectSignal = 0,
  turntable = true,
  fitHeight = 1.7,
  onReady,
}: {
  url: string;
  companion?: CompanionId;
  selectSignal?: number;
  turntable?: boolean;
  fitHeight?: number;
  onReady?: () => void;
}) {
  const gltf = useGLTF(versionedCharacterUrl(url));
  const group = useRef<THREE.Group>(null);
  const spin = useRef(0);

  const rig = useMemo(() => {
    if (companion) {
      const prepared = prepareCompanion(gltf, companion);
      return { scene: prepared.scene, clips: prepared.clips, idle: prepared.roles.idle, select: prepared.roles.greeting, prepared, center: prepared.center, size: prepared.size };
    }
    const scene = cloneCharacter(gltf.scene);
    const roles = resolveClips(gltf.animations.map((clip) => clip.name));
    const { scale, center } = fitCharacter(scene, 1);
    return { scene, clips: gltf.animations, idle: roles.idle, select: roles.select, prepared: null, center, size: new THREE.Vector3(1, 1 / scale, 1) };
  }, [gltf, companion]);

  const fit = useMemo(() => {
    const scale = fitHeight / (rig.size.y || 1);
    return { scale, x: -rig.center.x * scale, y: -rig.center.y * scale, z: -rig.center.z * scale };
  }, [rig, fitHeight]);

  const { actions, mixer } = useAnimations(rig.clips, rig.scene);

  useEffect(() => { onReady?.(); }, [onReady]);
  useEffect(() => () => rig.prepared?.dispose(), [rig]);

  useEffect(() => {
    if (!rig.idle) return;
    const idle = actions[rig.idle];
    idle?.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play();
    return () => { idle?.fadeOut(0.2); };
  }, [actions, rig.idle]);

  const previousSignal = useRef(selectSignal);
  useEffect(() => {
    if (previousSignal.current === selectSignal) return;
    previousSignal.current = selectSignal;
    spin.current = Math.PI * 2;
    if (!rig.select || rig.select === rig.idle) return;
    const select = actions[rig.select];
    const idle = rig.idle ? actions[rig.idle] : null;
    if (!select) return;
    rig.prepared?.reset();
    select.reset().setLoop(THREE.LoopOnce, 1);
    select.clampWhenFinished = true;
    idle?.fadeOut(0.2);
    select.fadeIn(0.2).play();
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== select) return;
      select.fadeOut(0.35);
      idle?.reset().fadeIn(0.35).play();
    };
    mixer.addEventListener("finished", onFinished);
    return () => mixer.removeEventListener("finished", onFinished);
  }, [selectSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    if (!group.current) return;
    if (turntable) group.current.rotation.y += dt * 0.35;
    if (spin.current > 0) {
      const step = Math.min(spin.current, dt * 7);
      group.current.rotation.y += step;
      spin.current -= step;
    }
    // Drei's useAnimations advances the mixer first; springs read the result.
    rig.prepared?.updateSprings(dt);
  });

  return (
    <group ref={group}>
      <primitive object={rig.scene} scale={fit.scale} position={[fit.x, fit.y, fit.z]} />
    </group>
  );
}
