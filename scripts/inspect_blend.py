import json
import sys

import bpy


def object_summary(obj):
    return {
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
        "modifiers": [modifier.type for modifier in obj.modifiers],
        "dimensions": [round(value, 4) for value in obj.dimensions],
        "location": [round(value, 4) for value in obj.location],
    }


def main():
    bpy.ops.wm.open_mainfile(filepath=sys.argv[-1])
    objects = [object_summary(obj) for obj in bpy.context.scene.objects]
    print(json.dumps(objects, indent=2))


if __name__ == "__main__":
    main()
