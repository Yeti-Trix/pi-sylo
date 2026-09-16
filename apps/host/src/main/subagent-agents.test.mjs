/**
 * Run: npm run test:subagent-agents -w apps/host
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { discoverAgents } from '../../../../packages/sylo-subagents/extensions/agents.ts'
import {
  readCustomSubagent,
  updateCustomSubagent,
  writeCustomSubagent,
} from './subagent-agents.ts'

const roots = []

/** One scratch agents dir per case, so a stale file cannot leak between tests. */
function scratchDir() {
  const root = mkdtempSync(join(tmpdir(), 'sylo-agents-'))
  roots.push(root)
  const dir = join(root, 'agents')
  mkdirSync(dir, { recursive: true })
  return dir
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function create(input, dir = scratchDir()) {
  const res = writeCustomSubagent({ userAgentsDir: dir, existingNames: [], input })
  return { res, dir, read: () => (res.ok ? readFileSync(res.filePath, 'utf8') : '') }
}

const base = { name: 'probe', description: 'a probe', prompt: 'Do the thing.' }

describe('writeCustomSubagent tool access', () => {
  test('omits tools: when every builtin is enabled (same as unrestricted)', () => {
    const { res, read } = create({
      ...base,
      tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'],
    })
    assert.equal(res.ok, true)
    assert.ok(!read().includes('tools:'))
  })

  test('writes a subset as a plain comma list in canonical order', () => {
    const { res, read } = create({ ...base, tools: ['grep', 'read'] })
    assert.equal(res.ok, true)
    assert.match(read(), /^tools: read, grep$/m)
  })

  test('dedupes a repeated tool', () => {
    const { read } = create({ ...base, tools: ['read', 'read', 'ls'] })
    assert.match(read(), /^tools: read, ls$/m)
  })

  test('rejects a tool id Pi does not have', () => {
    const { res } = create({ ...base, tools: ['read', 'sudo'] })
    assert.equal(res.ok, false)
    assert.match(res.error, /sudo/)
  })

  // An empty list would be written as an absent one and read back as "all tools",
  // handing the agent everything the operator just took away.
  test('rejects an explicitly empty tool list instead of writing unrestricted', () => {
    const { res } = create({ ...base, tools: [] })
    assert.equal(res.ok, false)
    assert.match(res.error, /at least one tool/i)
  })

  test('omitting tools entirely stays unrestricted', () => {
    const { res, read } = create({ ...base })
    assert.equal(res.ok, true)
    assert.ok(!read().includes('tools:'))
  })
})

describe('writeCustomSubagent timeout', () => {
  test('writes timeout_seconds when given', () => {
    const { read } = create({ ...base, timeoutSeconds: 900 })
    assert.match(read(), /^timeout_seconds: 900$/m)
  })

  test('omits the line when not given', () => {
    const { read } = create({ ...base })
    assert.ok(!read().includes('timeout_seconds'))
  })

  test('rejects values the extension would silently clamp', () => {
    assert.equal(create({ ...base, timeoutSeconds: 10 }).res.ok, false)
    assert.equal(create({ ...base, timeoutSeconds: 99_999 }).res.ok, false)
  })

  test('rejects a fractional timeout', () => {
    assert.equal(create({ ...base, timeoutSeconds: 90.5 }).res.ok, false)
  })
})

describe('written personas round-trip through extension discovery', () => {
  test('tools and timeout come back out the way they went in', () => {
    const dir = scratchDir()
    const { res } = create(
      { ...base, tools: ['read', 'grep', 'ls'], timeoutSeconds: 1200 },
      dir,
    )
    assert.equal(res.ok, true)

    // `bundledAgentsDir` is the one discovery path a test can point at a temp dir.
    const found = discoverAgents(dir, 'user', { bundledAgentsDir: dir }).agents.find(
      (a) => a.name === 'probe',
    )
    assert.ok(found, 'persona was not discovered')
    assert.deepEqual(found.tools, ['read', 'grep', 'ls'])
    assert.equal(found.timeoutSeconds, 1200)
    assert.equal(found.description, 'a probe')
    assert.match(found.systemPrompt, /Do the thing\./)
  })

  test('an unrestricted persona reports no tool restriction', () => {
    const dir = scratchDir()
    create({ ...base, tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] }, dir)
    const found = discoverAgents(dir, 'user', { bundledAgentsDir: dir }).agents.find(
      (a) => a.name === 'probe',
    )
    assert.equal(found.tools, undefined)
    assert.equal(found.timeoutSeconds, undefined)
  })
})

