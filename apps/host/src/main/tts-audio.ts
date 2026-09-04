/**
 * Persist tool-result audio to disk for sylo-file playback; delete with conversation.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import { ttsConfigDir } from './tts-config.js'

/** Sidebar Speech route clips older than this are removed on startup. */
export const TTS_ROUTE_CLIP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const EXT_BY_MIME: Record<string, string> = {
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
}

export function ttsAudioRoot(userDataPath: string): string {
  return join(userDataPath, 'sylo-tts-audio')
}

/** WAV clips generated from the Speech sidebar route (not chat tool results). */
export function ttsRouteClipsDir(userDataPath: string): string {
  return join(ttsConfigDir(userDataPath), 'route-clips')
}

function isPathUnderRoot(filePath: string, root: string): boolean {
  const absFile = resolve(filePath)
  const absRoot = resolve(root)
  const rel = relative(absRoot, absFile)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

export function deleteTtsRouteClip(
  userDataPath: string,
  wavPath: string,
): { ok: true } | { ok: false; error: string } {
  const trimmed = wavPath.trim()
  if (!trimmed) return { ok: false, error: 'empty_path' }
  const root = ttsRouteClipsDir(userDataPath)
  if (!isPathUnderRoot(trimmed, root)) return { ok: false, error: 'path_not_allowed' }
  try {
    if (existsSync(trimmed)) unlinkSync(trimmed)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Startup age GC for Speech sidebar clips (not tied to chat delete). */
export function pruneStaleTtsRouteClips(
  userDataPath: string,
  maxAgeMs: number = TTS_ROUTE_CLIP_MAX_AGE_MS,
): number {
  const root = ttsRouteClipsDir(userDataPath)
  if (!existsSync(root)) return 0
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return 0
  }
  for (const name of entries) {
    const full = join(root, name)
    try {
      const st = statSync(full)
      if (!st.isFile()) continue
      if (st.mtimeMs >= cutoff) continue
      unlinkSync(full)
      removed += 1
    } catch {
      /* skip */
    }
  }
  return removed
}

function conversationAudioDir(userDataPath: string, conversationId: string): string {
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(ttsAudioRoot(userDataPath), safe)
}

function isAudioBlock(b: unknown): b is { type: 'audio'; data: string; mimeType?: string } {
  if (!b || typeof b !== 'object') return false
  const r = b as Record<string, unknown>
  if (r.type !== 'audio') return false
  if (typeof r._localPath === 'string' && r._localPath.length > 0) return true
  return typeof r.data === 'string' && r.data.length > 0
}

/** Max decoded bytes per audio clip in tool results. */
export const MAX_TOOL_AUDIO_BYTES = 25 * 1024 * 1024

/**
 * Walk a persisted tool event, write audio blocks to disk, replace `data` with `_localPath`.
 */
export function persistToolResultAudio(
  userDataPath: string,
  conversationId: string,
  event: unknown,
): unknown {
  if (!event || typeof event !== 'object') return event
  const ev = event as Record<string, unknown>
  if (ev.type !== 'tool_execution_end') return event

  const result = ev.resultSummary
  if (!result || typeof result !== 'object') return event
  const resultObj = result as Record<string, unknown>
  const content = resultObj.content
  if (!Array.isArray(content)) return event

  let wroteAny = false
  let dir = ''
  const newContent = content.map((block) => {
    if (!isAudioBlock(block)) return block
    if (typeof (block as Record<string, unknown>)._localPath === 'string') {
      wroteAny = true
      return block
    }
    const dataField = (block as { data?: string }).data
    if (!dataField) return block
    const raw = dataField.replace(/\s/g, '')
    let buf: Buffer
    try {
      buf = Buffer.from(raw, 'base64')
    } catch {
      return block
    }
    if (buf.length < 64 || buf.length > MAX_TOOL_AUDIO_BYTES) return block

    const mime = ((block as { mimeType?: string }).mimeType ?? 'audio/wav').toLowerCase()
    const ext = EXT_BY_MIME[mime] ?? '.wav'
    const hash = createHash('sha1').update(buf).digest('hex').slice(0, 16)
    if (!dir) {
      dir = conversationAudioDir(userDataPath, conversationId)
      mkdirSync(dir, { recursive: true })
    }
    const filePath = join(dir, `${hash}${ext}`)
    try {
      if (!existsSync(filePath)) writeFileSync(filePath, buf)
      wroteAny = true
      return { type: 'audio', mimeType: mime, _localPath: filePath }
    } catch {
      return block
    }
  })

  if (!wroteAny) return event
  return {
    ...ev,
    resultSummary: { ...resultObj, content: newContent },
  }
}

export function deleteTtsAudioForConversation(userDataPath: string, conversationId: string): void {
  const dir = conversationAudioDir(userDataPath, conversationId)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
