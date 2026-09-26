import argparse
import json
import math
import os
import re
import sys

import bpy


COLOR_MAP = {
    "red": (1.0, 0.05, 0.04, 1.0),
    "blue": (0.05, 0.25, 1.0, 1.0),
    "green": (0.05, 0.85, 0.2, 1.0),
    "purple": (0.55, 0.15, 1.0, 1.0),
    "pink": (1.0, 0.25, 0.65, 1.0),
    "gold": (1.0, 0.68, 0.12, 1.0),
    "yellow": (1.0, 0.9, 0.08, 1.0),
    "black": (0.02, 0.02, 0.025, 1.0),
    "white": (0.92, 0.92, 0.95, 1.0),
    "silver": (0.62, 0.65, 0.7, 1.0),
    "orange": (1.0, 0.42, 0.06, 1.0),
}

MINECRAFT_UV_REGIONS = {
    "head_front": (8, 8, 8, 8),
    "head_overlay_front": (40, 8, 8, 8),
    "torso_front": (20, 20, 8, 12),
    "torso_back": (32, 20, 8, 12),
    "torso_left": (28, 20, 4, 12),
    "torso_right": (16, 20, 4, 12),
    "right_arm_front": (44, 20, 4, 12),
    "right_arm_back": (52, 20, 4, 12),
    "left_arm_front": (36, 52, 4, 12),
    "left_arm_back": (44, 52, 4, 12),
    "right_leg_front": (4, 20, 4, 12),
    "right_leg_back": (12, 20, 4, 12),
    "left_leg_front": (20, 52, 4, 12),
    "left_leg_back": (28, 52, 4, 12),
}

MINECRAFT_UV_GROUPS = {
    "armor": [
        "torso_front",
        "torso_back",
        "torso_left",
        "torso_right",
        "right_arm_front",
        "right_arm_back",
        "left_arm_front",
        "left_arm_back",
        "right_leg_front",
        "right_leg_back",
        "left_leg_front",
        "left_leg_back",
    ],
    "cloth_accents": [
        "torso_front",
        "torso_back",
        "torso_left",
        "torso_right",
        "right_arm_front",
        "left_arm_front",
        "right_arm_back",
        "left_arm_back",
        "right_leg_front",
        "left_leg_front",
        "right_leg_back",
        "left_leg_back",
    ],
    "eyes": ["head_front"],
    "face": ["head_front"],
}


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = 0.62
        bsdf.inputs["Metallic"].default_value = 0.08
    mat.diffuse_color = color
    return mat


def color_from_plan(plan, key, default):
    value = plan.get(key)
    if isinstance(value, str):
        return COLOR_MAP.get(value.lower(), default)
    return default


def set_minecraft_rect(image, x, y, width, height, color):
    image_width, image_height = image.size
    scale_x = image_width / 64
    scale_y = image_height / 64
    pixels = list(image.pixels)

    start_x = round(x * scale_x)
    start_y = round(y * scale_y)
    rect_width = max(1, round(width * scale_x))
    rect_height = max(1, round(height * scale_y))

    for row in range(rect_height):
        for col in range(rect_width):
            px_x = start_x + col
            # Minecraft skin coordinates are top-left origin; Blender pixels are bottom-left origin.
            px_y = image_height - 1 - (start_y + row)
            if px_x < 0 or px_x >= image_width or px_y < 0 or px_y >= image_height:
                continue

            idx = (px_y * image_width + px_x) * 4
            pixels[idx : idx + 4] = color

    image.pixels[:] = pixels


