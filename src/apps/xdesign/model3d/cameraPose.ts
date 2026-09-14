/**
 * Port of img2threejs `forge/stage1_intake/solve_camera_pose.py`. This is
 * explicitly a heuristic starting guess, not a real photogrammetric solve —
 * upstream states this plainly ("fovDegrees is a genre default, not a
 * measurement"). It gives the agent something concrete to place a
 * `PerspectiveCamera` at and refine by eye against the reference overlay,
 * rather than guessing from scratch every time.
 */

export type ReferenceCamera = {
  fovDegrees: { value: number; source: "default-guess" | "user-supplied"; rationale: string };
  aspect: number;
  distance: { value: number; source: "placeholder" | "user-supplied" };
  position: [number, number, number];
  target: [number, number, number];
  note: string;
};

/** Product-photography reference images are usually shot on a mild
 * telephoto (avoids perspective distortion) — 35-50° vertical FOV is a
 * reasonable default band, narrower for tall/narrow subjects. */
function estimateFov(aspect: number): { fov: number; rationale: string } {
  if (aspect > 1.4) return { fov: 45, rationale: "wide/landscape aspect — assumed standard product-photo FOV" };
  if (aspect < 0.7) return { fov: 38, rationale: "tall/narrow aspect — assumed mild telephoto to avoid distortion" };
  return { fov: 42, rationale: "near-square aspect — assumed centered product-photo FOV" };
}

export function solveCameraPose(imageW: number, imageH: number, heightOffset = 0): ReferenceCamera {
  const aspect = imageH > 0 ? imageW / imageH : 1;
  const { fov, rationale } = estimateFov(aspect);
  const distance = 2.5;
  return {
    fovDegrees: { value: fov, source: "default-guess", rationale },
    aspect,
    distance: { value: distance, source: "placeholder" },
    position: [0, heightOffset, distance],
    target: [0, heightOffset, 0],
    note: "heuristic starting camera — not a measurement; refine by eye against the reference overlay in the viewport",
  };
}
