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
 * System prompt giving the AI complete creative authority and reliable Blender bpy helpers.
 */
const SYSTEM_PROMPT = `You are a world-class 3D Technical Artist and Blender Python (bpy) expert. Transform the loaded Aatrox 3D model according to the user request (futuristic, sci-fi, mecha, anime, fantasy, demon, etc.).

SCENE STRUCTURE:
1. Target: Aatrox GLB is ALREADY loaded.
2. Existing mesh: bpy.data.objects['Meshes'] with material slots ['Body', 'Sword', 'Shoulder'].
3. Existing Armature 'Skeleton' with bones:
   - Head: 'Head', 'C_Buffbone_Glb_Head_Loc'
   - Torso / Back: 'Spine1', 'Spine2', 'Spine3', 'C_Buffbone_Glb_Chest_Loc'
   - Wings: 'L_Wing1', 'L_Wing2', 'L_Wing_Tip', 'R_Wing1', 'R_Wing2', 'R_Wing_Tip'
   - Shoulders: 'L_Shoulder', 'R_Shoulder'
   - Weapon: 'Weapon', 'Weapon_Blade1', 'Weapon_Blade3', 'Weapon_Tip', 'Weapon_Heart'
   - Hands: 'L_Hand', 'R_Hand'

CRITICAL SHADER & PARENTING RULES:
1. When creating materials, you MUST connect the Principled BSDF output to the Output Material 'Surface' input, otherwise meshes render as flat white unshaded blobs!
   Use this exact helper:
   def get_or_create_material(name, base_color=(0.1, 0.1, 0.1, 1.0), metallic=0.0, roughness=0.5, emission_color=(0,0,0,1), emission_strength=0.0):
       mat = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
       mat.use_nodes = True
       nodes = mat.node_tree.nodes
       links = mat.node_tree.links
       output = next((n for n in nodes if n.type == 'OUTPUT_MATERIAL'), None)
       if not output:
           output = nodes.new('ShaderNodeOutputMaterial')
       bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
       if not bsdf:
           bsdf = nodes.new('ShaderNodeBsdfPrincipled')
       if not any(l.to_node == output for l in links):
           links.new(bsdf.outputs[0], output.inputs['Surface'])
       bsdf.inputs['Base Color'].default_value = base_color
       bsdf.inputs['Metallic'].default_value = metallic
       bsdf.inputs['Roughness'].default_value = roughness
       if 'Emission Color' in bsdf.inputs:
           bsdf.inputs['Emission Color'].default_value = emission_color
           bsdf.inputs['Emission Strength'].default_value = emission_strength
       return mat

2. TO MODIFY EXISTING AATROX TEXTURES / SHADERS ('Body', 'Sword', 'Shoulder'):
   IMPORTANT — these materials do NOT contain a Principled BSDF. They use an unlit glTF-style
   graph: an Image Texture node feeds an Emission node's Color input directly, and Emission is
   mixed with a Transparent BSDF via a Mix Shader. Searching for BSDF_PRINCIPLED returns None
   and silently does nothing.

   CRITICAL — the glTF exporter embeds the Image Texture's actual pixel data as the baseColor
   texture; it does NOT bake shader node math (Mix/Multiply/HSV nodes) into the exported file.
   Any recolor done by inserting extra shader nodes between the Image Texture and Emission will
   look correct in Blender's own viewport but silently disappear from the exported GLB, because
   the exporter re-reads the raw texture image and ignores the node graph in between. You MUST
   edit the Image datablock's actual pixels with numpy instead. Also note: 'Body' and 'Shoulder'
   share the exact same underlying image (a shared texture atlas) — copy the image before editing
   or a Body-only recolor will bleed onto Shoulder too. Use this exact helper:
   def tint_existing_material(mat_name, tint_color=(1.0, 1.0, 1.0), tint_factor=0.9, emission_strength=None):
       import numpy as np, colorsys
       mat = bpy.data.materials.get(mat_name)
       if not (mat and mat.use_nodes):
           return
       nodes = mat.node_tree.nodes
       emission = next((n for n in nodes if n.type == 'EMISSION'), None)
       if not emission:
           return
       color_input = emission.inputs['Color']
       if not color_input.is_linked:
           return
       tex_node = color_input.links[0].from_node
       if tex_node.type != 'TEX_IMAGE' or not tex_node.image:
           return
       img = tex_node.image
       if img.users > 1:
           img = img.copy()
           img.name = f"{mat_name}_tinted"
           tex_node.image = img
       w, h = img.size
       pixels = np.array(img.pixels[:], dtype=np.float32).reshape((h * w, 4))
       rgb = pixels[:, :3]
       v = rgb.max(axis=1)
       th, ts, tv = colorsys.rgb_to_hsv(*tint_color[:3])
       tint_rgb = np.array(colorsys.hsv_to_rgb(th, ts, 1.0), dtype=np.float32)
       tinted = tint_rgb[None, :] * v[:, None]
       pixels[:, :3] = tint_factor * tinted + (1 - tint_factor) * rgb
       img.pixels.foreach_set(pixels.ravel())
       img.update()
       if emission_strength is not None:
           emission.inputs['Strength'].default_value = emission_strength

   This replaces each pixel's hue+saturation with the tint's while keeping the original pixel's
   brightness (so shading/highlights/detail are preserved) — this works for near-pure-saturated
   colors like the model's red glow highlights, unlike a plain multiply which can't add a color
   channel that's already zero in the source pixel. Use tint_factor close to 1.0 for a decisive
   recolor; it always survives export because it edits actual texture pixels, not shader nodes.

   Example — recolor Body to purple:
   tint_existing_material('Body', tint_color=(0.55, 0.1, 0.85), tint_factor=0.9, emission_strength=1.8)

   Example — recolor Body to purple and boost glow:
   tint_existing_material('Body', tint_color=(0.55, 0.1, 0.85, 1.0), tint_factor=0.9, emission_strength=1.8)

   Use tint_factor close to 1.0 (e.g. 0.85-1.0) for a full, decisive recolor — this is a COLOR
   blend so it stays anchored to the base texture's shading/highlights even at factor 1.0.

3. BONE PARENTING HELPER:
   def attach_to_bone(obj, bone_name):
       armature = bpy.data.objects.get('Skeleton')
       if armature and bone_name in armature.data.bones:
           obj.parent = armature
           obj.parent_type = 'BONE'
           obj.parent_bone = bone_name

4. Return ONLY executable Python code inside a \`\`\`python ... \`\`\` code fence with a 1-sentence comment explaining the artistic decision.`;

