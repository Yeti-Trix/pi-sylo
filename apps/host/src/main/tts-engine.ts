/**
 * Run sylo-tts Python synthesis from the Electron main process (Speech route UI).
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

import { parsePythonScriptJsonStdout } from '../shared/python-script-json.js'
import { resolvePythonExecutable } from '../shared/resolve-python.js'
import { DEFAULT_TTS_CONFIG } from './tts-config.js'
import { installOptionalPackagePythonDeps } from './sylo-optional-packages-host.js'

const execFileAsync = promisify(execFile)

export type TtsSynthOptions = {
  kokoroSpeed: number
  orpheusTemperature: number
  orpheusTopP: number
}

function clampNum(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function synthOptionsFromRecords(
  cfg: Record<string, unknown>,
  overrides?: Partial<TtsSynthOptions>,
): TtsSynthOptions {
  const d = DEFAULT_TTS_CONFIG
  return {
    kokoroSpeed: clampNum(
      overrides?.kokoroSpeed ?? cfg.kokoro_speed ?? d.kokoro_speed,
      Number(d.kokoro_speed),
      0.5,
      2,
    ),
    orpheusTemperature: clampNum(
      overrides?.orpheusTemperature ?? cfg.orpheus_temperature ?? d.orpheus_temperature,
      Number(d.orpheus_temperature),
      0.3,
      1.2,
    ),
    orpheusTopP: clampNum(
      overrides?.orpheusTopP ?? cfg.orpheus_top_p ?? d.orpheus_top_p,
      Number(d.orpheus_top_p),
      0.7,
      1,
    ),
  }
}

export type TtsVoiceRow = {
  id: string
  label: string
  backend: 'kokoro' | 'orpheus'
  kokoroVoice?: string
  kokoroLang?: string
  orpheusVoice?: string
}

type CatalogFile = {
  default_voice_id?: string
  disabled_backends?: string[]
  voices?: Array<{
    id?: string
    label?: string
    backend?: string
    kokoro_voice?: string
    kokoro_lang?: string
    orpheus_voice?: string
  }>
}

let ttsPythonDepsReady: Promise<void> | null = null
let orpheusDepsReady: Promise<void> | null = null

function resolvePython(configured?: string): string {
  const t = configured?.trim()
  if (t) return t
  // No explicit path configured: prefer the shared resolver (Python 3.12) so
  // TTS native deps install against the same interpreter as other packages.
  return resolvePythonExecutable()
}

/**
 * Deep probe: `from kokoro import KPipeline` runs the real import chain
 * (kokoro → transformers AlbertModel → scipy/numpy), not just top-level module
 * metadata — a mixed/partial env can pass `import kokoro` and still break on
 * the first Generate. Model weights are NOT downloaded at this stage.
 */
const TTS_DEPS_PROBE =
  'import soundfile as sf, numpy; from kokoro import KPipeline'

async function probeTtsDepsWith(probeCode: string, python: string): Promise<string | null> {
  try {
    await execFileAsync(python, ['-c', probeCode], {
      windowsHide: true,
      timeout: 120_000,
    })
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stderr =
      err !== null && typeof err === 'object' && 'stderr' in err ?
        String((err as { stderr?: string }).stderr ?? '')
      : ''
    return [stderr.trim(), message.trim()].filter(Boolean).join('\n')
  }
}

function tail(text: string, max = 1500): string {
  const s = text.trim()
  return s.length <= max ? s : `…${s.slice(-max)}`
}

async function ensureTtsPythonDeps(repoRoot: string, python: string): Promise<void> {
  if (!ttsPythonDepsReady) {
    ttsPythonDepsReady = (async () => {
      const firstProbe = await probeTtsDepsWith(TTS_DEPS_PROBE, python)
      if (firstProbe === null) return
      const pip = await installOptionalPackagePythonDeps(repoRoot, 'sylo-tts')
      if (!pip.ok) {
        throw new Error(
          `TTS Python deps install failed.\n${pip.error}\n\n` +
            `First import failure (root cause):
${tail(firstProbe)}`,
        )
      }
      // Re-verify after install: a corrupt "already satisfied" env can pass pip
      // and still fail to import. Surface the real import error if so.
      const retryProbe = await probeTtsDepsWith(TTS_DEPS_PROBE, python)
      if (retryProbe !== null) {
        throw new Error(
          `TTS Python deps still failing after install.\n${tail(retryProbe)}\n\n` +
            'Try: pip install --user --force-reinstall -r packages/sylo-tts/scripts/requirements.txt',
        )
      }
    })()
  }
  try {
    await ttsPythonDepsReady
  } catch (err) {
    // Drop the cached (rejected) promise so the next Generate re-probes and can
    // recover after the operator repairs pip deps — no app restart required.
    ttsPythonDepsReady = null
    throw err
  }
}

