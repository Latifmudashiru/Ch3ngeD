import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { generate3DTransformScript } from "@/lib/agentic-3d-engine";

const rootDir = resolve(process.cwd());
const modelsDir = join(rootDir, "public", "models", "lol");
const workDir = join(rootDir, ".worker", "lol");

function resolveBlenderPath(): string {
  if (process.env.BLENDER_PATH && existsSync(process.env.BLENDER_PATH)) {
    return process.env.BLENDER_PATH;
  }
  const defaultWin51 = "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe";
  if (existsSync(defaultWin51)) {
    return defaultWin51;
  }
  const defaultWin43 = "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe";
  if (existsSync(defaultWin43)) {
    return defaultWin43;
  }
  return process.env.BLENDER_PATH ?? "blender";
}

const blenderPath = resolveBlenderPath();

// Guards against two overlapping requests for the same champion racing to import/export
// the same GLB file at once — this previously caused Blender to hang until killed, wasting
// paid API calls on runs that could never finish.
const activeChampionEdits = new Set<string>();

/**
 * Builds the complete wrapper script that imports the GLB, runs the AI transformation,
 * and exports the updated GLB preserving skins and animation hierarchies.
 */
function buildCompleteBlenderScript(inputGlb: string, outputGlb: string, dynamicCode: string): string {
  const inputGlbEscaped = inputGlb.replace(/\\/g, "\\\\");
  const outputGlbEscaped = outputGlb.replace(/\\/g, "\\\\");

  return `
import bpy
import sys
import math

print("=== AGENTIC 3D EXECUTION START ===")

# Clear default scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import original model
print("Importing GLB from: r'${inputGlbEscaped}'")
bpy.ops.import_scene.gltf(filepath=r"${inputGlbEscaped}")

# Execute Agentic 3D Transformation Code
try:
${dynamicCode.split("\n").map((line) => "    " + line).join("\n")}
    print("=== DYNAMIC 3D OPERATIONS COMPLETED SUCCESSFULLY ===")
except Exception as e:
    import traceback
    print("=== SCRIPT ERROR OCCURRED ===", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)

# Export modified GLB
print("Exporting modified GLB to: r'${outputGlbEscaped}'")
bpy.ops.export_scene.gltf(
    filepath=r"${outputGlbEscaped}",
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_draco_mesh_compression_enable=False,
    export_image_format='AUTO',
)

print("=== AGENTIC 3D EXECUTION COMPLETED ===")
`;
}

// Keep only the tail of Blender's output in error messages — this model's exporter can log
// verbosely for minutes, and the full dump was previously shoved unfiltered into the API
// response and rendered as one giant text blob, which froze the browser tab.
function truncateLog(text: string, maxChars: number = 1500): string {
  if (text.length <= maxChars) return text;
  return `...[truncated, showing last ${maxChars} chars]...\n` + text.slice(-maxChars);
}

function runBlender(scriptPath: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // 15 minutes: this model's textures make even a trivial script take ~5 minutes for
    // import+export alone, and the API cost is already incurred by the time Blender starts,
    // so a generous ceiling here only costs wall-clock time, not money. Only one attempt
    // runs now (no retry), so this doesn't compound into a long multi-attempt wait.
    const proc = spawn(blenderPath, [
      "--background",
      "--python", scriptPath,
    ], { timeout: 900_000 });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Blender exited with code ${code}\nSTDERR:\n${truncateLog(stderr)}\nSTDOUT:\n${truncateLog(stdout)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Could not start Blender: ${err.message}. Path: ${blenderPath}`));
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const { championId, prompt, action } = await req.json();

    if (!championId) {
      return NextResponse.json({ error: "Missing championId" }, { status: 400 });
    }

    if (activeChampionEdits.has(championId)) {
      return NextResponse.json(
        { error: `A generation is already in progress for ${championId}. Wait for it to finish before submitting again — sending a second request while one is running is what caused Blender to hang and wasted API spend last time.` },
        { status: 409 }
      );
    }
    activeChampionEdits.add(championId);

    try {
    const inputGlb = join(modelsDir, `${championId}.glb`);

    // Handle Reset action
    if (action === "reset") {
      const backupCandidates = [
        join(rootDir, "..", `${championId}.glb`),
        join(rootDir, `${championId}.glb`),
        join(modelsDir, `${championId}_backup.glb`),
      ];

      let backupGlb = backupCandidates.find((p) => existsSync(p));
      if (!backupGlb) {
        return NextResponse.json({ error: `Backup not found for ${championId}` }, { status: 404 });
      }

      await writeFile(inputGlb, await readFile(backupGlb));

      return NextResponse.json({
        message: `Successfully reset ${championId} to pristine baseline model.`,
        updated: true,
      });
    }

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    if (!existsSync(inputGlb)) {
      return NextResponse.json({ error: `Model not found: ${championId}.glb` }, { status: 404 });
    }

    await mkdir(workDir, { recursive: true });

    let attempts = 0;
    // Single attempt only: each attempt does a full Blender import+export cycle on a GLB
    // that can take minutes, so retrying doubles wall-clock time and risk of hitting the
    // spawn timeout without meaningfully improving odds of success.
    const maxAttempts = 1;
    let lastError: Error | null = null;
    let currentErrorTraceback: string | null = null;
    let currentScriptCode: string | null = null;
    let finalSummary = "";
    let cumulativeCostUsd = 0;

    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        console.log(`[Agentic3D] Generating 3D transformation (attempt ${attempts}/${maxAttempts})... cumulative spend so far: $${cumulativeCostUsd.toFixed(4)}`);
        const { code, summary, estimatedCostUsd } = await generate3DTransformScript(prompt, currentErrorTraceback, currentScriptCode, cumulativeCostUsd);
        currentScriptCode = code;
        finalSummary = summary;
        cumulativeCostUsd += estimatedCostUsd ?? 0;

        const timestamp = Date.now();
        const scriptPath = join(workDir, `agentic-${championId}-${timestamp}.py`);
        const fullScript = buildCompleteBlenderScript(inputGlb, inputGlb, code);

        await writeFile(scriptPath, fullScript, "utf-8");

        console.log(`[Agentic3D] Executing Blender 3D script: ${scriptPath}`);
        const { stdout } = await runBlender(scriptPath);
        console.log("[Agentic3D] Blender execution success:", stdout.slice(-300));

        const costPence = (cumulativeCostUsd * 78).toFixed(1);

        return NextResponse.json({
          message: `${finalSummary}`,
          codeSnippet: code.slice(0, 300),
          updated: true,
          attempts,
          estimatedCostUsd: cumulativeCostUsd,
          costPence: `${costPence}p`,
        });
      } catch (err: any) {
        lastError = err;
        currentErrorTraceback = err?.message || String(err);
        console.warn(`[Agentic3D] Attempt ${attempts} failed:`, (currentErrorTraceback ?? "").slice(0, 400));
      }
    }

    return NextResponse.json(
      {
        error: `3D Generation failed after ${maxAttempts} attempts: ${lastError?.message}`,
        costPence: `${(cumulativeCostUsd * 78).toFixed(1)}p`,
      },
      { status: 500 }
    );
    } finally {
      activeChampionEdits.delete(championId);
    }
  } catch (err: any) {
    console.error("LoL 3D Agent error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
