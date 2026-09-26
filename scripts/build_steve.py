"""
Builds a classic Minecraft "Steve" body (head/torso/arms/legs cuboids) from scratch,
UV-unwrapped to the standard 64x64 Minecraft skin box-UV layout, and applies a given
skin PNG as its texture. Renders a screenshot and exports a GLB.

Why this exists: the bundled rig at
minecraft-player-rigged/extracted/player rigged/minecraft player rigged.blend
only contains a single "arm.L" mesh (verified by inspection) -- it is missing the
torso/legs/head, so anything exported through it is just a floating arm. This
script sidesteps that broken rig entirely using the well-documented public
Minecraft skin UV spec, so we can get a full-body preview without depending on it.

Usage:
  blender --background --python scripts/build_steve.py -- <skin.png> <out.glb> <out_render.png>
"""
import bpy
import sys

args = sys.argv[sys.argv.index("--") + 1:]
skin_path, out_glb, out_png = args[0], args[1], args[2]

SCALE = 1.0 / 16.0  # Minecraft pixel units -> Blender units


def box_uv_faces(u, v, w, h, d):
    """Standard Minecraft box-UV layout. w=width(x), h=height(z), d=depth(y)."""
    return {
        "top": (u + d, v, w, d),
        "bottom": (u + d + w, v, w, d),
        "right": (u, v + d, d, h),
        "front": (u + d, v + d, w, h),
        "left": (u + d + w, v + d, d, h),
        "back": (u + d + w + d, v + d, w, h),
    }


def px_rect_to_uv(rect):
    x, y, w, h = rect
    u0, u1 = x / 64.0, (x + w) / 64.0
    v0, v1 = 1.0 - (y + h) / 64.0, 1.0 - y / 64.0
    return u0, v0, u1, v1


def add_box(name, w, d, h, uv_u, uv_v, center):
    hw, hd = w / 2.0, d / 2.0
    verts = [
        (-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0),
        (-hw, -hd, h), (hw, -hd, h), (hw, hd, h), (-hw, hd, h),
    ]
    face_defs = {
        "bottom": (0, 1, 2, 3),
        "top": (4, 7, 6, 5),
        "front": (0, 4, 5, 1),
        "back": (2, 6, 7, 3),
        "right": (1, 5, 6, 2),
        "left": (3, 7, 4, 0),
    }
    face_order = ["bottom", "top", "front", "back", "right", "left"]
    faces = [face_defs[k] for k in face_order]

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    uv_layer = mesh.uv_layers.new(name="UVMap")
    uv_rects = box_uv_faces(uv_u, uv_v, w, h, d)
    for poly, key in zip(mesh.polygons, face_order):
        u0, v0, u1, v1 = px_rect_to_uv(uv_rects[key])
        corner_uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        for loop_idx, uv in zip(poly.loop_indices, corner_uvs):
            uv_layer.data[loop_idx].uv = uv

    obj = bpy.data.objects.new(name, mesh)
    obj.location = (center[0] * SCALE, center[1] * SCALE, center[2] * SCALE)
    obj.scale = (SCALE, SCALE, SCALE)
    bpy.context.collection.objects.link(obj)
    return obj


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    img = bpy.data.images.load(skin_path)
    img.colorspace_settings.name = "sRGB"

    mat = bpy.data.materials.new("SkinMat")
    mat.use_nodes = True
    mat.blend_method = "CLIP"
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    tex_node = nodes.new("ShaderNodeTexImage")
    tex_node.image = img
    tex_node.interpolation = "Closest"
    links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(tex_node.outputs["Alpha"], bsdf.inputs["Alpha"])

    # (name, w, d, h, uv_u, uv_v, center_xyz_in_px, legs offset front-back)
    parts = [
        ("Head", 8, 8, 8, 0, 0, (0, 0, 24)),
        ("Torso", 8, 4, 12, 16, 16, (0, 0, 12)),
        ("RightArm", 4, 4, 12, 40, 16, (-6, 0, 12)),
        ("LeftArm", 4, 4, 12, 32, 48, (6, 0, 12)),
        ("RightLeg", 4, 4, 12, 0, 16, (-2, 0, 0)),
        ("LeftLeg", 4, 4, 12, 16, 48, (2, 0, 0)),
    ]

    objs = []
    for name, w, d, h, uv_u, uv_v, center in parts:
        obj = add_box(name, w, d, h, uv_u, uv_v, center)
        obj.data.materials.append(mat)
        objs.append(obj)

    import mathutils
    bpy.context.view_layer.update()
    minv = mathutils.Vector((1e9, 1e9, 1e9))
    maxv = mathutils.Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for corner in o.bound_box:
            wc = o.matrix_world @ mathutils.Vector(corner)
            minv.x, minv.y, minv.z = min(minv.x, wc.x), min(minv.y, wc.y), min(minv.z, wc.z)
            maxv.x, maxv.y, maxv.z = max(maxv.x, wc.x), max(maxv.y, wc.y), max(maxv.z, wc.z)
    center = (minv + maxv) / 2
    size = (maxv - minv).length

    target = bpy.data.objects.new("Target", None)
    target.location = center
    bpy.context.collection.objects.link(target)

    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = center + mathutils.Vector((size * 0.45, -size * 1.35, size * 0.2))
    track = cam.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.2
    sun = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (0.9, 0.25, 0.6)

    fill_data = bpy.data.lights.new("Fill", type="SUN")
    fill_data.energy = 1.2
    fill = bpy.data.objects.new("Fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.rotation_euler = (1.2, -0.3, -2.4)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1000
    scene.render.film_transparent = True
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print("RENDER DONE:", out_png)

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format="GLB",
        use_selection=True,
    )
    print("GLB DONE:", out_glb)


main()
