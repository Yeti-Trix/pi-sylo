import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function extPath(...parts) {
  const p = join(repoRoot, ...parts)
  assert.ok(existsSync(p), `fixture path missing: ${p}`)
  return p
}

test('resolveSeatExtensionPaths includes all enabled optional extensions', async () => {
  const { resolveSeatExtensionPaths } = await import('./seat-extensions.ts')
  const web = extPath('packages', 'sylo-web-access', 'extensions', 'index.ts')
  const think = extPath('packages', 'sylo-think-tank', 'extensions', 'index.ts')
  const subagents = extPath('packages', 'sylo-subagents', 'extensions', 'index.ts')
  const disabled = extPath('packages', 'sylo-tts', 'extensions', 'index.ts')

  const paths = resolveSeatExtensionPaths({
    SYLO_OPTIONAL_EXTENSION_PATHS: JSON.stringify([web, think, disabled]),
    SYLO_DISABLED_EXTENSION_PATHS: JSON.stringify([disabled]),
    SYLO_SUBAGENTS_EXTENSION: subagents,
  })

  assert.ok(paths.includes(web))
  assert.ok(paths.includes(think))
  assert.ok(!paths.includes(disabled))
  assert.ok(paths.includes(subagents))
})

test('seat extensions keep the think-tank assignment-board tools', async () => {
  // Regression: pruning sylo-think-tank from the seat list removed
  // sylo_think_tank_task_* while the prompt still embedded the board, and the
  // Moderator looped on empty markdown table rows instead of taking a turn.
  const { resolveSeatExtensionPaths } = await import('./seat-extensions.ts')
  const think = extPath('packages', 'sylo-think-tank', 'extensions', 'index.ts')

  const paths = resolveSeatExtensionPaths({
    SYLO_OPTIONAL_EXTENSION_PATHS: JSON.stringify([think]),
  })

  assert.ok(paths.includes(think))
})
