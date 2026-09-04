/** Shared user-message attachment block shape (renderer composes; main injects vision-tool hint). */

export const USER_ATTACHMENT_PREAMBLE =
  'Attached local files (absolute paths on this machine; contents are not copied into the message—tools should read from disk, e.g. docparser):'

/** Shown to the model so it does not hunt for image.png under the Pi cwd. */
export const USER_ATTACHMENT_HINT =
  'Use only the absolute paths in the list below. Pasted or dropped attachments may live under Sylo app data (e.g. …\\sylo-paste-images\\…) and are not copied into the project folder; do not search the working directory for generic names like image.png unless that exact path is listed.'

/** Added to the attachment block when the main model is text-only and images are attached: steer it to the tool. */
export const IMAGE_TOOL_HINT_TEXTONLY =
  'Image attachments: the main chat model cannot see pixels directly. Call the `analyze_image` tool with the image path and your own prompt to inspect any attached image (e.g. read text, values, or details).'

/** Separator between attachment block (first) and the operator's prose (second). */
export const TEXT_AFTER_ATTACHMENTS_SEP = '\n\n---\n\n'

export function formatUserMessageWithAttachments(
  trimmed: string,
  attachmentLines: string[],
): string {
  if (attachmentLines.length === 0) return trimmed
  const block = [USER_ATTACHMENT_PREAMBLE, USER_ATTACHMENT_HINT, ...attachmentLines].join('\n')
  return trimmed ? `${block}${TEXT_AFTER_ATTACHMENTS_SEP}${trimmed}` : block
}
