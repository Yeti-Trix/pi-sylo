/**
 * Preview-image codec for the §3.4 generate result contract — the sylo-image-gen
 * `extensions/tools/preview-image.ts` twin, cloned VERBATIM (codec identical, header
 * retargeted): pure TS, zero new dependencies (plan §1.3 pins the package deps; §7
 * risk table calls for a ≤512 px / ~50–150 KB JPEG preview so the inline b64 stays
 * under the renderer's 500 KB telemetry cap).
 *
 * Pipeline: the IN-GRAPH POSTER PNG bytes (§2.4 — every video graph saves a
 * first-frame PNG poster; stills without a poster degrade in-batch) → …
 * Pipeline: the IN-GRAPH POSTER PNG bytes (§2.4) → PNG decode (node:zlib inflate
 *   + standard unfilter; colorTypes 0/2/3/4/6, bitDepth 8 or 16-high-byte,
 *   non-interlaced — what ComfyUI saves) → box-filter downscale to ≤ 512 px longest side
 *   → baseline JPEG encode (YCbCr 4:2:0, quality 80, T.81 Annex K tables).
 *
 * NOTE ON THE §3.4 CONTRACT: the image twin's §3.1 review correction stands — the
 * block bytes are genuinely JPEG and the generate tool labels the block
 * `image/jpeg` (the plan's literal `mimeType:'image/png'` carrying a JPEG b64 was
 * the §3-review fix). The full-res poster PNG always lives at `_localPath`, which
 * the Sylo renderer prefers anyway; the CLIP itself is NEVER inlined (§3.4:
 * `<video>`-in-chat rejected — the route/detail player owns playback).
 */
import { inflateSync } from 'node:zlib'

/** §3.4/§7: preview longest side cap. */
export const PREVIEW_MAX_SIDE = 512
/** §3.4/§7 target band — q80 keeps 512² AI renders in range. */
export const PREVIEW_JPEG_QUALITY = 80

export interface RgbaImage {
  rgba: Uint8Array
  width: number
  height: number
}

// ── PNG decode ──────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function concatBytes(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Decode a non-interlaced PNG (8/16-bit gray, RGB, palette, RGBA; gray+alpha at 8-bit) to RGBA8. */
export function decodePngToRgba(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 8) throw new Error('PNG is too short to be a PNG file.')
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG file (bad signature).')

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let palette: Uint8Array | undefined
  const idat: Uint8Array[] = []
  let seenIend = false
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let offset = 8
  while (offset + 8 <= bytes.length && !seenIend) {
    const len = dv.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    const dataStart = offset + 8
    const dataEnd = dataStart + len
    if (dataEnd + 4 > bytes.length) throw new Error('PNG is truncated mid-chunk.')
    const data = bytes.subarray(dataStart, dataEnd)
    if (type === 'IHDR') {
      width = dv.getUint32(dataStart)
      height = dv.getUint32(dataStart + 4)
      bitDepth = data[8]
      colorType = data[9]
      if (width <= 0 || height <= 0) throw new Error(`PNG has invalid dimensions ${width}×${height}.`)
      // IHDR layout: width(4) height(4) bitDepth(8) colorType(9) compression(10) filter(11) interlace(12).
      if (data[10] !== 0 || data[11] !== 0) throw new Error('PNG uses unsupported compression/filter method.')
      if (data[12] !== 0) throw new Error('PNG is interlaced — previews support only non-interlaced PNGs.')
    } else if (type === 'PLTE') {
      palette = new Uint8Array(data)
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      seenIend = true
    }
    offset = dataEnd + 4 // CRC
  }
  if (!width || colorType < 0) throw new Error('PNG has no IHDR chunk.')
  if (idat.length === 0) throw new Error('PNG has no image data (IDAT) chunks.')

  const channelsByType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const channels = channelsByType[colorType]
  if (!channels) throw new Error(`PNG colorType ${colorType} is not supported for previews.`)
  if (colorType === 3) {
    if (bitDepth !== 8) throw new Error('Palette PNGs with bit depth other than 8 are not supported.')
    if (!palette) throw new Error('Palette PNG has no PLTE chunk.')
  } else if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`PNG bit depth ${bitDepth} is not supported for previews (need 8 or 16).`)
  }
  const bytesPerChannel = bitDepth === 16 ? 2 : 1
  const stride = width * channels * bytesPerChannel

  let raw: Uint8Array
  try {
    raw = inflateSync(concatBytes(idat))
  } catch {
    throw new Error('PNG pixel data is corrupt (zlib inflate failed).')
  }
  if (raw.length < (stride + 1) * height)
    throw new Error(`PNG pixel data is short (${raw.length} bytes, need ${(stride + 1) * height}).`)

  // Standard per-row unfilter (filters 0–4). `a` = left, `b` = up, `c` = up-left
  // in the ALREADY-unfiltered output (T.81-free PNG spec §6 — Paeth predictor).
  const unfiltered = new Uint8Array(stride * height)
  const bpp = channels * bytesPerChannel
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]
    const src = row * (stride + 1) + 1
    const outStart = row * stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? unfiltered[outStart + i - bpp] : 0
      const b = row > 0 ? unfiltered[outStart - stride + i] : 0
      const c = row > 0 && i >= bpp ? unfiltered[outStart - stride + i - bpp] : 0
      let v = raw[src + i]
      switch (filter) {
        case 0: break
        case 1: v = (v + a) & 0xff; break
        case 2: v = (v + b) & 0xff; break
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
          break
        }
        default: throw new Error(`PNG row filter ${filter} is unknown.`)
      }
      unfiltered[outStart + i] = v
    }
  }
  return pixelsToRgba(unfiltered, width, height, colorType, bitDepth, palette)
}

