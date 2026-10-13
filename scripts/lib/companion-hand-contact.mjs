import * as THREE from "three";

export function handContactGeometry(root, hands, rest) {
  const groups = hands.map((hand) => {
    const members = new Set();
    hand.wrist.traverse((bone) => { if (bone.isBone) members.add(bone); });
    const origin = new THREE.Vector3().setFromMatrixPosition(rest.get(hand.wrist).matrix);
    const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(rest.get(hand.wrist).rotation.clone().multiply(hand.local));
    const vertices = [];
    root.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
      const position = mesh.geometry.attributes.position;
      for (let index = 0; index < position.count; index++) {
        let weight = 0;
        for (let slot = 0; slot < 4; slot++) {
          if (members.has(mesh.skeleton.bones[indices.getComponent(index, slot)])) weight += weights.getComponent(index, slot);
        }
        if (weight < 0.5) continue;
        const point = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix);
        const along = point.sub(origin).dot(direction);
        if (along >= hand.palmLength * 0.1 && along <= hand.palmLength * 3) vertices.push({ mesh, index });
      }
    });
    if (vertices.length < 20) throw new Error(`Insufficient hand surface: ${hand.wrist.name}`);
    return vertices;
  });
  const margin = hands.reduce((sum, hand) => sum + hand.palmLength, 0) * 0.01;
  const referenceAxis = new THREE.Vector3().setFromMatrixPosition(rest.get(hands[0].wrist).matrix)
    .sub(new THREE.Vector3().setFromMatrixPosition(rest.get(hands[1].wrist).matrix)).normalize();
  const point = new THREE.Vector3();
  return {
    counts: groups.map((group) => group.length), margin,
    measure() {
      root.updateMatrixWorld(true);
      root.traverse((mesh) => { if (mesh.isSkinnedMesh) mesh.skeleton.update(); });
      // A rotating separation plane can let the wrists swap sides between animation keys.
      const axis = referenceAxis.clone();
      const extents = groups.map((group) => {
        let min = Infinity, max = -Infinity;
        for (const { mesh, index } of group) {
          mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
          const value = point.dot(axis); min = Math.min(min, value); max = Math.max(max, value);
        }
        return { min, max };
      });
      const gap = extents[0].min - extents[1].max;
      return { axis, gap, correction: Math.max(0, margin - gap) };
    },
  };
}
