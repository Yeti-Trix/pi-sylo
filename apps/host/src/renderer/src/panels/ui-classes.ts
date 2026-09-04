/** Shared Tailwind class strings for settings-style panels. */

import { cn } from '../lib/cn'



export const mutedText = 'text-text-secondary'



export const leadText =

  'mb-3 text-[0.85rem] leading-[1.45] text-text-secondary'



export const card = 'rounded-lg border border-border bg-bg-secondary px-3.5 py-3'



export const cardTitle = 'mb-1.5 text-[0.95rem] font-semibold'



export const fieldLabel = 'block text-[0.78rem] text-text-secondary'



const fieldControl =

  'box-border w-full rounded-md border border-border bg-bg-primary px-2.5 py-2 text-[0.85rem] text-text-primary transition-[border-color,box-shadow] duration-[120ms] focus:border-accent/55 focus:shadow-[0_0_0_3px_rgb(107_159_255/0.18)] focus:outline-none'



export const input = fieldControl

export const textarea = `${fieldControl} min-h-[12rem] resize-y font-mono text-[0.8rem] leading-[1.45]`

export const select = fieldControl



const btnGhostBase =

  'cursor-pointer rounded-md border border-border bg-bg-tertiary text-text-primary transition-[border-color,background] duration-[120ms] hover:border-accent/50 hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-50'



export const btnGhost = `${btnGhostBase} px-3 py-1.5 text-[0.82rem]`



export const btnGhostSm = `${btnGhostBase} px-2.5 py-1 text-[0.78rem]`



export const btnSm = 'px-2.5 py-1 text-[0.78rem]'



export const btnPrimary =

  'cursor-pointer rounded-md border border-accent/50 bg-accent/16 px-3.5 py-2 text-[0.85rem] text-text-primary transition-[background,border-color] duration-[120ms] hover:border-accent/70 hover:bg-accent/26 disabled:cursor-not-allowed disabled:opacity-50'



export const btnPrimarySm = `${btnPrimary} px-2.5 py-1 text-[0.78rem] font-semibold`



const btnDangerBase =

  'cursor-pointer rounded-md border border-[rgb(255_107_107/0.4)] bg-[rgb(255_107_107/0.06)] text-[rgb(255_152_152)] transition-[border-color,background] duration-[120ms] hover:border-[rgb(255_107_107/0.6)] hover:bg-[rgb(255_107_107/0.14)] disabled:cursor-not-allowed disabled:opacity-50'



export const btnDanger = `${btnDangerBase} px-3 py-1.5 text-[0.82rem]`



export const btnDangerSm = `${btnDangerBase} px-2.5 py-1 text-[0.78rem]`



export const rowList = 'm-0 flex list-none flex-col gap-2 p-0'



export const rowItem = 'rounded-lg border border-border bg-bg-primary px-3 py-2.5'



export const rowHeadline = 'flex flex-wrap items-center gap-2'



export const rowName = 'text-[0.88rem] font-semibold'



export const rowSpacer =

  'min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-[0.74rem] text-text-secondary'



export const rowAction = 'ml-auto shrink-0'



export const errorText = 'm-0 text-[0.85rem] text-danger'



/** Capability manager — layout */

export const capManager = 'max-w-[920px] max-[720px]:max-w-none'



export const capSectionTitle = 'mb-1.5 mt-6 text-base font-semibold first:mt-0'



export const capActions = 'mb-2 flex flex-wrap gap-2'



export const capSection = 'group mt-4'



export const capSectionSummary =

  'flex cursor-pointer list-none items-center gap-3 rounded-[10px] border border-border bg-bg-secondary px-3.5 py-2.5 transition-[border-color,background] duration-[120ms] hover:border-accent/32 hover:bg-bg-tertiary focus-visible:border-accent/60 focus-visible:shadow-[0_0_0_3px_rgb(107_159_255/0.18)] focus-visible:outline-none group-open:rounded-b-none group-open:border-b-transparent [&::-webkit-details-marker]:hidden [&::marker]:content-none'



export const capSectionSummaryTitle =

  'm-0 flex-[1_1_auto] text-[0.95rem] font-semibold tracking-normal text-text-primary'



export const capSectionChevron =

  'mr-1 h-2 w-2 shrink-0 rotate-[-45deg] border-b-2 border-r-2 border-text-secondary transition-transform duration-[180ms] group-open:rotate-45'



export const capSectionBody =

  'rounded-b-[10px] border border-t-0 border-border bg-bg-primary p-3.5'



export const capSectionLeadTight = leadText



