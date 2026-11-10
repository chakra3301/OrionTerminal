import { getWorldMatrix, TransformMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';

type Point = { x: number; y: number };
function inverse(matrix: number[]) {
  if (!matrix.every(Number.isFinite)) throw new Error('Present this control with finite layer transforms.');
  const xLength = matrix[0]! ** 2 + matrix[3]! ** 2, yLength = matrix[1]! ** 2 + matrix[4]! ** 2, dot = matrix[0]! * matrix[1]! + matrix[3]! * matrix[4]!;
  if (Math.abs(xLength - 1) > 1e-5 || Math.abs(yLength - 1) > 1e-5 || Math.abs(dot) > 1e-5) throw new Error('Presentation controls support rotation and reflection, without scale or skew.');
  const result = TransformMatrix.invert(matrix);
  if (!result || !result.every(Number.isFinite)) throw new Error('Present this control with invertible layer transforms.');
  return result;
}
function ratioValue(ratio: number) {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error('Present this control with a finite value within its range.');
  return ratio;
}
const stableDelta = (value: number) => Math.abs(value) < 1e-9 ? 0 : value;
const point = (matrix: number[], x: number, y: number): Point => {
  if (![x, y, ...matrix].every(Number.isFinite)) throw new Error('Present this control with finite geometry.');
  const [mappedX, mappedY] = TransformMatrix.mapPoints(matrix, [x, y]);
  if (!Number.isFinite(mappedX) || !Number.isFinite(mappedY)) throw new Error('Present this control with finite geometry.');
  return { x: mappedX!, y: mappedY! };
};
const parentMatrix = (graph: SceneGraph, node: SceneNode) => node.parentId ? getWorldMatrix(graph.getNode(node.parentId)!, graph) : TransformMatrix.identity();

/** Position a thumb along the track's transformed local X axis, preserving its authored cross-axis offset. */
export function nativeThumbPosition(graph: SceneGraph, track: SceneNode, thumb: SceneNode, ratio: number) {
  ratioValue(ratio);
  const trackWorld = getWorldMatrix(track, graph), inverseTrack = inverse(trackWorld);
  const parentWorld = parentMatrix(graph, thumb), inverseParent = inverse(parentWorld);
  const thumbWorld = getWorldMatrix(thumb, graph), toTrack = TransformMatrix.multiply(inverseTrack, thumbWorld);
  const corners = [point(toTrack, 0, 0), point(toTrack, thumb.width, 0), point(toTrack, thumb.width, thumb.height), point(toTrack, 0, thumb.height)];
  const minX = Math.min(...corners.map(p => p.x)), maxX = Math.max(...corners.map(p => p.x));
  const origin = point(toTrack, 0, 0), span = maxX - minX, leadingOffset = minX - origin.x;
  const targetTrack = point(trackWorld, -leadingOffset + Math.max(0, track.width - span) * ratio, origin.y);
  const currentWorld = point(thumbWorld, 0, 0);
  const worldDelta = { x: targetTrack.x - currentWorld.x, y: targetTrack.y - currentWorld.y };
  const localDelta = point(inverseParent, worldDelta.x, worldDelta.y);
  const localZero = point(inverseParent, 0, 0);
  return { x: thumb.x + stableDelta(localDelta.x - localZero.x), y: thumb.y + stableDelta(localDelta.y - localZero.y) };
}

/** Exported CSS positions use the part parent's coordinates, with a vector for the transformed track axis. */
export function exportedThumbGeometry(graph: SceneGraph, track: SceneNode, thumb: SceneNode) {
  const trackWorld = getWorldMatrix(track, graph), inverseParent = inverse(parentMatrix(graph, thumb));
  const inverseTrack = inverse(trackWorld);
  const thumbWorld = getWorldMatrix(thumb, graph), toTrack = TransformMatrix.multiply(inverseTrack, thumbWorld);
  const corners = [point(toTrack, 0, 0), point(toTrack, thumb.width, 0), point(toTrack, thumb.width, thumb.height), point(toTrack, 0, thumb.height)];
  const minX = Math.min(...corners.map(p => p.x)), maxX = Math.max(...corners.map(p => p.x));
  const origin = point(toTrack, 0, 0), span = maxX - minX, leadingOffset = minX - origin.x;
  const trackStart = point(trackWorld, -leadingOffset, origin.y), trackEnd = point(trackWorld, Math.max(0, track.width - span) - leadingOffset, origin.y);
  const parentStart = point(inverseParent, trackStart.x, trackStart.y), parentEnd = point(inverseParent, trackEnd.x, trackEnd.y);
  const current = point(inverseParent, point(thumbWorld, 0, 0).x, point(thumbWorld, 0, 0).y);
  return { start: { x: thumb.x + parentStart.x - current.x, y: thumb.y + parentStart.y - current.y }, travel: { x: parentEnd.x - parentStart.x, y: parentEnd.y - parentStart.y } };
}

export function nativeRangeGeometry(graph: SceneGraph, track: SceneNode, range: SceneNode, ratio: number) {
  ratioValue(ratio);
  const trackWorld = getWorldMatrix(track, graph), inverseTrack = inverse(trackWorld);
  const parentWorld = parentMatrix(graph, range), inverseParent = inverse(parentWorld);
  const authoredOrigin = point(TransformMatrix.multiply(inverseTrack, getWorldMatrix(range, graph)), 0, 0);
  const relative = TransformMatrix.multiply(inverseParent, trackWorld);
  const reflected = relative[0]! * relative[4]! - relative[1]! * relative[3]! < 0;
  range.rotation = Math.atan2(reflected ? -relative[1]! : relative[3]!, relative[0]!) * 180 / Math.PI;
  range.flipX = false; range.flipY = reflected;
  range.width = track.width * ratio;
  const target = point(trackWorld, authoredOrigin.x, authoredOrigin.y), current = point(getWorldMatrix(range, graph), 0, 0);
  const delta = point(inverseParent, target.x - current.x, target.y - current.y), zero = point(inverseParent, 0, 0);
  range.x += stableDelta(delta.x - zero.x); range.y += stableDelta(delta.y - zero.y);
}

export function exportedRangeGeometry(graph: SceneGraph, track: SceneNode, range: SceneNode) {
  const trackWorld = getWorldMatrix(track, graph), inverseTrack = inverse(trackWorld);
  const inverseParent = inverse(parentMatrix(graph, range));
  const authoredOrigin = point(TransformMatrix.multiply(inverseTrack, getWorldMatrix(range, graph)), 0, 0);
  const relative = TransformMatrix.multiply(inverseParent, trackWorld);
  const target = point(trackWorld, authoredOrigin.x, authoredOrigin.y), position = point(inverseParent, target.x, target.y);
  return { left: position.x, top: position.y,
    matrix: [relative[0]!, relative[3]!, relative[1]!, relative[4]!] as [number, number, number, number] };
}
