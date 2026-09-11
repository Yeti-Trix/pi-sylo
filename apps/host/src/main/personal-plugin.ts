// Generic Sylo host-plugin loader — manifest-driven (`pi.sylo`), multi-plugin.
//
// Contract: .prd/SYLO_HOST_PLUGIN_MANIFEST.md (frozen 2026-09-10, think tank
// 5fc8416f Phase 1 Step 0). Any installed package whose package.json declares a
// TOP-LEVEL `pi.sylo` block gets its host plugin loaded at runtime — the host
// never compiles package code and never gates on package names. Vanilla Pi
// ignores `pi.sylo` entirely (it reads only the `pi` object), so a package
// carrying Sylo host UI stays a perfectly ordinary pi package.
//
// Discovery (deduped by resolved dir, in order):
//   1. settings.json packages[] local-path entries that declare `pi.sylo`
//   2. every package under <agentDir>/npm/node_modules that declares `pi.sylo`
//      (covers npm:<name> settings entries too)
//   3. Legacy fallback: the name-gated personal-bundle resolver (env var →
//      settings basename match → dev locations), id `personal`, entry
//      <dir>/host/index.js — kept so the pre-contract sylo-tools-personal
//      bundle keeps working unchanged.
//
// One plugin failing to load logs a warning and continues; host features are
// additive and never block Pi/broker startup. When nothing is installed this
// module is inert: `personal:*` IPC reports an empty op list and rpc throws
// `personal_plugin_unavailable` (companion maps that to HTTP 501).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Capabilities the host injects into each plugin (all generic, no domain names). */
export type PersonalPluginDi = {
  dataDirOverride: () => string | null
  dataRoot: () => string
  hostAgentDir: () => string
  /** Register a plugin's companion static-app root. Scoped per plugin: the
   *  companion server mounts it at /personal-app/<pluginId>/. */
  setPersonalAppRoot: (fn: () => string, pluginId: string) => void
}

/** The top-level `pi.sylo` package.json block (v1 — see the .prd contract). */
export type SyloHostManifest = {
  v?: number
  /** Package-relative path to the built ESM host entry. Required for activation. */
  host?: string
  /** Stable plugin id; defaults to package.json name. Unique across plugins. */
  id?: string
  /** Reserved (v1.1): declarative static ui root. */
  ui?: string
}

/** Contract every host entry implements. */
export type PersonalPlugin = {
  /** Op names this plugin handles (route bridge + companion RPC). */
  ops: string[]
  /** Declarative Settings card config (rendered by the host's generic card), or null. */
  settingsCard?: () => unknown
  /** Optional companion (phone) manifest: plugin tabs + chat-landing config. */
  companionManifest?: () => unknown
  /** Dispatch one op. Throws Error('unknown_op') for unhandled ops. */
  rpc: (op: string, payload: unknown) => unknown
  /** Plugin id (manifest id / package name / 'personal'). */
  id?: string
}

type PluginFactory = (di: PersonalPluginDi) => PersonalPlugin | null
type PluginDefaultExports = { createSyloHostPlugin?: PluginFactory; createPersonalPlugin?: PluginFactory }
type PluginModule = {
  createSyloHostPlugin?: PluginFactory
  createPersonalPlugin?: PluginFactory
  default?: PluginDefaultExports | PluginFactory
}

type Candidate = { dir: string; id: string; legacy: boolean; source: 'local' | 'npm' | 'legacy' }
type LoadedPlugin = { id: string; dir: string; plugin: PersonalPlugin }

const LEGACY_BUNDLE_NAMES = ['sylo-tools-personal', 'sylo-personal-tools']
const LEGACY_PLUGIN_ID = 'personal'

let plugins: LoadedPlugin[] | null = null
let loadPromise: Promise<LoadedPlugin[]> | null = null

// ── manifest helpers ────────────────────────────────────────────────────────

