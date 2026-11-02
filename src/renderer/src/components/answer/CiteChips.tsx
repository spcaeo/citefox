import { useState, type JSX } from 'react'
import { safeExternalUrl } from '../../drill/targets'
import { SiteIcon } from '../../siteIcon/SiteIcon'
import { hostOf } from '../../ui/urlTextModel'
import { siteName, type CiteKind } from './model'
import type { Cite } from './remarkAnswer'

/** Chips shown in a run before "+N". */
const CHIPS_SHOWN = 3

const KIND_NOTE: Record<CiteKind, string> = {
  own: 'Your site',
  competitor: 'Competitor',
  other: ''
}

/**
 * The sources an answer cites after a sentence, as small site chips (Google's
 * and ChatGPT's source pills): the site's icon and short name, the page title
 * in the tooltip, opening in the browser. The owner's site is marked yellow, a
 * competitor's with a warning edge. Main's window-open handler sends the
 * `target="_blank"` link to the system browser, as for any markdown link.
 */
export function CiteChips({
  cites,
  kindOf
}: {
  cites: readonly Cite[]
  kindOf: (url: string) => CiteKind
}): JSX.Element | null {
  const [all, setAll] = useState(false)
  const sites = bySite(cites)
  if (sites.length === 0) return null
  const shown = all ? sites : sites.slice(0, CHIPS_SHOWN)
  const hidden = sites.length - shown.length
  return (
    <span className="ans-cites-row">
      {shown.map((pages) => (
        <Chip key={pages[0]?.url} pages={pages} kind={siteKind(pages, kindOf)} />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          className="ans-chip ans-chip-more"
          aria-label={`Show ${hidden} more ${hidden === 1 ? 'source' : 'sources'}`}
          onClick={() => setAll(true)}
        >
          +{hidden}
        </button>
      ) : null}
    </span>
  )
}

/**
 * One chip per site, in the order cited: two pages on twilio.com after one
 * sentence read as one "twilio.com 2" chip, as Google groups them. Links that
 * are not web addresses are dropped.
 */
function bySite(cites: readonly Cite[]): Cite[][] {
  const sites = new Map<string, Cite[]>()
  for (const cite of cites) {
    const url = safeExternalUrl(cite.url)
    if (url === null) continue
    const name = siteName(url)
    sites.set(name, [...(sites.get(name) ?? []), { ...cite, url }])
  }
  return [...sites.values()]
}

/** The owner's page wins, then a competitor's, for a site cited with several pages. */
function siteKind(pages: readonly Cite[], kindOf: (url: string) => CiteKind): CiteKind {
  const kinds = pages.map((page) => kindOf(page.url))
  if (kinds.includes('own')) return 'own'
  return kinds.includes('competitor') ? 'competitor' : 'other'
}

/** Opens the site's first page; the tooltip lists every page cited there. */
function Chip({ pages, kind }: { pages: readonly Cite[]; kind: CiteKind }): JSX.Element {
  const first = pages[0] as Cite
  const host = hostOf(first.url) ?? first.url
  const name = siteName(first.url)
  const note = KIND_NOTE[kind]
  const titles = pages.map((page) => page.title || hostOf(page.url) || page.url)
  const tooltip = [...titles, host, note].filter(Boolean).join('\n')
  const label =
    pages.length === 1
      ? `${titles[0]}, ${host}`
      : `${pages.length} pages on ${host}: ${titles.join('; ')}`
  return (
    <a
      className={kind === 'other' ? 'ans-chip' : `ans-chip is-${kind}`}
      href={first.url}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      data-kind={kind}
      aria-label={`${label}${note ? `, ${note.toLowerCase()}` : ''} (opens in your browser)`}
    >
      <SiteIcon domain={host} />
      <span className="ans-chip-name">{name}</span>
      {pages.length > 1 ? (
        <span className="ans-chip-count" aria-hidden="true">
          {pages.length}
        </span>
      ) : null}
    </a>
  )
}
