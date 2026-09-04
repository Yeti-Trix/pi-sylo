export type ScheduleRecurrence = 'once' | 'daily' | 'weekly' | 'monthly'

export type ScheduleRunStatus = 'started' | 'failed' | 'broker_unavailable'

export interface ScheduledPromptRow {
  id: string
  workspace_id: string
  title: string
  prompt_text: string
  recurrence: ScheduleRecurrence
  /** First eligible run (ms, local interpretation for recurring). */
  start_at: number
  /** HH:MM 24h local time for recurring schedules. */
  time_local: string
  /** 0=Sun … 6=Sat for weekly. */
  day_of_week: number | null
  /** 1–31 for monthly. */
  day_of_month: number | null
  /** null = indefinite. */
  max_runs: number | null
  run_count: number
  catchup_on_startup: number
  enabled: number
  next_run_at: number
  last_run_at: number | null
  last_conversation_id: string | null
  last_run_status: ScheduleRunStatus | null
  created_at: number
  updated_at: number
}

export type ScheduledPromptInput = {
  title?: string
  prompt_text: string
  recurrence: ScheduleRecurrence
  start_at: number
  time_local?: string
  day_of_week?: number | null
  day_of_month?: number | null
  max_runs?: number | null
  catchup_on_startup?: boolean
  enabled?: boolean
}

export type ScheduledPromptPatch = Partial<ScheduledPromptInput> & {
  enabled?: boolean
}
