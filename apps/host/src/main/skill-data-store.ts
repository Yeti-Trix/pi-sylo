import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_QUOTA = 10 * 1024 * 1024

export const SKILL_DATA_QUOTA_BYTES = DEFAULT_QUOTA

function safeSkillKey(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return t.length > 0 ? t.slice(0, 64) : 'skill'
}

function safeDataKey(raw: string): string {
  const t = raw.trim().replace(/[^a-zA-Z0-9_.@-]+/g, '_').replace(/^\.+/, '')
  return t.length > 0 ? t.slice(0, 120) : 'default'
}

export function skillDataRoot(userData: string): string {
  return join(userData, 'sylo-skill-data')
}

export function skillDataSkillDir(userData: string, skillKeyRaw: string): string {
  return join(skillDataRoot(userData), safeSkillKey(skillKeyRaw))
}

export function readSkillDataJson(
  userData: string,
  skillKeyRaw: string,
  keyRaw: string,
): { ok: true; value: unknown | undefined } | { ok: false; error: string } {
  const skill = safeSkillKey(skillKeyRaw)
  const key = safeDataKey(keyRaw)
  const dir = skillDataSkillDir(userData, skill)
  const file = join(dir, `${key}.json`)
  try {
    if (!existsSync(file)) return { ok: true, value: undefined }
    const raw = readFileSync(file, 'utf8')
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function dirTotalBytes(dir: string): number {
  let n = 0
  if (!existsSync(dir)) return 0
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    try {
      if (ent.isFile()) n += statSync(p).size
    } catch {
      /* */
    }
  }
  return n
}

export function writeSkillDataJson(
  userData: string,
  skillKeyRaw: string,
  keyRaw: string,
  value: unknown,
  quotaBytes: number = DEFAULT_QUOTA,
): { ok: true } | { ok: false; error: string } {
  const skill = safeSkillKey(skillKeyRaw)
  const key = safeDataKey(keyRaw)
  const dir = skillDataSkillDir(userData, skill)
  const file = join(dir, `${key}.json`)
  let serialized: string
  try {
    serialized = `${JSON.stringify(value, null, 2)}\n`
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  try {
    mkdirSync(dir, { recursive: true })
    const prevSize = existsSync(file) ? statSync(file).size : 0
    const withoutThis = dirTotalBytes(dir) - prevSize
    if (withoutThis + serialized.length > quotaBytes) {
      return { ok: false, error: `skill_data_quota_bytes exceeded (${quotaBytes})` }
    }
    writeFileSync(file, serialized, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
