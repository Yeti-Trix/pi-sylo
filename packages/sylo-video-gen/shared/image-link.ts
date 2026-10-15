/**
 * Cross-package image link (plan §3.5 — the §8.5 carve-out residual; see issue #34
 * comment 6134994973 + the tracker §8.5 row) — `resolveVideoStillLink(from_image_id)`
 * turns an IMAGES-library still into an i2v/loop source for the video tools.
 *
 * ── The contract (§3.5) ─────────────────────────────────────────────────────
 * 1. GUARDED DYNAMIC import: this is the ONLY runtime edge sylo-video-gen takes
 *    into sylo-image-gen — a dynamic `import()` of the sibling package's
 *    `shared/library-store.ts` (the plan wrote the target as
 *    `packages/sylo-image-gen/shared/library-store.js`; the repo standard is
 *    explicit-`.ts` native-ESM imports, so the specifier here is `.ts` — same file,
 *    jiti resolves it at runtime; see the specifier note below). No static import,
 *    no type-only import: sylo-image-gen can be uninstalled/disabled and this
 *    package still loads and typechecks (the same one-way discipline the store
 *    layer already applies — video-library-store.ts keeps its own pngDimensions
 *    port for exactly this reason).
 * 2. READ-ONLY: the module calls sibling `getRecord` (+ its own root/abs-path
 *    helpers) and NOTHING else. It never imports createRecord/organizeRecords,
 *    never writes into `<workspace>/​.sylo/images/`, never mutates the image
 *    library (one-way lineage; the video record carries `lineage.source_image_id`
 *    and that's where the tie-in ends — test:store asserts the images dir is
 *    untouched by store ops; test:tools asserts the same at this layer).
 * 3. SOFT-FAIL: every failure renders as `{ ok: false, reason }` with a
 *    plain-language note the generate tool surfaces (and only escalates when the
 *    mode genuinely needs a still — a clip t2v render continues without the
 *    still). Never throws, never a hard error. The plan's wording is baked into
 *    the reason: "sylo-image-gen not available — pass source_image_path or enable
 *    Images".
 * 4. SAME-workspace resolution: the sibling store resolves the image library from
 *    the SAME workspace root the video library uses (options flow through its
 *    StoreOptions — `workspaceCwd` wins over the SYLO_PI_CWD env, `libraryRoot`
 *    test override over both).
 *
 * `image_ids` (multi-keyframe, true first≠last flf2v) is reserved for v2 (§3.5) —
 * this module is single-still only by design.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ── Loose structural projection (deliberately NOT image-gen's ImageRecord type:
// a type-only import would still couple this package to sylo-image-gen's source
// tree at typecheck time — same one-way discipline, applied to types too). ──

export interface VideoStillLinkRecord {
  id: string
  created_at: string
  prompt: string
  model: string
  preset: string
  width: number
  height: number
  bytes: number
  tags: string[]
}

export type VideoStillLinkFailure = {
  ok: false
  reason: string
}

export type VideoStillLinkSuccess = {
  ok: true
  /** Projected record (read-only snapshot of the image-gen library row). */
  record: VideoStillLinkRecord
  /** Absolute path of the full-res still (file stays in the IMAGE library). */
  image_path: string
  /** Absolute path of the sibling library root, for lineage provenance in the caller. */
  library_root: string
}

export type VideoStillLink = VideoStillLinkSuccess | VideoStillLinkFailure

export interface VideoStillLinkOptions {
  workspaceCwd?: string
  libraryRoot?: string
  /**
   * Test seam: absolute path to a (stub or bundled) sylo-image-gen library-store
   * module. Production callers pass nothing — the guarded default below resolves
   * the sibling package relative to THIS file at runtime (jiti resolves `.ts`
   * siblings the same way it loaded this module).
   */
  modulePath?: string
}

/**
 * The production specifier, resolved lazily at call time: from
 * `packages/sylo-video-gen/shared/` (THIS file) to the sibling package — up two
 * (`..` → package root, `../..` → packages/) then into `sylo-image-gen/shared/`.
 * Computed from `import.meta.url` (jiti fills it for source-loaded `.ts`
 * extensions) and kept opaque to static analyzers (a literal relative specifier
 * would make esbuild try to inline the sibling into bundles — defeating the
 * may-be-uninstalled guard in tests).
 */
export function defaultImagegenStoreModulePath(): string | undefined {
  try {
    const hereDir = dirname(fileURLToPath(import.meta.url))
    return resolve(hereDir, join('..', '..', 'sylo-image-gen', 'shared', 'library-store.ts'))
  } catch {
    return undefined
  }
}

