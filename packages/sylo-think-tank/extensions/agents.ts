import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent'

import { resolveThinkTankPersonaId } from './personas.ts'

export type AgentConfig = {
  name: string
  description: string
  tools?: string[]
  model?: string
  systemPrompt: string
  filePath: string
}

const BUNDLED_AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents')

function loadAgentsFromDir(dir: string): AgentConfig[] {
  if (!fs.existsSync(dir)) return []
  const agents: AgentConfig[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.endsWith('.md')) continue
    const filePath = path.join(dir, entry.name)
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }
    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content)
    if (!frontmatter.name) continue
    const tools = frontmatter.tools
      ?.split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description ?? '',
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      filePath,
    })
  }
  return agents
}

export function discoverThinkTankAgents(cwd: string): AgentConfig[] {
  const bundled = loadAgentsFromDir(BUNDLED_AGENTS_DIR)
  const userDir = path.join(getAgentDir(), 'agents')
  const user = loadAgentsFromDir(userDir)
  const byName = new Map<string, AgentConfig>()
  for (const a of bundled) byName.set(a.name, a)
  for (const a of user) byName.set(a.name, a)
  void cwd
  return [...byName.values()]
}

export function findThinkTankAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
  const resolved = resolveThinkTankPersonaId(name)
  return agents.find((a) => a.name === resolved) ?? agents.find((a) => a.name === name)
}
