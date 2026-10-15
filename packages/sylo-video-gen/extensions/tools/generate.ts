/**
 * sylo_video_gen_generate (plan §3.1 — v1 core tool).
 *
 * Flow (§3.1 + the landed §2 shared core): resolve the request via the catalog
 * `resolveVideoGenRequest` (§2.2/§2.5: mode → variant, preset/model pairing,
 * resolution px, d×fps 4n+1 frames) → durable job row (§4.3 queued) → PREFLIGHT
 * (health probe, queue depth, free-VRAM vs catalog min_vram_gb, model-weights
 * detection via /object_info — doctor-guided download pointers; read-only GETs
 * only) → status running (+ comfy_prompt_id captured from the first progress
 * event) → source uploads via the client's multipart /upload/image (stills for
 * i2v/loop; control clips for restyle) → `comfyGenerateVideo` (ONE submit, count
 * 1–2 fans branches; submit/poll to the 20-min cap; fetches video + poster) →
 * per-output `createRecord` pairs (clip bytes + in-graph poster; the pair batch
 * rides the store's single-flight write queue as one contiguous block, §4.2) →
 * job done/error → result blocks (§3.4: ≤512 px poster JPEG preview + caption
 * `Generated video — model · mode · W×H@fps · len s · seed N` + `_localPath`)
 * and a compact JSON summary (record refs).
 *
 * LINEAGE (§3.1/§3.5 — one-way):
 *   from_video_id  — video-library remix: inherits prompt/seed/resolution/
 *                    duration when the request doesn't say otherwise; records
 *                    parent_video_id. When the mode is restyle and no source
 *                    clip was given, the parent clip IS the source (the obvious
 *                    "restyle this clip I made" intent — documented deviation).
 *   from_image_id  — IMAGES-library still via shared/image-link.ts (§3.5):
 *                    guarded dynamic import, READ-ONLY (getRecord only, same
 *                    workspace root), SOFT-FAIL with a plain-language note — a
 *                    clip t2v render simply proceeds without the still; loop /
 *                    source-less renders surface the note + guidance. The video
 *                    record stores lineage.source_image_id; NEVER a back-write
 *                    into the image library.
 *
 * Errors are text, never rethrown raw (blocks.ts): ComfyUI-down/not-reachable,
 * queue-busy (refusal — video renders queue behind and block this tool),
 * free-VRAM below the model's catalog minimum, model weights not detected
 * (download pointers from the catalog), 4n+1 duration violations, submit 400s
 * (client surfaces the body verbatim — the §0 silent-400 guard), timeout, and
 * catalog rejections for opt-in models. Run sylo_video_gen_doctor after any of
 * them — the doctor prints the same tables. ALL-LOCAL ONLY (§2.6): ComfyUI is the
 * only backend; nothing is spawned or fetched beyond the operator's instance.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
  comfyGenerateVideo,
  comfyModelsDetected,
  comfyUploadFile,
  resolveComfyEndpoint,
  type BackendHealthWithStats,
} from '../../shared/comfyui/client.ts'
import {
  MAX_VIDEOS_PER_CALL,
  VIDEO_DURATIONS_SECONDS,
  findVideoModelEntry,
  resolveVideoGenRequest,
  type VideoGenRequestInput,
} from '../../shared/catalog.ts'
import type { VideoGenRequest, VideoRecord } from '../../shared/types.ts'
import { resolveVideoStillLink } from '../../shared/image-link.ts'
import {
  createRecord,
  getRecord,
  requireLibraryRoot,
  resolveWorkspaceRoot,
  videoFileAbs,
} from '../../shared/video-library-store.ts'
import { createJob, updateJob } from '../../shared/video-jobs-store.ts'
import { loadVideogenConfig } from '../config.ts'
import { toolError, toolResult, type ToolContentBlock } from './blocks.ts'
import { encodePreviewFromPng } from './preview-image.ts'

/** Exported so test:tools reads the REAL schema (name-fixedness + roundtrip). */
export const GENERATE_PARAMS = Type.Object({
  prompt: Type.Optional(
    Type.String({
      description:
        'Describe the shot. Required unless the request carries a source still (i2v). Loop discipline: cyclical, subtle, ONE movement at a time — hair sway, light pulse, drifting cloud layer, slow orbit.',
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal('clip'), Type.Literal('loop'), Type.Literal('restyle')], {
      description:
        "'clip' (default: shot clip, text→video — or image→video when a source still is given), 'loop' (living photo: one still + subtle cyclical motion, needs a source still), " +
        "'restyle' (whole-clip V2V, needs a source clip). One mode per call.",
    }),
  ),
  preset: Type.Optional(
    Type.Union([Type.Literal('draft'), Type.Literal('final')], {
      description:
        "'draft' (fast exploration, default for clip) or 'final' (committed quality). Loop + restyle always render on the wired final-tier model. Explore at draft; commit ONE final at a time.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        'Catalog model id override. Default comes from mode + preset + config: wan22-ti2v-5b (draft clips), wan22-a14b (final clips + loops), wan21-vace-14b (restyle).',
    }),
  ),
  negative_prompt: Type.Optional(
    Type.String({
      description: 'Things to avoid. The builder ships the official Wan negative prompt when omitted.',
    }),
  ),
  resolution: Type.Optional(
    Type.Union([Type.Literal('480p'), Type.Literal('720p')], {
      description: '480p | 720p (config default: 720p). wan22-ti2v-5b is 720p-native (1280×704).',
    }),
  ),
  orientation: Type.Optional(
    Type.Union([Type.Literal('landscape'), Type.Literal('portrait')], {
      description: 'landscape (default) | portrait.',
    }),
  ),
  duration_seconds: Type.Optional(
    Type.Union([Type.Literal(4), Type.Literal(5), Type.Literal(8)], {
      description: '4 | 5 | 8 s (config default: 5). Every duration × fps lands on the 4n+1 frame rule.',
    }),
  ),
  framerate: Type.Optional(
    Type.Number({
      description: '16 | 24 fps (model default when omitted: 24 for the 5B draft, 16 for A14B/VACE).',
    }),
  ),
  seed: Type.Optional(
    Type.Number({
      description: 'Random when omitted. Inherited from from_video_id parents for stable lineage.',
    }),
  ),
  loop_motion_strength: Type.Optional(
    Type.Number({
      description:
        'Loop mode only — living-photo motion intensity 0–1 (default 0.5; scales prompt intensity + sampling shift).',
      minimum: 0,
      maximum: 1,
    }),
  ),
  restyle_strength: Type.Optional(
    Type.Number({
      description:
        'Restyle mode only — VACE strength 0–1 (default 0.5; the curve floors at 0.2 so the source structure survives, 1.0 keeps motion exactly).',
      minimum: 0,
      maximum: 1,
    }),
  ),
  count: Type.Optional(
    Type.Number({
      description: `Clips per call, 1–${MAX_VIDEOS_PER_CALL}. Clips cost GPU minutes, not seconds — use 2 while exploring at draft; commit one final at a time.`,
      minimum: 1,
      maximum: MAX_VIDEOS_PER_CALL,
    }),
  ),
  source_image_path: Type.Optional(
    Type.String({
      description: 'Path to a local still for i2v/loop first+last frames (any file on this machine).',
    }),
  ),
  from_image_id: Type.Optional(
    Type.String({
      description:
        'IMAGES library still id — seeds i2v/loop renders with a keyframe born in Images (one-way lineage; soft-fails with a plain-language note when sylo-image-gen is unavailable).',
    }),
  ),
  source_video_path: Type.Optional(
    Type.String({
      description:
        'Restyle only — path to a local source clip (the footage to restyle; you must have the rights to restyle it).',
    }),
  ),
  source_video_id: Type.Optional(
    Type.String({
      description: 'Restyle only — VIDEO LIBRARY clip id to restyle (resolved read-only to its file).',
    }),
  ),
  from_video_id: Type.Optional(
    Type.String({
      description:
        'VIDEO LIBRARY remix id — inherits prompt/seed/resolution/duration; records parent_video_id lineage. In restyle mode with no other source, the parent clip IS the source.',
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Extra library tags (auto-tagged with the mode + preset when auto_tag_preset is on).',
    }),
  ),
  save: Type.Optional(
    Type.Boolean({
      description: 'Write the clip(s) + poster(s) to the workspace video library. Default true.',
    }),
  ),
})

