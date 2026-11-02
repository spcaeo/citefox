import { useRef, type JSX, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { SiteIcon } from '../siteIcon/SiteIcon'
import { UiIcon } from './UiIcon'
import { useCopyFeedback } from './useCopyFeedback'
import { resolveUrlText, splitLabel, type UrlTextVariant } from './urlTextModel'

export { COPIED_MS } from './useCopyFeedback'
export type { UrlTextVariant } from './urlTextModel'

export interface UrlTextProps {
  /** A full address, or a site path with `site` / `siteBase`. */
  url?: string
  /** A domain only (`twilio.com`): shown in the UI font; Open goes to its home page. */
  domain?: string
  /** A path on a site (`/pricing/`): shown short; Copy and Open use the full URL built from `siteBase`. */
  path?: string
  /** The address of the site a path belongs to (`example.com` or `https://example.com`). */
  siteBase?: string | null
  /** The same as `siteBase` (the original name). */
  site?: string | null
  /** What is shown, such as the path or a title. Default: the address without `https://www.`. */
  label?: string
  /** The look: `url` and `path` in the code font, `domain` in the UI font. Default: from the props. */
  variant?: UrlTextVariant
  /** The site's icon in front. Default on; nothing is shown for a path with no site. */
  icon?: boolean
  /** The project's own site: the text keeps the yellow highlighter. */
  own?: boolean
  /** A short note after the text, such as `you` or `rival · vendor`. */
  kind?: string
  /** Shows the text in the UI font instead of the code font. */
  plain?: boolean
  /**
   * Where a long label is cut. `middle` (default) keeps the domain and the last
   * segment; `end` cuts once at the end, for a narrow cell where the last segment
   * alone would be cut too.
   */
  cut?: 'middle' | 'end'
  /**
   * Own content in place of the text, such as an in-app link to the page's
   * screen: the icon, Copy and Open stay; the content keeps its own focus and keys.
   */
  children?: ReactNode
  className?: string
}

/**
 * Every URL, domain or site path on screen (UrlStates board). The site's icon
 * sits in front; hovering or focusing reveals Copy and Open in a new tab at the
 * end (always shown on touch screens, which have no hover). A copy turns the
 * icon into a green tick for 1.5 s and says "Copied", then the icons hide until
 * the pointer or focus comes back; Open hides them too. With the text focused,
 * Enter copies and ⌘ Enter (Ctrl Enter) opens. A long address is cut in the
 * middle of its path, never the domain; the full URL is in the tooltip and is
 * always what is copied and opened.
 */
export function UrlText({
  url,
  domain,
  path,
  siteBase,
  site,
  label,
  variant,
  icon = true,
  own = false,
  kind,
  plain = false,
  cut = 'middle',
  children,
  className
}: UrlTextProps): JSX.Element {
  const target = resolveUrlText({ url, domain, path, site: siteBase ?? site, label, variant })
  const feedback = useCopyFeedback(target.href)
  const openRef = useRef<HTMLAnchorElement>(null)
  const parts = cut === 'end' ? null : splitLabel(target.label)
  const classes = [
    'ui-url',
    `ui-url-${target.variant}`,
    plain ? 'ui-url-plain' : '',
    own ? 'ui-url-own' : '',
    feedback.state === 'copied' ? 'ui-url-copied' : '',
    feedback.state === 'failed' ? 'ui-url-failed' : '',
    feedback.done ? 'ui-url-done' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')
  const shown = target.label

  function onKeyDown(event: KeyboardEvent<HTMLSpanElement>): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    if ((event.metaKey || event.ctrlKey) && openRef.current !== null) openRef.current.click()
    else feedback.copy()
  }

  return (
    <span
      className={classes}
      data-url-text={target.variant}
      onMouseLeave={feedback.onMouseLeave}
      onBlur={feedback.onBlur}
    >
      {icon && target.iconDomain !== null ? <SiteIcon domain={target.iconDomain} /> : null}
      {children !== undefined ? (
        <span className="ui-url-value ui-url-custom" title={target.href}>
          {children}
        </span>
      ) : (
        <span
          className="ui-url-value"
          title={target.href}
          // Tab reaches the text first: Enter copies, ⌘ Enter opens (UrlStates board).
          tabIndex={0}
          aria-keyshortcuts={target.openable ? 'Enter Meta+Enter Control+Enter' : 'Enter'}
          onKeyDown={onKeyDown}
        >
          {parts === null ? (
            shown
          ) : (
            <>
              {parts.head ? <span className="ui-url-head">{parts.head}</span> : null}
              <span className="ui-url-middle">{parts.middle}</span>
              {/* The end is cut at its start ("…alerts-for-business/"), never its end. */}
              <span className="ui-url-tail">
                <bdi>{parts.tail}</bdi>
              </span>
            </>
          )}
        </span>
      )}
      {kind ? <span className="ui-url-kind">{kind}</span> : null}
      <span className="ui-url-actions">
        <button
          type="button"
          className="ui-url-btn ui-url-copy"
          aria-label={copyLabel(feedback.state, shown)}
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            feedback.copy()
          }}
        >
          <UiIcon name={copyIcon(feedback.state)} size={14} />
        </button>
        {target.openable ? (
          <a
            ref={openRef}
            className="ui-url-btn ui-url-open"
            href={target.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${shown} in a new tab`}
            onClick={(event) => {
              event.stopPropagation()
              event.currentTarget.blur()
              feedback.finish()
            }}
          >
            <UiIcon name="external" size={14} />
          </a>
        ) : null}
      </span>
    </span>
  )
}

/** A domain with its icon, Copy and Open (opens the home page): `<DomainText domain="twilio.com" />`. */
export function DomainText(
  props: Omit<UrlTextProps, 'url' | 'path' | 'domain'> & { domain: string }
): JSX.Element {
  return <UrlText {...props} />
}

function copyLabel(state: 'idle' | 'copied' | 'failed', shown: string): string {
  if (state === 'copied') return `Copied ${shown}`
  if (state === 'failed') return `Couldn't copy ${shown}`
  return `Copy ${shown}`
}

function copyIcon(state: 'idle' | 'copied' | 'failed'): 'check' | 'x' | 'copy' {
  if (state === 'copied') return 'check'
  if (state === 'failed') return 'x'
  return 'copy'
}
