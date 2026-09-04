/** Think tank export helpers — keep debate markdown readable (no thinking/body interleave). */

export const THINK_TANK_DEBATE_QUESTION_MARKER = 'Think tank debate question:'

export type SplitThinkTankTopic = {
  context?: string
  question: string
}

export function splitThinkTankTopic(topic: string): SplitThinkTankTopic {
  const t = topic.trim()
  const markerIdx = t.indexOf(THINK_TANK_DEBATE_QUESTION_MARKER)
  if (markerIdx >= 0) {
    let context = t.slice(0, markerIdx).trim()
    context = context.replace(/\n---\s*$/, '').trim()
    const question = t.slice(markerIdx + THINK_TANK_DEBATE_QUESTION_MARKER.length).trim()
    return { context: context || undefined, question: question || t }
  }
  return { question: t }
}

export function stripThinkTankStanceFooter(body: string): string {
  const text = body.trim()
  if (!text) return text
  const jsonMatch = text.match(/\{[\s\S]*"stance"[\s\S]*\}\s*$/i)
  if (jsonMatch) {
    const stripped = text.slice(0, text.length - jsonMatch[0].length).trim()
    return stripped || text
  }
  return text
}

export function isThinkTankFragmentTurn(body: string): boolean {
  const stripped = stripThinkTankStanceFooter(body).trim()
  if (stripped.length >= 400) return false
  return (
    /^(holding|stray token|fragment)/i.test(stripped) ||
    /stray (token|fragment)/i.test(stripped) ||
    (/^no new output\.?$/im.test(stripped) && stripped.length < 220)
  )
}

export function extractThinkingFromThinkTankWorkflow(toolCallsJson: string | null): string {
  if (!toolCallsJson) return ''
  try {
    const rows = JSON.parse(toolCallsJson) as Array<{ event?: { type?: string; delta?: string } }>
    const parts: string[] = []
    for (const row of rows) {
      if (row.event?.type === 'thinking_delta' && typeof row.event.delta === 'string') {
        parts.push(row.event.delta)
      }
    }
    return parts.join('').trim()
  } catch {
    return ''
  }
}
