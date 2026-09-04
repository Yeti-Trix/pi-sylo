import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { TObject } from 'typebox'

export interface SyloConfigOptions {
  /** Extension / config base name, e.g. pi-smart-fetch */
  name: string
  /** Override Pi agent dir (default ~/.pi/agent) */
  agentDir?: string
}

/**
 * Load extension operator config from ~/.pi/agent/extensions-config/<name>.json,
 * write a JSON Schema sidecar for Sylo forms, and return parsed values.
 */
export function syloConfig<T extends TObject>(
  _pi: ExtensionAPI,
  schema: T,
  opts: SyloConfigOptions,
): Record<string, unknown> {
  const agentDir = opts.agentDir ?? join(homedir(), '.pi', 'agent')
  const dir = join(agentDir, 'extensions-config')
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, `${opts.name}.json`)
  const schemaPath = join(dir, `${opts.name}.schema.json`)
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf8')
  if (!existsSync(configPath)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
