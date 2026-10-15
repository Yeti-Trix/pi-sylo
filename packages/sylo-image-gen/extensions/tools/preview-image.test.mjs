/**
 * Offline tests for extensions/tools/preview-image.ts (§3.1 preview contract):
 * PNG decode (filters, palette, 16-bit), downscale caps, and baseline JPEG
 * structural integrity via a STRICT marker walker — every segment's declared
 * length must exactly match its byte span (no junk between markers) and every
 * SOF0/SOS table selector must resolve to an actually-emitted DQT/DHT id (the
 * regression locks for the historically-corrupt output "65 extraneous bytes
 * before marker 0xc0" / "Quantization table 0x01 was not defined"). No
 * network, no ComfyUI — mirrors the test:store harness pattern (esbuild + node --test).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'

import {
  encodeJpeg,
  encodePreviewFromPng,
  decodePngToRgba,
  downscaleRgba,
  previewDims,
  PREVIEW_MAX_SIDE,
} from './preview-image.ts'

// ── PNG builder (synthetic fixtures) ────────────────────────────────────────

function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = []
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  out.push(len)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  out.push(body, crc)
  return Buffer.concat(out)
}

function makePng({ width, height, colorType, bitDepth = 8, colorBytes, palette }) {
  // colorBytes: per-pixel byte producer (UNFILTERED scanlines, filter 0 — the
  // sub/up/paeth test builds its own raw buffer directly).
  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const channels = channelsByType[colorType]
  const bytesPerChannel = bitDepth === 16 ? 2 : 1
  const stride = width * channels * bytesPerChannel
  const raw = Buffer.alloc((stride + 1) * height)
  let at = 0
  for (let y = 0; y < height; y++) {
    raw[at++] = 0
    for (let x = 0; x < width; x++) {
      const px = colorBytes(x, y)
      for (let c = 0; c < channels * bytesPerChannel; c++) raw[at++] = px(c)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    palette ? chunk('PLTE', palette) : Buffer.alloc(0),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function rgbaFill(x, y, r, g, b, a = 255) {
  return (c) => [r, g, b, a][c]
}

function mulberry(seed) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function noiseRgba(width, height, seed = 42) {
  const rand = mulberry(seed)
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (rand() * 256) | 0
    rgba[i * 4 + 1] = (rand() * 256) | 0
    rgba[i * 4 + 2] = (rand() * 256) | 0
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

function findMarker(bytes, marker) {
  for (let i = 0; i < bytes.length - 1; i++)
    if (bytes[i] === 0xff && bytes[i + 1] === marker) return i
  return -1
}

// ── Strict JPEG structure walker (permanent regression lock) ──────────────

/**
 * Walk all 0xFFxx markers SOI→EOI WITHOUT skipping unaccounted bytes.
 * After every marker segment the cursor must land exactly on the next marker
 * (0xFF fill bytes are legal per T.81 B.2.1; 0xFF00 stuffing is honored inside
 * entropy data only). A segment whose declared length is shorter than its real
 * payload leaves bytes dangling before the next marker — precisely the
 * strict-decoder failure mode GDI+ reports as "N extraneous bytes before
 * marker M" — so the walker throws on it by construction.
 */
