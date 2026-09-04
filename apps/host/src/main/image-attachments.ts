import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { nativeImage, type NativeImage } from 'electron'
import type { ImageDeliveryEncodedRecord } from '../shared/chat-image-delivery.js'

/** Pi `ImageContent` shape from `@earendil-works/pi-ai`. Inline-typed here to avoid a deep transitive import. */
export type PiImageContent = {
  type: 'image'
  /** Base64-encoded image bytes (no `data:` prefix). */
  data: string
  /** Provider-friendly MIME, e.g. `image/png` or `image/jpeg`. */
  mimeType: string
}

export type AttachmentInput = { path: string; name?: string }

export type EncodeResult = {
  images: PiImageContent[]
  delivered: ImageDeliveryEncodedRecord[]
  /** Attachments we deliberately did not encode (forwarded only as path-injection text). */
  skipped: { path: string; reason: string }[]
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
 */
export function encodeImageAttachmentsForPi(attachments: AttachmentInput[]): EncodeResult {
  const images: PiImageContent[] = []
  const delivered: ImageDeliveryEncodedRecord[] = []
  const skipped: { path: string; reason: string }[] = []

  for (const att of attachments) {
    const filePath = (att.path ?? '').trim()
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
      } else {
        skipped.push({ path: filePath, reason: 'decode_failed' })
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      skipped.push({ path: filePath, reason: `error:${reason}` })
    }
  }

  return { images, delivered, skipped }
}

type EncodedOne = {
  image: PiImageContent
  meta: ImageDeliveryEncodedRecord
}

function encodeOneImage(filePath: string): EncodedOne | null {
  if (!existsSync(filePath)) return null
  const stats = statSync(filePath)
  if (!stats.isFile()) return null

  const ext = extname(filePath).toLowerCase()
  const originalMime = MIME_BY_EXT[ext] ?? 'image/png'
  const originalBytes = readFileSync(filePath)

  const img = nativeImage.createFromBuffer(originalBytes)
  if (img.isEmpty()) return null

  const { width, height } = img.getSize()
  const longEdge = Math.max(width, height)
  const needsResize = longEdge > MAX_LONG_EDGE_PX
  const needsReencode = stats.size > RAW_BYTES_REENCODE_THRESHOLD

  if (!needsResize && !needsReencode) {
    return packEncoded(filePath, {
      type: 'image',
      data: originalBytes.toString('base64'),
      mimeType: originalMime,
    }, {
      width,
      height,
      sourceBytes: stats.size,
      reencoded: false,
    })
  }

  const resized = needsResize ? resizeToLongEdge(img, MAX_LONG_EDGE_PX) : img
  const outSize = resized.getSize()
  const jpegBytes = resized.toJPEG(85)
  if (jpegBytes.length === 0) {
    return packEncoded(filePath, {
      type: 'image',
      data: originalBytes.toString('base64'),
      mimeType: originalMime,
    }, {
      width,
      height,
      sourceBytes: stats.size,
      reencoded: false,
    })
  }

  if (encodedBase64Size(jpegBytes.length) > ENCODED_BYTES_HARD_LIMIT) {
    const smaller = resizeToLongEdge(resized, Math.floor(MAX_LONG_EDGE_PX * 0.75))
    const smallerSize = smaller.getSize()
    const smallerJpeg = smaller.toJPEG(80)
    return packEncoded(filePath, {
      type: 'image',
      data: smallerJpeg.toString('base64'),
      mimeType: 'image/jpeg',
    }, {
      width: smallerSize.width,
      height: smallerSize.height,
      sourceBytes: stats.size,
      reencoded: true,
    })
  }

  return packEncoded(filePath, {
    type: 'image',
    data: jpegBytes.toString('base64'),
    mimeType: 'image/jpeg',
  }, {
    width: outSize.width,
    height: outSize.height,
    sourceBytes: stats.size,
    reencoded: true,
  })
}

function packEncoded(
  path: string,
  image: PiImageContent,
  dims: { width: number; height: number; sourceBytes: number; reencoded: boolean },
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
  }
}

function resizeToLongEdge(img: NativeImage, longEdge: number): NativeImage {
  const { width, height } = img.getSize()
  if (width === 0 || height === 0) return img
  if (width >= height) {
    return img.resize({ width: longEdge, quality: 'best' })
  }
  return img.resize({ height: longEdge, quality: 'best' })
}

function encodedBase64Size(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4
}
