"""Prepare the fitted Rosie export for the companion renderer and Mixamo."""

import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts/characters-src/cybernetic-girl-stylized-2026-10-13/project/rosie-stylized.glb"
BUNDLE = ROOT / "scripts/characters-src/rosie-companion-2026-10-13"
TARGET_TRIANGLES = 80000


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    for folder in ["sources", "exports", "reports"]:
        (BUNDLE / folder).mkdir(parents=True, exist_ok=True)
    source_hash = sha(SOURCE)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    assert len(meshes) == 1
    mesh = meshes[0]
    mesh.name = "Rosie Mesh"
    bpy.context.view_layer.objects.active = mesh
    for obj in bpy.context.scene.objects:
        obj.select_set(obj == mesh)
    world = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = world
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh.data.calc_loop_triangles()
    original_triangles = len(mesh.data.loop_triangles)
    original_vertices = len(mesh.data.vertices)
    # glTF UV islands split coincident vertices; rigging needs a connected surface.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.000001)
    bpy.ops.object.mode_set(mode="OBJECT")
    welded_vertices = len(mesh.data.vertices)
    modifier = mesh.modifiers.new("Companion geometry", "DECIMATE")
    modifier.ratio = TARGET_TRIANGLES / original_triangles
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    points = [vertex.co for vertex in mesh.data.vertices]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    height = maximum.z - minimum.z
    center = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
    for vertex in mesh.data.vertices:
        vertex.co = (vertex.co - center) / height
    mesh.data.update()
    mesh.data.calc_loop_triangles()
    for image in bpy.data.images:
        if image.size[0] > 2048 or image.size[1] > 2048:
            image.scale(2048, 2048)
        if image.type == "IMAGE":
            image.pack()
    bpy.ops.export_scene.gltf(
        filepath=str(BUNDLE / "exports/rosie-static.glb"), export_format="GLB",
        use_selection=True, export_animations=False,
    )
    # The upload needs geometry only; the matte atlas stays in the local GLB.
    materials = list(mesh.data.materials)
    mesh.data.materials.clear()
    bpy.ops.export_scene.fbx(
        filepath=str(BUNDLE / "sources/rosie-static-mixamo.fbx"), use_selection=True,
        object_types={"MESH"}, bake_anim=False, axis_forward="-Z", axis_up="Y",
    )
    for material in materials:
        mesh.data.materials.append(material)
    bpy.ops.wm.save_as_mainfile(filepath=str(BUNDLE / "sources/rosie-optimized.blend"))
    report = {
        "source": str(SOURCE.relative_to(ROOT)), "sourceSha256": source_hash,
        "sourceVertices": original_vertices, "sourceTriangles": original_triangles,
        "weldedVertices": welded_vertices,
        "vertices": len(mesh.data.vertices), "triangles": len(mesh.data.loop_triangles),
        "height": 1, "textureSize": 2048, "rigged": False,
        "staticSha256": sha(BUNDLE / "exports/rosie-static.glb"),
        "sourceUnchanged": sha(SOURCE) == source_hash,
    }
    assert report["sourceUnchanged"]
    (BUNDLE / "reports/preparation.json").write_text(json.dumps(report, indent=2) + "\n")
    print("ROSIE_PREPARED", json.dumps(report), flush=True)


main()
