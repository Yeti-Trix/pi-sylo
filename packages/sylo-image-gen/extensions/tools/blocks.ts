/**
 * Shared content-block + tool-result plumbing for the sylo-image-gen tools
 * (§3 wires all five through this; plan §8 step 4).
 *
 * pi-ai's ImageContent requires `data`; the sylo renderer additionally reads an
 * optional `_localPath` off image blocks (toolResultContent.ts parseContentBlocks)
 * and prefers it for full-res local display (§0.8). Blocks that only carry
 * `_localPath` (or preview-less saves) are cast at the single boundary below.
 */
import type { AgentToolResult } from '@earendil-works/pi-coding-agent'

export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data?: string; _localPath?: string }

export type ToolResult = AgentToolResult<undefined>

/** Actionable error text — failures are surfaced as text, never rethrown raw. */
export function toolError(text: string): ToolResult {
  return { content: [{ type: 'text', text }], details: undefined }
}

/** Success wrapper: casts the block array once so `_localPath`-only blocks compile. */
export function toolResult(blocks: ToolContentBlock[]): ToolResult {
  return { content: blocks as ToolResult['content'], details: undefined }
}