const GIB = 1024 ** 3

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** §3.4 caption line — the renderer's GENERATED_VIDEO_CAPTION_RE (/^generated video/i, §8.7) keys on this shape. */
function generateCaption(out: {
  model: string
  mode: string
  width: number
  height: number
  framerate: number
  duration_seconds: number
  seed: number
}): string {
  return `Generated video — ${out.model} · ${out.mode} · ${out.width}×${out.height}@${out.framerate}fps · ${out.duration_seconds} s · seed ${out.seed}`
}

/** Reverse map: parent record px → its catalog resolution/orientation (from_video_id inheritance). */
function resolutionFromRecordPx(
  parent: Pick<VideoRecord, 'model' | 'resolution'>,
): { resolution: '480p' | '720p'; orientation: 'landscape' | 'portrait' } | undefined {
  const entry = findVideoModelEntry(parent.model)
  if (!entry) return undefined
  for (const resolution of entry.resolutions) {
    const rows = entry.resolution_px[resolution]
    if (!rows) continue
    for (const orientation of ['landscape', 'portrait'] as const) {
      const pair = rows[orientation]
      if (pair && pair.width === parent.resolution.width && pair.height === parent.resolution.height)
        return { resolution, orientation }
    }
  }
  return undefined
}

/**
 * from_video_id inheritance (§3.1: prompt/seed/resolution/duration when the
 * request doesn't say otherwise). Exported for test:tools (pure function).
 */
