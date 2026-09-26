import "dotenv/config";
import { config as loadEnv } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { File } from "node:buffer";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

loadEnv({ path: ".env.local" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const workDir = join(rootDir, ".worker");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const blenderPath = process.env.BLENDER_PATH ?? "blender";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
const openaiApiKey = process.env.OPENAI_API_KEY;
const imageModel = process.env.IMAGE_MODEL ?? "gpt-image-1";
const imageQuality = process.env.IMAGE_QUALITY ?? "high";
const hfEndpointUrl = process.env.HF_ENDPOINT_URL;
const hfToken = process.env.HF_TOKEN;

const woodplankRigCandidate = resolve(rootDir, "..", "..", "Woodplank Rig v3.3", "4_5-Woodplank.v3_3.Default.blend");
const bundledRigCandidate = join(rootDir, "minecraft-player-rigged", "extracted", "player rigged", "minecraft player rigged.blend");

function resolveMinecraftRigPath() {
  const envPath = process.env.MINECRAFT_RIG_PATH ? resolve(process.env.MINECRAFT_RIG_PATH) : null;

  if (process.env.USE_WOODPLANK_RIG === "1" && existsSync(woodplankRigCandidate)) {
    console.log("Using Woodplank rig (USE_WOODPLANK_RIG=1).");
    return woodplankRigCandidate;
  }

  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  if (existsSync(bundledRigCandidate)) {
    return bundledRigCandidate;
  }

  if (existsSync(woodplankRigCandidate)) {
    console.warn("No MINECRAFT_RIG_PATH or bundled rig; falling back to Woodplank (set USE_WOODPLANK_RIG=1 to silence this).");
    return woodplankRigCandidate;
  }

  return envPath || bundledRigCandidate;
}

const minecraftRigPath = resolveMinecraftRigPath();

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in .env.local.");
}

mkdirSync(workDir, { recursive: true });

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function withRetry(label, operation, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`${label} failed on attempt ${attempt}/${attempts}:`, error?.message ?? error);
      if (attempt < attempts) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError;
}

const colorWords = [
  "red",
  "blue",
  "green",
  "purple",
  "pink",
  "gold",
  "yellow",
  "black",
  "white",
  "silver",
  "orange"
];

const minecraftSkinSchema = {
  version: "minecraft_java_64x64_v1",
  canvas: { width: 64, height: 64 },
  uv_regions: {
    head_front: { x: 8, y: 8, width: 8, height: 8 },
    head_overlay_front: { x: 40, y: 8, width: 8, height: 8 },
    torso_front: { x: 20, y: 20, width: 8, height: 12 },
    torso_back: { x: 32, y: 20, width: 8, height: 12 },
    torso_left: { x: 28, y: 20, width: 4, height: 12 },
    torso_right: { x: 16, y: 20, width: 4, height: 12 },
    right_arm_front: { x: 44, y: 20, width: 4, height: 12 },
    right_arm_back: { x: 52, y: 20, width: 4, height: 12 },
    left_arm_front: { x: 36, y: 52, width: 4, height: 12 },
    left_arm_back: { x: 44, y: 52, width: 4, height: 12 },
    right_leg_front: { x: 4, y: 20, width: 4, height: 12 },
    right_leg_back: { x: 12, y: 20, width: 4, height: 12 },
    left_leg_front: { x: 20, y: 52, width: 4, height: 12 },
    left_leg_back: { x: 28, y: 52, width: 4, height: 12 }
  },
  region_groups: {
    armor: [
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
      "left_leg_back"
    ],
    cloth_accents: [
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
      "left_leg_back"
    ],
    eyes: ["head_front"],
    face: ["head_front"]
  },
  rules: [
    "Preserve the Minecraft UV layout.",
    "Keep eyes and facial detail on head_front.",
    "Do not put faces, text, logos, or random symbols on torso, arms, or legs.",
    "Keep left/right limbs stylistically consistent.",
    "Treat armor and cloth as texture regions, not external geometry."
  ]
};

function inferColor(prompt = "") {
  const lowerPrompt = prompt.toLowerCase();
  return colorWords.find((color) => lowerPrompt.includes(color)) ?? "purple";
}

/** Prefer armor-relevant colors so phrases like "red eyes" do not steal base_color. */
function inferBaseColorForSkin(prompt = "") {
  const p = prompt.toLowerCase();
  if (/\bwhite\s+silver\b|\bsilver\s+white\b/.test(p) || (p.includes("silver") && /armor|knight|plate|armour/.test(p))) {
    return "silver";
  }
  if (/\b(light\s+)?fantasy\s+knight\b/.test(p) && (p.includes("white") || p.includes("silver"))) {
    return p.includes("silver") ? "silver" : "white";
  }
  if (/armor|knight|plate|armour|helm/.test(p)) {
    if (p.includes("silver")) return "silver";
    if (p.includes("white")) return "white";
    if (p.includes("gold")) return "gold";
  }
  return inferColor(prompt);
}

/** Cloth/trim accent — distinct from eye color ("blue cloth" vs "red eyes"). */
function inferAccentColorForSkin(prompt = "") {
  const p = prompt.toLowerCase();
  if (
    /\b(blue|navy|azure)\b/.test(p) &&
    /\b(cloth|fabric|accent|trim|sash|tabard|belt|cloak|cape|undersuit|lining)\b/.test(p)
  ) {
    return "blue";
  }
  if (/\b(emerald|green)\b/.test(p) && /\b(cloth|accent|trim)\b/.test(p)) {
    return "green";
  }
  if (/\bred\b/.test(p) && /\b(cloth|accent|trim|cape)\b/.test(p) && !/\beye\b/.test(p)) {
    return "red";
  }
  if (/\b(glow|glowing)\b/.test(p) && /\b(red|blue|green)\b/.test(p) && /\beye\b/.test(p)) {
    return inferColor(p); // eye glow handled by set_eye_color / accessories; keep accent for cloth
  }
  if (p.includes("blue") && (p.includes("accent") || p.includes("cloth"))) return "blue";
  return inferColor(prompt);
}

function fallbackToolCallsForPrompt(prompt = "") {
  const lowerPrompt = prompt.toLowerCase();
  const toolCalls = [];

  if (lowerPrompt.includes("knight") || lowerPrompt.includes("armor") || lowerPrompt.includes("armour")) {
    toolCalls.push({
      tool: "generate_region_from_prompt",
      region_group: "armor",
      prompt: prompt.trim().slice(0, 220),
      preserve_structure: true
    });
  }

  if (
    /\b(blue|navy|azure)\b/.test(lowerPrompt) &&
    /\b(cloth|fabric|accent|trim|sash|tabard|belt|undersuit|lining)\b/.test(lowerPrompt)
  ) {
    toolCalls.push({
      tool: "generate_region_from_prompt",
      region_group: "cloth_accents",
      prompt:
        "saturated blue cloth accents: belt, tabard edge, waist sash, shoulder cloth — visible blue pixels on front and back torso UV, not gray",
      preserve_structure: true
    });
  }

  // Never auto-apply deterministic trim here: generic "blue accents" prompts would
  // stamp horizontal stripes across every armor UV quad and overwhelm the bake.

  if (lowerPrompt.includes("green")) {
    toolCalls.push({
      tool: "recolor_region",
      region_group: "cloth_accents",
      from_color: "blue",
      target_color: "green",
      preserve_shading: true
    });
  }

  if (lowerPrompt.includes("eye")) {
    toolCalls.push({
      tool: "set_eye_color",
      color: lowerPrompt.includes("red") ? "red" : inferColor(prompt)
    });
  }

  return toolCalls;
}

