import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const agent = path.join(os.homedir(), '.pi', 'agent')

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

// Seat assignment tools load via packages/sylo-think-tank/extensions/index.ts (SYLO_THINK_TANK_SEAT_RUN=1).
// Do not copy seat-tools into ~/.pi/agent/extensions — Pi auto-loads that folder and causes duplicate tools.
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

// Personal-domain skills (nutrition/workouts/news/reddit) are owned by the
// operator's sylo-personal-tools bundle, not sylo-dev. When the bundle is
// installed, Pi's package loader copies them into ~/.pi/agent/skills. When the
// bundle is ABSENT (work/controls machines, or any machine that ran an older
// bootstrap that copied them here), stale orphan folders would still be
// scanned by Pi and register their routes — e.g. the "Health" sidebar
// dashboard link. Mirror personal-plugin.ts resolution and purge them only
// when the bundle is not resolvable (so the home machine keeps its skills).
function personalToolsInstalled() {
  // Renamed 2026-09-02: sylo-personal-tools → sylo-tools-personal (legacy name kept as alias).
  const env = process.env.SYLO_TOOLS_PERSONAL_DIR?.trim() ?? process.env.SYLO_PERSONAL_TOOLS_DIR?.trim()
  if (env && fs.existsSync(path.resolve(env))) return true
  try {
    const settingsPath = path.join(agent, 'settings.json')
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      const entry = (raw.packages ?? []).find((p) =>
        ['sylo-tools-personal', 'sylo-personal-tools'].includes(path.basename(String(p).replace(/\\/g, '/'))))
      if (entry && fs.existsSync(path.resolve(path.dirname(settingsPath), entry))) return true
    }
  } catch { /* settings unreadable — fall through */ }
  const fallback = path.join(os.homedir(), 'Documents', 'GitHub', 'sylo-tools-personal')
  if (fs.existsSync(fallback)) return true
  return fs.existsSync(path.join(os.homedir(), 'Documents', 'GitHub', 'sylo-personal-tools'))
}

const personalSkillNames = ['nutrition', 'workouts', 'news', 'reddit']
if (!personalToolsInstalled()) {
  for (const name of personalSkillNames) {
    const dir = path.join(agent, 'skills', name)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      console.log('Sylo bootstrap: removed stale personal skill (bundle absent):', dir)
    }
  }
} else {
  console.log('Sylo bootstrap: sylo-tools-personal bundle present — keeping personal skills')
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
ensureCopyTree(
  'packages/sylo-pdf-reader/skills/pdf-reader',
  path.join(agent, 'skills', 'pdf-reader'),
)
ensureCopyTree(
  'packages/sylo-spreadsheet/skills/spreadsheet',
  path.join(agent, 'skills', 'spreadsheet'),
)
ensureCopyTree(
  'packages/sylo-docx/skills/docx',
  path.join(agent, 'skills', 'docx'),
)
// (template-docx-writer / machine-expert / ignition / logicforge / fieldbrain
// skills moved 2026-09-02 to the operator's sylo-tools-controls bundle, and
// onenote to sylo-tools-onenote — Pi's package loader copies bundle skills;
// they are not bundled sylo-dev skills anymore.)
// (nutrition/workouts/news/reddit skills now come from the installed
// sylo-personal-tools bundle — Pi's package loader copies them; they are not
// bundled sylo-dev skills. Stale copies left on machines without the bundle
// are purged by the personalToolsInstalled() check above.)
ensureCopyTree(
  'packages/sylo-web-access/skills/web-access',
  path.join(agent, 'skills', 'web-access'),
)
ensureCopyTree(
  'packages/sylo-tts/skills/tts',
  path.join(agent, 'skills', 'tts'),
)
ensureCopyTree(
  'packages/sylo-think-tank/skills/think-tank',
  path.join(agent, 'skills', 'think-tank'),
)
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

for (const staleSkill of [
  'music-production',
  'ableton-reference',
  'council',
  'financial-news',
  'schematic-reader',
  'logicscout',
]) {
  const stalePath = path.join(agent, 'skills', staleSkill)
  if (fs.existsSync(stalePath)) {
    fs.rmSync(stalePath, { recursive: true, force: true })
    console.log('[bootstrap-pi] removed stale skill →', stalePath)
  }
}

console.log('Sylo Pi bootstrap complete →', agent)