export const capCount =

  'inline-block min-w-5 rounded-full border border-border bg-bg-tertiary px-[7px] py-px text-center text-[0.7rem] font-semibold tracking-normal text-text-secondary'



export const capBanner = 'my-1 mb-3 rounded-md px-2.5 py-2 text-[0.82rem] leading-[1.4]'



export const capBannerWarn =

  'border border-[rgb(255_196_0/0.35)] bg-[rgb(255_196_0/0.08)] text-text-primary'



export const capBannerError =

  'border border-[rgb(255_107_107/0.35)] bg-[rgb(255_107_107/0.08)] text-text-primary'



export const capEmptyNote =

  'my-2 mb-3 rounded-md border border-dashed border-accent/28 bg-accent/[0.04] px-3 py-2.5'



export const capSubhead = 'mt-[18px] flex flex-wrap items-baseline gap-x-3 gap-y-1.5'



export const capSubheadTitle = 'text-[0.88rem] font-semibold'



export const capSubheadHint = 'text-[0.78rem] text-text-secondary'



export const capInlineForm = 'mt-2 flex flex-wrap items-center gap-2'



export const capInlineInput = `${input} min-w-[180px] flex-[1_1_220px] w-auto`



export const capField = 'flex min-w-[140px] flex-col gap-1'



export const capFieldGrow = 'flex-[1_1_220px]'



/** Catalog */

export const capCatalogCard =

  'mt-3 overflow-hidden rounded-lg border border-border bg-bg-secondary'



export const capCatalogToolbar =

  'flex flex-wrap items-end gap-3 border-b border-border bg-bg-primary p-3 max-[720px]:flex-col max-[720px]:items-stretch'



export const capCatalogToolbarLabel = 'max-[720px]:w-full max-[720px]:flex-[1_1_auto]!'



export const capCatalogMeta =

  'border-b border-border bg-bg-primary px-3 py-2 text-[0.82rem] text-text-secondary'



export const capCatalogScroll = 'p-3'



export const capCatalogList = 'm-0 list-none p-0'



export const capCatalogRow =

  'mb-2.5 border-b border-border pb-2.5 last:mb-0 last:border-b-0 last:pb-0'



export const capCatalogRowInner =

  'flex items-start justify-between gap-3 max-[720px]:flex-col max-[720px]:items-stretch'



export const capCatalogRowBody = 'min-w-0 flex-[1_1_auto]'



export const capCatalogRowHead = 'flex flex-wrap items-center gap-x-2.5 gap-y-1.5'



export const capStatusDot =

  'h-2.5 w-2.5 shrink-0 rounded-full bg-text-secondary opacity-40'



export const capStatusDotOn =

  'bg-[rgb(74_222_128)] opacity-100 shadow-[0_0_0_3px_rgb(74_222_128/0.16)]'



export const capStatusDotDisabled =

  'bg-[rgb(167_139_250)] opacity-95 shadow-[0_0_0_3px_rgb(167_139_250/0.2)]'



export const capCatalogName = 'font-semibold'



export const capCatalogDl = 'whitespace-nowrap text-[0.78rem] text-text-secondary'



export const capCatalogTypes = 'mt-0.5 flex flex-wrap gap-1.5'



export const capCatalogDesc = 'mt-1 text-[0.84rem] leading-[1.35] text-text-secondary'



export const capCatalogInstallBtn =

  'min-w-[6.75rem] shrink-0 self-start whitespace-nowrap max-[720px]:w-full max-[720px]:self-stretch'



/** Origin badge */

export const capOrigin =

  'inline-block whitespace-nowrap rounded border border-border bg-bg-tertiary px-1.5 py-0.5 font-mono text-[0.72rem] text-text-secondary'



export const capPath =

  'break-all font-mono text-[0.76rem] text-text-secondary'



export const capHint =

  'mt-1 rounded-sm border-l-2 border-accent/50 bg-accent/[0.06] px-1.5 py-1 text-[0.78rem] text-text-primary'



export const capLintWarn = 'font-semibold text-danger'



export const capSkillSurfaces = 'mt-1.5 text-[0.78rem] leading-[1.45] text-text-secondary'



export const capSkillRowPath = 'text-[0.74rem] font-mono text-text-secondary'



/** Package cards */

export const capPkgCard =

  'group mt-3 overflow-hidden rounded-[10px] border border-border bg-bg-secondary transition-[border-color,box-shadow] duration-[150ms] hover:border-accent/32 open:shadow-[0_1px_0_rgb(255_255_255/0.02)_inset]'



