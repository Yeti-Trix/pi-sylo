import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

const VISION_MODEL_ID =
  /vl|vision|llava|gemini|gpt-4o|claude-3|claude-4|pixtral|minicpm-v|qwen[\d.]*vl|qwen3\.[56]|moondream|llama3\.2-vision|bakllava/i

/** Whether the active Pi model accepts image blocks (matches sylo-web-access heuristic). */
export function modelSupportsVision(ctx: ExtensionContext): boolean {
  const m = ctx.model as { id?: string; input?: string[]; capabilities?: string[] } | undefined
  if (!m) return false
  const id = (m.id ?? '').toLowerCase()
  if (VISION_MODEL_ID.test(id)) return true
  if (Array.isArray(m.capabilities) && m.capabilities.includes('vision')) return true
  if (Array.isArray(m.input) && m.input.includes('image')) return true
  return false
}
