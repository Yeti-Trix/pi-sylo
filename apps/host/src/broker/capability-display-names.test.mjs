/**
 * Run: npm run test:capability-display-names -w apps/host
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deriveExtensionDisplayName } from '../shared/capability-display-names.ts'

describe('deriveExtensionDisplayName', () => {
  test('uses npm package folder instead of index.ts entry files', () => {
    const cases = [
      [
        'C:/Users/x/AppData/Roaming/npm/node_modules/pi-docparser/extensions/docparser/index.ts',
        'pi-docparser',
      ],
      [
        'C:/Users/x/AppData/Roaming/npm/node_modules/pi-web-access/index.ts',
        'pi-web-access',
      ],
      [
        'C:/Users/x/.pi/agent/npm/pi-smart-fetch@1.2.3/dist/index.js',
        'pi-smart-fetch',
      ],
      [
        'C:/Users/x/AppData/Roaming/npm/node_modules/pi-subagents/src/extension/index.ts',
        'pi-subagents',
      ],
    ]
    for (const [path, expected] of cases) {
      assert.equal(deriveExtensionDisplayName(path), expected, path)
    }
  })

  test('labels Sylo built-in extensions', () => {
    assert.equal(
      deriveExtensionDisplayName('C:/repo/packages/skill-surface-extension/src/index.ts'),
      'sylo-skill-surface',
    )
    assert.equal(
      deriveExtensionDisplayName('C:/repo/out/broker/sylo-builtin-tools-guard.js'),
      'sylo-builtin-tools-guard',
    )
  })
})
