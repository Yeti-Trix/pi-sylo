/**
 * Inline audio player for TTS tool results (play/pause, volume, seek, download).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '../lib/cn'
import { toolAudioSrc, type ToolResultAudio } from './toolResultContent'

type Props = {
  audio: ToolResultAudio
  resolveFileUrl?: (path: string) => string | null
  compact?: boolean
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function ToolResultAudioPlayer({
  audio,
  resolveFileUrl,
  compact,
}: Props): React.ReactElement | null {
  const ref = useRef<HTMLAudioElement>(null)
  const src = toolAudioSrc(audio, resolveFileUrl)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.volume = volume
  }, [volume, src])

  const togglePlay = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }, [])

  const downloadName = (audio.label || 'speech').replace(/[^\w.-]+/g, '_').slice(0, 48) + '.wav'

  const saveAudio = useCallback(async () => {
    const sourcePath = audio.localPath ?? src
    if (!sourcePath) return
    const r = await window.sylo.files.saveCopyAs({
      sourcePath,
      suggestedName: downloadName,
    })
    if (!r.ok && !r.cancelled && r.error) {
      console.error('save audio failed:', r.error)
    }
  }, [audio.localPath, downloadName, src])

  if (!src) return null

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-bg-primary p-3',
        compact ? 'max-w-md' : 'max-w-lg',
      )}
    >
      {audio.label ?
        <span className="text-xs text-text-secondary">{audio.label}</span>
      : null}
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrent(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(ref.current?.duration ?? 0)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border bg-bg-secondary px-3 py-1 text-sm hover:bg-bg-tertiary"
          onClick={togglePlay}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="rounded-md border border-border bg-bg-secondary px-3 py-1 text-sm hover:bg-bg-tertiary"
          onClick={() => void saveAudio()}
        >
          Download
        </button>
        <span className="ml-auto text-xs tabular-nums text-text-secondary">
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        <span>Seek</span>
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.05}
          value={Math.min(current, duration || 0)}
          onChange={(e) => {
            const t = Number(e.target.value)
            if (ref.current) ref.current.currentTime = t
            setCurrent(t)
          }}
          className="w-full"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-full"
        />
      </label>
    </div>
  )
}

export function AssistantAudioGallery({
  audios,
  resolveFileUrl,
}: {
  audios: ToolResultAudio[]
  resolveFileUrl?: (path: string) => string | null
}): React.ReactElement | null {
  const resolved = audios.filter((a) => toolAudioSrc(a, resolveFileUrl))
  if (resolved.length === 0) return null
  return (
    <div className="my-2 flex flex-col gap-2">
      <span className="text-[0.7rem] uppercase tracking-wide text-text-secondary">Speech</span>
      {resolved.map((audio, i) => (
        <ToolResultAudioPlayer
          key={`${audio.localPath ?? audio.dataUrl ?? i}`}
          audio={audio}
          resolveFileUrl={resolveFileUrl}
        />
      ))}
    </div>
  )
}
