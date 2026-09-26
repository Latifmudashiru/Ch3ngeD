"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Box, Download, ImagePlus, Loader2, Send, Sparkles, Upload } from "lucide-react";
import { ModelViewer } from "@/components/model-viewer";
import { storagePublicUrl, supabase } from "@/lib/supabase";
import type { AssetJob, AssetProject, AssetVersion } from "@/lib/types";

type AssetKind = "image" | "model";

type ChatMessage = {
  role: "user" | "system";
  content: string;
};

const gameOptions = [
  { value: "minecraft", label: "Minecraft" },
  { value: "generic_rigged", label: "Generic rigged model" }
];

const isModelFile = (file: File) =>
  file.name.toLowerCase().endsWith(".glb") || file.name.toLowerCase().endsWith(".gltf");

const makeStoragePath = (file: File) => {
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  return `${crypto.randomUUID()}-${safeName}`;
};

export function StudioShell() {
  const [projects, setProjects] = useState<AssetProject[]>([]);
  const [versions, setVersions] = useState<AssetVersion[]>([]);
  const [jobs, setJobs] = useState<AssetJob[]>([]);
  const [activeProject, setActiveProject] = useState<AssetProject | null>(null);
  const [activeVersion, setActiveVersion] = useState<AssetVersion | null>(null);
  const [assetKind, setAssetKind] = useState<AssetKind | null>(null);
  const [gameKey, setGameKey] = useState("minecraft");
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("My first character");
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      role: "system",
      content:
        "Upload a character asset, then prompt changes. This prototype records jobs in Supabase and shows where the Blender worker will plug in."
    }
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeAssetUrl = useMemo(() => {
    if (!activeVersion) {
      return null;
    }

    const previewUrl = storagePublicUrl("asset-previews", activeVersion.preview_glb_path);
    const sourceUrl = storagePublicUrl("asset-sources", activeVersion.source_asset_path);
    return previewUrl ?? sourceUrl;
  }, [activeVersion, assetKind]);

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    if (!activeProject) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshActiveProject(activeProject.id);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [activeProject?.id]);

  const loadWorkspace = async () => {
    const { data: projectRows, error: projectError } = await supabase
      .from("asset_projects")
      .select("*")
      .order("created_at", { ascending: false });

    if (projectError) {
      setError(projectError.message);
      return;
    }

    setProjects(projectRows ?? []);

    if (projectRows?.[0]) {
      await selectProject(projectRows[0]);
    }
  };

  const selectProject = async (project: AssetProject) => {
    setActiveProject(project);
    setGameKey(project.game_key);
    await refreshActiveProject(project.id);
  };

  const refreshActiveProject = async (projectId: string) => {
    const [{ data: versionRows, error: versionError }, { data: jobRows, error: jobError }] =
      await Promise.all([
        supabase
          .from("asset_versions")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false }),
        supabase
          .from("asset_jobs")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
      ]);

    if (versionError || jobError) {
      setError(versionError?.message ?? jobError?.message ?? "Could not load project.");
      return;
    }

    setVersions(versionRows ?? []);
    setJobs(jobRows ?? []);
    setActiveVersion(versionRows?.[0] ?? null);

    const latestVersion = versionRows?.[0];
    const kind = latestVersion?.metadata?.assetKind;
    setAssetKind(kind === "model" ? "model" : latestVersion ? "image" : null);
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const kind: AssetKind = isModelFile(file) ? "model" : "image";
      const storagePath = makeStoragePath(file);

      const { error: uploadError } = await supabase.storage
        .from("asset-sources")
        .upload(storagePath, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: project, error: projectError } = await supabase
        .from("asset_projects")
        .insert({
          title: title.trim() || file.name,
          game_key: gameKey,
          status: "ready"
        })
        .select()
        .single();

      if (projectError) {
        throw projectError;
      }

      const { data: version, error: versionError } = await supabase
        .from("asset_versions")
        .insert({
          project_id: project.id,
          label: "Original upload",
          source_asset_path: storagePath,
          preview_glb_path: kind === "model" ? storagePath : null,
          metadata: {
            assetKind: kind,
            originalFileName: file.name,
            blenderSceneStatus: "pending_worker_import"
          },
          validation: {
            status: "not_checked",
            note: "The future Blender worker should import, validate, and export a preview GLB."
          }
        })
        .select()
        .single();

      if (versionError) {
        throw versionError;
      }

      if (kind === "image") {
        const { error: initialPreviewJobError } = await supabase.from("asset_jobs").insert({
          project_id: project.id,
          input_version_id: version.id,
          job_type: "transform",
          status: "queued",
          prompt: "Initial Blender rig preview",
          progress: 5,
          plan: {
            requestedBy: "web_prototype",
            purpose: "Create the first Blender rig preview from the uploaded Minecraft skin without changing the texture."
          }
        });

        if (initialPreviewJobError) {
          throw initialPreviewJobError;
        }
      }

      const nextProject = project as AssetProject;
      setProjects((current) => [nextProject, ...current]);
      setActiveProject(nextProject);
      setVersions([version as AssetVersion]);
      setActiveVersion(version as AssetVersion);
      setJobs([]);
      setAssetKind(kind);
      setChat((current) => [
        ...current,
        {
          role: "system",
          content:
            kind === "image"
              ? `Imported ${file.name}. Creating the first Blender rig preview now.`
              : `Imported ${file.name}. The next step is sending prompts through Claude and the Blender worker.`
        }
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const submitPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!prompt.trim()) {
      return;
    }

    const currentPrompt = prompt.trim();
    setPrompt("");
    setBusy(true);
    setError(null);
    setChat((current) => [...current, { role: "user", content: currentPrompt }]);

    try {
      let projectId = activeProject?.id;
      let versionId = activeVersion?.id;

      if (!projectId || !versionId) {
        // Create new project
        const { data: project, error: projectError } = await supabase
          .from("asset_projects")
          .insert({
            title: title.trim() || "New Character",
            game_key: gameKey,
            status: "ready"
          })
          .select()
          .single();

        if (projectError) throw projectError;
        projectId = project.id;

        // Create blank version
        const { data: version, error: versionError } = await supabase
          .from("asset_versions")
          .insert({
            project_id: projectId,
            label: "Generated from scratch",
            source_asset_path: null,
            preview_glb_path: null,
            metadata: {
              assetKind: "image",
              blenderSceneStatus: "pending_worker_import"
            },
            validation: { status: "not_checked" }
          })
          .select()
          .single();

        if (versionError) throw versionError;
        versionId = version.id;

        setProjects((current) => [project as AssetProject, ...current]);
        setActiveProject(project as AssetProject);
        setVersions([version as AssetVersion]);
        setActiveVersion(version as AssetVersion);
        setAssetKind("image");
      }

      const { data: job, error: jobError } = await supabase
        .from("asset_jobs")
        .insert({
          project_id: projectId,
          input_version_id: versionId,
          job_type: "transform",
          status: "queued",
          prompt: currentPrompt,
          progress: 5,
          plan: {
            requestedBy: "web_prototype",
            nextWorker:
              "Claude should translate this prompt into Blender-safe operations, then the worker should export a new preview GLB."
          }
        })
        .select()
        .single();

      if (jobError) {
        throw jobError;
      }

      const queuedJob = job as AssetJob;
      setJobs((current) => [queuedJob, ...current]);
      setChat((current) => [
        ...current,
        {
          role: "system",
          content:
            "Queued for the Blender worker. Start `npm run worker` in another terminal; this page will poll Supabase and update when the GLB is ready."
        }
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Prompt job failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleNewSession = () => {
    setActiveProject(null);
    setActiveVersion(null);
    setAssetKind(null);
    setVersions([]);
    setJobs([]);
    setTitle("New Character");
    setChat([
      {
        role: "system",
        content: "New session started! Type a prompt below to generate a new character from scratch."
      }
    ]);
  };

  const exportUrl = activeVersion
    ? storagePublicUrl("asset-sources", activeVersion.source_asset_path) ??
      storagePublicUrl("asset-previews", activeVersion.preview_glb_path)
    : null;

  return (
    <main className="grid h-screen grid-cols-[280px_minmax(0,1fr)_360px] bg-[#f2f3f7] text-[#040408]">
      <aside className="flex min-h-0 flex-col border-r border-[#c9cdd9] bg-[#eaecf2]">
        <div className="border-b border-[#c9cdd9] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.25em] text-[#4b5364]">
              <Box size={16} />
              Asset Studio
            </div>
            <button
              onClick={handleNewSession}
              className="rounded bg-[#3809a3]/20 px-2 py-1 text-xs font-semibold text-[#210574] transition hover:bg-[#3809a3]/30"
            >
              + New
            </button>
          </div>
          <h1 className="mt-3 text-2xl font-bold">Game character projects</h1>
        </div>

        <div className="space-y-3 border-b border-[#c9cdd9] p-4">
          <label className="block text-xs uppercase tracking-[0.18em] text-[#4b5364]">Project name</label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-lg border border-[#babfcf] bg-[#dbdfea] px-3 py-2 text-sm outline-none focus:border-[#3809a3]"
          />

          <label className="block text-xs uppercase tracking-[0.18em] text-[#4b5364]">Game pipeline</label>
          <select
            value={gameKey}
            onChange={(event) => setGameKey(event.target.value)}
            className="w-full rounded-lg border border-[#babfcf] bg-[#dbdfea] px-3 py-2 text-sm outline-none focus:border-[#3809a3]"
          >
            {gameOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#99a1b7] bg-[#dbdfea] px-3 py-3 text-sm text-[#0c0f28] transition hover:border-[#3809a3]">
            <Upload size={16} />
            Upload skin / GLB
            <input className="hidden" type="file" accept=".png,.jpg,.jpeg,.webp,.glb,.gltf,.zip" onChange={handleUpload} />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {error && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="font-semibold text-amber-800">Database Offline</div>
              <div className="mt-1 text-[11px] text-amber-800/80">{error}</div>
              <div className="mt-2 text-[11px] text-[#4b5364] leading-relaxed">
                Supabase free projects automatically pause after 7 days of inactivity. Go to your <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-amber-700 underline hover:text-amber-900">Supabase Dashboard</a> and click <strong>Restore</strong> to reload your saved character versions.
              </div>
            </div>
          )}

          <p className="mb-2 px-1 text-xs uppercase tracking-[0.18em] text-[#4b5364]">Projects</p>
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => void selectProject(project)}
                className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                  activeProject?.id === project.id
                    ? "border-[#3809a3] bg-[#d3cfe8]"
                    : "border-[#c9cdd9] bg-[#e5e7ee] hover:border-[#99a1b7]"
                }`}
              >
                <div className="font-medium">{project.title}</div>
                <div className="mt-1 text-xs text-[#4b5364]">{project.game_key}</div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between border-b border-[#c9cdd9] px-5 py-4">
          <div>
            <div className="text-sm text-[#4b5364]">Cloud Blender workspace</div>
            <h2 className="text-xl font-semibold">{activeProject?.title ?? "Upload a character to begin"}</h2>
          </div>
          <a
            href={exportUrl ?? undefined}
            download
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
              exportUrl ? "bg-[#3809a3] text-white" : "pointer-events-none bg-[#c8ccdb] text-[#777e90]"
            }`}
          >
            <Download size={16} />
            Export current
          </a>
        </div>

        <div className="min-h-0 flex-1 p-5">
          <ModelViewer assetUrl={activeAssetUrl} assetKind={assetKind} />
        </div>

        <div className="grid grid-cols-3 gap-3 border-t border-[#c9cdd9] p-4">
          {versions.slice(0, 6).map((version) => (
            <button
              key={version.id}
              onClick={() => setActiveVersion(version)}
              className={`rounded-xl border px-3 py-2 text-left text-sm ${
                activeVersion?.id === version.id
                  ? "border-[#3809a3] bg-[#d3cfe8]"
                  : "border-[#c9cdd9] bg-[#e5e7ee]"
              }`}
            >
              <div className="truncate font-medium">{version.label}</div>
              <div className="mt-1 truncate text-xs text-[#4b5364]">{version.prompt ?? "Uploaded source"}</div>
            </button>
          ))}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[#c9cdd9] bg-[#eaecf2]">
        <div className="border-b border-[#c9cdd9] p-4">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles size={18} className="text-[#210574]" />
            AI edit chat
          </div>
          <p className="mt-2 text-sm text-[#4b5364]">
            Prompts are saved as jobs now. Next step is a real Claude planner and Blender worker.
          </p>
        </div>

        {error ? <div className="m-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {chat.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-2xl border p-3 text-sm leading-6 ${
                message.role === "user"
                  ? "ml-6 border-[#3809a3]/50 bg-[#d0c6e8]"
                  : "mr-6 border-[#c9cdd9] bg-[#e5e7ee] text-[#0c0f28]"
              }`}
            >
              {message.content}
            </div>
          ))}

          {jobs.slice(0, 5).map((job) => (
            <div key={job.id} className="rounded-xl border border-[#c9cdd9] bg-[#e5e7ee] p-3 text-xs text-[#4b5364]">
              <div className="flex items-center justify-between">
                <span>{job.status}</span>
                <span>{job.progress}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#c8ccdb]">
                <div className="h-full bg-[#3809a3]" style={{ width: `${job.progress}%` }} />
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={submitPrompt} className="space-y-3 border-t border-[#c9cdd9] p-4">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-[#babfcf] px-3 py-2 text-sm text-[#0c0f28]"
          >
            <ImagePlus size={16} />
            Add ref image later
          </button>

          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
            placeholder="Make the armor cyberpunk, keep the rig intact, add blue glow..."
            className="min-h-28 w-full resize-none rounded-xl border border-[#babfcf] bg-[#dbdfea] p-3 text-sm outline-none focus:border-[#3809a3] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!prompt.trim() || busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3809a3] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#babfcf] disabled:text-[#676f80]"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Send to Blender worker
          </button>
        </form>
      </aside>
    </main>
  );
}
