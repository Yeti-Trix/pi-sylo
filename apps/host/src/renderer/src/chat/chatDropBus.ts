/**
 * Tiny in-renderer bus so the chat transcript area can hand dropped files to the
 * ChatComposer. The shell-level drop handler in App.tsx reads `File.path`, which
 * Electron 32+ removed, so drops that miss the composer used to silently no-op.
 * The composer registers a handler on mount; the chat area forwards to it.
 */
export type ComposerDropHandler = (files: File[]) => void

let handler: ComposerDropHandler | null = null

/** Called by ChatComposer on mount (pass null on cleanup to unregister). */
export function registerComposerDropHandler(h: ComposerDropHandler | null): void {
  handler = h
}

/**
 * Forward dropped files to the mounted composer. Returns false when no composer
 * is mounted, so the caller can fall through (e.g. to the shell handler).
 */
export function forwardDroppedFiles(files: File[]): boolean {
  if (!handler || files.length === 0) return false
  handler(files)
  return true
}