describe('readCustomSubagent', () => {
  test('returns every field the editor needs', () => {
    const dir = scratchDir()
    create({ ...base, tools: ['read', 'ls'], timeoutSeconds: 600 }, dir)
    const res = readCustomSubagent({ userAgentsDir: dir, name: 'probe' })
    assert.equal(res.ok, true)
    assert.equal(res.agent.name, 'probe')
    assert.equal(res.agent.description, 'a probe')
    assert.equal(res.agent.prompt, 'Do the thing.')
    assert.deepEqual(res.agent.tools, ['read', 'ls'])
    assert.equal(res.agent.timeoutSeconds, 600)
  })

  test('an unrestricted persona reports no tools, so the editor can show "all"', () => {
    const dir = scratchDir()
    create({ ...base }, dir)
    const res = readCustomSubagent({ userAgentsDir: dir, name: 'probe' })
    assert.equal(res.agent.tools, undefined)
    assert.equal(res.agent.timeoutSeconds, undefined)
  })

  test('explains itself when the agent is not user-scope', () => {
    const res = readCustomSubagent({ userAgentsDir: scratchDir(), name: 'planner' })
    assert.equal(res.ok, false)
    assert.match(res.error, /planner/)
  })

  test('is case-insensitive about the name, like discovery', () => {
    const dir = scratchDir()
    create({ ...base, name: 'Probe' }, dir)
    assert.equal(readCustomSubagent({ userAgentsDir: dir, name: 'probe' }).ok, true)
  })
})

describe('updateCustomSubagent', () => {
  test('rewrites in place and is readable back', () => {
    const dir = scratchDir()
    const { res: first } = create({ ...base, tools: ['read'], timeoutSeconds: 600 }, dir)
    const res = updateCustomSubagent({
      userAgentsDir: dir,
      input: {
        name: 'probe',
        description: 'now it writes',
        prompt: 'Changed instructions.',
        tools: ['read', 'write', 'edit'],
        timeoutSeconds: 1800,
      },
    })
    assert.equal(res.ok, true)
    assert.equal(res.filePath, first.filePath, 'should not have created a second file')

    const back = readCustomSubagent({ userAgentsDir: dir, name: 'probe' }).agent
    assert.equal(back.description, 'now it writes')
    assert.equal(back.prompt, 'Changed instructions.')
    assert.deepEqual(back.tools, ['read', 'write', 'edit'])
    assert.equal(back.timeoutSeconds, 1800)
  })

  test('clears a restriction when raised back to every tool', () => {
    const dir = scratchDir()
    create({ ...base, tools: ['read'] }, dir)
    updateCustomSubagent({
      userAgentsDir: dir,
      input: { ...base, tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] },
    })
    assert.equal(readCustomSubagent({ userAgentsDir: dir, name: 'probe' }).agent.tools, undefined)
  })

  test('drops a timeout when cleared', () => {
    const dir = scratchDir()
    create({ ...base, timeoutSeconds: 600 }, dir)
    updateCustomSubagent({ userAgentsDir: dir, input: { ...base } })
    assert.equal(
      readCustomSubagent({ userAgentsDir: dir, name: 'probe' }).agent.timeoutSeconds,
      undefined,
    )
  })

  // Same guard as create: an edit must not be a way around a rule.
  test('applies the same validation as create', () => {
    const dir = scratchDir()
    create({ ...base }, dir)
    assert.equal(
      updateCustomSubagent({ userAgentsDir: dir, input: { ...base, tools: [] } }).ok,
      false,
    )
    assert.equal(
      updateCustomSubagent({ userAgentsDir: dir, input: { ...base, timeoutSeconds: 5 } }).ok,
      false,
    )
    assert.equal(
      updateCustomSubagent({ userAgentsDir: dir, input: { ...base, prompt: '  ' } }).ok,
      false,
    )
  })

  test('refuses to create an agent that does not exist yet', () => {
    const res = updateCustomSubagent({ userAgentsDir: scratchDir(), input: { ...base } })
    assert.equal(res.ok, false)
    assert.match(res.error, /No custom agent/)
  })
})
