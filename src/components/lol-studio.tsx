"use client";

import { useState, Suspense, useEffect, useRef, useMemo, FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Loader2,
  RotateCcw,
  Send,
  Shield,
  Sparkles,
  Swords,
  Box,
  History,
  Code2,
  Check,
  Copy,
  X,
  Play,
  Zap,
  FileCode,
  Layers,
  ChevronRight,
} from "lucide-react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Champion registry                                                  */
/* ------------------------------------------------------------------ */

type Champion = {
  id: string;
  name: string;
  title: string;
  modelPath: string;
  splashColor: string;
};

const champions: Champion[] = [
  {
    id: "aatrox",
    name: "Aatrox",
    title: "The Darkin Blade",
    modelPath: "/models/lol/aatrox.glb",
    splashColor: "#d44d3f",
  },
];

/* ------------------------------------------------------------------ */
/*  History Item type                                                  */
/* ------------------------------------------------------------------ */

type HistoryItem = {
  id: string;
  filename: string;
  title: string;
  summary: string;
  timestamp: number;
  dateFormatted: string;
  dynamicCode: string;
  fullCode: string;
  lineCount: number;
  isCached?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Auto-scaling 3D model helper                                       */
/* ------------------------------------------------------------------ */

type ModelMeta = {
  center: THREE.Vector3;
  size: THREE.Vector3;
  maxDim: number;
};

function ChampionModel({ url, onLoaded }: { url: string; onLoaded: (meta: ModelMeta) => void }) {
  const gltf = useGLTF(url);
  const { camera } = useThree();

  const scene = useMemo(() => {
    return gltf.scene.clone(true);
  }, [gltf]);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);

    onLoaded({ center, size, maxDim });

    // Dynamically position camera to fit the model dimensions perfectly
    const distance = maxDim > 0.001 ? maxDim * 1.6 : 5;
    camera.position.set(center.x + distance * 0.7, center.y + distance * 0.4, center.z + distance * 0.9);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }, [scene, camera, onLoaded, url]);

  return <primitive object={scene} />;
}

