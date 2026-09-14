/**
 * Port of img2threejs `forge/stage3_build/bake_projected_texture.py` +
 * the "projection-first fidelity" recipe in
 * `grimoire/character/likeness_maximization.md`: put the reference's own
 * (de-lit) pixels on the mesh instead of approximating them procedurally —
 * upstream calls this the single biggest fidelity lever for a
 * reference-matched surface.
 *
 * This is real camera-projective UV mapping (the same technique behind
 * "camera projection" / decal-projection in DCC tools): re-solve each
 * vertex's UV from its position in the solved reference camera's NDC space,
 * so the crop image lands correctly on the mesh regardless of the mesh's
 * own parametric UVs. Coverage = fraction of vertices that are
 * front-facing and land inside the crop frame — low coverage means the
 * mesh has geometry the single reference view can't see (report per-region
 * confidence, per upstream, rather than faking full coverage).
 */

import * as THREE from "three";
import type { ReferenceCamera } from "./cameraPose";

export type ProjectionBakeResult = { dataUrl: string; coverage: number; cameraId: string };

/** Overwrites `geometry`'s `uv` attribute with camera-projected coordinates
 * and returns the resulting texture (a plain canvas → data URL passthrough
 * of the already-de-lit crop) plus coverage. Call BEFORE `buildMaterial` so
 * the projected UVs are baked into the geometry the material reads. */
export function bakeProjectedTexture(
  geometry: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
  refCamera: ReferenceCamera,
  deLitCropCanvas: HTMLCanvasElement,
  cameraId = "reference-camera",
): ProjectionBakeResult {
  const cam = new THREE.PerspectiveCamera(refCamera.fovDegrees.value, refCamera.aspect, 0.01, 100);
  cam.position.set(...refCamera.position);
  cam.lookAt(new THREE.Vector3(...refCamera.target));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const posAttr = geometry.getAttribute("position");
  const normAttr = geometry.getAttribute("normal");
  const uv = new Float32Array(posAttr.count * 2);
  const camForward = new THREE.Vector3();
  cam.getWorldDirection(camForward);

  let frontFacing = 0, inFrame = 0;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i).applyMatrix4(worldMatrix);
    const clip = v.clone().applyMatrix4(viewProj);
    const u = clip.x * 0.5 + 0.5;
    const y = clip.y * 0.5 + 0.5;
    uv[i * 2] = u;
    uv[i * 2 + 1] = y;
    if (normAttr) {
      n.fromBufferAttribute(normAttr, i).applyMatrix3(normalMatrix).normalize();
      if (n.dot(camForward) < 0) frontFacing++;
    } else {
      frontFacing++;
    }
    if (u >= 0 && u <= 1 && y >= 0 && y <= 1 && clip.z > -1 && clip.z < 1) inFrame++;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

  const coverage = posAttr.count ? Math.min(frontFacing, inFrame) / posAttr.count : 0;
  return { dataUrl: deLitCropCanvas.toDataURL("image/png"), coverage: Math.round(coverage * 1000) / 1000, cameraId };
}
