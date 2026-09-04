import React from 'react'
import { AttachmentImageThumb } from './AttachmentImageThumb'
import { isImageAttachmentPath, splitUserMessageAttachments } from './chatUserAttachments'
import { cn } from './lib/cn'

type Props = {
  content: string
  localImageUrl?: (path: string) => string | null
}

/** User bubble: prose + visual attachment chips when paths were appended by Sylo. */
export function UserMessageBody({ content, localImageUrl }: Props): React.ReactElement {
  const { text, attachments } = splitUserMessageAttachments(content)

  if (attachments.length === 0) {
    return <div className="whitespace-pre-wrap">{content}</div>
  }

  return (
    <div className="flex flex-col gap-3">
      {text ?
        <div className="whitespace-pre-wrap">{text}</div>
      : null}
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