export function buildRequestFromParams(
  params: Record<string, unknown>,
  fromVideoParent: VideoRecord | undefined,
): VideoGenRequestInput {
  const p = params as {
    prompt?: string
    negative_prompt?: string
    mode?: 'clip' | 'loop' | 'restyle'
    preset?: 'draft' | 'final'
    model?: string
    resolution?: '480p' | '720p'
    orientation?: 'landscape' | 'portrait'
    duration_seconds?: 4 | 5 | 8
    framerate?: number
    seed?: number
    loop_motion_strength?: number
    restyle_strength?: number
    count?: number
    source_image_path?: string
    source_video_path?: string
    source_video_id?: string
    from_image_id?: string
    from_video_id?: string
    tags?: string[]
    save?: boolean
  }
  const parentResolution = fromVideoParent && !p.resolution && !p.orientation ? resolutionFromRecordPx(fromVideoParent) : undefined
  const parentSeed = fromVideoParent && fromVideoParent.seed >= 0 ? fromVideoParent.seed : undefined
  const parentPrompt = fromVideoParent ? fromVideoParent.prompt : ''
  const parentDuration =
    fromVideoParent && (VIDEO_DURATIONS_SECONDS as readonly number[]).includes(fromVideoParent.duration_seconds)
      ? fromVideoParent.duration_seconds
      : undefined
  return {
    prompt: p.prompt?.trim() || parentPrompt,
    negative_prompt: p.negative_prompt?.trim() || undefined,
    mode: p.mode,
    preset: p.preset,
    model: p.model,
    resolution: p.resolution ?? parentResolution?.resolution,
    orientation: p.orientation ?? parentResolution?.orientation,
    duration_seconds: p.duration_seconds ?? parentDuration,
    framerate: p.framerate,
    seed: p.seed ?? parentSeed,
    loop_motion_strength: p.loop_motion_strength,
    restyle_strength: p.restyle_strength,
    count: p.count,
    save: p.save,
    tags: p.tags,
    source_image_id: p.from_image_id, // §3.5 alias — the resolver folds it into source_image_id
    source_image_path: p.source_image_path,
    source_video_path: p.source_video_path,
    source_video_id: p.source_video_id,
    from_video_id: p.from_video_id,
  }
}

