/**
 * Probe Pi resource loader skill loading (broker-equivalent).
 * Run: npm run probe:broker-skills -w apps/host
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createAgentSessionServices, SettingsManager } from '@earendil-works/pi-coding-agent'
import { discoverBundledSkillPaths } from '../src/shared/bundled-skill-discovery.ts'

const agentDir = join(homedir(), '.pi', 'agent')
const cwd = join(process.env.APPDATA ?? homedir(), '@sylo', 'host', 'sylo-project')

const bundledSkillPaths = discoverBundledSkillPaths([], agentDir, cwd)
console.log('discovered bundled skill paths:', bundledSkillPaths.length)
for (const p of bundledSkillPaths) console.log(' ', p)

const services = await createAgentSessionServices({
  cwd,
  agentDir,
  settingsManager: SettingsManager.create(cwd, agentDir),
  resourceLoaderOptions: {
    additionalSkillPaths: bundledSkillPaths,
  },
})

const skills = services.resourceLoader.getSkills()
console.log('\nPi getSkills count:', skills.skills.length)
for (const s of skills.skills) {
  const row = s
  console.log(` - ${row.name}: ${row.filePath ?? row.path ?? '(no path)'}`)
}

const diags = services.resourceLoader.getSkillDiagnostics?.() ?? []
if (diags.length) {
  console.log('\nSkill diagnostics:')
  for (const d of diags) console.log(' ', d)
}
