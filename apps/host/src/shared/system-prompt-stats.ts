/**
 * System prompt section breakdown for the context-window dashboard.
 * Shared between broker (computes), main (stores), and renderer (displays).
 */

export interface SystemPromptSection {
  /** Short label for the section (e.g. "Base prompt", "Skills", "Global AGENTS.md"). */
  label: string
  /** Character count of this section. */
  chars: number
  /** Rough token estimate (chars / 4). */
  tokens: number
  /** Percentage of total prompt. */
  pct: number
}

export interface SystemPromptStats {
  totalChars: number
  totalTokens: number
  sections: SystemPromptSection[]
}

/**
 * Parse a Pi system prompt into its logical sections and return per-section
 * char/token/percentage breakdowns.
 *
 * After the patch-package reorder the structure is:
 *   [Base prompt] [Skills] [<project_context> files] [CWD]
 */
export function parseSystemPromptStats(sp: string): SystemPromptStats {
  const totalChars = sp.length
  const totalTokens = Math.ceil(totalChars / 4)

  const sections: { label: string; start: number; end: number }[] = []

  // Base prompt: everything before <available_skills> or <project_context>
  const skillsIdx = sp.indexOf('<available_skills>')
  const ctxIdx = sp.indexOf('<project_context>')
  const baseEnd = skillsIdx >= 0 ? skillsIdx : ctxIdx >= 0 ? ctxIdx : totalChars
  sections.push({ label: 'Base prompt', start: 0, end: baseEnd })

  // Skills section
  if (skillsIdx >= 0) {
    const skillsEnd = sp.indexOf('</available_skills>')
    const skillsEndPos = skillsEnd >= 0 ? skillsEnd + '</available_skills>'.length : ctxIdx >= 0 ? ctxIdx : totalChars
    // Include the trailing pointer line (if present) so the reported section
    // reflects the actual prompt length.
    const pointerEnd = sp.indexOf('\n', skillsEndPos + 1)
    const endWithPointer =
      pointerEnd >= 0 && sp.slice(skillsEndPos, pointerEnd).trim() !== '' ? sp.indexOf('\n', pointerEnd + 1) : skillsEndPos
    const end = endWithPointer >= 0 && endWithPointer > skillsEndPos && endWithPointer <= totalChars ? endWithPointer : skillsEndPos
    sections.push({ label: 'Skills', start: skillsIdx, end })
  }

  // Project context files
  if (ctxIdx >= 0) {
    const ctxEnd = sp.indexOf('</project_context>')
    const ctxEndPos = ctxEnd >= 0 ? ctxEnd + '</project_context>'.length : totalChars

    // Split individual context files
    const ctxContent = sp.substring(ctxIdx, ctxEnd >= 0 ? ctxEnd + '</project_context>'.length : totalChars)
    const fileMatches = [...ctxContent.matchAll(/<project_instructions path="([^"]+)">/g)]
    const closeMatches = [...ctxContent.matchAll(/<\/project_instructions>/g)]

    if (fileMatches.length > 0) {
      for (let i = 0; i < fileMatches.length; i++) {
        const m = fileMatches[i]!
        const start = ctxIdx + m.index!
        const closeIdx = closeMatches[i]
        const end = closeIdx ? ctxIdx + closeIdx.index! + '</project_instructions>'.length : ctxEndPos
        // Extract just the filename from the full path
        const rawPath = m[1]!
        const parts = rawPath.replace(/\\/g, '/').split('/')
        const label = parts.length > 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : parts[parts.length - 1] ?? rawPath
        sections.push({ label, start, end: Math.min(end, ctxEndPos) })
      }
    } else {
      sections.push({ label: 'Project context', start: ctxIdx, end: ctxEndPos })
    }
  }

  // CWD line
  const cwdIdx = sp.lastIndexOf('Current working directory:')
  if (cwdIdx >= 0) {
    sections.push({ label: 'CWD', start: cwdIdx, end: totalChars })
  }

  // Build result with percentages
  const result: SystemPromptSection[] = sections
    .filter((s) => s.end > s.start)
    .map((s) => {
      const chars = s.end - s.start
      return {
        label: s.label,
        chars,
        tokens: Math.ceil(chars / 4),
        pct: totalChars > 0 ? Math.round((chars / totalChars) * 1000) / 10 : 0,
      }
    })

  return {
    totalChars,
    totalTokens,
    sections: result,
  }
}