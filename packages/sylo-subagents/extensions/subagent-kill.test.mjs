/**
 * Run: npm run test:subagent-kill -w apps/host
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'

import { isProcAlive, killSubagentTree } from './subagent-kill.ts'

const roots = []

/** A script file, not `node -e`: a shell mangles an inline script's punctuation. */
function scriptFile(body) {
  const dir = mkdtempSync(join(tmpdir(), 'sylo-kill-'))
  roots.push(dir)
  const file = join(dir, 'child.mjs')
  writeFileSync(file, body, 'utf8')
  return file
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForExit(pid, budgetMs = 15_000) {
  for (let waited = 0; waited < budgetMs && alive(pid); waited += 100) await sleep(100)
  return !alive(pid)
}

describe('killSubagentTree', () => {
  test('kills the real agent behind a shell wrapper', async () => {
    // Sylo reaches the pi CLI through a shell on Windows (pi.cmd -> node), so Node's
    // child is cmd.exe. `proc.kill()` removed only that shim: the agent kept running,
    // kept the stdio pipes open, `close` never fired, and the run was stranded as
    // "running" with an idle GPU. The tree kill has to reach the grandchild.
    const file = scriptFile('console.log(process.pid)\nsetInterval(() => {}, 1000)\n')
    const proc = spawn('node', [`"${file}"`], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let errText = ''
    proc.stderr.on('data', (d) => {
      errText += d.toString()
    })
    const agentPid = await new Promise((resolve, reject) => {
      const bail = setTimeout(
        () => reject(new Error(`child never reported its pid; stderr=${JSON.stringify(errText)}`)),
        15_000,
      )
      let buf = ''
      proc.stdout.on('data', (d) => {
        buf += d.toString()
        const n = Number(buf.trim().split('\n')[0])
        if (Number.isFinite(n) && n > 0) {
          clearTimeout(bail)
          resolve(n)
        }
      })
      proc.on('error', (e) => {
        clearTimeout(bail)
        reject(e)
      })
    })

    assert.equal(alive(agentPid), true, 'the agent should be running before the kill')
    killSubagentTree(proc, 1000)
    assert.equal(
      await waitForExit(agentPid),
      true,
      'the agent process must not survive a guard kill',
    )
  })

  test('isProcAlive tracks the child, unlike proc.killed', async () => {
    const proc = spawn(process.execPath, [scriptFile('setTimeout(() => {}, 50)\n')], {
      stdio: 'ignore',
    })
    assert.equal(isProcAlive(proc), true)
    await new Promise((r) => proc.on('close', r))
    assert.equal(isProcAlive(proc), false)
  })

  test('killing an already dead child does not throw', async () => {
    const proc = spawn(process.execPath, [scriptFile('')], { stdio: 'ignore' })
    await new Promise((r) => proc.on('close', r))
    killSubagentTree(proc, 1000)
  })
})