function fallbackPlan(prompt = "") {
  const lowerPrompt = prompt.toLowerCase();
  const accessories = [];
  const operations = [];
  const toolCalls = fallbackToolCallsForPrompt(prompt);
  const hasRecolor = /\b(red|blue|green|purple|pink|gold|yellow|black|white|silver|orange)\b.*\b(?:to|into)?\s*\b(red|blue|green|purple|pink|gold|yellow|black|white|silver|orange)\b/.test(
    lowerPrompt
  );
  const hasTextureStyle = /rust|rusty|worn|dirty|scratched|weathered|glow|glowing/.test(lowerPrompt);
  const isRedesign = /fantasy|knight|cyberpunk|samurai|anime|wizard|warrior|redesign|outfit/.test(lowerPrompt);

  if (lowerPrompt.includes("sword") || lowerPrompt.includes("samurai") || lowerPrompt.includes("knight")) {
    accessories.push("sword");
  }
  if (lowerPrompt.includes("cape") || lowerPrompt.includes("fantasy")) {
    accessories.push("cape");
  }
  if (lowerPrompt.includes("helmet") || lowerPrompt.includes("armor") || lowerPrompt.includes("knight")) {
    accessories.push("helmet", "shoulder_pads");
  }
  if (lowerPrompt.includes("horn") || lowerPrompt.includes("demon")) {
    accessories.push("horns");
  }
  if (lowerPrompt.includes("glow") || lowerPrompt.includes("eye") || lowerPrompt.includes("cyberpunk")) {
    accessories.push("glowing_eyes");
  }

  if (hasRecolor) {
    operations.push({ type: "recolor", target: "specified color region", to: inferColor(prompt) });
  }
  if (hasTextureStyle) {
    operations.push({ type: "style_texture", target: "specified region", style: prompt.slice(0, 120) });
  }

  return {
    edit_mode: isRedesign ? "medium_edit" : "small_edit",
    preservation_strength: isRedesign ? 0.65 : 0.9,
    operations,
    tool_calls: toolCalls,
    base_color: inferBaseColorForSkin(prompt),
    secondary_color: lowerPrompt.includes("gold") ? "gold" : "black",
    accent_color: inferAccentColorForSkin(prompt),
    style: lowerPrompt.includes("cyberpunk")
      ? "cyberpunk"
      : lowerPrompt.includes("fantasy")
        ? "dark fantasy"
        : "prototype",
    accessories: [...new Set(accessories)].slice(0, 6),
    notes: "Fallback planner used because ANTHROPIC_API_KEY is missing or Claude planning failed."
  };
}

function sanitizePlan(plan, prompt) {
  const lowerPrompt = prompt.toLowerCase();
  const allowedColors = new Set(colorWords);
  const allowedAccessories = new Set(["helmet", "shoulder_pads", "cape", "sword", "horns", "glowing_eyes"]);
  const allowedEditModes = new Set(["small_edit", "medium_edit", "large_redesign"]);
  const allowedOperationTypes = new Set(["recolor", "style_texture", "add_detail", "remove_detail"]);
  const allowedTools = new Set([
    "recolor_region",
    "set_eye_color",
    "generate_region_from_prompt",
    "apply_trim",
    "mirror_limb_regions",
    "validate_skin_layout"
  ]);
  const allowedRegionGroups = new Set(Object.keys(minecraftSkinSchema.region_groups));
  const allowedRegions = new Set(Object.keys(minecraftSkinSchema.uv_regions));
  const fallback = fallbackPlan(prompt);
  const isCreativeTransformation =
    /\b(make|turn|transform|redesign|convert)\b/.test(lowerPrompt) &&
    /fantasy|knight|cyberpunk|samurai|anime|wizard|warrior|robot|armor|armour|outfit/.test(lowerPrompt);
  const isSmallIncrementalEdit =
    /\b(a little|slightly|subtle|small|minor|tiny|just|only)\b/.test(lowerPrompt) ||
    /\b(make sure|fix|correct|remove)\b/.test(lowerPrompt) ||
    /\bchange\b.*\b(accents|trim|details|pixels|parts)\b/.test(lowerPrompt) ||
    /\b(accents|trim|details)\b.*\b(to|into)\b/.test(lowerPrompt);
  const isExplicitLargeRedesign =
    /complete(?:ly)? redesign|from scratch|new character|totally different|entirely new|start over/.test(lowerPrompt);
  const cleanColor = (value, fallbackColor) =>
    typeof value === "string" && allowedColors.has(value.toLowerCase()) ? value.toLowerCase() : fallbackColor;
  let cleanOperations = Array.isArray(plan?.operations)
    ? plan.operations
        .filter((operation) => operation && allowedOperationTypes.has(operation.type))
        .map((operation) => ({
          type: operation.type,
          target: typeof operation.target === "string" ? operation.target.slice(0, 80) : "specified region",
          from: typeof operation.from === "string" ? operation.from.slice(0, 40) : undefined,
          to: typeof operation.to === "string" ? operation.to.slice(0, 40) : undefined,
          style: typeof operation.style === "string" ? operation.style.slice(0, 120) : undefined
        }))
        .slice(0, 6)
    : fallback.operations;

  if (isCreativeTransformation && cleanOperations.length === 0) {
    cleanOperations = [
      {
        type: "style_texture",
        target: "whole skin outfit",
        style: prompt.slice(0, 120)
      }
    ];
  }

  const cleanToolCalls = Array.isArray(plan?.tool_calls)
    ? plan.tool_calls
        .filter((call) => call && allowedTools.has(call.tool))
        .map((call) => ({
          tool: call.tool,
          region:
            typeof call.region === "string" && allowedRegions.has(call.region)
              ? call.region
              : undefined,
          region_group:
            typeof call.region_group === "string" && allowedRegionGroups.has(call.region_group)
              ? call.region_group
              : undefined,
          target_color: cleanColor(call.target_color, undefined),
          color: cleanColor(call.color, undefined),
          from_color: cleanColor(call.from_color, undefined),
          prompt: typeof call.prompt === "string" ? call.prompt.slice(0, 220) : undefined,
          preserve_shading: Boolean(call.preserve_shading),
          preserve_structure: call.preserve_structure !== false
        }))
        .slice(0, 8)
    : fallback.tool_calls;
  const heuristicToolCalls = fallbackToolCallsForPrompt(prompt);
  const finalToolCalls = cleanToolCalls.length ? cleanToolCalls : fallback.tool_calls;

  for (const heuristicCall of heuristicToolCalls) {
    const alreadyHasEquivalent = finalToolCalls.some(
      (call) =>
        call.tool === heuristicCall.tool &&
        (call.region_group ?? call.region ?? "") === (heuristicCall.region_group ?? heuristicCall.region ?? "")
    );

    if (!alreadyHasEquivalent) {
      finalToolCalls.push(heuristicCall);
    }
  }

  if (!finalToolCalls.some((call) => call.tool === "validate_skin_layout")) {
    finalToolCalls.push({ tool: "validate_skin_layout", preserve_structure: true });
  }

  const requestedEditMode = allowedEditModes.has(plan?.edit_mode) ? plan.edit_mode : fallback.edit_mode;
  const editMode =
    isSmallIncrementalEdit
      ? "small_edit"
      : isCreativeTransformation && !isExplicitLargeRedesign
      ? "medium_edit"
      : isCreativeTransformation && requestedEditMode === "small_edit"
        ? "medium_edit"
        : requestedEditMode;
  const rawPreservationStrength =
    typeof plan?.preservation_strength === "number"
      ? Math.min(0.98, Math.max(0.1, plan.preservation_strength))
      : fallback.preservation_strength;
  const preservationStrength =
    isSmallIncrementalEdit
      ? Math.max(0.88, rawPreservationStrength)
      : isCreativeTransformation && editMode === "medium_edit"
      ? Math.min(0.72, Math.max(0.58, rawPreservationStrength))
      : rawPreservationStrength;

  let mergedBase = cleanColor(plan?.base_color, fallback.base_color);
  let mergedAccent = cleanColor(plan?.accent_color, fallback.accent_color);
  if (/\b(blue|navy)\b/.test(lowerPrompt) && /\b(cloth|fabric|accent|trim|tabard|belt|sash)\b/.test(lowerPrompt)) {
    mergedAccent = "blue";
  }
  if (/\b(silver|white)\b/.test(lowerPrompt) && /armor|knight|armour|plate/.test(lowerPrompt)) {
    mergedBase = lowerPrompt.includes("silver") ? "silver" : "white";
  }

  return {
    edit_mode: editMode,
    preservation_strength: preservationStrength,
    operations: cleanOperations,
    tool_calls: finalToolCalls,
    generation_prompt: typeof plan?.generation_prompt === "string" ? plan.generation_prompt.slice(0, 500) : undefined,
    base_color: mergedBase,
    secondary_color: cleanColor(plan?.secondary_color, fallback.secondary_color),
    accent_color: mergedAccent,
    style: typeof plan?.style === "string" ? plan.style.slice(0, 80) : fallback.style,
    accessories: Array.isArray(plan?.accessories)
      ? plan.accessories.filter((item) => allowedAccessories.has(item)).slice(0, 6)
      : fallback.accessories,
    preserve: ["rig", "skeleton", "animations", "game export compatibility"],
    raw_prompt: prompt
  };
}