function walkJpegMarkers(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('walker: file does not start with SOI')
  let i = 2
  const segments = []
  for (;;) {
    while (i + 1 < bytes.length && bytes[i] === 0xff && bytes[i + 1] === 0xff) i++ // 0xFF fill bytes
    if (i + 1 >= bytes.length) throw new Error('walker: reached end of file without an EOI marker')
    if (bytes[i] !== 0xff) {
      throw new Error(`walker: stray byte 0x${bytes[i].toString(16).padStart(2, '0')} at offset ${i} — a segment's declared length is smaller than its real payload (no marker here)`)
    }
    const marker = bytes[i + 1]
    if (marker === 0x00) throw new Error(`walker: byte-stuffed 0xFF00 outside entropy data at offset ${i}`)
    if (marker === 0xd8) throw new Error(`walker: duplicate SOI at offset ${i}`)
    const seg = { marker, offset: i, length: 0, payloadOffset: 0 }
    if (marker === 0xd9) { // EOI — done
      segments.push(seg)
      return segments
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { // TEM / RSTn — no length field
      segments.push(seg)
      i += 2
      continue
    }
    if (i + 4 > bytes.length) throw new Error(`walker: marker 0x${marker.toString(16)} is truncated before its length field`)
    const declared = (bytes[i + 2] << 8) | bytes[i + 3]
    if (declared < 2) throw new Error(`walker: marker 0x${marker.toString(16)} declares impossible length ${declared} (< 2)`)
    if (i + 2 + declared > bytes.length) throw new Error(`walker: marker 0x${marker.toString(16)} declares ${declared} bytes but only ${bytes.length - i - 2} remain`)
    seg.length = declared
    seg.payloadOffset = i + 4
    segments.push(seg)
    i += 2 + declared
    if (marker === 0xda) { // SOS — skip entropy data until the next marker
      while (i + 1 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue }
        if (bytes[i + 1] === 0x00) { i += 2; continue } // stuffed literal 0xFF data byte
        break // RSTn / EOI follows
      }
    }
  }
}

/**
 * Structural + referential validation of a baseline JPEG:
 *  1. the strict marker walk above (no junk between markers, lengths exact),
 *  2. every DQT/DHT payload parses to exactly its declared length,
 *  3. every SOF0/SOS component table selector appears in an emitted DQT/DHT,
 *  4. baseline shape: one SOF0 + one SOS, tables emitted before use, SOS 0–63.
 * Throws with a precise reason; returns the parsed tables for assertions.
 */