export type TransformResult = {
  code: string;
  summary: string;
  estimatedCostUsd?: number;
};

// Hard cap limit in USD (30 pence, using the same USD->GBP display rate as route.ts: pence = usd * 78)
export const HARD_CAP_BUDGET_USD = 0.38;

const MAX_COMPLETION_TOKENS = 4500;
// Conservative estimate of prompt tokens on a retry (system prompt + user request + previous
// script/error appended). Used to size the worst-case cost of one call for the budget gate below.
const WORST_CASE_INPUT_TOKENS = 2500;

function worstCaseCallCostUsd(costPerInputM: number, costPerOutputM: number): number {
  return (WORST_CASE_INPUT_TOKENS * costPerInputM / 1_000_000) + (MAX_COMPLETION_TOKENS * costPerOutputM / 1_000_000);
}

/**
 * Generate procedural 3D operations using OpenAI, Anthropic, or Procedural Engine.
 * `costSoFarUsd` lets callers accumulate spend across retries so this function can refuse
 * to make another paid call once the hard budget cap is at risk.
 */
export async function generate3DTransformScript(
  prompt: string,
  previousError: string | null = null,
  previousScript: string | null = null,
  costSoFarUsd: number = 0
): Promise<TransformResult> {
  let userMessage = `User request: "${prompt}"\n`;
  if (previousError && previousScript) {
    userMessage += `\n[PREVIOUS ATTEMPT FAILED WITH ERROR]:\n${previousError}\n\n[PREVIOUS SCRIPT]:\n${previousScript}\n\nPlease fix the script to resolve the error while fulfilling the user request.`;
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiModel = process.env.OPENAI_MODEL ?? "gpt-6-astra";

  // Claude Sonnet 4.5 pricing: $3/M input tokens, $15/M output tokens
  const claudeCostPerInputM = 3.0;
  const claudeCostPerOutputM = 15.0;

  const isAstra = openaiModel.includes("astra");
  const openaiCostPerInputM = isAstra ? 10.0 : 2.5;
  const openaiCostPerOutputM = isAstra ? 50.0 : 10.0;

  const remainingBudgetUsd = HARD_CAP_BUDGET_USD - costSoFarUsd;
  const preferAnthropic = !!(anthropicApiKey && anthropicApiKey.trim() !== "");
  const worstCase = worstCaseCallCostUsd(
    preferAnthropic ? claudeCostPerInputM : openaiCostPerInputM,
    preferAnthropic ? claudeCostPerOutputM : openaiCostPerOutputM
  );
  const canAffordPaidCall = remainingBudgetUsd >= worstCase;

  let openaiFailureReason: string | null = null;

  if (!canAffordPaidCall) {
    console.warn(`[Agent3D] Remaining budget ($${remainingBudgetUsd.toFixed(4)}) can't safely cover another call's worst case ($${worstCase.toFixed(4)}) — skipping paid API call and using the free procedural fallback.`);
    openaiFailureReason = "budget cap reached";
  } else if (preferAnthropic) {
    // 1. Try Anthropic Claude (preferred provider)
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey: anthropicApiKey });
      console.log(`[Agent3D] Calling Anthropic (${anthropicModel}) - remaining budget: $${remainingBudgetUsd.toFixed(4)} of $${HARD_CAP_BUDGET_USD} cap`);

      const response = await anthropic.messages.create({
        model: anthropicModel,
        max_tokens: MAX_COMPLETION_TOKENS,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const inputTokens = response.usage?.input_tokens ?? 1200;
      const outputTokens = response.usage?.output_tokens ?? 800;
      const cost = (inputTokens * claudeCostPerInputM / 1_000_000) + (outputTokens * claudeCostPerOutputM / 1_000_000);
      const stopReason = response.stop_reason ?? "unknown";
      console.log(`[Agent3D] Claude token usage: ${inputTokens} in, ${outputTokens} out, stop_reason=${stopReason}. Approx cost: $${cost.toFixed(4)} (< $${HARD_CAP_BUDGET_USD})`);

      const textBlock = response.content.find((b) => b.type === "text");
      const rawText = textBlock ? (textBlock as any).text : "";
      const code = extractPythonCode(rawText);
      if (code) {
        return {
          code,
          summary: extractSummary(rawText) || `Generated 3D transformation for: ${prompt}`,
          estimatedCostUsd: cost
        };
      } else {
        console.warn(`[Agent3D] Claude returned a response but no Python code block was found (stop_reason=${stopReason}). Raw:`, rawText.slice(0, 200));
        openaiFailureReason = stopReason === "max_tokens"
          ? "the model ran out of tokens before writing any code"
          : "the model's response didn't contain a Python code block";
        return {
          ...generateProceduralRuleScript(prompt),
          summary: `AI generation failed (${openaiFailureReason}) — applied a generic fallback instead. Try rephrasing or simplifying the request.`,
          estimatedCostUsd: cost,
        };
      }
    } catch (err: any) {
      console.error("[Agent3D] Anthropic API call failed:", err.message);
      throw err; // Re-throw so the retry loop in route.ts can catch + retry with error context
    }
  } else if (openaiApiKey && openaiApiKey.trim() !== "") {
    // 2. Fall back to OpenAI if no Anthropic key is configured
    try {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: openaiApiKey });
      console.log(`[Agent3D] Calling OpenAI ${openaiModel} (reasoning model) - remaining budget: $${remainingBudgetUsd.toFixed(4)} of $${HARD_CAP_BUDGET_USD} cap`);

      // GPT-6 Astra is a reasoning model — temperature/top_p are NOT supported.
      // Use max_completion_tokens and reasoning_effort instead.
      const requestParams: any = {
        model: openaiModel,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      };

      // Add reasoning_effort only for models that support it (gpt-6-astra, o-series).
      // "low" leaves the most room in max_completion_tokens for the actual code, since
      // reasoning tokens are billed and counted against the same completion budget —
      // at "medium" the model previously burned its entire token budget on hidden
      // reasoning and returned zero visible output.
      if (openaiModel.includes("astra") || openaiModel.startsWith("o")) {
        requestParams.reasoning_effort = "low";
      } else {
        // Standard GPT models still support temperature
        requestParams.temperature = 0.3;
        requestParams.max_tokens = 2000;
        delete requestParams.max_completion_tokens;
      }

      const completion = await openai.chat.completions.create(requestParams);

      // GPT-6 Astra pricing: $10/M input tokens, $50/M output tokens
      const inputTokens = completion.usage?.prompt_tokens ?? 1200;
      const outputTokens = completion.usage?.completion_tokens ?? 800;
      const cost = (inputTokens * openaiCostPerInputM / 1_000_000) + (outputTokens * openaiCostPerOutputM / 1_000_000);
      const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
      console.log(`[Agent3D] OpenAI token usage: ${inputTokens} in, ${outputTokens} out, finish_reason=${finishReason}. Approx cost: $${cost.toFixed(4)} (< $${HARD_CAP_BUDGET_USD})`);

      const rawText = completion.choices[0]?.message?.content ?? "";
      const code = extractPythonCode(rawText);
      if (code) {
        return {
          code,
          summary: extractSummary(rawText) || `Generated 3D transformation for: ${prompt}`,
          estimatedCostUsd: cost
        };
      } else {
        console.warn(`[Agent3D] OpenAI returned a response but no Python code block was found (finish_reason=${finishReason}). Raw:`, rawText.slice(0, 200));
        openaiFailureReason = finishReason === "length"
          ? "the model ran out of tokens before writing any code (reasoning consumed the budget)"
          : "the model's response didn't contain a Python code block";
        // Still charge for the tokens actually spent, even though we couldn't use the result.
        return {
          ...generateProceduralRuleScript(prompt),
          summary: `AI generation failed (${openaiFailureReason}) — applied a generic fallback instead. Try rephrasing or simplifying the request.`,
          estimatedCostUsd: cost,
        };
      }
    } catch (err: any) {
      console.error("[Agent3D] OpenAI API call failed:", err.message);
      throw err; // Re-throw so the retry loop in route.ts can catch + retry with error context
    }
  } else {
    openaiFailureReason = "no AI provider API key configured";
  }

  // 3. Fallback procedural generator (no AI provider available or produced usable code)
  console.log(`[Agent3D] Using offline procedural fallback (${openaiFailureReason ?? "no provider available"}) for prompt: "${prompt}"`);
  const fallback = generateProceduralRuleScript(prompt);
  return {
    ...fallback,
    summary: openaiFailureReason
      ? `AI generation unavailable (${openaiFailureReason}) — applied a generic fallback instead: ${fallback.summary}`
      : fallback.summary,
  };
}

