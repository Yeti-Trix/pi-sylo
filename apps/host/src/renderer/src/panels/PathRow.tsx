import { cn } from '../lib/cn'
import { btnGhostSm, mutedText } from './ui-classes'
import { toast } from './toast'

/**
 * One filesystem path with Copy (+ optional Open / Reset / trailing status
 * slot) on a single row. Replaces multi-line caption + button blocks across
 * the settings cards.
 */
export function PathRow({
  label,
  path,
  onOpen,
  onReset,
  pickAction,
  trailing,
}: {
  label?: string
  path: string
  onOpen?: () => void | Promise<void>
  onReset?: () => void | Promise<void>
  /** Leading action control (e.g. a "Choose…" button). */
  pickAction?: React.ReactNode
  /** Additional inline control after the path (e.g. a status Badge). */
  trailing?: React.ReactNode
}): React.ReactElement {
  const copy = () => {
    void navigator.clipboard
      .writeText(path)
      .then(() => toast('Copied to clipboard'))
      .catch(() => toast('Could not copy to clipboard', 'error'))
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {label ? <span className={cn(mutedText, 'flex-none text-[0.78rem]')}>{label}</span> : null}
      {pickAction}
      <code className="min-w-0 break-all text-[0.78rem] text-text-primary">{path}</code>
      <span className="ml-auto flex flex-none items-center gap-1.5">
        <button
          type="button"
          className={btnGhostSm}
          title="Copy path to clipboard"
          onClick={() => copy()}
        >
          Copy
        </button>
        {onOpen ?
          <button
            type="button"
            className={btnGhostSm}
            title="Open in the system file manager"
            onClick={() => void onOpen()}
          >
            Open
          </button>
        : null}
        {onReset ?
          <button
            type="button"
            className={btnGhostSm}
            title="Reset to the default"
            onClick={() => void onReset()}
          >
            Reset
          </button>
        : null}
        {trailing}
      </span>
    </div>
  )
}