const ORPHEUS_DEPS_PROBE = 'from orpheus_cpp import OrpheusCpp; import llama_cpp'

async function ensureOrpheusDeps(repoRoot: string, python: string): Promise<void> {
  if (!orpheusDepsReady) {
    orpheusDepsReady = (async () => {
      const firstProbe = await probeTtsDepsWith(ORPHEUS_DEPS_PROBE, python)
      if (firstProbe === null) return
      const optReq = join('packages', 'sylo-tts', 'scripts', 'requirements-orpheus.txt')
      const reqPath = join(repoRoot, optReq)
      if (!existsSync(reqPath)) {
        throw new Error(
          'Orpheus Python deps missing and requirements-orpheus.txt not found in the dev repo.',
        )
      }
      try {
        await execFileAsync(python, ['-m', 'pip', 'install', '-r', reqPath], {
          cwd: join(repoRoot, 'packages', 'sylo-tts', 'scripts'),
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          timeout: 600_000,
        })
      } catch (pipErr) {
        const e = pipErr as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
        throw new Error(
          `Orpheus Python deps install failed.\n` +
            `${(e.stderr || e.stdout || e.message || '').trim() || firstProbe}\n\n` +
            'Manual install: pip install -r packages/sylo-tts/scripts/requirements-orpheus.txt',
        )
      }
      const retryProbe = await probeTtsDepsWith(ORPHEUS_DEPS_PROBE, python)
      if (retryProbe !== null) {
        throw new Error(
          `Orpheus Python deps still failing after install.\n${tail(retryProbe)}\n\n` +
            'Try: pip install --user --force-reinstall -r packages/sylo-tts/scripts/requirements-orpheus.txt',
        )
      }
    })()
  }
  try {
    await orpheusDepsReady
  } catch (err) {
    orpheusDepsReady = null
    throw err
  }
}

function readCatalogFile(path: string): TtsVoiceRow[] {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CatalogFile
    const disabled = new Set(
      (parsed.disabled_backends ?? []).filter(
        (b): b is 'kokoro' | 'orpheus' => b === 'kokoro' || b === 'orpheus',
      ),
    )
    const out: TtsVoiceRow[] = []
    for (const row of parsed.voices ?? []) {
      if (!row?.id || !row.label || !row.backend) continue
      if (row.backend !== 'kokoro' && row.backend !== 'orpheus') continue
      if (disabled.has(row.backend)) continue
      const v: TtsVoiceRow = { id: row.id, label: row.label, backend: row.backend }
      if (row.kokoro_voice) v.kokoroVoice = row.kokoro_voice
      if (row.kokoro_lang) v.kokoroLang = row.kokoro_lang
      if (row.orpheus_voice) v.orpheusVoice = row.orpheus_voice
      out.push(v)
    }
    return out
  } catch {
    return []
  }
}

export function syloTtsPackageRoot(repoRoot: string): string {
  return join(repoRoot, 'packages', 'sylo-tts')
}

export function listTtsVoices(repoRoot: string): TtsVoiceRow[] {
  const catalogPath = join(syloTtsPackageRoot(repoRoot), 'voices', 'catalog.json')
  return readCatalogFile(catalogPath)
}

export function resolveTtsVoice(repoRoot: string, voiceId: string): TtsVoiceRow | null {
  return listTtsVoices(repoRoot).find((v) => v.id === voiceId) ?? null
}

export type TtsGenerateResult =
  | { ok: true; wavPath: string; durationMs: number; voiceId: string; voiceLabel: string }
  | { ok: false; error: string }

