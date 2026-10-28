import {
  classifySyloBuiltinExtension,
  syloBuiltinExtensionHint,
} from './sylo-builtin-extensions.js'

/** Bundled first-party Pi package — toggle in Capability manager; core packages are always on (see `core`). */
export type SyloOptionalPackage = {
  id: string
  title: string
  description: string
  /** Relative to Sylo repo root (dev install). */
  extensionRelPath: string
  skillNames: string[]
  /** Relative to Sylo repo root; Python script run before pip (e.g. git submodule / vendor clone). */
  preEnableScriptRelPath?: string
  /** Relative to Sylo repo root; Sylo runs pip on enable when set. */
  pythonRequirementsRelPath?: string
  /** Relative to Sylo repo root; best-effort pip on enable (extra backend deps). A failure here is reported but does NOT fail the enable. */
  pythonOptionalRequirementsRelPath?: string
  /** Relative to Sylo repo root; Python script run after pip succeeds (e.g. copy IDE scripts). */
  postEnableScriptRelPath?: string
  /** When true, package expects Sylo host UI (routes/widgets) — not required for all sylo-* names. */
  requiresSyloUi: boolean
  /**
   * Always-on core (issue #39): loaded and visible regardless of prefs and
   * hidden from the Capability manager toggle list. The registry row stays —
   * the broker still needs extensionRelPath.
   */
  core?: boolean
}

