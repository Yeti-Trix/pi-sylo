import React, { isValidElement, memo, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { ChatMarkdownPath, looksLikeFilePathReference } from './ChatMarkdownPath'
import { resolveChatMarkdownImageSrc } from './chatMarkdownImage'
import { CodeBlock } from './CodeBlock'
import { cn } from './lib/cn'

type Props = {
  text: string
  resolveImageUrl?: (path: string) => string | null
  workspaceId?: string
}

type MarkdownImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  resolveImageUrl?: (path: string) => string | null
}

function ChatMarkdownImage({
  src,
  alt,
  title,
  resolveImageUrl,
  className,
  ...rest
}: MarkdownImageProps): React.ReactElement {
  const [failed, setFailed] = useState(false)
  const resolvedSrc = resolveChatMarkdownImageSrc(src, resolveImageUrl)
  const label = (alt?.trim() || title?.trim() || src?.trim() || 'Image').trim()

  if (failed || !resolvedSrc) {
    return (
      <span
        className="inline-block rounded-md border border-border bg-bg-tertiary px-2 py-1 text-[0.82rem] text-text-secondary"
        title={src}
        role="img"
        aria-label={label}
      >
        {label}
      </span>
    )
  }

  return (
    <img
      {...rest}
      src={resolvedSrc}
      alt={alt ?? ''}
      title={title}
      className={cn(className)}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

// Doubled delimiters only: `~~strike~~` and `$$math$$`. Single `~`/`$` stay
// literal so currency ("~$87.5 billion", "$1.75T") renders verbatim instead of
// turning into strikethrough or whitespace-collapsing KaTeX inline math.
const REMARK_GFM_OPTS = { singleTilde: false } as const
const REMARK_MATH_OPTS = { singleDollarTextMath: false } as const

/** GFM (no single-tilde strike) + TeX math via `$$…$$` only, rendered with KaTeX. */
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  resolveImageUrl,
  workspaceId,
}: Props): React.ReactElement | null {
  const components = useMemo((): Components => {
    const Img = (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <ChatMarkdownImage {...props} resolveImageUrl={resolveImageUrl} />
    )
    const Anchor = ({
      children,
      ...props
    }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      // Main process intercepts these and opens them in the OS default browser.
      <a {...props} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    )
    const Code = ({
      className,
      children,
      ...props
    }: React.HTMLAttributes<HTMLElement>) => {
      const isBlock = Boolean(className?.includes('language-'))
      if (isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }
      const text = String(children).replace(/\n$/, '')
      if (looksLikeFilePathReference(text)) {
        return <ChatMarkdownPath rawPath={text} workspaceId={workspaceId} />
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
    const Pre = ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => {
      // react-markdown v10 renders a fenced block as <pre>{<Code .../>}</pre> —
      // the child is our custom `Code` component element (not a native <code>),
      // so we must NOT test children.type === 'code'. Read className + text from
      // the child's props directly, then route to CodeBlock (with copy buttons) or
      // the file-path chip.
      if (isValidElement(children)) {
        const childProps = children.props as { className?: string; children?: React.ReactNode }
        const className = childProps.className ?? ''
        const codeText = String(childProps.children ?? '').replace(/\n$/, '')
        // Plain (no-language) fenced/indented block that is just a file path →
        // keep the rich path chip instead of a code box.
        if (!className.includes('language-') && looksLikeFilePathReference(codeText.trim())) {
          return <ChatMarkdownPath rawPath={codeText.trim()} block workspaceId={workspaceId} />
        }
        return (
          <CodeBlock codeElement={<code className={className || undefined}>{codeText}</code>} />
        )
      }
      return <pre {...props}>{children}</pre>
    }
    return { img: Img, a: Anchor, code: Code, pre: Pre }
  }, [resolveImageUrl, workspaceId])

  const hasMath = text.includes('$$')

  if (!text.trim()) return null
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={
          hasMath ?
            [[remarkGfm, REMARK_GFM_OPTS], [remarkMath, REMARK_MATH_OPTS]]
          : [[remarkGfm, REMARK_GFM_OPTS]]
        }
        rehypePlugins={hasMath ? [rehypeKatex] : []}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