function readPackageJson(dir: string): Record<string, unknown> | null {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Top-level `pi.sylo` block only — the `pi` object must stay untouched for vanilla Pi. */
function syloBlock(pkg: Record<string, unknown> | null): SyloHostManifest | null {
  const block = pkg?.['pi.sylo']
  return block && typeof block === 'object' ? (block as SyloHostManifest) : null
}

// ── discovery ───────────────────────────────────────────────────────────────

/** settings.json packages[] local-path entries, in declared order. */
function settingsLocalPackageDirs(agentDir: string): string[] {
  const settingsPath = join(agentDir, 'settings.json')
  if (!existsSync(settingsPath)) return []
  try {
    const req = createRequire(import.meta.url)
    const raw = req(settingsPath) as { packages?: unknown }
    if (!Array.isArray(raw.packages)) return []
    const out: string[] = []
    for (const spec of raw.packages) {
      if (typeof spec !== 'string') continue
      const trimmed = spec.trim()
      if (!trimmed || /^(npm:|git:|https?:|ssh:|file:)/i.test(trimmed)) continue
      const abs = resolve(settingsPath, '..', trimmed)
      if (existsSync(abs) && statSync(abs).isDirectory()) out.push(abs)
    }
    return out
  } catch {
    return []
  }
}

/** Installed npm packages (Pi package manager root) that declare `pi.sylo`, alphabetical. */
function npmInstalledSyloDirs(agentDir: string): string[] {
  const root = join(agentDir, 'npm', 'node_modules')
  if (!existsSync(root)) return []
  const out: string[] = []
  const scan = (parent: string): void => {
    let entries: string[] = []
    try {
      entries = readdirSync(parent)
    } catch {
      return
    }
    for (const name of entries.sort((a, b) => a.localeCompare(b))) {
      const dir = join(parent, name)
      let isDir = false
      try {
        isDir = statSync(dir).isDirectory()
      } catch {
        continue
      }
      if (!isDir) continue
      // Scoped packages: descend one level (@scope/<name>).
      if (name.startsWith('@')) {
        let nested: string[] = []
        try {
          nested = readdirSync(dir)
        } catch {
          continue
        }
        for (const sub of nested.sort((a, b) => a.localeCompare(b))) {
          const subDir = join(dir, sub)
          try {
            if (statSync(subDir).isDirectory() && syloBlock(readPackageJson(subDir))) out.push(subDir)
          } catch {
            /* skip */
          }
        }
        continue
      }
      if (syloBlock(readPackageJson(dir))) out.push(dir)
    }
  }
  scan(root)
  return out
}

/** Pre-contract personal-bundle resolver (env var → settings basename → dev dirs). */
function legacyPersonalDir(agentDir: string): string | null {
  const env =
    process.env.SYLO_TOOLS_PERSONAL_DIR?.trim() ?? process.env.SYLO_PERSONAL_TOOLS_DIR?.trim()
  if (env) {
    const abs = resolve(env)
    if (existsSync(abs)) return abs
  }
  try {
    // Same source the launcher scripts check: <agentDir>/settings.json packages.
    const settingsPath = join(agentDir, 'settings.json')
    if (existsSync(settingsPath)) {
      const req = createRequire(import.meta.url)
      const raw = req(settingsPath) as { packages?: string[] }
      const entry = raw.packages?.find((p) =>
        LEGACY_BUNDLE_NAMES.includes(basename(p.replace(/\\/g, '/'))),
      )
      if (entry) {
        const abs = resolve(settingsPath, '..', entry)
        if (existsSync(abs)) return abs
      }
    }
  } catch {
    /* settings unreadable — fall through */
  }
  const fallback = join(homedir(), 'Documents', 'GitHub', 'sylo-tools-personal')
  if (existsSync(fallback)) return fallback
  const legacy = join(homedir(), 'Documents', 'GitHub', 'sylo-personal-tools')
  return existsSync(legacy) ? legacy : null
}

/** Ordered, deduped discovery of host-plugin directories. */
export function discoverHostPluginDirs(agentDir: string): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  const push = (dir: string, id: string, legacy: boolean, source: 'local' | 'npm' | 'legacy'): void => {
    const key = resolve(dir).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ dir: resolve(dir), id, legacy, source })
  }

  // 1. settings.json local-path entries declaring pi.sylo (operator's order).
  for (const dir of settingsLocalPackageDirs(agentDir)) {
    const pkg = readPackageJson(dir)
    const block = syloBlock(pkg)
    if (block?.host) {
      const name = typeof pkg?.name === 'string' ? pkg.name : basename(dir)
      push(dir, block.id?.trim() || name, false, 'local')
    }
  }
  // 2. npm-installed packages declaring pi.sylo (alphabetical, deterministic).
  for (const dir of npmInstalledSyloDirs(agentDir)) {
    const pkg = readPackageJson(dir)
    const block = syloBlock(pkg)
    if (block) {
      const name = typeof pkg?.name === 'string' ? pkg.name : basename(dir)
      push(dir, block.id?.trim() || name, false, 'npm')
    }
  }
  // 3. Legacy name-gated personal bundle (even without a pi.sylo block).
  const legacyDir = legacyPersonalDir(agentDir)
  if (legacyDir) push(legacyDir, LEGACY_PLUGIN_ID, true, 'legacy')

  return out
}