export const SYLO_OPTIONAL_PACKAGES: readonly SyloOptionalPackage[] = [
  {
    id: 'sylo-terminal-bridge',
    title: 'Terminal bridge',
    description:
      'Agent-side **terminal_read** tool — read Sylo terminal pane scrollback from chat (list panes or tail one). Inert on vanilla Pi; needs a Sylo terminal pane to be open. See pi-sylo issue #7.',
    extensionRelPath: 'packages/sylo-terminal-bridge/extensions/index.ts',
    skillNames: [],
    core: true,
    requiresSyloUi: false,
  },
  // (sylo-pdf-reader / sylo-docx / sylo-spreadsheet / sylo-web-access registry
  // rows removed 2026-10-27 — all four extracted to the operator's personal
  // repos ~/Documents/GitHub/sylo-{pdf-reader,docx,spreadsheet,web-access},
  // installed via ~/.pi/agent/settings.json `packages`. fetch-pdf's pdf-cache
  // import was vendored into the web-access repo first so the sibling import
  // could not dangle; monorepo package folders are deleted. Issue #39.)
  // 2026-09-02: sylo-template-docx-writer, sylo-machine-expert, sylo-codesys,
  // sylo-allen-bradley, sylo-ignition, sylo-fieldbrain moved to the operator's
  // sylo-tools-controls bundle; sylo-onenote moved to sylo-tools-onenote.
  // Installed via ~/.pi/agent/settings.json packages (see README there).
  {
    id: 'sylo-tts',
    title: 'Speech',
    description:
      'Local text-to-speech (Kokoro + Orpheus). Agent tool sylo_tts_speak; ' +
      'default voice in extension config. Sidebar **Speech** tab for paste-and-generate. ' +
      'GPU recommended; installs both backends\u2019 Python deps on enable ' +
      '(Orpheus best-effort — self-heals on first use).',
    extensionRelPath: 'packages/sylo-tts/extensions/index.ts',
    skillNames: ['tts'],
    pythonRequirementsRelPath: 'packages/sylo-tts/scripts/requirements.txt',
    pythonOptionalRequirementsRelPath: 'packages/sylo-tts/scripts/requirements-orpheus.txt',
    requiresSyloUi: true,
  },
  // (sylo-logicforge → sylo-tools-controls bundle)
  // (sylo-ignition → sylo-tools-controls bundle)
  {
    id: 'sylo-workflows',
    title: 'Workflows',
    description:
      'A database of operator **prompt playbooks** (markdown + YAML frontmatter) loaded into chat on demand. ' +
      'Agent tool **sylo_workflows_list** lists them; create/edit/delete with `read`/`write`/`edit`/`bash` on `~/.pi/agent/workflows/*.md`. ' +
      'Sources: bundled + `~/.pi/agent/workflows/` (yours) + legacy `~/.pi/agent/logicforge/workflows/`. ' +
      'Sidebar **Workflows** route under **Tools**: pick a workflow → Send to agent (substitutes `{workspace}`). No Python.',
    extensionRelPath: 'packages/sylo-workflows/extensions/index.ts',
    skillNames: ['sylo-workflows'],
    core: true,
    requiresSyloUi: true,
  },
  // (sylo-fieldbrain → sylo-tools-controls bundle; sylo-onenote → sylo-tools-onenote bundle)
  {
    id: 'sylo-coder',
    title: 'Coder',
    description:
      'Coding-quality package — **smart_edit** (fuzzy/whitespace-tolerant edit that replaces the exact-match failure mode of Pi `edit`), ' +
      'plus the **sylo-coder** skill (plan→edit→verify discipline and a researcher→planner→implementer→reviewer subagent chain for multi-file refactors). ' +
            'No diff-review UI. Phase 2 adds local codebase semantic search (Ollama embeddings).',
    extensionRelPath: 'packages/sylo-coder/extensions/index.ts',
    skillNames: ['sylo-coder'],
    core: true,
    requiresSyloUi: false,
  },
    {
    id: 'sylo-chat-export',
    title: 'Chat export',
    description:
      'Export chat(s) from the on-disk session JSONL to markdown — **compaction-proof** (raw user/assistant entries survive compaction). ' +
      'Tool **sylo_chat_export**: current session by default, or `all_sessions:true` to export every session in the workspace. ' +
      'Writes transcripts to `journal/.chat-export-*.md` and returns a manifest. Powers the operator-owned **chat-recap** / **chat-recap-all** workflows. No Python; chat-only.',
    extensionRelPath: 'packages/sylo-chat-export/extensions/index.ts',
    skillNames: ['chat-export'],
    core: true,
    requiresSyloUi: false,
  },
  {
    id: 'sylo-tasks',
    title: 'Tasks',
    description:
      'Per-workspace task lists shared by agent + operator — `sylo_task_create_list` / `sylo_task_add` / `sylo_task_update` / `sylo_task_list` / `sylo_task_get` / `sylo_task_delete`. ' +
      'Storage owns truth (JSON at `<workspace>/.sylo/tasks.json`); agent re-reads on its turn so operator edits land (eventual consistency). ' +
      'Dependencies (blocked_by/blocks), notes, due dates; per-list mode agent_driven | operator_driven. ' +
      'Live Canvas board (Phase 2) + sidebar dashboard (Phase 3) bind to a list by liveId. Pair with the **tasks** skill.',
    extensionRelPath: 'packages/sylo-tasks/extensions/index.ts',
    skillNames: ['tasks'],
    core: true,
    requiresSyloUi: true,
  },
  {
    id: 'sylo-image-gen',
    title: 'Image studio',
    description:
      'Local-first image generation through **ComfyUI** (agent tool sylo_image_gen_generate) with a ' +
      'per-workspace **image library** (tags, favorites, search) shared by chat and the sidebar **Images** ' +
      'route. Draft→final presets (fast Z-Image/Qwen drafts, high-quality finals), provenance metadata, ' +
      'cost/time ledger. ComfyUI is an external app you install separately — the package talks to it over ' +
      'HTTP and needs **no Python of its own**. Tool sylo_image_gen_doctor guides setup in chat.',
    extensionRelPath: 'packages/sylo-image-gen/extensions/index.ts',
    skillNames: ['image-gen'],
    requiresSyloUi: true,
  },
  {
    id: 'sylo-video-gen',
    title: 'Video studio',
    description:
      'Local-first video generation through **ComfyUI** (agent tool sylo_video_gen_generate) with a ' +
      'per-workspace **video library** (tags, favorites, search) shared by chat and the sidebar ' +
      '**Videos** route. Three v1 modes as preset ComfyUI graphs — shot clips (t2v/i2v, draft ' +
      'Wan-2.2 ti2v-5B → final Wan-2.2 A14B), living-photo loops (first==last-frame conditioning, ' +
      'song backdrops), and whole-clip restyle (Wan-2.1 VACE) — with a durable render ledger that ' +
      'survives restarts and a GPU-time budget. ComfyUI is an external app you install separately — ' +
      'the package talks to it over HTTP and needs **no Python of its own**. Tool ' +
      'sylo_video_gen_doctor guides setup in chat.',
    extensionRelPath: 'packages/sylo-video-gen/extensions/index.ts',
    skillNames: ['video-gen'],
    requiresSyloUi: true,
  },
] as const

const OPTIONAL_PACKAGE_IDS = new Set(SYLO_OPTIONAL_PACKAGES.map((p) => p.id))