function extractPythonCode(text: string): string | null {
  const match = text.match(/```(?:python)?\s*([\s\S]*?)\s*```/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  if (text.includes("import bpy") || text.includes("bpy.data")) {
    return text.trim();
  }
  return null;
}

function extractSummary(text: string): string | null {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const comment = lines.find(l => !l.startsWith("```") && !l.startsWith("import") && !l.startsWith("#"));
  return comment ? comment.slice(0, 150) : null;
}

/**
 * Universal procedural fallback with fixed shader output nodes.
 */
function generateProceduralRuleScript(prompt: string): TransformResult {
  const p = prompt.toLowerCase();
  const chunks: string[] = [];
  let summary = "Custom 3D transformation applied";

  const colors: Record<string, string> = {
    cyan: "(0.0, 0.85, 1.0, 1.0)",
    neon_blue: "(0.05, 0.5, 1.0, 1.0)",
    futuristic: "(0.0, 0.85, 1.0, 1.0)",
    cyber: "(0.95, 0.05, 0.75, 1.0)",
    magenta: "(1.0, 0.08, 0.65, 1.0)",
    plasma: "(0.4, 0.1, 1.0, 1.0)",
    purple: "(0.65, 0.1, 0.95, 1.0)",
    gold: "(1.0, 0.78, 0.12, 1.0)",
    chrome: "(0.88, 0.9, 0.95, 1.0)",
    titanium: "(0.4, 0.42, 0.46, 1.0)",
    obsidian: "(0.03, 0.03, 0.04, 1.0)",
    green: "(0.1, 0.95, 0.3, 1.0)",
    red: "(0.95, 0.08, 0.05, 1.0)",
  };

  const detectedColorKey = Object.keys(colors).find(c => p.includes(c)) || "cyan";
  const colorRgba = colors[detectedColorKey];

  chunks.push(`
# Procedural helper functions
def get_or_create_material(name, base_color=(0.1, 0.1, 0.1, 1.0), metallic=0.0, roughness=0.5, emission_color=(0,0,0,1), emission_strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    output = next((n for n in nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if not output:
        output = nodes.new('ShaderNodeOutputMaterial')
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    if not any(l.to_node == output for l in links):
        links.new(bsdf.outputs[0], output.inputs['Surface'])
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

  // Transform existing shaders. Aatrox's materials are unlit glTF-style graphs
  // (Image Texture -> Emission.Color, no Principled BSDF). The glTF exporter embeds the Image
  // datablock's raw pixels and does NOT bake shader-node math, so recoloring must edit the
  // actual texture pixels (via numpy) rather than insert a node — a node-graph tint would look
  // right in Blender's viewport but silently vanish from the exported GLB.
  chunks.push(`
# ─── Shaders ───
def tint_existing_material(mat_name, tint_color=(1.0, 1.0, 1.0), tint_factor=0.9, emission_strength=None):
    import numpy as np, colorsys
    mat = bpy.data.materials.get(mat_name)
    if not (mat and mat.use_nodes):
        return
    nodes = mat.node_tree.nodes
    emission = next((n for n in nodes if n.type == 'EMISSION'), None)
    if not emission:
        return
    color_input = emission.inputs['Color']
    if not color_input.is_linked:
        return
    tex_node = color_input.links[0].from_node
    if tex_node.type != 'TEX_IMAGE' or not tex_node.image:
        return
    img = tex_node.image
    if img.users > 1:
        img = img.copy()
        img.name = f"{mat_name}_tinted"
        tex_node.image = img
    w, h = img.size
    pixels = np.array(img.pixels[:], dtype=np.float32).reshape((h * w, 4))
    rgb = pixels[:, :3]
    v = rgb.max(axis=1)
    th, ts, tv = colorsys.rgb_to_hsv(*tint_color[:3])
    tint_rgb = np.array(colorsys.hsv_to_rgb(th, ts, 1.0), dtype=np.float32)
    tinted = tint_rgb[None, :] * v[:, None]
    pixels[:, :3] = tint_factor * tinted + (1 - tint_factor) * rgb
    img.pixels.foreach_set(pixels.ravel())
    img.update()
    if emission_strength is not None:
        emission.inputs['Strength'].default_value = emission_strength

for mat_name in ['Body', 'Sword', 'Shoulder']:
    tint_existing_material(mat_name, tint_color=${colorRgba}, tint_factor=0.9, emission_strength=1.8)
`);

  summary = `Applied ${detectedColorKey} cyber metallic materials and neon emission shaders`;

  return {
    code: chunks.join("\n"),
    summary
  };
}
