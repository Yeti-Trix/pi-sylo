/**
 * §3.6 — v2 tool name reservations (names fixed now so a later build can't
 * drift). Full Type.Object schemas ship so the agent surface is stable; every
 * execute returns the same disclosure-clause scaffolding notice as the §1
 * stubs (no implementation — v2 scope per plan §6: edit/upscale/variants need
 * ComfyUI inpaint/ESRGAN graphs, open_on_canvas needs the §6 host canvas
 * change, caption needs a Florence-2 graph). NOTHING IS IMPLEMENTED HERE.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type, type TSchema } from 'typebox'

import { MAX_IMAGES_PER_CALL } from '../../shared/models.ts'
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
    name: 'sylo_image_gen_edit',
    label: 'Image edit (v2 — not wired)',
    description:
      'Instruction edit of a library image via ComfyUI masking/inpainting (v2, plan §3.6). ' +
      'Not implemented in v1 — calls return a scaffolding notice.',
    parameters: Type.Object({
        image_id: Type.String({ description: 'Library image id to edit (in place-lineage: output gets parent_id).' }),
        instruction: Type.String({ description: 'Plain-language change to apply, e.g. "make the sky sunset".' }),
        mask_image_path: Type.Optional(
          Type.String({ description: 'Optional PNG mask path (white = editable area). Omit for instruction-guided inpainting.' }),
        ),
        backend: Type.Optional(
          Type.Union([Type.Literal('auto'), Type.Literal('comfyui-inpaint')], {
            description: "'auto' (default) picks the ComfyUI inpaint workflow for the model family. All-local only.",
          }),
        ),
        strength: Type.Optional(Type.Number({ description: '0–1 edit strength.' })),
      }),
    notice:
      'sylo_image_gen_edit is a sylo-image-gen v2 tool (plan §3.6) and is not wired yet — nothing was changed. ' +
      'For a re-render with changes today: sylo_image_gen_get the record, then sylo_image_gen_generate with ' +
      "from_image_id and a modified prompt (keeps seed/size lineage).",
  },
  {
    name: 'sylo_image_gen_upscale',
    label: 'Image upscale (v2 — not wired)',
    description:
      'Upscale a library image ×2/×4 via ComfyUI (ESRGAN/4x-UltraSharp) — v2, plan §3.6. Not implemented in v1.',
    parameters: Type.Object({
        image_id: Type.String({ description: 'Library image id to upscale.' }),
        factor: Type.Union([Type.Literal(2), Type.Literal(4)], { description: '2 or 4.' }),
      }),
    notice:
      'sylo_image_gen_upscale is a sylo-image-gen v2 tool (plan §3.6) and is not wired yet — nothing was changed. ' +
      'The configured upscale_model (4x-ultrasharp) activates with v2; the image is untouched.',
  },
  {
    name: 'sylo_image_gen_variants',
    label: 'Image variants (v2 — not wired)',
    description:
      'Generate controlled variants (seed / prompt-light / steps deltas) of a library image — v2, plan §3.6. Not implemented in v1.',
    parameters: Type.Object({
        image_id: Type.String({ description: 'Parent library image id (variants record parent_id lineage).' }),
        count: Type.Number({ description: `Variants to make, 1–${MAX_IMAGES_PER_CALL}.`, minimum: 1, maximum: MAX_IMAGES_PER_CALL }),
        variation: Type.Union(
          [Type.Literal('seed'), Type.Literal('prompt-light'), Type.Literal('steps')],
          { description: "'seed' = new seeds; 'prompt-light' = small prompt perturbation; 'steps' = step-count deltas." },
        ),
      }),
    notice:
      'sylo_image_gen_variants is a sylo-image-gen v2 tool (plan §3.6) and is not wired yet — nothing was changed. ' +
      'For variations today: sylo_image_gen_get the record, then sylo_image_gen_generate with from_image_id and ' +
      'count 2–4 (new seeds share the parent seed base).',
  },
  {
    name: 'sylo_image_gen_open_on_canvas',
    label: 'Image → Canvas (v2 — not wired)',
    description:
      'Pin a library image to the live Canvas panel — v2, plan §3.6 (needs the §6 host canvas change). Not implemented in v1.',
    parameters: Type.Object({
        image_id: Type.String({ description: 'Library image id to pin.' }),
      }),
    notice:
      'sylo_image_gen_open_on_canvas is a sylo-image-gen v2 tool (plan §3.6) and is not wired yet — nothing was opened. ' +
      'The Canvas image kind lands with the v2 host change; meanwhile share images inline via sylo_image_gen_generate results.',
  },
  {
    name: 'sylo_image_gen_caption',
    label: 'Image captions (v2 — not wired)',
    description:
      'Auto-caption library images locally with Florence-2 via ComfyUI (no cloud vision) — v2, plan §3.6. Not implemented in v1.',
    parameters: Type.Object({
        image_ids: Type.Array(Type.String(), { description: 'Library image ids to caption.' }),
      }),
    notice:
      'sylo_image_gen_caption is a sylo-image-gen v2 tool (plan §3.6) and is not wired yet — nothing was changed. ' +
      'Florence-2 auto-captions (searchable in sylo_image_gen_list) land with v2.',
  },
]

export function registerV2ScaffoldTools(api: ExtensionAPI): void {
  for (const tool of V2_TOOLS) {
    api.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      // Same disclosure clause family as the §1 stubs: name, plan anchor, explicit
      // "nothing was changed/opened" statement, and an actionable in-v1 alternative.
      async execute() {
        return toolError(tool.notice)
      },
    })
  }
}