import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import {
  btnGhost,
  btnPrimary,
  fieldLabel,
  input,
  modalActions,
  modalBody,
  modalOverlay,
  modalShell,
  modalTitle,
  mutedText,
} from '../ui-classes'

type JsonSchemaObject = Record<string, unknown>

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function schemaProperties(schema: JsonSchemaObject): Record<string, JsonSchemaObject> {
  const props = schema.properties
  if (!isRecord(props)) return {}
  const out: Record<string, JsonSchemaObject> = {}
  for (const [k, v] of Object.entries(props)) {
    if (isRecord(v)) out[k] = v
  }
  return out
}

function fieldType(prop: JsonSchemaObject): 'string' | 'number' | 'boolean' {
  const t = prop.type
  if (t === 'number' || t === 'integer') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

function fieldLabelText(key: string, prop: JsonSchemaObject): string {
  const d = prop.description
  if (typeof d === 'string' && d.trim()) return d
  return key
}

export function SchemaConfigForm({
  schema,
  values,
  onChange,
  disabled,
}: {
  schema: JsonSchemaObject
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  disabled?: boolean
}): React.ReactElement {
  const props = useMemo(() => schemaProperties(schema), [schema])
  const keys = useMemo(() => Object.keys(props).sort((a, b) => a.localeCompare(b)), [props])

  if (keys.length === 0) {
    return <p className={mutedText}>Schema has no editable properties.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {keys.map((key) => {
        const prop = props[key]!
        const kind = fieldType(prop)
        const label = fieldLabelText(key, prop)
        const val = values[key]

        if (kind === 'boolean') {
          return (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-[0.85rem]">
              <input
                type="checkbox"
                checked={val === true}
                disabled={disabled}
                onChange={(e) => onChange({ ...values, [key]: e.target.checked })}
              />
              <span>{label}</span>
            </label>
          )
        }

        return (
          <label key={key} className="flex flex-col gap-1">
            <span className={fieldLabel}>{label}</span>
            <input
              className={input}
              type={prop.format === 'password' ? 'password' : kind === 'number' ? 'number' : 'text'}
              disabled={disabled}
              value={val === undefined || val === null ? '' : String(val)}
              onChange={(e) => {
                const raw = e.target.value
                let next: unknown = raw
                if (kind === 'number') {
                  next = raw.trim() === '' ? undefined : Number(raw)
                }
                onChange({ ...values, [key]: next })
              }}
            />
          </label>
        )
      })}
    </div>
  )
}

export function ConfigFormModal({
  title,
  subtitle,
  open,
  loading,
  error,
  schema,
  values,
  onClose,
  onSave,
}: {
  title: string
  subtitle?: string
  open: boolean
  loading?: boolean
  error?: string | null
  schema: JsonSchemaObject | null
  values: Record<string, unknown>
  onClose: () => void
  onSave: (values: Record<string, unknown>) => void | Promise<void>
}): React.ReactElement | null {
  const [draft, setDraft] = useState(values)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setDraft(values)
  }, [open, values])

  if (!open) return null

  return createPortal(
    <div
      className={modalOverlay}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          modalShell,
          'flex max-w-lg max-h-[calc(100dvh-3rem)] flex-col overflow-hidden',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className={cn(modalTitle, 'shrink-0')}>{title}</h3>
        {subtitle ?
          <p className={cn(modalBody, mutedText, 'mt-0 shrink-0')}>{subtitle}</p>
        : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {loading ?
            <p className={mutedText}>Loading…</p>
          : error ?
            <p className="text-[0.85rem] text-danger">{error}</p>
          : schema ?
            <SchemaConfigForm schema={schema} values={draft} onChange={setDraft} disabled={saving} />
          : null}
        </div>
        <div className={cn(modalActions, 'shrink-0')}>
          <button type="button" className={btnGhost} disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={loading || saving || !schema}
            onClick={() => {
              setSaving(true)
              void Promise.resolve(onSave(draft)).finally(() => setSaving(false))
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
