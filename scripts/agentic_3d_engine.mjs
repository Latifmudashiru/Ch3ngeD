/**
 * Aatrox 3D asset metadata containing exact mesh parts, materials, and skeleton bones.
 */
export const AATROX_METADATA = {
  character: "Aatrox (The Darkin Blade)",
  meshes: ["Meshes"],
  materials: ["Body", "Sword", "Shoulder"],
  key_bones: {
    head: ["Head", "Neck", "C_Buffbone_Glb_Head_Loc"],
    torso: ["Spine1", "Spine2", "Spine3", "C_Buffbone_Glb_Chest_Loc", "Pelvis", "Root"],
    wings: ["L_Wing1", "L_Wing2", "L_Wing_Tip", "R_Wing1", "R_Wing2", "R_Wing_Tip"],
    shoulders: ["L_Shoulder", "R_Shoulder", "L_Clavicle", "R_Clavicle"],
    hands: ["L_Hand", "R_Hand", "L_Buffbone_Glb_Hand_Loc", "R_Buffbone_Glb_Hand_Loc"],
    weapon: ["Weapon", "Weapon_Blade1", "Weapon_Blade3", "Weapon_Tip", "Weapon_Heart", "Weapon_Right"],
    feet: ["L_Foot", "R_Foot"]
  }
};

/**
 * System prompt providing the AI with high-level 3D spatial guidelines and Blender bpy patterns.
 */
const SYSTEM_PROMPT = `You are a world-class 3D Technical Artist and Blender Python (bpy) expert specializing in character customization, game asset modeling, and procedural PBR shading.

You are given:
1. Target character: Aatrox (League of Legends).
2. Existing meshes: ['Meshes'] with material slots ['Body', 'Sword', 'Shoulder'].
3. Existing Armature 'Skeleton' with bones including:
   - Head: 'Head', 'C_Buffbone_Glb_Head_Loc'
   - Torso / Back: 'Spine1', 'Spine2', 'Spine3', 'C_Buffbone_Glb_Chest_Loc'
   - Wings: 'L_Wing1', 'L_Wing2', 'L_Wing_Tip', 'R_Wing1', 'R_Wing2', 'R_Wing_Tip'
   - Shoulders: 'L_Shoulder', 'R_Shoulder'
   - Weapon: 'Weapon', 'Weapon_Blade1', 'Weapon_Blade3', 'Weapon_Tip', 'Weapon_Heart'
   - Hands: 'L_Hand', 'R_Hand'

YOUR TASK:
Write the Python code body that performs the requested 3D customization on the loaded Blender scene.

CRITICAL BLENDER BPY GUIDELINES:
1. The scene is already loaded with the GLB. Do NOT call wm.read_factory_settings or import/export GLB in your code (the runner handles import and export).
2. To create new 3D geometry (e.g. horns, wings, crown, shoulder armor, spikes, weapon additions, floating aura/gems):
   - Use bpy.ops.mesh.primitive_cone_add, primitive_cube_add, primitive_uv_sphere_add, primitive_cylinder_add, primitive_torus_add, etc.
   - Or create custom bmesh / curves / extrusions.
   - Adjust location, rotation, and scale to fit Aatrox proportionally.
   - To attach created geometry to a bone so it moves with the character:
     armature = bpy.data.objects.get('Skeleton')
     if armature and 'BoneName' in armature.data.bones:
         obj.parent = armature
         obj.parent_type = 'BONE'
         obj.parent_bone = 'BoneName'
3. To customize materials / shaders:
   - To edit existing materials ('Body', 'Sword', 'Shoulder') or newly created materials:
     mat = bpy.data.materials.get('MaterialName') or bpy.data.materials.new(name='NewMat')
     mat.use_nodes = True
     nodes = mat.node_tree.nodes
     links = mat.node_tree.links
     # Find Principled BSDF
     bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
     if not bsdf:
         bsdf = nodes.new('ShaderNodeBsdfPrincipled')
     # Modify properties: Base Color, Metallic, Roughness, Emission Color, Emission Strength
     # E.g. bsdf.inputs['Base Color'].default_value = (R, G, B, 1.0)
     # E.g. bsdf.inputs['Metallic'].default_value = 0.9
     # E.g. bsdf.inputs['Roughness'].default_value = 0.2
     # E.g. bsdf.inputs['Emission Color'].default_value = (R, G, B, 1.0)
     # E.g. bsdf.inputs['Emission Strength'].default_value = 4.0
4. Always write clean, robust Python with try/except around individual sub-operations to ensure graceful execution.
5. Return ONLY executable Python code inside a \`\`\`python ... \`\`\` block, with a brief 1-sentence comment explaining the artistic decision.`;

