import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'



import { ChatConversationMessageRow } from '../../chat/ConversationMessage'

import type { WorkflowStampedEntry } from '../../workflowTimeline'

import { cn } from '../../lib/cn'

import {

  btnGhostSm,

  chatMsgAssistant,

  chatMsgBubble,

  chatMsgHead,

  chatMsgRoleRow,

  chatMsgRow,

  chatMsgRowAssistant,

  chatMsgStatusMuted,

  chatSegmentChevron,

  chatSegmentRootClass,

  chatSegmentSummary,

  chatStopBtn,

  mutedText,

} from '../../panels/ui-classes'

import { detailsOpenFromToggleEvent } from '../../panels/capability/helpers'

import type { ThinkTankBubbleRow } from './thinkTankBubbleState'

import type { AgentTaskRow } from '../../panels/tasks/task-types'

import { ThinkTankChatInline, type ThinkTankLiveSession } from './ThinkTankSessionCard'



export type ThinkTankSessionUiState = {

  /** Per debater turn — absent id defaults open while live, closed when session finished. */

  debateOpenById: Record<string, boolean>

  reportsOpen: boolean

  reportOpenById: Record<string, boolean>

}



export function isThinkTankLiveStatus(status: string): boolean {

  return status === 'debating' || status === 'final_reports'

}



export function isThinkTankTerminalStatus(status: string): boolean {

  return status === 'complete' || status === 'awaiting_pick' || status === 'error' || status === 'cancelled'

}



function defaultUiForStatus(status: string): ThinkTankSessionUiState {

  const live = isThinkTankLiveStatus(status)

  return {

    debateOpenById: {},

    reportsOpen: live && status === 'final_reports',

    reportOpenById: {},

  }

}



export function debateTurnOpen(

  ui: ThinkTankSessionUiState,

  bubbleId: string,

  status: string,

): boolean {

  if (bubbleId in ui.debateOpenById) return ui.debateOpenById[bubbleId]!

  return isThinkTankLiveStatus(status)

}



export function reportTurnOpen(

  ui: ThinkTankSessionUiState,

  bubbleId: string,

  status: string,

): boolean {

  if (bubbleId in ui.reportOpenById) return ui.reportOpenById[bubbleId]!

  return isThinkTankLiveStatus(status)

}



function CollapseToggle({

  open,

  label,

  onToggle,

}: {

  open: boolean

  label: string

  onToggle: () => void

}): React.ReactElement {

  return (

    <button type="button" className={btnGhostSm} onClick={onToggle}>

      {open ? `Collapse ${label}` : `Expand ${label}`}

    </button>

  )

}



/** Sync open state via ref — avoids controlled-details collapsing on sibling re-renders. */

function StableDetails({

  open,

  onOpenChange,

  className,

  summary,

  children,

}: {

  open: boolean

  onOpenChange: (next: boolean) => void

  className?: string

  summary: React.ReactNode

  children: React.ReactNode

}): React.ReactElement {

  const detailsRef = useRef<HTMLDetailsElement>(null)

  const programmaticRef = useRef(false)



  useLayoutEffect(() => {

    const el = detailsRef.current

    if (!el) return

    if (el.open !== open) {

      programmaticRef.current = true

      el.open = open

    }

  }, [open])



  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {

    if (programmaticRef.current) {

      programmaticRef.current = false

      return

    }

    const next = detailsOpenFromToggleEvent(event)

    if (next === null) return

    onOpenChange(next)

  }



  return (

    <details ref={detailsRef} className={className} onToggle={handleToggle}>

      <summary className={cn(chatSegmentSummary, 'items-center')}>{summary}</summary>

      {children}

    </details>

  )

}



function ThinkTankBubbleRow(props: {

  bubble: ThinkTankBubbleRow

  liveWorkflow: Record<string, WorkflowStampedEntry[]>

  segmentOverrides: Record<string, boolean>

  onSegmentToggle: (id: string, open: boolean) => void

  onSubagentNotice?: (message: string) => void

  subagentTasks?: AgentTaskRow[]

  workspaceId?: string

}): React.ReactElement {

  const b = props.bubble

  return (

    <ChatConversationMessageRow

      m={{

        id: b.id,

        role: 'assistant',

        content: b.body,

        tool_calls_json: b.tool_calls_json,

        status: b.status,

        created_at: b.created_at,

      }}

      thinkTank={{

        seatId: b.seatId,

        seatLabel: b.seatLabel,

        seatAgent: b.seatAgent,

        cycle: b.cycle,

        stance: b.stance,

        phase: b.phase,

      }}

      liveDeltaForId=""

      liveWorkflowForMessage={props.liveWorkflow[b.id] ?? []}

      segmentOverrides={props.segmentOverrides}

      onSegmentToggle={props.onSegmentToggle}

      subagentTasks={props.subagentTasks}

      onSubagentNotice={props.onSubagentNotice}

      workspaceId={props.workspaceId}

    />

  )

}



