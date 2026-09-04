import React, { useCallback, useEffect, useState } from 'react'
import { cn } from './lib/cn'

const REMOTE_PREFIX = /^(https?:|data:|sylo-file:|mailto:|javascript:)/i

/** True when inline markdown code looks like a filesystem path reference. */
export function looksLikeFilePathReference(text: string): boolean {
  const t = text.trim()
  if (!t || t.length < 4 || t.includes('\n')) return false
  if (REMOTE_PREFIX.test(t)) return false
  if (t.startsWith('file://')) return true
  if (/^[A-Za-z]:[\\/]/.test(t)) return true
  if (t.startsWith('\\\\')) return true
  if (t.startsWith('/') && !t.startsWith('//')) return true
  if (t.startsWith('~/') || t.startsWith('~\\') || t === '~') return true
  if (/^OneDrive[\s\-]/i.test(t) && /[\\/]/.test(t)) return true
  if (!/[\\/]/.test(t)) return false
  if (/\.[a-zA-Z0-9]{1,10}$/.test(t)) return true
  const depth = t.match(/[\\/]/g)?.length ?? 0
  return depth >= 2
}

type Props = {
  rawPath: string
  block?: boolean
  /** Active sidebar workspace — relative paths resolve against its Pi cwd. */
  workspaceId?: string
}

export function ChatMarkdownPath({ rawPath, block, workspaceId }: Props): React.ReactElement {
  const [resolvedPath, setResolvedPath] = useState<string | null | undefined>(undefined)
  const [hint, setHint] = useState<string | null>(null)
  const shell = typeof window !== 'undefined' ? window.sylo?.shell : undefined
  const canvas = typeof window !== 'undefined' ? window.sylo?.canvas : undefined
  const wid = workspaceId?.trim() || undefined

  useEffect(() => {
    let cancelled = false
    if (!shell?.resolveLocalPath) {
      setResolvedPath(null)
      return
    }
    setResolvedPath(undefined)
    void shell.resolveLocalPath(rawPath, wid).then((result) => {
      if (cancelled) return
      setResolvedPath(result.ok ? result.path : null)
    })
    return () => {
      cancelled = true
    }
  }, [rawPath, wid, shell])

  const openFile = useCallback(async () => {
    if (!shell?.openPath || !resolvedPath) return
    setHint(null)
    const err = await shell.openPath(resolvedPath)
    if (err) setHint(err)
  }, [resolvedPath, shell])

  const revealInFolder = useCallback(async () => {
    if (!shell?.showItemInFolder || !resolvedPath) return
    setHint(null)
    const err = await shell.showItemInFolder(resolvedPath)
    if (err) setHint(err)
  }, [resolvedPath, shell])

  // `.md` and `.svg` files can be viewed in the native Canvas panel. The
  // canvas file-read happens in the main process (same path as the agent's
  // `show_canvas` tool), so this just hands the path off.
  const lowerExt = resolvedPath?.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  const canvasKind: 'markdown' | 'svg' | null =
    lowerExt === '.md' ? 'markdown' : lowerExt === '.svg' ? 'svg' : null
  const viewInCanvas = useCallback(async () => {
    if (!canvas?.showFile || !resolvedPath || !canvasKind) return
    setHint(null)
    const r = await canvas.showFile({ kind: canvasKind, filePath: resolvedPath })
    if (!r?.ok) setHint(r?.error ?? 'Could not open in canvas')
  }, [canvas, resolvedPath, canvasKind])

  if (resolvedPath === undefined || resolvedPath === null || !shell) {
    return <code>{rawPath}</code>
  }

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-bg-tertiary/90',
        block ? 'my-1 w-full px-2.5 py-1.5' : 'px-1.5 py-0.5 align-middle',
      )}
      title={hint ?? 'Open file or show in folder'}
    >
      <button
        type="button"
        className={cn(
          'min-w-0 cursor-pointer border-0 bg-transparent p-0 font-mono text-[0.88em] text-accent',
          'truncate text-left underline-offset-2 hover:underline',
        )}
        onClick={() => void openFile()}
      >
        {rawPath}
      </button>
      <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.68rem] text-text-secondary">
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-text-primary"
          onClick={() => void openFile()}
        >
          Open
        </button>
        {canvasKind && canvas?.showFile ?
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-text-primary"
              onClick={() => void viewInCanvas()}
            >
              View
            </button>
          </>
        : null}
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-text-primary"
          onClick={() => void revealInFolder()}
        >
          Folder
        </button>
      </span>
      {hint ?
        <span className="shrink-0 text-[0.65rem] text-[rgb(255_152_152)]" role="status">
          {hint}
        </span>
      : null}
    </span>
  )
}
