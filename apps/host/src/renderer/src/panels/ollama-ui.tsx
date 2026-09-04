import React, { useMemo } from 'react'
import { cn } from '../lib/cn'
import { select } from './ui-classes'

/** User-facing Ollama API origin (must match main process normalizeOllamaOrigin). */
export function normalizeOllamaOriginUi(raw: string): string {
  const t = raw.trim()
  if (!t) return 'http://127.0.0.1:11434'
  if (/^https?:\/\//i.test(t)) return t.replace(/\/$/, '')
  return `http://${t.replace(/^\/*/, '')}`.replace(/\/$/, '')
}

/** Native select of `/api/tags` models (no type-to-filter).
 *
 * Optional `visionTags`: when provided, vision-capable models are annotated
 * with "(vision)" and sorted to the top so the image-fallback picker can list
 * every model immediately (fast `/api/tags`) while still surfacing which ones
 * can actually see images once the slower `/api/show` probe completes. */
export function OllamaModelSelect({
  modelId,
  setModelId,
  ollamaTags,
  emptyOptionLabel = 'Pi default (no Sylo model id override)',
  id = 'sylo-ollama-model-select',
  className,
  visionTags,
}: {
  modelId: string
  setModelId: (v: string) => void
  ollamaTags: string[]
  emptyOptionLabel?: string
  id?: string
  className?: string
  /** Models confirmed vision-capable via `/api/show`. Annotates + sorts them first. */
  visionTags?: string[]
}): React.ReactElement {
  const visionSet = useMemo(() => new Set(visionTags ?? []), [visionTags])
  const tagsSorted = useMemo(() => {
    const sorted = [...ollamaTags].sort((a, b) => a.localeCompare(b))
    if (!visionTags || visionTags.length === 0) return sorted
    // Vision-capable first (alpha within each group), text-only after.
    return sorted.sort((a, b) => {
      const av = visionSet.has(a) ? 0 : 1
      const bv = visionSet.has(b) ? 0 : 1
      return av - bv
    })
  }, [ollamaTags, visionTags, visionSet])
  const annotate = !!visionTags && visionTags.length > 0
  const unlisted = modelId.trim() !== '' && !ollamaTags.includes(modelId) ? modelId : null

  return (
    <select
      className={className ? cn(select, className) : select}
      id={id}
      value={modelId}
      onChange={(e) => setModelId(e.target.value)}
      aria-label="Ollama model"
    >
      <option value="">{emptyOptionLabel}</option>
      {unlisted !== null ?
        <option value={unlisted}>{unlisted} (not in current /api/tags list)</option>
      : null}
      {tagsSorted.map((name) => (
        <option key={name} value={name}>
          {annotate ? (visionSet.has(name) ? `${name} (vision)` : `${name} (text-only)`) : name}
        </option>
      ))}
    </select>
  )
}
