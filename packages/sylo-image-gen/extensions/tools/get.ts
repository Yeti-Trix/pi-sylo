/**
 * sylo_image_gen_get (plan §3.2) — full record for one library image, including
 * complete params + lineage (parent_id) so the agent can remix via
 * sylo_image_gen_generate's from_image_id. Adds the absolute file path (read
 * convenience; record.file_rel stays the store's index form).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
  getRecord,
  imageFileAbs,
  resolveLibraryRoot,
  resolveWorkspaceRoot,
} from '../../shared/library-store.ts'
import { toolError, toolResult, type ToolContentBlock } from './blocks.ts'

const Params = Type.Object({
  image_id: Type.String({ description: 'Library image id.' }),
})

export function registerGetTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'sylo_image_gen_get',
    label: 'Image library — full record',
    description:
      'Full record for one library image: complete generation params, tags, and lineage (parent_id). ' +
      'Use it to remix — pass from_image_id to sylo_image_gen_generate.',
    parameters: Params,
    async execute(_toolCallId, params) {
      if (!resolveWorkspaceRoot()) {
        return toolError(
          'No workspace is active (SYLO_PI_CWD is not set) — the per-workspace image library is unavailable. ' +
            'Run this tool from a Sylo chat (agent runs carry the workspace).',
        )
      }
      try {
        const record = await getRecord({ image_id: params.image_id })
        if (!record) {
          return toolError(
            `No library image with id "${params.image_id}" — run sylo_image_gen_list to find current ids ` +
              '(records disappear when deleted; ids come from sylo_image_gen_list/generate JSON).',
          )
        }
        const root = resolveLibraryRoot({})
        // root is non-null here (workspace resolved above); imageFileAbs guards escapes.
        const withPath = root ? { ...record, path: imageFileAbs(root, record.file_rel) } : record
        const blocks: ToolContentBlock[] = [{ type: 'text', text: JSON.stringify(withPath) }]
        return toolResult(blocks)
      } catch (err) {
        return toolError(
          `sylo_image_gen_get failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'Run sylo_image_gen_doctor to check sylo-image-gen setup.',
        )
      }
    },
  })
}