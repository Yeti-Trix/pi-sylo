import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseFrontmatter } from '@earendil-works/pi-coding-agent'

/**
 * Read-only view of the agent personas the subagents extension would discover.
 *
 * The extension does its own discovery inside the broker (see
 * `packages/sylo-subagents/extensions/agents.ts`); this exists so Settings can list the
 * personas without reaching across the package boundary or waiting on a broker round trip.
 * Precedence matches the extension: builtin, then user, then project.
 */
export type SubagentAgentInfo = {
  name: string
  description: string
  source: 'builtin' | 'user' | 'project'
}

export type SubagentAgentScope = 'user' | 'project' | 'both'

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function readAgentsIn(dir: string, source: SubagentAgentInfo['source']): SubagentAgentInfo[] {
  if (!isDirectory(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: SubagentAgentInfo[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    let fm: Record<string, unknown>
    try {
      fm = parseFrontmatter(readFileSync(join(dir, entry), 'utf8')).frontmatter as Record<
        string,
        unknown
      >
    } catch {
      continue
    }
    const name = typeof fm.name === 'string' ? fm.name.trim() : ''
    const description = typeof fm.description === 'string' ? fm.description.trim() : ''
    if (!name || !description) continue
    out.push({ name, description, source })
  }
  return out
}

/** Walk up from `cwd` for the nearest `.pi/agents`, the way the extension does. */
export function nearestProjectAgentsDir(cwd: string): string | null {
  let current = cwd
  for (;;) {
    const candidate = join(current, '.pi', 'agents')
    if (isDirectory(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function listSubagentAgents(opts: {
  bundledDir: string
  userAgentsDir: string
  projectCwd: string
  scope: SubagentAgentScope
}): SubagentAgentInfo[] {
  const { bundledDir, userAgentsDir, projectCwd, scope } = opts
  const projectDir = scope === 'user' ? null : nearestProjectAgentsDir(projectCwd)

  const byName = new Map<string, SubagentAgentInfo>()
  const layers: SubagentAgentInfo[][] = [
    scope === 'project' ? [] : readAgentsIn(bundledDir, 'builtin'),
    scope === 'project' ? [] : readAgentsIn(userAgentsDir, 'user'),
    projectDir ? readAgentsIn(projectDir, 'project') : [],
  ]
  for (const layer of layers) {
    for (const agent of layer) byName.set(agent.name, agent)
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}
