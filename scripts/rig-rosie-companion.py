"""Fit a humanoid rig locally when the Mixamo auto-rigger rejects the mesh."""

import json
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "scripts/characters-src/rosie-companion-2026-10-13"
JOINTS = {
    "Hips": ((0, 0, .53), (0, 0, .585), None),
    "Spine": ((0, 0, .585), (0, 0, .655), "Hips"),
    "Spine1": ((0, 0, .655), (0, 0, .73), "Spine"),
    "Spine2": ((0, 0, .73), (0, 0, .79), "Spine1"),
    "Neck": ((0, 0, .79), (0, 0, .835), "Spine2"),
    "Head": ((0, 0, .835), (0, 0, .975), "Neck"),
    "HeadTop_End": ((0, 0, .975), (0, 0, 1), "Head"),
}
for side, sign in [("Left", 1), ("Right", -1)]:
    def point(x, y, z):
        return (x * sign, y, z)

    for name, head, tail, parent in [
        ("Shoulder", point(.055, 0, .77), point(.145, 0, .765), "Spine2"),
        ("Arm", point(.145, 0, .765), point(.247, 0, .757), side + "Shoulder"),
        ("ForeArm", point(.247, 0, .757), point(.411, 0, .752), side + "Arm"),
        ("Hand", point(.411, 0, .752), point(.467, 0, .752), side + "ForeArm"),
        ("UpLeg", point(.076, 0, .53), point(.086, 0, .381), "Hips"),
        ("Leg", point(.086, 0, .381), point(.093, .006, .125), side + "UpLeg"),
        ("Foot", point(.093, .006, .125), point(.096, -.078, .065), side + "Leg"),
        ("ToeBase", point(.096, -.078, .065), point(.096, -.13, .065), side + "Foot"),
        ("Toe_End", point(.096, -.13, .065), point(.096, -.145, .065), side + "ToeBase"),
    ]:
        JOINTS[side + name] = (head, tail, parent)
    # These unweighted landmarks establish glove orientation without deforming a closed mitt.
    for digit, y, z in [("Index", -.014, .756), ("Thumb", -.020, .733)]:
        for segment in range(1, 5):
            x = .447 + (segment - 1) * .009
            JOINTS[f"{side}Hand{digit}{segment}"] = (
                point(x, y, z), point(x + .009, y, z),
                side + "Hand" if segment == 1 else f"{side}Hand{digit}{segment - 1}",
            )


def main():
    bpy.ops.wm.open_mainfile(filepath=str(BUNDLE / "sources/rosie-optimized.blend"))
    mesh = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
    armature = bpy.data.armatures.new("Rosie humanoid skeleton")
    rig = bpy.data.objects.new("Rosie Rig", armature)
    bpy.context.scene.collection.objects.link(rig)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, tail, parent) in JOINTS.items():
        bone = armature.edit_bones.new("mixamorig:" + name)
        bone.head, bone.tail = head, tail
        if parent:
            bone.parent = armature.edit_bones["mixamorig:" + parent]
        bone.use_deform = "HandIndex" not in name and "HandThumb" not in name and not name.endswith("_End")
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh.select_set(True)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    unweighted = []
    head_group = mesh.vertex_groups["mixamorig:Head"]
    hand_groups = {side: mesh.vertex_groups["mixamorig:" + side + "Hand"] for side in ["Left", "Right"]}
    for vertex in mesh.data.vertices:
        weights = [(group.group, group.weight) for group in vertex.groups if group.weight > 0]
        if not weights:
            unweighted.append(vertex.index)
        if vertex.co.z > .835 or (vertex.co.z > .815 and abs(vertex.co.x) < .23):
            for index, _ in weights:
                mesh.vertex_groups[index].remove([vertex.index])
            head_group.add([vertex.index], 1, "REPLACE")
        elif abs(vertex.co.x) > .425 and vertex.co.z > .66:
            for index, _ in weights:
                mesh.vertex_groups[index].remove([vertex.index])
            hand_groups["Left" if vertex.co.x > 0 else "Right"].add([vertex.index], 1, "REPLACE")
    assert not unweighted, f"Heat binding failed for {len(unweighted)} vertices"
    bpy.ops.wm.save_as_mainfile(filepath=str(BUNDLE / "sources/rosie-local-rig.blend"))
    bpy.ops.export_scene.fbx(
        filepath=str(BUNDLE / "sources/rosie-rigged.fbx"), use_selection=True,
        object_types={"MESH", "ARMATURE"}, bake_anim=False, add_leaf_bones=False,
        axis_forward="-Z", axis_up="Y",
    )
    report = {"method": "Local humanoid landmarks and Blender heat binding",
              "boneCount": len(armature.bones), "gloveLandmarksWeighted": False,
              "sourceVertices": len(mesh.data.vertices), "unweightedVertices": unweighted,
              "mixamoFailure": "Unknown error while generating motion"}
    (BUNDLE / "reports/rigging.json").write_text(json.dumps(report, indent=2) + "\n")
    print("ROSIE_LOCAL_RIG_READY", json.dumps(report), flush=True)


main()
