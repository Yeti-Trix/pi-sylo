import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { btnGhostSm } from './ui-classes'

/**
 * Two-step destructive action: first click arms the button, second click runs.
 * Arms expire after ~4s, so no modal interrupt is needed. When `busy`, the
 * button keeps its original label and is disabled.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Confirm?',
  busy,
  title,
  className,
}: {
  onConfirm: () => void | Promise<void>
  children: React.ReactNode
  confirmLabel?: string
  busy?: boolean
  title?: string
  className?: string
}): React.ReactElement {
  const [armed, setArmed] = useState(false)
  const armTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(armTimer.current), [])

  const click = () => {
    if (!armed) {
      setArmed(true)
      armTimer.current = window.setTimeout(() => setArmed(false), 4000)
      return
    }
    window.clearTimeout(armTimer.current)
    setArmed(false)
    void onConfirm()
  }

  return (
    <button
      type="button"
      title={title}
      disabled={busy}
      onClick={() => click()}
      className={cn(btnGhostSm, className, armed && 'border-danger/50 text-danger')}
    >
      {armed && !busy ? confirmLabel : children}
    </button>
  )
}