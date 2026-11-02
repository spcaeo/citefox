import { useMemo, type JSX } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Plugin, PluggableList } from 'unified'

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

/**
 * Phrasing only. Tables, rules, and task-list checkboxes are unwrapped so
 * inline markdown can sit inside a button (NFR-13).
 */
const INLINE_ALLOWED = ['strong', 'em', 'del', 'code', 'a', 'br']

type AnchorProps = JSX.IntrinsicElements['a'] & ExtraProps
type ImageProps = JSX.IntrinsicElements['img'] & ExtraProps
type HeadingProps = JSX.IntrinsicElements['h2'] & ExtraProps

type MdNode = {
  type?: string
  value?: string
  alt?: string | null
  children?: MdNode[]
}

/**
 * Show raw HTML as text. `skipHtml` still drops any raw node this misses,
 * so a tag is never turned into an element.
 */
const remarkLiteralHtml: Plugin = () => (tree) => {
  if (isMdNode(tree)) rewriteHtml(tree)
}

/** Alt text only. An image has no children, so unwrapping it would drop the alt. */
const remarkInlineImages: Plugin = () => (tree) => {
  if (isMdNode(tree)) rewriteImages(tree)
}

/**
 * Safe markdown for prompts, AI Overview text, and summaries.
 *
 * There is no preload IPC for opening URLs (`shell:openExternal` is not a
 * channel). An allowed link is an anchor with `target="_blank"` and
 * `rel="noopener noreferrer"`, plus hidden text that the link opens in the
 * browser. Main's window-open handler denies that new window and calls
 * `shell.openExternal` for http(s). `will-navigate` does the same if the
 * click would load in this window.
 *
 * `baseLevel` is the page heading a markdown `#` maps to. It is not fixed at
 * h1. Images never become `<img>`. Inline mode allows only phrasing elements.
 * `plugins` run after GFM and `components` replace the defaults (block mode),
 * as `AnswerView` does for AI answers.
 */
export function Markdown({
  children,
  baseLevel = 2,
  inline = false,
  className,
  plugins,
  components: overrides
}: {
  children: string
  /** Page heading level that a markdown `#` becomes. Clamped to h1–h6. */
  baseLevel?: number
  /** Phrasing only, so the result can sit inside a button or another paragraph. */
  inline?: boolean
  className?: string
  /** Extra remark plugins, run after GFM. Block mode only. */
  plugins?: PluggableList
  /** Element renderers that replace the defaults. Block mode only. */
  components?: Components
}): JSX.Element | null {
  const level = clampLevel(baseLevel)
  const components = useMemo(
    () => ({ ...createComponents(level), ...(inline ? {} : overrides) }),
    [level, inline, overrides]
  )
  if (children.trim() === '') return null
  const classNames = ['md', inline ? 'md-inline' : 'md-block']
  if (className) classNames.push(className)
  const Wrapper = inline ? 'span' : 'div'
  return (
    <Wrapper className={classNames.join(' ')}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={
          inline
            ? [remarkLiteralHtml, remarkGfm, remarkInlineImages]
            : [remarkLiteralHtml, remarkGfm, ...(plugins ?? [])]
        }
        urlTransform={transformUrl}
        components={components}
        allowedElements={inline ? INLINE_ALLOWED : undefined}
        unwrapDisallowed={inline}
      >
        {children}
      </ReactMarkdown>
    </Wrapper>
  )
}

function createComponents(baseLevel: number): Components {
  return {
    a: MarkdownLink,
    img: MarkdownImage,
    h1: markdownHeading(baseLevel, 1),
    h2: markdownHeading(baseLevel, 2),
    h3: markdownHeading(baseLevel, 3),
    h4: markdownHeading(baseLevel, 4),
    h5: markdownHeading(baseLevel, 5),
    h6: markdownHeading(baseLevel, 6)
  }
}

function markdownHeading(baseLevel: number, markdownLevel: number): NonNullable<Components['h1']> {
  const tag = HEADING_TAGS[clampLevel(baseLevel + markdownLevel - 1) - 1] ?? 'h6'
  return function MarkdownHeading({ children, className }: HeadingProps): JSX.Element {
    const Tag = tag
    return <Tag className={className}>{children}</Tag>
  }
}

function MarkdownLink({ href, children }: AnchorProps): JSX.Element {
  const safe = safeHttpUrl(typeof href === 'string' ? href : undefined)
  if (safe === null) return <>{children}</>
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only"> (opens in your browser)</span>
    </a>
  )
}

/** Alt text only. The source is never written to the DOM, so nothing loads. */
function MarkdownImage({ alt }: ImageProps): JSX.Element | null {
  if (typeof alt !== 'string') return null
  const text = alt.trim()
  if (text === '') return null
  return <span className="md-alt">{text}</span>
}

function transformUrl(url: string): string {
  return safeHttpUrl(url) ?? ''
}

function safeHttpUrl(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.startsWith('//')) return null
  if (hasControlCharacter(trimmed)) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.href
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 2
  return Math.min(6, Math.max(1, Math.trunc(value)))
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function rewriteImages(node: MdNode): void {
  const children = node.children
  if (!children) return
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (!child) continue
    if (child.type === 'image' || child.type === 'imageReference') {
      const alt = typeof child.alt === 'string' ? child.alt.trim() : ''
      if (alt === '') {
        children.splice(index, 1)
        index -= 1
      } else {
        children[index] = { type: 'text', value: alt }
      }
      continue
    }
    rewriteImages(child)
  }
}

function rewriteHtml(node: MdNode): void {
  const children = node.children
  if (!children) return
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (!child) continue
    if (child.type === 'html' && typeof child.value === 'string') {
      children[index] = { type: 'text', value: child.value }
      continue
    }
    rewriteHtml(child)
  }
}

function isMdNode(value: unknown): value is MdNode {
  return typeof value === 'object' && value !== null
}
