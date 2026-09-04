import React, { useState } from 'react'
import { cn } from '../lib/cn'
import { mutedText } from '../panels/ui-classes'
import {
  compactionNoticeBody,
  compactionNoticeTitle,
  compactionTriggerLabel,
  parseCompactionNoticeContent,
  type CompactionNoticePayload,
} from '../../../shared/compaction-notice'

type CompactionNoticeProps = {
  content: string
}

export function CompactionNotice({ content }: CompactionNoticeProps): React.ReactElement {
  const payload = parseCompactionNoticeContent(content)
  if (!payload) {
    return (
      <div className="flex justify-center px-1 py-2">
        <div className="w-full max-w-[92%] rounded-lg border border-border bg-bg-tertiary px-4 py-3 text-[0.84rem] text-text-secondary">
          {content.trim() || 'System notice'}
        </div>
      </div>
    )
  }
  return <CompactionNoticeCard payload={payload} />
}

function CompactionNoticeCard({
  payload,
}: {
  payload: CompactionNoticePayload
}): React.ReactElement {
  const [showSummary, setShowSummary] = useState(false)
  const title = compactionNoticeTitle(payload)
  const body = compactionNoticeBody(payload)
  const trigger = compactionTriggerLabel(payload.reason)
  const hasSummary = Boolean(payload.summary?.trim())

  return (
    <div className="flex justify-center px-1 py-2">
      <div
        className={cn(
          'w-full max-w-[92%] rounded-lg border px-4 py-3 text-[0.84rem] leading-[1.45]',
          'border-[rgb(245_158_11/0.35)] bg-[rgb(245_158_11/0.06)]',
        )}
      >
        <div className="font-medium text-text-primary">{title}</div>
        <p className={cn('mt-1.5', mutedText)}>{body}</p>
        <p className={cn('mt-1.5 text-[0.76rem]', mutedText)}>
          Trigger: {trigger}
        </p>
        {hasSummary ?
          <div className="mt-2">
            <button
              type="button"
              className="text-[0.76rem] text-[rgb(245_158_11)] hover:underline"
              onClick={() => setShowSummary((v) => !v)}
            >
              {showSummary ? 'Hide summary' : 'Show compaction summary'}
            </button>
            {showSummary ?
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-bg-tertiary p-2 font-mono text-[0.72rem] leading-[1.4] text-text-primary">
                {payload.summary}
              </pre>
            : null}
          </div>
        : null}
      </div>
    </div>
  )
}
