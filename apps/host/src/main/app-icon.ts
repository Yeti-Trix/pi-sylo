import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** PNG app icon shipped under apps/host/resources/icon.png */
export function resolveAppIconPath(): string | undefined {
  const candidates = [
    join(__dirname, '../../resources/icon.png'),
    join(app.getAppPath(), 'resources/icon.png'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export function appIconWindowOptions(): { icon?: string } {
  const icon = resolveAppIconPath()
  return icon ? { icon } : {}
}