export const capPkgCardSummary =

  'flex cursor-pointer list-none flex-wrap items-start justify-between gap-x-3.5 gap-y-2.5 px-3.5 py-3 group-open:border-b group-open:border-border max-[720px]:flex-col max-[720px]:items-stretch [&::-webkit-details-marker]:hidden [&::marker]:content-none'



export const capPkgCardSummaryLead = 'min-w-0 flex-[1_1_200px]'



export const capPkgCardSummaryTrail =

  'ml-auto flex shrink-0 items-center gap-2.5 max-[720px]:ml-0 max-[720px]:w-full max-[720px]:justify-between'



export const capPkgCardSummaryActions = 'shrink-0'



export const capPkgCardHeadline = 'flex min-w-0 flex-col gap-0.5'



export const capPkgCardName =

  'break-all font-mono text-[0.92rem] font-semibold text-text-primary'



export const capPkgCardHint = 'text-[0.8rem] text-text-secondary'



export const capPkgCardBody = 'px-3.5 pb-3.5'



export const capPkgCardToolbar =

  '-mx-3.5 mb-3 flex flex-wrap items-center gap-2.5 border-b border-border bg-black/18 px-3.5 py-2.5'



export const capPkgCardMeta =

  'mb-3.5 flex flex-wrap items-baseline gap-1.5 text-[0.78rem]'



export const capPkgCardEmpty = 'mt-1.5 text-[0.82rem] italic text-text-secondary'



/** Skill rows */

export const capSkillRow = rowItem



export const capSkillRowLine = 'flex min-w-0 items-center gap-2.5'



export const capSkillRowTitle = 'flex min-w-0 flex-[0_1_auto] items-center gap-2'



export const capSkillRowTitleName = `${rowName} overflow-hidden text-ellipsis whitespace-nowrap`



export const capSkillRowLinePath =

  'min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.74rem] text-text-secondary'



export const capSkillRowActions = 'flex shrink-0 items-center gap-2'

export const capSkillRowExpandBtn =
  'flex min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent p-0 text-left hover:text-accent'

export const capSkillEditorCard =
  'mt-2 rounded-md border border-border bg-bg-primary px-3 py-2.5'

export const capSkillEditorToolbar = 'mb-2 flex flex-wrap items-center gap-2'

export const capSkillEditorMeta = 'text-[0.74rem] text-text-secondary'



/** Extension cards */

export const capExtCardLi = 'list-none'



export const capExtCard = 'overflow-hidden rounded-lg border border-border bg-bg-primary'



export const capExtCardSummary =

  'flex list-none flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5'



export const capExtCardSummaryOpen = 'border-b border-border'



export const capExtCardSummaryToggle =

  'inline-flex min-w-0 flex-[1_1_auto] cursor-pointer items-center gap-x-3 gap-y-2 border-none bg-transparent p-0 text-left font-[inherit] text-inherit'



export const capExtCardTitleWrap = 'flex min-w-0 flex-[1_1_auto] flex-wrap items-center gap-2'



export const capExtRowName = rowName



export const capExtCardSummaryActions = 'ml-auto shrink-0'



export const capExtCardBody = 'px-3 py-2.5 pb-3'



export const capExtRowCmds = 'font-mono text-[0.76rem]'



export const capExtRowEmpty = 'mt-2 text-[0.78rem] italic text-text-secondary'



export const capExtCardChevronOpen = 'rotate-45'



/** Tool rows */

export const capToolList = 'mt-2 flex list-none flex-col gap-1.5 p-0'



export const capToolItemWrap =

  'list-none overflow-hidden rounded-md border border-border bg-accent/[0.05]'



export const capToolRowLine =

  'flex min-w-0 flex-wrap items-center gap-2 px-2.5 py-1.5'



export const capToolNameBtn =

  'inline-flex min-w-0 flex-[1_1_auto] cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left font-[inherit] text-inherit'



export const capToolChevron =

  '-mt-0.5 inline-block h-[0.45rem] w-[0.45rem] shrink-0 rotate-[-45deg] border-b-2 border-r-2 border-text-secondary transition-transform duration-[120ms]'



export const capToolChevronOpen = 'rotate-45'



export const capToolName = 'block font-mono text-[0.82rem] font-semibold text-text-primary'



export const capToolRowSpacer = 'min-w-[6px] flex-[1_1_auto]'



export const capToolDisclosureBody =

  'px-2.5 py-1.5 pb-2 text-[0.78rem] leading-[1.45] text-text-secondary'



export const capToolConflict =

  'shrink-0 cursor-default rounded border border-[rgb(255_160_40/0.45)] bg-[rgb(255_160_40/0.15)] px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-[rgb(255_214_164)]'



/** Pill switch */

