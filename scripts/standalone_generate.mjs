// Generates one Minecraft skin GLB directly (Claude planner -> Colab SDXL -> Blender rig bake)
// without touching Supabase at all. Useful when the Supabase free-tier project is paused
// and you just need a model to look at / screenshot.
//
// Usage: node scripts/standalone_generate.mjs "a futuristic neon looking skin"

import { createEditPlan, generateSkinWithImageModel, runBlender, minecraftRigPath, hfEndpointUrl } from "./worker.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const prompt = process.argv.slice(2).join(" ").trim() || "a futuristic neon looking skin";
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const outDir = join(rootDir, ".worker", "standalone");

async function main() {
  if (!hfEndpointUrl) {
    throw new Error("HF_ENDPOINT_URL is not set in .env.local — point it at your Colab ngrok /generate URL first.");
  }
  if (!existsSync(minecraftRigPath)) {
    throw new Error(`Minecraft rig .blend not found at: ${minecraftRigPath}`);
  }

  await mkdir(outDir, { recursive: true });

  const inputPath = join(outDir, "input.png");
  await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).png().toFile(inputPath);

  console.log(`Prompt: ${prompt}`);
  const plan = await createEditPlan(prompt, "minecraft", "image");
  console.log("Plan:", JSON.stringify(plan, null, 2));

  const generatedSkinPath = join(outDir, "generated-skin.png");
  const editedSkinPath = join(outDir, "edited-skin.png");
  const planPath = join(outDir, "plan.json");
  const outputPath = join(outDir, "preview.glb");
  await writeFile(planPath, JSON.stringify(plan, null, 2), "utf-8");

  console.log(`Requesting skin texture from Colab SDXL endpoint: ${hfEndpointUrl}`);
  const usedImageModel = await generateSkinWithImageModel({
    inputPath,
    outputPath: generatedSkinPath,
    plan,
    isImg2Img: false
  });
  console.log("Used SDXL image model:", usedImageModel);

  const blenderInputPath = usedImageModel ? generatedSkinPath : inputPath;

  console.log("Running Blender to bake texture onto rig and export GLB...");
  await runBlender({
    inputPath: blenderInputPath,
    outputPath,
    color: plan.base_color,
    kind: "image",
    planPath,
    templatePath: minecraftRigPath,
    editedSkinPath
  });

  if (!existsSync(outputPath)) {
    throw new Error("Blender did not produce an output GLB.");
  }

  console.log("\nDone.");
  console.log(`GLB: ${outputPath}`);
  console.log(`Generated skin PNG: ${generatedSkinPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
