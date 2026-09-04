/** Seat-colored think tank bubbles — debaters + Moderator (advisory). */
const COUNCIL_BUBBLE_WIDTH = 'w-fit max-w-[92%] min-w-0'

const MODERATOR_TONE = {
  bubble: `${COUNCIL_BUBBLE_WIDTH} self-start border border-blue-500/45 bg-blue-500/[0.08]`,
  role: 'text-blue-300',
} as const

/** Debater colors by seat id (seat-a green, seat-b red, seat-d yellow, seat-e purple, seat-f orange). */
const DEBATER_TONE_BY_SEAT_ID: Record<string, { bubble: string; role: string }> = {
  'seat-a': {
    bubble: `${COUNCIL_BUBBLE_WIDTH} self-start border border-emerald-500/45 bg-emerald-500/[0.08]`,
    role: 'text-emerald-300',
  },
  'seat-b': {
    bubble: `${COUNCIL_BUBBLE_WIDTH} self-start border border-red-500/45 bg-red-500/[0.08]`,
    role: 'text-red-300',
  },
  'seat-d': {
    bubble: `${COUNCIL_BUBBLE_WIDTH} self-start border border-amber-400/45 bg-amber-400/[0.08]`,
    role: 'text-amber-300',
  },
  'seat-e': {
    bubble: `${COUNCIL_BUBBLE_WIDTH} self-start border border-violet-500/45 bg-violet-500/[0.08]`,
    role: 'text-violet-300',
  },
  'seat-f': {
    bubble: `${COUNCIL_BUBBLE_WIDTH} self-start border border-orange-500/45 bg-orange-500/[0.08]`,
    role: 'text-orange-300',
  },
}

const DEBATER_INDEX_TO_SEAT_ID = ['seat-a', 'seat-b', 'seat-d', 'seat-e', 'seat-f'] as const

function seatHay(seatId: string, agent: string, label: string): string {
  return `${seatId} ${agent} ${label}`.toLowerCase()
}

function isModeratorHay(hay: string): boolean {
  return /moderator|synthesis|^ref$|seat-moderator|seat-c|think-tank-moderator/.test(hay)
}

function resolveDebaterSeatId(seatId: string, label: string): string | null {
  if (DEBATER_TONE_BY_SEAT_ID[seatId]) return seatId
  const debaterMatch = label.match(/debater\s*(\d+)/i)
  if (debaterMatch) {
    const idx = Number(debaterMatch[1]) - 1
    if (idx >= 0 && idx < DEBATER_INDEX_TO_SEAT_ID.length) {
      return DEBATER_INDEX_TO_SEAT_ID[idx]!
    }
  }
  return null
}

function debaterToneFromHay(hay: string): { bubble: string; role: string } | null {
  if (hay.includes('debater 1') || hay.includes('seat-a') || hay.includes('think-tank-evidence')) {
    return DEBATER_TONE_BY_SEAT_ID['seat-a']!
  }
  if (hay.includes('debater 2') || hay.includes('seat-b') || hay.includes('think-tank-skeptic')) {
    return DEBATER_TONE_BY_SEAT_ID['seat-b']!
  }
  if (hay.includes('debater 3') || hay.includes('seat-d')) return DEBATER_TONE_BY_SEAT_ID['seat-d']!
  if (hay.includes('debater 4') || hay.includes('seat-e')) return DEBATER_TONE_BY_SEAT_ID['seat-e']!
  if (hay.includes('debater 5') || hay.includes('seat-f')) return DEBATER_TONE_BY_SEAT_ID['seat-f']!
  return null
}

export function thinkTankSeatBubbleClass(seatId: string, label: string, agent = ''): string {
  const hay = seatHay(seatId, agent, label)
  if (isModeratorHay(hay)) return MODERATOR_TONE.bubble
  const resolved = resolveDebaterSeatId(seatId, label)
  if (resolved && DEBATER_TONE_BY_SEAT_ID[resolved]) return DEBATER_TONE_BY_SEAT_ID[resolved]!.bubble
  return debaterToneFromHay(hay)?.bubble ?? `${COUNCIL_BUBBLE_WIDTH} self-start border border-accent/35 bg-accent/[0.06]`
}

export function thinkTankSeatRoleClass(seatId: string, label: string, agent = ''): string {
  const hay = seatHay(seatId, agent, label)
  if (isModeratorHay(hay)) return MODERATOR_TONE.role
  const resolved = resolveDebaterSeatId(seatId, label)
  if (resolved && DEBATER_TONE_BY_SEAT_ID[resolved]) return DEBATER_TONE_BY_SEAT_ID[resolved]!.role
  return debaterToneFromHay(hay)?.role ?? 'text-accent'
}
