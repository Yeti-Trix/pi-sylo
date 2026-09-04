import { parseDebateTurn } from './stance.ts'

const STANCE_FOOTER_RE =
  /\{[^{}]*"stance"\s*:\s*"(?:continue|satisfied|no_more_to_add)"[^{}]*"summary"\s*:\s*"[^"]*"[^{}]*\}/gi

const META_TAIL_RES: RegExp[] = [
  /\n+The user just said\b[\s\S]*/i,
  /\n+Actually the instruction says\b[\s\S]*/i,
  /\n+Third invocation\b[\s\S]*/i,
  /\n+Hmm\. The transcript\b[\s\S]*/i,
  /\n+Let me re-read\b[\s\S]*/i,
  /\n+I'm being invoked again\b[\s\S]*/i,
  /\n+This must be cycle \d+\b[\s\S]*/i,
  /\n+wait, the loop state\b[\s\S]*/i,
]

/** Truncate debate output at the first valid stance JSON footer; strip subprocess meta tails. */
export function sanitizeThinkTankSeatOutput(raw: string, mode: 'debate' | 'final_report'): string {
  let text = raw.trim()
  if (!text) return text

  if (mode === 'debate') {
    STANCE_FOOTER_RE.lastIndex = 0
    let last: RegExpExecArray | null = null
    let m: RegExpExecArray | null
    while ((m = STANCE_FOOTER_RE.exec(text)) !== null) last = m
    if (last) text = text.slice(0, last.index + last[0].length).trim()
  }

  for (const re of META_TAIL_RES) {
    text = text.replace(re, '').trim()
  }
  text = text.replace(/<details>\s*<summary>\s*Reasoning trace[\s\S]*?<\/details>\s*/gi, '').trim()
  text = text.replace(/```thinking[\s\S]*?```/gi, '').trim()
  text = text.replace(/\n+`\s*$/g, '').trim()
  return text
}

/** Debate turn or report body that is meta/refusal instead of substantive argument. */
export function isThinkTankFragmentBody(body: string): boolean {
  const stripped = parseDebateTurn(body).body.trim()
  if (!stripped) return true
  if (stripped.length >= 500 && /##\s*(Thesis|Evidence|Observation|BOTTOM LINE|CRUX)/i.test(stripped)) return false

  const lower = stripped.toLowerCase()
  const fragmentPatterns = [
    /^holding\.?\b/i,
    /^stray token/i,
    /^fragment/i,
    /stray (token|fragment)/i,
    /explicitly named in my instructions/i,
    /not a think tank instruction or operator message/i,
    /no new output\.?$/im,
    /all required markdown sections were present/i,
    /already done:\s*thesis,\s*evidence/i,
    /follow the required markdown sections/i,
    /^here is the finalreport with only the required sections/i,
  ]
  if (fragmentPatterns.some((re) => re.test(stripped))) return true

  if (stripped.length < 220 && /^(holding|stray|fragment|no new)/i.test(stripped)) return true
  return false
}

export type FinalReportValidation = {
  ok: boolean
  reason: string
}

export type FinalReportVariant = 'debater' | 'moderator'

export function detectFinalReportVariant(body: string): FinalReportVariant {
  if (
    /##\s*WHAT WE FOUND/i.test(body) ||
    /##\s*GAPS\s*&\s*MORE WORK/i.test(body) ||
    /##\s*NEITHER CHECK/i.test(body)
  ) {
    return 'moderator'
  }
  return 'debater'
}

/** Reject meta checklist output and missing required sections. */
export function validateFinalReportBody(
  body: string,
  variant?: FinalReportVariant,
): FinalReportValidation {
  const text = body.trim()
  if (!text) return { ok: false, reason: 'empty_body' }
  if (isThinkTankFragmentBody(text)) return { ok: false, reason: 'fragment_or_refusal' }

  const role = variant ?? detectFinalReportVariant(text)

  const metaOnly =
    /all required markdown sections were present/i.test(text) ||
    /already done:.*thesis.*evidence/i.test(text) ||
    /plus the required json stance footer/i.test(text)
  if (metaOnly && text.length < 900) return { ok: false, reason: 'meta_format_checklist' }

  if (role === 'moderator') {
    if (!/##\s*BOTTOM LINE/i.test(text)) return { ok: false, reason: 'missing_bottom_line_heading' }
    if (!/##\s*WHAT WE FOUND/i.test(text)) return { ok: false, reason: 'missing_what_we_found_heading' }
    if (!/##\s*WHAT TO DO NOW/i.test(text)) return { ok: false, reason: 'missing_what_to_do_now_heading' }
    if (!/##\s*GAPS\s*&\s*MORE WORK/i.test(text)) return { ok: false, reason: 'missing_gaps_heading' }
    if (!/##\s*CONFIDENCE/i.test(text)) return { ok: false, reason: 'missing_confidence_heading' }
    const bottomLineBlock = text.match(/##\s*BOTTOM LINE\b([\s\S]*?)(?=##\s|$)/i)?.[1]?.trim() ?? ''
    if (bottomLineBlock.length < 15) return { ok: false, reason: 'bottom_line_section_too_short' }
    return { ok: true, reason: 'ok' }
  }

  const hasLead = /##\s*(BOTTOM LINE|Thesis)\b/i.test(text)
  if (!hasLead) return { ok: false, reason: 'missing_bottom_line_heading' }
  if (!/##\s*(SUPPORTING FACTS|Evidence)\b/i.test(text)) {
    return { ok: false, reason: 'missing_supporting_facts_heading' }
  }

  const leadBlock =
    text.match(/##\s*(BOTTOM LINE|Thesis)\b([\s\S]*?)(?=##\s|$)/i)?.[2]?.trim() ?? ''
  if (leadBlock.length < 15) return { ok: false, reason: 'bottom_line_section_too_short' }

  return { ok: true, reason: 'ok' }
}

/** Moderator research turns must include KEY FINDING / EVIDENCE CHECK structure — not a one-line status ping. */
export function validateModeratorDebateTurn(body: string): FinalReportValidation {
  const text = body.trim()
  if (!text) return { ok: false, reason: 'empty_body' }
  if (isThinkTankFragmentBody(text)) return { ok: false, reason: 'fragment_or_refusal' }
  if (!/##\s*KEY FINDING/i.test(text)) return { ok: false, reason: 'missing_key_finding_heading' }
  if (!/##\s*EVIDENCE CHECK/i.test(text)) return { ok: false, reason: 'missing_evidence_check_heading' }
  if (text.length < 400) return { ok: false, reason: 'moderator_turn_too_short' }
  return { ok: true, reason: 'ok' }
}

export type ThinkTankSeatDebug = {
  mode: 'debate' | 'final_report'
  userMessage: string
  attempt: number
  maxAttempts: number
  assistantMessageCount: number
  pickedFrom: 'early_exit' | 'best_score' | 'last_message' | 'empty'
  bodyChars: number
  fragmentDetected: boolean
  reportValidation?: FinalReportValidation
  retryReason?: string
}
