import React, { useCallback, useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import {
  SYLO_OPTIONAL_PACKAGES,
  normalizeSyloOptionalPackagesPref,
  type SyloOptionalPackage,
} from '../../../../shared/sylo-optional-packages.js'
import { CapEnableSwitch } from './badges'
import {
  capBanner,
  capBannerWarn,
  capEmptyNote,
  capSection,
  capSectionBody,
  capSectionChevron,
  capSectionLeadTight,
  capSectionSummary,
  capSectionSummaryTitle,
  capSkillRow,
  capCount,
  mutedText,
  rowHeadline,
  rowList,
  rowName,
  rowSpacer,
} from '../ui-classes'

export function SyloOptionalPackagesSection({
  onSaved,
}: {
  onSaved: (restartNote: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [pref, setPref] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [installNote, setInstallNote] = useState<string | null>(null)
  const [pythonWarning, setPythonWarning] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const raw = await window.sylo.prefs.get('sylo.optional_packages', null)
      setPref(normalizeSyloOptionalPackagesPref(raw))
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const r = await window.sylo.optionalPackages.pythonReadiness()
        if (r.status !== 'ok') setPythonWarning(r.message)
        else setPythonWarning(null)
      } catch {
        /* readiness probe is advisory only */
      }
    })()
  }, [])

  const setEnabled = useCallback(
    async (pkg: SyloOptionalPackage, enabled: boolean) => {
      setBusy(pkg.id)
      setInstallNote(null)
      try {
        if (enabled && pkg.pythonRequirementsRelPath) {
          setInstallNote(`Installing Python dependencies for ${pkg.title}…`)
          const pip = await window.sylo.optionalPackages.installPythonDeps(pkg.id)
          if (!pip.ok) {
            setInstallNote(null)
            alert(`Could not install Python dependencies:\n\n${pip.error}`)
            return
          }
          if (!pip.skipped) {
            setInstallNote(pip.message)
          }
        }

        const next = { ...pref, [pkg.id]: enabled }
        setPref(next)
        await window.sylo.prefs.set('sylo.optional_packages', next)
        onSaved(
          enabled ?
            `${pkg.title} enabled. Restart broker to load its tools.`
          : `${pkg.title} disabled. Restart broker to unload its tools.`,
        )
      } finally {
        setBusy(null)
      }
    },
    [onSaved, pref],
  )

  const enabledCount = SYLO_OPTIONAL_PACKAGES.filter((p) => pref[p.id] === true).length

  return (
    <details
      className={capSection}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className={capSectionSummary}>
        <h2 className={capSectionSummaryTitle}>Sylo optional packages</h2>
        <span className={capCount}>
          {enabledCount}/{SYLO_OPTIONAL_PACKAGES.length}
        </span>
        <span className={capSectionChevron} aria-hidden="true" />
      </summary>
      <div className={capSectionBody}>
        <p className={cn(mutedText, capSectionLeadTight)}>
          First-party <strong>sylo-*</strong> Pi packages shipped in the Sylo repo but{' '}
          <strong>off by default</strong>. Turn one <strong>On</strong> — Sylo runs{' '}
          <code>pip install</code> for its requirements when needed — then <strong>Restart broker</strong>.
          Uses whatever <code>python</code> is on PATH (no venv managed by Sylo).
        </p>
        {pythonWarning ?
          <div className={cn(capBanner, capBannerWarn, 'mb-2 whitespace-pre-wrap')}>
            {pythonWarning}
          </div>
        : null}
        {installNote ?
          <div className={cn(capBanner, capBannerWarn, 'mb-2 whitespace-pre-wrap')}>{installNote}</div>
        : null}
        {SYLO_OPTIONAL_PACKAGES.length === 0 ?
          <p className={cn(mutedText, capEmptyNote)}>No optional packages registered yet.</p>
        : (
          <ul className={rowList}>
            {SYLO_OPTIONAL_PACKAGES.map((pkg) => (
              <li key={pkg.id} className={capSkillRow}>
                <div className={rowHeadline}>
                  <span className={rowName}>
                    {pkg.title}
                    <span className={cn(mutedText, 'ml-2 font-mono text-xs')}>{pkg.id}</span>
                  </span>
                  <span className={rowSpacer} />
                  <CapEnableSwitch
                    checked={pref[pkg.id] === true}
                    disabled={busy === pkg.id}
                    ariaLabel={`${pkg.title} ${pref[pkg.id] ? 'enabled' : 'disabled'}`}
                    label={busy === pkg.id ? '…' : pref[pkg.id] ? 'On' : 'Off'}
                    onClick={() => void setEnabled(pkg, !pref[pkg.id])}
                  />
                </div>
                <p className={cn(mutedText, 'mt-1 text-sm')}>{pkg.description}</p>
                {pkg.skillNames.length > 0 ?
                  <p className={cn(mutedText, 'mt-1 text-xs')}>
                    Skills:{' '}
                    {pkg.skillNames.map((s) => (
                      <code key={s} className="mr-2">
                        {s}
                      </code>
                    ))}
                    — run <code>npm run bootstrap-pi</code> once to copy skill files to{' '}
                    <code>~/.pi/agent/skills</code>
                  </p>
                : null}
                {pkg.pythonRequirementsRelPath ?
                  <p className={cn(mutedText, 'mt-1 text-xs')}>
                    Python: auto-installs from <code>{pkg.pythonRequirementsRelPath}</code> when enabled.
                  </p>
                : null}
                {pkg.requiresSyloUi ?
                  <p className={cn(mutedText, 'mt-1 text-xs')}>Requires Sylo host UI (routes or widgets).</p>
                : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
