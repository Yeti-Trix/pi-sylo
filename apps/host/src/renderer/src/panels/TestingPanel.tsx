import React, { useState } from 'react'

import { PerfProbeCard } from './PerfProbeCard'
import { EvalDashboardPanel } from './EvalDashboardPanel'
import { cn } from '../lib/cn'
import { testingSubtabBar, testingSubtabBtn, testingSubtabBtnOn, testingSubtabHint } from './ui-classes'

type TestingSubTab = 'perf' | 'evals'

const SUBTABS: { id: TestingSubTab; label: string }[] = [
  { id: 'perf', label: 'Freeze diagnostics' },
  { id: 'evals', label: 'Eval dashboard' },
]

const HINTS: Record<TestingSubTab, string> = {
  perf: 'What was loading when the app stalled — chat switches, image sends. Run a probe after reproducing.',
  evals: 'Session-quality metrics mined from past agent sessions; track regressions across releases.',
}

/**
 * Developer → Testing sections. One sub-tab strip instead of a single tall
 * page — new testing surfaces slot in here as another entry in SUBTABS.
 */
export function TestingPanel(): React.ReactElement {
  const [subtab, setSubtab] = useState<TestingSubTab>('perf')

  return (
    <div className="flex min-h-0 flex-col">
      <div className={testingSubtabBar} role="tablist" aria-label="Testing sections">
        {SUBTABS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={subtab === s.id}
            className={cn(subtab === s.id ? testingSubtabBtnOn : testingSubtabBtn)}
            onClick={() => setSubtab(s.id)}
          >
            {s.label}
          </button>
        ))}
        <span className={testingSubtabHint}>{HINTS[subtab]}</span>
      </div>
      {subtab === 'perf' ? <PerfProbeCard /> : <EvalDashboardPanel />}
    </div>
  )
}