export function normalizeSyloOptionalPackagesPref(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = { ...(raw as Record<string, unknown>) }
    // (sylo-think-tank removed 2026-10-27, issue #41 — the legacy sylo-council
  // pref now normalizes away through the known-id filter, same as
  // sylo-schematic-reader / sylo-web-access.)
  // (sylo-news / sylo-reddit moved out of Sylo 2026-09-01 — now in the operator's
  // personal-tools repo, installed via `pi install git:...`, not optional packages.)
  // (sylo-health moved out 2026-09-01 too — it is the personal bundle's host
  // plugin + agent package now; the host loads it at runtime via
  // main/personal-plugin.ts, no optional-package entry needed.)
  if (src['sylo-schematic-reader'] === true && src['sylo-pdf-reader'] !== true) {
    src['sylo-pdf-reader'] = true
  }
  // (sylo-pdf-reader / sylo-docx / sylo-spreadsheet / sylo-web-access left the
  // registry 2026-10-27 — extracted to the operator's personal repos, installed
  // via ~/.pi/agent/settings.json `packages`. Legacy prefs for those ids
  // normalize away in the known-id filter below; the schematic-reader
  // migration above is kept intact (C4, issue #39) — its output resolves to
  // the no-longer-known sylo-pdf-reader id and falls through the filter.)
  const out: Record<string, boolean> = {}
  for (const [key, val] of Object.entries(src)) {
    if (!OPTIONAL_PACKAGE_IDS.has(key)) continue
    if (typeof val === 'boolean') out[key] = val
  }
  return out
}

export function isSyloOptionalPackageEnabled(
  pref: Record<string, boolean>,
  packageId: string,
): boolean {
  // Core packages (issue #39) are always on — prefs gate only the regular
  // toggles. (Function declarations hoist, so findSyloOptionalPackage is safe.)
  if (findSyloOptionalPackage(packageId)?.core) return true
  return pref[packageId] === true
}

/** Optional package that owns a skill folder name (e.g. `nutrition` → sylo-health). */
export function findOptionalPackageForSkillFolder(skillFolderName: string): SyloOptionalPackage | undefined {
  const name = skillFolderName.trim().toLowerCase()
  if (!name) return undefined
  return SYLO_OPTIONAL_PACKAGES.find((p) => p.skillNames.some((s) => s.toLowerCase() === name))
}

/** False when the skill belongs to an optional package that is off in prefs. Core packages (issue #39) are always visible. */
export function isSkillVisibleForOptionalPackages(
  skillFolderName: string,
  pref: Record<string, boolean>,
): boolean {
  const pkg = findOptionalPackageForSkillFolder(skillFolderName)
  if (!pkg) return true
  // Core check inside isSyloOptionalPackageEnabled makes core skills always
  // visible regardless of prefs (issue #39).
  return isSyloOptionalPackageEnabled(pref, pkg.id)
}

export function classifySyloOptionalPackageId(path: string): string | null {
  const norm = path.replace(/\\/g, '/').toLowerCase()
  if (!norm) return null
  for (const pkg of SYLO_OPTIONAL_PACKAGES) {
    const rel = pkg.extensionRelPath.replace(/\\/g, '/').toLowerCase()
    if (norm.includes(rel) || norm.endsWith(rel)) return pkg.id
  }
  return null
}

export function findSyloOptionalPackage(id: string): SyloOptionalPackage | undefined {
  return SYLO_OPTIONAL_PACKAGES.find((p) => p.id === id)
}

export function syloOptionalPackageHint(pkg: SyloOptionalPackage): string {
  const ui =
    pkg.requiresSyloUi ?
      'Uses Sylo host UI (sidebar routes or widgets).'
    : 'Works in chat via Pi tools; no Sylo sidebar UI required.'
  return (
    `${pkg.description} ${ui} ` +
    (pkg.core ?
      'Always-on core — loads without a toggle and is hidden from the Capability manager list.'
    : 'Enable in Capability manager to install Python deps automatically when needed.')
  )
}

export function syloExtensionHintForPath(path: string): string | undefined {
  const builtinKind = classifySyloBuiltinExtension(path)
  if (builtinKind) return syloBuiltinExtensionHint(builtinKind)
  const optionalId = classifySyloOptionalPackageId(path)
  if (!optionalId) return undefined
  const pkg = findSyloOptionalPackage(optionalId)
  return pkg ? syloOptionalPackageHint(pkg) : undefined
}