function DebateTurnCard(props: {

  bubble: ThinkTankBubbleRow

  open: boolean

  onOpenChange: (next: boolean) => void

  liveWorkflow: Record<string, WorkflowStampedEntry[]>

  segmentOverrides: Record<string, boolean>

  onSegmentToggle: (id: string, open: boolean) => void

  onSubagentNotice?: (message: string) => void

  subagentTasks?: AgentTaskRow[]

  workspaceId?: string

}): React.ReactElement {

  const b = props.bubble

  const label = `C${b.cycle} · ${b.seatLabel}`

  const preview =

    b.body.length > 120 ? `${b.body.slice(0, 117).replace(/\s+/g, ' ')}…` : b.body



  return (

    <StableDetails

      open={props.open}

      onOpenChange={props.onOpenChange}

      className={cn(chatSegmentRootClass, 'mx-1 mt-2')}

      summary={

        <>

          <span className={cn(chatMsgRoleRow, 'text-[0.82rem]')}>{label}</span>

          {!props.open && preview ?

            <span className={cn(mutedText, 'min-w-0 flex-1 truncate text-[0.72rem]')}>{preview}</span>

          : null}

          {b.status === 'streaming' ?

            <span className={chatMsgStatusMuted}> · live</span>

          : null}

          <span className={chatSegmentChevron} aria-hidden="true" />

        </>

      }

    >

      <div className="space-y-2 px-1 pb-1 pt-2">

        <div className="flex justify-end">

          <CollapseToggle open={props.open} label={label} onToggle={() => props.onOpenChange(!props.open)} />

        </div>

        <ThinkTankBubbleRow

          bubble={b}

          liveWorkflow={props.liveWorkflow}

          segmentOverrides={props.segmentOverrides}

          onSegmentToggle={props.onSegmentToggle}

          subagentTasks={props.subagentTasks}

      onSubagentNotice={props.onSubagentNotice}

          workspaceId={props.workspaceId}

        />

        <div className="flex justify-end border-t border-border/50 pt-2">

          <CollapseToggle open={props.open} label={label} onToggle={() => props.onOpenChange(!props.open)} />

        </div>

      </div>

    </StableDetails>

  )

}