function validateJpegStructure(bytes) {
  const segments = walkJpegMarkers(bytes)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dqtIds = new Set()
  const dhtIds = new Set()
  const sofComps = []
  const sosComps = []
  let sofIdx = -1
  let sosIdx = -1
  let sof0Count = 0
  let firstDqtIdx = -1
  let firstDhtIdx = -1

  segments.forEach((seg, idx) => {
    const end = seg.offset + 2 + seg.length // exclusive end of the declared payload
    let p
    switch (seg.marker) {
      case 0xdb: { // DQT: 1× [Pq/Tq byte + 64 8-bit values] per table
        if (firstDqtIdx < 0) firstDqtIdx = idx
        p = seg.payloadOffset
        while (p < end) {
          const pqTq = bytes[p++]
          const pq = pqTq >> 4
          const tq = pqTq & 0x0f
          if (pq !== 0) throw new Error(`walker: DQT declares ${pq}-bit precision — baseline must be 8-bit`)
          if (tq > 3) throw new Error(`walker: DQT table id ${tq} is outside T.81's 0–3 range`)
          p += 64
          dqtIds.add(tq)
        }
        if (p !== end) throw new Error(`walker: DQT tables do not exactly fill the declared ${seg.length}-byte length`)
        break
      }
      case 0xc0: { // SOF0 (baseline DCT)
        if (++sof0Count > 1) throw new Error('walker: more than one SOF0 frame header')
        sofIdx = idx
        p = seg.payloadOffset
        const precision = bytes[p++]
        if (precision !== 8) throw new Error(`walker: SOF0 sample precision ${precision} — baseline must be 8`)
        dv.getUint16(p) // height — checked in dedicated tests
        dv.getUint16(p + 2) // width — checked in dedicated tests
        p += 4
        const ns = bytes[p++]
        for (let c = 0; c < ns; c++) {
          const id = bytes[p++]
          const sampling = bytes[p++]
          const quantId = bytes[p++]
          if (quantId > 3) throw new Error(`walker: SOF0 component ${id} selects invalid quant table id ${quantId}`)
          sofComps.push({ id, sampling, quantId })
        }
        if (p !== end) throw new Error(`walker: SOF0 payload does not exactly fill its ${seg.length}-byte length`)
        break
      }
      case 0xc4: { // DHT: 1× [Tc/Th byte + 16 BITS counts + BITS-sum HUFFVALs] per table
        if (firstDhtIdx < 0) firstDhtIdx = idx
        p = seg.payloadOffset
        while (p < end) {
          const tcTh = bytes[p++]
          if (tcTh >> 4 > 1 || (tcTh & 0x0f) > 3) throw new Error(`walker: DHT class/id selector 0x${tcTh.toString(16).padStart(2, '0')} is out of range`)
          if (p + 16 > end) throw new Error('walker: DHT truncated inside its BITS counts')
          const valTotal = Array.from(bytes.subarray(p, p + 16)).reduce((a, b) => a + b, 0)
          p += 16 + valTotal
          dhtIds.add(tcTh)
        }
        if (p !== end) throw new Error(`walker: DHT tables do not exactly fill the declared ${seg.length}-byte length`)
        break
      }
      case 0xda: { // SOS header
        if (sosIdx >= 0) throw new Error('walker: more than one scan (SOS)')
        sosIdx = idx
        p = seg.payloadOffset
        const ns = bytes[p++]
        for (let c = 0; c < ns; c++) {
          const id = bytes[p++]
          const selectors = bytes[p++]
          sosComps.push({ id, td: selectors >> 4, ta: selectors & 0x0f })
        }
        const ss = bytes[p++]
        const se = bytes[p++]
        const ahAl = bytes[p++]
        if (ss !== 0 || se !== 63 || ahAl !== 0) throw new Error(`walker: SOS scan Ss=${ss} Se=${se} AhAl=${ahAl} is not a baseline 0–63 scan`)
        if (p !== end) throw new Error(`walker: SOS payload does not exactly fill its ${seg.length}-byte length`)
        break
      }
      default:
        break // APPn/COM carry no cross-references
    }
  })

  if (sofIdx < 0 || sosIdx < 0) throw new Error('walker: a baseline JPEG needs exactly one SOF0 and one SOS')
  if (firstDqtIdx < 0 || firstDqtIdx > sofIdx) throw new Error('walker: SOF0 frame header appears before any quantization table')
  if (firstDhtIdx < 0 || firstDhtIdx > sosIdx) throw new Error('walker: SOS scan appears before any huffman table')
  for (const comp of sofComps) {
    if (!dqtIds.has(comp.quantId)) {
      throw new Error(`walker: SOF0 component ${comp.id} references undefined quant table ${comp.quantId} (emitted DQT ids: ${[...dqtIds].join(', ') || 'none'})`)
    }
  }
  for (const comp of sosComps) {
    if (!dhtIds.has(comp.td)) throw new Error(`walker: SOS component ${comp.id} references undefined DC huffman table ${comp.td}`)
    if (!dhtIds.has(0x10 | comp.ta)) throw new Error(`walker: SOS component ${comp.id} references undefined AC huffman table ${comp.ta}`)
  }
  return { segments, dqtIds, dhtIds, sofComps, sosComps }
}

// ── PNG decode ──────────────────────────────────────────────────────────────

test('decodePngToRgba — RGB8 roundtrip preserves pixels', () => {
  // r = x·60, g = y·80, b = 7 — deterministic RGB gradient.
  const png = makePng({
    width: 4,
    height: 3,
    colorType: 2,
    colorBytes: (x, y) => (c) => [x * 60, y * 80, 7][c],
  })
  const img = decodePngToRgba(png)
  assert.equal(img.width, 4)
  assert.equal(img.height, 3)
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4
      assert.equal(img.rgba[i], x * 60, `r at (${x},${y})`)
      assert.equal(img.rgba[i + 1], y * 80, `g at (${x},${y})`)
      assert.equal(img.rgba[i + 2], 7, `b at (${x},${y})`)
    }
})

