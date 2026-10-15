/**
 * §3.6 — v2 tool name reservations (names FIXED now so a later build can't drift;
 * sylo-image-gen v2-scaffold.ts pattern). Full Type.Object schemas ship so the
 * agent surface is stable; every execute returns the same disclosure-clause
 * scaffolding notice — zero implementation (v2 scope per plan §6:
 * `sylo_video_gen_upscale` needs the SeedVR2/Real-ESRGAN/RIFE in-graph wiring,
 * deep `_restyle` needs VACE masks + ref2v, `_shot_manifest` needs batch draft
 * policy, `_open_on_canvas` needs the §6 host canvas change, `_poster` needs the
 * external-ffmpeg detect + timestamp extraction). NOTHING IS IMPLEMENTED HERE.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type, type TSchema } from 'typebox'

import { toolError } from './blocks.ts'

interface ScaffoldTool {
  name: string
  label: string
  description: string
  parameters: TSchema
  notice: string
}

const V2_TOOLS: ScaffoldTool[] = [
  {
    name: 'sylo_video_gen_upscale',
    label: 'Video upscale/restore (v2 — not wired)',
    description:
      'Upscale/restore a library clip in-graph — SeedVR2 3B/7B one-step restore, Real-ESRGAN, or RIFE/FILM frame ' +
      'interpolation (all native nodes; v2, plan §3.6). Not implemented in v1.',
    parameters: Type.Object({
      video_id: Type.String({ description: 'Library clip id to upscale/restore (output records parent lineage).' }),
      mode: Type.Union(
        [Type.Literal('restore'), Type.Literal('upscale'), Type.Literal('interpolate')],
        { description: "'restore' = SeedVR2 one-step; 'upscale' = Real-ESRGAN; 'interpolate' = RIFE/FILM fps doubling." },
      ),
      interp_multiplier: Type.Optional(
        Type.Union([Type.Literal(2), Type.Literal(4)], { description: 'Interpolate: 2× or 4× frame count.' }),
      ),
    }),
    notice:
      'sylo_video_gen_upscale is a sylo-video-gen v2 tool (plan §3.6) and is not wired yet — nothing was rendered or changed. ' +
      'Today: re-render the scene at a higher resolution/preset via sylo_video_gen_generate (draft → final), and use ' +
      'sylo_video_gen_get + sylo_video_gen_organize for the library half.',
  },
  {
    name: 'sylo_video_gen_restyle',
    label: 'Deep restyle (v2 — not wired)',
    description:
      'Deep VACE restyle: mask draw / mask video, object replacement, ref2v subject injection (v2, plan §3.6). ' +
      'Not implemented in v1 — v1 ships whole-clip V2V via sylo_video_gen_generate mode restyle.',
    parameters: Type.Object({
      video_id: Type.String({ description: 'Library clip id (or source_video_path) to restyle.' }),
      instruction: Type.String({ description: 'Plain-language style/subject change, e.g. "restyle as oil-painting texture".' }),
      mask_video_path: Type.Optional(
        Type.String({ description: 'Optional PNG mask-sequence path (white = restylable region). Omit for instruction-guided.' }),
      ),
      reference_image_path: Type.Optional(
        Type.String({ description: 'ref2v subject reference still (Images library id or local path).' }),
      ),
      mask_scope: Type.Optional(
        Type.Union([Type.Literal('object-replace'), Type.Literal('region')], {
          description: "'object-replace' swaps a masked object; 'region' restyles only the masked region.",
        }),
      ),
    }),
    notice:
      'sylo_video_gen_restyle (deep VACE) is a sylo-video-gen v2 tool (plan §3.6) and is not wired yet — nothing was changed. ' +
      "Today's whole-clip restyle lives in sylo_video_gen_generate with mode 'restyle' (source_video_id/source_video_path + restyle_strength).",
  },
  {
    name: 'sylo_video_gen_shot_manifest',
    label: 'Shot manifest → batch drafts (v2 — not wired)',
    description:
      'Turn a shot list into batched draft clips (one graph per shot, sequential queue) for the operator to review before ' +
      'any final commits — assembly itself stays manual (Resolve); v2, plan §3.6. Not implemented in v1.',
    parameters: Type.Object({
      manifest_name: Type.String({ description: 'Name of the shot list (provenance tag on every draft).' }),
      shots: Type.Array(
        Type.Object({
          prompt: Type.String({ description: 'Shot description (the same loop/clip prompt discipline).' }),
          mode: Type.Optional(Type.Union([Type.Literal('clip'), Type.Literal('loop')], { description: 'Default clip.' })),
          from_image_id: Type.Optional(Type.String({ description: 'Keyframe still from the Images library (i2v/loop seed).' })),
          from_video_id: Type.Optional(Type.String({ description: 'Parent clip for remix lineage.' })),
          duration_seconds: Type.Optional(Type.Union([Type.Literal(4), Type.Literal(5), Type.Literal(8)])),
        }),
        { description: 'Ordered shots; each renders one draft.' },
      ),
    }),
    notice:
      'sylo_video_gen_shot_manifest is a sylo-video-gen v2 tool (plan §3.6) and is not wired yet — nothing was queued. ' +
      'Today: call sylo_video_gen_generate per shot (preset draft, count 1–2), optionally with from_image_id/from_video_id lineage; ' +
      'the operator assembles the selects manually in Resolve.',
  },
  {
    name: 'sylo_video_gen_open_on_canvas',
    label: 'Video → Canvas (v2 — not wired)',
    description:
      'Pin a library clip to the live Canvas panel as a video snapshot (poster + native player) — v2, plan §3.6 ' +
      '(needs the §6 host canvas change). Not implemented in v1.',
    parameters: Type.Object({
      video_id: Type.String({ description: 'Library clip id to pin.' }),
    }),
    notice:
      'sylo_video_gen_open_on_canvas is a sylo-video-gen v2 tool (plan §3.6) and is not wired yet — nothing was opened. ' +
      'The Canvas video kind lands with the v2 host change; meanwhile share poster previews from sylo_video_gen_generate results ' +
      'and the clip path (the route\'s detail drawer plays the video).',
  },
  {
    name: 'sylo_video_gen_poster',
    label: 'Poster extraction (v2 — not wired)',
    description:
      'Extract a poster/frame at an arbitrary timestamp via an external ffmpeg (detect-not-bundle, never bundled) — ' +
      'v2, plan §3.6. Not implemented in v1 (v1 posters are the in-graph first-frame PNGs).',
    parameters: Type.Object({
      video_id: Type.String({ description: 'Library clip id (or absolute path) to extract from.' }),
      timestamp_seconds: Type.Number({ description: 'Timestamp (s) for the extracted frame; 0 = the in-graph poster.' }),
      overwrite_poster: Type.Optional(
        Type.Boolean({ description: 'Replace the record poster (v1 default keeps both).' }),
      ),
    }),
    notice:
      'sylo_video_gen_poster is a sylo-video-gen v2 tool (plan §3.6) and is not wired yet — nothing was extracted. ' +
      "Today each record's in-graph first-frame poster is at sylo_video_gen_get's poster_path; arbitrary timestamps land with v2 " +
      '(external ffmpeg, detect-not-bundle).',
  },
]

export function registerV2ScaffoldTools(api: ExtensionAPI): void {
  for (const tool of V2_TOOLS) {
    api.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      // Same disclosure clause family as the sylo-image-gen stubs: name, plan
      // anchor, explicit "nothing was rendered/changed/opened" statement, and an
      // actionable in-v1 alternative.
      async execute() {
        return toolError(tool.notice)
      },
    })
  }
}