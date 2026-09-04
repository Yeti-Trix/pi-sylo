import React from 'react'

import { cn } from '../lib/cn'
import { chatSegmentKv, chatSegmentKvLabel, chatSegmentPre, mutedText } from '../panels/ui-classes'
import {
  parseToolResultBlocks,
  toolImageSrc,
  toolResultImageGalleryCopy,
  toolResultSummaryLine,
  type ParsedToolResult,
} from './toolResultContent'
import { ToolResultAudioPlayer } from './ToolResultAudioPlayer'

type Props = {
  resultPreview: unknown
  /** When true, only show summary line (collapsed tool header uses this separately). */
  compact?: boolean
  resolveImageUrl?: (path: string) => string | null
  /** When true, omit the image block (caller renders images elsewhere, e.g. after the card). */
  hideImages?: boolean
  /** When true, omit inline audio (caller renders player elsewhere). */
  hideAudios?: boolean
  /** Tool name for source-accurate image disclaimers (e.g. render_schematic_page). */
  toolName?: string
}

function ToolImages({
  images,
  resolveImageUrl,
}: {
  images: ParsedToolResult['images']
  resolveImageUrl?: (path: string) => string | null
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {images.map((img, i) => {
        const src = toolImageSrc(img, resolveImageUrl)
        if (!src) return null
        return (
          <figure
            key={`${(img.localPath ?? img.dataUrl ?? '').slice(0, 48)}-${i}`}
            className="overflow-hidden rounded-lg border border-border bg-bg-primary"
          >
            <figcaption className="border-b border-border px-2.5 py-1.5 text-[0.72rem] text-text-secondary">
              {img.caption}
            </figcaption>
            {img.source === 'web' && img.sourceUrl ?
              <a
                href={img.sourceUrl}
                target="_blank"
                rel="noreferrer"
                title={`Open source: ${img.sourceUrl}`}
              >
                <img
                  src={src}
                  alt={img.caption}
                  className="max-h-[min(420px,50vh)] w-full object-contain bg-black/20"
                  loading="lazy"
                />
              </a>
            : <img
                src={src}
                alt={img.caption}
                className="max-h-[min(420px,50vh)] w-full object-contain bg-black/20"
                loading="lazy"
              />
            }
          </figure>
        )
      })}
    </div>
  )
}

export function ToolResultMedia({
  resultPreview,
  compact,
  resolveImageUrl,
  hideImages,
  hideAudios,
  toolName,
}: Props): React.ReactElement | null {
  const parsedRaw = parseToolResultBlocks(resultPreview)
  const parsed = {
    ...parsedRaw,
    images: hideImages ? [] : parsedRaw.images,
    audios: hideAudios ? [] : parsedRaw.audios,
  }

  if (compact) {
    const line = toolResultSummaryLine(resultPreview)
    return line ? <span className={mutedText}>{line}</span> : null
  }

  if (parsed.images.length === 0 && parsed.audios.length === 0 && parsed.texts.length === 0) {
    return null
  }

  const showTextPreviews = parsed.texts.filter(
    (t) =>
      t.length < 8000 &&
      !t.startsWith('Web search results for') &&
      !/^Speech \(/i.test(t),
  )

  return (
    <div className="flex flex-col gap-3">
      {parsed.audios.length > 0 ?
        <div className={chatSegmentKv}>
          <span className={chatSegmentKvLabel}>audio</span>
          <div className="flex flex-col gap-2">
            {parsed.audios.map((audio, i) => (
              <ToolResultAudioPlayer
                key={`${audio.localPath ?? audio.dataUrl ?? i}`}
                audio={audio}
                resolveFileUrl={resolveImageUrl}
                compact
              />
            ))}
          </div>
        </div>
      : null}
      {parsed.images.length > 0 ?
        <div className={chatSegmentKv}>
          <span className={chatSegmentKvLabel}>images</span>
          <ToolImages images={parsed.images} resolveImageUrl={resolveImageUrl} />
          <p className={cn(mutedText, 'text-[0.72rem]')}>
            {toolResultImageGalleryCopy(parsed.images, toolName).footnote}
            {parsed.images.some((img) => img.source === 'web') ?
              ' The assistant reply below may refer to these — they appear here in the tool result, not above the summary text.'
            : ''}
          </p>
        </div>
      : null}
      {showTextPreviews.length > 0 ?
        <div className={chatSegmentKv}>
          <span className={chatSegmentKvLabel}>result (text)</span>
          {showTextPreviews.map((t, i) => (
            <pre key={i} className={cn(chatSegmentPre, 'max-h-48 overflow-auto')}>
              {t.length > 4000 ? t.slice(0, 4000) + '…' : t}
            </pre>
          ))}
        </div>
      : parsed.texts.length > 0 && parsed.images.length === 0 ?
        <div className={chatSegmentKv}>
          <span className={chatSegmentKvLabel}>result</span>
          <pre className={cn(chatSegmentPre, 'max-h-64 overflow-auto')}>
            {parsed.texts.join('\n\n---\n\n').slice(0, 8000)}
            {parsed.texts.join('\n\n').length > 8000 ? '…' : ''}
          </pre>
        </div>
      : null}
    </div>
  )
}