test('decodePngToRgba — per-row filters 1/2/4 (Sub/Up/Paeth) reconstruct solid rows', () => {
  // Solid green image; re-encode rows WITH correct pre-filtering to test unfiltering.
  const width = 8
  const height = 6
  const bpp = 3
  const stride = width * bpp
  const raw = Buffer.alloc((stride + 1) * height)
  const filters = [0, 1, 2, 0, 4, 3]
  // One constant color per channel — reconstruction equals original, so the
  // unfiltered neighbors are this constant wherever the pixel exists.
  const originals = [10, 200, 30]
  let at = 0
  for (let y = 0; y < height; y++) {
    const filter = filters[y]
    raw[at++] = filter
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < bpp; c++) {
        const original = originals[c]
        const left = x > 0 ? original : 0
        // Previous rows reconstruct to the same constant (every pixel is that color).
        const up = y > 0 ? original : 0
        const upLeft = y > 0 && x > 0 ? original : 0
        let pred = 0
        if (filter === 1) pred = left
        else if (filter === 2) pred = up
        else if (filter === 3) pred = Math.floor((left + up) / 2)
        else if (filter === 4) {
          const p = left + up - upLeft
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - upLeft)
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        }
        raw[at++] = (original - pred) & 0xff
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const img = decodePngToRgba(png)
  for (let p = 0; p < width * height; p++) {
    assert.equal(img.rgba[p * 4], 10, `r at ${p}`)
    assert.equal(img.rgba[p * 4 + 1], 200, `g at ${p}`)
    assert.equal(img.rgba[p * 4 + 2], 30, `b at ${p}`)
  }
})

test('decodePngToRgba — palette + 16-bit gray + RGBA', () => {
  const palettePng = makePng({
    width: 2,
    height: 2,
    colorType: 3,
    colorBytes: (x, y) => (c) => (x + y) % 3,
    palette: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]),
  })
  const pal = decodePngToRgba(palettePng)
  assert.deepEqual([pal.rgba[0], pal.rgba[1], pal.rgba[2]], [255, 0, 0])
  assert.deepEqual([pal.rgba[12], pal.rgba[13], pal.rgba[14]], [0, 0, 255]) // p=(1,1) → idx 2

  const gray16 = makePng({
    width: 2,
    height: 1,
    colorType: 0,
    bitDepth: 16,
    colorBytes: (x) => (c) => (x === 0 ? [0x12, 0x34] : [0xab, 0xcd])[c],
  })
  const gray = decodePngToRgba(gray16)
  assert.equal(gray.rgba[0], 0x12)
  assert.equal(gray.rgba[4], 0xab)

  const rgbaPng = makePng({
    width: 1,
    height: 1,
    colorType: 6,
    colorBytes: (x, y) => (c) => [1, 2, 3, 128][c],
  })
  const rgba = decodePngToRgba(rgbaPng)
  assert.deepEqual(Array.from(rgba.rgba), [1, 2, 3, 128])
})

test('decodePngToRgba — interlaced and garbage rejected with clear reasons', () => {
  assert.throws(() => decodePngToRgba(Buffer.from('not a png')), /Not a PNG/)
  const bytes = makePng({ width: 2, height: 2, colorType: 2, colorBytes: () => (c) => 0 })
  bytes[8 + 4 + 4 + 12] = 1 // IHDR interlace byte (chunk data offset 12 from file offset 16)
  assert.throws(() => decodePngToRgba(bytes), /interlaced/)
})

// ── Downscale caps ──────────────────────────────────────────────────────────

test('previewDims caps longest side and keeps aspect', () => {
  assert.deepEqual(previewDims(1536, 1024), { width: 512, height: 341 })
  assert.deepEqual(previewDims(1024, 1536), { width: 341, height: 512 })
  assert.deepEqual(previewDims(512, 512), { width: 512, height: 512 })
  assert.deepEqual(previewDims(300, 200), { width: 300, height: 200 }) // no upscale
  assert.deepEqual(previewDims(1024, 1024), { width: 512, height: 512 })
  assert.equal(PREVIEW_MAX_SIDE, 512)
})

test('downscaleRgba averages box areas', () => {
  // 2×2 → 1×1 averages exactly.
  const img = { rgba: new Uint8Array([100, 0, 0, 255, 0, 200, 0, 255, 0, 0, 60, 255, 0, 0, 0, 255]), width: 2, height: 2 }
  const small = downscaleRgba(img, 1)
  assert.equal(small.width, 1)
  assert.equal(small.height, 1)
  assert.equal(small.rgba[0], 25)
  assert.equal(small.rgba[1], 50)
  assert.equal(small.rgba[2], 15)
})

