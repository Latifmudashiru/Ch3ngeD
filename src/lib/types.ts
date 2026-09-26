export type AssetProject = {
  id: string;
  title: string;
  game_key: string;
  status: "draft" | "processing" | "ready" | "failed" | "exported";
  created_at: string;
  updated_at: string;
};

export type AssetVersion = {
  id: string;
  project_id: string;
  parent_version_id: string | null;
  label: string;
  prompt: string | null;
  source_asset_path: string | null;
  blend_path: string | null;
  preview_glb_path: string | null;
  thumbnail_path: string | null;
  validation: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AssetJob = {
  id: string;
  project_id: string;
  input_version_id: string | null;
  output_version_id: string | null;
  job_type: "import" | "transform" | "preview" | "export";
  status: "queued" | "planning" | "generating_texture" | "running_blender" | "validating" | "completed" | "failed";
  prompt: string | null;
  plan: Record<string, unknown>;
  error: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
};
