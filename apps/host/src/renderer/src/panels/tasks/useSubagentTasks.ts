import { useCallback, useEffect, useMemo, useState } from 'react'

import type { AgentTaskRow } from './task-types'

type LifecyclePayload = {
  conversationId?: string | null
  type?: string
}

export function useSubagentTasks(conversationId: string | null): {
  tasks: AgentTaskRow[]
  running: AgentTaskRow[]
  runningCount: number
  loading: boolean
  reload: () => Promise<void>
} {
  const [tasks, setTasks] = useState<AgentTaskRow[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!conversationId) {
      setTasks([])
      return
    }
    setLoading(true)
    try {
      const rows = await window.sylo.tasks.list(conversationId)
      setTasks(rows)
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const unsub = window.sylo.tasks.onLifecycle((raw) => {
      const payload = raw as LifecyclePayload
      if (payload.conversationId && payload.conversationId !== conversationId) return
      if (!payload.conversationId && conversationId) {
        void reload()
        return
      }
      void reload()
    })
    return unsub
  }, [conversationId, reload])

  const running = useMemo(() => tasks.filter((t) => t.status === 'running'), [tasks])

  return {
    tasks,
    running,
    runningCount: running.length,
    loading,
    reload,
  }
}