/** Structural check on the dynamically imported module (never trust across packages). */
interface ImagegenStoreModule {
  resolveLibraryRoot?: (opts: VideoStillLinkOptions) => string | null
  imageFileAbs?: (libraryRoot: string, fileRel: string) => string
  getRecord?: (args: { image_id: string; workspaceCwd?: string; libraryRoot?: string }) => Promise<unknown>
}

function fail(reason: string): VideoStillLinkFailure {
  return { ok: false, reason }
}

/** The §3.5 canonical not-available wording, extended with the runtime cause. */
function notAvailableNote(cause: string): string {
  return (
    'sylo-image-gen not available — pass source_image_path (a local still) or enable the Images package, ' +
    `then re-run. Cause: ${cause}`
  )
}

/**
 * Resolve a sylo-image-gen library still by id — read-only, soft-fail (§3.5).
 * Never throws; every miss or degraded read comes back as `ok:false` + a
 * plain-language reason the generate tool can surface verbatim.
 */
export async function resolveVideoStillLink(
  fromImageId: string | undefined,
  options: VideoStillLinkOptions = {},
): Promise<VideoStillLink> {
  const id = (fromImageId ?? '').trim()
  if (!id) return fail('no from_image_id was given — pass an IMAGES-library image id (from sylo_image_gen_get/list) to seed i2v/loop renders.')

  // 1) Guarded dynamic import — the sibling package may be uninstalled; that is
  //    a soft-fail, not an error (§3.5).
  const modulePath = options.modulePath?.trim() || defaultImagegenStoreModulePath()
  if (!modulePath) return fail(notAvailableNote('this module could not locate its sibling package path'))
  let mod: ImagegenStoreModule
  try {
    const specifier = isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath
    mod = (await import(specifier)) as ImagegenStoreModule
  } catch (err) {
    return fail(notAvailableNote(err instanceof Error ? err.message : String(err)))
  }
  if (typeof mod?.getRecord !== 'function')
    return fail(notAvailableNote('the sylo-image-gen library-store module did not export the expected reader API'))

  // 2) Read the record through the sibling store (same workspace root options).
  try {
    const root =
      (typeof mod.resolveLibraryRoot === 'function' ? mod.resolveLibraryRoot(options) : null) ??
      (options.libraryRoot?.trim() ? resolve(options.libraryRoot.trim()) : null)
    const raw = await mod.getRecord({
      image_id: id,
      workspaceCwd: options.workspaceCwd,
      libraryRoot: options.libraryRoot,
    })
    if (!raw || typeof raw !== 'object')
      return fail(
        `No image library still with id "${id}" — run sylo_image_gen_list to find current ids ` +
          '(ids come from sylo_image_gen_list/generate JSON; records disappear when deleted).',
      )
    const rec = raw as { id?: unknown; file_rel?: unknown; width?: unknown; height?: unknown; bytes?: unknown; created_at?: unknown; prompt?: unknown; model?: unknown; preset?: unknown; tags?: unknown }
    const fileRel = typeof rec.file_rel === 'string' ? rec.file_rel.trim() : ''
    if (!fileRel || !root || typeof mod.imageFileAbs !== 'function')
      return fail(`The image record "${id}" carries no resolvable file — cannot use it as a video source still.`)
    const imagePath = mod.imageFileAbs(root, fileRel)
    const width = Number(rec.width) > 0 ? Number(rec.width) : 0
    const height = Number(rec.height) > 0 ? Number(rec.height) : 0
    if (!imagePath || width <= 0 || height <= 0)
      return fail(
        `The image record "${id}" has no readable pixel dimensions (${width}×${height}) — pick a different still or pass source_image_path.`,
      )
    return {
      ok: true,
      record: {
        id: String(rec.id ?? id),
        created_at: typeof rec.created_at === 'string' ? rec.created_at : '',
        prompt: typeof rec.prompt === 'string' ? rec.prompt : '',
        model: typeof rec.model === 'string' ? rec.model : '',
        preset: typeof rec.preset === 'string' ? rec.preset : '',
        width,
        height,
        bytes: Number.isFinite(Number(rec.bytes)) ? Number(rec.bytes) : 0,
        tags: Array.isArray(rec.tags) ? rec.tags.map((t) => String(t)) : [],
      },
      image_path: imagePath,
      library_root: root,
    }
  } catch (err) {
    return fail(
      `could not read the sylo-image-gen library (the record or its PNG may be damaged) — pass source_image_path instead. ` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}