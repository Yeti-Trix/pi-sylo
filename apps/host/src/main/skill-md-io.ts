import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { isSyloCoreAgentSkillName } from '../shared/sylo-core-skills.js'
import { skillDirFromReportedPath } from '../shared/sylo-capability-paths.js'
import { isSkillPathInOperatorScope } from '../shared/sylo-skill-scope.js'

function isPackagedSkillDir(skillDir: string): boolean {
  const norm = skillDir.replace(/\\/g, '/').toLowerCase()
  return (
    norm.includes('/node_modules/') ||
    norm.includes('/.pi/npm/') ||
    norm.includes('/npm/') ||
    norm.includes('/git/')
  )
}

function resolveSkillMdPath(reportedPath: string): { ok: true; skillDir: string; mdPath: string } | { ok: false; error: string } {
  const skillDir = skillDirFromReportedPath(reportedPath)
  if (!skillDir.trim()) return { ok: false, error: 'Missing skill path' }
  const mdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillDir)) return { ok: false, error: 'Skill folder not found' }
  try {
    if (!statSync(skillDir).isDirectory()) return { ok: false, error: 'Path is not a skill folder' }
  } catch {
    return { ok: false, error: 'Could not read skill folder' }
  }
  return { ok: true, skillDir, mdPath }
}

export type SkillMdReadResult =
  | {
      ok: true
      content: string
      skillDir: string
      skillName: string
      editable: boolean
      isCoreSyloSkill: boolean
    }
  | { ok: false; error: string }

export function readSkillMd(
  reportedPath: string,
  agentDir: string,
  piCwd: string,
  includeCursorSkills: boolean,
): SkillMdReadResult {
  const resolved = resolveSkillMdPath(reportedPath)
  if (!resolved.ok) return resolved

  const { skillDir, mdPath } = resolved
  const skillName = basename(skillDir)
  const inScope = isSkillPathInOperatorScope(skillDir, agentDir, piCwd, { includeCursorSkills })
  const packaged = isPackagedSkillDir(skillDir)
  const editable = inScope && !packaged

  let content = ''
  if (existsSync(mdPath)) {
    try {
      content = readFileSync(mdPath, 'utf8')
    } catch {
      return { ok: false, error: 'Could not read SKILL.md' }
    }
  }

  return {
    ok: true,
    content,
    skillDir,
    skillName,
    editable,
    isCoreSyloSkill: isSyloCoreAgentSkillName(skillName),
  }
}

export function writeSkillMd(
  reportedPath: string,
  content: string,
  agentDir: string,
  piCwd: string,
  includeCursorSkills: boolean,
  opts?: { confirmCoreSyloEdit?: boolean },
): { ok: true } | { ok: false; error: string } {
  const resolved = resolveSkillMdPath(reportedPath)
  if (!resolved.ok) return resolved

  const { skillDir, mdPath } = resolved
  const skillName = basename(skillDir)
  const readMeta = readSkillMd(reportedPath, agentDir, piCwd, includeCursorSkills)
  if (!readMeta.ok) return readMeta
  if (!readMeta.editable) {
    return {
      ok: false,
      error: 'This skill is read-only here (package or out-of-scope path). Open the folder in your editor instead.',
    }
  }

  if (readMeta.isCoreSyloSkill && opts?.confirmCoreSyloEdit !== true) {
    return {
      ok: false,
      error: 'Core Sylo skills require explicit confirmation before saving.',
    }
  }

  if (typeof content !== 'string') {
    return { ok: false, error: 'Invalid content' }
  }

  try {
    writeFileSync(mdPath, content, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
