import { generate3DTransformScript } from "./agentic_3d_engine.mjs";
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const rootDir = resolve(process.cwd());
const blenderPath = "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe";
const inputGlb = join(rootDir, "public", "models", "lol", "aatrox.glb");
const outputGlb = join(rootDir, "public", "models", "lol", "aatrox_test_output.glb");

async function testPipeline() {
  console.log("=== TESTING AGENTIC 3D PIPELINE ===");
  console.log(`Input GLB: ${inputGlb}`);
  console.log(`Blender: ${blenderPath}`);

  const testPrompt = "Add glowing infernal magma horns to Aatrox's head and attach serrated spikes to his sword.";
  console.log(`Test Prompt: "${testPrompt}"`);

  const { code, summary } = await generate3DTransformScript(testPrompt);
  console.log(`\nGenerated Summary: ${summary}`);
  console.log(`\nGenerated Code snippet:\n${code.slice(0, 400)}...\n`);

  const scriptContent = `
import bpy
import sys

print("Loading test scene...")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"${inputGlb.replace(/\\/g, "\\\\")}")

try:
${code.split("\n").map(l => "    " + l).join("\n")}
    print("=== DYNAMIC CODE SUCCEEDED ===")
except Exception as e:
    import traceback
    traceback.print_exc()
    sys.exit(1)

bpy.ops.export_scene.gltf(
    filepath=r"${outputGlb.replace(/\\/g, "\\\\")}",
    export_format='GLB',
    export_skins=True,
    export_animations=True
)
print("GLB export succeeded!")
`;

  const workDir = join(rootDir, ".worker", "lol");
  await mkdir(workDir, { recursive: true });

  const scriptPath = join(workDir, "test_script.py");
  await writeFile(scriptPath, scriptContent);

  console.log(`Running Blender on ${scriptPath}...`);
  const proc = spawn(blenderPath, ["--background", "--python", scriptPath]);

  proc.stdout.on("data", (data) => console.log(`[Blender STDOUT] ${data.toString().trim()}`));
  proc.stderr.on("data", (data) => console.error(`[Blender STDERR] ${data.toString().trim()}`));

  proc.on("close", (code) => {
    console.log(`Blender exited with code: ${code}`);
    if (code === 0 && existsSync(outputGlb)) {
      console.log(`✅ SUCCESS! Exported output GLB at: ${outputGlb}`);
    } else {
      console.error("❌ FAILED!");
    }
  });
}

testPipeline().catch(console.error);
