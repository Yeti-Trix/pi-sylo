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
    bundleFolderBasename,
  bundleItemFolderFromPath,
  packageBundleOriginFromPath,
  specsEquivalentTo,
  type PackageBundleSlice,
} from './helpers'

/**
 * Compare skill paths in the renderer. The shared `normalizeSkillCapabilityPath` cannot be
 * used here because it imports `node:path`, so match the parts that matter for comparison:
 * separator style, a trailing `SKILL.md`, and case (Windows paths are case-insensitive).
 */
function skillPathKey(p: string): string {
  const s = (typeof p === 'string' ? p : '').trim().replace(/\\/g, '/')
  if (!s) return ''
  return s
    .replace(/\/SKILL\.md$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

// ── Catalog row (shared by the pinned sylo-* strip and the main pi.dev list) ─

type CatalogRow = {
  name: string
  description: string
  installSpec: string
  types: string[]
  downloadsMonthly: number
  publishedMs: number
}

function CatalogRowLi({
  row,
  installedOnDisk,
  loadedForAgent,
  installBusy,
  cardBusy,
  onInstall,
  syloBadge,
}: {
  row: CatalogRow
  installedOnDisk: boolean
  loadedForAgent: boolean
  installBusy: string | null
  cardBusy: string | null
  onInstall: (spec: string) => void
  syloBadge?: boolean
}): React.ReactElement {
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
            {syloBadge ? <span className={cn(capOrigin, 'text-[0.72rem]')}>Sylo</span> : null}
            <span className={cn(mutedText, capCatalogDl)}>
              ~{row.downloadsMonthly.toLocaleString()} dl/mo
            </span>
          </div>
          {row.types.length > 0 && (
            <div className={capCatalogTypes}>
              {row.types.map((t) => (
                <span key={t} className={cn(capOrigin, 'text-[0.72rem]')}>
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
          onClick={() => onInstall(row.installSpec)}
        >
          {installBusy === row.installSpec ? 'Installing…' : 'Install'}
        </button>
      </div>
    </li>
  )
}

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
  /** Normalized skill paths pinned inline into this workspace's system prompt. */
  const [pinnedSkillPaths, setPinnedSkillPaths] = useState<Set<string>>(() => new Set())
  const [expandedSkillPath, setExpandedSkillPath] = useState<string | null>(null)
  const [extensionsSectionOpen, setExtensionsSectionOpen] = useState(false)
  // Personal packages (moved Downloaded-packages card) is the primary inventory surface — keep this section expanded by default;
  // individual package rows below stay collapsed until opened.
  const [downloadedOpen, setDownloadedOpen] = useState(true)
  /** Tracks open state for each Personal-packages row (<details>). */
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
    syloPinned?: {
      name: string
      description: string
      installSpec: string
      types: string[]
      downloadsMonthly: number
      publishedMs: number
    }[]
  } | null>(null)
  const [piDevBusy, setPiDevBusy] = useState(false)
  const [piDevErr, setPiDevErr] = useState<string | null>(null)
  // Host-plugin packages discovered by the Sylo loader (Phase 2 unified cards —
  // shows both kinds: bundled toggles above, installed host plugins here).
  const [hostPlugins, setHostPlugins] = useState<
    {
      id: string
      source: 'local' | 'npm' | 'legacy'
      dir: string
      name: string
      version: string | null
      description: string | null
      entryPresent: boolean
      loaded: boolean
    }[]
  >([])
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

  // Host-plugin inventory (read-only). Refetch whenever the panel refreshes so
  // newly installed/uninstalled host plugins show up.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await window.sylo.personal.hostPlugins()
        if (!cancelled && Array.isArray(list)) setHostPlugins(list)
      } catch {
        /* inventory is advisory — never block the panel */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onRefresh])

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

  /** Matches pi.dev catalog rows to the Personal packages inventory (canonical id + KNOWN_PACKAGES aliases). */
  const piDevRowLoadedByCanonFolder = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const inv of installedInventoryRows) {
      const key = folderIdFromSpec(knownPackagePrimarySpec(inv.source))
      const on = specsEquivalentTo(inv.source).some((x) => enabledPkgs.has(x))
      m.set(key, m.get(key) === true || on)
    }
    return m
  }, [installedInventoryRows, enabledPkgs])

    /**
   * Individual package slices per installed inventory entry. npm/git packages group
   * by their package id (node_modules | npm | git mirror segment); local-path bundles
   * group by monorepo sub-package (…/packages/<id>/…) or fall back to the bundle
   * folder name — so each individual package can get its own card.
   */
  const bundleItemsBySource = useMemo(() => {
    const bySource = new Map<string, Map<string, PackageBundleSlice>>()

    const itemKeyFor = (p: string, inv: (typeof installedInventoryRows)[number]): string =>
      bundleItemFolderFromPath(p) ?? bundleFolderBasename(inv.installedPath || '', inv.source)

    const ownerFor = (
      p: string,
    ): { inv: (typeof installedInventoryRows)[number]; itemKey: string } | null => {
      const norm = p.replace(/\\/g, '/')
      const lower = norm.toLowerCase()
      const npmFolder = npmPackageFolderFromPath(norm)
      let best: {
        inv: (typeof installedInventoryRows)[number]
        depth: number
        itemKey: string
      } | null = null
      for (const inv of installedInventoryRows) {
        // Local-path packages load in place — a row belongs to the deepest install root it sits under.
        if (inv.installedPath) {
          const root = inv.installedPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
          if (root && lower.startsWith(root + '/')) {
            const cand = { inv, depth: root.split('/').length, itemKey: itemKeyFor(norm, inv) }
            if (!best || cand.depth > best.depth) best = cand
            continue
          }
        }
        if (!best && npmFolder && folderIdFromSpec(inv.source).toLowerCase() === npmFolder.toLowerCase()) {
          best = { inv, depth: 0, itemKey: npmFolder }
        }
      }
      return best ? { inv: best.inv, itemKey: best.itemKey } : null
    }

    const bump = (source: string, itemKey: string): PackageBundleSlice => {
      let items = bySource.get(source)
      if (!items) {
        items = new Map<string, PackageBundleSlice>()
        bySource.set(source, items)
      }
      let slice = items.get(itemKey)
      if (!slice) {
        slice = { skills: [], extensions: [] }
        items.set(itemKey, slice)
      }
      return slice
    }

    for (const s of skills) {
      const o = ownerFor(s.path)
      if (!o) continue
      bump(o.inv.source, o.itemKey).skills.push(s)
    }
    for (const x of extensions) {
      const o = ownerFor(x.path)
      if (!o) continue
      bump(o.inv.source, o.itemKey).extensions.push(x)
    }

    for (const items of bySource.values()) {
      for (const slice of items.values()) {
        slice.skills.sort((a, c) => a.name.localeCompare(c.name))
        slice.extensions.sort((a, c) => a.name.localeCompare(c.name))
      }
    }

    return bySource
  }, [skills, extensions, installedInventoryRows])

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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await window.sylo.capabilities.pinnedSkills.get(exclusionWorkspaceId || undefined)
      if (cancelled) return
      setPinnedSkillPaths(new Set((r.ok ? r.paths : []).map(skillPathKey)))
    })()
    return () => {
      cancelled = true
    }
  }, [exclusionWorkspaceId])

  const togglePinnedSkill = async (path: string, pinned: boolean) => {
    const r = await window.sylo.capabilities.pinnedSkills.set(
      exclusionWorkspaceId || undefined,
      path,
      pinned,
    )
    if (!r.ok) {
      setExcludeAgentNotice(`Could not update pinned skills: ${r.error}`)
      return
    }
    setPinnedSkillPaths(new Set(r.paths.map(skillPathKey)))
    setExcludeAgentNotice(
      pinned ?
        'Skill pinned — its full SKILL.md is now added to the system prompt every turn. Applies on the next message.'
      : 'Skill unpinned — it stays available as a pointer the agent can read on demand. Applies on the next message.',
    )
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

    /** Last non-empty broker snapshot per individual package — keeps rows visible after unload until broker restart. */
  const packageBundleSnapshotRef = useRef<Map<string, PackageBundleSlice>>(new Map())

  /**
   * One card per individual package: monorepo sub-packages (e.g. sylo-tools-controls's
   * packages/sylo-allen-bradley, sylo-fieldbrain, …) each get their own card; single
   * packages keep one card titled by their folder. Enable/Update/Uninstall stay
   * bundle-level — Pi loads and removes the whole packages[] spec.
   */
  const installedItemCards = useMemo(() => {
    const cards: {
      cardKey: string
      inv: (typeof installedInventoryRows)[number]
      title: string
      titleHint: string | null
      originTag: CapabilityOrigin
      siblingCount: number
      bundleLabel: string
      brokerStaleBanner: string | null
      merged: ReturnType<typeof mergeInstalledPackageBundle>
      on: boolean
    }[] = []
    for (const inv of installedInventoryRows) {
      const primary = knownPackagePrimarySpec(inv.source)
      const on = specsEquivalentTo(inv.source).some((x) => enabledPkgs.has(x))
      const liveItems = bundleItemsBySource.get(inv.source) ?? new Map<string, PackageBundleSlice>()
      // Union live item keys with snapshot keys recorded for this source.
      const snapPrefix = `${inv.source}::`
      const itemKeys = new Set<string>(liveItems.keys())
      for (const key of packageBundleSnapshotRef.current.keys()) {
        if (key.startsWith(snapPrefix)) itemKeys.add(key.slice(snapPrefix.length))
      }
      const bundleLabel = bundleFolderBasename(inv.installedPath || '', inv.source)
      let liveHasAny = false
      let mergedHasAny = false
      const mergedByKey = new Map<string, ReturnType<typeof mergeInstalledPackageBundle>>()
      for (const itemKey of itemKeys) {
        const live = liveItems.get(itemKey) ?? { skills: [], extensions: [] }
        const merged = mergeInstalledPackageBundle(
          live,
          packageBundleSnapshotRef.current.get(`${inv.source}::${itemKey}`),
        )
        mergedByKey.set(itemKey, merged)
        if (live.skills.length > 0 || live.extensions.length > 0) liveHasAny = true
        if (merged.skills.length > 0 || merged.extensions.length > 0) mergedHasAny = true
      }
      const brokerStaleBanner =
        !on && liveHasAny
          ? 'This package is off in settings, but the broker still has it loaded. Restart broker so the agent drops it (the list updates after restart).'
          : on && !liveHasAny && mergedHasAny && capabilities?.brokerOk
            ? 'This package is on in settings, but the running broker has not loaded it yet. Restart broker so the agent picks it up.'
            : null
      const knHint =
        KNOWN_PACKAGES.find((k) => k.canonical === inv.source || k.aliases?.includes(inv.source))?.hint ?? null
      if (itemKeys.size === 0) {
        // Nothing discovered yet — single card for the bundle itself.
        cards.push({
          cardKey: `${inv.source}::self`,
          inv,
          title: bundleLabel,
          titleHint: knHint,
          originTag: packageBundleOriginFromPath(inv.installedPath || inv.source),
          siblingCount: 1,
          bundleLabel: inv.source,
          brokerStaleBanner,
          merged: { skills: [], extensions: [] },
          on,
        })
        continue
      }
      for (const [itemKey, merged] of mergedByKey) {
        const samplePath =
          merged.extensions[0]?.row.path ?? merged.skills[0]?.row.path ?? inv.installedPath ?? ''
        cards.push({
          cardKey: `${inv.source}::${itemKey}`,
          inv,
          title: itemKey,
          titleHint: itemKeys.size > 1 ? `part of ${bundleLabel}` : knHint,
          originTag: packageBundleOriginFromPath(samplePath || inv.installedPath || ''),
          siblingCount: itemKeys.size,
          bundleLabel,
          brokerStaleBanner,
          merged,
          on,
        })
      }
    }
    return cards
    // packageBundleSnapshotRef is intentionally read without being a dep — the snapshot
    // effect fills it right after render, same timing as the previous per-bundle behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installedInventoryRows, bundleItemsBySource, enabledPkgs, capabilities?.brokerOk])

  // Fill the snapshot right after render so the next refresh (e.g. after a broker
  // restart unloads a package) still shows the last-known rows until the broker
  // reflects the change.
  useEffect(() => {
    const snap = packageBundleSnapshotRef.current
    for (const [source, items] of bundleItemsBySource) {
      for (const [itemKey, b] of items) {
        if (b.extensions.length > 0 || b.skills.length > 0) {
          snap.set(`${source}::${itemKey}`, {
            skills: b.skills.map((s) => ({ ...s })),
            extensions: b.extensions.map((e) => ({
              ...e,
              tools: e.tools.map((t) => ({ ...t })),
              commandNames: [...e.commandNames],
            })),
          })
        }
      }
    }
  }, [bundleItemsBySource])

  // Auto-expand the Personal packages section when there are cards (section is at the page
  // bottom; operator usually wants to see inventory without another click).
  useEffect(() => {
    if (installedItemCards.length > 0) setDownloadedOpen(true)
  }, [installedItemCards.length])

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
        } else if (builtinExtKind === 'ask-question' && excluded) {
          setExcludeAgentNotice(
            `Built-in sylo-ask-question disabled. In-chat multiple-choice questions will be unavailable. ${restartNote}`,
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
        } else if (builtinExtKind === 'ask-question' && excluded) {
          setExcludeAgentNotice(
            `Built-in sylo-ask-question disabled. In-chat multiple-choice questions will be unavailable. ${restartNote}`,
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
        <strong>{exclusionWorkspaceName}</strong>. <strong>Load package for agent</strong> on Personal packages stays
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

      <details
        className={capSection}
        open={downloadedOpen}
        onToggle={(e) => setDownloadedOpen(detailsOpenFromToggleEvent(e))}
      >
        <summary className={capSectionSummary}>
          <h2 className={capSectionSummaryTitle}>Personal packages</h2>
          <span className={capCount}>{installedItemCards.length}</span>
          <span className={capSectionChevron} aria-hidden="true" />
        </summary>
        <div className={capSectionBody}>
          <p className={cn(mutedText, capSectionLeadTight)}>
            Pi packages <strong>you installed yourself</strong> (npm, git, or a local path like the{' '}
            <code>sylo-tools-*</code> bundles) — loaded <strong>in every workspace</strong> at broker start.{' '}
            <strong>Load package for agent</strong> adds the spec to <code>packages[]</code> (global — broker loads the
            whole package). Turn it <strong>off</strong> to stop the broker from loading that package for the AI; files
            stay installed. To remove files from the machine, use <strong>Uninstall</strong> (<code>pi uninstall</code>);
            restart the broker after either. Per-skill/per-extension <strong>disable</strong> (hide from AI only) is
            under <strong>Skills</strong> and <strong>Extensions</strong> above.
          </p>
          {hostPlugins.length > 0 && (
            <div className="mb-3">
              <div className={capSubhead}>
                <span className={capSubheadTitle}>Sylo host plugins</span>
                <span className={cn(mutedText, capSubheadHint)}>
                  Loaded by the Sylo app itself — Settings cards, phone-app tabs, RPC tools. Always on while
                  installed; no toggle needed.
                </span>
              </div>
              <ul className={rowList}>
                {hostPlugins.map((p) => (
                  <li key={p.id} className={capSkillRow}>
                    <div className={rowHeadline}>
                      <span
                        className={cn(
                          capStatusDot,
                          p.loaded && p.entryPresent ? capStatusDotOn : capStatusDotDisabled,
                        )}
                        title={
                          p.loaded && p.entryPresent ?
                            'Loaded into the Sylo host'
                          : 'Discovered but not loaded (restart broker/Sylo)'
                        }
                        aria-label={p.loaded && p.entryPresent ? 'Loaded' : 'Not loaded'}
                        role="img"
                      />
                      <code className={capPkgCardName}>{p.id}</code>
                      <span className={capPkgCardHint}>{p.version ? `v${p.version}` : p.name}</span>
                      <span className={rowSpacer} />
                      <OriginBadge origin={p.source === 'npm' ? 'npm-package' : 'sylo-repo'} />
                    </div>
                    {p.description ? <p className={cn(mutedText, 'mt-1 text-sm')}>{p.description}</p> : null}
                    <p className={cn(mutedText, 'mt-1 text-xs')}>{p.dir}</p>
                    {!p.entryPresent ?
                      <p className={cn(mutedText, 'mt-1 text-xs text-danger')}>
                        Host entry missing on disk — cannot load.
                      </p>
                    : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {installedItemCards.length === 0 && (
            <p className={cn(mutedText, capEmptyNote)}>
              No packages installed yet — install from the catalog below, then Restart broker.
            </p>
          )}
                    {installedItemCards.map(
            ({ cardKey, inv, title, titleHint, originTag, siblingCount, bundleLabel, brokerStaleBanner, merged, on }) => {
        const primary = knownPackagePrimarySpec(inv.source)
        const strip = alsoStripForPackageToggle(primary)
        const busy = cardBusy === inv.source
        const mergedHasAny = merged.extensions.length > 0 || merged.skills.length > 0
        return (
                    <details
            key={cardKey}
            className={capPkgCard}
            open={pkgCardOpenBySource[cardKey] === true}
            onToggle={(e) => {
              setPkgCardOpenBySource((p) => ({
                ...p,
                [cardKey]: detailsOpenFromToggleEvent(e),
              }))
            }}
          >
            <summary className={capPkgCardSummary}>
              <div className={capPkgCardSummaryLead}>
                <div className={capPkgCardHeadline}>
                  <code className={capPkgCardName}>{title}</code>
                  {titleHint ? <span className={capPkgCardHint}>{titleHint}</span> : null}
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
                  title={
                    siblingCount > 1 ?
                      `Removes the whole ${bundleLabel} bundle (${siblingCount} packages)` :
                      undefined
                  }
                  onClick={() => void runUninstall(inv.source)}
                >
                  {siblingCount > 1 ? `Uninstall bundle (${siblingCount})` : 'Uninstall'}
                </button>
              </div>

              {brokerStaleBanner ? (
                <div className={cn(capBanner, capBannerWarn, 'mb-2.5')}>
                  {brokerStaleBanner}
                </div>
              ) : null}

                            <div className={capPkgCardMeta}>
                <span className={mutedText}>{siblingCount > 1 ? 'Bundle' : 'Installed at'}</span>
                <code className={capPath}>{siblingCount > 1 ? inv.source : inv.installedPath}</code>
              </div>

              {mergedHasAny ?
                <>
                  <p className={cn(mutedText, capSectionLeadTight, 'mb-0 mt-2.5')}>
                    {merged.skills.length} skill(s), {merged.extensions.length} extension(s)
                    {siblingCount > 1 ? ` — part of the ${bundleLabel} bundle` : ''} — use{' '}
                    <strong>Skills</strong> and <strong>Extensions</strong> to disable individual items for the AI.
                  </p>
                  {merged.skills.length > 0 ?
                    <p className={cn(mutedText, 'mt-1.5 text-xs')}>
                      Skills:{' '}
                      {merged.skills.map(({ row }) => (
                        <code key={row.path} className="mr-2">
                          {row.name}
                        </code>
                      ))}
                    </p>
                  : null}
                  {merged.extensions.length > 0 ?
                    <p className={cn(mutedText, 'mt-1 text-xs')}>
                      Extensions:{' '}
                      {merged.extensions.map(({ row }) => (
                        <code key={row.path} className="mr-2">
                          {row.name}
                        </code>
                      ))}
                    </p>
                  : null}
                </>
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
            above so installs show up; a <strong>Personal packages</strong> card appears below once Pi sees them on
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
          {(() => {
            const syloPinned = piDevResult?.syloPinned ?? []
            if (syloPinned.length === 0) return null
            return (
              <div className="mb-3">
                <div className={capSubhead}>
                  <span className={capSubheadTitle}>Sylo packages</span>
                  <span className={cn(mutedText, capSubheadHint)}>
                    First-party <code>sylo-*</code> packages pinned above the pi.dev ranking.
                  </span>
                </div>
                <ul className={capCatalogList}>
                  {syloPinned.map((row) => {
                    const canonFolder = folderIdFromSpec(
                      knownPackagePrimarySpec(normalizeNpmInstallSpec(row.installSpec)),
                    )
                    return (
                      <CatalogRowLi
                        key={`sylo-pinned-${row.name}`}
                        row={row}
                        installedOnDisk={piDevRowLoadedByCanonFolder.has(canonFolder)}
                        loadedForAgent={piDevRowLoadedByCanonFolder.get(canonFolder) === true}
                        installBusy={installBusy}
                        cardBusy={cardBusy}
                        onInstall={runInstall}
                        syloBadge
                      />
                    )
                  })}
                </ul>
              </div>
            )
          })()}
          {piDevResult && piDevResult.packages.length > 0 && (
            <ul className={capCatalogList}>
              {piDevResult.packages.map((row) => {
                const canonFolder = folderIdFromSpec(
                  knownPackagePrimarySpec(normalizeNpmInstallSpec(row.installSpec)),
                )
                const installedOnDisk = piDevRowLoadedByCanonFolder.has(canonFolder)
                const loadedForAgent = piDevRowLoadedByCanonFolder.get(canonFolder) === true
                return (
                  <CatalogRowLi
                    key={row.name}
                    row={row}
                    installedOnDisk={installedOnDisk}
                    loadedForAgent={loadedForAgent}
                    installBusy={installBusy}
                    cardBusy={cardBusy}
                    onInstall={runInstall}
                  />
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
            <strong>Personal packages → Uninstall</strong>. Click a skill name to expand and edit{' '}
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
                    pinned={pinnedSkillPaths.has(skillPathKey(s.path ?? ''))}
                    onTogglePin={(path, pinned) => void togglePinnedSkill(path, pinned)}
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
            <strong>Enable</strong> off does not <strong>uninstall</strong> anything; use Personal packages →{' '}
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
                Package skills are removed via <strong>Personal packages → Uninstall</strong>.
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