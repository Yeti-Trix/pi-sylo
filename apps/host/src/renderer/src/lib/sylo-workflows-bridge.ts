/** Resolve Sylo workflows IPC from preload (full app restart required after host updates). */

export type SyloWorkflowEntry = {
  id: string
  title: string
  description: string
  source: string
  path: string
  filename: string
  editable: boolean
}

export async function syloWorkflowsList(payload?: {
  project_dir?: string
  agent_dir?: string
}): Promise<{
  ok: true
  workflows: SyloWorkflowEntry[]
  library: { operator_dir: string; bundled_dir: string; legacy_dir: string }
}> {
  const fn = window.sylo.skillSurface?.syloWorkflowsList
  if (!fn)
    throw new Error(
      'Sylo workflows bridge not loaded. Quit Sylo completely (Restart broker is not enough) and run full-build-run-sylo.cmd again.',
    )
  return fn(payload ?? {})
}

export async function syloWorkflowRead(payload: {
  project_dir: string
  id: string
  agent_dir?: string
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
  const fn = window.sylo.skillSurface?.syloWorkflowRead
  if (!fn)
    throw new Error(
      'Sylo workflows bridge not loaded. Quit Sylo completely (Restart broker is not enough) and run full-build-run-sylo.cmd again.',
    )
  return fn(payload)
}

export async function syloWorkflowSave(payload: {
  content: string
  previous_id?: string
  agent_dir?: string
}): Promise<{ ok: true; workflow: SyloWorkflowEntry }> {
  const fn = window.sylo.skillSurface?.syloWorkflowSave
  if (!fn)
    throw new Error(
      'Sylo workflows bridge not loaded. Quit Sylo completely (Restart broker is not enough) and run full-build-run-sylo.cmd again.',
    )
  return fn(payload)
}

export async function syloWorkflowDelete(payload: {
  id: string
  agent_dir?: string
}): Promise<{ ok: true; deleted: SyloWorkflowEntry }> {
  const fn = window.sylo.skillSurface?.syloWorkflowDelete
  if (!fn)
    throw new Error(
      'Sylo workflows bridge not loaded. Quit Sylo completely (Restart broker is not enough) and run full-build-run-sylo.cmd again.',
    )
  return fn(payload)
}