/** Repack a planar PNG scanline buffer into RGBA8 (16-bit → high byte). */
function pixelsToRgba(
  unfiltered: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  bitDepth: number,
  palette: Uint8Array | undefined,
): RgbaImage {
  const rgba = new Uint8Array(width * height * 4)
  const hiByte = (i: number): number => (bitDepth === 16 ? unfiltered[i * 2] : unfiltered[i])
  for (let p = 0; p < width * height; p++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 255
    if (colorType === 0) {
      r = g = b = hiByte(p)
    } else if (colorType === 2) {
      r = hiByte(p * 3)
      g = hiByte(p * 3 + 1)
      b = hiByte(p * 3 + 2)
    } else if (colorType === 3) {
      const idx = unfiltered[p]
      const pal = palette!
      // Out-of-range palette indices render opaque black (decoder convention).
      r = idx * 3 + 2 < pal.length ? pal[idx * 3] : 0
      g = idx * 3 + 2 < pal.length ? pal[idx * 3 + 1] : 0
      b = idx * 3 + 2 < pal.length ? pal[idx * 3 + 2] : 0
    } else if (colorType === 4) {
      r = g = b = hiByte(p * 2)
      a = hiByte(p * 2 + 1)
    } else {
      r = hiByte(p * 4)
      g = hiByte(p * 4 + 1)
      b = hiByte(p * 4 + 2)
      a = hiByte(p * 4 + 3)
    }
    rgba[p * 4] = r
    rgba[p * 4 + 1] = g
    rgba[p * 4 + 2] = b
    rgba[p * 4 + 3] = a
  }
  return { rgba, width, height }
}

// ── Box-filter downscale ────────────────────────────────────────────────────

/** Preview dimensions: longest side ≤ maxSide, aspect kept, ≥1 px. */
export function previewDims(width: number, height: number, maxSide = PREVIEW_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Area-average (box) downscale — smooth for the big ratios AI outputs give. */
export function downscaleRgba(img: RgbaImage, maxSide = PREVIEW_MAX_SIDE): RgbaImage {
  const { width, height } = previewDims(img.width, img.height, maxSide)
  if (width === img.width && height === img.height) return img
  const out = new Uint8Array(width * height * 4)
  const sx = img.width / width
  const sy = img.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.min(img.height, Math.ceil((y + 1) * sy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.min(img.width, Math.ceil((x + 1) * sx))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let syi = y0; syi < y1; syi++) {
        for (let sxi = x0; sxi < x1; sxi++) {
          const i = (syi * img.width + sxi) * 4
          r += img.rgba[i]
          g += img.rgba[i + 1]
          b += img.rgba[i + 2]
          a += img.rgba[i + 3]
          n++
        }
      }
      const o = (y * width + x) * 4
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
      out[o + 3] = Math.round(a / n)
    }
  }
  return { rgba: out, width, height }
}

// ── Baseline JPEG encoder (T.81) ────────────────────────────────────────────

/** Zigzag scan: raster index visited at zigzag position k (T.81 Fig. A.6). */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

