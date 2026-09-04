import React, { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import {
  capCount,
  capEmptyNote,
  capSection,
  capSectionBody,
  capSectionChevron,
  capSectionLeadTight,
  capSectionSummary,
  capSectionSummaryTitle,
  capSkillRow,
  mutedText,
  rowList,
  rowName,
} from '../ui-classes'

export type UserPackageInfo = {
  spec: string
  name: string
  version: string | null
  description: string | null
  resolvedPath: string | null
  exists: boolean
}

function isUserPackageInfo(v: unknown): v is UserPackageInfo[] {
  return (
    Array.isArray(v) &&
    v.every(
      (p) =>
        p &&
        typeof p === 'object' &&
        typeof (p as UserPackageInfo).spec === 'string' &&
        typeof (p as UserPackageInfo).name === 'string',
    )
  )
}

/**
 * "Personal packages" — operator-installed Pi packages (personal bundles,
 * community tools) resolved from ~/.pi/agent/settings.json packages[].
 * Generic by design: the host owns no package names, so the section is empty
 * on machines where nothing user-level is installed. Always-on — Pi loads
 * these in every workspace; manage with `pi install` / `pi update` /
 * `pi uninstall`, then Restart broker.
 */
export function UserPackagesSection(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [pkgs, setPkgs] = useState<UserPackageInfo[] | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const r = await window.sylo.userPackages.list()
        setPkgs(isUserPackageInfo(r) ? r : [])
      } catch {
        setPkgs([])
      }
    })()
  }, [])

  return (
    <details
      className={capSection}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className={capSectionSummary}>
        <h2 className={capSectionSummaryTitle}>Personal packages</h2>
        {pkgs && pkgs.length > 0 && <span className={capCount}>{pkgs.length}</span>}
        <span className={capSectionChevron} aria-hidden="true" />
      </summary>
      <div className={capSectionBody}>
        <p className={cn(mutedText, capSectionLeadTight)}>
          Pi packages <strong>you installed yourself</strong> (e.g.{' '}
          <code>pi install git:github.com/you/sylo-personal-tools</code> or an npm package) — outside
          the Sylo repo, loaded <strong>in every workspace</strong> at broker start. Update with{' '}
          <code>pi update</code>; remove with <code>pi uninstall</code>; restart the broker after
          either. No toggle needed — these are always on.
        </p>
        {pkgs === null ? null : pkgs.length === 0 ? (
          <p className={cn(mutedText, capEmptyNote)}>
            No user-installed packages. Install one with{' '}
            <code>pi install &lt;path | npm:pkg | git:...&gt;</code>.
          </p>
        ) : (
          <ul className={rowList}>
            {pkgs.map((pkg) => (
              <li key={pkg.spec} className={capSkillRow}>
                <div>
                  <span className={rowName}>
                    {pkg.name}
                    {pkg.version ? (
                      <span className={cn(mutedText, 'ml-2 font-mono text-xs')}>
                        v{pkg.version}
                      </span>
                    ) : null}
                    {!pkg.exists && (
                      <span className={cn(mutedText, 'ml-2 text-xs')}>(missing on disk)</span>
                    )}
                  </span>
                </div>
                {pkg.description && (
                  <p className={cn(mutedText, 'mt-1 text-sm')}>{pkg.description}</p>
                )}
                <p className={cn(mutedText, 'mt-1 text-xs')}>
                  <code>{pkg.spec}</code>
                  {pkg.resolvedPath ? (
                    <>
                      {' '}
                      → <code>{pkg.resolvedPath}</code>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}