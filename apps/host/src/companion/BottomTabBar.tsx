import type { ReactElement } from 'react'

/** Chat + System are the host's own tabs; personal-bundle tabs come from the
 * plugin manifest and render between them. */
export type CompanionTab = 'chat' | 'system' | (string & {})

type TabDef = { id: string; label: string; icon: ReactElement }

const svg = (path: ReactElement) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-5"
    aria-hidden="true"
  >
    {path}
  </svg>
)

const CORE_TABS: TabDef[] = [
  { id: 'chat', label: 'Chat', icon: svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />) },
  {
    id: 'system',
    label: 'System',
    icon: svg(
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
    ),
  },
]

/** Neutral icon registry for plugin-declared tabs (manifest icon keys). */
const PLUGIN_ICONS: Record<string, ReactElement> = {
  utensils: svg(
    <>
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
    </>,
  ),
  dumbbell: svg(
    <>
      <path d="M14.4 14.4 9.6 9.6" />
      <path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l1.767-1.768a2 2 0 1 1 2.829 2.829z" />
      <path d="m21.5 21.5-1.4-1.4" />
      <path d="M3.9 3.9 2.5 2.5" />
      <path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z" />
    </>,
  ),
  activity: svg(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
  heart: svg(
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  ),
}

export function pluginTabIcon(key: string): ReactElement {
  return PLUGIN_ICONS[key] ?? PLUGIN_ICONS.activity
}

export function BottomTabBar({
  active,
  onChange,
  pluginTabs = [],
}: {
  active: CompanionTab
  onChange: (tab: CompanionTab) => void
  /** Tabs declared by the personal-bundle manifest (rendered between Chat and System). */
  pluginTabs?: { id: string; label: string; icon: string }[]
}): ReactElement {
  const tabs: TabDef[] = [
    CORE_TABS[0],
    ...pluginTabs.map((t) => ({ id: t.id, label: t.label, icon: pluginTabIcon(t.icon) })),
    CORE_TABS[1],
  ]
  return (
    <nav
      className="flex shrink-0 border-t border-border bg-bg-secondary pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      aria-label="Main navigation"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.68rem] ${
            active === tab.id ? 'text-accent' : 'text-text-secondary'
          }`}
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}