/** T.81 K.1 luminance table, raster order. */
const Q_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
]
/** T.81 K.1 chrominance table, raster order. */
const Q_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
]

/** libjpeg quality scaling (quality ≥ 50: scale = 200 − 2·q, values clamped 1–255). */
function scaledQuantTable(base: number[], quality: number): Uint8Array {
  const scale = quality < 50 ? Math.round(5000 / quality) : 200 - quality * 2
  const out = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    const v = Math.floor((base[i] * scale + 50) / 100)
    out[i] = Math.min(255, Math.max(1, v))
  }
  return out
}

/** T.81 K.3 — DC luminance: BITS (counts for code lengths 1..16) + HUFFVAL. */
const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_LUMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
/** T.81 K.3 — DC chrominance. */
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
const DC_CHROMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
/** T.81 K.3 — AC luminance (162 values). */
const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]
/** T.81 K.3 — AC chrominance (162 values). */
const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]

/** Symbol → canonical Huffman code (T.81 C.2): code 0 per length, left-shift at each length. */
function buildHuffman(bits: number[], vals: number[]): Map<number, { code: number; bits: number }> {
  const codes = new Map<number, { code: number; bits: number }>()
  let v = 0
  let code = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) {
      if (v >= vals.length) throw new Error('internal: Huffman BITS exceeds HUFFVAL count')
      if (code >= 1 << len) throw new Error('internal: canonical Huffman overflow (bad K.3 table)')
      codes.set(vals[v], { code, bits: len })
      v++
      code++
    }
    code <<= 1
  }
  return codes
}

/** Bytes writer for marker segments. */
class Bytes {
  private parts: number[] = []
  u8(v: number): this { this.parts.push(v & 0xff); return this }
  u16(v: number): this { return this.u8(v >> 8).u8(v) }
  marker(m: number): this { return this.u8(0xff).u8(m) }
  ascii(s: string): this { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); return this }
  raw(a: ArrayLike<number>): this { for (let i = 0; i < a.length; i++) this.u8(a[i]); return this }
  bytes(): Uint8Array { return Uint8Array.from(this.parts) }
}

/** Bit writer with 0xFF byte-stuffing (T.81 §F.1.2.3). Max in-flight bits stay < 24. */
class BitWriter {
  acc = 0
  n = 0
  constructor(private out: Bytes) {}
  write(code: number, len: number): void {
    this.acc = (this.acc << len) | (code & ((1 << len) - 1))
    this.n += len
    while (this.n >= 8) {
      const byte = (this.acc >> (this.n - 8)) & 0xff
      this.out.u8(byte)
      if (byte === 0xff) this.out.u8(0x00)
      this.n -= 8
    }
    this.acc &= (1 << this.n) - 1
  }
  /** Pad the last partial byte with 1-bits (stuffed like any other FF — T.81 F.1.2.3). */
  flush(): void {
    if (this.n === 0) return
    this.write((1 << (8 - this.n)) - 1, 8 - this.n)
  }
}

const magnitudeBits = (absValue: number): number => {
  let v = absValue
  let nbits = 0
  while (v > 0) { nbits++; v >>= 1 }
  return nbits
}

/** Encode an RGBA image as a baseline JPEG (4:2:0, single interleaved scan).
 *  Alpha is ignored (ComfyUI outputs are opaque). */