function formatTtsExecError(err: unknown, stderr: string): string {
  const message = err instanceof Error ? err.message : String(err)
  const detail = stderr.trim()
  const importHint =
    /ModuleNotFoundError|ImportError|No module named/i.test(`${message}\n${detail}`) ?
      '\nRe-enable Speech in Capability manager to auto-install Python deps, or run:\n' +
        'pip install -r packages/sylo-tts/scripts/requirements.txt'
    : ''
  return `${message}${detail ? `\n${detail}` : ''}${importHint}`
}

export async function generateTtsWav(
  repoRoot: string,
  args: {
    text: string
    voiceId: string
    pythonPath?: string
    /** When set, write into this directory; otherwise temp (caller may delete). */
    outputDir?: string
    kokoroSpeed?: number
    orpheusTemperature?: number
    orpheusTopP?: number
  },
): Promise<TtsGenerateResult> {
  const text = args.text.trim()
  if (!text) return { ok: false, error: 'text is required' }

  const voice = resolveTtsVoice(repoRoot, args.voiceId) ?? listTtsVoices(repoRoot)[0]
  if (!voice) return { ok: false, error: 'No TTS voices enabled in catalog' }

  const packageRoot = syloTtsPackageRoot(repoRoot)
  const scriptPath = join(packageRoot, 'scripts', 'tts_synthesize.py')
  if (!existsSync(scriptPath)) {
    return { ok: false, error: `TTS script missing: ${scriptPath}` }
  }

  const python = resolvePython(args.pythonPath)
  try {
    await ensureTtsPythonDeps(repoRoot, python)
    if (voice.backend === 'orpheus') await ensureOrpheusDeps(repoRoot, python)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const outDir =
    args.outputDir?.trim() ?
      args.outputDir.trim()
    : mkdtempSync(join(tmpdir(), 'sylo-tts-route-'))
  const outPath = join(outDir, `${randomUUID()}.wav`)
  const pyArgs = ['--backend', voice.backend, '--text', text, '--out', outPath]
  if (voice.backend === 'kokoro') {
    pyArgs.push('--kokoro-voice', voice.kokoroVoice ?? 'am_michael')
    if (voice.kokoroLang) pyArgs.push('--kokoro-lang', voice.kokoroLang)
    pyArgs.push('--kokoro-speed', String(args.kokoroSpeed ?? 1))
  } else if (voice.backend === 'orpheus') {
    pyArgs.push('--orpheus-voice', voice.orpheusVoice ?? 'leo')
    pyArgs.push('--orpheus-temperature', String(args.orpheusTemperature ?? 0.8))
    pyArgs.push('--orpheus-top-p', String(args.orpheusTopP ?? 0.95))
  }

  try {
    const { stdout, stderr } = await execFileAsync(python, [scriptPath, ...pyArgs], {
      cwd: packageRoot,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      timeout: 600_000,
    })
    const trimmed = stdout.trim()
    if (!trimmed) {
      return { ok: false, error: stderr.trim() || 'TTS produced no output' }
    }
    let data: Record<string, unknown>
    try {
      data = parsePythonScriptJsonStdout(trimmed)
    } catch (parseErr) {
      const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      const stderrNote = stderr.trim() ? `\n${stderr.trim()}` : ''
      return { ok: false, error: `${parseMsg}${stderrNote}` }
    }
    if (data.ok !== true) {
      return {
        ok: false,
        error: typeof data.error === 'string' ? data.error : 'TTS failed',
      }
    }
    const wavPath = typeof data.wavPath === 'string' ? data.wavPath : outPath
    const durationMs = typeof data.durationMs === 'number' ? data.durationMs : 0
    return { ok: true, wavPath, durationMs, voiceId: voice.id, voiceLabel: voice.label }
  } catch (err) {
    if (!args.outputDir) {
      try {
        rmSync(outDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    const stderr =
      err !== null && typeof err === 'object' && 'stderr' in err ?
        String((err as { stderr?: string }).stderr ?? '')
      : ''
    return { ok: false, error: formatTtsExecError(err, stderr) }
  }
}
