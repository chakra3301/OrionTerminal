import type { Fill, GradientTransform, SceneNode } from "@open-pencil/scene-graph";

export const IDENTITY_PAINT_TRANSFORM: GradientTransform = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
export function paintCenter(matrix: GradientTransform): [number, number] {
  return [matrix.m02 + (matrix.m00 + matrix.m01) / 2, matrix.m12 + (matrix.m10 + matrix.m11) / 2];
}
export function centerPaint(matrix: GradientTransform, center: [number, number]): GradientTransform {
  return { ...matrix, m02: center[0] - (matrix.m00 + matrix.m01) / 2, m12: center[1] - (matrix.m10 + matrix.m11) / 2 };
}
export function paintAngle(matrix: GradientTransform): number { return Math.atan2(matrix.m10, matrix.m00) * 180 / Math.PI; }
export function rotatePaint(matrix: GradientTransform, degrees: number): GradientTransform {
  const radians = (degrees - paintAngle(matrix)) * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return centerPaint({ ...matrix, m00: c * matrix.m00 - s * matrix.m10, m10: s * matrix.m00 + c * matrix.m10, m01: c * matrix.m01 - s * matrix.m11, m11: s * matrix.m01 + c * matrix.m11 }, paintCenter(matrix));
}
export function sizePaintAxis(matrix: GradientTransform, axis: "x" | "y", size: number): GradientTransform {
  const length = axis === "x" ? Math.hypot(matrix.m00, matrix.m10) : Math.hypot(matrix.m01, matrix.m11);
  if (!Number.isFinite(size) || size <= 0 || length < 1e-8) return matrix;
  const ratio = size / length;
  const next = axis === "x" ? { ...matrix, m00: matrix.m00 * ratio, m10: matrix.m10 * ratio } : { ...matrix, m01: matrix.m01 * ratio, m11: matrix.m11 * ratio };
  return centerPaint(next, paintCenter(matrix));
}
export function flipPaint(matrix: GradientTransform, axis: "x" | "y"): GradientTransform {
  return centerPaint(axis === "x" ? { ...matrix, m00: -matrix.m00, m10: -matrix.m10 } : { ...matrix, m01: -matrix.m01, m11: -matrix.m11 }, paintCenter(matrix));
}
export function validPaintTransform(matrix: GradientTransform): boolean {
  return Object.values(matrix).every(Number.isFinite) && Math.abs(matrix.m00 * matrix.m11 - matrix.m01 * matrix.m10) >= 1e-8;
}

/** Image transforms map normalized node coordinates into normalized source
 * coordinates. Match the installed renderer's implicit Fill/Tile geometry. */
export function initialImageTransform(fill: Fill, node: Pick<SceneNode, "width" | "height">, image: { width: number; height: number }): GradientTransform {
  if (fill.imageTransform) return { ...fill.imageTransform };
  if (fill.imageScaleMode === "TILE") return { ...IDENTITY_PAINT_TRANSFORM, m00: node.width / image.width, m11: node.height / image.height };
  const scale = Math.max(node.width / image.width, node.height / image.height);
  const width = node.width / (scale * image.width), height = node.height / (scale * image.height);
  return { m00: width, m01: 0, m02: (1 - width) / 2, m10: 0, m11: height, m12: (1 - height) / 2 };
}
