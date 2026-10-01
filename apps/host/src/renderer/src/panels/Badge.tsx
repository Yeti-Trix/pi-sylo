import { cn } from '../lib/cn'

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'neutral'

const badgeTones: Record<BadgeTone, string> = {
  // Theme tokens from @theme in styles.css.
  ok: 'border-success/40 bg-success/10 text-success',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  bad: 'border-danger/45 bg-danger/10 text-danger',
  neutral: 'border-border bg-bg-tertiary text-text-secondary',
}

/** Small rounded status chip — next to card titles, labels, or status rows. */
export function Badge({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: BadgeTone
  title?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex flex-none items-center whitespace-nowrap rounded-full border px-2 py-[1px] text-[0.72rem] font-medium leading-[1.3]',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  )
}