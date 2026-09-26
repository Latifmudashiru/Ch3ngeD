import bpy
import sys
import json
import os

default_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models", "lol", "aatrox.glb")
filepath = sys.argv[-1] if len(sys.argv) > 1 and sys.argv[-1].endswith(".glb") else default_path

print(f"Loading {filepath}...")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=filepath)

info = {
    "objects": [],
    "meshes": [],
    "armatures": [],
    "materials": [m.name for m in bpy.data.materials],
    "bones": []
}

for obj in bpy.data.objects:
    info["objects"].append({"name": obj.name, "type": obj.type})
    if obj.type == "MESH":
        info["meshes"].append({
            "name": obj.name,
            "materials": [m.name for m in obj.data.materials if m],
            "vertex_count": len(obj.data.vertices),
            "location": list(obj.location),
            "dimensions": list(obj.dimensions)
        })
    elif obj.type == "ARMATURE":
        info["armatures"].append(obj.name)
        info["bones"] = [b.name for b in obj.data.bones]

print("=== AATROX_STRUCTURE_START ===")
print(json.dumps(info, indent=2))
print("=== AATROX_STRUCTURE_END ===")
