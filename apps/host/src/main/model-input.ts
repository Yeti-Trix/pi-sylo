import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ModelInputTypes = ('text' | 'image')[]

/** The subset of Pi's model definition Sylo writes; unknown keys are preserved on patch. */
type ModelEntry = {
  id: string
  input?: ModelInputTypes
  contextWindow?: number
  maxTokens?: number
}

type ModelsJsonProvider = {
  models?: (ModelEntry | string)[]
  modelOverrides?: Record<string, Partial<Omit<ModelEntry, 'id'>>>
}

type ModelsJsonRoot = {
  providers?: Record<string, ModelsJsonProvider>
}

function modelsJsonPath(agentDir: string): string {
  return join(agentDir, 'models.json')
}

function readModelsJson(agentDir: string): ModelsJsonRoot | null {
  const p = modelsJsonPath(agentDir)
  if (!existsSync(p)) return null
  try {
    const raw = readFileSync(p, 'utf8')
    return JSON.parse(stripJsonComments(raw)) as ModelsJsonRoot
  } catch {
    return null
  }
}

function normalizeInputTypes(input: ModelInputTypes | undefined): ModelInputTypes {
  if (!input || input.length === 0) return ['text']
  const hasImage = input.includes('image')
  return hasImage ? ['text', 'image'] : ['text']
}

function visionFromInput(input: ModelInputTypes): boolean {
  return input.includes('image')
}

/** Read Pi `models.json` and resolve `input` for a provider/model id (defaults to text-only). */
export function resolveModelInputTypes(agentDir: string, provider: string, modelId: string): ModelInputTypes {
  return readModelInputConfig(agentDir, provider, modelId).input
}

/** Whether `input` was explicitly set in `models.json` (vs Pi default text-only). */
export function readModelInputConfig(
  agentDir: string,
  provider: string,
  modelId: string,
): { input: ModelInputTypes; explicit: boolean; visionCapable: boolean } {
  const j = readModelsJson(agentDir)
  if (!j) {
    return { input: ['text'], explicit: false, visionCapable: false }
  }
  const prov = j.providers?.[provider]
  if (!prov) {
    return { input: ['text'], explicit: false, visionCapable: false }
  }
  const override = prov.modelOverrides?.[modelId]?.input
  if (override !== undefined) {
    const input = normalizeInputTypes(override)
    return { input, explicit: true, visionCapable: visionFromInput(input) }
  }
  const rawList = prov.models ?? []
  for (const entry of rawList) {
    if (typeof entry === 'string') {
      if (entry.trim() === modelId) {
        return { input: ['text'], explicit: false, visionCapable: false }
      }
      continue
    }
    if (entry.id === modelId) {
      if (entry.input !== undefined) {
        const input = normalizeInputTypes(entry.input)
        return { input, explicit: true, visionCapable: visionFromInput(input) }
      }
      return { input: ['text'], explicit: false, visionCapable: false }
    }
  }
  return { input: ['text'], explicit: false, visionCapable: false }
}

/** Read Pi `models.json` `contextWindow` for a provider/model id (null = Pi's own default). */
export function readModelContextWindow(
  agentDir: string,
  provider: string,
  modelId: string,
): number | null {
  const prov = readModelsJson(agentDir)?.providers?.[provider]
  if (!prov) return null
  const override = prov.modelOverrides?.[modelId]?.contextWindow
  if (typeof override === 'number' && override > 0) return override
  for (const entry of prov.models ?? []) {
    if (typeof entry === 'string' || entry.id !== modelId) continue
    return typeof entry.contextWindow === 'number' && entry.contextWindow > 0
      ? entry.contextWindow
      : null
  }
  return null
}

/**
 * Merge `patch` into a provider/model entry in `models.json`, creating it if absent.
 *
 * Patched keys are dropped from `modelOverrides` so the `models[]` entry is the one
 * that wins in Pi. Only the patched keys are removed — an override that carries an
 * unrelated key survives, which keeps the `input` and `contextWindow` writers from
 * clobbering each other.
 */
