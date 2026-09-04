/** Debater bubble colors by seat id (matches host thinkTankSeatTone.ts). */
export const MODERATOR_SEAT_TONE = {
  bubble: 'border-blue-500/45 bg-blue-500/[0.08]',
  role: 'text-blue-300',
  label: 'blue',
} as const

export const DEBATER_SEAT_TONES = [
  { seatId: 'seat-a', bubble: 'border-emerald-500/45 bg-emerald-500/[0.08]', role: 'text-emerald-300', label: 'green' },
  { seatId: 'seat-b', bubble: 'border-red-500/45 bg-red-500/[0.08]', role: 'text-red-300', label: 'red' },
  { seatId: 'seat-d', bubble: 'border-amber-400/45 bg-amber-400/[0.08]', role: 'text-amber-300', label: 'yellow' },
  { seatId: 'seat-e', bubble: 'border-violet-500/45 bg-violet-500/[0.08]', role: 'text-violet-300', label: 'purple' },
  { seatId: 'seat-f', bubble: 'border-orange-500/45 bg-orange-500/[0.08]', role: 'text-orange-300', label: 'orange' },
] as const

const BUBBLE_WIDTH = 'w-fit max-w-[92%] min-w-0'

export function debaterToneBySeatId(seatId: string): { bubble: string; role: string } | null {
  const row = DEBATER_SEAT_TONES.find((t) => t.seatId === seatId)
  if (!row) return null
  return {
    bubble: `${BUBBLE_WIDTH} self-start border ${row.bubble}`,
    role: row.role,
  }
}

export function debaterIndexFromSeatId(seatId: string): number {
  const idx = DEBATER_SEAT_TONES.findIndex((t) => t.seatId === seatId)
  return idx >= 0 ? idx + 1 : 0
}
