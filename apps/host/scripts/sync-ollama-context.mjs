/**
 * Reconcile Pi's `models.json` `contextWindow` with what Ollama actually allocates.
 *
 * Sylo does this automatically when Ollama settings are saved; this script applies the
 * same logic to every Ollama model already in `models.json`, which is useful after
 * changing `OLLAMA_CONTEXT_LENGTH` or pulling a model with a different context.
 *
 * Run: node apps/host/scripts/sync-ollama-context.mjs [--dry-run]
 * Requires: npm run build:ollama-context-tools -w apps/host
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_OLLAMA_CONTEXT_LIMIT,
  describeContextWindowVerdict,
  isCloudHostedOllamaModel,
  judgeContextWindow,
  probeOllamaContext,
  resolveEffectiveOllamaContext,
} from '../out/test/ollama-context.mjs'
import { readModelContextWindow, writeModelContextWindow } from '../out/test/model-input.mjs'

const dryRun = process.argv.includes('--dry-run')
const agentDir = join(homedir(), '.pi', 'agent')
const modelsPath = join(agentDir, 'models.json')

if (!existsSync(modelsPath)) {
  console.error(`No models.json at ${modelsPath}`)
  process.exit(1)
}

const root = JSON.parse(readFileSync(modelsPath, 'utf8'))
const provider = root?.providers?.ollama
if (!provider) {
  console.error('No "ollama" provider in models.json')
  process.exit(1)
}

// baseUrl is Pi's OpenAI-compatible URL; the native API lives one level up.
const baseOrigin = String(provider.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/v1\/?$/, '')
const serverLimit = Number.parseInt(process.env.OLLAMA_CONTEXT_LENGTH ?? '', 10) || DEFAULT_OLLAMA_CONTEXT_LIMIT

const ids = (provider.models ?? [])
  .map((entry) => (typeof entry === 'string' ? entry.trim() : entry?.id))
  .filter((id) => typeof id === 'string' && id !== '')

console.log(`Ollama: ${baseOrigin}   server limit: ${serverLimit.toLocaleString('en-US')}`)
console.log(`Models in models.json: ${ids.length}\n`)

for (const id of ids) {
  const probed = await probeOllamaContext(baseOrigin, id)
  if (!probed.ok) {
    console.log(`- ${id}: skipped (${probed.error})`)
    continue
  }
  const effective = resolveEffectiveOllamaContext(
    probed.probe,
    serverLimit,
    isCloudHostedOllamaModel(id),
  )
  const declared = readModelContextWindow(agentDir, 'ollama', id)
  const verdict = judgeContextWindow(effective, declared)

  if (effective == null) {
    console.log(`- ${id}: skipped (context length unavailable)`)
    continue
  }
  if (declared === effective) {
    console.log(`- ${id}: already correct at ${effective.toLocaleString('en-US')}`)
    continue
  }

  console.log(`- ${id}: ${describeContextWindowVerdict(verdict, id)}`)
  if (dryRun) {
    console.log(`    would set contextWindow = ${effective.toLocaleString('en-US')}`)
    continue
  }
  const wrote = writeModelContextWindow(agentDir, 'ollama', id, effective)
  console.log(
    wrote.ok ?
      `    set contextWindow = ${effective.toLocaleString('en-US')}`
    : `    FAILED: ${wrote.error}`,
  )
}