/** Read a source file for upload with a plain-language failure. */
function readSourceBytes(path: string, what: string): Uint8Array {
  try {
    const bytes = readFileSync(path)
    if (bytes.byteLength === 0) throw new Error('the file is empty')
    return new Uint8Array(bytes)
  } catch (err) {
    throw new Error(
      `The ${what} "${path}" could not be read (${err instanceof Error ? err.message : String(err)}) — ` +
        'pass an existing local path, or a library id that resolves to an existing file instead.',
    )
  }
}

/** ComfyUI-input upload name: prefixed + call-unique so concurrent calls never clobber (overwrite '1' keeps retries clean). */
function uploadNameFor(sourcePath: string): string {
  const short = randomUUID().slice(0, 8)
  return `sylo-video-${short}-${basename(sourcePath).replace(/[^A-Za-z0-9._-]+/g, '_')}`
}

function formatBytes(n: number): string {
  if (n >= GIB) return `${(n / GIB).toFixed(1)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${n} B`
}

function cutErrorText(err: unknown): string {
  const text = errText(err)
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

export function registerGenerateTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'sylo_video_gen_generate',
    label: 'Generate videos (ComfyUI)',
    description:
      `Generate 1–${MAX_VIDEOS_PER_CALL} local video clips via ComfyUI — mode 'clip' (text→video, or image→video when a source still ` +
      "is given), 'loop' (living photo: one still, subtle cyclical motion — needs a source still), 'restyle' (whole-clip V2V — needs a source clip). " +
      "preset 'draft' = fast exploration (wan22-ti2v-5b), 'final' = committed quality (wan22-a14b lightx2v). Clips cost GPU MINUTES, not seconds: " +
      'explore at draft with count 2, commit ONE final at a time. Returns a poster preview per clip (the clip itself plays in the video library ' +
      'route) and saves to the per-workspace video library. Run sylo_video_gen_list first if a similar clip may already exist; run ' +
      'sylo_video_gen_doctor when generation fails.',
    promptSnippet:
      'Use sylo_video_gen_generate when the operator wants a video clip, a living-photo loop (e.g. a song backdrop animated from an ' +
      "image), or a restyled clip. Explore with preset 'draft' + count 2; commit one final at a time; loops need a source still " +
      '(from_image_id / source_image_path); restyle needs a source clip (source_video_id / source_video_path). After success, stop — the ' +
      'clips are in the library; the operator assembles + syncs them manually.',
    parameters: GENERATE_PARAMS,
    async execute(_toolCallId, params, _signal, onUpdate) {
      // Long-running by design (minutes, not seconds) — the v1 tool does not map
      // the abort signal; ComfyUI-side jobs continue either way and the §4.3
      // ledger keeps them observable across restarts (§8.7 host replay).
      try {
        if (!resolveWorkspaceRoot()) {
          return toolError(
            'No workspace is active (SYLO_PI_CWD is not set) — the per-workspace video library and render ledger are ' +
              'unavailable. Run this tool from a Sylo chat (agent runs carry the workspace), or start Sylo and open a project.',
          )
        }
        const config = loadVideogenConfig()
        const renderStarted = Date.now()

        // Source-priority prevalidation: at most ONE image source and ONE video
        // source — ambiguous requests fail plainly instead of last-write-wins.
        if (params.source_image_path?.trim() && params.from_image_id?.trim()) {
          return toolError(
            'Give ONE image source: from_image_id (an IMAGES-library still) or source_image_path (a local file) — not both.',
          )
        }
        if (params.source_video_path?.trim() && params.source_video_id?.trim()) {
          return toolError(
            'Give ONE restyle source: source_video_id (a VIDEO-library clip) or source_video_path (a local file) — not both.',
          )
        }

        // ── Lineage resolution (§3.1/§3.5) ────────────────────────────────
        const fromVideoId = params.from_video_id?.trim() || undefined
        let parent: VideoRecord | undefined
        if (fromVideoId) {
          parent = (await getRecord({ video_id: fromVideoId })) ?? undefined
          if (!parent) {
            return toolError(
              `No library clip with id "${fromVideoId}" — run sylo_video_gen_list to find current ids ` +
                '(library ids change when records are deleted; ids come from sylo_video_gen_list/generate JSON).',
            )
          }
        }

        // §3.5 guarded cross-package read (soft-fail; the reason rides through the
        // dependency error / summary — never a failure OF this module itself).
        const fromImageId = params.from_image_id?.trim() || undefined
        let linkNote: string | undefined
        let imagePathFromLibrary: string | undefined
        if (fromImageId) {
          const link = await resolveVideoStillLink(fromImageId, { workspaceCwd: resolveWorkspaceRoot() })
          if (link.ok) {
            imagePathFromLibrary = link.image_path
          } else {
            linkNote = link.reason
          }
        }

        const input = buildRequestFromParams(params as Record<string, unknown>, parent)
        // §3.5 soft-fail semantics: the LINK never hard-errors — the TOOL decides per
        // mode. A still that cannot resolve is stripped from the request BEFORE
        // catalog resolution (a stale source_image_id would flip the resolver onto
        // the i2v variant with no still to upload); a prompted clip t2v render then
        // just proceeds WITHOUT the still, carrying image_link_note in the summary.
        if (fromImageId && !imagePathFromLibrary) {
          input.source_image_id = undefined
          const mode = input.mode ?? 'clip'
          const cannotProceed =
            mode === 'restyle' || !input.prompt || (input.source_image_path !== undefined && input.source_image_path.length > 0)
          if (cannotProceed) {
            const why =
              mode === 'restyle'
                ? 'restyle mode takes a source clip — from_image_id is the i2v/loop still alias (ref2v subject injection lands in v2)'
                : !input.prompt
                  ? 'this render has no prompt to render text→video from (loop mode / no prompt given)'
                  : 'the request also had a source_image_path — ambiguous source'
            return toolError(
              `${linkNote ?? 'the requested image could not be resolved'} — ${why}. ` +
                'Alternatives: drop from_image_id (+ prompt) for text→video, pass source_image_path (a local still), ' +
                'or re-run after sylo-image-gen availability is fixed (run sylo_video_gen_doctor).',
            )
          }
          // clip + prompt + unresolved still → soft-fallback: proceed as t2v with the note.
        } else if (imagePathFromLibrary) {
          input.source_image_path = imagePathFromLibrary
        }

        // Restyle source: explicit id → resolve via the VIDEO store (the video→video
        // tie-in does NOT use image-link's guarded import — §3.5); from_video_id
        // doubles as the restyle source when nothing else was given.
        if (input.mode === 'restyle') {
          if (parent && !input.source_video_path && !input.source_video_id) {
            input.source_video_path = videoFileAbs(requireLibraryRoot({}), parent.file_rel)
          } else if (input.source_video_id) {
            const clip = await getRecord({ video_id: input.source_video_id })
            if (!clip) {
              return toolError(
                `No library clip with id "${input.source_video_id}" — run sylo_video_gen_list to find current ids ` +
                  'for the restyle source.',
              )
            }
            input.source_video_path = videoFileAbs(requireLibraryRoot({}), clip.file_rel)
          }
        }

        // ── Catalog resolution (plain-language throw on 4n+1 violations, unsupported combos, opt-in models) ──
        let req: VideoGenRequest
        try {
          req = resolveVideoGenRequest(
            input,
            {
            draft_model: config.config.draft_model,
            final_model: config.config.final_model,
            restyle_model: config.config.restyle_model,
            default_resolution: config.config.default_resolution,
            default_orientation: config.config.default_orientation,
            default_duration_seconds: config.config.default_duration_seconds,
            default_framerate: config.config.default_framerate,
            loop_motion_strength: config.config.loop_motion_strength,
          })
        } catch (err) {
          const message = errText(err).replace(/\.$/, '')
          const suffix = linkNote ? ` (also: ${linkNote})` : ''
          return toolError(`${message}${suffix}. Fix the request parameters, or run sylo_video_gen_doctor to check setup.`)
        }

        // ── Durable job row (§4.3 queued — created BEFORE preflight so every
        // attempt is ledgered; preflight refusals + render failures land as
        // 'error' rows, honestly) ──
        const job = await createJob({ request: req })
        try {
          // ── Preflight (§3.1): engine resolution, health probe, queue depth, free
          // VRAM, weights ── (engine-resolved endpoint: the loopback port sibling
          // is probed when the configured port refuses — found live 2026-10-13,
          // engine on :8189 while the config pinned :8188. Preflight + uploads +
          // submit therefore all talk to the SAME url the health came from.)
          const endpoint: { url: string; health: BackendHealthWithStats } = await resolveComfyEndpoint(config.config.comfyui_url)
          const entry = findVideoModelEntry(req.model)
          const health = endpoint.health
          if (!health.ok) {
            throw new Error(
              `ComfyUI is not reachable at ${config.config.comfyui_url} — start ComfyUI (the default API is http://127.0.0.1:8188) ` +
                `or fix comfyui_url in sylo-video-gen Settings, then re-run. Underlying problem: ${health.error ?? 'no details'}.`,
            )
          }
          if ((health.queue_depth ?? 0) > 0) {
            throw new Error(
              `ComfyUI at ${health.url} is busy — ${health.queue_depth} job(s) already running/pending; a video render (minutes, not ` +
                'seconds) would queue behind them and this tool blocks until done. Wait for the queue to drain, then re-run. ' +
                'sylo_video_gen_doctor shows the current queue.',
            )
          }
          if (entry && health.vram_free_bytes !== undefined && entry.min_vram_gb > 0 && health.vram_free_bytes < entry.min_vram_gb * 1e9) {
            throw new Error(
              `ComfyUI reports ${formatBytes(health.vram_free_bytes)} (≈ ${(health.vram_free_bytes / GIB).toFixed(1)} GiB) free VRAM but ` +
                `${req.model} wants about ${entry.min_vram_gb} GB — free more VRAM (let sylo-tts go idle; avoid image and video finals at the ` +
                'same time) or pick a smaller model. sylo_video_gen_doctor prints the full preflight table.',
            )
          }
          // Weights detection (read-only /object_info GET): a probe that fails to
          // FETCH does NOT gate the submit — the client's own submit-time node
          // validation + 400 surfacing is the fallback; only a REAL detection
          // answer of "not installed" produces the doctor-guided refusal. NOTE:
          // the refusal must NOT live inside the probe's catch-all try — only the
          // network probe is fall-through; the detection answer gates.
          let detected: Record<string, boolean> | undefined
          try {
            detected = await comfyModelsDetected(endpoint.url)
          } catch {
            /* probe fetch failure → fall through to the client's submit-time reporting */
          }
          if (detected && entry && detected[entry.id] === false) {
            const dl = entry.download
            throw new Error(
              `Model weights for ${req.model} were not detected on this ComfyUI install — the graph would fail at submit. ` +
                (dl
                  ? `Download the listed files into the named ComfyUI model folders, then run sylo_video_gen_doctor to confirm detection:\n` +
                    `  download: ${dl.huggingface_url}\n  model dirs: ${dl.targets.join(' · ')}\n  files: ${dl.repo_files.join(', ')}`
                  : 'This model has no download targets in the catalog — run sylo_video_gen_doctor for the full report.'),
            )
          }

          await updateJob({ job_id: job.id, status: 'running', started_at: new Date().toISOString() })

          // ── Progress: elapsed; the FIRST event carries the comfy_prompt_id —
          // capture it into the ledger so a restart mid-render can replay (§4.3/§8.7) ──
          let lastUpdateMs = 0
          let promptIdLogged = false
          const onProgress = (p: { comfy_prompt_id: string; elapsed_ms: number }): void => {
            if (!promptIdLogged && p.comfy_prompt_id) {
              promptIdLogged = true
              void updateJob({ job_id: job.id, comfy_prompt_id: p.comfy_prompt_id }).catch(() => {})
            }
            if (Date.now() - lastUpdateMs < 4_000) return
            lastUpdateMs = Date.now()
            onUpdate?.({
              content: [
                {
                  type: 'text',
                  text: `Rendering ${req.count} clip(s) with ${req.model} (${req.preset} preset, ${req.mode} mode) — ${Math.round(p.elapsed_ms / 1000)}s elapsed…`,
                },
              ],
              details: undefined,
            })
          }

          // ── Source uploads (multipart /upload/image → LoadImage stills, LoadVideo control clips) ──
          const context: { sourceImageRef?: string; sourceVideoRef?: string } = {}
          if (req.source_image_path) {
            const up = await comfyUploadFile(
              endpoint.url,
              readSourceBytes(req.source_image_path, 'source still'),
              uploadNameFor(req.source_image_path),
            )
            context.sourceImageRef = up.ref
          }
          if (req.source_video_path) {
            const up = await comfyUploadFile(
              endpoint.url,
              readSourceBytes(req.source_video_path, 'source clip'),
              uploadNameFor(req.source_video_path),
            )
            context.sourceVideoRef = up.ref
          }

          // ── Submit + poll + fetch (ONE submit; count 1–2 fans branches — §2.4) ──
          const gen = await comfyGenerateVideo(endpoint.url, req, context, { onProgress })

          // ── Library save: ONE synchronized createRecord pair-batch per tool call
          // (§4.2: each call synchronously enqueues its fully-synchronous
          // read-modify-atomic-write mutation — one contiguous block on the
          // store's write chain; allSettled keeps the truthful partial picture). ──
          const tagsRaw = [...(req.tags ?? [])]
          if (config.config.auto_tag_preset) {
            tagsRaw.push(req.mode)
            tagsRaw.push(req.preset)
          }
          // Case-insensitive dedupe, first spelling wins (organize-level identity).
          const tags: string[] = []
          const seenTags = new Set<string>()
          for (const tag of tagsRaw.map((t) => t.trim()).filter(Boolean)) {
            const key = tag.toLowerCase()
            if (!seenTags.has(key)) {
              seenTags.add(key)
              tags.push(tag)
            }
          }

          let perVideo: (Awaited<ReturnType<typeof createRecord>> | undefined)[] = []
          let saveError: string | undefined
          if (req.save) {
            const settled = await Promise.allSettled(
              gen.outputs.map((out) =>
                createRecord({
                  data: out.video,
                  poster_data: out.poster,
                  prompt: req.prompt,
                  negative_prompt: req.negative_prompt,
                  model: out.meta.model,
                  mode: req.mode,
                  preset: out.meta.preset,
                  resolution: { width: out.meta.width, height: out.meta.height },
                  framerate: out.meta.framerate,
                  duration_seconds: req.duration_seconds,
                  frame_count: out.meta.frame_count,
                  seed: out.meta.seed,
                  motion_strength: req.loop_motion_strength ?? req.restyle_strength,
                  video_format: out.meta.video_format,
                  render_ms: out.meta.gen_ms,
                  comfy_prompt_id: out.meta.comfy_prompt_id,
                  lineage: {
                    source_image_id: req.source_image_id,
                    source_image_path: req.source_image_path,
                    source_video_path: req.source_video_path,
                    parent_video_id: parent?.id,
                  },
                  tags: [...tags],
                }),
              ),
            )
            perVideo = settled.map((s) => (s.status === 'fulfilled' ? s.value : undefined))
            const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
            if (rejected) saveError = errText(rejected.reason)
          } else {
            perVideo = gen.outputs.map(() => undefined)
          }

          // ── Job row → done (§4.3: output linkage lives in the ledger row) ──
          const savedIds = perVideo.filter((v) => v?.record.id).map((v) => v!.record.id)
          try {
            await updateJob({
              job_id: job.id,
              status: 'done',
              finished_at: new Date().toISOString(),
              ...(savedIds.length ? { output_record_ids: savedIds } : {}),
            })
          } catch {
            /* a ledger hiccup never fails the tool result */
          }

          // ── Result blocks (§3.4): caption + poster-preview image pair per clip ──
          const previews = gen.outputs.map((out) => (out.poster ? encodePreviewFromPng(out.poster) : null))
          const blocks: ToolContentBlock[] = []
          gen.outputs.forEach((out, i) => {
            const savedEntry = perVideo[i]
            const preview = previews[i]
            if (!savedEntry && !preview?.ok) return
            blocks.push({
              type: 'text',
              text: generateCaption({
                model: out.meta.model,
                mode: out.meta.mode,
                width: out.meta.width,
                height: out.meta.height,
                framerate: out.meta.framerate,
                duration_seconds: req.duration_seconds,
                seed: out.meta.seed,
              }),
            })
            blocks.push({
              type: 'image',
              mimeType: 'image/jpeg',
              data: preview?.ok ? Buffer.from(preview.jpeg).toString('base64') : undefined,
              // The poster PNG is the shareable image; the CLIP is never inlined (§3.4).
              _localPath: savedEntry?.poster_abs,
            })
          })

          const summary = {
            videos: gen.outputs.map((out, i) => ({
              id: perVideo[i]?.record.id ?? null,
              path: perVideo[i]?.file_abs ?? null,
              poster_path: perVideo[i]?.poster_abs ?? null,
              library_root: perVideo[i]?.library_root ?? null,
              width: out.meta.width,
              height: out.meta.height,
              framerate: out.meta.framerate,
              duration_seconds: req.duration_seconds,
              frame_count: out.meta.frame_count,
              seed: out.meta.seed,
              video_format: out.meta.video_format,
              bytes: perVideo[i]?.record.bytes ?? out.video.byteLength,
              render_ms: out.meta.gen_ms,
              comfy_prompt_id: out.meta.comfy_prompt_id,
              preview: previews[i]?.ok ? 'jpeg inline (poster)' : previews[i] ? previews[i].reason : 'no poster saved in-graph',
            })),
            params: {
              mode: req.mode,
              model: req.model,
              preset: req.preset,
              prompt: req.prompt,
              negative_prompt: req.negative_prompt ?? null,
              resolution: req.resolution,
              orientation: req.orientation,
              duration_seconds: req.duration_seconds,
              framerate: req.framerate,
              frame_count: req.frame_count,
              seed: req.seed,
              loop_motion_strength: req.loop_motion_strength ?? null,
              restyle_strength: req.restyle_strength ?? null,
              count: req.count,
              tags,
            },
            job: { id: job.id, status: 'done' },
            lineage: {
              parent_video_id: parent?.id ?? null,
              source_image_id: req.source_image_id ?? null,
              source_image_path: req.source_image_path ?? null,
              source_video_path: req.source_video_path ?? null,
            },
            render_ms_total: Date.now() - renderStarted,
            ...(linkNote ? { image_link_note: linkNote } : {}),
            ...(req.save
              ? { saved: perVideo.filter(Boolean).length === gen.outputs.length }
              : { saved: false, note: 'not saved to the library (save=false)' }),
            ...(saveError ? { save_error: saveError } : {}),
            ...(config.notes.length ? { config_notes: config.notes } : {}),
          }
          blocks.push({ type: 'text', text: JSON.stringify(summary) })
          return toolResult(blocks)
        } catch (renderErr) {
          // Ledger keeps the failure honest (§4.3) — never masks the plain error.
          try {
            await updateJob({
              job_id: job.id,
              status: 'error',
              finished_at: new Date().toISOString(),
              error: cutErrorText(renderErr),
            })
          } catch {
            /* a ledger hiccup never masks the real error */
          }
          const message = errText(renderErr).replace(/\.$/, '')
          return toolError(
            `sylo_video_gen_generate failed: ${message}. ` +
              'Fix the request parameters (mode/preset/resolution/duration/count are constrained), or run sylo_video_gen_doctor to check setup.',
          )
        }
      } catch (err) {
        // Errors before any submit (workspace, config, lineage, resolution) are
        // already actionable; any unexpected error gets the same treatment.
        const message = errText(err).replace(/\.$/, '')
        return toolError(
          `sylo_video_gen_generate failed: ${message}. ` +
            'Fix the request parameters, or run sylo_video_gen_doctor to check setup.',
        )
      }
    },
  })
}