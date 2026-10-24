import { geometryCommandCoordCount } from '@open-pencil/scene-graph';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_POINTS = 1_000_000;
const MAX_FLOAT32 = 3.4028234663852886e38;

/** Interpolates equal-topology native geometry path blobs without touching either endpoint. */
export function interpolateNativeGeometryCommands(from: Uint8Array, to: Uint8Array, progress: number): Uint8Array | undefined {
  if (!Number.isFinite(progress) || Math.abs(progress) > 100 || from.byteLength !== to.byteLength || from.byteLength > MAX_BYTES) return;
  const fromView = new DataView(from.buffer, from.byteOffset, from.byteLength);
  const toView = new DataView(to.buffer, to.byteOffset, to.byteLength);
  let offset = 0, points = 0;
  while (offset < from.byteLength) {
    const command = from[offset]!, other = to[offset]!, coordinates = geometryCommandCoordCount(command);
    if (command !== other || coordinates === null) return;
    const end = offset + 1 + coordinates * 8;
    if (end > from.byteLength) return;
    points += coordinates;
    if (points > MAX_POINTS) return;
    for (let pair = 0; pair < coordinates; pair++) {
      const coordinate = offset + 1 + pair * 8;
      if (!Number.isFinite(fromView.getFloat32(coordinate, true)) || !Number.isFinite(fromView.getFloat32(coordinate + 4, true)) || !Number.isFinite(toView.getFloat32(coordinate, true)) || !Number.isFinite(toView.getFloat32(coordinate + 4, true))) return;
    }
    offset = end;
  }

  if (progress === 1) return to.slice();
  const result = from.slice();
  if (progress === 0) return result;
  const output = new DataView(result.buffer, result.byteOffset, result.byteLength);
  offset = 0;
  while (offset < from.byteLength) {
    const coordinates = geometryCommandCoordCount(from[offset]!)!;
    for (let pair = 0; pair < coordinates; pair++) {
      const coordinate = offset + 1 + pair * 8;
      for (const axisOffset of [0, 4]) {
        const a = fromView.getFloat32(coordinate + axisOffset, true), b = toView.getFloat32(coordinate + axisOffset, true);
        const value = a + (b - a) * progress;
        if (!Number.isFinite(value) || Math.abs(value) > MAX_FLOAT32) return;
        output.setFloat32(coordinate + axisOffset, value, true);
        if (!Number.isFinite(output.getFloat32(coordinate + axisOffset, true))) return;
      }
    }
    offset += 1 + coordinates * 8;
  }
  return result;
}
