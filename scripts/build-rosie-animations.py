"""Bake the existing Mixamo library onto Rosie's newly fitted auto-rig."""

import importlib.util
import hashlib
import json
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "scripts/characters-src/rosie-companion-2026-10-13"
MOTIONS = ROOT / "scripts/characters-src/mixamo-companion-library-2026-10-12"
HELPERS = ROOT / "scripts/lib/companion_blender.py"
spec = importlib.util.spec_from_file_location("companion_blender", HELPERS)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.fbx(filepath=str(BUNDLE / "sources/rosie-rigged.fbx"))
    rig = next(obj for obj in scene.objects if obj.type == "ARMATURE")
    mesh = next(obj for obj in scene.objects if obj.type == "MESH")
    rig.name, mesh.name = "Rosie Rig", "Rosie Mesh"
    rig.animation_data_create()
    rig.animation_data.action = None
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    rig.data.pose_position = "REST"
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(BUNDLE / "exports/rosie-static.glb"))
    imported = list(set(bpy.data.objects) - before)
    original = next(obj for obj in imported if obj.type == "MESH")
    mesh.data.materials.clear()
    for material in original.data.materials:
        mesh.data.materials.append(material)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    for vertex in mesh.data.vertices:
        groups = sorted([(group.group, group.weight) for group in vertex.groups], key=lambda group: group[1], reverse=True)
        assert groups, vertex.index
        kept = groups[:4]
        for index, _ in groups[4:]:
            mesh.vertex_groups[index].remove([vertex.index])
        total = sum(weight for _, weight in kept)
        assert total > 0
        for index, weight in kept:
            mesh.vertex_groups[index].add([vertex.index], weight / total, "REPLACE")
    rig.data.pose_position = "POSE"
    mapping = {bone.name: bone.name for bone in rig.data.bones}
    assert "mixamorig:Hips" in mapping
    motions = json.loads((MOTIONS / "sources/motion-catalog.json").read_text())["motions"]
    report = {"bones": len(rig.data.bones), "vertices": len(mesh.data.vertices), "clips": [],
              "preparedSha256": hashlib.sha256((BUNDLE / "exports/rosie-static.glb").read_bytes()).hexdigest(),
              "rigSha256": hashlib.sha256((BUNDLE / "sources/rosie-rigged.fbx").read_bytes()).hexdigest()}
    doc = binary = default = None
    for motion in motions:
        before = set(bpy.data.objects)
        source_path = (BUNDLE / "sources/angry.fbx") if motion["name"] == "Angry" else (MOTIONS / motion["file"])
        bpy.ops.import_scene.fbx(filepath=str(source_path))
        imported = list(set(bpy.data.objects) - before)
        source = next(obj for obj in imported if obj.type == "ARMATURE")
        bpy.context.view_layer.update()
        action, end, ratio = shared.retarget(rig, source, mapping, motion["name"])
        source_action = source.animation_data.action
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)
        if source_action.users == 0:
            bpy.data.actions.remove(source_action)
        bpy.context.view_layer.update()
        if doc is None:
            scene.frame_start, scene.frame_end = 0, end
            scene.frame_set(0)
            for obj in scene.objects:
                obj.select_set(obj in [rig, mesh])
            bpy.context.view_layer.objects.active = rig
            path = BUNDLE / "exports/rosie-base.glb"
            matrices = {obj: obj.matrix_basis.copy() for obj in [rig, mesh]}
            bpy.ops.export_scene.gltf(
                filepath=str(path), export_format="GLB", use_selection=True,
                export_animations=True, export_frame_range=True, export_force_sampling=True,
                export_animation_mode="SCENE", export_anim_scene_split_object=False,
                export_armature_object_remove=False,
            )
            for obj, matrix in matrices.items():
                obj.matrix_basis = matrix
            doc, binary = shared.glb_read(path)
            assert len(doc["animations"]) == 1
            doc["animations"][0]["name"] = motion["name"]
            default = action
        else:
            path = BUNDLE / f"reports/{motion['slug']}-motion.glb"
            shared.export_motion(rig, mesh, path, end)
            shared.merge_animation(doc, binary, path, motion["name"])
        record = {"name": motion["name"], "motionId": motion["id"], "frames": [0, end],
                  "duration": end / 30, "hipScale": ratio}
        report["clips"].append(record)
        print("ROSIE_CLIP_READY", json.dumps(record), flush=True)
    rig.animation_data.action = default
    scene.frame_start, scene.frame_end = 0, 120
    scene.frame_set(60)
    bpy.ops.wm.save_as_mainfile(filepath=str(BUNDLE / "exports/rosie-animation-library.blend"))
    shared.glb_write(BUNDLE / "exports/rosie-animations.glb", doc, binary)
    (BUNDLE / "reports/animation-build.json").write_text(json.dumps(report, indent=2) + "\n")
    print("ROSIE_LIBRARY_READY", len(doc["animations"]), flush=True)


main()
