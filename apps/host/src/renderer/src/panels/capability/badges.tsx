import React from 'react'
import { cn } from '../../lib/cn'
import {
  capBanner,
  capBannerWarn,
  capLintWarn,
  capOrigin,
  capSkillSurfaces,
  capSwitch,
  capSwitchKnob,
  capSwitchKnobOn,
  capSwitchLabel,
  capSwitchLabelOn,
  capSwitchSm,
  capSwitchTrack,
  capSwitchTrackOn,
  capToolConflict,
  mutedText,
} from '../ui-classes'
import { ORIGIN_LABELS } from './helpers'

export function OriginBadge({ origin }: { origin: CapabilityOrigin }): React.ReactElement {
  return <span className={capOrigin}>{ORIGIN_LABELS[origin] ?? origin}</span>
}

function surfaceLabel(s: SkillSurfaceLintSurface): string {
  const name = s.title?.trim() || s.id
  if (s.kind === 'widget') return `widget:${s.id}${s.title ? ` (${name})` : ''}`
  const bits = [`route:${s.id}`]
  if (s.title) bits.push(s.title)
  if (s.nav_section) bits.push(`nav:${s.nav_section}`)
  return bits.join(' · ')
}

export function SkillSurfaceLintNotes({
  path,
  lintByPath,
}: {
  path?: string
  lintByPath: Record<string, SkillSurfaceLintReport>
}): React.ReactElement | null {
  if (!path?.trim()) return null
  const r = lintByPath[path]
  if (!r) return null
  if (r.surfaces.length === 0 && r.errors.length === 0 && !r.hasParamsSchema) return null

  return (
    <div className="mt-1.5 space-y-1.5">
      {r.hasParamsSchema ?
        <div className={cn(mutedText, 'text-[0.78rem]')}>
          Params: <span className="text-success">params.schema.json</span>
        </div>
      : null}
      {r.surfaces.length > 0 ?
        <ul className={cn(capSkillSurfaces, mutedText, 'm-0 list-none space-y-1 p-0 text-[0.78rem]')}>
          {r.surfaces.map((s, i) => (
            <li key={`${s.kind}-${s.id}-${i}`} className={cn(!s.ok && capLintWarn)}>
              <span title={s.fallbackPath || undefined}>
                {surfaceLabel(s)}
                {s.ok ? ' ✓ fallback' : ' — missing fallback'}
              </span>
              {s.kind === 'route' && s.required_capabilities && s.required_capabilities.length > 0 ?
                <span className="ml-1 opacity-80">
                  · caps: {s.required_capabilities.join(', ')}
                </span>
              : null}
            </li>
          ))}
        </ul>
      : null}
      {r.errors.length > 0 ?
        <div className={cn(capBanner, capBannerWarn, 'text-[0.78rem]')}>{r.errors.join(' ')}</div>
      : null}
    </div>
  )
}

export function ToolNameConflictCue({ peers }: { peers: string[] }): React.ReactElement {
  const title =
    peers.length === 1 ?
      `Another extension also registers this tool id:\n${peers[0]}`
    : `Other extensions also register this tool id:\n${peers.join('\n')}`
  return (
    <span className={capToolConflict} title={title}>
      Duplicate name
    </span>
  )
}

export function CapEnableSwitch({
  checked,
  disabled,
  onClick,
  label,
  ariaLabel,
  className,
}: {
  checked: boolean
  disabled?: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  label: string
  ariaLabel: string
  className?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={cn(capSwitchSm, className)}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={cn(capSwitchTrack, checked && capSwitchTrackOn)} aria-hidden="true">
        <span className={cn(capSwitchKnob, checked && capSwitchKnobOn)} />
      </span>
      <span className={cn(capSwitchLabel, checked && capSwitchLabelOn)}>{label}</span>
    </button>
  )
}

/** Same switch styling without the small-button padding override. */
export function CapEnableSwitchPlain({
  checked,
  disabled,
  onClick,
  label,
  ariaLabel,
  className,
}: {
  checked: boolean
  disabled?: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  label: string
  ariaLabel: string
  className?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={cn(capSwitch, className)}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={cn(capSwitchTrack, checked && capSwitchTrackOn)} aria-hidden="true">
        <span className={cn(capSwitchKnob, checked && capSwitchKnobOn)} />
      </span>
      <span className={cn(capSwitchLabel, checked && capSwitchLabelOn)}>{label}</span>
    </button>
  )
}
