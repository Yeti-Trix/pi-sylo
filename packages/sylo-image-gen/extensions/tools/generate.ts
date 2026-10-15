/**
 * sylo_image_gen_generate (plan §3.1 — v1 core tool).
 *
 * Flow: resolveGenRequest (§2 models) → comfyGenerate (one submit, N seeds base+i,
 * §2.4) → JPEG preview per image (≤512 px, extensions/tools/preview-image.ts) →
 * if save (default true): a synchronized batch of createRecord calls — every call
 * is enqueued onto the library write queue in one synchronous tick, so they run
 * as ONE contiguous serialized batch per tool call (§4 binding #2: the workspace
 * resolves from SYLO_PI_CWD/workspaceCwd only — never an explicit libraryRoot,
 * which would skip the change fan).
 *
 * from_image_id inheritance (remix / rerun-as-final): when the request doesn't
 * say otherwise, seed, size, negative_prompt, and preset are inherited from the
 * parent record (preset inherits as the parent's catalog model id; §3.1's preset
 * field doubles as a model picker). Passing preset:'final' explicitly upgrades a
 * draft with the configured final model (§6 acceptance #2).
 *
 * Result blocks per §3.1: for each image — caption text
 *   "Generated image — <model> · <preset> · <w×h> · seed <n> · <s>s"
 *   then {type:'image', mimeType:'image/jpeg', data:<b64 ≤512 px preview>,
 *         _localPath:<absolute library path>}
 * then one final text block with the JSON summary (ids/paths/params/gen_ms).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { comfyGenerate, ComfyUIError, type GenProgress, resolveComfyEndpoint } from '../../shared/comfyui/client.ts'
import { resolveGenRequest, type GenRequestInput } from '../../shared/models.ts'
import { getRecord, createRecord, type CreateRecordResult } from '../../shared/library-store.ts'
import type { ImageRecord } from '../../shared/types.ts'
import { loadImagegenConfig } from '../config.ts'
import { toolError, toolResult, type ToolContentBlock } from './blocks.ts'
import { encodePreviewFromPng } from './preview-image.ts'

const Params = Type.Object({
  prompt: Type.String({
    description: 'What to depict. Full descriptive sentence(s); put text to render inside quotes for Qwen-Image.',
  }),
  preset: Type.Optional(
    Type.String({
      description:
        "'draft' (fast low-res exploration, default when exploring), 'final' (commit), or a catalog model id. Default: final.",
    }),
  ),
  negative_prompt: Type.Optional(
    Type.String({
      description: 'Things to avoid. Ignored by flow-matching models that lack negative inputs (z-image); harmless to pass.',
    }),
  ),
  aspect: Type.Optional(
    Type.String({ description: "'1:1' (default) | '16:9' | '9:16' | '3:2' | '2:3' | '4:3' | '3:4'" }),
  ),
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  steps: Type.Optional(Type.Number()),
  guidance: Type.Optional(Type.Number()),
  seed: Type.Optional(Type.Number()),
  count: Type.Optional(
    Type.Number({
      description: 'Images per call, 1–4. Use 2–4 for drafts while exploring.',
      minimum: 1,
      maximum: 4,
    }),
  ),
  from_image_id: Type.Optional(
    Type.String({
      description: 'Library image id to inherit params/prompt/size/seed from (remix/rerun-as-final).',
    }),
  ),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Extra library tags.' })),
  save: Type.Optional(Type.Boolean({ description: 'Write to the workspace image library. Default true.' })),
})

function captionText(out: {
  meta: { model: string; preset: string; seed: number; gen_ms?: number }
  width: number
  height: number
}): string {
  const seconds = out.meta.gen_ms !== undefined ? ` · ${(out.meta.gen_ms / 1000).toFixed(1)}s` : ''
  return `Generated image — ${out.meta.model} · ${out.meta.preset} · ${out.width}×${out.height} · seed ${out.meta.seed}${seconds}`
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerGenerateTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'sylo_image_gen_generate',
    label: 'Generate images (ComfyUI)',
    description:
      "Generate 1–4 local images via ComfyUI. preset 'draft' = fast low-res exploration, " +
      "'final' = committed quality render. Returns inline previews and saves to the " +
      'per-workspace image library (tags, provenance). Run sylo_image_gen_list first if a similar ' +
      'image may already exist; run sylo_image_gen_doctor when generation fails.',
    promptSnippet:
      'Use sylo_image_gen_generate when the operator wants an image/illustration/logo/concept. ' +
      "Explore with preset 'draft' + count 2–4; commit with preset 'final' (or from_image_id + final). " +
      'After success, stop — the images are the deliverable.',
    parameters: Params,
    async execute(_toolCallId, params, _signal, onUpdate) {
      try {
        const config = loadImagegenConfig()
        const genMsStarted = Date.now()

        // ── from_image_id inheritance ────────────────────────────────────────
        const fromImageId = params.from_image_id?.trim() || undefined
        let parent: ImageRecord | undefined
        if (fromImageId) {
          parent = (await getRecord({ image_id: fromImageId })) ?? undefined
          if (!parent) {
            return toolError(
              `No library image with id "${fromImageId}" — run sylo_image_gen_list to find current ids ` +
                '(library ids change when records are deleted; the id is in the sylo_image_gen_generate result JSON).',
            )
          }
        }

        const request: GenRequestInput = {
          // Schema requires prompt; an empty prompt falls back to the parent's (inherit prompt).
          prompt: params.prompt.trim() || parent?.prompt || '',
          // Preset inherits as the parent's catalog model; explicit draft/final/model-id wins.
          preset: params.preset?.trim() || parent?.model || undefined,
          negative_prompt: params.negative_prompt?.trim() || parent?.negative_prompt || undefined,
          // Aspect must be forwarded — resolveGenRequest derives dims from it when no explicit w/h.
          aspect: params.aspect,
          // Size: explicit dims win over aspect; parent's px only when neither is given.
          width:
            params.width !== undefined
              ? params.width
              : !params.aspect && parent && parent.width > 0
                ? parent.width
                : undefined,
          height:
            params.height !== undefined
              ? params.height
              : !params.aspect && parent && parent.height > 0
                ? parent.height
                : undefined,
          steps: params.steps,
          guidance: params.guidance,
          // Seed inherits for stable lineage (rerun-as-final keeps composition).
          seed:
            params.seed ??
            (parent && Number.isFinite(parent.params.seed) && parent.params.seed > 0 ? parent.params.seed : undefined),
          count: params.count ?? 1,
          save: params.save ?? true,
          tags: params.tags,
          from_record: fromImageId,
        }
        const req = resolveGenRequest(request, {
          draft_model: config.config.draft_model,
          final_model: config.config.final_model,
        })

        // Operator + auto-preset tags (§3.5 tag conventions; auto_tag_preset config).
        const tags = [...(req.tags ?? [])]
        if (config.config.auto_tag_preset) tags.push(req.preset)

        // ── Submit + poll (one submit, N seeds; elapsed-progress spinner) ────
        let lastUpdateMs = 0
        const onProgress = (p: GenProgress): void => {
          if (Date.now() - lastUpdateMs < 4_000) return
          lastUpdateMs = Date.now()
          onUpdate?.({
            content: [
              {
                type: 'text',
                text: `Generating ${req.count} image(s) with ${req.model} (preset ${req.preset}) — ${Math.round(p.elapsed_ms / 1000)}s elapsed…`,
              },
            ],
            details: undefined,
          })
        }
        // Resolve the engine first: a loopback port flip (Desktop restart landed
        // on :8189 while the config pins :8188) self-heals instead of failing the
        // whole submission. When NOTHING answers, endpoint.url = the ORIGINAL
        // configured URL and comfyGenerate throws its rich not_reachable guidance
        // exactly as before — this hook is purely opportunistic.
        const endpoint = await resolveComfyEndpoint(config.config.comfyui_url)
        if (endpoint.url !== config.config.comfyui_url) {
          onUpdate?.({
            content: [
              {
                type: 'text',
                text: `Configured ComfyUI ${config.config.comfyui_url} is down — falling back to the live engine at ${endpoint.url}.`,
              },
            ],
            details: undefined,
          })
        }
        const gen = await comfyGenerate(endpoint.url, req, { onProgress })

        // ── Previews ────────────────────────────────────────────────────────
        const previews = gen.outputs.map((out) => encodePreviewFromPng(out.buffer))

        // ── Library save: ONE synchronized createRecord batch per tool call ──
        // Each createRecord synchronously enqueues its (fully synchronous) read-
        // modify-atomic-write mutation, so these run as one contiguous serialized
        // batch on the store's write chain. Workspace comes from SYLO_PI_CWD.
        // Per-output save results, index-aligned with gen.outputs (undefined when
        // that image's record failed); saveError carries the first rejection.
        let perImage: (CreateRecordResult | undefined)[] = []
        let saveError: string | undefined
        if (req.save) {
          // allSettled keeps the truthful partial picture: images whose records
          // wrote stay reported with ids/paths; the first rejection becomes
          // save_error (fail-fast store contract — a rejection means no record).
          const settled = await Promise.allSettled(
            gen.outputs.map((out, i) =>
              createRecord({
                data: out.buffer,
                width: out.width,
                height: out.height,
                prompt: req.prompt,
                negative_prompt: req.negative_prompt,
                model: out.meta.model,
                preset: out.meta.preset,
                steps: out.meta.steps,
                guidance: out.meta.guidance,
                seed: out.meta.seed,
                sampler: out.meta.sampler,
                gen_ms: out.meta.gen_ms,
                aspect: req.aspect,
                tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
                parent_id: parent?.id,
                origin: 'agent',
                comfy_prompt_id: out.meta.comfy_prompt_id,
              }),
            ),
          )
          perImage = settled.map((s) => (s.status === 'fulfilled' ? s.value : undefined))
          const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
          if (rejected) saveError = errText(rejected.reason)
        } else {
          perImage = gen.outputs.map(() => undefined)
        }

        // ── Result blocks (§3.1) ────────────────────────────────────────────
        const blocks: ToolContentBlock[] = []
        gen.outputs.forEach((out, i) => {
          const savedEntry = perImage[i]
          const hasPreview = previews[i]?.ok
          // No library path and no preview ⇒ nothing shows inline; omit the pair.
          if (!savedEntry && !hasPreview) return
          blocks.push({ type: 'text', text: captionText(out) })
          blocks.push({
            type: 'image',
            mimeType: 'image/jpeg',
            data: hasPreview ? Buffer.from(previews[i]!.jpeg).toString('base64') : undefined,
            _localPath: savedEntry?.file_abs,
          })
        })

        const summary = {
          images: gen.outputs.map((out, i) => ({
            id: perImage[i]?.record.id ?? null,
            // Absolute library path (files are truth for pixels; the PNG embeds the
            // full ComfyUI workflow in tEXt as third-copy provenance, §4.1).
            path: perImage[i]?.file_abs ?? null,
            library_root: perImage[i]?.library_root ?? null,
            width: out.width,
            height: out.height,
            seed: out.meta.seed,
            bytes: perImage[i]?.record.bytes ?? out.buffer.byteLength,
            preview: previews[i]?.ok ? 'jpeg inline' : previews[i] && !previews[i].ok ? previews[i].reason : 'none',
          })),
          params: {
            model: req.model,
            preset: req.preset,
            prompt: req.prompt,
            negative_prompt: req.negative_prompt ?? null,
            width: req.width,
            height: req.height,
            steps: req.steps,
            guidance: req.guidance,
            seed: req.seed,
            aspect: req.aspect ?? null,
            count: req.count,
            sampler: req.sampler ?? null,
          },
          gen_ms: Date.now() - genMsStarted,
          parent_image_id: parent?.id ?? null,
          ...(req.save
            ? { saved: perImage.filter(Boolean).length === gen.outputs.length }
            : { saved: false, note: 'not saved to the library (save=false)' }),
          ...(saveError ? { save_error: saveError } : {}),
          ...(config.notes.length ? { config_notes: config.notes } : {}),
        }
        blocks.push({ type: 'text', text: JSON.stringify(summary) })
        return toolResult(blocks)
      } catch (err) {
        // Errors from resolveGenRequest/comfyGenerate are already actionable; any
        // unexpected error gets the same treatment — text only, never rethrown raw.
        if (err instanceof ComfyUIError) return toolError(err.message)
        const message = errText(err).replace(/\.$/, '')
        return toolError(
          `sylo_image_gen_generate failed: ${message}. ` +
            'Fix the request parameters, or run sylo_image_gen_doctor to check setup.',
        )
      }
    },
  })
}