/**
 * Allowlist sanitizer for inline SVG before host render.
 *
 * The previous regex-strip approach (remove <script>, strip on*= handlers,
 * delete `javascript:`) was bypassable: single-pass replacement of
 * multi-character patterns can recombine (`<scr<script>ipt>`), and
 * entity-encoded URLs (`&#106;avascript:`) survive a literal `javascript:`
 * match. This sanitizer instead parses the markup as strict XML, walks the
 * tree keeping only allowlisted SVG elements and attributes, validates
 * URL-valued attributes after entity decoding, and serializes back out.
 * It fails closed: any parse error yields an empty string.
 */

/** SVG elements we render. Deliberately excludes <script>, <foreignObject>
 *  (embeds HTML), <iframe>/<object>/<embed>, and anything interactive. */
const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'switch',
  'title',
  'desc',
  'metadata',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'marker',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'style',
  'use',
  'image',
  'filter',
  'fegaussianblur',
  'feoffset',
  'feblend',
  'feflood',
  'fecomposite',
  'fecomponenttransfer',
  'fefuncr',
  'fefuncg',
  'fefuncb',
  'fefunca',
  'femerge',
  'femergenode',
  'fecolormatrix',
  'feconvolvematrix',
  'femorphology',
  'feturbulence',
  'fedisplacementmap',
  'fespecularlighting',
  'fediffuselighting',
  'fedistantlight',
  'fepointlight',
  'fespotlight',
  'fetile',
  'fedropshadow',
])

/** Attributes safe to keep on any allowlisted element. Compared
 *  case-insensitively; anything else (including every on* handler) is dropped. */
const ALLOWED_ATTRS = new Set([
  // geometry / structure
  'id',
  'class',
  'd',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
  'dx',
  'dy',
  'rotate',
  'pathlength',
  // presentation
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'color',
  'transform',
  'transform-origin',
  'transform-box',
  'display',
  'visibility',
  'clip-rule',
  'clip-path',
  'mask',
  'filter',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'stop-color',
  'stop-opacity',
  'style',
  // text
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-weight',
  'font-style',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
  // svg document / gradients / patterns / markers
  'viewbox',
  'preserveaspectratio',
  'xmlns',
  'xmlns:xlink',
  'version',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'patternunits',
  'patterncontentunits',
  'patterntransform',
  'markerunits',
  'markerwidth',
  'markerheight',
  'orient',
  'refx',
  'refy',
  'marker-start',
  'marker-mid',
  'marker-end',
  // filters
  'in',
  'in2',
  'result',
  'values',
  'type',
  'operator',
  'stddeviation',
  'numoctaves',
  'seed',
  'basefrequency',
  'surfacescale',
  'specularconstant',
  'specularexponent',
  'diffuseconstant',
  'azimuth',
  'elevation',
  'pointsatx',
  'pointsaty',
  'pointsatz',
  'limitingconeangle',
  'scale',
  'xchannelselector',
  'ychannelselector',
  'tablevalues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'order',
  'divisor',
  'bias',
  'kernelmatrix',
  'kernelunitlength',
  'edgemode',
  'preservealpha',
  'radius',
  'mode',
  'angle',
  'distance',
  // media geometry on <image>
  'crossorigin',
])

/** Attributes whose value is a URL and must pass the scheme check. */
const URL_ATTRS = new Set(['href', 'xlink:href'])

/** Schemes allowed in URL-valued attributes. */
function isSafeUrlValue(value: string): boolean {
  const v = value.trim()
  if (v === '' || v.startsWith('#')) return true
  try {
    const u = new URL(v, 'https://svg.invalid/')
    if (u.protocol === 'http:' || u.protocol === 'https:') return true
    if (u.protocol === 'data:' && /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)[;,]/i.test(v)) {
      return true
    }
  } catch {
    /* malformed URL → not safe */
  }
  return false
}

/** Parse as strict XML; returns null on any parse error (fail closed). */
function parseSvg(raw: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return null
    const root = doc.documentElement
    if (!root || root.nodeName.toLowerCase() !== 'svg') return null
    return doc
  } catch {
    return null
  }
}

/** Walk the tree: drop disallowed elements (with subtrees), strip disallowed
 *  attributes, remove comments and CDATA sections (re-emit CDATA as text so
 *  the serialized output cannot mutate meaning on HTML re-parse). */
function sanitizeTree(doc: Document): void {
  const walk = (el: Element): void => {
    if (!ALLOWED_TAGS.has(el.nodeName.toLowerCase())) {
      el.remove()
      return
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const drop =
        name.startsWith('on') ||
        (URL_ATTRS.has(name) && !isSafeUrlValue(attr.value)) ||
        !ALLOWED_ATTRS.has(name)
      if (drop) el.removeAttributeNode(attr)
    }
    for (const child of Array.from(el.children)) walk(child)
  }
  walk(doc.documentElement)

  // Comments and CDATA sections: remove / normalize so the serialized XML
  // cannot smuggle parser-context switches through innerHTML.
  const walker = doc.createTreeWalker(doc.documentElement, 0xffffffff)
  const comments: Comment[] = []
  const cdatas: CDATASection[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.COMMENT_NODE) comments.push(n as Comment)
    else if (n.nodeType === Node.CDATA_SECTION_NODE) cdatas.push(n as unknown as CDATASection)
  }
  for (const c of comments) c.remove()
  for (const c of cdatas) c.replaceWith(doc.createTextNode(c.data ?? ''))
}

/** Strip script/event/URL vectors from inline SVG before host render. */
export function sanitizeInlineSvg(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const doc = parseSvg(trimmed)
  if (!doc) return ''
  sanitizeTree(doc)
  try {
    return new XMLSerializer().serializeToString(doc.documentElement)
  } catch {
    return ''
  }
}

export function extractSvgMarkup(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('<svg')) return sanitizeInlineSvg(trimmed)
  const match = trimmed.match(/<svg[\s\S]*<\/svg>/i)
  return match ? sanitizeInlineSvg(match[0]) : null
}