function ViewerCanvas({ modelPath }: { modelPath: string }) {
  const [meta, setMeta] = useState<ModelMeta | null>(null);

  const gridArgs = useMemo(() => {
    if (!meta) return [8, 8, "#babfcf", "#dadee8"] as const;
    const size = Math.ceil(meta.maxDim * 3);
    return [size, 20, "#babfcf", "#dadee8"] as const;
  }, [meta]);

  return (
    <div className="h-full min-h-[480px] overflow-hidden rounded-2xl border border-[#c9cdd9] bg-[#eef0f6]">
      <Canvas camera={{ fov: 45, near: 0.1, far: 50000 }}>
        <color attach="background" args={["#eef0f6"]} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[500, 800, 400]} intensity={2.5} />
        <directionalLight position={[-500, 400, -400]} intensity={0.8} color="#3809a3" />
        <directionalLight position={[0, -500, 200]} intensity={0.5} color="#e21e49" />
        <Suspense fallback={null}>
          <ChampionModel url={modelPath} onLoaded={setMeta} />
        </Suspense>
        {meta && (
          <>
            <gridHelper args={gridArgs} position={[0, meta.center.y - meta.size.y / 2, 0]} />
            <OrbitControls
              makeDefault
              enableDamping
              minDistance={meta.maxDim * 0.1}
              maxDistance={meta.maxDim * 8}
              target={[meta.center.x, meta.center.y, meta.center.z]}
            />
          </>
        )}
      </Canvas>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat message type                                                  */
/* ------------------------------------------------------------------ */

type ChatMessage = {
  role: "user" | "system";
  content: string;
  codeSnippet?: string;
};

const MAX_CHAT_MESSAGE_CHARS = 2000;
function capMessage(text: string): string {
  if (text.length <= MAX_CHAT_MESSAGE_CHARS) return text;
  return text.slice(0, MAX_CHAT_MESSAGE_CHARS) + `... [truncated, ${text.length - MAX_CHAT_MESSAGE_CHARS} more chars]`;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function LolStudio() {
  const router = useRouter();
  const [activeChampion, setActiveChampion] = useState<Champion>(champions[0]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelVersion, setModelVersion] = useState(0);
  const [resetting, setResetting] = useState(false);

  // History & saved versions state
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [applyingHistoryId, setApplyingHistoryId] = useState<string | null>(null);
  const [inspectingItem, setInspectingItem] = useState<HistoryItem | null>(null);
  const [copied, setCopied] = useState(false);

  const [chat, setChat] = useState<ChatMessage[]>([
    {
      role: "system",
      content:
        "Welcome to the Agentic 3D Studio! Aatrox is loaded with full 3D geometry generation, skeleton bone parenting, and procedural PBR shading enabled.",
    },
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* Preload the active model */
  useEffect(() => {
    useGLTF.preload(activeChampion.modelPath);
  }, [activeChampion]);

  /* Auto-scroll chat */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  /* Fetch history */
  const fetchHistory = async () => {
    try {
      setLoadingHistory(true);
      const res = await fetch("/api/lol/history");
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch (err) {
      console.warn("Could not load history:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const versionedModelPath = `${activeChampion.modelPath}?v=${modelVersion}`;

  const resetModel = async () => {
    if (busy || resetting) return;
    setResetting(true);
    setBusy(true);

    setChat((prev) => [...prev, { role: "user", content: "Resetting Aatrox to baseline pristine model..." }]);

    try {
      const res = await fetch("/api/lol/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          championId: activeChampion.id,
          action: "reset",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");

      setChat((prev) => [
        ...prev,
        { role: "system", content: "Champion has been reset to baseline pristine 3D model!" },
      ]);

      useGLTF.clear(versionedModelPath);
      setModelVersion((v) => v + 1);
    } catch (err) {
      setChat((prev) => [
        ...prev,
        { role: "system", content: `${err instanceof Error ? err.message : "Reset failed"}` },
      ]);
    } finally {
      setResetting(false);
      setBusy(false);
    }
  };

  const handleApplyHistory = async (item: HistoryItem) => {
    if (busy || applyingHistoryId) return;

    setApplyingHistoryId(item.id);
    setBusy(true);

    setChat((prev) => [
      ...prev,
      { role: "user", content: `Load saved transformation: "${item.title}"` },
    ]);

    try {
      const res = await fetch("/api/lol/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: item.filename,
          championId: activeChampion.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply transformation");

      setChat((prev) => [
        ...prev,
        {
          role: "system",
          content: capMessage(`Loaded saved transformation "${item.title}"! Applied directly via Blender.`),
          codeSnippet: item.dynamicCode.slice(0, 300),
        },
      ]);

      useGLTF.clear(versionedModelPath);
      setModelVersion((v) => v + 1);
    } catch (err) {
      setChat((prev) => [
        ...prev,
        {
          role: "system",
          content: capMessage(`Failed to load transformation: ${err instanceof Error ? err.message : "Error"}`),
        },
      ]);
    } finally {
      setApplyingHistoryId(null);
      setBusy(false);
    }
  };

  const handleSendPrompt = async (textToSend: string) => {
    if (!textToSend.trim() || busy) return;

    setPrompt("");
    setBusy(true);

    setChat((prev) => [...prev, { role: "user", content: textToSend }]);

    try {
      const res = await fetch("/api/lol/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          championId: activeChampion.id,
          prompt: textToSend,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Edit failed");
      }

      const costInfo = data.costPence ? ` (Est. cost: ${data.costPence})` : "";

      setChat((prev) => [
        ...prev,
        {
          role: "system",
          content: capMessage(`${data.message || `Applied 3D transformation to ${activeChampion.name}!`}${costInfo}`),
          codeSnippet: data.codeSnippet,
        },
      ]);

      if (data.updated) {
        useGLTF.clear(versionedModelPath);
        setModelVersion((v) => v + 1);
        // Refresh history list so the new generation shows up immediately
        fetchHistory();
      }
    } catch (err) {
      setChat((prev) => [
        ...prev,
        {
          role: "system",
          content: capMessage(`Failed: ${err instanceof Error ? err.message : "An error occurred"}`),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSendPrompt(prompt);
  };

  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const quickPresets = [
    { label: "Futuristic Cyber Blade & Mecha", prompt: "Transform Aatrox into a futuristic cyber warrior: replace his sword with a glowing cyan plasma blade, equip cyber titanium armor, and add a holographic neon visor." },
    { label: "Infernal Magma Greatsword", prompt: "Add glowing infernal serrated magma spikes and a fiery power core to Aatrox's sword." },
    { label: "Demon Obsidian Wings", prompt: "Add massive demonic obsidian crystal wings to Aatrox's back attached to the wing bones." },
    { label: "Golden Horns & Crown", prompt: "Sculpt large glowing gold demonic horns onto Aatrox's head." },
    { label: "Spiked Pauldron Armor", prompt: "Equip heavy spiked shoulder pauldrons with glowing runes on Aatrox's shoulders." },
    { label: "Astral Void Halo", prompt: "Surround Aatrox's head with a floating glowing astral energy halo." },
  ];

  return (
    <main className="grid min-h-screen grid-cols-[330px_1fr_420px] bg-[#eef0f6] text-[#05060a]">
      {/* ─── Left sidebar: Champion & Saved Variations ─── */}
      <aside className="flex flex-col border-r border-[#c9cdd9] bg-[#eaecf2] max-h-screen">
        <div className="flex items-center gap-3 border-b border-[#c9cdd9] p-4">
          <button
            onClick={() => router.push("/")}
            className="rounded-lg p-1.5 text-[#4b5364] transition hover:bg-[#d4d8e4] hover:text-[#05060a]"
            title="Back to Studio Home"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Swords size={20} className="text-amber-400" />
            <span className="font-semibold text-amber-300">LoL 3D Studio</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Active Champion */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#777e90]">
              Active Champion
            </div>
            <div className="mt-2">
              {champions.map((champ) => (
                <button
                  key={champ.id}
                  onClick={() => setActiveChampion(champ)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    activeChampion.id === champ.id
                      ? "border-amber-400 bg-amber-50 text-[#1a1c23]"
                      : "border-[#c9cdd9] bg-[#e5e7ee] text-[#292e3d] hover:border-[#aab0c5]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-lg"
                      style={{ backgroundColor: champ.splashColor + "30" }}
                    >
                      <Shield size={18} style={{ color: champ.splashColor }} />
                    </div>
                    <div>
                      <div className="font-semibold">{champ.name}</div>
                      <div className="text-xs text-[#4b5364]">{champ.title}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Saved History & Old Prompts */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
                <History size={14} /> Saved Variations ({history.length})
              </div>
              <button
                onClick={fetchHistory}
                disabled={loadingHistory}
                className="text-xs text-[#777e90] hover:text-amber-400 transition"
                title="Refresh history"
              >
                <RotateCcw size={12} className={loadingHistory ? "animate-spin" : ""} />
              </button>
            </div>

            <p className="mt-1 text-[11px] text-[#636b7d] leading-relaxed">
              Past generated 3D transformations saved on disk. Click to preview or apply to viewport.
            </p>

            {loadingHistory && history.length === 0 ? (
              <div className="mt-3 flex items-center justify-center gap-2 py-6 text-xs text-[#777e90]">
                <Loader2 size={14} className="animate-spin" /> Loading saved scripts...
              </div>
            ) : history.length === 0 ? (
              <div className="mt-3 rounded-xl border border-[#c9cdd9] bg-[#e5e7ee] p-3 text-center text-xs text-[#777e90]">
                No saved versions found yet.
              </div>
            ) : (
              <div className="mt-3 space-y-2.5">
                {history.map((item) => {
                  const isApplying = applyingHistoryId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="group rounded-xl border border-[#c9cdd9] bg-[#e5e7ee] p-3 transition hover:border-amber-500/50 hover:bg-[#dde0ea]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-xs text-[#0e111d] leading-snug line-clamp-2">
                          {item.title}
                        </div>
                        <span className="shrink-0 rounded bg-[#cfd3e1] px-1.5 py-0.5 text-[10px] text-[#545d71]">
                          {item.dateFormatted}
                        </span>
                      </div>

                      <div className="mt-1.5 text-[11px] text-[#646d82] line-clamp-2 leading-relaxed">
                        {item.summary}
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t border-[#d2d6e2] pt-2.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setInspectingItem(item)}
                            className="flex items-center gap-1 text-[11px] text-[#4b5364] hover:text-amber-400 transition"
                            title="View Blender Python script"
                          >
                            <Code2 size={12} />
                            <span>Code</span>
                          </button>

                          <button
                            onClick={() => setPrompt(item.summary || item.title)}
                            className="text-[11px] text-[#777e90] hover:text-white transition"
                            title="Copy prompt text to chat input"
                          >
                            Copy Prompt
                          </button>
                        </div>

                        <button
                          onClick={() => handleApplyHistory(item)}
                          disabled={busy}
                          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40 ${
                            item.isCached
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500 hover:text-black"
                              : "bg-amber-500 text-black hover:bg-amber-400 shadow-sm"
                          }`}
                          title={item.isCached ? "Instant cached load" : "Run in Blender (~45s)"}
                        >
                          {isApplying ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              <span>Building...</span>
                            </>
                          ) : item.isCached ? (
                            <>
                              <Zap size={12} className="fill-current" />
                              <span>View 3D (Instant)</span>
                            </>
                          ) : (
                            <>
                              <Play size={11} className="fill-current" />
                              <span>Load 3D Model</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3D Capabilities */}
          <div className="rounded-xl border border-[#c9cdd9] bg-[#e5e7ee] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
              <Box size={14} /> 3D Engine Capabilities
            </div>
            <ul className="mt-2 space-y-1.5 text-xs text-[#4b5364]">
              <li>Procedural 3D Mesh Generation</li>
              <li>Skeleton Bone Parenting</li>
              <li>PBR Metallic & Emission Shaders</li>
              <li>Closed-Loop Error Recovery</li>
            </ul>
          </div>
        </div>
      </aside>

      {/* ─── Center: 3D viewport ─── */}
      <section className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between border-b border-[#c9cdd9] px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-[#4b5364]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: activeChampion.splashColor }}
              />
              Champion 3D Viewport
            </div>
            <h2 className="text-xl font-semibold">
              {activeChampion.name}{" "}
              <span className="text-base font-normal text-[#777e90]">
                — {activeChampion.title}
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetModel}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-red-800/80 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Reset to Base
            </button>
            <button
              onClick={() => setModelVersion((v) => v + 1)}
              className="inline-flex items-center gap-2 rounded-lg border border-[#babfcf] px-3 py-2 text-sm text-[#0c0f28] transition hover:border-[#99a1b7]"
            >
              <RotateCcw size={14} />
              Refresh
            </button>
            <a
              href={activeChampion.modelPath}
              download
              className="inline-flex items-center gap-2 rounded-lg border border-[#babfcf] px-3 py-2 text-sm text-[#0c0f28] transition hover:border-[#99a1b7]"
            >
              <Download size={16} />
              Export GLB
            </a>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 p-5">
          <ViewerCanvas
            key={`${activeChampion.id}-${modelVersion}`}
            modelPath={versionedModelPath}
          />

          {applyingHistoryId && (
            <div className="absolute inset-5 z-20 flex flex-col items-center justify-center rounded-2xl bg-black/80 backdrop-blur-md p-6 text-center">
              <div className="relative flex items-center justify-center mb-4">
                <div className="absolute h-16 w-16 rounded-full border-2 border-amber-500/30 animate-ping" />
                <Loader2 size={40} className="animate-spin text-amber-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Generating 3D Model in Blender</h3>
              <p className="mt-2 text-xs text-[#4b5364] max-w-md leading-relaxed">
                Executing the saved Python script in Blender. The model’s mesh is being modified, materials assigned, and exported to GLB. This takes ~30–45s.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ─── Right sidebar: AI chat & Presets ─── */}
      <aside className="flex min-h-0 flex-col border-l border-[#c9cdd9] bg-[#eaecf2]">
        <div className="border-b border-[#c9cdd9] p-4">
          <div className="flex items-center gap-2 font-semibold text-amber-400">
            <Sparkles size={18} />
            Agentic 3D Studio
          </div>
          <p className="mt-1 text-xs text-[#4b5364]">
            Describe any 3D geometry, accessories, armor, wings, or material changes.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {chat.map((msg, i) => (
            <div
              key={`${msg.role}-${i}`}
              className={`rounded-2xl border p-3 text-sm leading-6 ${
                msg.role === "user"
                  ? "ml-6 border-amber-500/50 bg-amber-900/20"
                  : "mr-4 border-[#c9cdd9] bg-[#e5e7ee] text-[#0c0f28]"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              {msg.codeSnippet && (
                <div className="mt-2 rounded-lg bg-[#f0f2f7] p-2 font-mono text-xs text-amber-300/80">
                  <span className="text-[#777e90]">bpy preview:</span> {msg.codeSnippet}...
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Quick Presets */}
        <div className="border-t border-[#c9cdd9] bg-[#ebedf3] px-4 py-2">
          <div className="mb-2 text-xs font-semibold text-[#777e90]">Quick 3D Actions:</div>
          <div className="flex flex-wrap gap-1.5">
            {quickPresets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handleSendPrompt(preset.prompt)}
                disabled={busy}
                className="rounded-lg border border-[#bdc3d5] bg-[#dbdfeb] px-2.5 py-1 text-xs text-[#0c0f28] transition hover:border-amber-500 hover:text-amber-900 hover:bg-amber-50 disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <form
          onSubmit={submitPrompt}
          className="space-y-3 border-t border-[#c9cdd9] p-4"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            placeholder={`e.g. Add glowing dragon horns to head, infernal wings on back, and serrated edges to his sword...`}
            className="min-h-24 w-full resize-none rounded-xl border border-[#babfcf] bg-[#dbdfea] p-3 text-sm outline-none focus:border-amber-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!prompt.trim() || busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-[#babfcf] disabled:text-[#676f80]"
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Executing Blender 3D Engine...
              </>
            ) : (
              <>
                <Send size={16} />
                Generate & Apply 3D Change
              </>
            )}
          </button>
        </form>
      </aside>

      {/* ─── Script Inspection Modal ─── */}
      {inspectingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-[#babfcf] bg-[#eaecf3] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#c9cdd9] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <FileCode size={18} className="text-amber-400" />
                <div>
                  <h3 className="font-semibold text-sm text-[#05060a]">{inspectingItem.title}</h3>
                  <p className="text-xs text-[#697387] font-mono">{inspectingItem.filename} • {inspectingItem.dateFormatted}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopyCode(inspectingItem.dynamicCode || inspectingItem.fullCode)}
                  className="flex items-center gap-1.5 rounded-lg border border-[#babfcf] bg-[#dadee9] px-3 py-1.5 text-xs text-[#0c0f28] transition hover:border-amber-500 hover:text-amber-900 hover:bg-amber-50"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  <span>{copied ? "Copied" : "Copy Code"}</span>
                </button>
                <button
                  onClick={() => setInspectingItem(null)}
                  className="rounded-lg p-1.5 text-[#545d71] hover:bg-[#d2d6e3] hover:text-[#1a1c23] transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="text-xs text-[#4b5364] mb-2 font-semibold uppercase tracking-wider">
                Dynamic Blender (bpy) Python Code:
              </div>
              <pre className="rounded-xl border border-[#cbd0df] bg-[#f4f5f9] p-4 font-mono text-xs text-amber-900 leading-relaxed overflow-x-auto whitespace-pre">
                {inspectingItem.dynamicCode || inspectingItem.fullCode}
              </pre>
            </div>

            <div className="flex items-center justify-between border-t border-[#c9cdd9] px-5 py-3.5 bg-[#eff1f6]">
              <span className="text-xs text-[#747d91]">
                Executed directly inside Blender headless subprocess.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPrompt(inspectingItem.summary || inspectingItem.title);
                    setInspectingItem(null);
                  }}
                  className="rounded-lg border border-[#babfcf] px-3 py-1.5 text-xs text-[#0c0f28] hover:border-amber-500 hover:text-amber-900 hover:bg-amber-50 transition"
                >
                  Use This Prompt
                </button>
                <button
                  onClick={() => {
                    handleApplyHistory(inspectingItem);
                    setInspectingItem(null);
                  }}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition disabled:opacity-50"
                >
                  <Play size={12} className="fill-current" />
                  Apply to 3D Viewport
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