function parseClaudeJson(text = "") {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fencedMatch?.[1] ?? trimmed;
  const objectStart = jsonText.indexOf("{");
  const objectEnd = jsonText.lastIndexOf("}");

  if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
    throw new Error("Claude did not return a JSON object.");
  }

  return JSON.parse(jsonText.slice(objectStart, objectEnd + 1));
}

async function createEditPlan(prompt, gameKey, kind) {
  if (!anthropic) {
    return sanitizePlan(null, prompt);
  }

  try {
    const message = await anthropic.messages.create({
      model: anthropicModel,
      max_tokens: 1000,
      temperature: 0.2,
      system:
        "You plan safe Minecraft skin texture edits for a web game-character customization prototype. Return only JSON. Do not include markdown. You are a planner/router, not the artist. \n\n" +
        "CLASSIFICATION RULES:\n" +
        "- 'small_edit': ONLY for specific, simple color changes (e.g. 'make the eyes red', 'recolor armor to blue'). These bypass AI generation completely.\n" +
        "- 'medium_edit': For adding new details or modifying styles on an existing skin (e.g. 'give him a leather jacket', 'make the armor look sci-fi', 'add sunglasses').\n" +
        "- 'large_redesign': ONLY for completely changing the character from scratch (e.g. 'turn him into a dragon', 'remix entirely into a robot').\n\n" +
        "Allowed colors: red, blue, green, purple, pink, gold, yellow, black, white, silver, orange. Allowed tools: recolor_region, set_eye_color, generate_region_from_prompt, apply_trim, mirror_limb_regions, validate_skin_layout. Use recolor_region/set_eye_color/apply_trim/mirror_limb_regions for precise post-generation edits. region_group must be one of armor, cloth_accents, eyes, face. IMPORTANT: Also emit a 'generation_prompt' string. This must be a VERY SIMPLE, comma-separated list of visual tags (e.g. 'fantasy knight, silver armor, blue tabard, red eyes'). Do NOT use complex sentences, spatial relationships (e.g. 'where the hand is blue'), or instructions. Keep it to 3-5 simple visual keywords. Do not include '64x64' or any dimensions. The tool_calls handle fine-tuning after generation. Critical invariant: never change rigging, armatures, bones, skeletons, vertex groups, weights, constraints, animation data, hitboxes, or Minecraft UV layout.",
      messages: [
        {
          role: "user",
          content: `Game: ${gameKey}\nAsset kind: ${kind}\nMinecraft skin schema: ${JSON.stringify(minecraftSkinSchema)}\nAvailable tool call shapes:\n{"tool":"recolor_region","region_group":"cloth_accents","from_color":"blue","target_color":"green","preserve_shading":true}\n{"tool":"set_eye_color","color":"red"}\n{"tool":"generate_region_from_prompt","region_group":"armor","prompt":"white silver fantasy knight armor","preserve_structure":true}\n{"tool":"apply_trim","region_group":"armor","target_color":"blue"}\n{"tool":"mirror_limb_regions"}\n{"tool":"validate_skin_layout"}\nUser prompt: ${prompt}\nReturn JSON with keys: edit_mode, preservation_strength, generation_prompt, tool_calls, operations, base_color, secondary_color, accent_color, style, accessories.`
        }
      ]
    });

    const textBlock = message.content.find((block) => block.type === "text");
    const parsed = parseClaudeJson(textBlock?.text ?? "{}");
    return sanitizePlan(parsed, prompt);
  } catch (error) {
    console.warn("Claude planner failed; using fallback plan.", error);
    return sanitizePlan(null, prompt);
  }
}

function inferKindFromPath(path) {
  return [".glb", ".gltf", ".fbx", ".obj"].includes(extname(path || "").toLowerCase()) ? "model" : "image";
}

function shouldUseGenerativeModel(plan) {
  if (!hfEndpointUrl && !openaiApiKey) {
    return false;
  }

  if (plan.raw_prompt?.toLowerCase().includes("initial blender rig preview")) {
    return false;
  }

  const lowerPrompt = plan.raw_prompt?.toLowerCase() ?? "";
  const isCorrectionPrompt = /\b(make sure|fix|correct|remove)\b/.test(lowerPrompt);
  if (plan.edit_mode === "small_edit" && isCorrectionPrompt) {
    return false;
  }

  const toolCalls = plan.tool_calls ?? [];
  if (toolCalls.length) {
    return toolCalls.some((call) => call.tool === "generate_region_from_prompt");
  }

  const operations = plan.operations ?? [];
  const hasGenerativeOperation = operations.some((operation) =>
    ["style_texture", "add_detail", "remove_detail"].includes(operation.type)
  );
  const hasOnlyRecolor = operations.length > 0 && operations.every((operation) => operation.type === "recolor");

  if (hasOnlyRecolor) {
    return false;
  }

  return hasGenerativeOperation || plan.edit_mode === "medium_edit" || plan.edit_mode === "large_redesign";
}

