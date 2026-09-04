import type { ThinkTankStance } from './sylo-host.ts'

export type ParsedDebateTurn = {
  body: string
  stance: ThinkTankStance
  summary: string
}

const STANCE_VALUES: ThinkTankStance[] = ['continue', 'satisfied', 'no_more_to_add']

function normalizeStance(raw: string | undefined): ThinkTankStance {
  const s = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  if (s === 'no_more' || s === 'no_more_to_add' || s === 'done') return 'no_more_to_add'
  if (s === 'satisfied' || s === 'ok' || s === 'ok_with_report') return 'satisfied'
  if (STANCE_VALUES.includes(s as ThinkTankStance)) return s as ThinkTankStance
  return 'continue'
}

/** Parse model output: JSON footer block or STANCE:/SUMMARY: lines. Missing stance → continue. */
export function parseDebateTurn(raw: string): ParsedDebateTurn {
  const text = raw.trim()
  if (!text) {
    return { body: '(empty turn)', stance: 'continue', summary: '(empty)' }
  }

  const jsonMatch = text.match(/\{[\s\S]*"stance"[\s\S]*\}\s*$/i)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { stance?: string; summary?: string }
      const body = text.slice(0, text.length - jsonMatch[0].length).trim()
      return {
        body: body || text,
        stance: normalizeStance(parsed.stance),
        summary: (parsed.summary ?? '').trim() || '(no summary)',
      }
    } catch {
      /* fall through */
    }
  }

  const stanceLine = text.match(/^STANCE:\s*(.+)$/im)
  const summaryLine = text.match(/^SUMMARY:\s*(.+)$/im)
  if (stanceLine || summaryLine) {
    let body = text
    if (stanceLine?.[0]) body = body.replace(stanceLine[0], '')
    if (summaryLine?.[0]) body = body.replace(summaryLine[0], '')
    return {
      body: body.trim() || text,
      stance: normalizeStance(stanceLine?.[1]),
      summary: (summaryLine?.[1] ?? '').trim() || '(no summary)',
    }
  }

  const inlineStance = text.match(/"stance"\s*:\s*"(continue|satisfied|no_more_to_add)"/i)
  if (inlineStance) {
    const summaryMatch = text.match(/"summary"\s*:\s*"([^"]*)"/i)
    return {
      body: text,
      stance: normalizeStance(inlineStance[1]),
      summary: summaryMatch?.[1]?.trim() || text.split('\n')[0]?.slice(0, 120) || '(no summary)',
    }
  }

  return { body: text, stance: 'continue', summary: text.split('\n')[0]?.slice(0, 120) ?? '(no summary)' }
}

export function allSeatsReady(stances: ThinkTankStance[]): boolean {
  return stances.length > 0 && stances.every((s) => s === 'satisfied' || s === 'no_more_to_add')
}
