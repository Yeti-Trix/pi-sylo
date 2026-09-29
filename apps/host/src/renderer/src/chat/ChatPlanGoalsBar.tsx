import React, { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '../lib/cn'
import { chatPlanGoals, chatPlanGoalsHead, chatPlanGoalsItem, chatPlanGoalsList } from '../panels/ui-classes'

type PlanGoalState = 'open' | 'built' | 'passed'

type PlanTodo = { id: string; text: string; done: boolean; state: PlanGoalState }

type PlanSnapshot = {
  conversationId: string
  goal?: string
  todos: PlanTodo[]
  status: 'active' | 'reviewed'
}

const STATE_TITLE: Record<PlanGoalState, string> = {
  open: 'Not started',
  built: 'Built — waiting on a review',
  passed: 'Passed review',
}

const EMPTY: PlanSnapshot = { conversationId: '', todos: [], status: 'active' }

export function ChatPlanGoalsBar({
  conversationId,
}: {
  conversationId: string | undefined
}): React.ReactElement | null {
  const [snap, setSnap] = useState<PlanSnapshot>(EMPTY)

  // The bar refuses to hide mid-run (the orchestrator still needs its goals);
  // surface that refusal as the button's tooltip for a few seconds.
  const [hideBlocked, setHideBlocked] = useState(false)
  const hideHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (hideHintTimer.current) clearTimeout(hideHintTimer.current)
    },
    [],
  )

  const hidePlan = useCallback(() => {
    if (!conversationId) return
    void window.sylo.plan.hide(conversationId).then((res) => {
      if (!res.ok && res.reason === 'subagents_running') {
        setHideBlocked(true)
        if (hideHintTimer.current) clearTimeout(hideHintTimer.current)
        hideHintTimer.current = setTimeout(() => setHideBlocked(false), 3500)
      }
    })
  }, [conversationId])

  const load = useCallback(async () => {
    if (!conversationId) {
      setSnap(EMPTY)
      return
    }
    try {
      setSnap(await window.sylo.plan.todos(conversationId))
    } catch {
      setSnap({ conversationId, todos: [], status: 'active' })
    }
  }, [conversationId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => window.sylo.plan.onChanged(() => void load()), [load])

  if (snap.todos.length === 0) return null

  const done = snap.todos.filter((t) => t.state === 'passed').length
  const built = snap.todos.filter((t) => t.state === 'built').length

  return (
    <div className={chatPlanGoals} role="region" aria-label="Plan goals">
      <div className={chatPlanGoalsHead}>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {snap.goal ?? 'Plan'}
        </span>
        {snap.status === 'reviewed' ? (
          <span
            className="shrink-0 rounded border border-accent/45 px-1.5 py-px text-[0.7rem] text-accent"
            title="Reviewed — clears when you send the next message"
          >
            Reviewed
          </span>
        ) : null}
        <span
          className="shrink-0 tabular-nums text-text-secondary"
          title={built > 0 ? `${built} built, waiting on a review` : undefined}
        >
          {done}/{snap.todos.length}
          {built > 0 ? ` (+${built})` : ''}
        </span>
        <button
          type="button"
          aria-label="Hide plan goals"
          title={
            hideBlocked
              ? "Can't hide while a subagent run is active"
              : 'Hide plan goals — reappears if you continue this plan'
          }
          className="shrink-0 cursor-pointer text-[0.8rem] leading-none opacity-60 hover:opacity-100"
          onClick={hidePlan}
        >
          ✕
        </button>
      </div>
      <ul className={chatPlanGoalsList}>
        {snap.todos.map((todo) => (
          <li key={todo.id} className={chatPlanGoalsItem} title={STATE_TITLE[todo.state]}>
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={todo.state === 'passed'}
              // Built but unreviewed: shown as indeterminate, because the work is done
              // and the box is not — only a passing review ticks it.
              ref={(el) => {
                if (el) el.indeterminate = todo.state === 'built'
              }}
              tabIndex={-1}
              aria-hidden
              onChange={(e) => e.preventDefault()}
              onClick={(e) => e.preventDefault()}
            />
            <span
              className={cn(
                todo.state === 'passed' && 'text-text-secondary line-through',
                todo.state === 'built' && 'text-text-secondary',
              )}
            >
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
