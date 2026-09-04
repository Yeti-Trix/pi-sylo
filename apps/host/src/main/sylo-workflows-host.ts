/**
 * Sylo workflows host backend — pure TypeScript (no Python). Imported by the host main process
 * for the Tools → Workflows route UI via IPC (`syloWorkflows:*`). The same TS engine powers the
 * `sylo_workflows_list` agent tool in the broker extension.
 *
 * `bundledDir` is passed explicitly (repo-root-derived) because the engine's import.meta.url-based
 * default is unreliable once this module is bundled into the host main chunk. The depth math
 * (`out/main` ↔ `src/main`) mirrors the prior LogicForge host backend pattern.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  deleteWorkflow,
  discoverWorkflows,
  legacyOperatorWorkflowsDir,
  operatorWorkflowsDir,
  readWorkflowBody,
  saveWorkflow,
  type WorkflowEntry,
} from '../../../../packages/sylo-workflows/extensions/workflows-engine.js'

const hostMainDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(hostMainDir, '..', '..', '..', '..')
const BUNDLED_DIR = join(repoRoot, 'packages', 'sylo-workflows', 'shared', 'workflows')

export type SyloWorkflowEntry = WorkflowEntry

export async function syloWorkflowsList(payload: {
  project_dir: string
  agent_dir: string
}): Promise<{
  ok: true
  workflows: SyloWorkflowEntry[]
  library: { operator_dir: string; bundled_dir: string; legacy_dir: string }
}> {
  const workflows = await discoverWorkflows({ agentDir: payload.agent_dir, bundledDir: BUNDLED_DIR })
  return {
    ok: true,
    workflows,
    library: {
      operator_dir: operatorWorkflowsDir(payload.agent_dir),
      bundled_dir: BUNDLED_DIR,
      legacy_dir: legacyOperatorWorkflowsDir(payload.agent_dir),
    },
  }
}

export async function syloWorkflowRead(payload: {
  project_dir: string
  agent_dir: string
  id: string
}): Promise<{
  ok: true
  id: string
  title: string
  description: string
  source: string
  path: string
  editable: boolean
  body: string
  raw: string
}> {
  const id = payload.id.trim()
  if (!id) throw new Error('workflow id is required')
  const read = await readWorkflowBody(id, {
    agentDir: payload.agent_dir,
    projectDir: payload.project_dir,
    bundledDir: BUNDLED_DIR,
  })
  if (!read) throw new Error(`workflow not found: ${id}`)
  return {
    ok: true,
    id: read.entry.id,
    title: read.entry.title,
    description: read.entry.description,
    source: read.entry.source,
    path: read.entry.path,
    editable: read.entry.editable,
    body: read.body,
    raw: read.raw,
  }
}

export async function syloWorkflowSave(payload: {
  agent_dir: string
  content: string
  previous_id?: string
}): Promise<{ ok: true; workflow: SyloWorkflowEntry }> {
  const workflow = await saveWorkflow(payload.content, {
    agentDir: payload.agent_dir,
    previousId: payload.previous_id,
  })
  return { ok: true, workflow }
}

export async function syloWorkflowDelete(payload: {
  agent_dir: string
  id: string
}): Promise<{ ok: true; deleted: SyloWorkflowEntry }> {
  const deleted = await deleteWorkflow(payload.id, { agentDir: payload.agent_dir })
  return { ok: true, deleted }
}