export const capSwitch =

  'mr-auto inline-flex cursor-pointer select-none items-center gap-2.5 border-none bg-transparent p-0 text-left font-[inherit] text-[0.85rem] text-text-primary focus-visible:rounded-md focus-visible:shadow-[0_0_0_3px_rgb(107_159_255/0.22)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'



export const capSwitchSm = `${capSwitch} ${btnSm}`



export const capSwitchTrack =

  'relative h-[22px] w-[38px] shrink-0 rounded-full border border-border bg-bg-tertiary transition-[background,border-color] duration-[150ms]'



export const capSwitchTrackOn =

  'border-[rgb(74_222_128/0.45)] bg-[rgb(74_222_128/0.22)]'



export const capSwitchKnob =

  'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-text-primary opacity-85 shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-[transform,background] duration-[150ms]'



export const capSwitchKnobOn = 'translate-x-4 bg-[rgb(74_222_128)] opacity-100'



export const capSwitchLabel = 'text-text-secondary'



export const capSwitchLabelOn = 'text-text-primary'



/** App shell — layout */

export const shellGrid = 'grid h-full min-h-0 overflow-hidden'



export const sidebar =

  'relative flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden border-r border-border bg-bg-secondary p-3'



export const sidebarDragHandle =

  'absolute top-0 right-0 z-20 h-full w-2 translate-x-1/2 cursor-col-resize touch-none select-none hover:bg-accent/25 active:bg-accent/40'



export const sidebarAsideCollapsed = 'items-stretch px-2 py-3'



export const sidebarBrandRow =

  'mb-2 flex min-h-7 items-center justify-between gap-2'



export const sidebarBrandTitle = 'm-0 min-w-0 flex-1 text-[1.1rem] font-semibold'



export const sidebarResizeBtn =

  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-[0.72rem] leading-none text-text-secondary transition-[background,border-color,color] duration-[120ms] hover:border-border hover:bg-bg-tertiary hover:text-accent'



export const sidebarResizeBtnCollapsed = `${sidebarResizeBtn} w-full`



export const sidebarConvList = 'mt-2 min-h-0 flex-1 overflow-auto'



/** Sidebar nav */

const navBtnBase =

  'cursor-pointer rounded-md border border-transparent bg-transparent px-2.5 py-2 text-left text-[0.9rem] text-text-primary transition-[background,border-color] duration-[120ms] hover:bg-bg-tertiary'



export const navBtn = navBtnBase



export const navBtnActive = 'border-accent-muted bg-bg-tertiary'



export const navBtnRoute = `${navBtnBase} box-border w-full`



export const navSectionDetails = 'group m-0'



export const navSectionSummary =

  'cursor-pointer list-none before:mr-1.5 before:inline-block before:content-["▸"] before:transition-transform before:duration-[120ms] group-open:text-accent group-open:before:rotate-90 [&::-webkit-details-marker]:hidden [&::marker]:content-none'



export const navRouteRow = 'w-full'



/** Sidebar workspace selector */

export const sidebarChatFolderBar = 'mb-1 flex flex-col gap-1.5'



export const sidebarWorkspaceLabelRow = 'flex min-w-0 items-center justify-between gap-2'



export const sidebarWorkspaceLabel =

  'text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-text-secondary'



export const sidebarWorkspaceEditBtn =

  'm-0 shrink-0 cursor-pointer rounded-md border-none bg-transparent px-2 py-1 font-[inherit] text-[0.8rem] text-accent hover:bg-bg-tertiary hover:text-text-primary'



export const sidebarFolderSelect =

  'box-border w-full rounded-md border border-border bg-bg-secondary px-2 py-1.5 font-[inherit] text-[0.8rem] text-text-secondary focus:border-accent/55 focus:shadow-[0_0_0_3px_rgb(107_159_255/0.18)] focus:outline-none'



export const workspaceSelectTrigger =

  `${sidebarFolderSelect} flex cursor-pointer items-center justify-between gap-2 text-left hover:border-accent/40`



export const workspaceSelectTriggerLabel = 'min-w-0 flex-1 truncate text-text-primary'



export const workspaceSelectTriggerChevron = 'shrink-0 text-[0.65rem] text-text-secondary'



export const workspaceSelectMenu =

  'fixed z-[12000] flex max-h-[min(320px,50vh)] flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-[0_10px_36px_rgb(0_0_0/0.45)]'



export const workspaceSelectSearchWrap = 'shrink-0 border-b border-border p-2'



export const workspaceSelectSearch =

  'box-border w-full rounded-md border border-border bg-bg-primary px-2 py-1.5 font-[inherit] text-[0.8rem] text-text-primary placeholder:text-text-secondary focus:border-accent/55 focus:shadow-[0_0_0_3px_rgb(107_159_255/0.18)] focus:outline-none'



