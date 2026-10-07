/**
 * Cross-renderer registry: which chat message renders a given subagent dispatch pill.
 *
 * The chat timeline is a virtualized list (ChatTimelineList) — rows outside the
 * viewport are UNMOUNTED, so "scroll to the running pill" cannot work via
 * querySelector alone. Instead:
 *   1. SubagentRunBlock registers its own pill location on mount
 *      (batchKey → messageId).
 *   2. "Go to" (composer strip) resolves the message id, asks the virtualizer
 *      to scroll that row into the window (which mounts it), then opens +
 *      flash-highlights the pill DOM node.
 */

const batchMessageOwner = new Map<string, string>()

export function registerSubagentBatchTarget(batchKey: string, messageId: string): void {
  batchMessageOwner.set(batchKey, messageId)
}

export function lookupSubagentBatchMessage(batchKey: string): string | undefined {
  return batchMessageOwner.get(batchKey)
}

/** Strip quotes/space noise defensively — the id is used for getElementById. */
export function subagentPillDomId(batchKey: string): string {
  return `subagent-run-${batchKey.replace(/[^A-Za-z0-9_-]/g, (c) => `U${(c.codePointAt(0) ?? 0).toString(16)}`)}`
}