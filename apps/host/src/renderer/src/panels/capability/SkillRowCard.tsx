import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { isSyloCoreAgentSkillName } from '../../../../shared/sylo-core-skills.js'
import {
  btnDanger,
  btnDangerSm,
  btnGhost,
  btnGhostSm,
  btnPrimarySm,
  capSkillEditorCard,
  capSkillEditorMeta,
  capSkillEditorToolbar,
  capSkillRow,
  capSkillRowActions,
  capSkillRowExpandBtn,
  capSkillRowLine,
  capSkillRowLinePath,
  capSkillRowPath,
  capSkillRowTitleName,
  modalActions,
  modalBody,
  modalOverlay,
  modalShell,
  input,
  modalTitle,
  mutedText,
  textarea,
} from '../ui-classes'
import { CapEnableSwitch, OriginBadge, SkillSurfaceLintNotes } from './badges'
import { isStandaloneSkill } from './helpers'

type SkillRow = CapabilitiesView['skills'][number]

type MdDraft = {
  content: string
  savedContent: string
  editable: boolean
  isCoreSyloSkill: boolean
  loading: boolean
  error: string | null
}

export function SkillRowCard({
  skill,
  expanded,
  onToggleExpand,
  installedFolderIds,
  skillSurfaceLintByPath,
  exclusionWorkspaceId,
  skillRemoveBusy,
  onPatchExclude,
  onRequestRemove,
  onOpenParams,
}: {
  skill: SkillRow
  expanded: boolean
  onToggleExpand: () => void
  installedFolderIds: Set<string>
  skillSurfaceLintByPath: Record<string, SkillSurfaceLintReport>
  exclusionWorkspaceId: string
  skillRemoveBusy: string | null
  onPatchExclude: (path: string, excluded: boolean) => void | Promise<void>
  onRequestRemove: (name: string, path: string) => void
  onOpenParams: (path: string, name: string) => void
}): React.ReactElement {
  const path = skill.path?.trim() ?? ''
  const removable = isStandaloneSkill(skill, installedFolderIds)
  const lint = path ? skillSurfaceLintByPath[path] : undefined
  const hasParams = !!lint?.hasParamsSchema

  const [draft, setDraft] = useState<MdDraft | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [coreSaveModal, setCoreSaveModal] = useState<
    | null
    | { step: 'warn' }
    | { step: 'confirm'; typed: string }
  >(null)

  const workspaceId = exclusionWorkspaceId.trim() || undefined
  const dirty = draft != null && draft.content !== draft.savedContent

  const loadMd = useCallback(async () => {
    if (!path) return
    setDraft((prev) => ({
      content: prev?.content ?? '',
      savedContent: prev?.savedContent ?? '',
      editable: prev?.editable ?? false,
      isCoreSyloSkill: prev?.isCoreSyloSkill ?? isSyloCoreAgentSkillName(skill.name),
      loading: true,
      error: null,
    }))
    const r = await window.sylo.capabilities.skillMdGet(path, workspaceId)
    if (!r.ok) {
      setDraft({
        content: '',
        savedContent: '',
        editable: false,
        isCoreSyloSkill: isSyloCoreAgentSkillName(skill.name),
        loading: false,
        error: r.error,
      })
      return
    }
    setDraft({
      content: r.content,
      savedContent: r.content,
      editable: r.editable,
      isCoreSyloSkill: r.isCoreSyloSkill,
      loading: false,
      error: null,
    })
  }, [path, skill.name, workspaceId])

  useEffect(() => {
    if (!expanded || !path) return
    void loadMd()
  }, [expanded, path, loadMd])

  const persistMd = async (confirmCoreSyloEdit: boolean) => {
    if (!path || !draft?.editable) return
    setSaveBusy(true)
    setSaveNotice(null)
    try {
      const r = await window.sylo.capabilities.skillMdSave(
        path,
        draft.content,
        workspaceId,
        confirmCoreSyloEdit,
      )
      if (!r.ok) {
        setSaveNotice(r.error)
        return
      }
      setDraft((d) =>
        d ?
          { ...d, savedContent: d.content, error: null }
        : d,
      )
      setSaveNotice('SKILL.md saved.')
      setCoreSaveModal(null)
    } finally {
      setSaveBusy(false)
    }
  }

  const requestSave = () => {
    if (!draft?.editable || !dirty) return
    if (draft.isCoreSyloSkill) {
      setCoreSaveModal({ step: 'warn' })
      return
    }
    void persistMd(false)
  }

  const discardEdits = () => {
    setDraft((d) => (d ? { ...d, content: d.savedContent } : d))
    setSaveNotice(null)
  }

  return (
    <li className={capSkillRow}>
      <div className={capSkillRowLine}>
        <button
          type="button"
          className={capSkillRowExpandBtn}
          aria-expanded={expanded}
          disabled={!path}
          onClick={onToggleExpand}
        >
          <span className="w-3 shrink-0 text-center text-[0.7rem] text-text-secondary" aria-hidden="true">
            {expanded ? '▼' : '▶'}
          </span>
          <span className={capSkillRowTitleName}>{skill.name}</span>
          <OriginBadge origin={skill.origin} />
          {draft?.isCoreSyloSkill ?
            <span className="rounded border border-[rgb(255_193_107/0.35)] bg-[rgb(255_193_107/0.08)] px-1.5 py-0.5 text-[0.68rem] text-[rgb(255_210_140)]">
              Core Sylo
            </span>
          : null}
        </button>
        {path ?
          <>
            <code className={capSkillRowLinePath}>{path}</code>
            <div className={capSkillRowActions}>
              {hasParams ?
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => onOpenParams(path, skill.name)}
                >
                  Edit params…
                </button>
              : null}
              <CapEnableSwitch
                checked={!skill.excludedFromAgent}
                disabled={!path.trim() || skillRemoveBusy === path}
                ariaLabel={
                  skill.excludedFromAgent ?
                    'Disabled — click to enable for the agent'
                  : 'Enabled — click to disable for the agent'
                }
                label="Enable"
                className="shrink-0 self-center"
                onClick={() => void onPatchExclude(path, !skill.excludedFromAgent)}
              />
              {removable ?
                <button
                  type="button"
                  className={btnDangerSm}
                  disabled={!!skillRemoveBusy || skillRemoveBusy === path}
                  onClick={() => onRequestRemove(skill.name, path)}
                >
                  {skillRemoveBusy === path ? 'Removing…' : 'Remove'}
                </button>
              : null}
            </div>
          </>
        : null}
      </div>

      {expanded && path ?
        <div className={capSkillEditorCard}>
          {draft?.loading ?
            <p className={cn(mutedText, 'm-0')}>Loading SKILL.md…</p>
          : draft?.error ?
            <p className="m-0 text-[0.82rem] text-danger">{draft.error}</p>
          : (
            <>
              <div className={capSkillEditorToolbar}>
                <span className={capSkillEditorMeta}>
                  {draft?.editable ?
                    'SKILL.md'
                  : 'Read-only (installed package or out-of-scope path)'}
                </span>
                <span className="flex-1" />
                {draft?.editable ?
                  <>
                    <button
                      type="button"
                      className={btnGhostSm}
                      disabled={!dirty || saveBusy}
                      onClick={discardEdits}
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      className={btnPrimarySm}
                      disabled={!dirty || saveBusy}
                      onClick={requestSave}
                    >
                      {saveBusy ? 'Saving…' : 'Save SKILL.md'}
                    </button>
                  </>
                : (
                  <button
                    type="button"
                    className={btnGhostSm}
                    onClick={() => void window.sylo.shell.openSkillFile(path)}
                  >
                    Open in editor…
                  </button>
                )}
              </div>
              <textarea
                className={textarea}
                value={draft?.content ?? ''}
                readOnly={!draft?.editable}
                spellCheck={false}
                aria-label={`SKILL.md for ${skill.name}`}
                onChange={(e) => {
                  const v = e.target.value
                  setDraft((d) => (d ? { ...d, content: v } : d))
                  setSaveNotice(null)
                }}
              />
              {saveNotice ?
                <p className={cn(mutedText, 'mt-2 mb-0 text-[0.78rem]')}>{saveNotice}</p>
              : null}
              {draft?.isCoreSyloSkill && draft.editable ?
                <p className={cn(mutedText, 'mt-2 mb-0 text-[0.74rem]')}>
                  Core Sylo authoring skills affect extension/skill scaffolding. Saving requires two confirmations.
                </p>
              : null}
            </>
          )}
        </div>
      : null}

      <SkillSurfaceLintNotes path={path} lintByPath={skillSurfaceLintByPath} />

      {coreSaveModal ?
        createPortal(
          <div
            className={modalOverlay}
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setCoreSaveModal(null)
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sylo-core-skill-save-title"
              className={modalShell}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 id="sylo-core-skill-save-title" className={modalTitle}>
                {coreSaveModal.step === 'warn' ?
                  'Edit core Sylo skill?'
                : 'Confirm save'}
              </h3>
              {coreSaveModal.step === 'warn' ?
                <p className={modalBody}>
                  <strong>{skill.name}</strong> is a core Sylo authoring skill. Changes can break skill/extension
                  scaffolding for the whole install. Continue only if you intend to modify Sylo itself.
                </p>
              : (
                <>
                  <p className={modalBody}>
                    Type <strong>{skill.name}</strong> below to confirm you want to overwrite this SKILL.md.
                  </p>
                  <input
                    className={input}
                    value={coreSaveModal.typed}
                    autoFocus
                    spellCheck={false}
                    aria-label={`Type ${skill.name} to confirm`}
                    onChange={(e) => setCoreSaveModal({ step: 'confirm', typed: e.target.value })}
                  />
                </>
              )}
              <div className={modalActions}>
                <button type="button" className={btnGhost} onClick={() => setCoreSaveModal(null)}>
                  Cancel
                </button>
                {coreSaveModal.step === 'warn' ?
                  <button
                    type="button"
                    className={btnDanger}
                    onClick={() => setCoreSaveModal({ step: 'confirm', typed: '' })}
                  >
                    I understand — continue
                  </button>
                : (
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={
                      saveBusy ||
                      coreSaveModal.typed.trim().toLowerCase() !== skill.name.trim().toLowerCase()
                    }
                    onClick={() => void persistMd(true)}
                  >
                    {saveBusy ? 'Saving…' : 'Save anyway'}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}
    </li>
  )
}
