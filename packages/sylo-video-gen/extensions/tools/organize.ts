/**
 * sylo_video_gen_organize (plan §3.3) — organizeRecords passthrough, sylo_image_gen_organize
 * twin: add/remove tags (add after remove, case-insensitive identity), favorite, or
 * delete:true (removes the CLIP + POSTER files AND the record — §3.3 delete policy).
 * No album/caption knobs: the §8.2 VideoRecord contract has neither field. The
 * delete-confirmation discipline lives in SKILL.md (§3.2/§4 binding #5) — this tool
 * executes what it is told. Workspace resolves from SYLO_PI_CWD only (§4 binding #2).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
  organizeRecords,
  resolveWorkspaceRoot,
  type OrganizeOptions,
} from '../../shared/video-library-store.ts'
import { toolError, toolResult, type ToolContentBlock } from './blocks.ts'

const Params = Type.Object({
  video_ids: Type.Array(Type.String(), { description: 'Library clip ids to update.' }),
  add_tags: Type.Optional(Type.Array(Type.String())),
  remove_tags: Type.Optional(Type.Array(Type.String())),
  favorite: Type.Optional(Type.Boolean()),
  delete: Type.Optional(
    Type.Boolean({
      description: 'Permanently remove the clip + poster + record. Confirm with the operator first.',
    }),
  ),
})

export function registerOrganizeTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'sylo_video_gen_organize',
    label: 'Video library — organize',
    description:
      'Update library entries: add/remove tags, favorite, or delete (removes the clip AND its poster AND the record — ' +
      'big files, no undo). Confirm deletes with the operator before calling.',
    parameters: Params,
    async execute(_toolCallId, params) {
      if (!resolveWorkspaceRoot()) {
        return toolError(
          'No workspace is active (SYLO_PI_CWD is not set) — the per-workspace video library is unavailable. ' +
            'Run this tool from a Sylo chat (agent runs carry the workspace).',
        )
      }
      try {
        const result = await organizeRecords(params as OrganizeOptions)
        const note =
          result.updated.length === 0 && result.deleted.length === 0
            ? 'No matching ids — run sylo_video_gen_list to find current record ids.'
            : undefined
        const blocks: ToolContentBlock[] = [
          { type: 'text', text: JSON.stringify({ ...result, ...(note ? { note } : {}) }) },
        ]
        return toolResult(blocks)
      } catch (err) {
        return toolError(
          `sylo_video_gen_organize failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'Run sylo_video_gen_doctor to check sylo-video-gen setup.',
        )
      }
    },
  })
}