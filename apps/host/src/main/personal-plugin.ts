// Generic personal-plugin loader (app-level "user package" pattern).
//
// The Sylo app ships NO personal-domain code. Instead, an operator-installed
// bundle (e.g. sylo-personal-tools — health, news, reddit) provides a host
// plugin that this loader resolves and imports AT RUNTIME, the same way Pi
// loads packages from ~/.pi/agent/settings.json. App updates never overwrite
// the bundle; the bundle updates independently (git repo, `pi install`-style).
//
// Resolution order:
//   1. SYLO_PERSONAL_TOOLS_DIR env (set by the operator/launcher)
//   2. ~/.pi/agent/settings.json packages[] entries ending in
//      'sylo-personal-tools' (same source the launcher scripts check)
//   3. Default dev location: ~/Documents/GitHub/sylo-personal-tools
//
// The plugin entry is <bundle>/host/index.js — a plain-JS CJS bundle (built
// from host-src/ with esbuild and committed), so the host never compiles or
// type-checks personal code. When the bundle is absent this module is inert:
// the generic `personal:*` IPC handlers report an empty op list and rpc throws
// `personal_plugin_unavailable` (companion maps that to HTTP 501).
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Capabilities the host injects into the plugin (all generic, no domain names). */
export type PersonalPluginDi = {
  dataDirOverride: () => string | null
  dataRoot: () => string
  hostAgentDir: () => string
  setPersonalAppRoot: (fn: () => string) => void
}

/** Contract every personal bundle's host entry implements. */
export type PersonalPlugin = {
  /** Op names this plugin handles (route bridge + companion RPC). */
  ops: string[]
  /** Declarative Settings card config (rendered by the host's generic card), or null. */
  settingsCard: () => unknown
  /** Optional companion (phone) manifest: plugin tabs + chat-landing config. */
  companionManifest?: () => unknown
  /** Dispatch one op. Throws Error('unknown_op') for unhandled ops. */
  rpc: (op: string, payload: unknown) => unknown
}

type PluginModule = {
  createPersonalPlugin?: (di: PersonalPluginDi) => PersonalPlugin
  default?: { createPersonalPlugin?: (di: PersonalPluginDi) => PersonalPlugin }
}

let plugin: PersonalPlugin | null = null
let loadPromise: Promise<PersonalPlugin | null> | null = null

/** Find the installed personal-tools bundle, or null when absent. */
export function resolvePersonalToolsDir(): string | null {
  // Renamed 2026-09-02: sylo-personal-tools → sylo-tools-personal. Accept the
  // new env var first, then the legacy one as a back-compat alias.
  const env = process.env.SYLO_TOOLS_PERSONAL_DIR?.trim() ?? process.env.SYLO_PERSONAL_TOOLS_DIR?.trim()
  if (env) {
    const abs = resolve(env)
    if (existsSync(abs)) return abs
  }
  try {
    // Same source the launcher scripts check: ~/.pi/agent/settings.json packages.
    const settingsPath = join(homedir(), '.pi', 'agent', 'settings.json')
    if (existsSync(settingsPath)) {
      const req = createRequire(import.meta.url)
      const raw = req(settingsPath) as { packages?: string[] }
      // New name primary; legacy name kept so old installs keep working.
      const entry = raw.packages?.find((p) =>
        ['sylo-tools-personal', 'sylo-personal-tools'].includes(basename(p.replace(/\\/g, '/'))))
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
  // Legacy dev location (pre-rename installs).
  const legacy = join(homedir(), 'Documents', 'GitHub', 'sylo-personal-tools')
  return existsSync(legacy) ? legacy : null
}

/** Load the plugin once; null when no bundle is installed (public/controls machine). */
export function loadPersonalPlugin(di: PersonalPluginDi): Promise<PersonalPlugin | null> {
  if (plugin) return Promise.resolve(plugin)
  loadPromise ??= (async () => {
    const dir = resolvePersonalToolsDir()
    if (!dir) return null
    const entry = join(dir, 'host', 'index.js')
    if (!existsSync(entry)) return null
    try {
      const mod = (await import(pathToFileURL(entry).href)) as PluginModule
      const factory = mod.createPersonalPlugin ?? mod.default?.createPersonalPlugin
      if (!factory) throw new Error('plugin_entry_missing_createPersonalPlugin')
      plugin = factory(di)
      return plugin
    } catch (err) {
      console.warn('[personal-plugin] failed to load bundle:', err)
      return null
    }
  })()
  return loadPromise
}

export function getPersonalPlugin(): PersonalPlugin | null {
  return plugin
}

/** Dispatch one op through the plugin (throws when bundle absent / op unknown). */
export async function personalPluginRpc(op: string, payload: unknown): Promise<unknown> {
  const p = await loadPromise
  if (!p) throw new Error('personal_plugin_unavailable')
  if (!p.ops.includes(String(op ?? '').trim())) throw new Error('unknown_op')
  return p.rpc(op, payload)
}

/** Op list for the renderer route bridge (empty until the plugin loads). */
export async function personalPluginOps(): Promise<string[]> {
  const p = await loadPromise
  return p ? p.ops : []
}

/** Declarative Settings card config, or null when no plugin. */
export async function personalPluginSettingsCard(): Promise<unknown> {
  const p = await loadPromise
  return p ? p.settingsCard() : null
}

/** Companion (phone) manifest, or null when no plugin / none declared. */
export async function personalPluginCompanionManifest(): Promise<unknown> {
  const p = await loadPromise
  return p?.companionManifest ? p.companionManifest() : null
}

