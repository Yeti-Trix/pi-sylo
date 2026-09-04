import { existsSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep, join } from 'node:path'

import { normalizeSkillCapabilityPath, skillDirFromReportedPath } from '../shared/sylo-capability-paths.js'
import { readSyloDisabledCapabilities, writeSyloDisabledCapabilities } from './disabled-capabilities-store.js'
import * as db from './database.js'

export type StandaloneSkillRemovalVerdict =
  | { ok: true; folderPath: string }
  | { ok: false; error: string }

function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child)
  const p = resolve(parent)
  if (c === p) return true
  const rel = relative(p, c)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Operator-removable skills live under Pi agent / project skill dirs — not npm/git packages or the Sylo repo. */
export function validateStandaloneSkillRemoval(
  reportedPath: string,
  agentDir: string,
  piCwd: string,
  syloRepoRoot: string,
  includeCursorSkills = false,
): StandaloneSkillRemovalVerdict {
  const folderPath = skillDirFromReportedPath(reportedPath)
  if (!folderPath.trim()) return { ok: false, error: 'Missing skill path' }

  let resolved: string
  try {
    resolved = resolve(folderPath)
  } catch {
    return { ok: false, error: 'Invalid skill path' }
  }

  if (!existsSync(resolved)) return { ok: false, error: 'Skill folder not found on disk' }
  try {
    if (!statSync(resolved).isDirectory()) {
      return { ok: false, error: 'Path is not a skill folder' }
    }
  } catch {
    return { ok: false, error: 'Could not read skill folder' }
  }

  const norm = resolved.replace(/\\/g, '/').toLowerCase()
  if (norm.includes('/node_modules/') || norm.includes('/npm/') || norm.includes('/git/')) {
    return {
      ok: false,
      error: 'Package skills are removed by uninstalling the package (Downloaded packages → Uninstall).',
    }
  }

  const repoNorm = syloRepoRoot.replace(/\\/g, '/').toLowerCase()
  if (repoNorm && (norm === repoNorm || norm.startsWith(`${repoNorm}/`))) {
    return { ok: false, error: 'Cannot remove skills shipped with the Sylo repo from here.' }
  }

  const allowedRoots = [join(agentDir, 'skills'), join(piCwd, '.pi', 'skills')]
  if (includeCursorSkills) allowedRoots.push(join(piCwd, '.cursor', 'skills'))

  const allowed = allowedRoots.some((root) => existsSync(root) && isPathInside(resolved, root))
  if (!allowed) {
    return {
      ok: false,
      error:
        includeCursorSkills ?
          'Only skills under ~/.pi/agent/skills, <workspace>/.pi/skills, or <workspace>/.cursor/skills can be removed here.'
        : 'Only skills under ~/.pi/agent/skills or <workspace>/.pi/skills can be removed here.',
    }
  }

  return { ok: true, folderPath: resolved }
}

function purgeSkillPathFromPolicyStores(skillPath: string): void {
  const key = normalizeSkillCapabilityPath(skillPath)
  if (!key) return

  const disabled = readSyloDisabledCapabilities()
  const skillPaths = disabled.skillPaths.filter((p) => normalizeSkillCapabilityPath(p) !== key)
  if (skillPaths.length !== disabled.skillPaths.length) {
    writeSyloDisabledCapabilities({ ...disabled, skillPaths })
  }

  for (const ws of db.listWorkspaces()) {
    db.patchWorkspaceDisabledCapability({ workspaceId: ws.id, kind: 'skill', path: key, excluded: false })
  }
}

export function removeStandaloneSkillFolder(
  reportedPath: string,
  agentDir: string,
  piCwd: string,
  syloRepoRoot: string,
  includeCursorSkills = false,
): { ok: true } | { ok: false; error: string } {
  const verdict = validateStandaloneSkillRemoval(
    reportedPath,
    agentDir,
    piCwd,
    syloRepoRoot,
    includeCursorSkills,
  )
  if (!verdict.ok) return verdict

  try {
    rmSync(verdict.folderPath, { recursive: true, force: true })
    purgeSkillPathFromPolicyStores(verdict.folderPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
