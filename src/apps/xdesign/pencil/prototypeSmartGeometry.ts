export type SmartMatrix = [number, number, number, number, number, number];
export type SmartPose = { matrix: SmartMatrix; width: number; height: number; opacity: number; radii?: [number, number, number, number] };
export const smartIdentity = (): SmartMatrix => [1, 0, 0, 1, 0, 0];
export function smartMultiply(left: SmartMatrix, right: SmartMatrix): SmartMatrix {
  const [a, b, c, d, x, y] = left, [e, f, g, h, u, v] = right;
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h, a * u + c * v + x, b * u + d * v + y];
}
export function smartInverse(matrix: SmartMatrix): SmartMatrix {
  const [a, b, c, d, x, y] = matrix, determinant = a * d - b * c;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!matrix.every(Number.isFinite) || !scale || Math.abs((a / scale) * (d / scale) - (b / scale) * (c / scale)) < 1e-12) throw new Error('This layer has singular prototype geometry.');
  const inverse: SmartMatrix = [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * y - d * x) / determinant, (b * x - a * y) / determinant];
  if (!inverse.every(Number.isFinite)) throw new Error('This layer has singular prototype geometry.'); return inverse;
}
export function smartPoint(matrix: SmartMatrix, x: number, y: number): [number, number] { return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]; }
function decompose(matrix: SmartMatrix) {
  smartInverse(matrix);
  const [a, b, c, d, x, y] = matrix, sx = Math.hypot(a, b);
  return { rotation: Math.atan2(b, a), sx, sy: (a * d - b * c) / sx, shear: (a * c + b * d) / sx, x, y };
}
export function smartGeometryCompatible(from: SmartPose, to: SmartPose): boolean {
  try { const a = decompose(from.matrix), b = decompose(to.matrix); return from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0 && [from.width, from.height, to.width, to.height].every(Number.isFinite) && Math.sign(a.sy) === Math.sign(b.sy); } catch { return false; }
}
export function smartWorldAt(from: SmartPose, to: SmartPose, progress: number): SmartMatrix {
  if (!Number.isFinite(progress) || !smartGeometryCompatible(from, to)) throw new Error('This layer needs a dissolve instead of geometric interpolation.');
  if (progress === 0) return smartMultiply(from.matrix, [from.width / to.width, 0, 0, from.height / to.height, 0, 0]);
  if (progress === 1) return [...to.matrix];
  const a = decompose(from.matrix), b = decompose(to.matrix), lerp = (left: number, right: number) => left + (right - left) * progress;
  let turn = b.rotation - a.rotation; while (turn <= -Math.PI) turn += Math.PI * 2; while (turn > Math.PI) turn -= Math.PI * 2;
  const rotation = a.rotation + turn * progress, cos = Math.cos(rotation), sin = Math.sin(rotation), sx = lerp(a.sx, b.sx), sy = lerp(a.sy, b.sy), shear = lerp(a.shear, b.shear);
  const width = Math.max(0.0001, lerp(from.width, to.width)) / to.width, height = Math.max(0.0001, lerp(from.height, to.height)) / to.height;
  return [cos * sx * width, sin * sx * width, (cos * shear - sin * sy) * height, (sin * shear + cos * sy) * height, lerp(a.x, b.x), lerp(a.y, b.y)];
}
export function smartLocalAt(from: SmartPose, to: SmartPose, progress: number, layout: SmartMatrix, parent?: { from: SmartPose; to: SmartPose }): SmartMatrix {
  // Children interpolate in world space, compensating their parent's animated transform.
  const world = smartWorldAt(from, to, progress), parentWorld = parent ? smartWorldAt(parent.from, parent.to, progress) : smartIdentity();
  return smartMultiply(smartInverse(layout), smartMultiply(smartInverse(parentWorld), world));
}
export function smartCss(matrix: SmartMatrix): string { return `matrix(${matrix.map(value => Number(value.toFixed(8))).join(',')})`; }
