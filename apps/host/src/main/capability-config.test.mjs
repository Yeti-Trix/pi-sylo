import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  listExtensionConfigSchemaKeys,
  resolveExtensionConfigKey,
  resolveSkillParamsMeta,
} from './capability-config.ts'

test('resolveExtensionConfigKey matches npm package folder', () => {
  const agentDir = join(tmpdir(), `sylo-capcfg-${Date.now()}`)
  const cfgDir = join(agentDir, 'extensions-config')
  mkdirSync(cfgDir, { recursive: true })
  writeFileSync(join(cfgDir, 'pi-smart-fetch.schema.json'), '{"type":"object"}', 'utf8')
  try {
    const key = resolveExtensionConfigKey(
      'C:/Users/x/.pi/agent/npm/node_modules/pi-smart-fetch/index.ts',
      agentDir,
    )
    assert.equal(key, 'pi-smart-fetch')
    assert.deepEqual(listExtensionConfigSchemaKeys(agentDir), ['pi-smart-fetch'])
  } finally {
    rmSync(agentDir, { recursive: true, force: true })
  }
})

test('resolveSkillParamsMeta finds params.schema.json', () => {
  const skillDir = join(tmpdir(), `sylo-skill-${Date.now()}`)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: demo
description: demo
---
# Demo
`,
    'utf8',
  )
  writeFileSync(join(skillDir, 'params.schema.json'), '{"type":"object","properties":{}}', 'utf8')
  const reported = join(skillDir, 'SKILL.md')
  try {
    const meta = resolveSkillParamsMeta(reported)
    assert.ok(meta)
    assert.equal(meta.valuesPath, join(skillDir, 'params.local.json'))
  } finally {
    rmSync(skillDir, { recursive: true, force: true })
  }
})
