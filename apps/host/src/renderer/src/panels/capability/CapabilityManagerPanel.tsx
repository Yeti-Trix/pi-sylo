import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import {
  defaultPiBuiltinToolsPref,
  normalizePiBuiltinToolsPref,
  PI_BUILTIN_TOOL_IDS,
  PI_BUILTIN_TOOL_LABELS,
  type PiBuiltinToolsPref,
} from '../../../../shared/pi-builtin-tools.js'
import {
  classifySyloBuiltinExtension,
  findBuiltinToolsGuardExtension,
  piBuiltinToolsEnforcementActive,
} from '../../../../shared/sylo-builtin-extensions.js'
import { SYLO_INCLUDE_CURSOR_SKILLS_PREF } from '../../../../shared/sylo-capability-prefs.js'
import { npmPackageFolderFromPath } from '../../../../shared/capability-display-names.js'
import {
  btnDanger,
  btnGhost,
  btnGhostSm,
  btnPrimary,
  btnPrimarySm,
  capActions,
  capBanner,
  capBannerError,
  capBannerWarn,
  capCatalogCard,
  capCatalogDesc,
  capCatalogDl,
  capCatalogInstallBtn,
  capCatalogList,
  capCatalogMeta,
  capCatalogName,
  capCatalogRow,
  capCatalogRowBody,
  capCatalogRowHead,
  capCatalogRowInner,
  capCatalogScroll,
  capCatalogToolbar,
  capCatalogToolbarLabel,
  capCatalogTypes,
  capCount,
  capEmptyNote,
  capField,
  capFieldGrow,
  capInlineForm,
  capInlineInput,
  capManager,
  capPath,
  capPkgCard,
  capPkgCardBody,
  capPkgCardEmpty,
  capPkgCardHeadline,
  capPkgCardHint,
  capPkgCardMeta,
  capPkgCardName,
  capPkgCardSummary,
  capPkgCardSummaryActions,
  capPkgCardSummaryLead,
  capPkgCardSummaryTrail,
  capPkgCardToolbar,
  capSection,
  capSectionBody,
  capSectionChevron,
  capSectionLeadTight,
  capSectionSummary,
  capSectionSummaryTitle,
  capSectionTitle,
  capSkillRow,
  capStatusDot,
  capStatusDotDisabled,
  capStatusDotOn,
  capSubhead,
  capSubheadHint,
  capSubheadTitle,
  capOrigin,
  capSkillRowPath,
  fieldLabel,
  input,
  modalActions,
  modalBody,
  modalOverlay,
  modalShell,
  modalTitle,
  mutedText,
  rowHeadline,
  rowList,
  rowName,
  rowSpacer,
  select,
} from '../ui-classes'
import { CapEnableSwitch, OriginBadge } from './badges'
import { ConfigFormModal } from './config-form'
import { ExtensionCapabilityCard } from './extension-cards'
import { SyloOptionalPackagesSection } from './SyloOptionalPackagesSection'
import { UserPackagesSection } from './UserPackagesSection'
import { SkillRowCard } from './SkillRowCard'
import {
  alsoStripForPackageToggle,
  detailsOpenFromToggleEvent,
  extensionMatchesPackageSpec,
  folderIdFromSpec,
  isStandaloneSkill,
  KNOWN_PACKAGES,
  knownPackagePrimarySpec,
  mergeInstalledPackageBundle,
  normalizeNpmInstallSpec,
  packageBundleOriginFromPath,
  specsEquivalentTo,
  type PackageBundleSlice,
} from './helpers'

