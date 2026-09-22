/**
 * Run: npm run test:subagent-tool-policy -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  PI_BUILTIN_TOOL_IDS as PACKAGE_TOOL_IDS,
  operatorAllowedBuiltins,
  resolveSubagentToolPolicy,
  toolCliArgs,
} from '../../../../packages/sylo-subagents/extensions/pi-tool-policy.ts'
import { PI_BUILTIN_TOOL_IDS as HOST_TOOL_IDS } from '../shared/pi-builtin-tools.ts'

const ALL = [...HOST_TOOL_IDS]

/** The package cannot import from apps/host, so the copied list needs a guard. */
test('package tool id list has not drifted from the host list', () => {
  assert.deepEqual([...PACKAGE_TOOL_IDS], ALL)
})

describe('operatorAllowedBuiltins', () => {
  test('absent env means not running under Sylo — no restriction', () => {
    assert.equal(operatorAllowedBuiltins(undefined), null)
    assert.equal(operatorAllowedBuiltins(''), null)
  })

  test('unparseable env is treated as no restriction, not as a total block', () => {
    assert.equal(operatorAllowedBuiltins('{not json'), null)
  })

  test('master switch off permits nothing', () => {
    assert.deepEqual(operatorAllowedBuiltins(JSON.stringify({ enabled: false })), [])
  })

  test('per-tool switches are honoured', () => {
    const raw = JSON.stringify({ enabled: true, tools: { write: false, edit: false, bash: false } })
    assert.deepEqual(operatorAllowedBuiltins(raw), ['read', 'grep', 'find', 'ls'])
  })

  test('unlisted ids default to on, like the host normalizer', () => {
    assert.deepEqual(operatorAllowedBuiltins(JSON.stringify({ enabled: true, tools: {} })), ALL)
  })
})

describe('resolveSubagentToolPolicy', () => {
  const policy = (o) => resolveSubagentToolPolicy({ chatOnly: false, ...o })

  test('an unrestricted persona under no policy stays unrestricted', () => {
    assert.deepEqual(policy({ allowedBuiltins: null }), { kind: 'allow', tools: ALL })
  })

  // The bug this whole module exists for.
  test('operator disabling write stops an otherwise unrestricted persona from writing', () => {
    const res = policy({ allowedBuiltins: ['read', 'grep', 'find', 'ls'] })
    assert.equal(res.kind, 'allow')
    assert.deepEqual(res.tools, ['read', 'grep', 'find', 'ls'])
  })

  test('operator policy cannot widen a read-only persona', () => {
    const res = policy({ agentTools: ['read', 'ls'], allowedBuiltins: ALL })
    assert.deepEqual(res.tools, ['read', 'ls'])
  })

  test('persona and policy intersect both ways', () => {
    const res = policy({ agentTools: ['read', 'write', 'bash'], allowedBuiltins: ['read', 'write'] })
    assert.deepEqual(res.tools, ['read', 'write'])
  })

  test('result is in canonical order regardless of frontmatter order', () => {
    const res = policy({ agentTools: ['ls', 'bash', 'read'], allowedBuiltins: ALL })
    assert.deepEqual(res.tools, ['read', 'bash', 'ls'])
  })

  test('unknown ids in frontmatter are ignored, not passed through', () => {
    const res = policy({ agentTools: ['read', 'sudo'], allowedBuiltins: ALL })
    assert.deepEqual(res.tools, ['read'])
  })

  test('blocks the run when the policy leaves nothing usable', () => {
    const res = policy({ agentTools: ['write', 'edit'], allowedBuiltins: ['read'] })
    assert.equal(res.kind, 'blocked')
    assert.match(res.reason, /write, edit/)
    assert.match(res.reason, /Capability manager/)
  })

  test('master switch off blocks the run outright', () => {
    const res = policy({ allowedBuiltins: [] })
    assert.equal(res.kind, 'blocked')
  })

  test('chat-only blocks before any tool math', () => {
    const res = resolveSubagentToolPolicy({ chatOnly: true, allowedBuiltins: ALL })
    assert.equal(res.kind, 'blocked')
    assert.match(res.reason, /Chat-only/)
  })
})

describe('toolCliArgs', () => {
  test('omits --tools when everything is permitted', () => {
    assert.deepEqual(toolCliArgs(ALL), [])
  })

  test('passes a subset as one comma-joined value', () => {
    assert.deepEqual(toolCliArgs(['read', 'ls']), ['--tools', 'read,ls'])
  })
})