export function encodeJpeg(img: RgbaImage, quality = PREVIEW_JPEG_QUALITY): Uint8Array {
  const { width, height, rgba } = img
  // Pad to MCU (16×16 for 4:2:0) by edge replication; chroma planes at half res.
  const pw = Math.ceil(width / 16) * 16
  const ph = Math.ceil(height / 16) * 16
  const yPlane = new Uint8Array(pw * ph)
  const cw = pw / 2
  const chh = ph / 2
  const cbPlane = new Uint8Array(cw * chh)
  const crPlane = new Uint8Array(cw * chh)
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(height - 1, y)
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(width - 1, x)
      const p = (sy * width + sx) * 4
      const r = rgba[p]
      const g = rgba[p + 1]
      const b = rgba[p + 2]
      // BT.601 full-range RGB → Y.
      yPlane[y * pw + x] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)))
    }
  }
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      // 4:2:0 chroma sample = average of the 2×2 RGB block (edge-replicated).
      let rs = 0
      let gs = 0
      let bs = 0
      for (const [dy, dx] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
        const sy = Math.min(height - 1, y * 2 + dy)
        const sx = Math.min(width - 1, x * 2 + dx)
        const p = (sy * width + sx) * 4
        rs += rgba[p]
        gs += rgba[p + 1]
        bs += rgba[p + 2]
      }
      const r = rs / 4
      const g = gs / 4
      const b = bs / 4
      cbPlane[y * cw + x] = Math.max(0, Math.min(255, Math.round(-0.168736 * r - 0.331264 * g + 0.5 * b + 128)))
      crPlane[y * cw + x] = Math.max(0, Math.min(255, Math.round(0.5 * r - 0.418688 * g - 0.081312 * b + 128)))
    }
  }

  const qY = scaledQuantTable(Q_LUMA, quality)
  const qC = scaledQuantTable(Q_CHROMA, quality)
  const hYdc = buildHuffman(DC_LUMA_BITS, DC_LUMA_VALS)
  const hYac = buildHuffman(AC_LUMA_BITS, AC_LUMA_VALS)
  const hCdc = buildHuffman(DC_CHROMA_BITS, DC_CHROMA_VALS)
  const hCac = buildHuffman(AC_CHROMA_BITS, AC_CHROMA_VALS)

  const out = new Bytes()
  const bitStream = new BitWriter(out)

  // SOI + JFIF APP0 (v1.01, square pixels, no thumbnail).
  out.marker(0xd8)
  out.marker(0xe0).u16(16).ascii('JFIF').u8(0).u16(0x0101).u8(0).u16(1).u16(1).u8(0).u8(0)
  // DQT ×2 — per T.81 B.2.4.1 the table is serialized in zigzag order. The
  // length counts BOTH tables (each = 1 Td/Tq byte + 64 values) plus the 2-byte
  // length field itself; declaring one table's worth while writing two leaves
  // 65 chroma bytes dangling past the declared segment end, which strict
  // decoders reject as junk before SOF0 (and then report SOF0's chroma quant
  // id 1 as "not defined").
  out.marker(0xdb).u16(2 + 2 * (1 + 64))
  out.u8(0x00).raw(Array.from({ length: 64 }, (_, k) => qY[ZIGZAG[k]]))
  out.u8(0x01).raw(Array.from({ length: 64 }, (_, k) => qC[ZIGZAG[k]]))
  // SOF0 — 8-bit, 3 components: Y (2×2, quant 0), Cb (1×1, quant 1), Cr (1×1, quant 1).
  out.marker(0xc0).u16(17)
    .u8(8).u16(ph).u16(pw).u8(3)
    .u8(1).u8(0x22).u8(0)
    .u8(2).u8(0x11).u8(1)
    .u8(3).u8(0x11).u8(1)
  // DHT ×4 — DC-lum (00), AC-lum (10), DC-chroma (01), AC-chroma (11).
  emitDht(out, 0x00, DC_LUMA_BITS, DC_LUMA_VALS)
  emitDht(out, 0x10, AC_LUMA_BITS, AC_LUMA_VALS)
  emitDht(out, 0x01, DC_CHROMA_BITS, DC_CHROMA_VALS)
  emitDht(out, 0x11, AC_CHROMA_BITS, AC_CHROMA_VALS)
  // SOS — single interleaved scan, Y←4:2:0 tables (00), Cb/Cr←1:1 tables (11).
  out.marker(0xda).u16(12).u8(3)
    .u8(1).u8(0x00)
    .u8(2).u8(0x11)
    .u8(3).u8(0x11)
    .u8(0).u8(63).u8(0)

  // Entropy: MCU = 4 Y blocks + 1 Cb + 1 Cr; DC predictors are per component
  // (T.81 G.1.2.1), reset at scan start only (no restart intervals).
  let predY = 0
  let predCb = 0
  let predCr = 0
  for (let my = 0; my < ph / 16; my++) {
    for (let mx = 0; mx < pw / 16; mx++) {
      for (const [dy, dx] of [[0, 0], [0, 8], [8, 0], [8, 8]] as const) {
        predY = encodeBlock(bitStream, yPlane, my * 16 + dy, mx * 16 + dx, pw, qY, hYdc, hYac, predY)
      }
      predCb = encodeBlock(bitStream, cbPlane, my * 8, mx * 8, cw, qC, hCdc, hCac, predCb)
      predCr = encodeBlock(bitStream, crPlane, my * 8, mx * 8, cw, qC, hCdc, hCac, predCr)
    }
  }
  bitStream.flush()
  out.marker(0xd9)
  return out.bytes()
}

