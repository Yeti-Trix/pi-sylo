import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
// Installed builds run this script from the main process and pass the agent dir
// the app actually resolved (the `sylo.pi_agent_dir` pref can move it).
const agent = process.env.SYLO_PI_AGENT_DIR?.trim() || path.join(os.homedir(), '.pi', 'agent')

function ensureCopy(srcRel, destAbs) {
  const src = path.join(root, srcRel)
  if (!fs.existsSync(src)) {
    console.warn('Sylo bootstrap: skip missing', srcRel)
    return
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true })
  fs.copyFileSync(src, destAbs)
  console.log('Sylo bootstrap:', destAbs)
}

function ensureCopyTree(srcRel, destAbs) {
  const src = path.join(root, srcRel)
  if (!fs.existsSync(src)) {
    console.warn('Sylo bootstrap: skip missing tree', srcRel)
    return
  }
  fs.cpSync(src, destAbs, { recursive: true })
  console.log('Sylo bootstrap: copied tree →', destAbs)
}

// @sylo/skill-surface-extension stays out of ~/.pi/agent — Sylo loads it via additionalExtensionPaths.
// (think-tank seat-assignment extension notes removed 2026-10-27 with the sylo-think-tank package — issue #41.)
const staleExtPaths = [
  path.join(agent, 'extensions', 'sylo-task-overlay.ts'),
  path.join(agent, 'extensions', 'sylo-research-extension.ts'),
  path.join(agent, 'extensions', 'sylo-think-tank-task-store.ts'),
  path.join(agent, 'extensions', 'sylo-think-tank-seat-tools.ts'),
  // self-mod extensions removed entirely (sylo.self_mod feature killed).
  path.join(agent, 'extensions', 'sylo-protected-paths.ts'),
  path.join(agent, 'extensions', 'sylo-git-checkpoint.ts'),
]
const staleSkillDirs = [
  path.join(agent, 'skills', 'sylo-research'),
  path.join(agent, 'skills', 'workout-planner'),
  path.join(agent, 'skills', 'route-smoke'),
  path.join(agent, 'skills', 'widget-smoke'),
  path.join(agent, 'skills', 'docx-reader'),
  // research-mining lives in Agentic Engineering workspace .pi/skills (not ~/.pi/agent).
  path.join(agent, 'skills', 'research-mining'),
]
for (const stale of staleExtPaths) {
  if (fs.existsSync(stale)) {
    fs.unlinkSync(stale)
    console.log('Sylo bootstrap: removed stale', stale)
  }
}

for (const stale of staleSkillDirs) {
  if (fs.existsSync(stale)) {
    fs.rmSync(stale, { recursive: true, force: true })
    console.log('Sylo bootstrap: removed stale', stale)
  }
}

// Personal-domain skills (nutrition/workouts/news/reddit) are owned by packages
// the operator registers, not sylo-dev. When a package is installed, Pi's
// package loader copies its skills into ~/.pi/agent/skills. When the owning
// package is ABSENT (work/controls machines, or any machine that ran an older
// bootstrap that copied them here), stale orphan folders would still be
// scanned by Pi and register their routes — e.g. the "Health" sidebar
// dashboard link. Mirror personal-plugin.ts resolution and purge them only
// when the owner is not resolvable (so the home machine keeps its skills).
// 2026-09-10 split: news/reddit are owned by sylo-news / sylo-reddit now,
// not sylo-tools-personal — purge each group based on its own owners.
function pkgInstalled(names, fallbackDirs) {
  try {
    const settingsPath = path.join(agent, 'settings.json')
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      const found = (raw.packages ?? []).some((p) =>
        names.includes(path.basename(String(p).replace(/\\/g, '/'))) &&
        fs.existsSync(path.resolve(path.dirname(settingsPath), String(p))))
      if (found) return true
    }
  } catch { /* settings unreadable — fall through */ }
  const env = process.env.SYLO_TOOLS_PERSONAL_DIR?.trim() ?? process.env.SYLO_PERSONAL_TOOLS_DIR?.trim()
  if (env && fs.existsSync(path.resolve(env))) return true
  return fallbackDirs.some((d) => fs.existsSync(path.join(os.homedir(), 'Documents', 'GitHub', d)))
}

function personalToolsInstalled() {
  // Renamed 2026-09-02: sylo-personal-tools → sylo-tools-personal (legacy name kept as alias).
  return pkgInstalled(
    ['sylo-health', 'sylo-tools-personal', 'sylo-personal-tools'],
    ['sylo-health', 'sylo-tools-personal', 'sylo-personal-tools'])
}

function newsRedditInstalled() {
  // 2026-09-10: news/reddit split into standalone packages; the health bundle
  // no longer declares their skills, so their copies need their own owners.
  return pkgInstalled(
    ['sylo-health', 'sylo-tools-personal', 'sylo-personal-tools', 'sylo-news', 'sylo-reddit'],
    ['sylo-health', 'sylo-tools-personal', 'sylo-personal-tools', 'sylo-news', 'sylo-reddit'])
}

const personalSkillNames = ['nutrition', 'workouts']
if (!personalToolsInstalled()) {
  for (const name of personalSkillNames) {
    const dir = path.join(agent, 'skills', name)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      console.log('Sylo bootstrap: removed stale personal skill (bundle absent):', dir)
    }
  }
} else {
  console.log('Sylo bootstrap: health bundle present — keeping personal skills')
}

