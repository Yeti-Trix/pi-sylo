import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { toastCard, toastCardError, toastStack } from './ui-classes'

export type ToastTone = 'info' | 'error'

type ToastItem = { id: number; text: string; tone: ToastTone }

let nextToastId = 1
const listeners = new Set<(t: ToastItem) => void>()

/**
 * Push a toast from anywhere — component handlers or plain helper functions.
 * Renders via the nearest mounted <ToastHost />.
 */
export function toast(text: string, tone: ToastTone = 'info'): void {
  const item = { id: nextToastId++, text, tone }
  for (const listener of [...listeners]) listener(item)
}

const TOAST_MAX = 3
const TOAST_LIFETIME_MS = 6000

/**
 * Fixed bottom-right toast stack. Mounted per area (Settings renders its own),
 * so toasts disappear when leaving the tab that owns them.
 */
export function ToastHost(): React.ReactElement | null {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((prev) => [...prev, t].slice(-TOAST_MAX))
    }
    listeners.add(onToast)
    return () => {
      listeners.delete(onToast)
    }
  }, [])

  useEffect(() => {
    if (items.length === 0) return
    const timers = items.map((t) =>
      window.setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.id !== t.id))
      }, TOAST_LIFETIME_MS),
    )
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [items])

  if (items.length === 0) return null

  return (
    <div className={toastStack}>
      {items.map((t) => (
        <div key={t.id} className={cn(t.tone === 'error' ? toastCardError : toastCard, 'items-start')}>
          <p className="m-0 flex-1 overflow-hidden">{t.text}</p>
          <button
            type="button"
            aria-label="Dismiss notice"
            className="cursor-pointer border-0 bg-transparent p-0 text-[0.8rem] opacity-60 hover:opacity-100"
            onClick={() => setItems((prev) => prev.filter((p) => p.id !== t.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}