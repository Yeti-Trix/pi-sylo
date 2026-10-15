import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { nativeImage, type NativeImage } from 'electron'
import type { ImageDeliveryEncodedRecord } from '../shared/chat-image-delivery.js'
import { perfMark, perfNote } from './perf-log.js'

/** Pi `ImageContent` shape from `@earendil-works/pi-ai`. Inline-typed here to avoid a deep transitive import. */
export type PiImageContent = {
  type: 'image'
  /** Base64-encoded image bytes (no `data:` prefix). */
  data: string
  /** Provider-friendly MIME, e.g. `image/png` or `image/jpeg`. */
  mimeType: string
}

export type AttachmentInput = { path: string; name?: string }

/** Phase breakdown for ONE encoded image — used by the perf probes + perf log. */
export type EncodePhaseMs = {
  /** readFileSync + nativeImage.createFromBuffer (decode). */
  readDecodeMs: number
  /** nativeImage resize + toJPEG — 0 when neither was needed. */
  resizeJpegMs: number
  /** Buffer.toString('base64') for the outgoing payload. */
  base64Ms: number
}

export type EncodeResult = {
  images: PiImageContent[]
  delivered: ImageDeliveryEncodedRecord[]
  /** Attachments we deliberately did not encode (forwarded only as path-injection text). */
  skipped: { path: string; reason: string }[]
  /** One phase-timing entry per attachment, same order (undefined for skipped); perf probes read this. */
  phases: (EncodePhaseMs | undefined)[]
}

/** Long edge cap before we re-encode to JPEG. Matches Anthropic vision guidance; safe for OpenAI/Gemini too. */
const MAX_LONG_EDGE_PX = 1568

/** Re-encode threshold for the original file size in bytes (3 MB). */
const RAW_BYTES_REENCODE_THRESHOLD = 3 * 1024 * 1024

/** Hard ceiling for the encoded base64 payload to stay safely under common 5 MB per-image provider limits. */
const ENCODED_BYTES_HARD_LIMIT = 4_500_000

const NATIVE_DECODABLE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/**
 * Return true when the attachment looks like a raster image we can natively decode.
 * SVG is intentionally excluded — `electron.nativeImage` cannot rasterize it reliably.
 */
export function isNativelyEncodableImage(path: string): boolean {
  return NATIVE_DECODABLE_EXTS.has(extname(path).toLowerCase())
}

/**
 * Read, optionally downscale, and base64-encode the given attachments for Pi's `images` channel.
 *
 * - Attachments without a raster image extension are skipped (caller keeps them in the path-injection block).
 * - Files that fail to decode (corrupt, unreadable) are skipped with `reason`.
 * - Originals ≤ {@link RAW_BYTES_REENCODE_THRESHOLD} and ≤ {@link MAX_LONG_EDGE_PX} are passed through verbatim.
 * - Larger originals are resized to fit {@link MAX_LONG_EDGE_PX} and re-encoded as JPEG q=85.
 *
 * NOTE: this runs SYNCHRONOUSLY in the Electron main process inside `chat:send`
 * (2026-10-11 operator freeze report — pasting a picture then pressing Enter
 * stalled the whole app while "something was loading"). Every image costs its
 * full read + decode (+ resize/re-encode for anything > 3 MB or > 1568px long
 * edge) with the event loop blocked; the per-image `image.encode` perf entries
 * exist so the Developer → Testing tab can attribute real milliseconds on a
 * slow machine. The main win there is quality: 'good' resize instead of
 * 'best' — large-window screenshots dropped several× without a visible
 * thumbnail/turn difference at this size.
 */