/**
 * Generate procedural 3D operations using OpenAI, Anthropic, or Procedural Engine.
 */
export async function generate3DTransformScript(prompt, previousError = null, previousScript = null) {
  let userMessage = `User request: "${prompt}"\n`;
  if (previousError && previousScript) {
    userMessage += `\n[PREVIOUS ATTEMPT FAILED WITH ERROR]:\n${previousError}\n\n[PREVIOUS SCRIPT]:\n${previousScript}\n\nPlease fix the script to resolve the error while fulfilling the user request.`;
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-3-7-sonnet-20250219";
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiModel = process.env.OPENAI_MODEL ?? "gpt-4o";

  // 1. Try Anthropic Claude if configured
  if (anthropicApiKey) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey: anthropicApiKey });
      console.log(`[Agent3D] Querying Anthropic (${anthropicModel}) for prompt: "${prompt}"`);
      const response = await anthropic.messages.create({
        model: anthropicModel,
        max_tokens: 3000,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const rawText = textBlock?.text ?? "";
      const code = extractPythonCode(rawText);
      if (code) {
        return { code, summary: extractSummary(rawText) || `Generated 3D transformation for: ${prompt}` };
      }
    } catch (err) {
      console.warn("[Agent3D] Anthropic request warning:", err.message);
    }
  }

  // 2. Try OpenAI (GPT-4o / GPT-6 Astra / GPT-5.6 Luna) if configured
  if (openaiApiKey) {
    try {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: openaiApiKey });
      console.log(`[Agent3D] Querying OpenAI (${openaiModel}) for prompt: "${prompt}"`);
      const completion = await openai.chat.completions.create({
        model: openaiModel,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      });

      const rawText = completion.choices[0]?.message?.content ?? "";
      const code = extractPythonCode(rawText);
      if (code) {
        return { code, summary: extractSummary(rawText) || `Generated 3D transformation for: ${prompt}` };
      }
    } catch (err) {
      console.warn("[Agent3D] OpenAI request warning:", err.message);
    }
  }

  // 3. Fallback procedural generator (rich 3D rule templates for common requests)
  console.log(`[Agent3D] Using procedural 3D rule generator for prompt: "${prompt}"`);
  return generateProceduralRuleScript(prompt);
}

