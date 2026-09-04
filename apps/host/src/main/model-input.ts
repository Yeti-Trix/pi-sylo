import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ModelInputTypes = ('text' | 'image')[]

type ModelsJsonProvider = {
  models?: ({ id: string; input?: ModelInputTypes } | string)[]
  modelOverrides?: Record<string, { input?: ModelInputTypes }>
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

/** Persist Pi `models.json` `input` for a provider/model id. */
export function writeModelInputTypes(
  agentDir: string,
  provider: string,
  modelId: string,
  visionCapable: boolean,
): { ok: true } | { ok: false; error: string } {
  const id = modelId.trim()
  if (!id) return { ok: false, error: 'Model id is required' }

  const p = modelsJsonPath(agentDir)
  let root: ModelsJsonRoot = readModelsJson(agentDir) ?? {}
  const providers = { ...(root.providers ?? {}) }
  const prov: ModelsJsonProvider = { ...(providers[provider] ?? {}) }
  const input: ModelInputTypes = visionCapable ? ['text', 'image'] : ['text']

  const rawList = prov.models ?? []
  const models: ({ id: string; input?: ModelInputTypes } | string)[] = [...rawList]
  let found = false
  for (let i = 0; i < models.length; i++) {
    const entry = models[i]
    if (typeof entry === 'string') {
      if (entry.trim() === id) {
        models[i] = { id, input }
        found = true
        break
      }
      continue
    }
    if (entry.id === id) {
      models[i] = { ...entry, id, input }
      found = true
      break
    }
  }
  if (!found) models.push({ id, input })

  prov.models = models
  const overrides = { ...(prov.modelOverrides ?? {}) }
  delete overrides[id]
  if (Object.keys(overrides).length > 0) {
    prov.modelOverrides = overrides
  } else {
    delete prov.modelOverrides
  }

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

function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ''))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ''))
}
