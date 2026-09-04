import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

/** Mirrors host `SYLO_SKILL_SURFACE_CAPABILITY_DESCRIPTOR.max_widget_bytes` (keep in sync). */
const MAX_WIDGET_BYTES = 65536
/** Inline SVG / Mermaid source for Sylo Canvas (host-native panel). */
const MAX_CANVAS_BYTES = 262144

type ShowWidgetHostPayload = {
  type: 'show_widget'
  toolCallId: string
  html?: string
  path?: string
  data: unknown
}

type ShowCanvasHostPayload = {
  type: 'show_canvas'
  toolCallId: string
  kind: 'svg' | 'mermaid' | 'markdown'
  title?: string
  content?: string
  filePath?: string
}

function sendToSyloHost(payload: ShowWidgetHostPayload | ShowCanvasHostPayload): void {
  const snd = process.send?.bind(process) as ((m: unknown) => boolean) | undefined
  if (snd) snd(payload)
}

export default function syloSkillSurfaceExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'show_widget',
    label: 'Show widget',
    description:
      'Sylo host: render a Discussion #317 skill widget in a sandboxed iframe. Pass exactly one of `html` or `path` (renderer URL path starting with /, e.g. /skill-surface/smoke.html). Optional `data` is exposed as window.__WIDGET_DATA__.',
    parameters: Type.Object({
      html: Type.Optional(Type.String({ description: 'HTML fragment (body content, scripts allowed after host policy scan)' })),
      path: Type.Optional(
        Type.String({
          description:
            'App-hosted template path (e.g. /skill-surface/smoke.html) or https:// URL; skill-asset resolution comes later.',
        }),
      ),
      data: Type.Optional(Type.Unknown({ description: 'JSON-serializable payload for the widget' })),
    }),
    async execute(toolCallId, params) {
      const html = typeof params.html === 'string' ? params.html : undefined
      const path = typeof params.path === 'string' ? params.path : undefined
      const hasH = html !== undefined && html.trim().length > 0
      const hasP = path !== undefined && path.trim().length > 0
      if (hasH === hasP) {
        return {
          content: [
            {
              type: 'text',
              text: 'show_widget requires exactly one of `html` or `path`.',
            },
          ],
        }
      }
      if (hasH && html!.length > MAX_WIDGET_BYTES) {
        return {
          content: [
            {
              type: 'text',
              text: `show_widget html exceeds max_widget_bytes (${MAX_WIDGET_BYTES}).`,
            },
          ],
        }
      }

      sendToSyloHost({
        type: 'show_widget',
        toolCallId,
        ...(hasH ? { html: html! } : { path: path!.trim() }),
        data: params.data === undefined ? {} : params.data,
      })

      return {
        content: [
          {
            type: 'text',
            text: 'Host notified to display widget (non-blocking). The operator should see the panel shortly.',
          },
        ],
      }
    },
  })

  pi.registerTool({
    name: 'show_canvas',
    label: 'Show canvas',
    description:
      'Sylo host: render SVG, Mermaid, or Markdown in the native Canvas panel (not a sandbox iframe). ' +
      'For `kind: svg`, pass inline `content` (<svg> markup) or absolute `filePath` to a .svg file on disk. ' +
      'For `kind: mermaid`, pass diagram source in `content`. ' +
      'For `kind: markdown`, pass inline `content` (markdown source) or absolute `filePath` to a .md file on disk — the host reads the file and renders it with the same GFM+KaTeX renderer used in chat. ' +
      'Optional `title` labels the panel.',
    parameters: Type.Object({
      kind: Type.Union([Type.Literal('svg'), Type.Literal('mermaid'), Type.Literal('markdown')], {
        description: 'svg — vector markup or file; mermaid — text diagram source; markdown — GFM/KaTeX document (inline or .md file)',
      }),
      title: Type.Optional(Type.String({ description: 'Short label shown in the Canvas header' })),
      content: Type.Optional(
        Type.String({
          description: 'Inline SVG markup, Mermaid source, or Markdown source (required for mermaid; optional for svg/markdown if filePath is set)',
        }),
      ),
      filePath: Type.Optional(
        Type.String({
          description: 'Absolute path to a local .svg file (svg kind) or .md file (markdown kind); the host reads it into content. Ignored for mermaid.',
        }),
      ),
    }),
    async execute(toolCallId, params) {
      const kind = params.kind
      const title = typeof params.title === 'string' ? params.title : undefined
      const content = typeof params.content === 'string' ? params.content : undefined
      const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : undefined
      const hasContent = content !== undefined && content.trim().length > 0
      const hasFile = filePath !== undefined && filePath.length > 0

      if (kind === 'mermaid') {
        if (!hasContent) {
          return {
            content: [{ type: 'text', text: 'show_canvas mermaid requires non-empty `content`.' }],
          }
        }
        if (hasFile) {
          return {
            content: [{ type: 'text', text: 'show_canvas mermaid does not accept `filePath`.' }],
          }
        }
        if (content!.length > MAX_CANVAS_BYTES) {
          return {
            content: [
              {
                type: 'text',
                text: `show_canvas content exceeds max_canvas_bytes (${MAX_CANVAS_BYTES}).`,
              },
            ],
          }
        }
      } else if (kind === 'markdown') {
        if (hasContent === hasFile) {
          return {
            content: [
              {
                type: 'text',
                text: 'show_canvas markdown requires exactly one of `content` (inline markdown) or `filePath` (absolute .md path).',
              },
            ],
          }
        }
        if (hasContent && content!.length > MAX_CANVAS_BYTES) {
          return {
            content: [
              {
                type: 'text',
                text: `show_canvas content exceeds max_canvas_bytes (${MAX_CANVAS_BYTES}). Use \`filePath\` for large documents.`,
              },
            ],
          }
        }
      } else {
        if (hasContent === hasFile) {
          return {
            content: [
              {
                type: 'text',
                text: 'show_canvas svg requires exactly one of `content` (inline <svg>) or `filePath` (absolute .svg path).',
              },
            ],
          }
        }
        if (hasContent && content!.length > MAX_CANVAS_BYTES) {
          return {
            content: [
              {
                type: 'text',
                text: `show_canvas content exceeds max_canvas_bytes (${MAX_CANVAS_BYTES}).`,
              },
            ],
          }
        }
      }

      sendToSyloHost({
        type: 'show_canvas',
        toolCallId,
        kind,
        ...(title ? { title } : {}),
        ...(hasContent ? { content: content! } : {}),
        ...(hasFile ? { filePath: filePath! } : {}),
      })

      return {
        content: [
          {
            type: 'text',
            text: 'Host notified to display Canvas (non-blocking). The operator should see the panel shortly.',
          },
        ],
      }
    },
  })
}