const newsRedditSkillNames = ['news', 'reddit']
if (!newsRedditInstalled()) {
  for (const name of newsRedditSkillNames) {
    const dir = path.join(agent, 'skills', name)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      console.log('Sylo bootstrap: removed stale news/reddit skill (packages absent):', dir)
    }
  }
} else {
  console.log('Sylo bootstrap: news/reddit owners present — keeping news/reddit skills')
}

function pkgEnabledBySettingsInstall(names) {
  // Stricter than pkgInstalled: owner must be a RESOLVABLE local-path (or real
  // dir) entry in settings.json packages[] — a cloned-but-not-enabled repo
  // folder must NOT count, or the purge can never run (that is the exact
  // fieldbrain reported bug: clone exists, package not enabled, link shows).
  try {
    const settingsPath = path.join(agent, 'settings.json')
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      return (raw.packages ?? []).some((p) => {
        const str = String(p)
        if (str.startsWith('npm:') || str.startsWith('git:')) return false
        if (!names.includes(path.basename(str.replace(/\\/g, '/')))) return false
        return fs.existsSync(path.resolve(path.dirname(settingsPath), str))
      })
    }
  } catch { /* settings unreadable — treat as not installed */ }
  return false
}

// Route-declaring skills in the operator's domain bundles render a sidebar link
// whenever their folder exists under ~/.pi/agent/skills — discovered skills are
// scanned unconditionally (main/skill-routes.ts). A copy whose owning package is
// NOT a resolvable settings.json packages[] entry shows a dead dashboard link
// with no backend, so purge it; installing the package reinstalls the copy via
// Pi's package loader.
const controlsSkillGroups = [
  { skills: ['fieldbrain'], owners: ['sylo-fieldbrain'] },
]
for (const { skills, owners } of controlsSkillGroups) {
  if (pkgEnabledBySettingsInstall(owners)) continue
  for (const name of skills) {
    const dir = path.join(agent, 'skills', name)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      console.log('Sylo bootstrap: removed stale domain skill (owner package not enabled):', dir)
    }
  }
}

ensureCopy(
  'packages/skill-builder/skills/sylo-skill-author/SKILL.md',
  path.join(agent, 'skills', 'sylo-skill-author', 'SKILL.md'),
)
ensureCopy(
  'packages/skill-builder/skills/sylo-attach-ui/SKILL.md',
  path.join(agent, 'skills', 'sylo-attach-ui', 'SKILL.md'),
)
ensureCopy(
  'packages/extension-builder/skills/sylo-extension-author/SKILL.md',
  path.join(agent, 'skills', 'sylo-extension-author', 'SKILL.md'),
)
ensureCopy(
  'packages/extension-builder/skills/sylo-optional-package-author/SKILL.md',
  path.join(agent, 'skills', 'sylo-optional-package-author', 'SKILL.md'),
)
// (sylo-pdf-reader / sylo-spreadsheet / sylo-docx / sylo-web-access skill
// copies removed 2026-10-27 — all four extracted to the operator's personal
// repos ~/Documents/GitHub/sylo-{pdf-reader,docx,spreadsheet,web-access};
// Pi's package loader copies their skills from the installed packages.
// Monorepo package folders are deleted. Issue #39.)
// (template-docx-writer / machine-expert / ignition / logicforge / fieldbrain
// skills moved 2026-09-02 to the operator's sylo-tools-controls bundle, and
// onenote to sylo-tools-onenote — Pi's package loader copies bundle skills;
// they are not bundled sylo-dev skills anymore.)
// (nutrition/workouts/news/reddit skills now come from the installed
// sylo-personal-tools bundle — Pi's package loader copies them; they are not
// bundled sylo-dev skills. Stale copies left on machines without the bundle
// are purged by the personalToolsInstalled() check above.)
ensureCopyTree(
  'packages/sylo-tts/skills/tts',
  path.join(agent, 'skills', 'tts'),
)
// (sylo-think-tank removed 2026-10-27, issue #41 — the installed think-tank
// skill copy is purged in the stale list below.)
ensureCopyTree(
  'packages/sylo-coder/skills/sylo-coder',
  path.join(agent, 'skills', 'sylo-coder'),
)
ensureCopyTree(
  'packages/sylo-tasks/skills/tasks',
  path.join(agent, 'skills', 'tasks'),
)
ensureCopyTree(
  'packages/sylo-workflows/skills/sylo-workflows',
  path.join(agent, 'skills', 'sylo-workflows'),
)
ensureCopyTree(
  'packages/sylo-chat-export/skills/chat-export',
  path.join(agent, 'skills', 'chat-export'),
)
ensureCopyTree(
  'packages/sylo-image-gen/skills/image-gen',
  path.join(agent, 'skills', 'image-gen'),
)
ensureCopyTree(
  'packages/sylo-video-gen/skills/video-gen',
  path.join(agent, 'skills', 'video-gen'),
)

for (const staleSkill of [
  // sylo-think-tank removed entirely (issue #41) — its installed skill copy,
  // including the sidebar route bundle, is now stale like the entries below.
  'think-tank',
  'music-production',
  'ableton-reference',
  'council',
  'financial-news',
  'schematic-reader',
  'logicscout',
  // issue #39 final pass: web-access skill is now copied by Pi's package
  // loader from the operator-local sylo-web-access repo — purge the bundled
  // copy bootstrap used to install.
  'web-access',
]) {
  const stalePath = path.join(agent, 'skills', staleSkill)
  if (fs.existsSync(stalePath)) {
    fs.rmSync(stalePath, { recursive: true, force: true })
    console.log('[bootstrap-pi] removed stale skill →', stalePath)
  }
}

console.log('Sylo Pi bootstrap complete →', agent)
