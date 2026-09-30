/**
 * Plan mode (task 11, Claude parity): a per-turn tooling gate layered over the
 * session binding. Plan turns run a read-only Pi builtin ALLOWLIST with every
 * discovered extension tool blocked, then "Approve & execute" reruns the plan
 * as a normal turn (the model executes it as an agent — never text-as-commands).
 */

import { type PiBuiltinToolsPref } from './pi-builtin-tools.js'

/** Allowlist: read/search builtins only. bash/write/edit are OFF (not merely
 *  blocked names) — bash cannot be safely tamed mid-turn, so it is omitted. */
export const PLAN_MODE_PI_BUILTIN_TOOLS: PiBuiltinToolsPref = {
  enabled: true,
  tools: {
    read: true,
    write: false,
    edit: false,
    bash: false,
    grep: true,
    find: true,
    ls: true,
  },
}

/** System notice row inserted after the plan turn's user message; its content
 *  matches the constant so the renderer can attach the Approve & execute
 *  affordance to the plan reply (and so the turn is visibly plan-only). */
export const PLAN_MODE_NOTICE =
  'Plan mode: this turn ran read-only (no file/workspace mutations; extension tools disabled). Approve & execute below runs it again with full tools.'

export function planModePrefKey(conversationId: string): string {
  return `sylo.plan_mode.${conversationId.trim()}`
}