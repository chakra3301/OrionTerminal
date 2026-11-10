import copy
import json
import struct

import bpy


def glb_read(path):
    data = path.read_bytes()
    size, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4E4F534A
    doc = json.loads(data[20:20 + size])
    bin_size, bin_kind = struct.unpack_from("<II", data, 20 + size)
    assert bin_kind == 0x004E4942
    return doc, bytearray(data[28 + size:28 + size + bin_size])


def glb_write(path, doc, binary):
    doc["buffers"] = [{"byteLength": len(binary)}]
    text = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    text += b" " * (-len(text) % 4)
    binary += b"\0" * (-len(binary) % 4)
    output = struct.pack("<III", 0x46546C67, 2, 28 + len(text) + len(binary))
    output += struct.pack("<II", len(text), 0x4E4F534A) + text
    output += struct.pack("<II", len(binary), 0x004E4942) + binary
    temp = path.with_suffix(".glb.tmp")
    temp.write_bytes(output)
    temp.replace(path)


def merge_animation(doc, binary, motion_path, name):
    motion, data = glb_read(motion_path)
    assert len(motion["animations"]) == 1
    node_by_name = {node["name"]: i for i, node in enumerate(doc["nodes"])}
    joints = set(doc["skins"][0]["joints"])
    accessors, views = {}, {}

    def accessor(index):
        nonlocal binary
        if index in accessors:
            return accessors[index]
        a = copy.deepcopy(motion["accessors"][index])
        assert "sparse" not in a and "bufferView" in a
        old_view = a["bufferView"]
        if old_view not in views:
            v = copy.deepcopy(motion["bufferViews"][old_view])
            assert v.get("buffer", 0) == 0
            offset, length = v.get("byteOffset", 0), v["byteLength"]
            binary += b"\0" * (-len(binary) % 4)
            v["byteOffset"] = len(binary)
            binary.extend(data[offset:offset + length])
            v["buffer"] = 0
            views[old_view] = len(doc["bufferViews"])
            doc["bufferViews"].append(v)
        a["bufferView"] = views[old_view]
        accessors[index] = len(doc["accessors"])
        doc["accessors"].append(a)
        return accessors[index]

    animation = copy.deepcopy(motion["animations"][0])
    animation["name"] = name
    for sampler in animation["samplers"]:
        sampler["input"] = accessor(sampler["input"])
        sampler["output"] = accessor(sampler["output"])
    for channel in animation["channels"]:
        target = channel["target"]
        node_name = motion["nodes"][target["node"]]["name"]
        assert node_name in node_by_name, (name, node_name)
        target["node"] = node_by_name[node_name]
        assert target["node"] in joints, (name, node_name)
    channels = [(c["target"]["node"], c["target"]["path"]) for c in animation["channels"]]
    assert len(channels) == len(set(channels))
    doc["animations"].append(animation)


def hierarchy_depth(bone):
    return 0 if bone.parent is None else 1 + hierarchy_depth(bone.parent)


def retarget(target, source, mapping, label):
    source_action = source.animation_data.action
    first, last = [round(v) for v in source_action.frame_range]
    end = max(last - first, 30)
    rests = {b.name: b.matrix_local.copy() for b in target.data.bones}
    source_rests = {b.name: b.matrix_local.copy() for b in source.data.bones}
    sw, tw = source.matrix_world.copy(), target.matrix_world.copy()
    sr, tr = sw.to_quaternion(), tw.to_quaternion()
    hips = next(name for name, mapped in mapping.items() if mapped == "mixamorig:Hips")
    source_height = (sw.to_3x3() @ source_rests["mixamorig:Hips"].translation).length
    target_height = (tw.to_3x3() @ rests[hips].translation).length
    ratio = target_height / source_height
    ordered = sorted(target.pose.bones, key=hierarchy_depth)
    values = {b.name: {"rotation_quaternion": [], "location": []} for b in ordered}
    previous = {}
    target.animation_data.action = None
    for frame in range(end + 1):
        bpy.context.scene.frame_set(min(first + frame, last))
        desired_poses = {}
        for bone in ordered:
            rest, parent = rests[bone.name], bone.parent
            parent_pose = desired_poses[parent.name] if parent else None
            parent_rest = rests[parent.name] if parent else None
            inherited = parent_pose @ parent_rest.inverted() @ rest if parent else rest.copy()
            source_name = mapping.get(bone.name)
            if source_name in source_rests:
                source_pose = source.pose.bones[source_name].matrix
                delta = sr @ source_pose.to_quaternion() @ source_rests[source_name].to_quaternion().inverted() @ sr.inverted()
                rotation = tr.inverted() @ delta @ tr @ rest.to_quaternion()
                desired = rotation.to_matrix().to_4x4()
                desired.translation = inherited.translation
                if bone.name == hips:
                    displacement = sw.to_3x3() @ (source_pose.translation - source_rests[source_name].translation)
                    desired.translation += tw.inverted().to_3x3() @ (displacement * ratio)
            else:
                desired = inherited
            desired_poses[bone.name] = desired
            if parent:
                basis = bone.bone.convert_local_to_pose(desired, rest, parent_matrix=parent_pose, parent_matrix_local=parent_rest, invert=True)
            else:
                basis = bone.bone.convert_local_to_pose(desired, rest, invert=True)
            location, quaternion, _ = basis.decompose()
            if bone.name in previous and quaternion.dot(previous[bone.name]) < 0:
                quaternion.negate()
            previous[bone.name] = quaternion.copy()
            values[bone.name]["rotation_quaternion"].append(tuple(quaternion))
            values[bone.name]["location"].append(tuple(location))
    action = bpy.data.actions.new(label)
    action.use_fake_user = True
    for bone in ordered:
        bone.rotation_mode = "QUATERNION"
        bone.scale = (1, 1, 1)
        for property_name, samples in values[bone.name].items():
            data_path = bone.path_from_id(property_name)
            for component in range(len(samples[0])):
                curve = action.fcurves.new(data_path, index=component, action_group=bone.name)
                curve.keyframe_points.add(end + 1)
                coordinates = [v for frame, sample in enumerate(samples) for v in (frame, sample[component])]
                curve.keyframe_points.foreach_set("co", coordinates)
                for point in curve.keyframe_points:
                    point.interpolation = "LINEAR"
                curve.update()
    target.animation_data.action = action
    return action, end, ratio


def export_motion(rig, mesh, path, end):
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 0, end
    for obj in scene.objects:
        obj.select_set(False)
    rig.hide_set(False)
    rig.select_set(True)
    mesh.select_set(True)
    if rig.parent:
        rig.parent.select_set(True)
    if mesh.parent:
        mesh.parent.select_set(True)
    bpy.context.view_layer.objects.active = rig
    matrices = {obj: obj.matrix_basis.copy() for obj in [rig, mesh, rig.parent, mesh.parent] if obj}
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_materials="NONE", export_animations=True, export_frame_range=True, export_force_sampling=True, export_animation_mode="SCENE", export_anim_scene_split_object=False, export_armature_object_remove=False)
    for obj, basis in matrices.items():
        obj.matrix_basis = basis
    scene.frame_set(0)