export const workspaceSelectList = 'min-h-0 flex-1 overflow-y-auto overscroll-contain p-1'



export const workspaceSelectOption =

  'flex w-full cursor-pointer rounded-md border-none bg-transparent px-2 py-1.5 text-left font-[inherit] text-[0.8rem] text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'



export const workspaceSelectOptionActive = 'bg-bg-tertiary text-text-primary outline outline-1 outline-accent-muted'



export const workspaceSelectEmpty = 'px-2 py-2 text-[0.78rem] text-text-secondary'



/** Sidebar conversations */

export const convRow =

  'group/conv mb-1 flex min-w-0 flex-col items-stretch gap-0.5 rounded-md last:mb-0'



export const convRowSelected = 'bg-bg-tertiary outline outline-1 outline-accent-muted'



export const convRowMain = 'flex min-w-0 items-stretch gap-0.5'



export const convRowSelect =

  'flex min-w-0 flex-[1_1_auto] cursor-pointer items-center gap-2 overflow-hidden rounded-tl-md border-none bg-transparent px-2 py-2 pl-2 text-left text-[0.85rem] text-text-secondary hover:text-text-primary'



export const convRowSelectLabel = 'min-w-0 flex-1 truncate'



export const convStatusDot = 'inline-block h-2 w-2 shrink-0 rounded-full'



export const convStatusDotRead = 'bg-text-muted/35'



export const convStatusDotUnread = 'bg-accent shadow-[0_0_0_1px] shadow-accent/40'



export const convStatusSpinner =

  'inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-text-muted/50 border-t-accent'



export const convRowSelectActive = 'font-medium text-accent'



export const convRowActions =

  'hidden shrink-0 items-center gap-0 pr-1 group-hover/conv:flex group-focus-within/conv:flex'



export const convActionBtn =

  'cursor-pointer rounded border-none bg-transparent px-[7px] py-1 text-[0.95rem] leading-none text-text-secondary hover:bg-bg-secondary hover:text-text-primary'



export const convActionDanger = 'hover:text-danger'



/** Sidebar dev panel */

export const sidebarDevPanel = 'mt-auto w-full min-w-0 shrink-0'



export const sidebarDevList = 'flex w-full flex-col items-stretch gap-0.5'



/** Main content area */

export const mainContent = 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden'



export const banner = 'border-b border-border bg-[#3d2918] px-3 py-2 text-[0.85rem]'



export const bannerMuted = 'border-b border-border bg-[#252034] px-3 py-2 text-[0.85rem]'



/** Route / conversation context menus */

export const routeCtxItem =

  'block w-full cursor-pointer rounded-md border-none bg-transparent px-2.5 py-2 text-left text-[0.88rem] text-text-primary hover:bg-bg-tertiary'



export const routeCtxItemDanger = 'text-danger hover:bg-[rgb(255_107_107/0.12)]'

export const ctxMenuBackdrop = 'fixed inset-0 z-[11999]'

export const ctxMenuShell =
  'fixed z-[12000] min-w-[208px] rounded-lg border border-border bg-bg-secondary p-1.5 shadow-[0_10px_36px_rgb(0_0_0/0.45)]'

/** Agent show_widget panel below chat transcript (ecosystem / legacy) */
export const agentWidgetHost = 'mt-1 border-t border-border py-2'

export const agentWidgetHostHeader = 'mb-2 flex items-center justify-between gap-3'

/** Chat + right-docked canvas */
export const chatWorkbench = 'flex min-h-0 min-w-0 flex-1 flex-row'

/** Canvas resize handle (right dock) */
export const canvasResizeHandleCol =
  'relative z-10 h-full w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-border/40 hover:bg-accent/30 active:bg-accent/45'

/** Chat pane — layout */
export const chatPane = 'flex min-h-0 min-w-0 flex-1 flex-col'

export const chatArea =
  'flex min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 py-4 touch-pan-y [overflow-anchor:none]'

export const chatMessageList = 'flex w-full min-w-0 flex-col gap-3'

/** Message bubbles */
export const chatMsgRow = 'flex w-full min-w-0'

export const chatMsgRowUser = 'justify-end'

export const chatMsgRowAssistant = 'justify-start'

export const chatMsgBubble =
  'max-w-[92%] min-w-0 break-words rounded-lg px-3 py-2.5 text-[0.95rem] leading-[1.45] [overflow-wrap:anywhere]'

export const chatMsgUser = 'self-end border border-border bg-bg-tertiary'

