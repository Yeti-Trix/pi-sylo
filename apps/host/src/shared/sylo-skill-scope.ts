import { join, resolve } from 'node:path'

import { normalizeSkillCapabilityPath } from './sylo-capability-paths.js'

export { SYLO_INCLUDE_CURSOR_SKILLS_PREF } from './sylo-capability-prefs.js'

export type SkillScopeOptions = {
  includeCursorSkills?: boolean
}

function normLowerPath(p: string): string {
  return normalizeSkillCapabilityPath(p).replace(/\\/g, '/').toLowerCase()
}

function isUnderRoot(childNorm: string, parentDir: string): boolean {
  const root = resolve(parentDir).replace(/\\/g, '/').toLowerCase()
  if (!root) return false
  return childNorm === root || childNorm.startsWith(`${root}/`)
}

function isPackagedSkillPath(norm: string): boolean {
  return (
    norm.includes('/node_modules/') ||
    norm.includes('/.pi/npm/') ||
    norm.includes('/npm/') ||
    norm.includes('/git/')
  )
}

/**
 * Skills Sylo may list and apply for a workspace: Pi agent global dir, that workspace's
 * `.pi/skills`, and skills shipped inside Pi npm/git installs. Excludes `.cursor/skills`
 * and skills from other project trees (e.g. the Sylo monorepo when cwd is elsewhere).
 */
export function isSkillPathInOperatorScope(
  reportedPath: string,
  agentDir: string,
  piCwd: string,
  options?: SkillScopeOptions,
): boolean {
  const includeCursor = options?.includeCursorSkills === true
  const norm = normLowerPath(reportedPath)
  if (!norm) return false
  if (norm.includes('/.cursor/')) {
    if (!includeCursor) return false
    const cwd = typeof piCwd === 'string' ? piCwd.trim() : ''
    if (!cwd) return false
    return isUnderRoot(norm, join(cwd, '.cursor', 'skills'))
  }
  if (isPackagedSkillPath(norm)) return true

  const agentRoot = typeof agentDir === 'string' ? agentDir.trim() : ''
  if (agentRoot && isUnderRoot(norm, join(agentRoot, 'skills'))) return true

  const cwd = typeof piCwd === 'string' ? piCwd.trim() : ''
  if (cwd && isUnderRoot(norm, join(cwd, '.pi', 'skills'))) return true

  return false
}
