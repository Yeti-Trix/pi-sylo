import React, { useMemo } from 'react'
import { splitMentionSegments } from '../../shared/subagent-mentions'
import { AttachmentImageThumb } from './AttachmentImageThumb'
import { useSubagentNames } from './chat/useSubagentNames'
import { isImageAttachmentPath, splitUserMessageAttachments } from './chatUserAttachments'
import { cn } from './lib/cn'
import { chatMentionChip, chatMentionChipForced, chatMentionChipRef } from './panels/ui-classes'

type Props = {
  content: string
  localImageUrl?: (path: string) => string | null
}

/**
 * Message prose with `@agent` mentions drawn as chips.
 *
 * Forced mentions (the leading run) and bare references are styled apart on
 * purpose: only the leading run invokes anything, so showing them identically
 * would suggest that naming an agent mid-sentence had run it.
 */
function MessageProse({ text }: { text: string }): React.ReactElement {
  const agentNames = useSubagentNames()
  const segments = useMemo(() => splitMentionSegments(text, agentNames), [text, agentNames])

  if (!segments.some((s) => s.kind === 'mention')) {
    return <div className="whitespace-pre-wrap">{text}</div>
  }

  return (
    <div className="whitespace-pre-wrap">
      {segments.map((segment, i) =>
        segment.kind === 'text' ?
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        : <span
            key={i}
            className={cn(
              chatMentionChip,
              segment.forced ? chatMentionChipForced : chatMentionChipRef,
            )}
            title={
              segment.forced ?
                `Forced this turn through the ${segment.agent} subagent.`
              : `Refers to the ${segment.agent} subagent. A mention has to start the message to force a run.`
            }
          >
            {segment.text}
          </span>,
      )}
    </div>
  )
}

/** User bubble: prose + visual attachment chips when paths were appended by Sylo. */
export function UserMessageBody({ content, localImageUrl }: Props): React.ReactElement {
  const { text, attachments } = splitUserMessageAttachments(content)

  if (attachments.length === 0) {
    return <MessageProse text={content} />
  }

  return (
    <div className="flex flex-col gap-3">
      {text ? <MessageProse text={text} /> : null}
      <div
        className="overflow-hidden rounded-lg border border-accent/[0.28] bg-accent/[0.07]"
        aria-label="Attached files"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-accent/20 px-3 py-2 text-[0.76rem]">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-text-primary">
            Attached files
          </span>
          <span className="ml-auto text-[0.7rem] text-text-secondary">
            paths passed to the agent
          </span>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-2">
          {attachments.map((a) => (
            <li
              key={a.path}
              className={cn(
                'flex items-start gap-2.5 rounded-md border border-border bg-bg-primary px-2.5 py-2',
                isImageAttachmentPath(a.name, a.path) && 'items-center',
              )}
              title={a.path}
            >
              <AttachmentImageThumb
                path={a.path}
                name={a.name}
                className="size-[52px]"
                resolveImageUrl={localImageUrl}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[0.88rem] font-semibold text-text-primary">
                  {a.name}
                </span>
                <code className="block truncate font-mono text-[0.68rem] text-text-secondary">
                  {a.path}
                </code>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
