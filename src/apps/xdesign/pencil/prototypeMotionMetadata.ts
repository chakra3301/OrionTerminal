import { geometryCommandCoordCount, getNodeLocalMatrix, type Color, type GeometryPath, type SceneNode } from '@open-pencil/scene-graph';
import type { DesignMotion } from './reactExportRuntime';
const rounded = (value: number) => Number(value.toFixed(6));
const color = (value: Color): [number, number, number, number] => [value.r, value.g, value.b, value.a];
export function prototypePaintMetadata(fill: SceneNode['fills'][number]): DesignMotion['paints'][number] {
  const transform = ['IMAGE', 'VIDEO'].includes(fill.type) ? fill.imageTransform : fill.gradientTransform;
  return { type: fill.type, color: color(fill.color), opacity: fill.opacity, blend: fill.blendMode ?? 'NORMAL', ...(fill.gradientStops ? { stops: fill.gradientStops.map(stop => ({ position: stop.position, color: color(stop.color) })) } : {}), ...(transform ? { transform: [transform.m00, transform.m10, transform.m01, transform.m11, transform.m02, transform.m12] as DesignMotion['local'] } : {}), ...(fill.imageHash ? { image: fill.imageHash } : {}), ...(fill.imageScaleMode ? { scaleMode: fill.imageScaleMode } : {}) };
}
function normalizedPaths(paths: GeometryPath[], width: number, height: number): unknown[] {
  return paths.map(path => {
    const data = new DataView(path.commandsBlob.buffer, path.commandsBlob.byteOffset, path.commandsBlob.byteLength), commands: number[] = []; let offset = 0;
    while (offset < data.byteLength) {
      const command = data.getUint8(offset++), count = geometryCommandCoordCount(command);
      if (count === null || offset + count * 8 > data.byteLength) return { winding: path.windingRule, opaque: [...path.commandsBlob] };
      commands.push(command);
      for (let point = 0; point < count; point++) { commands.push(rounded(data.getFloat32(offset, true) / width), rounded(data.getFloat32(offset + 4, true) / height)); offset += 8; }
    }
    return { winding: path.windingRule, commands };
  });
}
export function prototypeMotionMetadata(node: SceneNode, root: boolean): DesignMotion {
  const width = node.width || 1, height = node.height || 1, network = node.vectorNetwork;
  const shape = JSON.stringify({ type: node.type, pointCount: node.pointCount, innerRadius: node.starInnerRadius, arc: node.arcData, operation: node.booleanOperation,
    network: network ? { vertices: network.vertices.map(vertex => ({ ...vertex, x: rounded(vertex.x / width), y: rounded(vertex.y / height) })), segments: network.segments.map(segment => ({ ...segment, tangentStart: { x: rounded(segment.tangentStart.x / width), y: rounded(segment.tangentStart.y / height) }, tangentEnd: { x: rounded(segment.tangentEnd.x / width), y: rounded(segment.tangentEnd.y / height) } })), regions: network.regions } : undefined,
    fill: normalizedPaths(node.fillGeometry, width, height), stroke: normalizedPaths(node.strokeGeometry, width, height) });
  const local = root ? [1, 0, 0, 1, 0, 0] as DesignMotion['local'] : (() => { const matrix = getNodeLocalMatrix(node); return [matrix[0], matrix[3], matrix[1], matrix[4], matrix[2], matrix[5]] as DesignMotion['local']; })();
  return { version: 1, root, type: node.type, shape, shadow: node.effects.some(effect => effect.visible && ['DROP_SHADOW', 'INNER_SHADOW'].includes(effect.type)), width: node.width, height: node.height, local,
    radii: node.independentCorners ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] : [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius],
    paints: node.fills.filter(fill => fill.visible).map(prototypePaintMetadata) };
}