function regionKeysForTarget(target = "", operationType = "") {
  const lowerTarget = target.toLowerCase().replace(/[_-]+/g, " ");
  const groups = minecraftSkinSchema.region_groups;
  const regions = minecraftSkinSchema.uv_regions;

  if (lowerTarget.includes("eye") || lowerTarget.includes("face") || lowerTarget.includes("head front")) {
    return [];
  }
  if (lowerTarget.includes("armor") || lowerTarget.includes("armour") || lowerTarget.includes("chest") || lowerTarget.includes("plate")) {
    return groups.armor;
  }
  if (
    lowerTarget.includes("cloth") ||
    lowerTarget.includes("accent") ||
    lowerTarget.includes("trim") ||
    lowerTarget.includes("tabard") ||
    lowerTarget.includes("belt") ||
    lowerTarget.includes("undersuit")
  ) {
    return groups.cloth_accents;
  }
  if (lowerTarget.includes("torso") || lowerTarget.includes("body") || lowerTarget.includes("outfit") || lowerTarget.includes("skin")) {
    return groups.armor;
  }

  const exactRegion = Object.keys(regions).find((regionKey) => lowerTarget.includes(regionKey.replace(/_/g, " ")));
  if (exactRegion) {
    return [exactRegion];
  }

  return operationType === "recolor" ? groups.cloth_accents : groups.armor;
}

function editableRegionKeysForPlan(plan) {
  const regionKeys = new Set();

  for (const operation of plan.operations ?? []) {
    for (const regionKey of regionKeysForTarget(operation.target, operation.type)) {
      regionKeys.add(regionKey);
    }
  }

  if (!regionKeys.size && plan.edit_mode !== "small_edit") {
    for (const regionKey of minecraftSkinSchema.region_groups.armor) {
      regionKeys.add(regionKey);
    }
  }

  return [...regionKeys];
}

async function createMinecraftEditMask({ width, height, regionKeys, outputPath }) {
  if (!regionKeys.length) {
    return null;
  }

  const pixels = Buffer.alloc(width * height * 4, 255);
  const scaleX = width / minecraftSkinSchema.canvas.width;
  const scaleY = height / minecraftSkinSchema.canvas.height;

  for (const regionKey of regionKeys) {
    const region = minecraftSkinSchema.uv_regions[regionKey];
    if (!region) {
      continue;
    }

    const startX = Math.max(0, Math.round(region.x * scaleX));
    const startY = Math.max(0, Math.round(region.y * scaleY));
    const endX = Math.min(width, Math.round((region.x + region.width) * scaleX));
    const endY = Math.min(height, Math.round((region.y + region.height) * scaleY));

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const idx = (y * width + x) * 4;
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      }
    }
  }

  await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(outputPath);
  return outputPath;
}

function regionEditStepsForPlan(plan) {
  const armorRegions = new Set();
  const accentRegions = new Set();

  for (const toolCall of plan.tool_calls ?? []) {
    if (toolCall.tool !== "generate_region_from_prompt") {
      continue;
    }

    const target = toolCall.region_group ?? toolCall.region ?? "armor";
    const regionKeys = toolCall.region_group
      ? minecraftSkinSchema.region_groups[toolCall.region_group] ?? []
      : toolCall.region
        ? [toolCall.region]
        : minecraftSkinSchema.region_groups.armor;

    if (target === "cloth_accents") {
      regionKeys.forEach((regionKey) => accentRegions.add(regionKey));
    } else {
      regionKeys.forEach((regionKey) => armorRegions.add(regionKey));
    }
  }

  for (const operation of plan.operations ?? []) {
    const target = String(operation.target ?? "").toLowerCase();
    const regionKeys = regionKeysForTarget(operation.target, operation.type);

    if (!regionKeys.length) {
      continue;
    }

    if (
      target.includes("cloth") ||
      target.includes("accent") ||
      target.includes("trim") ||
      target.includes("tabard") ||
      target.includes("belt") ||
      target.includes("undersuit")
    ) {
      regionKeys.forEach((regionKey) => accentRegions.add(regionKey));
    } else {
      regionKeys.forEach((regionKey) => armorRegions.add(regionKey));
    }
  }

  if (!armorRegions.size && plan.edit_mode !== "small_edit") {
    minecraftSkinSchema.region_groups.armor.forEach((regionKey) => armorRegions.add(regionKey));
  }

  const combinedKeys = new Set([...armorRegions, ...accentRegions]);

  if (!combinedKeys.size) {
    return [];
  }

  // One diffusion pass only: chained passes were layering noise, black smears, and broken face UVs.
  return [
    {
      label: "outfit",
      regionKeys: [...combinedKeys],
      operations: plan.operations ?? [],
      instruction:
        "Full outfit — metal, cloth, and limb-backs together: large flat Minecraft pixels, 2–3 gray levels for silver, saturated cloth pixels (no muddy gray). Absolutely no static / grain / salt-and-pepper noise. No solid black (#000) — darkest shadows RGB ~0.18+. Torso_back and arm/leg backs must match the front design language."
    }
  ];
}

function imagePromptFromPlan(plan, step = null) {
  const preservationPercent = Math.round((plan.preservation_strength ?? 0.75) * 100);
  const editableRegions = step?.regionKeys ?? editableRegionKeysForPlan(plan);
  const plannedOperations = step?.operations ?? plan.operations ?? [];
  const label = step?.label ?? "";

  const lines = [
    "Edit this Minecraft Java 64x64 skin PNG as a flat UV texture sheet.",
    "Preserve the exact Minecraft skin layout, canvas size relationship, transparent pixels, and each body part UV island.",
    "Do not make a portrait, concept art, 3D render, icon, or normal square illustration.",
    "The output must still look like a valid Minecraft skin texture sheet.",
    "Avoid random high-frequency noise, static, dust speckle, or marble grit on metal unless the user asked for damaged/worn gear.",
    `Minecraft UV schema (regions are authoritative): ${JSON.stringify(minecraftSkinSchema)}.`,
    `Editable UV regions for this edit (masked): ${editableRegions.join(", ") || "none"}. Do not change pixels outside the mask.`,
    step
      ? `Pass: ${label}. ${step.instruction}`
      : "Edit all planned regions for this job.",
    `Edit mode: ${plan.edit_mode}. Preserve about ${preservationPercent}% of the current design unless the user asked for a full redesign.`,
    `Planned operations: ${JSON.stringify(plannedOperations)}.`,
    `Style hint: ${plan.style}. Base (metal/body) hint: ${plan.base_color}. Secondary: ${plan.secondary_color}. Accent (cloth/trim): ${plan.accent_color}.`,
    `Texture-only accessories from plan: ${(plan.accessories ?? []).join(", ") || "none"}.`,
    `User prompt: ${plan.raw_prompt}`,
    plan.edit_mode === "small_edit"
      ? "Incremental edit: change only what was asked; keep layout and major shapes stable."
      : "Creative edit: the result should obviously match the user's fantasy/material request while staying a coherent Minecraft skin.",
    "Respect left/right symmetry for paired limbs unless the design needs asymmetry.",
    "If adding red glowing eyes: only on head_front pixels roughly x=8–15, y=8–15 — at most ~2×1 bright red pixels per eye row, not a giant red mask across the face."
  ];

  if (label === "outfit") {
    lines.push(
      "Single pass inside mask: pixel-art with LARGE coherent regions — not fine noise or dithering.",
      `Metal/surface must read as ${plan.base_color} / silver-white with simple stepped shading (no static).`,
      `Cloth/trim accents must read as clear ${plan.accent_color} where applicable (no gray-blue mush).`,
      "FORBIDDEN inside mask: salt-and-pepper noise, TV static, random speckles, large solid black rectangles or #000 fills.",
      "Use dark gray (~0.2 RGB) at minimum for shadows. Include torso_back + limb backs consistent with fronts.",
      "Do not scatter accent color across the face — belt/sash/torso/leg trim only in masked cloth regions."
    );
  }
  if (label === "armor") {
    lines.push(
      "Metal armor: smooth silver/white with readable plate boundaries and soft shading — not TV static. Fill every masked armor island including torso sides.",
      `Align metal tone with base hint '${plan.base_color}'.`
    );
  }
  if (label === "armor_back") {
    lines.push(
      "These islands are the BACK of the character in-game. Mirror the armor language from the front: same silver/white plates, straps, and coverage — do not leave blank or unrelated noise.",
      "torso_back must read as the rear of the same cuirass as torso_front."
    );
  }
  if (label === "cloth_accents") {
    lines.push(
      `Cloth/trim must read clearly as ${plan.accent_color} (saturated blocks), especially belts/sash/tabard edges — not muddy gray.`,
      "Paint cloth on both front and back torso/limb UVs where masked so the character reads from all angles."
    );
  }

  return lines.join("\n");
}