export function encodeImageAttachmentsForPi(attachments: AttachmentInput[]): EncodeResult {
  const images: PiImageContent[] = []
  const delivered: ImageDeliveryEncodedRecord[] = []
  const skipped: { path: string; reason: string }[] = []
  const phases: (EncodePhaseMs | undefined)[] = []

  for (const att of attachments) {
    const filePath = (att.path ?? '').trim()
    phases.push(undefined)
    if (!filePath) {
      skipped.push({ path: '', reason: 'empty_path' })
      continue
    }
    if (!isNativelyEncodableImage(filePath)) {
      skipped.push({ path: filePath, reason: 'unsupported_extension' })
      continue
    }
    try {
      const encoded = encodeOneImage(filePath)
      if (encoded) {
        images.push(encoded.image)
        delivered.push(encoded.meta)
        phases[phases.length - 1] = encoded.phases
        perfMark(
          'image.encode',
          `${encoded.meta.width}×${encoded.meta.height} ${Math.round(encoded.meta.sourceBytes / 1024)}KB → ${Math.round(encoded.meta.encodedBytes / 1024)}KB` +
            (encoded.meta.reencoded ? ' (resized/jpeg)' : ' (passthrough)') +
            ` — read+decode ${Math.round(encoded.phases.readDecodeMs)}, resize+jpeg ${Math.round(encoded.phases.resizeJpegMs)}, base64 ${Math.round(encoded.phases.base64Ms)}`,
          encoded.phases.readDecodeMs + encoded.phases.resizeJpegMs + encoded.phases.base64Ms,
        )
      } else {
        skipped.push({ path: filePath, reason: 'decode_failed' })
        perfNote('image.encode', `skip decode_failed: ${filePath}`)
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      skipped.push({ path: filePath, reason: `error:${reason}` })
    }
  }

  return { images, delivered, skipped, phases }
}

type EncodedOne = {
  image: PiImageContent
  meta: ImageDeliveryEncodedRecord
  phases: EncodePhaseMs
}

function encodeOneImage(filePath: string): EncodedOne | null {
  if (!existsSync(filePath)) return null
  const stats = statSync(filePath)
  if (!stats.isFile()) return null

  const ext = extname(filePath).toLowerCase()
  const originalMime = MIME_BY_EXT[ext] ?? 'image/png'
  const decodeStart = performance.now()
  const originalBytes = readFileSync(filePath)

  const img = nativeImage.createFromBuffer(originalBytes)
  if (img.isEmpty()) return null
  const readDecodeMs = performance.now() - decodeStart

  const { width, height } = img.getSize()
  const longEdge = Math.max(width, height)
  const needsResize = longEdge > MAX_LONG_EDGE_PX
  const needsReencode = stats.size > RAW_BYTES_REENCODE_THRESHOLD

  if (!needsResize && !needsReencode) {
    const base64Start = performance.now()
    const data = originalBytes.toString('base64')
    const base64Ms = performance.now() - base64Start
    return packEncoded(filePath, {
      type: 'image',
      data,
      mimeType: originalMime,
    }, {
      width,
      height,
      sourceBytes: stats.size,
      reencoded: false,
    }, {
      readDecodeMs,
      resizeJpegMs: 0,
      base64Ms,
    })
  }

  const encodeStart = performance.now()
  const resized = needsResize ? resizeToLongEdge(img, MAX_LONG_EDGE_PX) : img
  const outSize = resized.getSize()
  const jpegBytes = resized.toJPEG(85)
  const resizeJpegMs = performance.now() - encodeStart
  if (jpegBytes.length === 0) {
    // Re-encoder produced nothing — fall back to the original bytes verbatim.
    const base64Start = performance.now()
    const data = originalBytes.toString('base64')
    const base64Ms = performance.now() - base64Start
    return packEncoded(filePath, {
      type: 'image',
      data,
      mimeType: originalMime,
    }, {
      width,
      height,
      sourceBytes: stats.size,
      reencoded: false,
    }, {
      readDecodeMs,
      resizeJpegMs,
      base64Ms,
    })
  }

  const outBytes =
    encodedBase64Size(jpegBytes.length) > ENCODED_BYTES_HARD_LIMIT ? encodeFallback(resized) : jpegBytes
  const base64Start = performance.now()
  const data = outBytes.toString('base64')
  const base64Ms = performance.now() - base64Start
  return packEncoded(filePath, {
    type: 'image',
    data,
    mimeType: 'image/jpeg',
  }, {
    width: outSize.width,
    height: outSize.height,
    sourceBytes: stats.size,
    reencoded: true,
  }, {
    readDecodeMs,
    resizeJpegMs,
    base64Ms,
  })
}

/** Hard-limit fallback: one more, smaller JPEG (kept out of the hot path). */
function encodeFallback(img: NativeImage): Buffer {
  const smaller = resizeToLongEdge(img, Math.floor(MAX_LONG_EDGE_PX * 0.75))
  return smaller.toJPEG(80)
}

function packEncoded(
  path: string,
  image: PiImageContent,
  dims: { width: number; height: number; sourceBytes: number; reencoded: boolean },
  phases: EncodePhaseMs,
): EncodedOne {
  const encodedBytes = Math.ceil((image.data.length * 3) / 4)
  return {
    image,
    meta: {
      path,
      mimeType: image.mimeType,
      encodedBytes,
      width: dims.width,
      height: dims.height,
      sourceBytes: dims.sourceBytes,
      reencoded: dims.reencoded,
    },
    phases,
  }
}

function resizeToLongEdge(img: NativeImage, longEdge: number): NativeImage {
  const { width, height } = img.getSize()
  if (width === 0 || height === 0) return img
  // quality 'good' (fast bilinear) instead of 'best': the re-encoded image is a
  // ≤1568px vision payload, not a display asset — the operator-visible thumbnail
  // and the model's receipt of it stay effectively identical, and the main-
  // process block shrinks multiple× on big screenshots.
  if (width >= height) {
    return img.resize({ width: longEdge, quality: 'good' })
  }
  return img.resize({ height: longEdge, quality: 'good' })
}

function encodedBase64Size(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4
}