// ── loading ─────────────────────────────────────────────────────────────────

function entryPathFor(candidate: Candidate): string | null {
  if (!candidate.legacy) {
    const pkg = readPackageJson(candidate.dir)
    const block = syloBlock(pkg)
    if (!block?.host) return null
    return join(candidate.dir, block.host)
  }
  const entry = join(candidate.dir, 'host', 'index.js')
  return existsSync(entry) ? entry : null
}

async function loadAllPlugins(di: PersonalPluginDi): Promise<LoadedPlugin[]> {
  const candidates = discoverHostPluginDirs(di.hostAgentDir())
  const loaded: LoadedPlugin[] = []
  for (const candidate of candidates) {
    const entry = entryPathFor(candidate)
    if (!entry || !existsSync(entry)) continue
    try {
      const mod = (await import(pathToFileURL(entry).href)) as PluginModule
      const dflt = mod.default
      const defaultObj = dflt && typeof dflt === 'object' ? dflt : undefined
      const defaultFn = typeof dflt === 'function' ? dflt : undefined
      const factory =
        mod.createSyloHostPlugin ??
        defaultObj?.createSyloHostPlugin ??
        defaultFn ??
        mod.createPersonalPlugin ??
        defaultObj?.createPersonalPlugin
      if (typeof factory !== 'function') {
        throw new Error('plugin_entry_missing_createSyloHostPlugin')
      }
      // setPersonalAppRoot is scoped per plugin (companion mounts /personal-app/<id>/).
      const scopedDi: PersonalPluginDi = {
        ...di,
        setPersonalAppRoot: (fn) => di.setPersonalAppRoot(fn, candidate.id),
      }
      const plugin = factory(scopedDi)
      if (!plugin || typeof plugin.rpc !== 'function' || !Array.isArray(plugin.ops)) {
        throw new Error('plugin_invalid_shape')
      }
      plugin.id = plugin.id?.trim() || candidate.id
      loaded.push({ id: plugin.id, dir: candidate.dir, plugin })
    } catch (err) {
      console.warn(`[host-plugins] failed to load ${candidate.id} (${candidate.dir}):`, err)
    }
  }
  // Op-collision diagnostics: first-loaded wins, warn on duplicates.
  const seenOps = new Set<string>()
  for (const { id, plugin } of loaded) {
    for (const op of plugin.ops) {
      if (seenOps.has(op)) console.warn(`[host-plugins] op "${op}" declared by multiple plugins; first-loaded wins (${id} shadowed)`)
      else seenOps.add(op)
    }
  }
  return loaded
}

/** Load all host plugins once; resolves the first plugin (or null when none). */
export function loadPersonalPlugin(di: PersonalPluginDi): Promise<PersonalPlugin | null> {
  loadPromise ??= loadAllPlugins(di).then((all) => {
    plugins = all
    return all
  })
  return loadPromise.then((all) => all[0]?.plugin ?? null)
}

export function getPersonalPlugin(): PersonalPlugin | null {
  return plugins?.[0]?.plugin ?? null
}

/** Test-only: forget loaded plugins so a subsequent loadPersonalPlugin re-discovers. */
export function __resetHostPluginsForTests(): void {
  plugins = null
  loadPromise = null
}

// ── Capability-manager inventory (read-only; Phase 2 unified cards) ──────────

export type HostPluginPackageInfo = {
  /** Plugin id as loaded (manifest id / package name / 'personal'). */
  id: string
  /** Where it was discovered: settings.json local path, npm install, or legacy bundle. */
  source: 'local' | 'npm' | 'legacy'
  dir: string
  /** package.json identity (falls back to the folder basename). */
  name: string
  version: string | null
  description: string | null
  /** pi.sylo host entry file exists on disk. */
  entryPresent: boolean
  /** Currently loaded into the running host (loadPersonalPlugin has run). */
  loaded: boolean
}

