import React, { useMemo, useState } from 'react'
import { mutedText } from '../../panels/ui-classes'
import { cn } from '../../lib/cn'
import type { DiffTabPayload } from './canvasTypes'

/**
 * Body of a canvas 'diff' app-pane tab (task 07): READ-ONLY per-file unified
 * diffs for one assistant turn (pre-image from the checkpoint snapshot vs
 * current disk). A file switcher lists modified/added/deleted with status
 * glyphs; skipped files (size/binary) render placeholder sections, never
 * crash. This pane never writes files — Undo/restore stay on the chat actions.
 */

const STATUS_GLYPH: Record<'modified' | 'added' | 'deleted', string> = {
  modified: 'M',
  added: '+',
  deleted: '−',
}

const STATUS_COLOR: Record<'modified' | 'added' | 'deleted', string> = {
  modified: 'text-[#e2c08d]',
  added: 'text-[#9ece6a]',
  deleted: 'text-[#f6b3a4]',
}

function DiffLine({ line }: { line: string }): React.ReactElement {
  if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
    return <div className="text-text-secondary">{line}</div>
  }
  if (line.startsWith('+')) {
    return <div className="bg-[rgb(158_206_106/0.12)] text-[#9ece6a]">{line}</div>
  }
  if (line.startsWith('-')) {
    return <div className="bg-[rgb(246_179_164/0.10)] text-[#f6b3a4]">{line}</div>
  }
  return <div className="text-text-secondary">{line}</div>
}

export function DiffPane({ payload, className }: { payload?: DiffTabPayload; className?: string }): React.ReactElement {
  const files = payload?.files ?? []
  const [sel, setSel] = useState(0)
  const idx = Math.min(sel, Math.max(0, files.length - 1))
  const current = files[idx]
  const counts = useMemo(
    () => ({
      modified: files.filter((f) => f.status === 'modified').length,
      added: files.filter((f) => f.status === 'added').length,
      deleted: files.filter((f) => f.status === 'deleted').length,
    }),
    [files],
  )

  if (!payload || files.length === 0) {
    return (
      <div className={cn('flex min-h-0 min-w-0 flex-1 items-start overflow-auto p-4', className)}>
        <p className={cn(mutedText, 'text-[0.8rem]')}>No file changes recorded for this turn.</p>
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-row', className)}>
      {/* File switcher (left rail) */}
      <div className="flex min-w-[150px] max-w-[230px] shrink-0 flex-col overflow-auto border-r border-border py-1">
        <div className={cn(mutedText, 'px-2 pb-1 text-[0.66rem] uppercase tracking-wide')}>
          {counts.modified} modified · {counts.added} added · {counts.deleted} deleted
        </div>
        {files.map((f, i) => (
          <button
            key={`${f.rel}:${i}`}
            type="button"
            className={cn(
              'flex cursor-pointer items-start gap-1.5 border-none bg-transparent px-2 py-1 text-left text-[0.72rem] leading-tight text-text-secondary',
              i === idx ? 'bg-[#2e2e2e] text-text-primary' : 'hover:bg-[#1e1e1e] hover:text-text-primary',
            )}
            onClick={() => setSel(i)}
            title={`${f.rel}\n${f.status}${f.skipped ? ` (diff skipped: ${f.skipped})` : ''}`}
          >
            <span className={cn('font-mono', STATUS_COLOR[f.status])}>{STATUS_GLYPH[f.status]}</span>
            <span className="min-w-0 break-all">{f.rel}</span>
          </button>
        ))}
      </div>
      {/* Diff body (right) */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
        {current.skipped || !current.diff ?
          <p className={cn(mutedText, 'text-[0.78rem]')}>
            {current.rel} — not shown
            {current.skipped === 'binary' ? ' (binary file)' : current.skipped === 'size' ? ' (too large to diff)' : ''}
          </p>
        : (
          <pre className="m-0 whitespace-pre text-[0.72rem] leading-[1.45] font-mono">
            {current.diff.split('\n').map((line, i) => <DiffLine key={i} line={line} />)}
          </pre>
        )}
      </div>
    </div>
  )
}