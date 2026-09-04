/** Persisted in user message text for export/debug; stripped from chat bubble UI. */
export const SYLO_IMAGE_DELIVERY_PREAMBLE =
  'Sylo image delivery (Pi native images channel):'

export type ImageDeliveryEncodedRecord = {
  path: string
  mimeType: string
  encodedBytes: number
  width: number
  height: number
  sourceBytes: number
  reencoded: boolean
}

export type ImageDeliverySkippedRecord = {
  path: string
  reason: string
}

export type ImageDeliverySummary = {
  modelVisionCapable: boolean
  modelInput: ('text' | 'image')[]
  piImagesAttached: number
  encoded: ImageDeliveryEncodedRecord[]
  skipped: ImageDeliverySkippedRecord[]
}

const TEXT_AFTER_ATTACHMENTS_SEP = '\n\n---\n\n'

export function appendImageDeliveryMetadata(
  messageText: string,
  summary: ImageDeliverySummary,
): string {
  if (summary.piImagesAttached === 0 && summary.encoded.length === 0 && summary.skipped.length === 0) {
    return messageText
  }
  const block = `${SYLO_IMAGE_DELIVERY_PREAMBLE}\n${JSON.stringify(summary)}`
  const idxSep = messageText.indexOf(TEXT_AFTER_ATTACHMENTS_SEP)
  if (idxSep !== -1) {
    return `${messageText.slice(0, idxSep)}\n\n${block}${messageText.slice(idxSep)}`
  }
  return `${messageText}\n\n${block}`
}

export function parseImageDeliverySummary(raw: string): ImageDeliverySummary | null {
  const t = raw.trim()
  if (!t) return null
  try {
    const parsed = JSON.parse(t) as ImageDeliverySummary
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray(parsed.modelInput) || !Array.isArray(parsed.encoded)) return null
    return parsed
  } catch {
    return null
  }
}

/** Remove image-delivery block from attachment head or full message; return parsed summary if present. */
export function stripImageDeliveryBlock(text: string): {
  text: string
  delivery: ImageDeliverySummary | null
} {
  const idx = text.indexOf(SYLO_IMAGE_DELIVERY_PREAMBLE)
  if (idx === -1) return { text, delivery: null }
  const before = text.slice(0, idx).trimEnd()
  const afterPreamble = text.slice(idx + SYLO_IMAGE_DELIVERY_PREAMBLE.length).trimStart()
  let jsonLine: string
  let rest: string
  const nl = afterPreamble.indexOf('\n')
  if (nl === -1) {
    jsonLine = afterPreamble
    rest = ''
  } else {
    jsonLine = afterPreamble.slice(0, nl).trim()
    rest = afterPreamble.slice(nl + 1).trimStart()
  }
  const delivery = parseImageDeliverySummary(jsonLine)
  const textOut = rest ? `${before}\n\n${rest}`.trim() : before
  return { text: textOut, delivery }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function formatImageDeliveryForExport(delivery: ImageDeliverySummary): string[] {
  const lines: string[] = ['**Image delivery (Sylo → Pi native channel):**', '']
  lines.push(
    `- **Model vision capable (Pi \`model.input\`):** ${delivery.modelVisionCapable ? 'yes' : 'no'} (\`${JSON.stringify(delivery.modelInput)}\`)`,
  )
  lines.push(`- **Images attached to Pi prompt:** ${delivery.piImagesAttached}`)
  if (delivery.encoded.length > 0) {
    lines.push('', '**Encoded for provider:**', '')
    for (const e of delivery.encoded) {
      const re =
        e.reencoded ? `, re-encoded from ${formatBytes(e.sourceBytes)} source` : ''
      lines.push(
        `- \`${e.path}\` → ${e.mimeType}, ${formatBytes(e.encodedBytes)}, ${e.width}×${e.height}px${re}`,
      )
    }
  }
  if (delivery.skipped.length > 0) {
    lines.push('', '**Skipped (path-only; not sent as pixels):**', '')
    for (const s of delivery.skipped) {
      lines.push(`- \`${s.path || '(empty)'}\` — ${s.reason}`)
    }
  }
  if (!delivery.modelVisionCapable && delivery.encoded.length > 0) {
    lines.push(
      '',
      '> **Note:** Main model is text-only — image paths were delivered only (no pixels sent to Pi). The model should call the `analyze_image` tool to inspect them.',
    )
  }
  return lines
}
