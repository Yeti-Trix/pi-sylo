/**
 * Mirror skill widget/route assets into Electron test-fixtures so
 * fetch('/skill-surface/widgets|routes/...') works in dev and production builds.
 *
 * Scans:
 *   - packages/skills/<skill>/
 *   - ~/.pi/agent/skills/<skill>/
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const destRoot = path.join(root, 'apps/host/test-fixtures/skill-surface')

const staleRouteFixtures = [
  path.join(destRoot, 'routes', 'music-production'),
  path.join(destRoot, 'routes', 'council'),
]
for (const stale of staleRouteFixtures) {
  if (!fs.existsSync(stale)) continue
  fs.rmSync(stale, { recursive: true, force: true })
  console.log('[sync-smoke-skills] removed stale route fixture →', stale)
}

const surfaceCssSrc = path.join(root, 'packages/skill-builder/assets/sylo-surface.css')
const surfaceCssDest = path.join(destRoot, 'sylo-surface.css')
if (fs.existsSync(surfaceCssSrc)) {
  fs.mkdirSync(destRoot, { recursive: true })
  fs.copyFileSync(surfaceCssSrc, surfaceCssDest)
  console.log('[sync-smoke-skills] sylo-surface.css →', surfaceCssDest)
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
  return true
}

function listSkillDirs(base) {
  if (!fs.existsSync(base)) return []
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(base, e.name))
}

function syncSkillAssets(skillDir) {
  const skillFolderName = path.basename(skillDir)
  let n = 0

    const routesSrc = path.join(skillDir, 'routes')
  if (fs.existsSync(routesSrc)) {
    const routesDest = path.join(destRoot, 'routes', skillFolderName)
    // Replace, don't overlay: hashed Vite asset names change every build, and
    // overlaying accumulates stale bundles (old bundles may embed absolute
    // operator paths from dev-mode builds — never let them linger).
    if (fs.existsSync(routesDest)) fs.rmSync(routesDest, { recursive: true, force: true })
    if (copyDir(routesSrc, routesDest)) {
      console.log('[sync-smoke-skills] routes', skillFolderName, '→', routesDest)
      n++
    }
  }

  const widgetsRoot = path.join(skillDir, 'assets', 'widgets')
  if (fs.existsSync(widgetsRoot)) {
    for (const ent of fs.readdirSync(widgetsRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const widgetDest = path.join(destRoot, 'widgets', skillFolderName)
      if (copyDir(path.join(widgetsRoot, ent.name), widgetDest)) {
        console.log('[sync-smoke-skills] widgets', skillFolderName, '→', widgetDest)
        n++
      }
    }
  }

  return n
}

const skillRoots = [
  path.join(root, 'packages/skills'),
  path.join(os.homedir(), '.pi', 'agent', 'skills'),
]

// First-party optional packages ship skills under packages/sylo-<name>/skills/
for (const ent of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
  if (!ent.isDirectory() || !ent.name.startsWith('sylo-')) continue
  const skillsBase = path.join(root, 'packages', ent.name, 'skills')
  if (fs.existsSync(skillsBase)) skillRoots.push(skillsBase)
}

let total = 0
for (const base of skillRoots) {
  for (const skillDir of listSkillDirs(base)) {
    total += syncSkillAssets(skillDir)
  }
}

console.log('[sync-smoke-skills] synced', total, 'surface(s) →', destRoot)
