export const WORKFLOW_SKILL_DATA_KEY = 'sylo-workflows'
export const DEFAULT_WORKFLOW_ID = 'io-alias-scaffold'

export type WorkflowConfig = {
  selectedWorkflowId: string
}

export type WorkflowListEntry = {
  id: string
  title: string
  description: string
  source: string
  path: string
  filename: string
  editable?: boolean
}

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  selectedWorkflowId: DEFAULT_WORKFLOW_ID,
}

function normalizeWorkflowId(raw: string | undefined): string {
  const id = String(raw ?? '').trim()
  if (!id) return DEFAULT_WORKFLOW_ID
  return id
}

export function migrateWorkflowConfig(raw: unknown): WorkflowConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_WORKFLOW_CONFIG }
  }
  const r = raw as Record<string, unknown>
  const workflowRaw = r.selectedWorkflowId ?? r.selectedSkill
  return {
    selectedWorkflowId: normalizeWorkflowId(String(workflowRaw ?? '')),
  }
}

export function buildWorkflowPrompt(
  workflow: { id: string; title: string; body: string },
  workspaceDir: string,
): string {
  const workspace = workspaceDir.trim() || '(active workspace — set sidebar project folder)'
  return [
    `# Workflow: ${workflow.title}`,
    '',
    `Workflow id: \`${workflow.id}\``,
    `Project folder (Pi cwd): ${workspace}`,
    '',
    '**Before you start:** If the operator did not attach required files to this message, ask for them and stop.',
    '',
    '---',
    '',
    workflow.body.trim(),
  ].join('\n')
}