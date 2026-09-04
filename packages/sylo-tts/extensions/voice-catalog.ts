/**
 * Unified voice catalog — maps voice_id → backend params.
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { PACKAGE_ROOT } from './python-runner.ts'

export type TtsBackend = 'kokoro' | 'orpheus'

export type CatalogVoice = {
  id: string
  label: string
  backend: TtsBackend
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

function catalogPath(): string {
  return join(PACKAGE_ROOT, 'voices', 'catalog.json')
}

function localOverridesPath(): string {
  return join(homedir(), '.pi', 'agent', 'sylo-tts', 'voices.local.json')
}

function readCatalogFileRaw(path: string): CatalogFile | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CatalogFile
  } catch {
    return null
  }
}

function disabledBackendsFromCatalog(): Set<TtsBackend> {
  const parsed = readCatalogFileRaw(catalogPath())
  const out = new Set<TtsBackend>()
  for (const backend of parsed?.disabled_backends ?? []) {
    if (backend === 'kokoro' || backend === 'orpheus') out.add(backend)
  }
  return out
}

export function isBackendEnabled(backend: TtsBackend): boolean {
  return !disabledBackendsFromCatalog().has(backend)
}

function parseVoiceRow(row: NonNullable<CatalogFile['voices']>[number]): CatalogVoice | null {
  if (!row?.id || !row.label || !row.backend) return null
  if (row.backend !== 'kokoro' && row.backend !== 'orpheus') return null
  const base: CatalogVoice = {
    id: row.id,
    label: row.label,
    backend: row.backend,
  }
  if (row.backend === 'kokoro' && row.kokoro_voice) {
    base.kokoroVoice = row.kokoro_voice
    if (row.kokoro_lang) base.kokoroLang = row.kokoro_lang
  }
  if (row.backend === 'orpheus' && row.orpheus_voice) {
    base.orpheusVoice = row.orpheus_voice
  }
  return base
}

function readCatalogFile(path: string): CatalogVoice[] {
  const parsed = readCatalogFileRaw(path)
  if (!parsed) return []
  const disabled = disabledBackendsFromCatalog()
  const voices = parsed.voices ?? []
  const out: CatalogVoice[] = []
  for (const row of voices) {
    const v = parseVoiceRow(row)
    if (v && !disabled.has(v.backend)) out.push(v)
  }
  return out
}

/** All enabled catalog voices (bundled + optional local overrides by id). */
export function listCatalogVoices(): CatalogVoice[] {
  const bundled = readCatalogFile(catalogPath())
  const localPath = localOverridesPath()
  const localParsed = readCatalogFileRaw(localPath)
  const disabled = disabledBackendsFromCatalog()
  const local: CatalogVoice[] = []
  for (const row of localParsed?.voices ?? []) {
    const v = parseVoiceRow(row)
    if (v && !disabled.has(v.backend)) local.push(v)
  }
  const byId = new Map<string, CatalogVoice>()
  for (const v of bundled) byId.set(v.id, v)
  for (const v of local) byId.set(v.id, v)
  return [...byId.values()]
}

export function resolveVoice(voiceId: string): CatalogVoice | null {
  const id = voiceId.trim()
  if (!id) return null
  return listCatalogVoices().find((v) => v.id === id) ?? null
}

export function defaultVoiceIdFromCatalog(): string {
  const parsed = readCatalogFileRaw(catalogPath())
  const enabled = listCatalogVoices()
  const preferred =
    typeof parsed?.default_voice_id === 'string' ? parsed.default_voice_id.trim() : ''
  if (preferred && enabled.some((v) => v.id === preferred)) return preferred
  return enabled[0]?.id ?? 'kokoro-am_michael'
}

export function catalogPathForHost(): string {
  return catalogPath()
}

export function packageRootForHost(): string {
  return PACKAGE_ROOT
}
