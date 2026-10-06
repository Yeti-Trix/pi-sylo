import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  /** Monotonic token: only the newest list fetch may commit — a slow in-flight
   *  fetch resolving after a newer one used to overwrite fresh state with the old
   *  snapshot, which is how the runs strip kept saying "1 subagent running"
   *  for a finished run while the DB had zero live rows (B2). */
  const fetchGenRef = useRef(0)

  const reload = useCallback(async () => {
    if (!conversationId) {
      fetchGenRef.current += 1
      setTasks([])
      return
    }
    const gen = ++fetchGenRef.current
    setLoading(true)
    try {
      const rows = await window.sylo.tasks.list(conversationId)
      if (gen === fetchGenRef.current) setTasks(rows)
    } finally {
      if (gen === fetchGenRef.current) setLoading(false)
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
