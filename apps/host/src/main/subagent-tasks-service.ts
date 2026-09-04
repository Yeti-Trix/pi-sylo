import type { SyloSubagentHostEvent } from '../shared/subagent-tasks-types.js'
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
      })
      break
    case 'subagent_run_update':
      store.updateAgentTaskProgress(event.runId, {
        partialText: event.partialText,
        toolName: event.toolName,
        toolPreview: event.toolPreview,
      })
      break
    case 'subagent_run_end':
      store.finalizeAgentTask(event.runId, {
        status: event.status,
        resultSummary: event.resultText?.slice(0, 2000) ?? event.error?.slice(0, 2000),
        resultJson: {
          resultText: event.resultText,
          error: event.error,
          usage: event.usage,
        },
        tokensUsed: event.usage ? event.usage.input + event.usage.output : undefined,
      })
      break
  }
}

export const subagentTaskStore = store
