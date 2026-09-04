import {
  classifySyloBuiltinExtension,
  syloBuiltinExtensionHint,
} from './sylo-builtin-extensions.js'

/** Bundled first-party Pi package — off by default; enable in Capability manager → Sylo optional packages. */
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
  /** Relative to Sylo repo root; Python script run after pip succeeds (e.g. copy IDE scripts). */
  postEnableScriptRelPath?: string
  /** When true, package expects Sylo host UI (routes/widgets) — not required for all sylo-* names. */
  requiresSyloUi: boolean
}

export const SYLO_OPTIONAL_PACKAGES: readonly SyloOptionalPackage[] = [
  {
    id: 'sylo-pdf-reader',
    title: 'PDF reader',
    description:
      'Search any PDF by text (optional OCR), render pages/regions as PNG for vision, and OCR crops. ' +
      'Works on local paths and http(s) PDF URLs (datasheets, manuals, schematics). Pair with the **pdf-reader** skill.',
    extensionRelPath: 'packages/sylo-pdf-reader/extensions/index.ts',
    skillNames: ['pdf-reader'],
    pythonRequirementsRelPath: 'packages/sylo-pdf-reader/scripts/requirements.txt',
    requiresSyloUi: false,
  },
  {
    id: 'sylo-docx',
    title: 'DOCX',
    description:
      'Read and write Word .docx files: **read_docx** / **extract_docx_images** (structured JSON, image anchors) and ' +
      '**render_docx** (markdown → styled .docx via Pandoc). Pair with the **docx** skill; use **template-docx-writer** for Word-template documents.',
    extensionRelPath: 'packages/sylo-docx/extensions/index.ts',
    skillNames: ['docx'],
    pythonRequirementsRelPath: 'packages/sylo-docx/scripts/requirements.txt',
    // Best-effort, non-fatal: installs Pandoc (per-user via winget) so
    // render_docx works after enable. Read tools work without it. See
    // scripts/post-enable.py.
    postEnableScriptRelPath: 'packages/sylo-docx/scripts/post-enable.py',
    requiresSyloUi: false,
  },
  // 2026-09-02: sylo-template-docx-writer, sylo-machine-expert, sylo-codesys,
  // sylo-logicforge, sylo-ignition, sylo-fieldbrain moved to the operator's
  // sylo-tools-controls bundle; sylo-onenote moved to sylo-tools-onenote.
  // Installed via ~/.pi/agent/settings.json packages (see README there).
  {
    id: 'sylo-spreadsheet',
    title: 'Spreadsheet',
    description:
      'Read .xlsx and .ods workbooks as JSON (read_spreadsheet) and create .xlsx workbooks with data and native charts (write_spreadsheet). ' +
      'Pair with the spreadsheet skill in chat. Use Pi read for .csv.',
    extensionRelPath: 'packages/sylo-spreadsheet/extensions/index.ts',
    skillNames: ['spreadsheet'],
    pythonRequirementsRelPath: 'packages/sylo-spreadsheet/scripts/requirements.txt',
    requiresSyloUi: false,
  },
  {
    id: 'sylo-web-access',
    title: 'Web access',
    description:
      'Privacy-first web search + fetch (DuckDuckGo, local fetch). Results are LLM-ranked, cleaned, and returned with source URLs for the agent to cite. ' +
      'Includes **sylo_youtube_transcript** for YouTube captions (not sylo_web_fetch). ' +
      'Enable the web-access skill so the model knows when to search vs fetch vs transcript. Sidebar **Web access** tab: history and settings. ' +
      'No cloud accounts, no tracking.',
    extensionRelPath: 'packages/sylo-web-access/extensions/index.ts',
    skillNames: ['web-access'],
    pythonRequirementsRelPath: 'packages/sylo-web-access/scripts/requirements.txt',
    requiresSyloUi: true,
  },
  {
    id: 'sylo-tts',
    title: 'Speech',
    description:
      'Local text-to-speech (Kokoro + Orpheus). Agent tool sylo_tts_speak; ' +
      'default voice in extension config. Sidebar **Speech** tab for paste-and-generate. ' +
      'GPU recommended; installs Kokoro Python deps on enable. Orpheus: optional pip file.',
    extensionRelPath: 'packages/sylo-tts/extensions/index.ts',
    skillNames: ['tts'],
    pythonRequirementsRelPath: 'packages/sylo-tts/scripts/requirements.txt',
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
    requiresSyloUi: false,
  },
  {
    id: 'sylo-think-tank',
    title: 'Think Tank',
    description:
      'Multi-model think tank (min 2 / max 10 cycles). Tools: sylo_think_tank_run, sylo_think_tank_status, sylo_think_tank_pick (optional programmatic pick — not surfaced in UI). ' +
      'Sessions finalize automatically when final reports are ready; the Moderator report is the decision brief. ' +
      'Sidebar **Think Tank** route: configure seat models (same options as Settings → Model (Pi)). ' +
      'Pair with the **think-tank** skill — trigger in chat with "Think Tank: …" or "send to think tank".',
    extensionRelPath: 'packages/sylo-think-tank/extensions/index.ts',
    skillNames: ['think-tank'],
        requiresSyloUi: true,
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
    requiresSyloUi: true,
  },
] as const

const OPTIONAL_PACKAGE_IDS = new Set(SYLO_OPTIONAL_PACKAGES.map((p) => p.id))

export function normalizeSyloOptionalPackagesPref(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = { ...(raw as Record<string, unknown>) }
  if (src['sylo-council'] === true && src['sylo-think-tank'] !== true) {
    src['sylo-think-tank'] = true
  }
  // (sylo-news / sylo-reddit moved out of Sylo 2026-09-01 — now in the operator's
  // personal-tools repo, installed via `pi install git:...`, not optional packages.)
  // (sylo-health moved out 2026-09-01 too — it is the personal bundle's host
  // plugin + agent package now; the host loads it at runtime via
  // main/personal-plugin.ts, no optional-package entry needed.)
  if (src['sylo-schematic-reader'] === true && src['sylo-pdf-reader'] !== true) {
    src['sylo-pdf-reader'] = true
  }
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
  return pref[packageId] === true
}

/** Optional package that owns a skill folder name (e.g. `nutrition` → sylo-health). */
export function findOptionalPackageForSkillFolder(skillFolderName: string): SyloOptionalPackage | undefined {
  const name = skillFolderName.trim().toLowerCase()
  if (!name) return undefined
  return SYLO_OPTIONAL_PACKAGES.find((p) => p.skillNames.some((s) => s.toLowerCase() === name))
}

/** False when the skill belongs to an optional package that is off in prefs. */
export function isSkillVisibleForOptionalPackages(
  skillFolderName: string,
  pref: Record<string, boolean>,
): boolean {
  const pkg = findOptionalPackageForSkillFolder(skillFolderName)
  if (!pkg) return true
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
  return `${pkg.description} ${ui} Enable in Capability manager to install Python deps automatically when needed.`
}

export function syloExtensionHintForPath(path: string): string | undefined {
  const builtinKind = classifySyloBuiltinExtension(path)
  if (builtinKind) return syloBuiltinExtensionHint(builtinKind)
  const optionalId = classifySyloOptionalPackageId(path)
  if (!optionalId) return undefined
  const pkg = findSyloOptionalPackage(optionalId)
  return pkg ? syloOptionalPackageHint(pkg) : undefined
}