function extractPythonCode(text) {
  const match = text.match(/```(?:python)?\s*([\s\S]*?)\s*```/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  if (text.includes("import bpy") || text.includes("bpy.data")) {
    return text.trim();
  }
  return null;
}

function extractSummary(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const comment = lines.find(l => !l.startsWith("```") && !l.startsWith("import") && !l.startsWith("#"));
  return comment ? comment.slice(0, 150) : null;
}

/**
 * Robust procedural 3D fallback builder for instant local offline testing.
 */
function generateProceduralRuleScript(prompt) {
  const p = prompt.toLowerCase();
  const chunks = [];
  let summary = "Custom 3D transformation applied";

  // Palette definitions
  const colors = {
    red: "(0.95, 0.08, 0.05, 1.0)",
    infernal: "(1.0, 0.25, 0.02, 1.0)",
    fire: "(1.0, 0.35, 0.05, 1.0)",
    blue: "(0.08, 0.35, 1.0, 1.0)",
    celestial: "(0.15, 0.75, 1.0, 1.0)",
    cyan: "(0.05, 0.9, 0.95, 1.0)",
    green: "(0.1, 0.9, 0.2, 1.0)",
    purple: "(0.65, 0.1, 0.95, 1.0)",
    void: "(0.35, 0.02, 0.7, 1.0)",
    gold: "(1.0, 0.78, 0.12, 1.0)",
    obsidian: "(0.03, 0.03, 0.04, 1.0)",
    silver: "(0.8, 0.82, 0.88, 1.0)",
    white: "(0.95, 0.95, 0.98, 1.0)",
    ice: "(0.6, 0.88, 1.0, 1.0)",
  };

  const detectedColorKey = Object.keys(colors).find(c => p.includes(c)) || "infernal";
  const colorRgba = colors[detectedColorKey];

  // Helper code header
  chunks.push(`
# Procedural helper functions
def get_or_create_material(name, base_color=(0.1, 0.1, 0.1, 1.0), metallic=0.0, roughness=0.5, emission_color=(0,0,0,1), emission_strength=0.0):
    mat = bpy.data.materials.get(name)
    if not mat:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        bsdf = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = base_color
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = emission_color
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat

def attach_to_bone(obj, bone_name):
    armature = bpy.data.objects.get('Skeleton')
    if armature and bone_name in armature.data.bones:
        obj.parent = armature
        obj.parent_type = 'BONE'
        obj.parent_bone = bone_name

armature = bpy.data.objects.get('Skeleton')
`);

  // Horns
  if (p.includes("horn") || p.includes("crown") || p.includes("helm")) {
    summary = `Added 3D sculpted horns/crown with ${detectedColorKey} finish to Aatrox's head`;
    chunks.push(`
# ─── Create 3D Horns / Crown ───
horn_mat = get_or_create_material("Horn_Material", base_color=${colorRgba}, metallic=0.85, roughness=0.2, emission_color=${colorRgba}, emission_strength=2.5)

# Left Horn
bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=8.0, depth=45.0, location=(18.0, 5.0, 180.0), rotation=(0.4, -0.6, 0.2))
horn_l = bpy.context.active_object
horn_l.name = "Aatrox_Horn_L"
horn_l.data.materials.append(horn_mat)
attach_to_bone(horn_l, "Head")

# Right Horn
bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=8.0, depth=45.0, location=(-18.0, 5.0, 180.0), rotation=(0.4, 0.6, -0.2))
horn_r = bpy.context.active_object
horn_r.name = "Aatrox_Horn_R"
horn_r.data.materials.append(horn_mat)
attach_to_bone(horn_r, "Head")
`);
  }

  // Wings
  if (p.includes("wing") || p.includes("cape") || p.includes("feather")) {
    summary = `Created massive 3D demon wings with ${detectedColorKey} energy blades`;
    chunks.push(`
# ─── Create 3D Demon Wings ───
wing_mat = get_or_create_material("Wing_Energy_Mat", base_color=${colorRgba}, metallic=0.9, roughness=0.15, emission_color=${colorRgba}, emission_strength=4.0)

for side, mult, bone in [("L", 1.0, "L_Wing1"), ("R", -1.0, "R_Wing1")]:
    for i in range(3):
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=12.0 - i*2.5, depth=90.0 + i*30.0, location=(mult * (45.0 + i*25.0), -20.0 - i*10.0, 150.0 + i*20.0), rotation=(0.5, mult * (-0.8 - i*0.2), mult * 0.4))
        blade = bpy.context.active_object
        blade.name = f"Aatrox_WingBlade_{side}_{i}"
        blade.data.materials.append(wing_mat)
        attach_to_bone(blade, bone)
`);
  }

  // Weapon / Sword upgrades
  if (p.includes("sword") || p.includes("blade") || p.includes("weapon") || p.includes("edge")) {
    summary = `Enhanced Darkin Greatsword with glowing ${detectedColorKey} serrated spikes and runic core`;
    chunks.push(`
# ─── Enhance Darkin Greatsword ───
blade_glow_mat = get_or_create_material("Sword_Rune_Mat", base_color=${colorRgba}, metallic=0.95, roughness=0.1, emission_color=${colorRgba}, emission_strength=5.5)

# Add spikes along blade spine
for i in range(4):
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=6.0, depth=30.0, location=(0.0, 10.0 + i*25.0, 100.0 + i*35.0), rotation=(1.57, 0, 0))
    spike = bpy.context.active_object
    spike.name = f"Sword_Serrated_Spike_{i}"
    spike.data.materials.append(blade_glow_mat)
    attach_to_bone(spike, "Weapon_Blade3")

# Floating Energy Core
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=14.0, location=(0.0, 0.0, 70.0))
core = bpy.context.active_object
core.name = "Sword_Heart_Core"
core.data.materials.append(blade_glow_mat)
attach_to_bone(core, "Weapon_Heart")
`);
  }

  // Armor / Pauldrons / Shoulders
  if (p.includes("armor") || p.includes("shoulder") || p.includes("pauldron") || p.includes("plate") || p.includes("spikes")) {
    summary = `Equipped heavy spiked pauldrons and ${detectedColorKey} armor plating`;
    chunks.push(`
# ─── Spiked Shoulders & Pauldrons ───
armor_mat = get_or_create_material("Pauldron_Mat", base_color=${colorRgba}, metallic=0.9, roughness=0.25, emission_color=${colorRgba}, emission_strength=2.0)

for side, mult, bone in [("L", 1.0, "L_Shoulder"), ("R", -1.0, "R_Shoulder")]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=22.0, location=(mult * 45.0, 0.0, 150.0))
    pauldron = bpy.context.active_object
    pauldron.scale = (1.2, 1.4, 0.9)
    pauldron.name = f"Aatrox_Pauldron_{side}"
    pauldron.data.materials.append(armor_mat)
    attach_to_bone(pauldron, bone)

    # Spike on pauldron
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=7.0, depth=35.0, location=(mult * 55.0, 0.0, 168.0), rotation=(0.2, mult * -0.6, 0.0))
    pspike = bpy.context.active_object
    pspike.name = f"Pauldron_Spike_{side}"
    pspike.data.materials.append(armor_mat)
    attach_to_bone(pspike, bone)
`);
  }

  // Aura / Energy Ring / Glow
  if (p.includes("aura") || p.includes("void") || p.includes("glow") || p.includes("flame") || p.includes("fire") || p.includes("halo")) {
    summary = `Surrounded Aatrox with a radiating ${detectedColorKey} astral energy halo`;
    chunks.push(`
# ─── Floating Energy Halo / Aura Ring ───
halo_mat = get_or_create_material("Aura_Halo_Mat", base_color=${colorRgba}, metallic=0.1, roughness=0.1, emission_color=${colorRgba}, emission_strength=6.0)

bpy.ops.mesh.primitive_torus_add(major_radius=42.0, minor_radius=3.5, location=(0.0, -10.0, 185.0), rotation=(0.35, 0.0, 0.0))
halo = bpy.context.active_object
halo.name = "Aatrox_Astral_Halo"
halo.data.materials.append(halo_mat)
attach_to_bone(halo, "Head")
`);
  }

  // Always update existing body / sword / shoulder PBR materials to match requested theme
  chunks.push(`
# ─── Upgrade Existing Material Shaders ───
for mat_name in ['Body', 'Sword', 'Shoulder']:
    mat = bpy.data.materials.get(mat_name)
    if mat and mat.use_nodes:
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            if 'Emission Color' in bsdf.inputs:
                bsdf.inputs['Emission Color'].default_value = ${colorRgba}
                bsdf.inputs['Emission Strength'].default_value = 1.8
            if 'Metallic' in bsdf.inputs:
                bsdf.inputs['Metallic'].default_value = 0.75
            if 'Roughness' in bsdf.inputs:
                bsdf.inputs['Roughness'].default_value = 0.3
`);

  return {
    code: chunks.join("\n"),
    summary
  };
}
