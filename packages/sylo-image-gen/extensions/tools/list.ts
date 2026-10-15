/**
 * sylo_image_gen_list (plan §3.2) — library query. Projects queryLibrary().items
 * (compact §3.2 records); `total` (full match count before offset/limit — §4
 * binding #1) feeds the pagination hint, so the agent can page instead of
 * guessing. Workspace resolves from SYLO_PI_CWD only (§4 binding #2).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { queryLibrary, resolveWorkspaceRoot } from '../../shared/library-store.ts'
import type { LibraryQuery } from '../../shared/types.ts'
import { toolError, toolResult, type ToolContentBlock } from './blocks.ts'

const Params = Type.Object({
  query: Type.Optional(
    Type.String({ description: 'Substring, case-insensitive over prompt/tags/caption.' }),
  ),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'All must match.' })),
  favorite: Type.Optional(Type.Boolean({ description: 'Favorites only when true.' })),
  model: Type.Optional(Type.String({ description: 'Catalog model id filter.' })),
  since: Type.Optional(Type.String({ description: 'ISO date — only images created on/after.' })),
  limit: Type.Optional(Type.Number({ description: 'Default 20, max 100.' })),
  offset: Type.Optional(Type.Number()),
})

export function registerListTool(api: ExtensionAPI): void {
  api.registerTool({
    name: 'sylo_image_gen_list',
    label: 'Image library — search',
    description:
      'Search the workspace image library — text (prompt/tags), tag AND-filter, favorites, model, since-date; ' +
      'paginated compact records with absolute paths. Check here before regenerating something similar.',
    parameters: Params,
    async execute(_toolCallId, params) {
      if (!resolveWorkspaceRoot()) {
        return toolError(
          'No workspace is active (SYLO_PI_CWD is not set) — the per-workspace image library is unavailable. ' +
            'Run this tool from a Sylo chat (agent runs carry the workspace), or start Sylo and open a project.',
        )
      }
      try {
        const query = params as LibraryQuery
        const result = await queryLibrary(query)
        const more = result.total > (params.offset ?? 0) + result.items.length
        const summary = {
          total: result.total,
          returned: result.items.length,
          offset: params.offset ?? 0,
          ...(more
            ? { more_remaining: result.total - ((params.offset ?? 0) + result.items.length), hint: `pass offset=${(params.offset ?? 0) + result.items.length} for the next page` }
            : {}),
          items: result.items,
        }
        const blocks: ToolContentBlock[] = [{ type: 'text', text: JSON.stringify(summary) }]
        return toolResult(blocks)
      } catch (err) {
        return toolError(
          `sylo_image_gen_list failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'Run sylo_image_gen_doctor to check sylo-image-gen setup.',
        )
      }
    },
  })
}