export function ThinkTankSessionBlock({

  sessionId,

  topic,

  status,

  bubbles,

  liveSession,

  uiState,

  onUiChange,

  liveWorkflow,

  segmentOverrides,

  onSegmentToggle,

  subagentTasks,

  onSubagentNotice,

    onPickReport: _onPickReport,

  onOpenThinkTankRoute,

  onAbort,

  workspaceId,

}: {

  sessionId: string

  topic: string

  status: string

  bubbles: ThinkTankBubbleRow[]

  liveSession?: ThinkTankLiveSession

  uiState?: ThinkTankSessionUiState

  onUiChange?: (sessionId: string, ui: ThinkTankSessionUiState) => void

  liveWorkflow: Record<string, WorkflowStampedEntry[]>

  segmentOverrides: Record<string, boolean>

  onSegmentToggle: (id: string, open: boolean) => void

  onSubagentNotice?: (message: string) => void

  subagentTasks?: AgentTaskRow[]

    /** Kept for backward compatibility with callers — no longer rendered. Pick is API-only. */
  onPickReport?: (sessionId: string, reportId: string) => void

  onOpenThinkTankRoute?: () => void

  onAbort?: (sessionId: string) => void

  workspaceId?: string

}): React.ReactElement {

  const debateBubbles = useMemo(() => bubbles.filter((b) => b.phase === 'debate'), [bubbles])

  const reportBubbles = useMemo(() => bubbles.filter((b) => b.phase === 'final_report'), [bubbles])



  const ui = uiState ?? defaultUiForStatus(status)

  const prevStatusRef = useRef(status)

  const terminalAutoCollapseRef = useRef(false)



  const patchUi = useCallback(

    (patch: Partial<ThinkTankSessionUiState>) => {

      const next: ThinkTankSessionUiState = {

        debateOpenById: { ...ui.debateOpenById, ...patch.debateOpenById },

        reportsOpen: patch.reportsOpen ?? ui.reportsOpen,

        reportOpenById: { ...ui.reportOpenById, ...patch.reportOpenById },

      }

      onUiChange?.(sessionId, next)

    },

    [onUiChange, sessionId, ui],

  )



  useEffect(() => {

    prevStatusRef.current = status

    terminalAutoCollapseRef.current = false

  }, [sessionId])



  // Auto-collapse once when debate finishes — never on new turns during live debate.

  useEffect(() => {

    const prev = prevStatusRef.current

    if (

      !terminalAutoCollapseRef.current &&

      isThinkTankLiveStatus(prev) &&

      isThinkTankTerminalStatus(status)

    ) {

      terminalAutoCollapseRef.current = true

      const debateOpenById: Record<string, boolean> = {}

      const reportOpenById: Record<string, boolean> = {}

      for (const b of debateBubbles) debateOpenById[b.id] = false

      for (const b of reportBubbles) reportOpenById[b.id] = false

      patchUi({ debateOpenById, reportsOpen: false, reportOpenById })

    }

    prevStatusRef.current = status

  }, [status, debateBubbles, reportBubbles, patchUi])



  const statusLabel = useMemo(() => {

    if (status === 'error') return 'error'

    if (status === 'cancelled') return 'stopped'

    if (status === 'complete') return 'complete'

    // Legacy sessions persisted before the pick UI was removed may still carry
    // awaiting_pick; render them as the terminal state they effectively are.
    if (status === 'awaiting_pick') return 'complete'

    if (status === 'final_reports') return 'final reports'

    if (status === 'debating') return 'debating'

    return status || 'think tank'

  }, [status])



  const live = isThinkTankLiveStatus(status)

  const pendingInjectCount = liveSession?.pendingOperatorInjectCount ?? 0

  const queuedInjects = liveSession?.queuedOperatorInjects ?? []



  const topicPreview = topic.length > 96 ? `${topic.slice(0, 93)}…` : topic



  const toggleDebateTurn = useCallback(

    (bubbleId: string, open: boolean) => {

      patchUi({ debateOpenById: { ...ui.debateOpenById, [bubbleId]: open } })

    },

    [patchUi, ui.debateOpenById],

  )



  const toggleReports = useCallback(() => {

    patchUi({ reportsOpen: !ui.reportsOpen })

  }, [patchUi, ui.reportsOpen])



  const toggleReport = useCallback(

    (reportId: string, open: boolean) => {

      patchUi({ reportOpenById: { ...ui.reportOpenById, [reportId]: open } })

    },

    [patchUi, ui.reportOpenById],

  )



  return (

    <div className={cn(chatMsgRow, chatMsgRowAssistant, 'w-full')}>

      <div className={cn(chatSegmentRootClass, 'w-full max-w-[96%] min-w-0 px-1 py-2')}>

        <div className={cn(chatSegmentSummary, 'cursor-default flex-wrap items-center gap-2 px-1')}>

          <span className={cn(chatMsgRoleRow, 'min-w-0 flex-1 truncate')}>

            Think Tank · {statusLabel}

          </span>

          {live && onAbort ?

            <button

              type="button"

              className={cn(chatStopBtn, 'px-2.5 py-0.5 text-[0.72rem]')}

              title="Stop this think tank session"

              onClick={() => onAbort(sessionId)}

            >

              Stop

            </button>

          : null}

          <span className={cn(mutedText, 'hidden max-w-[40%] truncate text-[0.75rem] sm:inline')}>

            {topicPreview}

          </span>

          <span className={chatMsgStatusMuted}>

            {debateBubbles.length} turns

            {reportBubbles.length > 0 ? ` · ${reportBubbles.length} reports` : ''}

            {pendingInjectCount > 0 ? ` · ${pendingInjectCount} queued for Moderator` : ''}

          </span>

        </div>



        {queuedInjects.length > 0 ?

          <div className={cn(chatMsgBubble, chatMsgAssistant, 'mx-1 mt-2 w-auto min-w-0 border-dashed border-amber-500/30')}>

            <div className={chatMsgHead}>

              <div className={chatMsgRoleRow}>Queued for Moderator</div>

            </div>

            <ul className="list-disc space-y-1 pl-4 text-[0.78rem] text-text-secondary">

              {queuedInjects.map((line, i) => (

                <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>

              ))}

            </ul>

          </div>

        : null}



        <div className={cn(chatMsgBubble, chatMsgAssistant, 'mx-1 mt-2 w-auto min-w-0 border-dashed')}>

          <div className={chatMsgHead}>

            <div className={chatMsgRoleRow}>Topic</div>

          </div>

          <p className="text-[0.82rem] text-text-primary">{topic}</p>

        </div>



        {debateBubbles.length > 0 ?

          <div className="mx-1 mt-2">

            <div className={cn(chatSegmentSummary, 'cursor-default px-1 pb-1')}>

              <span className={chatMsgRoleRow}>Debate · {debateBubbles.length} turns</span>

            </div>

            {debateBubbles.map((b) => (

              <DebateTurnCard

                key={b.id}

                bubble={b}

                open={debateTurnOpen(ui, b.id, status)}

                onOpenChange={(next) => toggleDebateTurn(b.id, next)}

                liveWorkflow={liveWorkflow}

                segmentOverrides={segmentOverrides}

                onSegmentToggle={onSegmentToggle}

                subagentTasks={subagentTasks}

                onSubagentNotice={onSubagentNotice}

                workspaceId={workspaceId}

              />

            ))}

          </div>

        : null}



        {reportBubbles.length > 0 ?

          <StableDetails

            open={ui.reportsOpen}

            onOpenChange={(next) => patchUi({ reportsOpen: next })}

            className={cn(chatSegmentRootClass, 'mx-1 mt-2')}

            summary={

              <>

                <span className={chatMsgRoleRow}>Final reports · {reportBubbles.length}</span>

                <span className={chatSegmentChevron} aria-hidden="true" />

              </>

            }

          >

            <div className="space-y-2 px-1 pb-1 pt-2">

              <div className="flex justify-end">

                <CollapseToggle open={ui.reportsOpen} label="reports" onToggle={toggleReports} />

              </div>

              {reportBubbles.map((b) => {

                const reportOpen = reportTurnOpen(ui, b.id, status)

                const preview =

                  b.body.length > 120 ? `${b.body.slice(0, 117).replace(/\s+/g, ' ')}…` : b.body

                return (

                  <StableDetails

                    key={b.id}

                    open={reportOpen}

                    onOpenChange={(next) => toggleReport(b.id, next)}

                    className={cn(chatSegmentRootClass, 'ml-1')}

                    summary={

                      <>

                        <span className="text-[0.82rem]">{b.seatLabel}</span>

                        {!reportOpen && preview ?

                          <span className={cn(mutedText, 'min-w-0 flex-1 truncate text-[0.72rem]')}>

                            {preview}

                          </span>

                        : null}

                        <span className={chatSegmentChevron} aria-hidden="true" />

                      </>

                    }

                  >

                    <div className="space-y-2 px-1 pb-1 pt-1">

                      <div className="flex justify-end">

                        <CollapseToggle

                          open={reportOpen}

                          label={b.seatLabel}

                          onToggle={() => toggleReport(b.id, !reportOpen)}

                        />

                      </div>

                      <ThinkTankBubbleRow

                        bubble={b}

                        liveWorkflow={liveWorkflow}

                        segmentOverrides={segmentOverrides}

                        onSegmentToggle={onSegmentToggle}

                        subagentTasks={subagentTasks}

                onSubagentNotice={onSubagentNotice}

                        workspaceId={workspaceId}

                      />

                      <div className="flex justify-end">

                        <CollapseToggle

                          open={reportOpen}

                          label={b.seatLabel}

                          onToggle={() => toggleReport(b.id, !reportOpen)}

                        />

                      </div>

                    </div>

                  </StableDetails>

                )

              })}

              <div className="flex justify-end border-t border-border/50 pt-2">

                <CollapseToggle open={ui.reportsOpen} label="reports" onToggle={toggleReports} />

              </div>

            </div>

          </StableDetails>

        : null}



        {liveSession ?

          <div className="mx-1 mt-2">

                        <ThinkTankChatInline

              session={liveSession}

              onOpenThinkTankRoute={onOpenThinkTankRoute}

            />

          </div>

        : null}

      </div>

    </div>

  )

}



export function thinkTankUiForEstimate(

  sessionId: string,

  status: string,

  prefs: Record<string, ThinkTankSessionUiState | undefined>,

): ThinkTankSessionUiState {

  return prefs[sessionId] ?? defaultUiForStatus(status)

}



/** @deprecated Use thinkTankUiBySession + thinkTankUiForEstimate */

export function thinkTankBlockCollapsedFromPrefs(

  sessionId: string,

  status: string,

  prefs: Record<string, boolean | undefined>,

): boolean {

  if (typeof prefs[sessionId] === 'boolean') return prefs[sessionId] === true

  return isThinkTankTerminalStatus(status)

}