function patchModelEntry(
  agentDir: string,
  provider: string,
  modelId: string,
  patch: Partial<Omit<ModelEntry, 'id'>>,
): { ok: true } | { ok: false; error: string } {
  const id = modelId.trim()
  if (!id) return { ok: false, error: 'Model id is required' }

  const p = modelsJsonPath(agentDir)
  let root: ModelsJsonRoot = readModelsJson(agentDir) ?? {}
  const providers = { ...(root.providers ?? {}) }
  const prov: ModelsJsonProvider = { ...(providers[provider] ?? {}) }

  const models: (ModelEntry | string)[] = [...(prov.models ?? [])]
  let found = false
  for (let i = 0; i < models.length; i++) {
    const entry = models[i]
    if (typeof entry === 'string') {
      if (entry.trim() === id) {
        models[i] = { id, ...patch }
        found = true
        break
      }
      continue
    }
    if (entry.id === id) {
      models[i] = { ...entry, id, ...patch }
      found = true
      break
    }
  }
  if (!found) models.push({ id, ...patch })

  prov.models = models
  const overrides = { ...(prov.modelOverrides ?? {}) }
  const existing = overrides[id]
  if (existing) {
    const remaining = { ...existing }
    for (const key of Object.keys(patch) as (keyof Omit<ModelEntry, 'id'>)[]) {
      delete remaining[key]
    }
    if (Object.keys(remaining).length > 0) overrides[id] = remaining
    else delete overrides[id]
  }
  if (Object.keys(overrides).length > 0) prov.modelOverrides = overrides
  else delete prov.modelOverrides

  providers[provider] = prov
  root = { ...root, providers }

  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(root, null, 2), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Persist Pi `models.json` `input` for a provider/model id. */
export function writeModelInputTypes(
  agentDir: string,
  provider: string,
  modelId: string,
  visionCapable: boolean,
): { ok: true } | { ok: false; error: string } {
  return patchModelEntry(agentDir, provider, modelId, {
    input: visionCapable ? ['text', 'image'] : ['text'],
  })
}

/**
 * Pi's own fallback cap (`provider-composer`: `definition.maxTokens ?? 16384`).
 *
 * A model that Pi never composed — one absent from `models.json` — reaches Ollama with no
 * `max_tokens`, and Ollama then generates until the context window fills. A degenerate loop
 * measured 35,366 tokens in a single reply at 73 tok/s before anything stopped it.
 */
export const DEFAULT_MODEL_MAX_TOKENS = 16384

/** Read Pi `models.json` `maxTokens` for a provider/model id (null = unset). */
export function readModelMaxTokens(
  agentDir: string,
  provider: string,
  modelId: string,
): number | null {
  const prov = readModelsJson(agentDir)?.providers?.[provider]
  if (!prov) return null
  const override = prov.modelOverrides?.[modelId]?.maxTokens
  if (typeof override === 'number' && override > 0) return override
  for (const entry of prov.models ?? []) {
    if (typeof entry === 'string' || entry.id !== modelId) continue
    return typeof entry.maxTokens === 'number' && entry.maxTokens > 0 ? entry.maxTokens : null
  }
  return null
}

/** Persist Pi `models.json` `maxTokens` for a provider/model id. */
export function writeModelMaxTokens(
  agentDir: string,
  provider: string,
  modelId: string,
  maxTokens: number,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return { ok: false, error: 'Max tokens must be a positive number' }
  }
  return patchModelEntry(agentDir, provider, modelId, { maxTokens: Math.floor(maxTokens) })
}

/** Persist Pi `models.json` `contextWindow` for a provider/model id. */
export function writeModelContextWindow(
  agentDir: string,
  provider: string,
  modelId: string,
  contextWindow: number,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return { ok: false, error: 'Context window must be a positive number' }
  }
  return patchModelEntry(agentDir, provider, modelId, {
    contextWindow: Math.floor(contextWindow),
  })
}

function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ''))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ''))
}