export const chatMsgAssistant = 'self-start border border-border bg-bg-secondary'

export const chatMsgHead = 'mb-1.5 flex items-start justify-between gap-2.5'

export const chatMsgRoleRow =
  'text-[0.75rem] font-semibold uppercase tracking-[0.03em] text-text-secondary'

export const chatMsgStatusMuted = 'font-medium normal-case tracking-normal'

export const chatMsgWorkflow = '-mt-0.5 shrink-0'

export const chatMsgBody = 'text-[0.95rem] text-text-primary'

export const chatMsgBodyUser = 'whitespace-pre-wrap'

export const chatLinkQuiet =
  'cursor-pointer border-none bg-transparent p-0 font-[inherit] text-[0.75rem] text-accent underline underline-offset-2 hover:text-[#8cb4ff]'

/** Interleaved assistant body */
export const chatInterleaved =
  'flex flex-col gap-2 [&>.chat-md>:first-child]:mt-0 [&>.chat-md>:last-child]:mb-0'

/** Timing gaps between segments */
export const chatSegmentGap = 'my-1 flex select-none items-center gap-2 text-[0.74rem] text-text-secondary'

export const chatSegmentGapLine = 'h-px flex-1 bg-border opacity-65'

export const chatSegmentGapLabel = 'max-w-[42%] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap'

export const chatSegmentGapMs = 'shrink-0 tabular-nums'

export const chatSegmentGapTotal =
  'shrink-0 tabular-nums text-[0.72rem] text-text-secondary opacity-85'

/** Inline reasoning / tool segments */
export const chatSegmentSummary =
  'flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[0.82rem] text-text-primary select-none [&::-webkit-details-marker]:hidden'

export const chatSegmentIcon = 'w-3.5 shrink-0 text-center text-[0.85rem]'

export const chatSegmentLabel = 'shrink-0 font-semibold tracking-[0.01em]'

export const chatSegmentArgs =
  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.74rem] text-text-secondary'

export const chatSegmentMeta = 'shrink-0 text-[0.74rem] tabular-nums text-text-secondary'

export const chatSegmentPulse = 'animate-[chatSegmentPulse_1.6s_ease-in-out_infinite]'

export const chatSegmentStatusBase =
  'shrink-0 rounded-full px-1.5 py-px text-[0.7rem] uppercase tracking-[0.04em]'

export const chatSegmentStatusOk = 'bg-[rgb(74_222_128/0.16)] text-[rgb(74_222_128)]'

export const chatSegmentStatusErr = 'bg-[rgb(255_107_107/0.16)] text-[rgb(255_107_107)]'

export const chatSegmentStatusLive = 'bg-[rgb(107_159_255/0.16)] text-accent'

export const chatSegmentChevron =
  'ml-0.5 h-2 w-2 shrink-0 rotate-[-45deg] border-b-[1.5px] border-r-[1.5px] border-text-secondary transition-transform duration-[120ms] group-open:rotate-45'

export const chatSegmentBody =
  'flex flex-col gap-1.5 border-t border-border bg-black/18 px-3 py-2 pb-2.5'

export const chatSegmentThinkingText =
  'm-0 max-h-none overflow-visible whitespace-pre-wrap break-words font-mono text-[0.78rem] leading-normal text-text-secondary'

export const chatSegmentEmpty = 'm-0 text-[0.78rem]'

export const chatSegmentKv = 'flex flex-col gap-0.5'

export const chatSegmentKvLabel = 'text-[0.7rem] uppercase tracking-[0.05em] text-text-secondary'

export const chatSegmentPre =
  'm-0 max-h-none overflow-visible whitespace-pre-wrap break-words font-mono text-[0.74rem] leading-[1.45] text-text-primary'

export const chatInlineCode = 'font-mono text-[0.86em]'

export function chatSegmentRootClass(
  kind: 'thinking' | 'tool' | 'compaction',
  opts: { isError?: boolean },
): string {
  return cn(
    'group overflow-hidden rounded-lg border',
    kind === 'thinking' && 'border-[rgb(107_159_255/0.32)] bg-[rgb(107_159_255/0.06)]',
    kind === 'compaction' && 'border-[rgb(245_158_11/0.35)] bg-[rgb(245_158_11/0.06)]',
    kind === 'tool' && !opts.isError && 'border-border bg-bg-tertiary',
    kind === 'tool' && opts.isError && 'border-[rgb(255_107_107/0.5)] bg-[rgb(255_107_107/0.06)]',
  )
}

/** Composer + status foot */
export const chatStatusSubfoot =
  'flex shrink-0 flex-wrap items-baseline justify-between gap-4 px-4 pb-3 pt-1.5 text-[0.76rem] text-text-secondary'

