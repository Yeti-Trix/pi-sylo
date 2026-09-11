import { existsSync, readFileSync } from 'node:fs'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

// `@earendil-works/pi-ai` is a transitive type-only dependency of pi-coding-agent
// that is not installed directly (these imports are erased by esbuild at build
// time). Define the content-block shapes locally so tsc can resolve them;
// they are structurally identical to pi-ai's `TextContent` / `ImageContent`.
type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

const SYLO_CANVAS_SKETCH_PATH = 'SYLO_CANVAS_SKETCH_PATH'

function toolError(text: string): { content: ToolContentBlock[]; details: undefined } {
  return { content: [{ type: 'text', text }], details: undefined }
}

/**
 * sylo-canvas-sketch — gives the agent a pull-based view of the operator's
 * freehand canvas sketch (Canvas → Draw mode). The renderer mirrors the current
 * sketch bitmap into the host (`canvas:set-sketch-image` IPC → a PNG file in
 * userData); this tool reads that file and returns it as an image so the
 * operator can just ask "look at my sketch" from normal chat instead of using
 * the removed draw-panel send box.
 */
export default function syloCanvasSketch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'canvas_sketch',
    label: 'Canvas sketch',
    description:
      "Pull the operator's current freehand sketch from the Sylo canvas drawing area (Draw mode) " +
      'as a PNG image. Use this whenever the operator refers to a sketch or drawing they made on the ' +
      'canvas. Returns the sketch as an image plus its file path (if the image bytes are stripped for a ' +
      'text-only main model, call analyze_image with that path). Returns a text notice when the ' +
      'drawing area is empty.',
    parameters: Type.Object({}),
    async execute() {
      const path = (process.env[SYLO_CANVAS_SKETCH_PATH] ?? '').trim()
      if (!path || !existsSync(path)) {
        return toolError(
          'The canvas drawing area is empty — nothing has been drawn (or the sketch was cleared).',
        )
      }
      let base64: string
      try {
        base64 = readFileSync(path).toString('base64')
      } catch (e) {
        return toolError(`Could not read the sketch snapshot: ${String((e as Error)?.message ?? e)}`)
      }
      return {
        content: [
          {
            type: 'text',
            text:
              'Current canvas drawing-area sketch (PNG). Saved path: ' +
              path +
              '. If the image bytes are not visible to you (text-only main model), call analyze_image with that path.',
          },
          { type: 'image', data: base64, mimeType: 'image/png' },
        ],
        details: undefined,
      }
    },
  })
}