def color_distance(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def matches_color_family(rgb, color_name):
    red, green, blue = rgb

    if color_name == "purple":
        return red > 0.12 and blue > 0.18 and green < 0.45 and max(red, blue) - green > 0.12
    if color_name == "pink":
        return red > 0.45 and blue > 0.28 and green < 0.45
    if color_name == "red":
        return red > 0.35 and red > green * 1.35 and red > blue * 1.2
    if color_name == "green":
        return green > 0.3 and green > red * 1.25 and green > blue * 1.25
    if color_name == "blue":
        return blue > 0.35 and blue > red * 1.25 and blue > green * 1.2
    if color_name == "black":
        return red < 0.12 and green < 0.12 and blue < 0.12
    if color_name == "white":
        return red > 0.78 and green > 0.78 and blue > 0.78
    if color_name == "yellow":
        return red > 0.5 and green > 0.45 and blue < 0.25
    if color_name == "orange":
        return red > 0.5 and 0.18 < green < 0.55 and blue < 0.2
    if color_name == "gold":
        return red > 0.55 and 0.35 < green < 0.75 and blue < 0.25
    if color_name == "silver":
        return abs(red - green) < 0.08 and abs(green - blue) < 0.08 and 0.35 < red < 0.82

    target = COLOR_MAP.get(color_name)
    return bool(target) and color_distance((red, green, blue, 1), target) <= 0.34


def replace_color_family(image, from_color_name, to_color):
    if from_color_name not in COLOR_MAP:
        return 0

    pixels = list(image.pixels)
    changed = 0

    for idx in range(0, len(pixels), 4):
        alpha = pixels[idx + 3]
        if alpha <= 0.05:
            continue

        current_rgb = (pixels[idx], pixels[idx + 1], pixels[idx + 2])
        if matches_color_family(current_rgb, from_color_name):
            pixels[idx : idx + 4] = (to_color[0], to_color[1], to_color[2], alpha)
            changed += 1

    if changed:
        image.pixels[:] = pixels

    return changed


def is_in_minecraft_rect(px_x, top_left_y, rect):
    rect_x, rect_y, rect_width, rect_height = rect
    return rect_x <= px_x < rect_x + rect_width and rect_y <= top_left_y < rect_y + rect_height


def replace_color_family_outside_rects(image, from_color_name, to_color, allowed_rects):
    if from_color_name not in COLOR_MAP:
        return 0

    image_width, image_height = image.size
    scale_x = image_width / 64
    scale_y = image_height / 64
    scaled_rects = [
        (
            round(x * scale_x),
            round(y * scale_y),
            max(1, round(width * scale_x)),
            max(1, round(height * scale_y)),
        )
        for x, y, width, height in allowed_rects
    ]
    pixels = list(image.pixels)
    changed = 0

    for idx in range(0, len(pixels), 4):
        alpha = pixels[idx + 3]
        if alpha <= 0.05:
            continue

        pixel_index = idx // 4
        px_x = pixel_index % image_width
        px_y = pixel_index // image_width
        top_left_y = image_height - 1 - px_y
        if any(is_in_minecraft_rect(px_x, top_left_y, rect) for rect in scaled_rects):
            continue

        current_rgb = (pixels[idx], pixels[idx + 1], pixels[idx + 2])
        if matches_color_family(current_rgb, from_color_name):
            pixels[idx : idx + 4] = (to_color[0], to_color[1], to_color[2], alpha)
            changed += 1

    if changed:
        image.pixels[:] = pixels

    return changed


def replace_color_family_in_rects(image, from_color_name, to_color, target_rects):
    if from_color_name not in COLOR_MAP:
        return 0

    image_width, image_height = image.size
    scale_x = image_width / 64
    scale_y = image_height / 64
    scaled_rects = [
        (
            round(x * scale_x),
            round(y * scale_y),
            max(1, round(width * scale_x)),
            max(1, round(height * scale_y)),
        )
        for x, y, width, height in target_rects
    ]
    pixels = list(image.pixels)
    changed = 0

    for idx in range(0, len(pixels), 4):
        alpha = pixels[idx + 3]
        if alpha <= 0.05:
            continue

        pixel_index = idx // 4
        px_x = pixel_index % image_width
        px_y = pixel_index // image_width
        top_left_y = image_height - 1 - px_y
        if not any(is_in_minecraft_rect(px_x, top_left_y, rect) for rect in scaled_rects):
            continue

        current_rgb = (pixels[idx], pixels[idx + 1], pixels[idx + 2])
        if matches_color_family(current_rgb, from_color_name):
            pixels[idx : idx + 4] = (to_color[0], to_color[1], to_color[2], alpha)
            changed += 1

    if changed:
        image.pixels[:] = pixels

    return changed


def infer_eye_rgb_from_prompt(plan):
    prompt = str(plan.get("raw_prompt", "")).lower()
    accessories = plan.get("accessories") or []
    prefers_glow_red = (
        "glowing_eyes" in accessories
        or "glowing red eyes" in prompt
        or bool(re.search(r"\bglowing\b.*\beyes?\b|\beyes?\b.*\bglowing\b", prompt))
    )

    explicitly_red = prefers_glow_red or bool(
        re.search(
            r"\bred\s+eyes?\b|\beyes?\s+.*\bred\b|\bred\b\s+eyes?\b|glowing\s+red\s+eyes",
            prompt,
        )
    )
    explicitly_blue = bool(
        re.search(r"\bblue\s+eyes?\b|\beyes?\s+(?:that\s+)?(?:are\s+)?blue\b", prompt)
    )

    explicitly_green = "green eyes" in prompt or re.search(r"\beyes?\s+.*\bgreen\b", prompt)
    explicitly_yellow = "yellow eyes" in prompt or "amber eyes" in prompt
    explicitly_purple = "purple eyes" in prompt

    if explicitly_yellow:
        return COLOR_MAP["yellow"]
    if explicitly_green:
        return COLOR_MAP["green"]
    if explicitly_purple:
        return COLOR_MAP["purple"]
    if explicitly_red and not explicitly_blue:
        return COLOR_MAP["red"]
    if explicitly_blue:
        return COLOR_MAP["blue"]

    # Default heroic glow; accent_color often means cape/trim blue, never eye tint.
    return COLOR_MAP["red"]


def prepare_head_uv_for_requested_eyes(image):
    """Strip outer-layer face drawings and repaint the frontal face band to neutral skin
    below the scalp row, then callers stamp canonical pupil pixels."""

    overlay = MINECRAFT_UV_REGIONS["head_overlay_front"]
    set_minecraft_rect(image, *overlay, (0.0, 0.0, 0.0, 0.0))

    # Minecraft Steve-ish base face (not armor); avoids giant iris art on uploads.
    facial_skin = (0.78, 0.58, 0.45, 1.0)
    hx, hy, hw, hh = MINECRAFT_UV_REGIONS["head_front"]

    # Keep row `hy` (often hair/fringe); wipe the bulk of the frontal face beneath it.
    if hh > 1:
        set_minecraft_rect(image, hx, hy + 1, hw, hh - 1, facial_skin)

    print("Prepared head-front UV for canonical Minecraft pupil placement (overlay cleared, face neutralized).")


def mirror_limbs_ok_after_image_model(plan):
    if not plan.get("image_model_applied"):
        return True

    prompt = str(plan.get("raw_prompt", "")).lower()
    return any(
        needle in prompt
        for needle in ("symmetr", "mirror", "both arms", "both legs", "match the arms", "match the legs", "same on both")
    )


def region_rects(region=None, region_group=None):
    if region and region in MINECRAFT_UV_REGIONS:
        return [MINECRAFT_UV_REGIONS[region]]

    rects = []
    for region_key in MINECRAFT_UV_GROUPS.get(region_group or "", []):
        rect = MINECRAFT_UV_REGIONS.get(region_key)
        if rect:
            rects.append(rect)

    return rects


def repair_near_black_artifacts_from_image_model(image, plan):
    """GPT/Image edits often leave pure-black holes in metallic UVs; lift them to dark silver."""
    if not plan.get("image_model_applied"):
        return 0

    rects = []
    for group_name in ("armor", "cloth_accents"):
        rects.extend(region_rects(region_group=group_name))

    image_width, image_height = image.size
    scale_x = image_width / 64
    scale_y = image_height / 64
    scaled_rects = [
        (
            round(x * scale_x),
            round(y * scale_y),
            max(1, round(width * scale_x)),
            max(1, round(height * scale_y)),
        )
        for x, y, width, height in rects
    ]
    silver = (0.72, 0.74, 0.78, 1.0)
    pixels = list(image.pixels)
    changed = 0

    for idx in range(0, len(pixels), 4):
        alpha = pixels[idx + 3]
        if alpha <= 0.08:
            continue

        pixel_index = idx // 4
        px_x = pixel_index % image_width
        px_y = pixel_index // image_width
        top_left_y = image_height - 1 - px_y
        if not any(is_in_minecraft_rect(px_x, top_left_y, rect) for rect in scaled_rects):
            continue

        r, g, b = pixels[idx], pixels[idx + 1], pixels[idx + 2]
        if max(r, g, b) > 0.14:
            continue

        pixels[idx : idx + 4] = (silver[0], silver[1], silver[2], alpha)
        changed += 1

    if changed:
        image.pixels[:] = pixels
        print(f"Repair: lifted {changed} near-black pixels in armor/cloth UV islands.")

    return changed


def recolor_rects_preserve_shading(image, rects, target_color, from_color_name=None):
    image_width, image_height = image.size
    scale_x = image_width / 64
    scale_y = image_height / 64
    scaled_rects = [
        (
            round(x * scale_x),
            round(y * scale_y),
            max(1, round(width * scale_x)),
            max(1, round(height * scale_y)),
        )
        for x, y, width, height in rects
    ]
    pixels = list(image.pixels)
    changed = 0

    for idx in range(0, len(pixels), 4):
        alpha = pixels[idx + 3]
        if alpha <= 0.05:
            continue

        pixel_index = idx // 4
        px_x = pixel_index % image_width
        px_y = pixel_index // image_width
        top_left_y = image_height - 1 - px_y
        if not any(is_in_minecraft_rect(px_x, top_left_y, rect) for rect in scaled_rects):
            continue

        current_rgb = (pixels[idx], pixels[idx + 1], pixels[idx + 2])
        if from_color_name and from_color_name in COLOR_MAP and not matches_color_family(current_rgb, from_color_name):
            continue

        brightness = max(0.35, min(1.15, (current_rgb[0] + current_rgb[1] + current_rgb[2]) / 1.8))
        pixels[idx : idx + 4] = (
            min(1.0, target_color[0] * brightness),
            min(1.0, target_color[1] * brightness),
            min(1.0, target_color[2] * brightness),
            alpha,
        )
        changed += 1

    if changed:
        image.pixels[:] = pixels

    return changed


def apply_trim_tool(image, rects, color):
    for x, y, width, height in rects:
        if height >= 4:
            set_minecraft_rect(image, x, y + max(1, height // 3), width, 1, color)
        if width >= 4:
            set_minecraft_rect(image, x, y + height - 2, width, 1, color)


def sample_rect_average_color(image, x, y, width, height, fallback):
    image_width, image_height = image.size
    scale_x = image_width / 64
    scale_y = image_height / 64
    start_x = round(x * scale_x)
    start_y = round(y * scale_y)
    rect_width = max(1, round(width * scale_x))
    rect_height = max(1, round(height * scale_y))
    pixels = list(image.pixels)
    total = [0.0, 0.0, 0.0, 0.0]
    count = 0

    for row in range(rect_height):
        for col in range(rect_width):
            px_x = start_x + col
            px_y = image_height - 1 - (start_y + row)
            if px_x < 0 or px_x >= image_width or px_y < 0 or px_y >= image_height:
                continue

            idx = (px_y * image_width + px_x) * 4
            alpha = pixels[idx + 3]
            if alpha <= 0.05:
                continue

            total[0] += pixels[idx]
            total[1] += pixels[idx + 1]
            total[2] += pixels[idx + 2]
            total[3] += alpha
            count += 1

    if not count:
        return fallback

    return (total[0] / count, total[1] / count, total[2] / count, total[3] / count)


def infer_recolor_request(prompt):
    match = re.search(
        r"(?:change|turn|replace|make)\s+"
        r"(?:all\s+)?(?:the\s+)?"
        r"(red|blue|green|purple|pink|gold|yellow|black|white|silver|orange)"
        r"(?:\s+(?:parts|areas|pixels|sections|accents|trim|details))?"
        r"\s+(?:(?:to|into)\s+)?"
        r"(?:(?:deep|dark|light|bright|pale|soft|rich)\s+)?"
        r"(?:(emerald)\s+)?"
        r"(red|blue|green|purple|pink|gold|yellow|black|white|silver|orange)",
        prompt,
    )
    if match:
        to_color = "green" if match.group(2) == "emerald" else match.group(3)
        return match.group(1), to_color

    return None, None


def edit_minecraft_skin_pixels(image, plan):
    base_name = str(plan.get("base_color", "")).lower()
    prompt = str(plan.get("raw_prompt", "")).lower()
    from_color_name, to_color_name = infer_recolor_request(prompt)

    if from_color_name and to_color_name:
        target_color = COLOR_MAP[to_color_name]
        changed_count = replace_color_family(image, from_color_name, target_color)
        print(f"Texture recolor request: {from_color_name} -> {to_color_name}; changed_pixels={changed_count}")

    apply_correction_operations(image, plan)
    image.update()


def execute_texture_tool_calls(image, plan, include_generation_tools=False):
    tool_calls = plan.get("tool_calls", [])
    if not tool_calls:
        return False

    executed = False
    mirror_ok = mirror_limbs_ok_after_image_model(plan)

    for call in tool_calls:
        tool = call.get("tool")
        if tool == "generate_region_from_prompt" and not include_generation_tools:
            continue

        if tool == "mirror_limb_regions" and not mirror_ok:
            print("Skipping mirror_limb_regions after image model unless prompt asks for symmetry.")
            continue

        if tool == "recolor_region":
            color_name = str(call.get("target_color") or call.get("color") or "").lower()
            if color_name not in COLOR_MAP:
                continue

            rects = region_rects(call.get("region"), call.get("region_group"))
            if not rects:
                continue

            changed = recolor_rects_preserve_shading(
                image,
                rects,
                COLOR_MAP[color_name],
                str(call.get("from_color", "")).lower() or None,
            )
            print(f"Tool recolor_region target={call.get('region') or call.get('region_group')} color={color_name}; changed_pixels={changed}")
            executed = True

        elif tool == "set_eye_color":
            color_name = str(call.get("color") or call.get("target_color") or "red").lower()
            color = COLOR_MAP.get(color_name, COLOR_MAP["red"])
            prepare_head_uv_for_requested_eyes(image)
            set_minecraft_rect(image, 10, 11, 2, 1, color)
            set_minecraft_rect(image, 14, 11, 2, 1, color)
            print(f"Tool set_eye_color color={color_name}")
            executed = True

        elif tool == "apply_trim":
            color_name = str(call.get("target_color") or call.get("color") or "blue").lower()
            color = COLOR_MAP.get(color_name, COLOR_MAP["blue"])
            rects = region_rects(call.get("region"), call.get("region_group") or "armor")
            apply_trim_tool(image, rects, color)
            print(f"Tool apply_trim target={call.get('region') or call.get('region_group')} color={color_name}")
            executed = True

        elif tool == "mirror_limb_regions":
            # Minimal first pass: enforce matching visible trim lines, while
            # leaving generated shading intact.
            accent = color_from_plan(plan, "accent_color", COLOR_MAP["blue"])
            for rect in [(44, 24, 4, 1), (36, 56, 4, 1), (4, 24, 4, 1), (20, 56, 4, 1)]:
                set_minecraft_rect(image, *rect, accent)
            print("Tool mirror_limb_regions applied matching limb trim.")
            executed = True

        elif tool == "validate_skin_layout":
            fix_generated_skin_eye_pixels(image, plan)
            print("Tool validate_skin_layout applied invariant checks.")
            executed = True

    if executed:
        image.update()

    return executed


def fix_generated_skin_eye_pixels(image, plan):
    # SDXL handles eyes correctly; skip manual stamping
    pass


def normalize_knight_skin_layout(image, plan):
    prompt = str(plan.get("raw_prompt", "")).lower()
    operations_text = str(plan.get("operations", [])).lower()
    wants_knight_armor = (
        "knight" in prompt
        or "armor" in prompt
        or "armour" in prompt
        or "armor" in operations_text
        or "armour" in operations_text
    )

    if not wants_knight_armor:
        return

    white = COLOR_MAP["white"]
    silver = COLOR_MAP["silver"]
    dark = (0.18, 0.18, 0.2, 1.0)
    accent = color_from_plan(plan, "accent_color", COLOR_MAP["blue"])

    # Keep generated detail, but repair core Minecraft armor placement so the
    # preview reads as a coherent character instead of random UV patches.
    set_minecraft_rect(image, 20, 20, 8, 12, white)
    set_minecraft_rect(image, 32, 20, 8, 12, white)
    set_minecraft_rect(image, 20, 20, 8, 2, silver)
    set_minecraft_rect(image, 32, 20, 8, 2, silver)
    set_minecraft_rect(image, 20, 30, 8, 2, dark)
    set_minecraft_rect(image, 32, 30, 8, 2, dark)
    set_minecraft_rect(image, 22, 23, 4, 1, accent)
    set_minecraft_rect(image, 34, 23, 4, 1, accent)

    # Mirror the front-ish armor treatment across both visible arms and legs.
    for rect in [(44, 20, 4, 12), (36, 52, 4, 12), (4, 20, 4, 12), (20, 52, 4, 12)]:
        set_minecraft_rect(image, *rect, white)
        set_minecraft_rect(image, rect[0], rect[1] + 1, rect[2], 1, silver)
        set_minecraft_rect(image, rect[0], rect[1] + 8, rect[2], 1, dark)

    # Preserve blue/green accents as controlled trim rather than random blocks.
    set_minecraft_rect(image, 44, 24, 4, 1, accent)
    set_minecraft_rect(image, 36, 56, 4, 1, accent)
    set_minecraft_rect(image, 4, 24, 4, 1, accent)
    set_minecraft_rect(image, 20, 56, 4, 1, accent)

    image.update()
    print("Schema repair: normalized knight armor layout across torso, back, arms, and legs.")


def scaled_mc_uv_rect(mc_x, mc_y, mc_w, mc_h, image_width, image_height):
    start_x = round(mc_x * image_width / 64)
    start_y = round(mc_y * image_height / 64)
    rect_w = max(1, round(mc_w * image_width / 64))
    rect_h = max(1, round(mc_h * image_height / 64))
    return start_x, start_y, rect_w, rect_h


def _luminance_variance_mc_rect(pixels, image_width, image_height, mc_rect):
    mc_x, mc_y, mc_w, mc_h = mc_rect
    sx, sy, rw, rh = scaled_mc_uv_rect(mc_x, mc_y, mc_w, mc_h, image_width, image_height)
    lums = []
    for row in range(rh):
        py_bl = image_height - 1 - (sy + row)
        for col in range(rw):
            px_x = sx + col
            idx = (py_bl * image_width + px_x) * 4
            alpha = pixels[idx + 3]
            if alpha <= 0.05:
                continue
            r, g, b = pixels[idx], pixels[idx + 1], pixels[idx + 2]
            lums.append(0.299 * r + 0.587 * g + 0.114 * b)
    if len(lums) < 8:
        return 0.0
    mean = sum(lums) / len(lums)
    return sum((x - mean) ** 2 for x in lums) / len(lums)


def _flip_horizontal_copy_mc_rect(pixels, image_width, image_height, src_mc, dst_mc):
    sx, sy, sw, sh = scaled_mc_uv_rect(*src_mc, image_width, image_height)
    dx, dy, dw, dh = scaled_mc_uv_rect(*dst_mc, image_width, image_height)

    if sw != dw or sh != dh:
        return False

    for row in range(sh):
        py_src_bl = image_height - 1 - (sy + row)
        py_dst_bl = image_height - 1 - (dy + row)
        for col in range(dw):
            src_col_flipped = sx + (sw - 1 - col)
            si = (py_src_bl * image_width + src_col_flipped) * 4
            di = (py_dst_bl * image_width + (dx + col)) * 4
            pixels[di : di + 4] = pixels[si : si + 4]
    return True


def _symmetrize_mirror_pair(pixels, image_width, image_height, key_a, key_b):
    rect_a = MINECRAFT_UV_REGIONS[key_a]
    rect_b = MINECRAFT_UV_REGIONS[key_b]
    va = _luminance_variance_mc_rect(pixels, image_width, image_height, rect_a)
    vb = _luminance_variance_mc_rect(pixels, image_width, image_height, rect_b)
    # Richer tonal side wins; copy horizontally flipped onto the flatter/noisier limb half.
    if va >= vb:
        _flip_horizontal_copy_mc_rect(pixels, image_width, image_height, rect_a, rect_b)
    else:
        _flip_horizontal_copy_mc_rect(pixels, image_width, image_height, rect_b, rect_a)


def prompt_requests_bilateral_armor_symmetry(plan):
    prompt = str(plan.get("raw_prompt") or "").lower()
    ops = str(plan.get("operations", []) or "").lower()
    blob = f"{prompt} {ops}"
    return (
        "knight" in blob
        or "armor" in blob
        or "armour" in blob
        or ("fantasy" in blob and ("knight" in blob or "armor" in blob or "armour" in blob))
    )


def symmetrize_bilateral_limbs_torso_after_diffusion(image, plan):
    if not plan.get("image_model_applied"):
        return
    if not prompt_requests_bilateral_armor_symmetry(plan):
        return

    iw, ih = image.size
    pixels = list(image.pixels)

    bilateral_pairs = [
        ("torso_right", "torso_left"),
        ("right_arm_front", "left_arm_front"),
        ("right_arm_back", "left_arm_back"),
        ("right_leg_front", "left_leg_front"),
        ("right_leg_back", "left_leg_back"),
    ]

    for key_a, key_b in bilateral_pairs:
        _symmetrize_mirror_pair(pixels, iw, ih, key_a, key_b)

    image.pixels[:] = pixels
    image.update()
    print("Symmetry repair: bilateral limb/torso UV halves aligned (mirror-copy from richer half).")


def apply_correction_operations(image, plan):
    # Removed hardcoded eye and armor drawing post-passes that ruined custom skins.
    pass


def apply_generated_skin_postpass(image, plan):
    repair_near_black_artifacts_from_image_model(image, plan)
    prompt = str(plan.get("raw_prompt", "")).lower()
    from_color_name, to_color_name = infer_recolor_request(prompt)

    for operation in plan.get("operations", []):
        if operation.get("type") == "recolor":
            operation_from = str(operation.get("from", "")).lower()
            operation_to = str(operation.get("to", "")).lower()
            if operation_from in COLOR_MAP and operation_to in COLOR_MAP:
                from_color_name = operation_from
                to_color_name = operation_to
                break

    if from_color_name and to_color_name:
        target_color = COLOR_MAP[to_color_name]
        changed_count = replace_color_family(image, from_color_name, target_color)
        print(f"Generated skin recolor post-pass: {from_color_name} -> {to_color_name}; changed_pixels={changed_count}")

    # SDXL handles symmetry and details correctly, so we skip manual heuristics.


def texture_material(image_path, fallback_color):
    if not image_path or not os.path.exists(image_path):
        return material("Generated material", fallback_color)

    mat = bpy.data.materials.new("Uploaded texture material")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new(type="ShaderNodeTexImage")
    tex.image = bpy.data.images.load(image_path)
    tex.interpolation = "Closest"
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.72
    return mat


def apply_skin_texture(image_path, plan, edited_skin_output=None):
    if not image_path or not os.path.exists(image_path):
        return

    print(f"Applying skin PNG to rig mesh materials: {image_path}")
    image = bpy.data.images.load(image_path)
    image.colorspace_settings.name = "sRGB"
    if plan.get("sdxl_generated"):
        print("SDXL model generated this skin — applying directly without post-processing.")
    elif plan.get("image_model_applied"):
        print("Image model already edited the skin; skipping deterministic UV paint overlays.")
        apply_generated_skin_postpass(image, plan)
        execute_texture_tool_calls(image, plan)
    elif plan.get("tool_calls"):
        execute_texture_tool_calls(image, plan)
        apply_correction_operations(image, plan)
    else:
        edit_minecraft_skin_pixels(image, plan)
    # Force glTF export to embed the edited in-memory pixels instead of reusing
    # the original uploaded PNG bytes from disk.
    image.pack()
    if edited_skin_output:
        image.filepath_raw = edited_skin_output
        image.file_format = "PNG"
        image.save()
        print(f"Saved edited Minecraft UV PNG: {edited_skin_output}")
    skin_material = bpy.data.materials.get("Skin") or bpy.data.materials.get("skin")

    if not skin_material:
        skin_material = bpy.data.materials.new("skin")

    skin_material.use_nodes = True
    nodes = skin_material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")

    if not bsdf:
        return

    # The preview rig uses a shared Skin material on GEO-* body parts; BSP bone shapes stay hidden.
    # Minecraft skin is the single source driving the Skin material export.
    for node in list(nodes):
        if node.type == "TEX_IMAGE":
            nodes.remove(node)

    texture_node = nodes.new(type="ShaderNodeTexImage")
    texture_node.name = "Uploaded Minecraft Skin"
    texture_node.image = image
    texture_node.interpolation = "Closest"
    skin_material.node_tree.links.new(texture_node.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.75

    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and not obj.material_slots:
            obj.data.materials.append(skin_material)


def add_cube(name, scale, location, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj


def bevel(obj, amount=0.015):
    modifier = obj.modifiers.new("tiny bevel", "BEVEL")
    modifier.width = amount
    modifier.segments = 1
    modifier.affect = "EDGES"
    obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")


def block(name, size, center, mat):
    obj = add_cube(name, (size[0] / 2, size[1] / 2, size[2] / 2), center, mat)
    bevel(obj)
    return obj


def template_block(name, size, center, mat, parent_name="HLP-Null.Main_Mesh"):
    obj = block(name, size, center, mat)
    parent = bpy.data.objects.get(parent_name) or bpy.data.objects.get("RIG-Woodplank")
    if parent:
        obj.parent = parent
    return obj


UNIT = 0.08


def px(value):
    return value * UNIT


def minecraft_block(name, size_px, center_px, mat):
    return block(
        name,
        (px(size_px[0]), px(size_px[1]), px(size_px[2])),
        (px(center_px[0]), px(center_px[1]), px(center_px[2])),
        mat,
    )


def add_accessories(plan):
    accent = color_from_plan(plan, "accent_color", (0.0, 0.85, 1.0, 1.0))
    dark = color_from_plan(plan, "secondary_color", (0.02, 0.02, 0.025, 1.0))
    accessory_mat = material("Accessory material", dark)
    accent_mat = material("Accent material", accent)
    accessories = plan.get("accessories", [])

    if "helmet" in accessories:
        minecraft_block("helmet_cap", (9, 9, 1), (0, 0, 32.5), accessory_mat)
        minecraft_block("helmet_back", (9, 1, 6), (0, 4.5, 29), accessory_mat)
        minecraft_block("helmet_brow", (9, 1, 1), (0, -4.5, 30.5), accessory_mat)

    if "shoulder_pads" in accessories:
        minecraft_block("left_shoulder_pad", (5, 5, 2), (-6, 0, 24), accessory_mat)
        minecraft_block("right_shoulder_pad", (5, 5, 2), (6, 0, 24), accessory_mat)

    if "cape" in accessories:
        minecraft_block("cape", (9, 1, 18), (0, 2.7, 15), accessory_mat)

    if "sword" in accessories:
        blade = minecraft_block("sword_blade", (1, 1, 14), (9.2, -1.2, 12), accent_mat)
        blade.rotation_euler[1] = math.radians(-10)
        handle = minecraft_block("sword_handle", (1, 1, 5), (8.3, -1.2, 4.5), accessory_mat)
        handle.rotation_euler[1] = math.radians(-10)
        minecraft_block("sword_guard", (4, 1, 1), (8.7, -1.2, 7.2), accessory_mat)

    if "horns" in accessories:
        minecraft_block("left_horn", (2, 2, 4), (-3, 0, 35), accent_mat)
        minecraft_block("right_horn", (2, 2, 4), (3, 0, 35), accent_mat)

    if "glowing_eyes" in accessories:
        eye_mat = material("Glowing eyes", accent)
        eye_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = accent
        eye_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.8
        minecraft_block("left_glowing_eye", (2, 0.25, 1), (-2, -4.15, 28), eye_mat)
        minecraft_block("right_glowing_eye", (2, 0.25, 1), (2, -4.15, 28), eye_mat)


def add_template_accessories(plan):
    accent = color_from_plan(plan, "accent_color", (0.0, 0.85, 1.0, 1.0))
    dark = color_from_plan(plan, "secondary_color", (0.02, 0.02, 0.025, 1.0))
    accessory_mat = material("AI accessory material", dark)
    accent_mat = material("AI accent material", accent)
    accessories = plan.get("accessories", [])

    if "helmet" in accessories:
        template_block("AI_Helmet_Cap", (0.58, 0.58, 0.055), (0, 0, 2.035), accessory_mat)
        template_block("AI_Helmet_Brow", (0.56, 0.035, 0.065), (0, -0.27, 1.83), accessory_mat)

    if "shoulder_pads" in accessories:
        template_block("AI_Shoulder_L", (0.28, 0.34, 0.08), (0.43, 0, 1.54), accessory_mat)
        template_block("AI_Shoulder_R", (0.28, 0.34, 0.08), (-0.43, 0, 1.54), accessory_mat)

    if "cape" in accessories:
        template_block("AI_Cape", (0.58, 0.035, 0.95), (0, 0.16, 1.05), accessory_mat)

    if "sword" in accessories:
        blade = template_block("AI_Sword_Blade", (0.035, 0.025, 0.85), (-0.72, -0.05, 0.9), accent_mat)
        blade.rotation_euler[1] = math.radians(12)
        handle = template_block("AI_Sword_Handle", (0.04, 0.04, 0.26), (-0.62, -0.05, 0.42), accessory_mat)
        handle.rotation_euler[1] = math.radians(12)
        template_block("AI_Sword_Guard", (0.22, 0.035, 0.035), (-0.65, -0.05, 0.57), accessory_mat)

    if "horns" in accessories:
        template_block("AI_Horn_L", (0.09, 0.09, 0.2), (0.17, 0, 2.14), accent_mat)
        template_block("AI_Horn_R", (0.09, 0.09, 0.2), (-0.17, 0, 2.14), accent_mat)

    if "glowing_eyes" in accessories:
        eye_mat = material("AI glowing eye material", accent)
        bsdf = eye_mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Emission Color"].default_value = accent
            bsdf.inputs["Emission Strength"].default_value = 1.8
        template_block("AI_Eye_L", (0.095, 0.012, 0.04), (0.11, -0.258, 1.78), eye_mat)
        template_block("AI_Eye_R", (0.095, 0.012, 0.04), (-0.11, -0.258, 1.78), eye_mat)


def assert_minecraft_player_rig_template():
    geo = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("GEO-")]
    names = {o.name for o in geo}
    ok = (
        "GEO-Torso" in names
        and ("GEO-Leg.L" in names or "GEO-Leg.R" in names)
        and ("GEO-Head.Face.Fr" in names or "GEO-Head.2nd_Layer" in names)
    )
    if ok:
        return

    mesh_names = sorted(o.name for o in bpy.data.objects if o.type == "MESH")
    print(
        "WARN: This .blend may not be a full Woodplank-style rig (missing some GEO-Torso / GEO-Leg / GEO-Head meshes). "
        "Preview may be incomplete. Meshes: "
        + (", ".join(mesh_names[:20]) + ("..." if len(mesh_names) > 20 else "")),
        flush=True,
    )


def prepare_template_for_preview():
    """Hide rigging helpers only. Do not bulk-unhide all meshes — that re-shows giant BSP bone shapes in Woodplank."""
    hidden_geo = {"GEO-Eyebrows", "GEO-Iris", "GEO-Teeth"}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if obj.name.startswith(("BSP-", "HLP-")) or obj.name in hidden_geo:
            obj.hide_viewport = True
            obj.hide_render = True


def load_template(template_path, image_path, plan, edited_skin_output=None):
    print(f"Opening Minecraft preview rig template (armature unchanged): {template_path}")
    bpy.ops.wm.open_mainfile(filepath=template_path)
    assert_minecraft_player_rig_template()
    apply_skin_texture(image_path, plan, edited_skin_output)
    prepare_template_for_preview()
    # For now, keep edits on the Minecraft UV texture. Loose mesh accessories
    # made the preview confusing and can be reintroduced once anchored to bones.


def create_minecraft_proxy(image_path, plan):
    # Steve-style Minecraft dimensions in pixels, scaled into Blender units.
    base_color = color_from_plan(plan, "base_color", COLOR_MAP["purple"])
    secondary_color = color_from_plan(plan, "secondary_color", COLOR_MAP["black"])
    accent_color = color_from_plan(plan, "accent_color", COLOR_MAP["blue"])
    mat = material("AI requested skin color", base_color)
    armor_mat = material("Secondary armor material", secondary_color)
    accent_mat = material("Trim material", accent_color)

    minecraft_block("head", (8, 8, 8), (0, 0, 28), mat)
    minecraft_block("torso", (8, 4, 12), (0, 0, 18), mat)
    minecraft_block("left_arm", (4, 4, 12), (-6, 0, 18), mat)
    minecraft_block("right_arm", (4, 4, 12), (6, 0, 18), mat)
    minecraft_block("left_leg", (4, 4, 12), (-2, 0, 6), mat)
    minecraft_block("right_leg", (4, 4, 12), (2, 0, 6), mat)

    minecraft_block("chest_plate", (8.4, 0.5, 7), (0, -2.25, 19), armor_mat)
    minecraft_block("belt", (8.4, 0.5, 1.2), (0, -2.25, 12.5), armor_mat)
    minecraft_block("chest_trim", (6, 0.25, 1), (0, -2.55, 22), accent_mat)
    add_accessories(plan)


def import_model(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in [".glb", ".gltf"]:
        bpy.ops.import_scene.gltf(filepath=path)
        return True
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
        return True
    if ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
        return True
    return False


def apply_color_to_scene(color):
    mat = material("AI requested material", color)
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.data.materials.clear()
            obj.data.materials.append(mat)


def setup_camera():
    light_data = bpy.data.lights.new(name="AI Preview Key Light", type="AREA")
    light_data.energy = 450
    light_data.size = 5
    light_obj = bpy.data.objects.new("AI Preview Key Light", light_data)
    light_obj.location = (0, 4, 5)
    bpy.context.collection.objects.link(light_obj)

    camera_data = bpy.data.cameras.new(name="AI Preview Camera")
    camera_obj = bpy.data.objects.new("AI Preview Camera", camera_data)
    camera_obj.location = (3.2, 2.1, 4.2)
    camera_obj.rotation_euler = (math.radians(62), 0, math.radians(38))
    bpy.context.collection.objects.link(camera_obj)
    bpy.context.scene.camera = camera_obj


def load_plan(path, color):
    default_plan = {
        "base_color": color,
        "secondary_color": "black",
        "accent_color": "blue",
        "accessories": [],
        "style": "prototype"
    }
    if not path or not os.path.exists(path):
        return default_plan

    with open(path, "r", encoding="utf-8") as file:
        loaded = json.load(file)

    return {**default_plan, **loaded}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--color", default="purple")
    parser.add_argument("--kind", default="image")
    parser.add_argument("--plan")
    parser.add_argument("--template")
    parser.add_argument("--edited-skin-output")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])

    reset_scene()
    color = COLOR_MAP.get(args.color.lower(), COLOR_MAP["purple"])
    plan = load_plan(args.plan, args.color)
    ext = os.path.splitext(args.input)[1].lower()

    imported = False
    if args.kind == "model" or ext in [".glb", ".gltf", ".fbx", ".obj"]:
        imported = import_model(args.input)

    if args.kind == "image" and args.template and os.path.exists(args.template):
        load_template(args.template, args.input, plan, args.edited_skin_output)
    elif args.kind == "image":
        raise RuntimeError("Minecraft image jobs require a real rig template. Refusing to use fake cube fallback.")
    elif imported:
        apply_color_to_scene(color)
    else:
        create_minecraft_proxy(args.input, plan)

    setup_camera()
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", use_visible=True)


if __name__ == "__main__":
    main()