export const chatModelCaption =
  'min-w-[140px] flex-1 text-left font-mono text-[0.74rem] leading-[1.35]'

export const chatBrokerHint = 'max-w-[55%] shrink-0 text-right font-[inherit]'

export const chatTurnElapsed =
  'font-mono text-[0.74rem] leading-[1.35] text-text-primary'

/** Turn timer + Stop — right side of composer status row */
export const chatTurnActions = 'ml-auto flex shrink-0 items-center gap-2'

export const chatStopBtnCompact =
  'px-2.5 py-0.5 text-[0.72rem] leading-tight'

export const chatComposer = 'bg-bg-secondary'

export const chatComposerDrag =
  'bg-[rgb(107_159_255/0.06)] outline outline-2 outline-[rgb(107_159_255/0.45)] outline-offset-[-2px]'

export const chatQueueStrip = 'flex flex-col gap-1.5 border-t border-border px-4 pt-2'

export const chatQueueItem =
  'flex items-center gap-2 rounded-lg border border-dashed border-border bg-[rgb(107_159_255/0.05)] px-2 py-1.5 text-[0.82rem]'

export const chatQueueItemDragging = 'opacity-55'

export const chatQueueIndex =
  'w-[1.4rem] shrink-0 text-center tabular-nums text-text-secondary'

export const chatQueueText =
  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap'

export const chatQueueSendNow =
  'shrink-0 cursor-pointer rounded-md border border-[rgb(107_159_255/0.45)] bg-[rgb(107_159_255/0.12)] px-2 py-0.5 text-[0.75rem] text-text-primary hover:bg-[rgb(107_159_255/0.22)] disabled:cursor-not-allowed disabled:opacity-50'

export const chatQueueRemove =
  'shrink-0 cursor-pointer border-none bg-transparent px-1 py-0 text-base leading-none text-text-secondary hover:text-text-primary'

export const chatAttachmentStrip = 'flex flex-wrap gap-2 border-t border-border px-4 pt-2'

export const chatAttachmentChip =
  'inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-bg-primary py-1 pl-1 pr-2 text-[0.78rem]'

export const chatAttachmentChipImage = 'max-w-[min(100%,260px)]'

export const chatAttachmentChipGlyph =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg-tertiary text-[0.85rem] text-accent/75'

export const chatAttachmentChipName =
  'max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap'

export const chatAttachmentChipRemove =
  'shrink-0 cursor-pointer rounded border-none bg-transparent px-1 py-0 text-base leading-none text-text-secondary hover:bg-[rgb(255_255_255/0.06)] hover:text-text-primary'

export const chatInputRow = 'flex gap-2 border-t border-border bg-bg-secondary px-4 py-3'

export const chatInputTextarea =
  'min-h-11 max-h-[120px] flex-1 resize-none rounded-md border border-border bg-bg-primary px-2.5 py-2.5 font-[inherit] text-text-primary'

export const chatInputSendBtn =
  'cursor-pointer rounded-md border-none bg-accent px-4 py-2.5 font-semibold text-[#0a0c0f] disabled:cursor-not-allowed disabled:opacity-50'

export const chatStopBtn =
  'shrink-0 cursor-pointer rounded-md border border-[rgb(220_90_90/0.55)] bg-[rgb(220_90_90/0.12)] text-[#f0a8a8] hover:bg-[rgb(220_90_90/0.22)] disabled:cursor-not-allowed disabled:opacity-50'

/** Panel shell — skills tab, skill-route tab */
export const panelShell =
  'box-border min-h-0 flex-1 w-full overflow-x-hidden overflow-y-auto overscroll-y-contain touch-pan-y p-4'

export const panelTitle = 'mt-0 text-base'

/** Agent widget tool log */
export const toolLogPre =
  'mt-2 max-h-[200px] overflow-auto rounded-md bg-[#0a0c0f] p-2 font-mono text-[0.8rem]'

/** Settings-style caption (workspace hints) */
export const settingsCaption = 'm-0 text-[0.78rem] leading-[1.4] text-text-secondary'

/** Centered app modals */
export const modalOverlay =
  'fixed inset-0 z-[10000] flex items-center justify-center bg-[rgb(8_10_14/0.75)] p-6 backdrop-blur-[3px]'

export const modalShell =
  'relative w-[min(380px,100%)] rounded-xl border border-border bg-bg-secondary p-[22px_24px] shadow-[0_20px_56px_rgb(0_0_0/0.55)]'

export const modalShellWide = 'w-[min(720px,96vw)]'