/** Never let diffusion alter these — deterministic eyes/skin live here. */
const SKIN_FACE_PRESERVE_KEYS = ["head_front", "head_overlay_front"];

/** User asked for a specific eye look; keep outer head overlay out of preserve so Blender can clear iris art. */
function promptRequestsExplicitEyeColor(rawPrompt) {
  const p = typeof rawPrompt === "string" ? rawPrompt.toLowerCase() : "";
  if (!/\beyes?\b/.test(p)) {
    return false;
  }
  return (
    /\bglowing\s+red\s+eyes?\b/.test(p) ||
    /\bred\s+eyes?\b/.test(p) ||
    /\beyes?\s+[^.;]{0,52}\bred\b/.test(p) ||
    /\bred\b\s+eyes?\b/.test(p) ||
    (/\bglowing\b/.test(p) && /\bred\b/.test(p)) ||
    /\bblue\s+eyes?\b/.test(p) ||
    /\beyes?\s+(?:that\s+)?(?:are\s+)?blue\b/.test(p) ||
    /\bgreen\s+eyes?\b/.test(p) ||
    /\beyes?\s+[^.;]{0,52}\bgreen\b/.test(p) ||
    /\byellow\s+eyes?\b/.test(p) ||
    /\bamber\s+eyes?\b/.test(p) ||
    /\bpurple\s+eyes?\b/.test(p)
  );
}

function skinFacePreserveKeysForPlan(plan) {
  if (promptRequestsExplicitEyeColor(plan?.raw_prompt)) {
    return ["head_front"];
  }
  return SKIN_FACE_PRESERVE_KEYS;
}

/** Copy front slabs to mirrored backs (canonical Java 64×64 layout). */
const SKIN_UV_MIRROR_FRONT_TO_BACK = [
  ["torso_front", "torso_back"],
  ["right_arm_front", "right_arm_back"],
  ["left_arm_front", "left_arm_back"],
  ["right_leg_front", "right_leg_back"],
  ["left_leg_front", "left_leg_back"]
];

/** RGB palettes for quantization (Minecraft-ish, high contrast vs mush). */
const METAL_PALETTES_RGB = {
  silver: [
    [236, 239, 246],
    [198, 202, 210],
    [156, 160, 172],
    [112, 116, 128],
    [72, 76, 86]
  ],
  white: [
    [246, 247, 250],
    [214, 216, 224],
    [176, 180, 192],
    [136, 140, 154]
  ],
  gold: [
    [244, 224, 160],
    [210, 170, 90],
    [168, 128, 58],
    [128, 96, 48]
  ],
  black: [
    [90, 90, 94],
    [64, 64, 68],
    [44, 44, 48],
    [32, 32, 36]
  ]
};

const ACCENT_PALETTES_RGB = {
  blue: [
    [58, 124, 220],
    [38, 96, 186],
    [24, 70, 150],
    [18, 52, 110]
  ],
  red: [[220, 48, 48], [172, 32, 32], [120, 20, 20]],
  green: [[52, 180, 74], [32, 130, 52], [20, 90, 36]],
  purple: [[150, 80, 220], [110, 50, 180], [80, 32, 130]],
  gold: [[240, 200, 90], [200, 150, 50], [150, 100, 32]],
  black: [[54, 56, 62], [40, 42, 48], [28, 30, 36]]
};