// ── JPEG encoder ────────────────────────────────────────────────────────────

test('encodeJpeg — structure: SOI/JFIF/SOF dims/EOI, dims MCU-padded', () => {
  const img = { rgba: noiseRgba(64, 48), width: 64, height: 48 }
  const jpeg = encodeJpeg(img)
  // Full strict walk: every segment length exact, every table selector resolved.
  validateJpegStructure(jpeg)
  assert.equal(jpeg[0], 0xff)
  assert.equal(jpeg[1], 0xd8)
  const sof = findMarker(jpeg, 0xc0)
  assert.notEqual(sof, -1)
  const dv = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)
  assert.equal(dv.getUint16(sof + 5), 48) // height
  assert.equal(dv.getUint16(sof + 7), 64) // width
  assert.equal(dv.getUint8(sof + 4), 8) // precision
  assert.equal(jpeg[jpeg.length - 2], 0xff)
  assert.equal(jpeg[jpeg.length - 1], 0xd9)
  // Padded MCU dims: 64×48 are already multiples of 16.
  assert.notEqual(findMarker(jpeg, 0xe0), -1) // JFIF APP0
  assert.notEqual(findMarker(jpeg, 0xdb), -1) // DQT
  assert.notEqual(findMarker(jpeg, 0xc4), -1) // DHT
  assert.notEqual(findMarker(jpeg, 0xda), -1) // SOS
})

test('encodeJpeg — MCU padding for odd dims (17×9 → 32×16)', () => {
  const img = { rgba: noiseRgba(17, 9, 7), width: 17, height: 9 }
  const jpeg = encodeJpeg(img)
  const sof = findMarker(jpeg, 0xc0)
  const dv = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)
  assert.equal(dv.getUint16(sof + 5), 16)
  assert.equal(dv.getUint16(sof + 7), 32)
})

test('encodeJpeg — size band: flat image small, 512² noise under the telemetry budget', () => {
  const flat = { rgba: new Uint8Array(512 * 512 * 4).fill(180), width: 512, height: 512 }
  // Give some structure (gradient blocks) to be more render-like.
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4
      const v = ((x / 64) | 0) * 20 + ((y / 64) | 0) * 10
      flat.rgba[i] = 60 + v
      flat.rgba[i + 1] = 30
      flat.rgba[i + 2] = 90 + v
    }
  }
  const flatJpeg = encodeJpeg(flat)
  assert.ok(flatJpeg.length < 150_000, `structured 512² should stay in the ~50–150 KB band, got ${flatJpeg.length}`)

  const noisy = { rgba: noiseRgba(512, 512, 99), width: 512, height: 512 }
  const noisyJpeg = encodeJpeg(noisy)
  assert.ok(noisyJpeg.length < 375_000, `worst-case noise must stay under the 500 KB b64 cap, got ${noisyJpeg.length}`)
  // Flat q80 4:2:0 is tiny — sanity floor.
  assert.ok(flatJpeg.length > 500)
})

test('encodeJpeg — 1×1 and gradient extremes do not throw', () => {
  const tiny = { rgba: new Uint8Array([250, 10, 10, 255]), width: 1, height: 1 }
  assert.equal(encodeJpeg(tiny)[0], 0xff)
  const grad = { rgba: new Uint8Array(256 * 256 * 4), width: 256, height: 256 }
  for (let p = 0; p < 256 * 256; p++) {
    grad.rgba[p * 4] = p % 256
    grad.rgba[p * 4 + 1] = (p >> 8) % 256
    grad.rgba[p * 4 + 2] = 255 - (p % 256)
    grad.rgba[p * 4 + 3] = 255
  }
  assert.ok(encodeJpeg(grad).length > 0)
})