export const modalShellWorkspace =
  'flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden p-[18px_20px_16px]'

export const modalTitle =
  'mb-[18px] mt-0 text-base font-semibold tracking-[-0.01em] text-text-primary'

export const modalTitleWorkspace = 'mb-3 shrink-0'

export const modalBody =
  'mb-[18px] mt-0 text-[0.9rem] leading-[1.45] text-text-secondary [&_strong]:font-semibold [&_strong]:text-text-primary'

export const modalBodyWorkspace = 'mb-3'

export const modalField = 'block'

export const modalLabel =
  'mb-2 block text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-secondary'

export const modalInput =
  'box-border w-full rounded-lg border border-border bg-bg-primary px-3 py-2.5 font-[inherit] text-[0.92rem] text-text-primary outline-none focus:border-accent-muted focus:shadow-[0_0_0_2px_rgb(107_159_255/0.2)]'

export const modalInputFlex = `${modalInput} min-w-0 flex-1`

export const modalActions = 'mt-[22px] flex justify-end gap-2.5'

export const modalActionsFooter = 'mt-1 shrink-0 justify-end pt-1'

/** Workspace manage modal */
export const workspaceModalLead = 'mb-2 text-[0.85rem] font-semibold text-text-primary'

export const workspaceTableWrap =
  'mb-2.5 max-h-[min(36vh,280px)] overflow-auto rounded-lg border border-border bg-bg-primary'

export const workspaceManageTable =
  'w-full border-collapse text-[0.84rem] [&_tbody_tr:last-child_td]:border-b-0'

export const workspaceManageTableTh =
  'sticky top-0 z-[1] border-b border-border bg-bg-tertiary px-2.5 py-1.5 text-left text-[0.68rem] font-semibold uppercase tracking-[0.04em] text-text-secondary'

export const workspaceManageTableTd = 'border-b border-border px-2.5 py-1.5 align-middle'

export const workspaceTableColEdit = 'w-[1%] whitespace-nowrap text-right'

export const workspaceTableRowActive = '[&_td]:bg-[rgb(107_159_255/0.1)]'

export const workspaceTablePath =
  'block max-w-[min(52ch,100%)] overflow-hidden text-ellipsis whitespace-nowrap text-[0.78rem] text-text-secondary'

export const workspaceEditDisclosure =
  'mb-0 grid grid-rows-[0fr] transition-[grid-template-rows] duration-[220ms] motion-reduce:duration-[0.01ms]'

export const workspaceEditDisclosureOpen = 'mb-3 grid-rows-[1fr]'

export const workspaceEditDisclosureInner = 'min-h-0 overflow-hidden'

export const workspaceModalSection = 'mb-3'

export const workspaceModalSectionAdd =
  'mt-5 rounded-[10px] border border-[rgb(107_159_255/0.2)] bg-[rgb(107_159_255/0.05)] px-3 py-2.5'

export const workspaceModalSectionTitle =
  'mb-1.5 mt-0 text-[0.72rem] font-semibold uppercase tracking-[0.05em] text-text-secondary'

export const workspaceField = 'flex flex-col gap-1'

export const workspaceFieldTight = 'mt-2'

export const workspaceFieldLabel =
  'text-[0.72rem] font-semibold uppercase tracking-[0.05em] text-text-secondary'

export const workspaceFormActions = 'mt-2 flex flex-wrap items-center gap-2'

export const workspaceFormInput = cn(modalInput, 'px-2.5 py-1.5 text-[0.88rem]')

export const workspaceFormInputPath = 'font-mono text-[0.8rem]'

export const workspaceFormPathWrap =
  'flex w-full min-w-0 flex-[0_0_auto] flex-nowrap items-center gap-1.5 self-stretch'

export const folderNewPathWrap = 'flex min-w-0 flex-[1_1_220px] items-center gap-1.5'

export const workspaceModalDone = 'px-3.5 py-[7px] text-[0.85rem]'

/** Route popout window */
export const routePopoutRoot = 'flex h-screen flex-col overflow-hidden'

export const routePopoutLoading =
  'grid h-screen place-items-center bg-bg-primary text-text-secondary'

export const routePopoutNotFound = 'h-screen overflow-auto bg-bg-primary p-6'

export const routePopoutNotFoundTitle = 'mt-0'

export const routePopoutNotFoundPre = 'whitespace-pre-wrap text-text-secondary'

export const routePopoutHeader =
  'flex flex-none items-center justify-between border-b border-border bg-bg-secondary px-3.5 py-2.5'

export const routePopoutHeaderTitle = 'm-0 text-base'

export const routePopoutBody = 'min-h-0 flex-1 p-3'


