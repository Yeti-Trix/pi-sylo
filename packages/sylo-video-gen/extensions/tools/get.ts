/**
 * sylo_video_gen_get (plan §3.2) — full record for one library clip, sylo_image_gen_get
 * twin: record + lineage + absolute clip path (+ poster path when present) so the
 * agent can remix via sylo_video_gen_generate's from_video_id / restyle with
 * source_video_id. Content rules follow the plan's video economics (§3.4): video
 * files are multi-MB and are NOT inlined by default — the record + paths suffice
 * and the route/detail player owns actual playback; an explicit
 * `include_video_data: true` returns the clip bytes base64 (multi-MB in context —
 * avoid unless the operator asks for the raw bytes).
 */
import { readFileSync } from 'node:fs'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
  getRecord,
  resolveLibraryRoot,
  resolveWorkspaceRoot,
  videoFileAbs,
} from '../../shared/video-library-store.ts'
import { toolError, toolResult, type ToolContentBlock } from './blocks.ts'

const Params = Type.Object({
  video_id: Type.String({ description: 'Library clip id.' }),
  include_video_data: Type.Optional(
    Type.Boolean({
      description:
        'Include the clip bytes as base64 (5–20 MB + per clip — bloats context; the path/plays-in-route flow needs nothing but the record).',
    }),
  ),
  include_poster_data: Type.Optional(
    Type.Boolean({
      description: 'Include the poster PNG bytes as base64 (small first-frame image; useful for inline re-share).',
    }),
  ),
})

export function registerGetTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'sylo_video_gen_get',
    label: 'Video library — full record',
    description:
      'Full record for one library clip: complete render params (model/mode/preset/resolution/fps/frames/seed/strengths), ' +
      'tags, lineage (parent_video_id + source still/clip), and absolute clip + poster paths. Use it to remix — pass ' +
      'from_video_id (or source_video_id in restyle mode) to sylo_video_gen_generate.',
    parameters: Params,
    async execute(_toolCallId, params) {
      if (!resolveWorkspaceRoot()) {
        return toolError(
          'No workspace is active (SYLO_PI_CWD is not set) — the per-workspace video library is unavailable. ' +
            'Run this tool from a Sylo chat (agent runs carry the workspace).',
        )
      }
      try {
        const record = await getRecord({ video_id: params.video_id })
        if (!record) {
          return toolError(
            `No library clip with id "${params.video_id}" — run sylo_video_gen_list to find current ids ` +
              '(records disappear when deleted; ids come from sylo_video_gen_list/generate JSON).',
          )
        }
        const root = resolveLibraryRoot({})
        // root is non-null here (workspace resolved above); videoFileAbs guards escapes.
        const withPath: Record<string, unknown> = { ...record }
        if (root) {
          withPath.path = videoFileAbs(root, record.file_rel)
          if (record.poster_rel) withPath.poster_path = videoFileAbs(root, record.poster_rel)
        }
        const blocks: ToolContentBlock[] = []
        if (params.include_poster_data && root && record.poster_rel) {
          try {
            const posterBytes = readFileSync(videoFileAbs(root, record.poster_rel))
            withPath.poster_data_b64 = Buffer.from(posterBytes).toString('base64')
          } catch (err) {
            withPath.poster_data_note =
              `poster unreadable (${err instanceof Error ? err.message : String(err)}) — the record stands; the clip is unaffected`
          }
        }
        blocks.push({ type: 'text', text: JSON.stringify(withPath) })
        if (params.include_video_data && root) {
          // Opt-in only (§3.4: multi-MB b64 in chat is the anti-pattern; the
          // route/detail player owns playback). Plain warning rides in the text.
          try {
            const videoBytes = readFileSync(withPath.path as string)
            const header = 'video_data_base64 (explicitly requested — do not re-embed in results; share the path instead):'
            blocks.push({ type: 'text', text: `${header} ${Buffer.from(videoBytes).toString('base64')}` })
          } catch (err) {
            return toolError(
              `The clip file could not be read (${err instanceof Error ? err.message : String(err)}) — the record stands; ` +
                'run sylo_video_gen_doctor to check the library.',
            )
          }
        }
        return toolResult(blocks)
      } catch (err) {
        return toolError(
          `sylo_video_gen_get failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'Run sylo_video_gen_doctor to check sylo-video-gen setup.',
        )
      }
    },
  })
}