test('encodeJpeg — strict walk + table-id integrity across fixtures', () => {
  // 4:2:0 padding, MCU padding, and 1×1 edge cases all walk clean.
  const fixtures = [
    { rgba: noiseRgba(64, 48), width: 64, height: 48 },
    { rgba: noiseRgba(17, 9, 7), width: 17, height: 9 },
    { rgba: new Uint8Array([250, 10, 10, 255]), width: 1, height: 1 },
  ]
  for (const img of fixtures) {
    const info = validateJpegStructure(encodeJpeg(img))
    assert.equal(info.segments.at(-1).marker, 0xd9, 'file ends exactly at EOI')
    // Encoder contract: both Annex-K tables emitted, both actually referenced.
    assert.deepEqual([...info.dqtIds].sort((a, b) => a - b), [0, 1]) // luma + chroma
    assert.deepEqual([...info.dhtIds].sort((a, b) => a - b), [0x00, 0x01, 0x10, 0x11])
    assert.equal(info.sofComps.length, 3)
    assert.deepEqual(info.sofComps.map((c) => c.quantId), [0, 1, 1]) // Y←0, Cb/Cr←1
    assert.deepEqual(info.sofComps.map((c) => c.sampling), [0x22, 0x11, 0x11]) // 4:2:0
    assert.deepEqual(info.sosComps.map((c) => [c.td, c.ta]), [[0, 0], [1, 1], [1, 1]])
  }
})

test('regression lock — walker rejects an under-counted DQT length ("extraneous bytes" defect)', () => {
  const jpeg = Uint8Array.from(encodeJpeg({ rgba: noiseRgba(32, 32), width: 32, height: 32 }))
  // Historical defect: DQT declared one table (length 2+1+64) while two tables
  // were written → 65 chroma-table bytes dangled before SOF0, which GDI+
  // reported verbatim as "Corrupt JPEG data: 65 extraneous bytes before marker 0xc0".
  // Simulate the length miscount on today's output and prove the walker
  // catches this exact class.
  const dqt = findMarker(jpeg, 0xdb)
  const dv = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)
  dv.setUint16(dqt + 2, 2 + 1 + 64)
  assert.throws(() => validateJpegStructure(jpeg), /stray byte 0x01 .*segment's declared length is smaller/, 'under-counted segment length must be fatal')
})

test('regression lock — walker rejects SOF selectors with no emitted quant table', () => {
  const jpeg = Uint8Array.from(encodeJpeg({ rgba: noiseRgba(32, 32, 11), width: 32, height: 32 }))
  // Historical cascade: with the chroma DQT unparseable, SOF0's chroma quant
  // selector 1 resolved to nothing → "Quantization table 0x01 was not defined".
  // Point Cb at a never-emitted table id and prove the check fires.
  const sof = findMarker(jpeg, 0xc0)
  jpeg[sof + 15] = 3 // SOF0 layout: +10/+11/+12 comp1, +13/+14/+15 comp2 (Cb quant)
  assert.throws(() => validateJpegStructure(jpeg), /SOF0 component 2 references undefined quant table 3/, 'unresolved table selector must be fatal')
})

// ── One-shot preview contract ───────────────────────────────────────────────

test('encodePreviewFromPng — 1024² PNG → ok JPEG ≤512 px', () => {
  const rgba = noiseRgba(1024, 1024, 5)
  // Encode a PNG of the noise by hand (filter 0, RGB8).
  const width = 1024
  const height = 1024
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let at = 0
  for (let y = 0; y < height; y++) {
    raw[at++] = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      raw[at++] = rgba[i]
      raw[at++] = rgba[i + 1]
      raw[at++] = rgba[i + 2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const result = encodePreviewFromPng(png)
  assert.equal(result.ok, true)
  // The published block must survive a strict structural walk too.
  validateJpegStructure(result.jpeg)
  assert.ok(result.width <= PREVIEW_MAX_SIDE && result.height <= PREVIEW_MAX_SIDE)
  assert.equal(result.jpeg[0], 0xff)
  assert.ok(result.jpeg.length < 375_000, `preview under the b64 cap, got ${result.jpeg.length}`)
})

test('encodePreviewFromPng — failures come back as plain-language reasons', () => {
  const bad = encodePreviewFromPng(Buffer.from('not a png at all'))
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /preview skipped/)
})