export function CapabilityManagerPanel({
  capabilities,
  settingsJson,
  skillSurfaceLintByPath,
  exclusionWorkspaceId,
  exclusionWorkspaceName,
  onTogglePackage,
  onRestartBroker,
  onRefresh,
  onAttachUi,
  onNewSkill,
}: {
  capabilities: CapabilitiesView | null
  settingsJson: Record<string, unknown>
  skillSurfaceLintByPath: Record<string, SkillSurfaceLintReport>
  exclusionWorkspaceId: string
  exclusionWorkspaceName: string
  onTogglePackage: (
    pkg: string,
    enabled: boolean,
    alsoStrip?: string[],
    opts?: { skillPaths?: string[] },
  ) => Promise<void> | void
  onRestartBroker: () => void | Promise<void>
  onRefresh: () => void
  onAttachUi: () => void | Promise<void>
  onNewSkill: () => void
}): React.ReactElement {
  const [installBusy, setInstallBusy] = useState<string | null>(null)
  const [installFlash, setInstallFlash] = useState<string | null>(null)
  const [cardBusy, setCardBusy] = useState<string | null>(null)
  const [skillRemoveBusy, setSkillRemoveBusy] = useState<string | null>(null)
  const [removeSkillModal, setRemoveSkillModal] = useState<{ name: string; path: string } | null>(null)
  const [customSpec, setCustomSpec] = useState('npm:')

  const [piDevPage, setPiDevPage] = useState(1)
  const [piDevNameInput, setPiDevNameInput] = useState('')
  const [piDevNameApplied, setPiDevNameApplied] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [piBuiltinToolsOpen, setPiBuiltinToolsOpen] = useState(false)
  const [piBuiltinTools, setPiBuiltinTools] = useState<PiBuiltinToolsPref>(() => defaultPiBuiltinToolsPref())
  const [skillsSectionOpen, setSkillsSectionOpen] = useState(false)
  const [includeCursorSkills, setIncludeCursorSkills] = useState(false)
  const [includeCursorBusy, setIncludeCursorBusy] = useState(false)
  const [expandedSkillPath, setExpandedSkillPath] = useState<string | null>(null)
  const [extensionsSectionOpen, setExtensionsSectionOpen] = useState(false)
  // Downloaded packages is the primary inventory surface — keep this section expanded by default;
  // individual package rows below stay collapsed until opened.
  const [downloadedOpen, setDownloadedOpen] = useState(true)
  /** Tracks open state for each Downloaded-packages row (<details>). */
  const [pkgCardOpenBySource, setPkgCardOpenBySource] = useState<Record<string, boolean>>({})
  const [piDevType, setPiDevType] = useState<'' | 'extension' | 'skill' | 'theme' | 'prompt'>('')
  const [piDevSort, setPiDevSort] = useState<'downloads' | 'recent' | 'name'>('downloads')
  const [piDevResult, setPiDevResult] = useState<{
    packages: {
      name: string
      description: string
      installSpec: string
      types: string[]
      downloadsMonthly: number
      publishedMs: number
    }[]
    rangeStart: number
    rangeEnd: number
    total: number
    page: number
    pageSize: number
    sourceUrl: string
  } | null>(null)
  const [piDevBusy, setPiDevBusy] = useState(false)
  const [piDevErr, setPiDevErr] = useState<string | null>(null)
  const [excludeAgentNotice, setExcludeAgentNotice] = useState<string | null>(null)
  const [extensionConfigPaths, setExtensionConfigPaths] = useState<Set<string>>(() => new Set())
  const [configModal, setConfigModal] = useState<
    | null
    | { kind: 'skill'; path: string; title: string }
    | { kind: 'extension'; path: string; configKey: string; title: string }
  >(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configSchema, setConfigSchema] = useState<Record<string, unknown> | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({})

  useEffect(() => {
    void (async () => {
      const raw = await window.sylo.prefs.get('sylo.pi_builtin_tools', null)
      setPiBuiltinTools(normalizePiBuiltinToolsPref(raw))
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      const raw = await window.sylo.prefs.get(SYLO_INCLUDE_CURSOR_SKILLS_PREF, false)
      setIncludeCursorSkills(raw === true)
    })()
  }, [])

  const piCatalogFilterRef = useRef({ n: '', t: '' as typeof piDevType, s: 'downloads' as typeof piDevSort })

  useEffect(() => {
    const t = window.setTimeout(() => setPiDevNameApplied(piDevNameInput), 450)
    return () => window.clearTimeout(t)
  }, [piDevNameInput])

  // Auto-expand the catalog section when the user starts typing a filter.
  useEffect(() => {
    if (piDevNameInput.trim() !== '') setCatalogOpen(true)
  }, [piDevNameInput])

  useEffect(() => {
    const prev = piCatalogFilterRef.current
    const filterChanged =
      prev.n !== piDevNameApplied || prev.t !== piDevType || prev.s !== piDevSort
    const pageToFetch = filterChanged ? 1 : piDevPage
    if (filterChanged) {
      piCatalogFilterRef.current = { n: piDevNameApplied, t: piDevType, s: piDevSort }
      if (piDevPage !== 1) setPiDevPage(1)
    }

    let cancelled = false
    void (async () => {
      setPiDevBusy(true)
      setPiDevErr(null)
      const r = await window.sylo.package.piDevCatalog({
        page: pageToFetch,
        name: piDevNameApplied.trim() || undefined,
        type: piDevType || undefined,
        sort: piDevSort,
      })
      if (cancelled) return
      setPiDevBusy(false)
      if (r.ok) {
        setPiDevResult(r)
      } else {
        setPiDevResult(null)
        setPiDevErr(r.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [piDevPage, piDevNameApplied, piDevType, piDevSort])

  const openSkillParamsEditor = useCallback(async (skillPath: string, title: string) => {
    setConfigModal({ kind: 'skill', path: skillPath, title })
    setConfigLoading(true)
    setConfigError(null)
    setConfigSchema(null)
    setConfigValues({})
    const r = await window.sylo.capabilities.skillParamsGet(skillPath)
    setConfigLoading(false)
    if (!r.ok) {
      setConfigError(r.error)
      return
    }
    setConfigSchema(r.schema)
    setConfigValues(r.values)
  }, [])

  const openExtensionConfigEditor = useCallback(
    async (extensionPath: string, title: string) => {
      setConfigLoading(true)
      setConfigError(null)
      setConfigSchema(null)
      setConfigValues({})
      const meta = await window.sylo.capabilities.extensionConfigMeta(extensionPath)
      if (!meta.ok) {
        setConfigLoading(false)
        setConfigError(meta.error)
        setConfigModal({ kind: 'extension', path: extensionPath, configKey: '', title })
        return
      }
      setConfigModal({
        kind: 'extension',
        path: extensionPath,
        configKey: meta.meta.configKey,
        title,
      })
      const r = await window.sylo.capabilities.extensionConfigGet(meta.meta.configKey)
      setConfigLoading(false)
      if (!r.ok) {
        setConfigError(r.error)
        return
      }
      setConfigSchema(r.schema)
      setConfigValues(r.values)
    },
    [],
  )

  const closeConfigModal = useCallback(() => {
    setConfigModal(null)
    setConfigLoading(false)
    setConfigError(null)
    setConfigSchema(null)
    setConfigValues({})
  }, [])

  const saveConfigModal = useCallback(
    async (values: Record<string, unknown>) => {
      if (!configModal) return
      if (configModal.kind === 'skill') {
        const r = await window.sylo.capabilities.skillParamsSave(configModal.path, values)
        if (!r.ok) {
          setConfigError(r.error)
          return
        }
      } else {
        if (!configModal.configKey) return
        const r = await window.sylo.capabilities.extensionConfigSave(configModal.configKey, values)
        if (!r.ok) {
          setConfigError(r.error)
          return
        }
      }
      closeConfigModal()
      setExcludeAgentNotice(
        configModal.kind === 'skill' ?
          'Skill params saved. Restart broker if the skill uses substituted {{vars}} at load time.'
        : 'Extension config saved. Restart broker if the extension reads config only at init.',
      )
    },
    [configModal, closeConfigModal],
  )

  const skills = capabilities?.skills ?? []
  const extensions = capabilities?.extensions ?? []

  useEffect(() => {
    if (!extensionsSectionOpen) return
    let cancelled = false
    void (async () => {
      const next = new Set<string>()
      for (const x of extensions) {
        if (!x.path?.trim()) continue
        const r = await window.sylo.capabilities.extensionConfigMeta(x.path)
        if (r.ok) next.add(x.path)
      }
      if (!cancelled) setExtensionConfigPaths(next)
    })()
    return () => {
      cancelled = true
    }
  }, [extensionsSectionOpen, extensions])

  /** `packages[]` from Pi settings — must track `settingsJson` in the renderer, not `capabilities.packages` (stale until refresh). */
  const enabledSpecsList = useMemo(
    () => (Array.isArray(settingsJson.packages) ? settingsJson.packages.map(String) : []),
    [settingsJson.packages],
  )
  const enabledPkgs = useMemo(() => new Set(enabledSpecsList), [enabledSpecsList])

  const orphanPackages =
    capabilities?.brokerOk ?
      enabledSpecsList.filter((pkg) => !extensions.some((e) => extensionMatchesPackageSpec(e.path, pkg)))
    : []

  const inventory = capabilities?.packageInventory ?? []

  const installedInventoryRows = useMemo(
    () =>
      [...inventory]
        .filter((r) => r.installedPath?.trim())
        .sort((a, b) => a.source.localeCompare(b.source)),
    [inventory],
  )

  const installedFolderIds = useMemo(
    () => new Set(installedInventoryRows.map((r) => folderIdFromSpec(r.source))),
    [installedInventoryRows],
  )

  /** Matches pi.dev catalog rows to Downloaded packages inventory (canonical id + KNOWN_PACKAGES aliases). */
  const piDevRowLoadedByCanonFolder = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const inv of installedInventoryRows) {
      const key = folderIdFromSpec(knownPackagePrimarySpec(inv.source))
      const on = specsEquivalentTo(inv.source).some((x) => enabledPkgs.has(x))
      m.set(key, m.get(key) === true || on)
    }
    return m
  }, [installedInventoryRows, enabledPkgs])

  const bundlesByKey = useMemo(() => {
    type SkillRow = CapabilitiesView['skills'][number]
    const map = new Map<
      string,
      {
        skills: SkillRow[]
        extensions: NonNullable<CapabilitiesView['extensions']>
      }
    >()

    const bump = (key: string) => {
      let b = map.get(key)
      if (!b) {
        b = { skills: [], extensions: [] }
        map.set(key, b)
      }
      return b
    }

    for (const s of skills) {
      const k = npmPackageFolderFromPath(s.path)
      if (k && installedFolderIds.has(k)) bump(k).skills.push(s)
    }
    for (const x of extensions) {
      const k = npmPackageFolderFromPath(x.path)
      if (k && installedFolderIds.has(k)) bump(k).extensions.push(x)
    }

    for (const b of map.values()) {
      b.skills.sort((a, c) => a.name.localeCompare(c.name))
      b.extensions.sort((a, c) => a.name.localeCompare(c.name))
    }

    return map
  }, [skills, extensions, installedFolderIds])

  const skillsSorted = useMemo(
    () => [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    [skills],
  )
  const extensionsSorted = useMemo(
    () => [...extensions].sort((a, b) => a.name.localeCompare(b.name)),
    [extensions],
  )

  const piBuiltinEnabledCount = useMemo(() => {
    if (!piBuiltinTools.enabled) return 0
    return PI_BUILTIN_TOOL_IDS.filter((id) => piBuiltinTools.tools[id]).length
  }, [piBuiltinTools])

  const piBuiltinGuardMismatch = useMemo(() => {
    const guard = capabilities ? findBuiltinToolsGuardExtension(capabilities.extensions) : undefined
    const guardExcluded = !guard || guard.excludedFromAgent
    return guardExcluded && piBuiltinToolsEnforcementActive(piBuiltinTools)
  }, [capabilities, piBuiltinTools])

  const savePiBuiltinToolsPrefs = async () => {
    await window.sylo.prefs.set('sylo.pi_builtin_tools', piBuiltinTools)
    setExcludeAgentNotice('Pi built-in tool settings saved. Restarting broker…')
    await onRestartBroker()
    setExcludeAgentNotice('Pi built-in tool settings saved. Broker restarted.')
  }

  const setIncludeCursorSkillsPref = async (enabled: boolean) => {
    if (includeCursorBusy) return
    setIncludeCursorBusy(true)
    setIncludeCursorSkills(enabled)
    try {
      await window.sylo.prefs.set(SYLO_INCLUDE_CURSOR_SKILLS_PREF, enabled)
      setExcludeAgentNotice(
        enabled ?
          'Cursor skills enabled for this workspace. Refreshing list and restarting broker…'
        : 'Cursor skills hidden. Refreshing list and restarting broker…',
      )
      await onRefresh()
      await onRestartBroker()
      setExcludeAgentNotice(
        enabled ?
          'Cursor skills enabled — skills under this workspace’s .cursor/skills are listed and can apply.'
        : 'Cursor skills off — only Pi agent, .pi/skills, and packages.',
      )
    } finally {
      setIncludeCursorBusy(false)
    }
  }

  const setPiBuiltinMaster = (enabled: boolean) => {
    setPiBuiltinTools((prev) => ({ ...prev, enabled }))
  }

  const setPiBuiltinTool = (id: (typeof PI_BUILTIN_TOOL_IDS)[number], on: boolean) => {
    setPiBuiltinTools((prev) => ({
      ...prev,
      tools: { ...prev.tools, [id]: on },
    }))
  }

  const installedCards = useMemo(() => {
    return installedInventoryRows.map((inv) => {
      const id = folderIdFromSpec(inv.source)
      const b = bundlesByKey.get(id) ?? { skills: [], extensions: [] }
      return {
        inventory: inv,
        bundle: {
          key: id,
          skills: b.skills,
          extensions: b.extensions,
        },
      }
    })
  }, [installedInventoryRows, bundlesByKey])

  /** Last non-empty broker snapshot per install folder — keeps extension/skill rows visible after unload until broker restart. */
  const packageBundleSnapshotRef = useRef<Map<string, PackageBundleSlice>>(new Map())
  useEffect(() => {
    const snap = packageBundleSnapshotRef.current
    for (const [key, b] of bundlesByKey) {
      if (b.extensions.length > 0 || b.skills.length > 0) {
        snap.set(key, {
          skills: b.skills.map((s) => ({ ...s })),
          extensions: b.extensions.map((e) => ({
            ...e,
            tools: e.tools.map((t) => ({ ...t })),
            commandNames: [...e.commandNames],
          })),
        })
      }
    }
  }, [bundlesByKey])

  // Auto-expand Downloaded packages when there are cards (section is at the page
  // bottom; operator usually wants to see inventory without another click).
  useEffect(() => {
    if (installedCards.length > 0) setDownloadedOpen(true)
  }, [installedCards.length])

  const syncCapabilitiesAfterPackageOp = useCallback(async () => {
    await onRefresh()
  }, [onRefresh])

  const packageWorkspaceId = exclusionWorkspaceId.trim() || undefined

  const patchStandaloneExclude = useCallback(
    async (kind: 'skill' | 'extension', path: string, excluded: boolean) => {
      if (!path.trim()) return
      const wid = exclusionWorkspaceId.trim()
      const restartNote =
        wid ?
          'Saved for this workspace (merged with global ~/.sylo/disabled.json). Switch conversation or Restart broker so the agent matches this list.'
        : 'Saved globally. Restart broker so the agent picks up the change.'
      const builtinExtKind = kind === 'extension' ? classifySyloBuiltinExtension(path) : null
      if (wid) {
        const r = await window.sylo.workspaces.patchDisabled({
          workspaceId: wid,
          kind,
          path,
          excluded,
        })
        if (!r.ok) {
          alert(`Could not update workspace capability settings:\n${r.error}`)
          return
        }
        if (builtinExtKind === 'tools-guard' && excluded && piBuiltinToolsEnforcementActive(piBuiltinTools)) {
          setExcludeAgentNotice(
            `Built-in tools guard disabled. Pi built-in tool toggles above are no longer enforced until you re-enable the guard and restart the broker. ${restartNote}`,
          )
        } else if (builtinExtKind === 'skill-surface' && excluded) {
          setExcludeAgentNotice(
            `Built-in skill-surface extension disabled. show_widget will be unavailable; widget skills fall back to fallback.md. ${restartNote}`,
          )
        } else if (builtinExtKind === 'subagents' && excluded) {
          setExcludeAgentNotice(
            `Built-in sylo-subagents disabled. subagent delegation will be unavailable. ${restartNote}`,
          )
        } else {
          setExcludeAgentNotice(restartNote)
        }
      } else {
        const r = await window.sylo.capabilities.disabled.patch({ kind, path, excluded })
        if (!r.ok) {
          alert(`Could not update capability enablement:\n${r.error}`)
          return
        }
        if (builtinExtKind === 'tools-guard' && excluded && piBuiltinToolsEnforcementActive(piBuiltinTools)) {
          setExcludeAgentNotice(
            `Built-in tools guard disabled. Pi built-in tool toggles above are no longer enforced until you re-enable the guard and restart the broker. ${restartNote}`,
          )
        } else if (builtinExtKind === 'skill-surface' && excluded) {
          setExcludeAgentNotice(
            `Built-in skill-surface extension disabled. show_widget will be unavailable; widget skills fall back to fallback.md. ${restartNote}`,
          )
        } else if (builtinExtKind === 'subagents' && excluded) {
          setExcludeAgentNotice(
            `Built-in sylo-subagents disabled. subagent delegation will be unavailable. ${restartNote}`,
          )
        } else {
          setExcludeAgentNotice(restartNote)
        }
      }
      await onRefresh()
    },
    [onRefresh, exclusionWorkspaceId, piBuiltinTools],
  )

  const patchToolExclude = useCallback(
    async (extensionPath: string, toolName: string, excluded: boolean) => {
      const ep = extensionPath.trim()
      const tn = toolName.trim()
      if (!ep || !tn) return
      const wid = exclusionWorkspaceId.trim()
      if (wid) {
        const r = await window.sylo.workspaces.patchDisabled({
          workspaceId: wid,
          kind: 'tool',
          extensionPath: ep,
          toolName: tn,
          excluded,
        })
        if (!r.ok) {
          alert(`Could not update workspace capability settings:\n${r.error}`)
          return
        }
        setExcludeAgentNotice(
          'Saved for this workspace (merged with global ~/.sylo/disabled.json). Switch conversation or Restart broker so the agent matches this list.',
        )
      } else {
        const r = await window.sylo.capabilities.disabled.patch({
          kind: 'tool',
          extensionPath: ep,
          toolName: tn,
          excluded,
        })
        if (!r.ok) {
          alert(`Could not update capability enablement:\n${r.error}`)
          return
        }
        setExcludeAgentNotice('Saved globally. Restart broker so the agent picks up the change.')
      }
      await onRefresh()
    },
    [onRefresh, exclusionWorkspaceId],
  )

  const runInstall = async (spec: string) => {
    const s = spec.trim()
    if (!s) return
    setInstallBusy(s)
    setInstallFlash(null)
    try {
      const r = await window.sylo.package.installSpec(s, packageWorkspaceId)
      if (r.ok) {
        setInstallFlash(
          `${s} — Pi CLI finished. Use Restart broker above when the lists look stale.`,
        )
        await syncCapabilitiesAfterPackageOp()
      } else {
        alert(`Install failed:\n${r.detail ?? '(no detail)'}`)
      }
    } finally {
      setInstallBusy(null)
    }
  }

  const runUpdate = async (spec: string) => {
    const s = spec.trim()
    if (!s) return
    setCardBusy(s)
    setInstallFlash(null)
    try {
      const r = await window.sylo.package.updateSpec(s, packageWorkspaceId)
      if (r.ok) {
        setInstallFlash(`${s} — Pi update finished. Restart broker if needed.`)
        await syncCapabilitiesAfterPackageOp()
      } else {
        alert(`Update failed:\n${r.detail ?? '(no detail)'}`)
      }
    } finally {
      setCardBusy(null)
    }
  }

  const confirmRemoveStandaloneSkill = async () => {
    if (!removeSkillModal) return
    const { name, path: p } = removeSkillModal
    setRemoveSkillModal(null)
    setSkillRemoveBusy(p)
    setInstallFlash(null)
    try {
      const r = await window.sylo.shell.removeStandalone(p, packageWorkspaceId)
      if (r.ok) {
        setInstallFlash(`${name} — skill folder removed. Restart broker if the list looks stale.`)
        await syncCapabilitiesAfterPackageOp()
      } else {
        alert(`Could not remove skill:\n${r.error}`)
      }
    } finally {
      setSkillRemoveBusy(null)
    }
  }

  const runUninstall = async (spec: string) => {
    const s = spec.trim()
    if (!s) return
    if (
      !window.confirm(
        `Uninstall ${s}?\n\nThis runs \`pi uninstall\` — Pi removes the package from its store and settings.`,
      )
    ) {
      return
    }
    setCardBusy(s)
    setInstallFlash(null)
    try {
      const r = await window.sylo.package.uninstallSpec(s, packageWorkspaceId)
      if (r.ok) {
        setInstallFlash(`${s} — Pi uninstall finished. Restart broker if needed.`)
        await syncCapabilitiesAfterPackageOp()
      } else {
        alert(`Uninstall failed:\n${r.detail ?? '(no detail)'}`)
      }
    } finally {
      setCardBusy(null)
    }
  }

  const excludeScopeBanner =
    exclusionWorkspaceName ?
      <div className={cn(capBanner, capSectionLeadTight)}>
        <strong>Per-workspace</strong> <strong>Enable</strong> under <strong>Skills</strong> and <strong>Extensions</strong>{' '}
        merges with global <code>~/.sylo/disabled.json</code> for workspace{' '}
        <strong>{exclusionWorkspaceName}</strong>. <strong>Load package for agent</strong> on Downloaded packages stays
        global (<code>packages[]</code>).
      </div>
    : null

  const banner = !capabilities ? null : !capabilities.brokerReady ? (
    <div className={cn(capBanner, capBannerWarn)}>
      Pi agent is not connected — showing filesystem view only. Tools registered by packages will not appear
      until the broker is up.
    </div>
  ) : !capabilities.brokerOk ? (
    <div className={cn(capBanner, capBannerWarn)}>
      Pi connected, but capability listing failed{capabilities.brokerError ? `: ${capabilities.brokerError}` : ''}. Showing
      filesystem view only.
    </div>
  ) : null

  const conflictingToolIds = capabilities?.brokerOk ? Object.keys(capabilities.toolNameCollisions ?? {}) : []
  const collisionBanner =
    conflictingToolIds.length > 0 ?
      <div className={cn(capBanner, capBannerWarn)}>
        <strong>{conflictingToolIds.length}</strong>{' '}
        Pi tool {conflictingToolIds.length === 1 ? 'id is' : 'ids are'} registered under more than one extension. The
        effective handler follows Pi&apos;s loader (order not guaranteed). Rows below are flagged; turn off one
        extension for the agent or unload a conflicting package, then restart the broker.
      </div>
    : null

  return (
    <div className={capManager}>
      {banner}
      {excludeScopeBanner}
      {collisionBanner}

      <h2 className={capSectionTitle}>Capability manager</h2>
      <div className={capActions}>
        <button type="button" className={btnGhost} onClick={() => void onAttachUi()}>
          Attach UI to Sylo…
        </button>
        <button type="button" className={btnGhost} onClick={onNewSkill}>
          + New skill
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            setInstallFlash(null)
            setExcludeAgentNotice(null)
            void onRestartBroker()
          }}
        >
          Restart broker
        </button>
      </div>

      {installFlash && (
        <div className={cn(capBanner, capBannerWarn)} style={{ marginTop: 8 }}>
          {installFlash}
        </div>
      )}
      {excludeAgentNotice && (
        <div className={cn(capBanner, capBannerWarn)} style={{ marginTop: 8 }}>
          {excludeAgentNotice}
        </div>
      )}

      <details
        className={capSection}
        open={piBuiltinToolsOpen}
        onToggle={(e) => setPiBuiltinToolsOpen(detailsOpenFromToggleEvent(e))}
      >
        <summary className={capSectionSummary}>
          <h2 className={capSectionSummaryTitle}>Pi built-in tools</h2>
          <span className={capCount}>
            {piBuiltinTools.enabled ? `${piBuiltinEnabledCount}/${PI_BUILTIN_TOOL_IDS.length}` : 'off'}
          </span>
          <span className={capSectionChevron} aria-hidden="true" />
        </summary>
        <div className={capSectionBody}>
          <p className={cn(mutedText, capSectionLeadTight)}>
            Pi&apos;s native filesystem and shell tools (<code>read</code>, <code>write</code>, <code>bash</code>, etc.).
            Turn the master switch off to rely only on <strong>extensions</strong> and <strong>skills</strong> you install
            below. Disabled tools are removed from the agent prompt and <strong>blocked at execution</strong> if the model
            still requests them. Extension tools you enable are unaffected.
          </p>
          {piBuiltinGuardMismatch ?
            <div className={cn(capBanner, capBannerError)} style={{ marginTop: 8 }}>
              <strong>Enforcement gap:</strong> the built-in <code>sylo-builtin-tools-guard</code> extension is
              disabled, but Pi built-in tool toggles above still restrict at least one tool. Those restrictions are{' '}
              <strong>not enforced</strong> until you re-enable the guard under Extensions and restart the broker.
            </div>
          : null}
          <div className={cn(rowHeadline, 'mb-2 mt-3')}>
            <span className={rowName}>All Pi built-in tools</span>
            <span className={rowSpacer} />
            <CapEnableSwitch
              checked={piBuiltinTools.enabled}
              ariaLabel={
                piBuiltinTools.enabled ?
                  'Pi built-in tools enabled — click to disable all'
                : 'Pi built-in tools disabled — click to enable'
              }
              label={piBuiltinTools.enabled ? 'On' : 'Off'}
              onClick={() => setPiBuiltinMaster(!piBuiltinTools.enabled)}
            />
          </div>
          <ul className={cn(rowList, !piBuiltinTools.enabled && 'opacity-55')}>
            {PI_BUILTIN_TOOL_IDS.map((id) => (
              <li key={id} className={capSkillRow}>
                <div className={rowHeadline}>
                  <span className={rowName}>
                    <code>{id}</code>
                    <span className={cn(mutedText, 'ml-2 font-normal')}>
                      {PI_BUILTIN_TOOL_LABELS[id]}
                    </span>
                  </span>
                  <span className={rowSpacer} />
                  <CapEnableSwitch
                    checked={piBuiltinTools.tools[id]}
                    disabled={!piBuiltinTools.enabled}
                    ariaLabel={`${id} ${piBuiltinTools.tools[id] ? 'enabled' : 'disabled'}`}
                    label="Enable"
                    onClick={() => setPiBuiltinTool(id, !piBuiltinTools.tools[id])}
                  />
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={btnPrimary}
           
            onClick={() => void savePiBuiltinToolsPrefs()}
          >
            Save &amp; restart broker
          </button>
        </div>
      </details>

      <SyloOptionalPackagesSection
        onSaved={(note) => {
          if (note) setExcludeAgentNotice(note)
          onRefresh()
        }}
      />

      <UserPackagesSection />

      <details
        className={capSection}
        open={catalogOpen}
        onToggle={(e) => setCatalogOpen(detailsOpenFromToggleEvent(e))}
      >
        <summary className={capSectionSummary}>
          <h2 className={capSectionSummaryTitle}>Pi.dev package catalog</h2>
          {piDevResult && <span className={capCount}>{piDevResult.total.toLocaleString()}</span>}
          <span className={capSectionChevron} aria-hidden="true" />
        </summary>
        <div className={capSectionBody}>
          <p className={cn(mutedText, capSectionLeadTight)}>
            Browse packages on{' '}
            <a href="https://pi.dev/packages" target="_blank" rel="noreferrer">
              pi.dev
            </a>
            . <strong>Install</strong> runs <code>pi install</code>. When it finishes, click <strong>Restart broker</strong>{' '}
            above so installs show up; a <strong>Downloaded packages</strong> card appears below once Pi sees them on
            disk.
          </p>

          <div className={capCatalogCard}>
            <div className={capCatalogToolbar}>
              <label className={cn(capField, capFieldGrow, capCatalogToolbarLabel)}>
                <span className={fieldLabel}>Filter (pi.dev)</span>
                <input
                  type="search"
                  className={input}
                  value={piDevNameInput}
                  onChange={(e) => setPiDevNameInput(e.target.value)}
                  placeholder="Name, description, author…"
                  autoComplete="off"
                />
              </label>
              <label className={capField}>
                <span className={fieldLabel}>Type</span>
                <select
                  className={select}
                  value={piDevType}
                  onChange={(e) => {
                    setPiDevType(e.target.value as typeof piDevType)
                    setPiDevPage(1)
                  }}
                >
                  <option value="">All types</option>
                  <option value="extension">extension</option>
                  <option value="skill">skill</option>
                  <option value="theme">theme</option>
                  <option value="prompt">prompt</option>
                </select>
              </label>
              <label className={capField}>
                <span className={fieldLabel}>Sort</span>
                <select
                  className={select}
                  value={piDevSort}
                  onChange={(e) => {
                    setPiDevSort(e.target.value as typeof piDevSort)
                    setPiDevPage(1)
                  }}
                >
                  <option value="downloads">Most downloads</option>
                  <option value="recent">Recently published</option>
                  <option value="name">A–Z</option>
                </select>
              </label>
              <button
                type="button"
                className={btnGhost}
                disabled={piDevBusy || piDevPage <= 1}
                onClick={() => setPiDevPage((p) => Math.max(1, p - 1))}
              >
                Previous page
              </button>
              <button
                type="button"
                className={btnGhost}
                disabled={piDevBusy || !piDevResult || piDevResult.rangeEnd >= piDevResult.total}
                onClick={() => setPiDevPage((p) => p + 1)}
              >
                Next page
              </button>
            </div>

        {piDevResult && !piDevBusy && !piDevErr && (
          <div className={cn(capCatalogMeta, mutedText)}>
            Showing {piDevResult.rangeStart}-{piDevResult.rangeEnd} of {piDevResult.total} · page {piDevPage} (
            <a href={piDevResult.sourceUrl} target="_blank" rel="noreferrer">
              open on pi.dev
            </a>
            )
          </div>
        )}

        <div className={capCatalogScroll}>
          {piDevBusy && <p className={mutedText}>Loading pi.dev catalog…</p>}
          {piDevErr && (
            <p className={cn(mutedText, 'mt-0 text-danger')}>
              {piDevErr}
            </p>
          )}
          {piDevResult && piDevResult.packages.length > 0 && (
            <ul className={capCatalogList}>
          {piDevResult.packages.map((row) => {
            const canonFolder = folderIdFromSpec(
              knownPackagePrimarySpec(normalizeNpmInstallSpec(row.installSpec)),
            )
            const installedOnDisk = piDevRowLoadedByCanonFolder.has(canonFolder)
            const loadedForAgent = piDevRowLoadedByCanonFolder.get(canonFolder) === true
            return (
            <li key={row.name} className={capCatalogRow}>
              <div className={capCatalogRowInner}>
                <div className={capCatalogRowBody}>
                  <div className={capCatalogRowHead}>
                    {installedOnDisk ?
                      <span
                        className={cn(capStatusDot, loadedForAgent ? capStatusDotOn : capStatusDotDisabled)}
                        title={
                          loadedForAgent ?
                            'Installed — loaded for agent'
                          : 'Installed — not in packages[] (disabled for agent)'
                        }
                        aria-label={
                          loadedForAgent ?
                            'Installed and loaded for agent'
                          : 'Installed but not loaded for agent'
                        }
                        role="img"
                      />
                    : null}
                    <span className={capCatalogName}>{row.name}</span>
                    <span className={cn(mutedText, capCatalogDl)}>
                      ~{row.downloadsMonthly.toLocaleString()} dl/mo
                    </span>
                  </div>
                  {row.types.length > 0 && (
                    <div className={capCatalogTypes}>
                      {row.types.map((t) => (
                        <span key={t} className={cn(capOrigin, "text-[0.72rem]")}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={cn(mutedText, capCatalogDesc)}>{row.description}</div>
                </div>
                <button
                  type="button"
                  className={cn(btnPrimarySm, capCatalogInstallBtn)}
                  disabled={!!installBusy || !!cardBusy}
                  title={row.installSpec}
                  onClick={() => void runInstall(row.installSpec)}
                >
                  {installBusy === row.installSpec ? 'Installing…' : 'Install'}
                </button>
              </div>
            </li>
            )
          })}
            </ul>
          )}
          {piDevResult && !piDevBusy && !piDevErr && piDevResult.packages.length === 0 && (
            <p className={mutedText}>No packages on this page.</p>
          )}
        </div>
          </div>

          <div className={capSubhead}>
            <span className={capSubheadTitle}>Install by exact spec</span>
            <span className={cn(mutedText, capSubheadHint)}>
              Use <code>npm:…</code> / <code>git:…</code> when you already know the Pi package string.
            </span>
          </div>
          <div className={capInlineForm}>
            <input
              type="text"
              className={capInlineInput}
              value={customSpec}
              onChange={(e) => setCustomSpec(e.target.value)}
              placeholder="npm:package or git:…"
            />
            <button
              type="button"
              className={btnPrimary}
              disabled={!!installBusy || !!cardBusy || !customSpec.trim()}
              onClick={() => {
                const spec = normalizeNpmInstallSpec(customSpec)
                if (!spec) return
                void (async () => {
                  setInstallBusy('__custom')
                  setInstallFlash(null)
                  try {
                    const r = await window.sylo.package.installSpec(spec, packageWorkspaceId)
                    if (r.ok) {
                      setInstallFlash(`${spec} — Pi CLI finished. Use Restart broker above when ready.`)
                      await syncCapabilitiesAfterPackageOp()
                    } else {
                      alert(`Install failed:\n${r.detail ?? '(no detail)'}`)
                    }
                  } finally {
                    setInstallBusy(null)
                  }
                })()
              }}
            >
              {installBusy === '__custom' ? 'Installing…' : 'Install'}
            </button>
          </div>
        </div>
      </details>

      <details
        className={capSection}
        open={skillsSectionOpen}
        onToggle={(e) => setSkillsSectionOpen(detailsOpenFromToggleEvent(e))}
      >
        <summary className={capSectionSummary}>
          <h2 className={capSectionSummaryTitle}>Skills</h2>
          <span className={capCount}>{skills.length}</span>
          <span className={capSectionChevron} aria-hidden="true" />
        </summary>
        <div className={capSectionBody}>
          <p className={cn(mutedText, capSectionLeadTight)}>
            Skills from your Pi agent folder, this workspace&apos;s <code>.pi/skills</code>, and installed
            packages. Optional: include this workspace&apos;s <code>.cursor/skills</code> (not other repos).{' '}
            <strong>Disable</strong> (off) hides a skill from the AI without deleting files.{' '}
            <strong>Remove</strong> deletes standalone folders from disk; package skills are removed via{' '}
            <strong>Downloaded packages → Uninstall</strong>. Click a skill name to expand and edit{' '}
            <code>SKILL.md</code> in place.
          </p>
          <div className={cn(rowHeadline, 'mb-2')}>
            <span className={rowName}>Include Cursor skills</span>
            <span className={cn(mutedText, 'font-normal')}>
              Scan <code>&lt;workspace&gt;/.cursor/skills</code>
            </span>
            <span className={rowSpacer} />
            <CapEnableSwitch
              checked={includeCursorSkills}
              disabled={includeCursorBusy}
              ariaLabel={
                includeCursorSkills ?
                  'Cursor skills included — click to hide'
                : 'Cursor skills hidden — click to include'
              }
              label={includeCursorSkills ? 'On' : 'Off'}
              onClick={() => void setIncludeCursorSkillsPref(!includeCursorSkills)}
            />
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <button type="button" className={btnGhostSm} onClick={onNewSkill}>
              + New skill
            </button>
          </div>
          {skills.length === 0 ? (
            <p className={cn(mutedText, capEmptyNote)}>No skills discovered.</p>
          ) : (
            <ul className={rowList}>
              {skillsSorted.map((s) => {
                const key = s.path || s.name
                return (
                  <SkillRowCard
                    key={key}
                    skill={s}
                    expanded={!!s.path && expandedSkillPath === s.path}
                    onToggleExpand={() => {
                      if (!s.path) return
                      setExpandedSkillPath((cur) => (cur === s.path ? null : s.path))
                    }}
                    installedFolderIds={installedFolderIds}
                    skillSurfaceLintByPath={skillSurfaceLintByPath}
                    exclusionWorkspaceId={exclusionWorkspaceId}
                    skillRemoveBusy={skillRemoveBusy}
                    onPatchExclude={(path, excluded) =>
                      void patchStandaloneExclude('skill', path, excluded)
                    }
                    onRequestRemove={(name, path) => setRemoveSkillModal({ name, path })}
                    onOpenParams={(path, name) => void openSkillParamsEditor(path, name)}
                  />
                )
              })}
            </ul>
          )}
        </div>
      </details>

      <details
        className={capSection}
        open={extensionsSectionOpen}
        onToggle={(e) => setExtensionsSectionOpen(detailsOpenFromToggleEvent(e))}
      >
        <summary className={capSectionSummary}>
          <h2 className={capSectionSummaryTitle}>Extensions</h2>
          <span className={capCount}>{extensions.length}</span>
          <span className={capSectionChevron} aria-hidden="true" />
        </summary>
        <div className={capSectionBody}>
          <p className={cn(mutedText, capSectionLeadTight)}>
            An <strong>extension</strong> is one loaded entry (often a package’s <code>index</code> file). Each extension
            registers one or more <strong>tools</strong> (individual commands the model can call). Use the header{' '}
            <strong>Enable</strong> for the whole extension, or each tool row’s <strong>Enable</strong> to hide only that
            tool (stored in <code>~/.sylo/disabled.json</code>, merged with workspace exclusions). Turning{' '}
            <strong>Enable</strong> off does not <strong>uninstall</strong> anything; use Downloaded packages →{' '}
            <strong>Uninstall</strong> to remove files from disk.
          </p>
          {extensions.length === 0 ? (
            <p className={cn(mutedText, capEmptyNote)}>
              No extensions yet. Install from the <strong>catalog</strong>, <strong>Restart broker</strong>, and they
              appear here.
            </p>
          ) : (
            <ul className={rowList}>
              {extensionsSorted.map((x) => (
                <ExtensionCapabilityCard
                  key={x.path || x.name}
                  x={x}
                  brokerOk={!!capabilities?.brokerOk}
                  hasConfigSchema={!!x.path && extensionConfigPaths.has(x.path)}
                  onConfigure={
                    x.path ?
                      () => void openExtensionConfigEditor(x.path, x.name)
                    : undefined
                  }
                  onPatchExtension={(path, excluded) => void patchStandaloneExclude('extension', path, excluded)}
                  onPatchTool={(extensionPath, toolName, excluded) =>
                    void patchToolExclude(extensionPath, toolName, excluded)
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </details>

      <details
        className={capSection}
        open={downloadedOpen}
        onToggle={(e) => setDownloadedOpen(detailsOpenFromToggleEvent(e))}
      >
        <summary className={capSectionSummary}>
          <h2 className={capSectionSummaryTitle}>Downloaded packages</h2>
          <span className={capCount}>{installedCards.length}</span>
          <span className={capSectionChevron} aria-hidden="true" />
        </summary>
        <div className={capSectionBody}>
          <p className={cn(mutedText, capSectionLeadTight)}>
            One row per package Pi has on disk. <strong>Load package for agent</strong> adds the spec to{' '}
            <code>packages[]</code> (global — broker loads the whole package). Turn it <strong>off</strong> to stop the
            broker from loading that package for the AI; files stay installed. To remove files from the machine, use{' '}
            <strong>Uninstall</strong> (<code>pi uninstall</code>). Per-skill/per-extension <strong>disable</strong>{' '}
            (hide from AI only) is under <strong>Skills</strong> and <strong>Extensions</strong> above.
          </p>
          {installedCards.length === 0 && (
            <p className={cn(mutedText, capEmptyNote)}>
              No downloaded packages yet — install from the catalog, then Restart broker.
            </p>
          )}
          {installedCards.map(({ inventory: inv, bundle }) => {
        const primary = knownPackagePrimarySpec(inv.source)
        const strip = alsoStripForPackageToggle(primary)
        const on = specsEquivalentTo(inv.source).some((x) => enabledPkgs.has(x))
        const snap = packageBundleSnapshotRef.current.get(bundle.key)
        const merged = mergeInstalledPackageBundle(
          { skills: bundle.skills, extensions: bundle.extensions },
          snap,
        )
        const liveHasAny = bundle.extensions.length > 0 || bundle.skills.length > 0
        const mergedHasAny = merged.extensions.length > 0 || merged.skills.length > 0
        let brokerStaleBanner: string | null = null
        if (!on && liveHasAny) {
          brokerStaleBanner =
            'This package is off in settings, but the broker still has it loaded. Restart broker so the agent drops it (the list updates after restart).'
        } else if (on && !liveHasAny && mergedHasAny && capabilities?.brokerOk) {
          brokerStaleBanner =
            'This package is on in settings, but the running broker has not loaded it yet. Restart broker so the agent picks it up.'
        }
        const samplePath =
          merged.extensions[0]?.row.path ??
          merged.skills[0]?.row.path ??
          inv.installedPath ??
          ''
        const originTag = packageBundleOriginFromPath(samplePath || inv.installedPath || '')
        const hint = KNOWN_PACKAGES.find(
          (k) => k.canonical === inv.source || k.aliases?.includes(inv.source),
        )?.hint
        const busy = cardBusy === inv.source
        return (
          <details
            key={inv.source}
            className={capPkgCard}
            open={pkgCardOpenBySource[inv.source] === true}
            onToggle={(e) => {
              const src = inv.source
              setPkgCardOpenBySource((p) => ({
                ...p,
                [src]: detailsOpenFromToggleEvent(e),
              }))
            }}
          >
            <summary className={capPkgCardSummary}>
              <div className={capPkgCardSummaryLead}>
                <div className={capPkgCardHeadline}>
                  <code className={capPkgCardName}>{inv.source}</code>
                  {hint ? <span className={capPkgCardHint}>{hint}</span> : null}
                </div>
              </div>
              <div className={capPkgCardSummaryTrail}>
                <OriginBadge origin={originTag} />
                <span
                  className={capPkgCardSummaryActions}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
                  }}
                >
                  <CapEnableSwitch
                    checked={on}
                    disabled={!!installBusy || busy}
                    ariaLabel={
                      on ?
                        'Package loaded for agent — click to stop loading (files stay on disk)'
                      : 'Package not loaded — click to add to packages[] for the agent'
                    }
                    label="Enable"
                    className="mr-0"
                    onClick={() =>
                      void onTogglePackage(primary, !on, strip, {
                        skillPaths: merged.skills.map(({ row }) => row.path).filter(Boolean),
                      })
                    }
                  />
                </span>
              </div>
            </summary>
            <div className={capPkgCardBody}>
              <div className={capPkgCardToolbar}>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={!!installBusy || busy}
                  onClick={() => void runUpdate(inv.source)}
                >
                  {busy ? 'Working…' : 'Update'}
                </button>
                <button
                  type="button"
                  className={btnDanger}
                  disabled={!!installBusy || busy}
                  onClick={() => void runUninstall(inv.source)}
                >
                  Uninstall
                </button>
              </div>

              {brokerStaleBanner ? (
                <div className={cn(capBanner, capBannerWarn, 'mb-2.5')}>
                  {brokerStaleBanner}
                </div>
              ) : null}

              <div className={capPkgCardMeta}>
                <span className={mutedText}>Installed at</span>
                <code className={capPath}>{inv.installedPath}</code>
              </div>

              {(merged.extensions.length > 0 || merged.skills.length > 0) ?
                <p className={cn(mutedText, capSectionLeadTight, 'mb-0 mt-2.5')}>
                  {merged.skills.length} skill(s), {merged.extensions.length} extension(s) — use{' '}
                  <strong>Skills</strong> and <strong>Extensions</strong> to disable individual items for the AI.
                </p>
              : null}

              {!mergedHasAny && (
                <p className={cn(mutedText, capPkgCardEmpty)}>
                  No skills/extensions discovered for this install yet — use <strong>Load package for agent</strong>, then{' '}
                  <strong>Restart broker</strong>.
                </p>
              )}
            </div>
          </details>
        )
      })}
        </div>
      </details>

      {capabilities?.loadErrors && capabilities.loadErrors.length > 0 && (
        <div className={cn(capBanner, capBannerError, 'mt-3')}>
          <strong>Extension load errors:</strong>
          <ul style={{ margin: '4px 0 0 16px' }}>
            {capabilities.loadErrors.map((e) => (
              <li key={e.path}>
                <code>{e.path}</code>: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      {capabilities?.brokerOk && orphanPackages.length > 0 && (
        <div className={cn(capBanner, capBannerWarn)} style={{ marginTop: 12 }}>
          <strong>Enabled in settings but no matching loaded extension:</strong>
          <ul style={{ margin: '6px 0 0 18px', padding: 0, listStyle: 'disc inside' }}>
            {orphanPackages.map((pkg) => (
              <li key={pkg} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <code>{pkg}</code>
                  <button
                    type="button"
                    className={btnGhostSm}
                    disabled={!!installBusy || !!cardBusy || installBusy === pkg}
                    onClick={() => void runInstall(pkg)}
                  >
                    {installBusy === pkg ? 'Installing…' : 'Install / repair'}
                  </button>
                </div>
                <div className={cn(mutedText, 'mt-1')}>
                  Often the package was never installed, or the extension failed to import (see errors above).
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {removeSkillModal ?
        createPortal(
          <div
            className={modalOverlay}
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setRemoveSkillModal(null)
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sylo-remove-skill-title"
              className={modalShell}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 id="sylo-remove-skill-title" className={modalTitle}>
                Remove skill?
              </h3>
              <p className={modalBody}>
                <strong>{removeSkillModal.name}</strong> will be deleted from disk. This cannot be undone.
              </p>
              <code className={cn(capSkillRowPath, 'mb-3 block break-all')}>
                {removeSkillModal.path}
              </code>
              <p className={cn(mutedText, capSectionLeadTight, 'mt-0')}>
                Package skills are removed via <strong>Downloaded packages → Uninstall</strong>.
              </p>
              <div className={modalActions}>
                <button type="button" className={btnGhost} onClick={() => setRemoveSkillModal(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={btnDanger}
                  disabled={!!skillRemoveBusy}
                  onClick={() => void confirmRemoveStandaloneSkill()}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}

      <ConfigFormModal
        open={configModal !== null}
        title={
          configModal?.kind === 'skill' ?
            `Skill params — ${configModal.title}`
          : configModal?.kind === 'extension' ?
            `Extension config — ${configModal.title}`
          : 'Configure'
        }
        subtitle={
          configModal?.kind === 'skill' ?
            'Writes params.local.json next to SKILL.md (Sylo convention).'
          : configModal?.kind === 'extension' ?
            'Writes ~/.pi/agent/extensions-config/<name>.json (from syloConfig schema sidecar).'
          : undefined
        }
        loading={configLoading}
        error={configError}
        schema={configSchema}
        values={configValues}
        onClose={closeConfigModal}
        onSave={saveConfigModal}
      />

    </div>
  )
}