export type ThinkTankTopicInput = {
  topic?: unknown
  context?: unknown
}

/** Merge operator chat context (attachments, links, prior turns) with the think tank question. */
export function resolveThinkTankTopic(input: ThinkTankTopicInput): string {
  const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
  const context = typeof input.context === 'string' ? input.context.trim() : ''

  if (!topic && !context) {
    throw new Error('Think tank topic is required (topic and/or context)')
  }

  if (topic && context) {
    return (
      `${context}\n\n` +
      `---\n\n` +
      `Think tank debate question:\n${topic}`
    )
  }

  return topic || context
}

const DEBATE_QUESTION_MARKER = '\n\n---\n\nThink tank debate question:\n'

const LEGACY_DEBATE_QUESTION_MARKER = '\n\n---\n\nCouncil debate question:\n'

export function splitThinkTankTopic(full: string): { context?: string; question: string } {
  const t = full.trim()
  const idx = t.indexOf(DEBATE_QUESTION_MARKER)
  if (idx >= 0) {
    const context = t.slice(0, idx).trim()
    const question = t.slice(idx + DEBATE_QUESTION_MARKER.length).trim()
    return { context: context || undefined, question: question || t }
  }
  const legacyIdx = t.indexOf(LEGACY_DEBATE_QUESTION_MARKER)
  if (legacyIdx >= 0) {
    const context = t.slice(0, legacyIdx).trim()
    const question = t.slice(legacyIdx + LEGACY_DEBATE_QUESTION_MARKER.length).trim()
    return { context: context || undefined, question: question || t }
  }
  const inlineIdx = t.indexOf('Think tank debate question:')
  if (inlineIdx >= 0) {
    let context = t.slice(0, inlineIdx).trim().replace(/\n---\s*$/, '').trim()
    const question = t.slice(inlineIdx + 'Think tank debate question:'.length).trim()
    return { context: context || undefined, question: question || t }
  }
  const legacyInlineIdx = t.indexOf('Council debate question:')
  if (legacyInlineIdx >= 0) {
    let context = t.slice(0, legacyInlineIdx).trim().replace(/\n---\s*$/, '').trim()
    const question = t.slice(legacyInlineIdx + 'Council debate question:'.length).trim()
    return { context: context || undefined, question: question || t }
  }
  return { question: t }
}

export function thinkTankTopicTitle(full: string): string {
  const { question } = splitThinkTankTopic(full)
  return question.length > 200 ? `${question.slice(0, 197)}…` : question
}

export function assertThinkTankTopicUsable(text: string): void {
  const t = text.trim()
  if (/^topic\s*:\s*$/i.test(t)) {
    throw new Error('Think tank topic is empty — primary agent must pass the operator question in topic or context')
  }
  if (t.length < 12) {
    throw new Error('Think tank topic too short — include the full operator question in topic or context')
  }
}

export type ThinkTankCriticalGap = {
  code: 'referenced_file' | 'referenced_url' | 'structured_evidence'
  message: string
}

/** Abort launch when topic references evidence the primary agent did not stage in context. */
export function findThinkTankCriticalGaps(input: ThinkTankTopicInput): ThinkTankCriticalGap[] {
  const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
  const context = typeof input.context === 'string' ? input.context.trim() : ''
  const gaps: ThinkTankCriticalGap[] = []

  const mentionsFile =
    /\b(?:file|path|attached|attachment|excerpt|\.md\b|\.pdf\b|\.xlsx\b|\.csv\b|\.json\b|\.docx\b|\.ts\b|\.py\b)/i.test(
      topic,
    )
  const hasFileStaging =
    /\[file:|excerpt:|## attachments|read_file|attachments/i.test(context) || context.length >= 400
  if (mentionsFile && !hasFileStaging) {
    gaps.push({
      code: 'referenced_file',
      message:
        'Topic references files/attachments but context lacks [file:] excerpts or attachment summaries. `read` first, then package context.',
    })
  }

  const urlInTopic = /https?:\/\/[^\s)>]+|www\.[^\s)>]+/i.test(topic)
  const hasUrlStaging = /\[url:|fetched summary|sylo_web_fetch|sylo_web_search/i.test(context)
  if (urlInTopic && !hasUrlStaging) {
    gaps.push({
      code: 'referenced_url',
      message:
        'Topic contains URL(s) but context lacks [url:] fetched summaries. Run sylo_web_fetch (or search) first.',
    })
  }

  const mentionsStructured =
    /\b(spreadsheet|workbook|\.xlsx\b|\.ods\b|schematic|ocr\b|spreadsheet reader)\b/i.test(topic)
  const hasStructuredStaging =
    /read_spreadsheet|ocr_schematic|\[image:|spreadsheet/i.test(context) || context.length >= 600
  if (mentionsStructured && !hasStructuredStaging) {
    gaps.push({
      code: 'structured_evidence',
      message:
        'Topic needs spreadsheet/PDF/image data but context lacks parsed blocks. Parse before launch.',
    })
  }

  return gaps
}

export function assertThinkTankCriticalGaps(input: ThinkTankTopicInput): void {
  const gaps = findThinkTankCriticalGaps(input)
  if (gaps.length === 0) return
  throw new Error(
    `Think tank critical-gap gate failed — gather evidence before sylo_think_tank_run:\n` +
      gaps.map((g) => `- ${g.message}`).join('\n'),
  )
}
