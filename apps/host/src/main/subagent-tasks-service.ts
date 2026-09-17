import { existsSync } from 'node:fs'

import { parseReviewVerdict } from '../../../../packages/sylo-subagents/extensions/plan-checklist.ts'
import {
  isPlannerAgentName,
  isReviewerAgentName,
  markPlanReviewed,
  tickReviewedGoals,
  writeCurrentPlan,
} from '../../../../packages/sylo-subagents/extensions/plan-file.ts'
import type { SyloSubagentHostEvent } from '../shared/subagent-tasks-types.js'
import { getConversation, getWorkspace } from './database.js'
import { notifyPlanTodosChanged } from './plan-todos-host.js'
import * as store from './subagent-tasks-db.js'

let currentHostSessionId: string | undefined

export function initSubagentTaskHostSession(): string {
  currentHostSessionId = store.beginHostSession()
  return currentHostSessionId
}

export function shutdownSubagentTaskHostSession(): void {
  if (!currentHostSessionId) return
  store.endHostSession(currentHostSessionId)
  currentHostSessionId = undefined
}

export function onBrokerExitOrphanTasks(): void {
  if (!currentHostSessionId) return
  store.orphanRunningTasksForHostSession(currentHostSessionId, 'broker_exit')
}

export function getCurrentHostSessionId(): string | undefined {
  return currentHostSessionId
}

function conversationWorkspaceCwd(conversationId: string): string | null {
  const conv = getConversation(conversationId)
  if (!conv?.workspace_id) return null
  const cwd = getWorkspace(conv.workspace_id)?.pi_cwd?.trim() ?? ''
  return cwd && existsSync(cwd) ? cwd : null
}

function planBodyFromResult(resultText: string | undefined): string {
  if (!resultText) return ''
  return resultText.replace(/\n\nPlan saved to `[^`]+`\. Later turns should read that file instead of re-planning\.\s*$/u, '').trim()
}

/** Goal heading this run was dispatched against, when the orchestrator named one. */
function taskGoal(row: ReturnType<typeof store.getAgentTask>): string | undefined {
  if (!row) return undefined
  try {
    const spec = JSON.parse(row.spec_json) as { goal?: unknown }
    return typeof spec.goal === 'string' && spec.goal.trim() ? spec.goal.trim() : undefined
  } catch {
    return undefined
  }
}

function syncWorkspacePlanFile(
  conversationId: string,
  event: Extract<SyloSubagentHostEvent, { type: 'subagent_run_end' }>,
): void {
  const row = store.getAgentTask(event.runId)
  const agent = row?.agent_name ?? ''
  const cwd = conversationWorkspaceCwd(conversationId)
  if (!cwd) return
  if (event.status === 'succeeded' && isPlannerAgentName(agent)) {
    writeCurrentPlan(cwd, planBodyFromResult(event.resultText), { conversationId })
    return
  }
  if (event.status === 'succeeded' && isReviewerAgentName(agent)) {
    // The review's verdict — not the worker that wrote the code — is what closes a
    // goal. A review naming no goal is a whole-plan pass, so it closes all of them.
    if (parseReviewVerdict(event.resultText) === 'pass') {
      const goal = taskGoal(row)
      tickReviewedGoals(cwd, conversationId, goal ? [goal] : 'all')
    }
    // Sign off, do not delete: the goals bar stays until the operator sends again.
    // No-ops unless the ticks above completed the plan.
    markPlanReviewed(cwd, conversationId)
  }
}

export function handleSubagentHostEvent(conversationId: string, event: SyloSubagentHostEvent): void {
  const hostSessionId = currentHostSessionId
  if (!hostSessionId) return

  switch (event.type) {
    case 'subagent_run_start':
      store.insertAgentTaskStart({
        id: event.runId,
        hostSessionId,
        conversationId,
        parentTaskId: event.parentRunId,
        groupRunId: event.groupRunId,
        mode: event.mode,
        agent: event.agent,
        task: event.task,
        stepIndex: event.stepIndex,
        model: event.model,
        goal: event.goal,
      })
      break
    case 'subagent_run_update':
      store.updateAgentTaskProgress(event.runId, {
        partialText: event.partialText,
        partialThinking: event.partialThinking,
        thinkingLive: event.thinkingLive,
        toolName: event.toolName,
        toolPreview: event.toolPreview,
        model: event.model,
      })
      break
    case 'subagent_run_end':
      store.finalizeAgentTask(event.runId, {
        status: event.status,
        resultSummary: event.resultText?.slice(0, 2000) ?? event.error?.slice(0, 2000),
        resultJson: {
          resultText: event.resultText,
          thinking: event.thinking,
          model: event.model,
          error: event.error,
          usage: event.usage,
        },
        tokensUsed: event.usage ? event.usage.input + event.usage.output : undefined,
      })
      syncWorkspacePlanFile(conversationId, event)
      notifyPlanTodosChanged()
      break
  }
}

export const subagentTaskStore = store
