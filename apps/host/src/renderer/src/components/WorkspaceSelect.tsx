import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import {
  ctxMenuBackdrop,
  workspaceSelectEmpty,
  workspaceSelectList,
  workspaceSelectMenu,
  workspaceSelectOption,
  workspaceSelectOptionActive,
  workspaceSelectSearch,
  workspaceSelectSearchWrap,
  workspaceSelectTrigger,
  workspaceSelectTriggerChevron,
  workspaceSelectTriggerLabel,
} from '../panels/ui-classes'

const SEARCH_MIN_ITEMS = 5

export type WorkspaceSelectOption = {
  id: string
  name: string
}

type MenuPosition = {
  top: number
  left: number
  width: number
}

type WorkspaceSelectProps = {
  id?: string
  workspaces: WorkspaceSelectOption[]
  value: string
  onChange: (workspaceId: string) => void
  'aria-labelledby'?: string
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function WorkspaceSelect({
  id,
  workspaces,
  value,
  onChange,
  'aria-labelledby': ariaLabelledBy,
}: WorkspaceSelectProps): React.ReactElement {
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [menuPos, setMenuPos] = useState<MenuPosition>({ top: 0, left: 0, width: 0 })

  const selected = useMemo(
    () => workspaces.find((w) => w.id === value) ?? workspaces[0],
    [workspaces, value],
  )

  const showSearch = workspaces.length >= SEARCH_MIN_ITEMS

  const filtered = useMemo(() => {
    const q = normalizeSearchQuery(searchQuery)
    if (!q) return workspaces
    return workspaces.filter((w) => w.name.toLowerCase().includes(q))
  }, [searchQuery, workspaces])

  const updateMenuPosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setSearchQuery('')
  }, [])

  const openMenu = useCallback(() => {
    setOpen(true)
    setSearchQuery('')
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open, updateMenuPosition])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      if (showSearch) searchRef.current?.focus()
      else triggerRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [open, showSearch])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, open])

  const pick = (workspaceId: string) => {
    onChange(workspaceId)
    close()
    triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={workspaceSelectTrigger}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          if (open) close()
          else openMenu()
        }}
      >
        <span className={workspaceSelectTriggerLabel}>{selected?.name ?? 'Select workspace'}</span>
        <span className={workspaceSelectTriggerChevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ?
        createPortal(
          <>
            <div
              role="presentation"
              aria-hidden="true"
              className={ctxMenuBackdrop}
              onMouseDown={close}
              onWheel={close}
            />
            <div
              id={listboxId}
              role="listbox"
              aria-labelledby={ariaLabelledBy}
              className={workspaceSelectMenu}
              style={{
                top: menuPos.top,
                left: menuPos.left,
                width: menuPos.width,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {showSearch ?
                <div className={workspaceSelectSearchWrap}>
                  <input
                    ref={searchRef}
                    type="search"
                    className={workspaceSelectSearch}
                    placeholder="Search workspaces…"
                    value={searchQuery}
                    aria-label="Search workspaces"
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && filtered.length === 1) {
                        e.preventDefault()
                        pick(filtered[0]!.id)
                      }
                    }}
                  />
                </div>
              : null}
              <div className={workspaceSelectList}>
                {filtered.length === 0 ?
                  <p className={workspaceSelectEmpty}>No workspaces match.</p>
                : filtered.map((w) => {
                    const active = w.id === value
                    return (
                      <button
                        key={w.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={cn(workspaceSelectOption, active && workspaceSelectOptionActive)}
                        onClick={() => pick(w.id)}
                      >
                        {w.name}
                      </button>
                    )
                  })}
              </div>
            </div>
          </>,
          document.body,
        )
      : null}
    </>
  )
}
