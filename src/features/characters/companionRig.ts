import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { MOTION_PROFILES, SWING_SPRINGS, type CompanionId } from "./companionProfiles";
import { GESTURES, GESTURE_ROLES, SleeveRig } from "./sleeveGestures";
import { SwingSprings, withoutBakedSwing } from "./swingSprings";
import { RosieBodySprings, withoutBakedRosieBody } from "@/features/rosie/avatar/physics/RosieBodySprings";

export type CompanionRoles = {
  idle: string;
  greeting: string;
  gesture: string;
  error: string;
  fidgets: readonly string[];
  /** Reaction names from companionRequests → this companion's clip. */
  alias: Readonly<Record<string, string>>;
};

export const SLEEVE_ROLES: CompanionRoles = {
  idle: GESTURE_ROLES.idle,
  greeting: GESTURE_ROLES.greeting,
  gesture: GESTURE_ROLES.gesture,
  error: GESTURE_ROLES.error,
  fidgets: GESTURE_ROLES.fidgets,
  alias: {
    "Kneeling Pointing": GESTURE_ROLES.start,
    Clapping: GESTURE_ROLES.done,
    Angry: GESTURE_ROLES.error,
    Rejected: GESTURE_ROLES.refuse,
    Surprised: GESTURE_ROLES.question,
  },
};

type Baked = { clips: THREE.AnimationClip[]; center: THREE.Vector3; size: THREE.Vector3 };
const baked = new WeakMap<THREE.Object3D, Map<CompanionId, Baked>>();

/** Gesture clips + idle-pose bounds, baked once per loaded GLB and shared by every clone. */
function bakeOnce(source: THREE.Object3D, id: CompanionId): Baked {
  let byId = baked.get(source);
  if (!byId) baked.set(source, (byId = new Map()));
  const hit = byId.get(id);
  if (hit) return hit;
  const scene = cloneSkeleton(source);
  const rig = new SleeveRig(scene, MOTION_PROFILES[id]);
  const clips = rig.bakeAll();
  // Fit to the idle pose, not the wide bind pose, so the figure fills the frame.
  rig.apply(GESTURES.Idle!.pose(0, MOTION_PROFILES[id], MOTION_PROFILES[id].energy));
  const box = new THREE.Box3().setFromObject(scene, true);
  rig.reset();
  const result = { clips, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
  byId.set(id, result);
  return result;
}

export type PreparedCompanion = {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  roles: CompanionRoles;
  center: THREE.Vector3;
  size: THREE.Vector3;
  reset(): void;
  /** After the mixer: hair/sleeve swing (+ R.O.S.I.E's soft body). */
  updateSprings(rawDt: number, screenOffset?: THREE.Vector3): void;
  dispose(): void;
};

export function prepareCompanion(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, id: CompanionId): PreparedCompanion {
  const { clips, center, size } = bakeOnce(gltf.scene, id);
  const scene = cloneSkeleton(gltf.scene);
  scene.traverse((node) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) node.frustumCulled = false; });
  const swing = new SwingSprings(scene, SWING_SPRINGS[id]);
  const body = id === "rosie" ? new RosieBodySprings(scene) : null;
  // Gesture clips never key spring bones; filter anyway so a future clip can't fight the solver.
  const live = withoutBakedRosieBody(withoutBakedSwing(clips, SWING_SPRINGS[id]));
  return {
    scene, clips: live, roles: SLEEVE_ROLES, center, size,
    reset() { swing.reset(); body?.reset(); },
    updateSprings(rawDt, screenOffset) {
      swing.update(rawDt, undefined, screenOffset);
      body?.update(rawDt, undefined, screenOffset);
    },
    dispose() { swing.dispose(); body?.dispose(); },
  };
}