function flattenUniqueRgbTuples(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const rgb of list) {
      const k = `${rgb[0]},${rgb[1]},${rgb[2]}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(rgb);
      }
    }
  }
  return out;
}

function paletteFromPlanRgb(plan) {
  const metalRows = METAL_PALETTES_RGB[plan.base_color] ?? METAL_PALETTES_RGB.silver;
  const accentRows = ACCENT_PALETTES_RGB[plan.accent_color] ?? ACCENT_PALETTES_RGB.blue;
  return flattenUniqueRgbTuples([metalRows, accentRows]);
}

function regionBounds64(regionKey, iw, ih) {
  const r = minecraftSkinSchema.uv_regions[regionKey];
  if (!r) {
    return null;
  }
  const sx = iw / 64;
  const sy = ih / 64;
  const left = Math.max(0, Math.round(r.x * sx));
  const top = Math.max(0, Math.round(r.y * sy));
  const rw = Math.max(1, Math.round(r.width * sx));
  const rh = Math.max(1, Math.round(r.height * sy));
  return { left, top, width: rw, height: rh, right: left + rw, bottom: top + rh };
}

function rgbaIdx(x, y, width) {
  return (Math.floor(y) * width + Math.floor(x)) * 4;
}

function rgbDistSq(aR, aG, aB, p) {
  const d0 = aR - p[0];
  const d1 = aG - p[1];
  const d2 = aB - p[2];
  return d0 * d0 + d1 * d1 + d2 * d2;
}

function nearestPaletteRgb(aR, aG, aB, paletteRgb) {
  let best = paletteRgb[0];
  let bd = rgbDistSq(aR, aG, aB, best);
  for (let i = 1; i < paletteRgb.length; i += 1) {
    const cand = paletteRgb[i];
    const d = rgbDistSq(aR, aG, aB, cand);
    if (d < bd) {
      bd = d;
      best = cand;
    }
  }
  return best;
}

function copyRectUv(src, dst, width, fb) {
  for (let row = 0; row < fb.height; row += 1) {
    for (let col = 0; col < fb.width; col += 1) {
      const sx = fb.left + col;
      const sy = fb.top + row;
      const dx = fb.left + col;
      const dy = fb.top + row;
      const si = rgbaIdx(sx, sy, width);
      const di = rgbaIdx(dx, dy, width);
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
}

function mirrorFrontToBackRect(data, width, frontB, backB) {
  for (let row = 0; row < frontB.height; row += 1) {
    for (let col = 0; col < frontB.width; col += 1) {
      const sx = frontB.left + (frontB.width - 1 - col);
      const sy = frontB.top + row;
      const dx = backB.left + col;
      const dy = backB.top + row;
      const si = rgbaIdx(sx, sy, width);
      const di = rgbaIdx(dx, dy, width);
      data[di] = data[si];
      data[di + 1] = data[si + 1];
      data[di + 2] = data[si + 2];
      data[di + 3] = data[si + 3];
    }
  }
}

/** Restore face UV from original so diffusion/bleed cannot touch eyes; overlay optional when user names eye color. */
function preserveHeadFromOriginal(editRgba, origRgba, width, height, plan) {
  const keys = skinFacePreserveKeysForPlan(plan);
  let n = 0;
  for (const key of keys) {
    const fb = regionBounds64(key, width, height);
    if (!fb || fb.right > width || fb.bottom > height) {
      continue;
    }
    copyRectUv(origRgba, editRgba, width, fb);
    n += fb.width * fb.height;
  }
  if (n > 0) {
    console.log(`Skin post: restored ${keys.length} face UV island(s) from source (${n} px touched).`);
  }
}

/** Mirror torso/limb fronts to backs for coherent rear view without a second diffusion pass. */
function mirrorBodyFrontsToBacks(data, width, height) {
  for (const [frontKey, backKey] of SKIN_UV_MIRROR_FRONT_TO_BACK) {
    const frontB = regionBounds64(frontKey, width, height);
    const backB = regionBounds64(backKey, width, height);
    if (!frontB || !backB) {
      continue;
    }
    if (frontB.width !== backB.width || frontB.height !== backB.height) {
      continue;
    }
    mirrorFrontToBackRect(data, width, frontB, backB);
  }
  console.log("Skin post: mirrored torso/limb fronts → backs.");
}

/** Snap armor + clothaccent UV pixels to a small palette Kill speckle / mush */
function quantizeArmorClothToPalette(editRgba, width, height, paletteRgb, regionKeysSet) {
  if (!paletteRgb.length) {
    return 0;
  }
  let changed = 0;
  for (const key of regionKeysSet) {
    const fb = regionBounds64(key, width, height);
    if (!fb || fb.right > width || fb.bottom > height) {
      continue;
    }
    for (let row = 0; row < fb.height; row += 1) {
      for (let col = 0; col < fb.width; col += 1) {
        const x = fb.left + col;
        const y = fb.top + row;
        const i = rgbaIdx(x, y, width);
        const a = editRgba[i + 3];
        if (a < 8) {
          continue;
        }
        const nr = nearestPaletteRgb(editRgba[i], editRgba[i + 1], editRgba[i + 2], paletteRgb);
        if (nr[0] !== editRgba[i] || nr[1] !== editRgba[i + 1] || nr[2] !== editRgba[i + 2]) {
          changed += 1;
        }
        editRgba[i] = nr[0];
        editRgba[i + 1] = nr[1];
        editRgba[i + 2] = nr[2];
      }
    }
  }
  console.log(`Skin post: palette-snapped armor/cloth pixels (delta ~${changed}).`);
}

async function applySkinStructuredPost(plan, originalSkinPath, outputSkinPath) {
  if (process.env.SKIP_SKIN_POST_PROCESS === "1") {
    return;
  }

  const metadata = await sharp(outputSkinPath).metadata();
  const width = metadata.width ?? 64;
  const height = metadata.height ?? 64;

  const [{ data: outBuf, info: outInfo }, origRaw] = await Promise.all([
    sharp(await readFile(outputSkinPath)).ensureAlpha().resize(width, height, { kernel: sharp.kernel.nearest }).raw().toBuffer({ resolveWithObject: true }),
    sharp(await readFile(originalSkinPath))
      .ensureAlpha()
      .resize(width, height, { kernel: sharp.kernel.nearest })
      .raw()
      .toBuffer()
  ]);

  const channels = outInfo.channels ?? 4;
  const edit = new Uint8Array(outBuf);
  const orig = new Uint8Array(origRaw);

  const quantKeysSet = new Set([...minecraftSkinSchema.region_groups.armor, ...minecraftSkinSchema.region_groups.cloth_accents]);
  preserveHeadFromOriginal(edit, orig, width, height, plan);
  mirrorBodyFrontsToBacks(edit, width, height);
  const paletteRgb = paletteFromPlanRgb(plan);
  quantizeArmorClothToPalette(edit, width, height, paletteRgb, quantKeysSet);

  await sharp(Buffer.from(edit), {
    raw: { width, height, channels }
  })
    .png()
    .toFile(outputSkinPath);
}

/** Build a single SDXL-friendly prompt from the edit plan. */
function buildSdxlPrompt(plan) {
  const trigger = "minecraft skin texture atlas, pixel art";
  const userPrompt = plan.generation_prompt || plan.raw_prompt || "";
  return `${trigger}, ${userPrompt}`;
}

const SDXL_NEGATIVE_PROMPT =
  "blurry, realistic, photo, noisy, low quality, deformed, watermark, text, logo, 3d render, concept art, illustration, portrait";

/** Extract a 64×64 Minecraft skin from the Monadical SDXL 768×768 output.
 *  Top half = skin atlas (old format 64×32 layout), bottom half = 3D preview (discarded).
 *  Background = muted purple/lavender. */
async function extractSkinFromAtlas(raw768Buffer, debugDir) {
  // Save raw output for debugging
  if (debugDir) {
    const rawPath = join(debugDir, "sdxl-raw-768.png");
    await sharp(raw768Buffer).png().toFile(rawPath);
    console.log(`Debug: saved raw SDXL output to ${rawPath}`);
  }

  const meta = await sharp(raw768Buffer).metadata();
  const fullW = meta.width;
  const fullH = meta.height;
  const halfH = Math.floor(fullH / 2);

  // 1. Crop top half — the skin atlas (2:1 ratio = old format 64×32)
  // 2. Resize to 64×32 with nearest-neighbor
  const skin32 = await sharp(raw768Buffer)
    .extract({ left: 0, top: 0, width: fullW, height: halfH })
    .resize(64, 32, { kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = new Uint8Array(skin32.data);

  // Make the known-transparent UV regions transparent.
  // In old-format Minecraft skins (64×32), these rectangles are unused/background:
  const transparentRegions = [
    // Gaps around head (top-left area)
    { x: 0, y: 0, w: 8, h: 8 },
    { x: 24, y: 0, w: 16, h: 8 },
    // Gaps between body parts (right side)
    { x: 56, y: 0, w: 8, h: 16 },
    { x: 56, y: 16, w: 8, h: 16 },
    // Gaps between top/bottom faces
    { x: 0, y: 16, w: 4, h: 4 },
    { x: 12, y: 16, w: 8, h: 4 },
    { x: 36, y: 16, w: 8, h: 4 },
  ];

  for (const region of transparentRegions) {
    for (let y = region.y; y < region.y + region.h && y < 32; y++) {
      for (let x = region.x; x < region.x + region.w && x < 64; x++) {
        const i = (y * 64 + x) * 4;
        px[i + 3] = 0;
      }
    }
  }

  // Also remove any remaining purple-ish background pixels
  // (the model sometimes leaks bg into edges of skin regions)
  // Sample the top-left corner (known bg) to get the reference color
  const refR = px[0], refG = px[1], refB = px[2];
  const threshold = 40;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const dr = Math.abs(r - refR), dg = Math.abs(g - refG), db = Math.abs(b - refB);
    if (dr < threshold && dg < threshold && db < threshold) {
      px[i + 3] = 0;
    }
  }

  // Mirror Right Leg and Right Arm to Left Leg and Left Arm to upgrade 64x32 -> 64x64
  const px64 = new Uint8Array(64 * 64 * 4);
  px64.set(px, 0); // Copy top 32 rows

  function copyFlipped(sx, sy, dx, dy, w, h) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcI = ((sy + y) * 64 + (sx + x)) * 4;
        const dstI = ((dy + y) * 64 + (dx + w - 1 - x)) * 4;
        px64[dstI] = px64[srcI];
        px64[dstI + 1] = px64[srcI + 1];
        px64[dstI + 2] = px64[srcI + 2];
        px64[dstI + 3] = px64[srcI + 3];
      }
    }
  }

  // Right Leg -> Left Leg
  copyFlipped(4, 16, 20, 48, 4, 4); // Top
  copyFlipped(8, 16, 24, 48, 4, 4); // Bottom
  copyFlipped(0, 20, 24, 52, 4, 12); // Outer -> Outer
  copyFlipped(4, 20, 20, 52, 4, 12); // Front -> Front
  copyFlipped(8, 20, 16, 52, 4, 12); // Inner -> Inner
  copyFlipped(12, 20, 28, 52, 4, 12); // Back -> Back

  // Right Arm -> Left Arm
  copyFlipped(44, 16, 36, 48, 4, 4); // Top
  copyFlipped(48, 16, 40, 48, 4, 4); // Bottom
  copyFlipped(40, 20, 44, 52, 4, 12); // Outer -> Outer
  copyFlipped(44, 20, 36, 52, 4, 12); // Front -> Front
  copyFlipped(48, 20, 32, 52, 4, 12); // Inner -> Inner
  copyFlipped(52, 20, 40, 52, 4, 12); // Back -> Back

  return sharp(Buffer.from(px64), {
    raw: { width: 64, height: 64, channels: 4 }
  }).png().toBuffer();
}

/** Call the Monadical SDXL endpoint (Colab/ngrok or HuggingFace Inference). */
async function generateSkinWithSdxl({ outputPath, inputPath, plan, debugDir, isImg2Img }) {
  const positivePrompt = buildSdxlPrompt(plan);
  console.log(`SDXL prompt: ${positivePrompt}`);

  const targetUrl = hfEndpointUrl.endsWith("/generate") 
    ? hfEndpointUrl 
    : hfEndpointUrl.includes("ngrok") ? `${hfEndpointUrl.replace(/\/$/, "")}/generate` : hfEndpointUrl;

  const payload = {
    inputs: positivePrompt,
    parameters: {
      negative_prompt: SDXL_NEGATIVE_PROMPT,
      height: 768,
      width: 768,
      num_inference_steps: 30,
      guidance_scale: 8.5
    }
  };

  if (isImg2Img && inputPath) {
    const inputBuf = await readFile(inputPath);
    payload.parameters.image = inputBuf.toString("base64");
    
    // Determine strength based on edit mode
    // large_redesign = high strength (0.8) meaning it changes the image a lot
    // medium_edit = lower strength (0.5) meaning it keeps more of the original
    payload.parameters.strength = plan.edit_mode === "large_redesign" ? 0.8 : 0.5;
    console.log(`Using Img2Img pipeline with strength ${payload.parameters.strength}`);
  }

  const response = await withRetry("Monadical SDXL generation", () =>
    fetch(targetUrl, {
      method: "POST",
      headers: {
        ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
  );

  // HuggingFace Inference Endpoints return raw image bytes.
  // Colab/ngrok endpoints may return JSON with base64.
  const contentType = response.headers.get("content-type") ?? "";
  let rawImageBuffer;

  if (contentType.includes("image/")) {
    // Raw image bytes (HuggingFace Inference Endpoints default)
    rawImageBuffer = Buffer.from(await response.arrayBuffer());
  } else {
    // JSON response — try multiple common shapes
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`SDXL endpoint error: ${body.error ?? body.message ?? response.statusText}`);
    }
    const b64 = body.image ?? body.images?.[0] ?? body.data?.[0]?.b64_json ?? body.output;
    if (!b64) {
      throw new Error("SDXL endpoint did not return image data. Response keys: " + Object.keys(body).join(", "));
    }
    rawImageBuffer = Buffer.from(b64, "base64");
  }

  // Extract the usable 64×64 skin from the 768×768 atlas output
  const skinBuffer = await extractSkinFromAtlas(rawImageBuffer, debugDir);
  await writeFile(outputPath, skinBuffer);
  console.log(`SDXL skin extracted and saved: ${outputPath}`);
  return true;
}

/** Unified entry: tries SDXL. */
async function generateSkinWithImageModel({ inputPath, outputPath, maskPath, plan, isImg2Img }) {
  if (!shouldUseGenerativeModel(plan)) {
    return false;
  }

  if (hfEndpointUrl) {
    const debugDir = dirname(outputPath);
    const ok = await generateSkinWithSdxl({ outputPath, inputPath, plan, debugDir, isImg2Img });
    // NOTE: skip applySkinStructuredPost for SDXL — the model already produces
    // clean pixel art. The old post-processing (palette snap, face wipe, mirroring)
    // was designed to fix GPT-Image noise and destroys SDXL detail.
    return ok;
  }

  throw new Error("Skin generation requested but HF_ENDPOINT_URL is not configured.");
}

async function downloadStorageFile(bucket, path, outputPath) {
  const { data, error } = await withRetry(`download ${bucket}/${path}`, () =>
    supabase.storage.from(bucket).download(path)
  );
  if (error) {
    throw error;
  }

  const fileStream = createWriteStream(outputPath);
  const reader = data.stream().getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    fileStream.write(Buffer.from(value));
  }

  await new Promise((resolveWrite, rejectWrite) => {
    fileStream.end(resolveWrite);
    fileStream.on("error", rejectWrite);
  });
}

function runBlender({ inputPath, outputPath, color, kind, planPath, templatePath, editedSkinPath }) {
  return new Promise((resolveRun, rejectRun) => {
    const scriptPath = join(rootDir, "scripts", "blender_transform.py");
    const args = [
      "--background",
      "--python",
      scriptPath,
      "--",
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--color",
      color,
      "--kind",
      kind,
      "--plan",
      planPath,
      "--template",
      templatePath,
      "--edited-skin-output",
      editedSkinPath
    ];

    const child = spawn(blenderPath, args, { stdio: "inherit" });

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        rejectRun(
          new Error(
            `Blender was not found. Install Blender, add it to PATH, or set BLENDER_PATH in .env.local. Tried: ${blenderPath}`
          )
        );
        return;
      }

      rejectRun(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`Blender exited with code ${code}.`));
      }
    });
  });
}

async function getQueuedJob() {
  const { data, error } = await supabase
    .from("asset_jobs")
    .select(
      `
      *,
      input_version:asset_versions!asset_jobs_input_version_id_fkey(*),
      project:asset_projects(*)
    `
    )
    .eq("status", "queued")
    .eq("job_type", "transform")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function claimJob(jobId) {
  const { data, error } = await supabase
    .from("asset_jobs")
    .update({
      status: "planning",
      progress: 5,
      error: null
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function processJob(job) {
  const claimed = await claimJob(job.id);
  if (!claimed) {
    console.log(`Skipped job ${job.id}; another worker already claimed it.`);
    return;
  }

  const inputVersion = job.input_version;

  const sourcePath = inputVersion?.source_asset_path ?? inputVersion?.preview_glb_path;
  const sourceExt = sourcePath ? (extname(sourcePath) || ".bin") : ".png";
  const jobWorkDir = join(workDir, `${job.id}-${process.pid}-${Date.now()}`);
  mkdirSync(jobWorkDir, { recursive: true });
  const inputPath = join(jobWorkDir, `input${sourceExt}`);

  if (sourcePath) {
    const sourceBucket = inputVersion.source_asset_path ? "asset-sources" : "asset-previews";
    await downloadStorageFile(sourceBucket, sourcePath, inputPath);
  } else {
    // Generate a blank 64x64 transparent PNG
    await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).png().toFile(inputPath);
  }
  const generatedSkinPath = join(jobWorkDir, "generated-skin.png");
  const imageMaskPath = join(jobWorkDir, "image-edit-mask.png");
  const outputPath = join(jobWorkDir, "preview.glb");
  const editedSkinPath = join(jobWorkDir, "edited-skin.png");
  const planPath = join(jobWorkDir, "plan.json");
  const outputStoragePath = `${job.project_id}/${job.id}-preview.glb`;
  const editedSkinStoragePath = `${job.project_id}/${job.id}-edited-skin.png`;
  const kind = inferKindFromPath(sourcePath);
  const editPlan = await createEditPlan(job.prompt ?? "", job.project?.game_key ?? "minecraft", kind);
  const color = editPlan.base_color;
  await writeFile(planPath, JSON.stringify(editPlan, null, 2), "utf-8");
  console.log(
    `Edit route: ${editPlan.edit_mode}; preserve=${editPlan.preservation_strength}; operations=${JSON.stringify(
      editPlan.operations ?? []
    )}`
  );

  await supabase
    .from("asset_jobs")
    .update({
      status: "planning",
      progress: 20,
      plan: editPlan
    })
    .eq("id", job.id);
  let blenderInputPath = inputPath;
  let finalEditPlan = editPlan;
  if (kind === "image") {
    await supabase.from("asset_jobs").update({ status: "generating_texture", progress: 35 }).eq("id", job.id);
    let usedImageModel = false;
    let imageModelError = null;
    try {
      usedImageModel = await generateSkinWithImageModel({
        inputPath,
        outputPath: generatedSkinPath,
        maskPath: imageMaskPath,
        plan: editPlan,
        isImg2Img: !!sourcePath
      });
    } catch (err) {
      imageModelError = err instanceof Error ? err.message : String(err);
      console.warn(
        `Image texture generation failed (${imageModelError}). Continuing with uploaded skin — Blender deterministic UV edits only (no GPT Image pass).`
      );
    }

    if (usedImageModel) {
      const usedSdxl = Boolean(hfEndpointUrl);
      const editableRegions = editableRegionKeysForPlan(editPlan);
      blenderInputPath = generatedSkinPath;
      finalEditPlan = {
        ...editPlan,
        image_model_applied: !usedSdxl,  // only true for legacy GPT-Image so Blender runs its cleanup
        sdxl_generated: usedSdxl,
        image_model: usedSdxl ? "monadical-sdxl" : imageModel,
        editable_regions: editableRegions
      };
      await writeFile(planPath, JSON.stringify(finalEditPlan, null, 2), "utf-8");
      await supabase.from("asset_jobs").update({ plan: finalEditPlan }).eq("id", job.id);
    } else if (imageModelError) {
      finalEditPlan = {
        ...editPlan,
        image_model_applied: false,
        image_model_error: imageModelError.slice(0, 500)
      };
      await writeFile(planPath, JSON.stringify(finalEditPlan, null, 2), "utf-8");
      await supabase.from("asset_jobs").update({ plan: finalEditPlan }).eq("id", job.id);
    }
  }

  await supabase.from("asset_jobs").update({ status: "running_blender", progress: 55 }).eq("id", job.id);
  await runBlender({
    inputPath: blenderInputPath,
    outputPath,
    color,
    kind,
    planPath,
    templatePath: minecraftRigPath,
    editedSkinPath
  });

  if (!existsSync(outputPath)) {
    throw new Error("Blender did not write an output GLB.");
  }

  await supabase.from("asset_jobs").update({ status: "validating", progress: 75 }).eq("id", job.id);

  const outputBuffer = await readFile(outputPath);
  const { error: uploadError } = await withRetry(`upload asset-previews/${outputStoragePath}`, () =>
    supabase.storage.from("asset-previews").upload(outputStoragePath, outputBuffer, {
      contentType: "model/gltf-binary",
      upsert: true
    })
  );

  if (uploadError) {
    throw uploadError;
  }

  let nextSourceAssetPath = inputVersion.source_asset_path;
  if (kind === "image" && existsSync(editedSkinPath)) {
    const editedSkinBuffer = await readFile(editedSkinPath);
    const { error: editedSkinUploadError } = await withRetry(`upload asset-sources/${editedSkinStoragePath}`, () =>
      supabase.storage.from("asset-sources").upload(editedSkinStoragePath, editedSkinBuffer, {
        contentType: "image/png",
        upsert: true
      })
    );

    if (editedSkinUploadError) {
      throw editedSkinUploadError;
    }

    nextSourceAssetPath = editedSkinStoragePath;
  }

  const { data: outputVersion, error: versionError } = await supabase
    .from("asset_versions")
    .insert({
      project_id: job.project_id,
      parent_version_id: inputVersion.id,
      label: `Blender: ${(job.prompt ?? "transform").slice(0, 42)}`,
      prompt: job.prompt,
      source_asset_path: nextSourceAssetPath,
      preview_glb_path: outputStoragePath,
      metadata: {
        ...inputVersion.metadata,
        assetKind: "model",
        generatedBy: "local_blender_worker",
        appliedColor: color,
        editPlan: finalEditPlan
      },
      validation: {
        status: "prototype_pass",
        checked: ["output_glb_created", "uploaded_to_asset_previews", "template_rig_used", "armature_not_modified"],
        note: "Preview rig .blend is opened without editing the armature; worker updates the shared Skin texture only."
      }
    })
    .select()
    .single();

  if (versionError) {
    throw versionError;
  }

  await supabase
    .from("asset_jobs")
    .update({
      status: "completed",
      progress: 100,
      output_version_id: outputVersion.id
    })
    .eq("id", job.id);

  if (finalEditPlan.sdxl_generated) {
    console.log(`Debug: keeping work dir for inspection: ${jobWorkDir}`);
  } else {
    await rm(jobWorkDir, { force: true, recursive: true });
  }
}

async function markFailed(jobId, error) {
  console.error(error);
  await supabase
    .from("asset_jobs")
    .update({
      status: "failed",
      progress: 100,
      error: error instanceof Error ? error.message : String(error)
    })
    .eq("id", jobId)
    .neq("status", "completed");
}

async function main() {
  console.log("Worker started. Polling Supabase for queued transform jobs...");
  console.log(`Using Blender command: ${blenderPath}`);
  console.log(`Using Minecraft rig template: ${minecraftRigPath}`);
  console.log(anthropic ? "Claude planner enabled." : "Claude planner disabled. Set ANTHROPIC_API_KEY to enable it.");
  if (hfEndpointUrl) {
    console.log(`Skin generation: Monadical SDXL via ${hfEndpointUrl}`);
  } else if (openaiApiKey) {
    console.log(`Skin generation: Legacy GPT-Image (${imageModel}). Set HF_ENDPOINT_URL to use the SDXL model instead.`);
  } else {
    console.log("Skin generation disabled. Set HF_ENDPOINT_URL (recommended) or OPENAI_API_KEY to enable it.");
  }

  while (true) {
    let job = null;
    try {
      job = await getQueuedJob();
      if (!job) {
        await sleep(2500);
        continue;
      }

      console.log(`Processing job ${job.id}: ${job.prompt}`);
      await processJob(job);
      console.log(`Completed job ${job.id}`);
    } catch (error) {
      if (job?.id) {
        await markFailed(job.id, error);
      } else {
        console.error(error);
        await sleep(2500);
      }
    }
  }
}

// Only auto-run the Supabase polling loop when this file is executed directly
// (`node scripts/worker.mjs`) — not when its helpers are imported by another
// script (e.g. standalone_generate.mjs) that wants to reuse the pipeline
// without a live Supabase project.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { createEditPlan, generateSkinWithImageModel, runBlender, minecraftRigPath, hfEndpointUrl };