/** Read-only inventory of discovered host-plugin packages for the Capability Manager. */
export function listHostPluginPackages(agentDir: string): HostPluginPackageInfo[] {
  const loadedIds = new Set((plugins ?? []).map((p) => p.id))
  return discoverHostPluginDirs(agentDir).map((candidate) => {
    const pkg = readPackageJson(candidate.dir)
    let entryPresent: boolean
    if (candidate.legacy) {
      entryPresent = existsSync(join(candidate.dir, 'host', 'index.js'))
    } else {
      const block = syloBlock(pkg)
      entryPresent = Boolean(block?.host) && existsSync(join(candidate.dir, block!.host!))
    }
    return {
      id: candidate.id,
      source: candidate.source,
      dir: candidate.dir,
      name: typeof pkg?.name === 'string' && pkg.name ? pkg.name : basename(candidate.dir),
      version: typeof pkg?.version === 'string' ? pkg.version : null,
      description: typeof pkg?.description === 'string' ? pkg.description : null,
      entryPresent,
      loaded: loadedIds.has(candidate.id),
    }
  })
}

/** Dispatch one op to the plugin that declared it (throws when absent / unknown). */
export async function personalPluginRpc(op: string, payload: unknown): Promise<unknown> {
  if (!loadPromise) throw new Error('personal_plugin_unavailable')
  const all = await loadPromise
  if (all.length === 0) throw new Error('personal_plugin_unavailable')
  const key = String(op ?? '').trim()
  const owner = all.find(({ plugin }) => plugin.ops.includes(key))
  if (!owner) throw new Error('unknown_op')
  return owner.plugin.rpc(key, payload)
}

/** Op list for the renderer route bridge (ordered union; empty until plugins load). */
export async function personalPluginOps(): Promise<string[]> {
  if (!loadPromise) return []
  const all = await loadPromise
  const seen = new Set<string>()
  for (const { plugin } of all) for (const op of plugin.ops) seen.add(op)
  return [...seen]
}

/**
 * Declarative Settings cards for every plugin that declares one.
 * Returns an ARRAY (v1 multi-plugin contract); renderer renders one card per entry.
 */
export async function personalPluginSettingsCard(): Promise<unknown[]> {
  if (!loadPromise) return []
  const all = await loadPromise
  const cards: unknown[] = []
  for (const { plugin } of all) {
    if (!plugin.settingsCard) continue
    try {
      const card = plugin.settingsCard()
      if (card) cards.push(card)
    } catch (err) {
      console.warn('[host-plugins] settingsCard() failed:', err)
    }
  }
  return cards
}

/**
 * Merged companion (phone) manifest, or null when no plugin declares one.
 * Tabs concatenate in load order; every tab gets a resolved appBase
 * (declared appBase honored only for the legacy id `personal`; new plugins
 * mount at /personal-app/<id>/). landing comes from the first manifest with one.
 */
export async function personalPluginCompanionManifest(): Promise<unknown | null> {
  if (!loadPromise) return null
  const all = await loadPromise
  const tabs: Record<string, unknown>[] = []
  let landing: unknown = null
  for (const { id, plugin } of all) {
    if (!plugin.companionManifest) continue
    let m: { appBase?: unknown; tabs?: unknown; landing?: unknown }
    try {
      const raw = plugin.companionManifest()
      if (!raw || typeof raw !== 'object') continue
      m = raw as typeof m
    } catch (err) {
      console.warn(`[host-plugins] companionManifest() failed for ${id}:`, err)
      continue
    }
    const base =
      id === LEGACY_PLUGIN_ID && typeof m.appBase === 'string'
        ? m.appBase
        : `/personal-app/${id}`
    if (Array.isArray(m.tabs)) {
      for (const rawTab of m.tabs) {
        if (!rawTab || typeof rawTab !== 'object') continue
        const tab = { ...(rawTab as Record<string, unknown>) }
        if (typeof tab.appBase !== 'string' || !tab.appBase) tab.appBase = base
        if (typeof tab.id === 'string' && tabs.some((t) => t.id === tab.id)) {
          tab.id = `${id}:${tab.id}`
        }
        tabs.push(tab)
      }
    }
    if (!landing && m.landing && typeof m.landing === 'object') landing = m.landing
  }
  if (tabs.length === 0) return null
  return { appBase: tabs[0]!['appBase'], tabs, ...(landing ? { landing } : {}) }
}