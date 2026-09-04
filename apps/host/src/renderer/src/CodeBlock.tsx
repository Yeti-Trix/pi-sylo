import React, { useState } from 'react'
import { cn } from './lib/cn'

type CodeBlockProps = {
  /** The `<code>` element react-markdown produced inside the `<pre>`. */
  codeElement: React.ReactElement
  className?: string
}

/**
 * Renders a fenced code block with a language chip, a copy-to-clipboard
 * button pinned to the top-right corner, and (for long blocks) a second
 * copy button in a footer row below the code. The top button stays pinned
 * while the `<pre>` scrolls horizontally; the bottom button lives below
 * the scroll area so it never overlaps the horizontal scrollbar.
 * Used by `ChatMarkdown` for every fenced code block.
 */
export function CodeBlock({ codeElement, className }: CodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const codeProps = codeElement.props as { children?: React.ReactNode; className?: string }
  const codeClassName = codeProps.className ?? ''
  const lang = /language-([\w-]+)/.exec(codeClassName)?.[1] ?? ''
  const text = String(codeProps.children ?? '').replace(/\n$/, '')
  // Only show the footer Copy button when the block is long enough that
  // scrolling back to the top to copy is annoying. ~20 lines is the
  // threshold the operator asked for.
  const lineCount = text ? text.split('\n').length : 0
  const showBottom = lineCount > 20

  const handleCopy = () => {
    if (!text) return
    const done = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    }
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done))
    } else {
      fallbackCopy(text, done)
    }
  }

  // Top button: pinned to the top-right corner of the block (absolute), so it
  // stays visible while the code scrolls horizontally.
  const topBtn = (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy code to clipboard"
      aria-label="Copy code to clipboard"
      className={cn(
        'absolute right-1.5 top-1.5 z-10 inline-flex select-none items-center gap-1 rounded border border-border',
        'bg-bg-tertiary/90 px-1.5 py-0.5 text-[0.66rem] font-medium leading-none text-text-secondary',
        'backdrop-blur transition hover:bg-bg-secondary hover:text-text-primary',
        'focus:outline-none',
      )}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )

  // Bottom button: rendered in a footer row *below* the scrollable <pre> so it
  // never overlaps the horizontal scrollbar. (Pinning it absolute to the
  // bottom-right covered the scrollbar track — see operator report.)
  const bottomBtn = (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy code to clipboard"
      aria-label="Copy code to clipboard"
      className={cn(
        'inline-flex select-none items-center gap-1 rounded border border-border',
        'bg-bg-tertiary/90 px-1.5 py-0.5 text-[0.66rem] font-medium leading-none text-text-secondary',
        'backdrop-blur transition hover:bg-bg-secondary hover:text-text-primary',
        'focus:outline-none',
      )}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )

  return (
    <div className={cn('group relative my-2 max-w-full', className)}>
      {lang ? (
        <span
          className={cn(
            'pointer-events-none absolute left-2 top-1.5 z-10 select-none',
            'text-[0.62rem] font-medium uppercase tracking-wide text-text-secondary/50',
          )}
        >
          {lang}
        </span>
      ) : null}
      {topBtn}
      <pre className="overflow-x-auto">{codeElement}</pre>
      {showBottom ? (
        <div className="mt-1 flex justify-end">{bottomBtn}</div>
      ) : null}
    </div>
  )
}

function fallbackCopy(text: string, done: () => void): void {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    done()
  } catch {
    /* clipboard unavailable — ignore */
  }
}