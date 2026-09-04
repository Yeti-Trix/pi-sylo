import React from 'react'

import { cn } from '../../lib/cn'
import {
  btnPrimarySm,
  chatMsgAssistant,
  chatMsgBubble,
  mutedText,
} from '../../panels/ui-classes'

type Props = {
  runDir: string
  onOpen: (runDir: string) => void
}

export function LogicForgeIoReviewAction({ runDir, onOpen }: Props): React.ReactElement {
  return (
    <div
      className={cn(
        chatMsgBubble,
        chatMsgAssistant,
        'mx-0 mt-2 w-auto min-w-0 border-accent/35 bg-accent/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]',
      )}
    >
      <div className="flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-[0.88rem] font-medium text-text-primary">I/O match ready</p>
          <p className={cn(mutedText, 'm-0 mt-1 text-[0.78rem] leading-snug')}>
            Edit descriptions and home states in Parse L5X, then approve and build the ACD.
          </p>
          <p
            className={cn(mutedText, 'm-0 mt-1.5 truncate font-mono text-[0.7rem] opacity-80')}
            title={runDir}
          >
            {runDir}
          </p>
        </div>
        <button
          type="button"
          className={cn(btnPrimarySm, 'shrink-0 self-start sm:self-center')}
          onClick={() => onOpen(runDir)}
        >
          Open Parse L5X review
        </button>
      </div>
    </div>
  )
}
