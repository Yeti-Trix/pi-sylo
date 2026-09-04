import React, { useState } from 'react'
import { cn } from '../../lib/cn'
import {
  classifySyloBuiltinExtension,
  type SyloBuiltinExtensionKind,
} from '../../../../shared/sylo-builtin-extensions.js'
import { extensionDisplayTitle } from '../../../../shared/capability-display-names.js'
import {
  btnGhostSm,
  capBanner,
  capBannerWarn,
  capExtCard,
  capExtCardBody,
  capExtCardChevronOpen,
  capExtCardLi,
  capExtCardSummary,
  capExtCardSummaryActions,
  capExtCardSummaryOpen,
  capExtCardSummaryToggle,
  capExtCardTitleWrap,
  capExtRowCmds,
  capExtRowEmpty,
  capExtRowName,
  capHint,
  capSectionChevron,
  capSkillRowPath,
  capToolChevron,
  capToolChevronOpen,
  capToolDisclosureBody,
  capToolItemWrap,
  capToolList,
  capToolName,
  capToolNameBtn,
  capToolRowLine,
  capToolRowSpacer,
  mutedText,
} from '../ui-classes'
import { CapEnableSwitch, OriginBadge, ToolNameConflictCue } from './badges'

export function ExtensionToolRow({
  tool,
  extensionPathForPatch,
  extensionExcluded,
  onToggleTool,
}: {
  tool: {
    name: string
    description?: string
    nameConflictPeers?: string[]
    excludedFromAgent?: boolean
  }
  /** Canonical path for ~/.sylo/disabled.json (broker resolvedPath preferred). */
  extensionPathForPatch: string
  extensionExcluded: boolean
  onToggleTool: () => void
}): React.ReactElement {
  const [descOpen, setDescOpen] = useState(false)
  const toolExcluded = !!tool.excludedFromAgent
  const switchDisabled = extensionExcluded || !extensionPathForPatch.trim()
  return (
    <li
      className={capToolItemWrap}
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
    >
      <div className={capToolRowLine}>
        <button
          type="button"
          className={capToolNameBtn}
          aria-expanded={descOpen}
          onClick={(e) => {
            e.stopPropagation()
            setDescOpen((v) => !v)
          }}
        >
          <span
            className={cn(capToolChevron, descOpen && capToolChevronOpen)}
            aria-hidden
          />
          <code className={capToolName}>{tool.name}</code>
        </button>
        {tool.nameConflictPeers && tool.nameConflictPeers.length > 0 ?
          <ToolNameConflictCue peers={tool.nameConflictPeers} />
        : null}
        <span className={capToolRowSpacer} aria-hidden />
        <CapEnableSwitch
          checked={!toolExcluded && !extensionExcluded}
          disabled={switchDisabled}
          ariaLabel={
            switchDisabled ?
              extensionExcluded ?
                'Extension disabled — enable the extension to toggle tools'
              : 'Enable tool'
            : toolExcluded ?
              'Disabled — click to enable for the agent'
            : 'Enabled — click to disable for the agent'
          }
          label="Enable"
          className="mr-0 shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            if (!switchDisabled) onToggleTool()
          }}
        />
      </div>
      {descOpen ?
        <div className={capToolDisclosureBody}>
          {tool.description ?
            tool.description
          : <span className={cn(mutedText, 'italic')}>No description.</span>}
        </div>
      : null}
    </li>
  )
}

export function ExtensionCapabilityCard({
  x,
  brokerOk,
  onPatchExtension,
  onPatchTool,
  hasConfigSchema,
  onConfigure,
}: {
  x: CapabilitiesView['extensions'][number]
  brokerOk: boolean
  onPatchExtension: (path: string, excluded: boolean) => void
  onPatchTool: (extensionPath: string, toolName: string, excluded: boolean) => void
  hasConfigSchema?: boolean
  onConfigure?: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const pathForTools = (x.resolvedPath ?? x.path ?? '').trim()
  const builtinKind: SyloBuiltinExtensionKind | null = classifySyloBuiltinExtension(
    x.resolvedPath ?? x.path ?? '',
  )
  return (
    <li className={capExtCardLi}>
      <div className={capExtCard}>
        <div className={cn(capExtCardSummary, open && capExtCardSummaryOpen)}>
          <button
            type="button"
            className={capExtCardSummaryToggle}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span
              className={cn(capSectionChevron, open && capExtCardChevronOpen)}
              aria-hidden="true"
            />
            <span className={capExtCardTitleWrap}>
              <span className={capExtRowName}>{extensionDisplayTitle(x.name, x.path)}</span>
              <OriginBadge origin={x.origin} />
            </span>
          </button>
          <span
            className={capExtCardSummaryActions}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
            }}
          >
            {x.path ?
              <CapEnableSwitch
                checked={!x.excludedFromAgent}
                ariaLabel={
                  x.excludedFromAgent ?
                    'Disabled — click to enable for the agent'
                  : 'Enabled — click to disable for the agent'
                }
                label="Enable"
                className="mr-0"
                onClick={() => onPatchExtension(x.path, !x.excludedFromAgent)}
              />
            : null}
          </span>
        </div>
        {open ?
          <div className={capExtCardBody}>
            {x.path ?
              <code className={cn(capSkillRowPath, 'mb-1.5 block')}>{x.path}</code>
            : null}
            {hasConfigSchema && onConfigure ?
              <div className="mb-2">
                <button type="button" className={btnGhostSm} onClick={onConfigure}>
                  Configure…
                </button>
              </div>
            : null}
            {x.builtinHint ? <div className={capHint}>{x.builtinHint}</div> : null}
            {x.excludedFromAgent && builtinKind ?
              <div className={cn(capBanner, capBannerWarn, 'mb-2')}>
                {builtinKind === 'tools-guard' ?
                  'Built-in guard is disabled. Pi built-in tool toggles above may not be enforced until you re-enable this extension and restart the broker.'
                : 'Built-in extension disabled. Widget skills will not render show_widget UI; agents fall back to fallback.md.'}
              </div>
            : null}
            {x.commandNames.length > 0 && (
              <div className={capExtRowCmds}>
                Commands: {x.commandNames.map((c) => `/${c}`).join(' · ')}
              </div>
            )}
            {x.tools.length === 0 ?
              <div className={capExtRowEmpty}>
                {brokerOk ? '— no tools registered —' : '— Pi not connected —'}
              </div>
            : (
              <ul className={capToolList}>
                {x.tools.map((t, i) => (
                  <ExtensionToolRow
                    key={`${pathForTools}#${i}#${t.name}`}
                    tool={t}
                    extensionPathForPatch={pathForTools}
                    extensionExcluded={!!x.excludedFromAgent}
                    onToggleTool={() => onPatchTool(pathForTools, t.name, !t.excludedFromAgent)}
                  />
                ))}
              </ul>
            )}
          </div>
        : null}
      </div>
    </li>
  )
}
