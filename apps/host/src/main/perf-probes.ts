/**
 * Developer → Testing perf probes (2026-10-11 freeze report follow-up).
 *
 * Read-only/synthetic diagnostics the operator can run from the Testing tab to
 * pinpoint which stage makes chat switching or attachment sends feel frozen on
 * a slow machine:
 *
 *  - `perf:probeConversationLoad` — for the N conversations with the heaviest
 *    timelines, times `db.listMessages` (better-sqlite3 read on the main
 *    process) and the payload that `messages:list` ships over IPC. A big number
 *    here IS the chat-switch freeze.
 *  - `perf:probeImageEncode` — generates a synthetic oversized screenshot in a
 *    temp file, then times the exact `encodeImageAttachmentsForPi` pipeline
 *    (read → nativeImage decode → resize → JPEG re-encode → base64) the send
 *    path runs synchronously in main. A big number here IS the
 *    paste/press-Enter freeze.
 *
 * No production data leaves the machine: the probe output is a small stats
 * struct, and the synthetic image is deleted afterwards.
 */

import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeImage } from 'electron'

import { conversationWeightStats, listMessages } from './database.js'
import { encodeImageAttachmentsForPi } from './image-attachments.js'
import { perfMark, perfNote } from './perf-log.js'

export type ConversationLoadProbeRow = {
  conversationId: string
  title: string
  rows: number
  payloadKb: number
  /** Actual `db.listMessages` read time for this conversation (measured only
   *  for the heaviest few — the read a chat switch performs synchronously). */
  dbMs?: number
  biggestRowKb: number
}

export type ConversationLoadProbeResult =
  | { ok: true; rows: ConversationLoadProbeRow[]; totalMs: number }
  | { ok: false; error: string }

const PROBE_LIMIT = 10
/** How many of the heaviest conversations get a REAL listMessages timing. */
const REAL_READ_ROWS = 3

export async function probeConversationLoad(limit = PROBE_LIMIT): Promise<ConversationLoadProbeResult> {
  try {
    const aggT0 = performance.now()
    const stats = conversationWeightStats(limit)
    const out: ConversationLoadProbeRow[] = stats.map((s) => ({
      conversationId: s.id,
      title: (s.title || '(untitled)').slice(0, 60),
      rows: s.row_count,
      payloadKb: Math.round(s.payload_chars / 1024),
      biggestRowKb: Math.round(s.biggest_chars / 1024),
    }))
    // Real switch cost = the listMessages read on focus. Measure it for the top
    // few (heavy) ones only — the probe must not itself freeze for long.
    for (const r of out.slice(0, REAL_READ_ROWS)) {
      const perT0 = performance.now()
      listMessages(r.conversationId)
      r.dbMs = Math.round((performance.now() - perT0) * 10) / 10
    }
    const totalMs = Math.round(performance.now() - aggT0)
    const heaviest = out[0]
    if (heaviest) {
      perfMark(
        'probe.chatLoad',
        `heaviest conv (by payload): ${heaviest.rows} rows / ${heaviest.payloadKb}KB` +
          (heaviest.dbMs != null ? ` / ${heaviest.dbMs}ms listMessages read` : ''),
        totalMs,
      )
    } else {
      perfNote('probe.chatLoad', 'no conversations with messages found')
    }
    return { ok: true, rows: out, totalMs }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type ImageEncodeProbeResult =
  | {
      ok: true
      syntheticImage: { width: number; height: number; sourceKb: number }
      readDecodeMs: number
      resizeJpegMs: number
      base64Ms: number
      totalMs: number
      encodedKb: number
      reencoded: boolean
    }
  | { ok: false; error: string }

/**
 * Render a synthetic noisy PNG at `width`×`height` (default 2500×1400 — a big
 * window screenshot), save it, then push it through the same sync encode
 * pipeline the send path uses. Noise matters: a flat-color image compresses and
 * re-encodes unrealistically fast.
 */
export async function probeImageEncode(width = 2500, height = 1400): Promise<ImageEncodeProbeResult> {
  const canvas = Buffer.alloc(width * height * 4)
  let seed = 0x2f5a3b1
  for (let i = 0; i < canvas.length; i += 4) {
    // XORSH-ish quick noise — enough variation that JPEG has real work.
    seed = (seed * 1664525 + 1013904223) >>> 0
    canvas[i] = seed & 0xff
    canvas[i + 1] = (seed >> 8) & 0xff
    canvas[i + 2] = (seed >> 16) & 0xff
    canvas[i + 3] = 0xff
  }
  const img = nativeImage.createFromBuffer(canvas, { width, height })
  if (img.isEmpty()) return { ok: false, error: 'synthetic nativeImage was empty' }

  const filePath = join(tmpdir(), `sylo-encode-probe-${Date.now()}.png`)
  try {
    await writeFile(filePath, img.toPNG())
    const t0 = performance.now()
    const result = encodeImageAttachmentsForPi([{ path: filePath, name: 'probe.png' }])
    const totalMs = performance.now() - t0
    const delivered = result.delivered[0]
    const skipped = result.skipped[0]
    const phases = result.phases[0]
    if (skipped && !delivered) {
      perfNote('probe.imageEncode', `skipped: ${skipped.reason}`)
      return { ok: false, error: `encode skipped: ${skipped.reason}` }
    }
    if (!delivered || !phases) return { ok: false, error: 'encode produced no record' }
    const out: ImageEncodeProbeResult = {
      ok: true,
      syntheticImage: {
        width,
        height,
        sourceKb: Math.round((width * height * 4) / 1024 / 2.2), // PNG on-disk estimate
      },
      readDecodeMs: phases.readDecodeMs,
      resizeJpegMs: phases.resizeJpegMs,
      base64Ms: phases.base64Ms,
      totalMs: Math.round(totalMs),
      encodedKb: Math.round(delivered.encodedBytes / 1024),
      reencoded: delivered.reencoded,
    }
    perfMark(
      'probe.imageEncode',
      `${dimensions(out)} — read+decode ${out.readDecodeMs}ms, resize+jpeg ${out.resizeJpegMs}ms, base64 ${out.base64Ms}ms → ${out.encodedKb}KB`,
      totalMs,
    )
    return out
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    void unlink(filePath).catch(() => {})
  }
}

function dimensions(r: Extract<ImageEncodeProbeResult, { ok: true }>): string {
  return `${r.syntheticImage.width}×${r.syntheticImage.height}`
}