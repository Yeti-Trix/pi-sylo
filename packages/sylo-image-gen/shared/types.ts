/**
 * Core types for sylo-image-gen. Single source of truth shared by the agent
 * extension (plan §8 step 4), host main (step 5 — same import pattern as
 * main/tasks-db.ts → packages/sylo-tasks/shared), and the sidebar route.
 * §2 = ComfyUI backend (client/workflows/models config); §4 = library store.
 * Plan: .sylo/plans/db584c80-9ae0-4a02-828f-5aecd7b6b62c.md — ALL-LOCAL ONLY
 * (§2.6, operator decision 2026-10-11): ComfyUI is the only backend; no remote
 * generation calls, no provider keys, nothing cloud-shaped.
 */

export type ImagePreset = 'draft' | 'final'

/** Aspect chips offered in the composer; concrete px come from the model default + aspect. */
export type AspectRatio = '1:1' | '16:9' | '9:16' | '3:2' | '2:3' | '4:3' | '3:4'

/** §2.1 — request contract for the image backend (v1: ComfyUI only, all-local). */
export interface GenRequest {
  prompt: string
  negative_prompt?: string
  /** Catalog model id (preset-derived default when unresolved). */
  model: string
  preset: ImagePreset
  width: number
  height: number
  steps?: number
  guidance?: number
  seed?: number
  sampler?: string
  aspect?: AspectRatio
  /** Images per call, 1–4 (ComfyUI batches natively). */
  count: number
  /** Write results to the workspace image library (default true). */
  save: boolean
  tags?: string[]
  /** Library image id to inherit params/prompt/size/seed from (remix/rerun-as-final). */
  from_record?: string
}

export interface GenOutputMeta {
  model: string
  preset: ImagePreset
  steps: number
  guidance: number
  seed: number
  sampler?: string
  comfy_prompt_id?: string
  gen_ms?: number
}

export interface GenOutput {
  buffer: Uint8Array
  width: number
  height: number
  meta: GenOutputMeta
}

export interface GenResult {
  outputs: GenOutput[]
}

/** §2.3 — normalized health snapshot from ComfyUI /system_stats + /queue. */
export interface BackendHealth {
  ok: boolean
  url: string
  error?: string
  version?: string
  device_name?: string
  vram_total_bytes?: number
  vram_free_bytes?: number
  queue_depth?: number
}

/** §2.3 — poll-based progress callback payload (elapsed + prompt id; WebSocket events are v2). */
export interface GenProgress {
  comfy_prompt_id: string
  elapsed_ms: number
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error'

/** Route-side / agent-side job tracking (queue screen is v2). */
export interface JobRecord {
  id: string
  created_at: string
  prompt: string
  model: string
  preset: ImagePreset
  status: JobStatus
  error?: string
  comfy_prompt_id?: string
  output_record_ids?: string[]
}

/** §2.2 — catalog entry; `comfy` = how it wires into a ComfyUI API graph, `download` = guided-install data. */
export interface ModelCatalogEntry {
  id: string
  label: string
  family: string
  license: string
  commercial_ok: boolean
  backend: 'comfyui'
  role: 'draft' | 'final' | 'both'
  approx_size_gb?: number
  min_vram_gb?: number
  steps: number
  guidance: number
  default_size: { width: number; height: number }
  strengths?: string
  /**
   * Loader wiring for this model in a full-cow ComfyUI API graph (§2.4). File
   * names are ComfyUI-model-dir-relative basenames; exact names/types follow
   * community packaging and MUST be verified against a live ComfyUI /object_info
   * at §6 manual QA (doctor/§3.3 detects real installs; these are defaults).
   */
  comfy: {
    /** DiT weights — UNETLoader.unet_name (diffusion_models/). */
    diffusion_model: string
    /** Text-encoder files (text_encoders/): 2 ⇒ DualCLIPLoader, 1 ⇒ CLIPLoader. */
    text_encoders: string[]
    /** CLIPLoader/DualCLIPLoader `type` (e.g. 'lumina2' | 'flux' | 'flux2' | 'qwen_image' — live
     *  ComfyUI Desktop /object_info enum 2026-10-11: CLIPLoader has NO 'z_image' option; Lumina-2's
     *  'lumina2' is the type Z-Image's Qwen3-4B TE uses; 'flux' lives on DualCLIPLoader). */
    clip_type: string
    /** VAE file (vae/). */
    vae: string
  }
  /** Guided-install data (Settings model table + doctor): HF model card + expected paths. */
  download?: {
    huggingface_url: string
    /** ComfyUI model dirs that must contain this entry's files. */
    targets: string[]
    /** Expected files as <comfyui-models-subdir>/<basename> — display + detection hints. */
    comfyui_subfolders: string[]
  }
}

/** §4.2 — the workspace library record. Files on disk are truth for pixels; index truth for metadata. */
export interface ImageRecord {
  id: string
  created_at: string
  /** Relative to the library root: files/<yyyy>/<mm>/<id>.png */
  file_rel: string
  width: number
  height: number
  bytes: number
  model: string
  backend: string
  preset: ImagePreset
  prompt: string
  negative_prompt?: string
  params: { steps: number; guidance: number; seed: number; sampler?: string; aspect?: AspectRatio }
  gen_ms: number
  /** variant/edit/remix lineage */
  parent_id?: string
  origin: 'agent' | 'route'
  tags: string[]
  favorite: boolean
  album?: string
  caption?: string
  comfy_prompt_id?: string
}

export interface LibraryStore {
  version: 1
  images: ImageRecord[]
}

/** §4.3 — library query filters (index scan; SQLite/FTS explicitly out of scope). */
export interface LibraryQuery {
  query?: string
  /** All must match. */
  tags?: string[]
  favorite?: boolean
  model?: string
  since?: string
  limit?: number
  offset?: number
}

/** §3.2 — sylo_image_gen_organize request shape. */
export interface OrganizeRequest {
  image_ids: string[]
  add_tags?: string[]
  remove_tags?: string[]
  favorite?: boolean
  album?: string | null
  delete?: boolean
}

/** §2.7 — config shape (host owns the JSON file + schema sidecar; see imagegen-config.ts when it lands). */
export interface ImagegenConfig {
  comfyui_url: string
  draft_model: string
  final_model: string
  default_aspect: AspectRatio
  auto_tag_preset: boolean
  image_format: 'png'
  upscale_model: string
  caption_backend: 'off'
  comfyui_exe_path: string
}