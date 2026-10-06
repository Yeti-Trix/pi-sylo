/**
 * First line of a task text, capped — the run's headline in cards and board rows.
 * Shared because both the delivery cards (index.ts) and the workspace board rows
 * (subagent-board.ts) label runs with it.
 */
export function firstTaskLine(task: string): string {
  const line = task.trim().split('\n', 1)[0] ?? task
  return line.length > 160 ? `${line.slice(0, 160)}…` : line
}