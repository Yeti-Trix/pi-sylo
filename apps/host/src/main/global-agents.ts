/**
 * Global AI instructions — source of truth in the universal workspace.
 *
 * The global Pi context file (`~/.pi/agent/AGENTS.md`) is what every Pi session
 * in every workspace loads. Sylo treats it as a *deployed artifact*: the source
 * of truth lives in the built-in universal workspace (the primary workspace row,
 * default folder `sylo-user`) under `agent/AGENTS.md`, so it is git-synced with
 * the rest of the operator's user data and travels between machines (clone the
 * workspace on each machine — the folder may be renamed, e.g. `sylo-work`; the
 * registry resolves the path, not the name).
 *
 * Deploy contract (one-way: universal workspace → global Pi directory):
 *   - On Sylo startup and on save in Settings, the source file is copied to
 *     `<agentDir>/AGENTS.md`, then `ensureGlobalAgentsMd()` refreshes the
 *     machine-managed pointer block inside the deployed copy (the block holds a
 *     per-machine path, so it is rewritten on every deploy — never edit it by hand).
 *   - If the source is missing but a deployed copy exists (fresh Sylo install on
 *     a machine that already has Pi configured), the deployed copy is *adopted*
 *     as the source — never clobbered.
 *   - If neither exists, a starter template is seeded.
 *
 * Never put personal or employer-specific content in tool code; instructions and
 * credentials are data in the universal workspace (see AGENTS.md "Tool data
 * invariant").
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Source file location, relative to the universal (primary) workspace folder. */
export const GLOBAL_AGENTS_RELATIVE_DIR = 'agent'
export const GLOBAL_AGENTS_RELATIVE_PATH = 'agent/AGENTS.md'

export function globalAgentsSourcePath(primaryDir: string): string {
  return join(primaryDir, GLOBAL_AGENTS_RELATIVE_DIR, 'AGENTS.md')
}

export function globalAgentsTargetPath(agentDir: string): string {
  return join(agentDir, 'AGENTS.md')
}

/** Starter template for a fresh install where neither source nor target exists. */
export const GLOBAL_AGENTS_SEED = `# Global AI instructions

Global context for every Sylo chat, in every workspace. Edit this in
Sylo → Settings → Global AI instructions; Sylo deploys it to the global
Pi directory on startup and on save.

Principles, tone, and standing instructions live here. Machine- or
workspace-specific instructions belong in that workspace's AGENTS.md
instead.
`

export interface GlobalAgentsDeployResult {
  sourcePath: string
  targetPath: string
  /** deployed: source → target. adopted: target → source (first run on a new machine). seeded: template created in both. unchanged: source and target already identical. error: see `error`. */
  action: 'deployed' | 'adopted' | 'seeded' | 'unchanged' | 'error'
  error?: string
}

function readOrNull(p: string): string | null {
  try {
    if (!existsSync(p)) return null
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/**
 * One-way deploy: universal workspace source → global Pi directory target.
 * - Source missing + target exists → adopt (target content becomes the source; target untouched).
 * - Both missing → seed the starter template into source and target.
 * - Source exists → write target verbatim when it differs (pointer-block refresh
 *   is the caller's job, via `ensureGlobalAgentsMd()`).
 */
export function deployGlobalAgents(opts: {
  primaryDir: string
  agentDir: string
}): GlobalAgentsDeployResult {
  const sourcePath = globalAgentsSourcePath(opts.primaryDir)
  const targetPath = globalAgentsTargetPath(opts.agentDir)
  try {
    const sourceContent = readOrNull(sourcePath)
    if (sourceContent !== null) {
      const targetContent = readOrNull(targetPath)
      if (targetContent === sourceContent) {
        return { sourcePath, targetPath, action: 'unchanged' }
      }
      mkdirSync(opts.agentDir, { recursive: true })
      writeFileSync(targetPath, sourceContent, 'utf8')
      return { sourcePath, targetPath, action: 'deployed' }
    }

    const targetContent = readOrNull(targetPath)
    if (targetContent !== null) {
      // Adopt: bring the machine's existing global instructions into the
      // universal workspace so they are versioned and shareable. Target is
      // left as-is (it already matches).
      mkdirSync(join(opts.primaryDir, GLOBAL_AGENTS_RELATIVE_DIR), { recursive: true })
      writeFileSync(sourcePath, targetContent, 'utf8')
      return { sourcePath, targetPath, action: 'adopted' }
    }

    // Fresh install: neither file exists.
    mkdirSync(join(opts.primaryDir, GLOBAL_AGENTS_RELATIVE_DIR), { recursive: true })
    writeFileSync(sourcePath, GLOBAL_AGENTS_SEED, 'utf8')
    mkdirSync(opts.agentDir, { recursive: true })
    writeFileSync(targetPath, GLOBAL_AGENTS_SEED, 'utf8')
    return { sourcePath, targetPath, action: 'seeded' }
  } catch (e) {
    return {
      sourcePath,
      targetPath,
      action: 'error',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Overwrite the source file from an editor save (Settings panel). Returns an error string on failure. */
export function writeGlobalAgentsSource(
  primaryDir: string,
  content: string,
): { ok: true; sourcePath: string } | { ok: false; error: string } {
  try {
    const sourcePath = globalAgentsSourcePath(primaryDir)
    mkdirSync(join(primaryDir, GLOBAL_AGENTS_RELATIVE_DIR), { recursive: true })
    writeFileSync(sourcePath, content, 'utf8')
    return { ok: true, sourcePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface GlobalAgentsStatus {
  sourcePath: string
  targetPath: string
  sourceExists: boolean
  targetExists: boolean
  /** True when source and target content are byte-identical. */
  inSync: boolean
  content: string
  lastDeployedAt: string | null
}

export function readGlobalAgentsStatus(opts: {
  primaryDir: string
  agentDir: string
  lastDeployedAt?: string | null
}): GlobalAgentsStatus {
  const sourcePath = globalAgentsSourcePath(opts.primaryDir)
  const targetPath = globalAgentsTargetPath(opts.agentDir)
  const sourceContent = readOrNull(sourcePath)
  const targetContent = readOrNull(targetPath)
  const sourceExists = sourceContent !== null
  const targetExists = targetContent !== null
  const inSync = sourceExists && targetExists && sourceContent === targetContent
  return {
    sourcePath,
    targetPath,
    sourceExists,
    targetExists,
    inSync,
    content: sourceContent ?? targetContent ?? GLOBAL_AGENTS_SEED,
    lastDeployedAt: opts.lastDeployedAt ?? null,
  }
}