function emitDht(out: Bytes, classAndId: number, bitsCounts: number[], vals: number[]): void {
  out.marker(0xc4).u16(2 + 1 + 16 + vals.length).u8(classAndId).raw(bitsCounts).raw(vals)
}

/** Forward DCT-II (double precision) → quantize → DC differential + AC run/size emit. */
function encodeBlock(
  bitStream: BitWriter,
  plane: Uint8Array,
  top: number,
  left: number,
  planeWidth: number,
  quant: Uint8Array,
  dcTable: Map<number, { code: number; bits: number }>,
  acTable: Map<number, { code: number; bits: number }>,
  predDc: number,
): number {
  const f = new Float64Array(64)
  for (let vy = 0; vy < 8; vy++)
    for (let vx = 0; vx < 8; vx++)
      f[vy * 8 + vx] = plane[(top + vy) * planeWidth + (left + vx)] - 128

  const coef = new Float64Array(64)
  for (let v = 0; v < 8; v++) {
    const cv = v === 0 ? 1 / Math.SQRT2 : 1
    for (let u = 0; u < 8; u++) {
      const cu = u === 0 ? 1 / Math.SQRT2 : 1
      let sum = 0
      for (let y = 0; y < 8; y++) {
        const cy = Math.cos(((2 * y + 1) * v * Math.PI) / 16)
        for (let x = 0; x < 8; x++) {
          sum += f[y * 8 + x] * cy * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
        }
      }
      coef[v * 8 + u] = 0.25 * cu * cv * sum
    }
  }

  // DC differential, category coding (T.81 F.1.2.1).
  const dcRaster = ZIGZAG[0]
  const dcValue = Math.round(coef[dcRaster] / quant[dcRaster])
  const diff = dcValue - predDc
  const dcCat = magnitudeBits(Math.abs(diff))
  const dcCode = dcTable.get(dcCat)
  if (!dcCode) throw new Error('internal: DC huffman category has no code')
  bitStream.write(dcCode.code, dcCode.bits)
  if (dcCat > 0) {
    const extra = diff < 0 ? diff - 1 : diff
    bitStream.write(extra & ((1 << dcCat) - 1), dcCat)
  }

  // AC run-length + magnitude (T.81 F.1.3.1): F0 = 16 zeros, 00 = EOB.
  // EOB (or ZRL→EOB) is emitted whenever zeros remain after the last non-zero
  // coefficient (i.e. the run at the end of the zigzag never got a symbol).
  let run = 0
  let lastNonzeroK = 0
  for (let k = 1; k < 64; k++) {
    const raster = ZIGZAG[k]
    const value = Math.round(coef[raster] / quant[raster])
    if (value === 0) {
      run++
      continue
    }
    lastNonzeroK = k
    while (run > 15) {
      const zrl = acTable.get(0xf0)
      if (!zrl) throw new Error('internal: AC ZRL code missing')
      bitStream.write(zrl.code, zrl.bits)
      run -= 16
    }
    const size = magnitudeBits(Math.abs(value))
    const acCode = acTable.get((run << 4) | size)
    if (!acCode) throw new Error('internal: AC huffman symbol has no code')
    bitStream.write(acCode.code, acCode.bits)
    const extra = value < 0 ? value - 1 : value
    bitStream.write(extra & ((1 << size) - 1), size)
    run = 0
  }
  if (run > 0 && lastNonzeroK < 63) {
    const eob = acTable.get(0x00)
    if (!eob) throw new Error('internal: AC EOB code missing')
    bitStream.write(eob.code, eob.bits)
  }
  return dcValue
}

// ── One-shot preview (§3.4 result contract) ─────────────────────────────────

export type PreviewResult =
  | { ok: true; jpeg: Uint8Array; width: number; height: number }
  | { ok: false; reason: string }

/** PNG bytes → ≤512 px JPEG preview, or a plain-language failure reason. Never throws. */
export function encodePreviewFromPng(png: Uint8Array, maxSide = PREVIEW_MAX_SIDE): PreviewResult {
  try {
    let img = decodePngToRgba(png)
    img = downscaleRgba(img, maxSide)
    return { ok: true, jpeg: encodeJpeg(img), width: img.width, height: img.height }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `preview skipped — ${message}. The full-resolution PNG is in the library.` }
  }
}