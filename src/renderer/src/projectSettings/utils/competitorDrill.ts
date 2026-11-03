import type { CompetitorFindings, CompetitorOverviewRef, Market } from '@shared/domain'
import type { ItemDrill } from '../../drill'
import { displayUrl, formatStamp } from '../../m3/model'
import { marketLabel } from '../../shell/model'

/** The bare host of a listed competitor: "https://www.Twilio.com/" → "twilio.com". */
export function competitorHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

/** True when a cited host is the listed competitor or one of its subdomains. */
export function hostIsCompetitor(host: string, competitor: string): boolean {
  const want = competitorHost(competitor)
  const have = competitorHost(host)
  return want.length > 0 && (have === want || have.endsWith(`.${want}`))
}

/**
 * The overviews that cited `domain` (and its subdomains), one row each, from
 * the competitor finder's stored captures. The drawer total is the overview
 * count, so it equals "N overviews" (NFR-14). Each row opens Prompt detail in
 * that market and check.
 */
export function competitorDrill(
  found: CompetitorFindings,
  domain: string,
  options: { markets: readonly Market[]; brand: string; exact?: boolean }
): ItemDrill {
  const seen = new Map<string, CompetitorOverviewRef>()
  for (const candidate of found.candidates) {
    const match = options.exact
      ? candidate.domain === domain
      : hostIsCompetitor(candidate.domain, domain)
    if (!match) continue
    for (const ref of candidate.overviewRefs ?? []) {
      const known = seen.get(ref.overviewId)
      if (known) seen.set(ref.overviewId, { ...known, citations: known.citations + ref.citations })
      else seen.set(ref.overviewId, ref)
    }
  }
  const markets = new Map(options.markets.map((market) => [market.id, market]))
  const host = competitorHost(domain)
  return {
    kind: 'items',
    id: `competitor:${host}`,
    title: `AI Overviews citing ${host}`,
    description: `Every AI Overview in the latest checks that linked ${host} instead of ${found.domain}, one row per overview. Select a row to see that question's overview.`,
    noun: ['overview', 'overviews'],
    primaryLabel: 'Cited link',
    columns: [
      { id: 'page', label: 'Your page', width: 'minmax(96px, 0.8fr)' },
      { id: 'market', label: 'Market', width: '108px' },
      { id: 'links', label: 'Links', align: 'end', width: '56px' }
    ],
    items: [...seen.values()].map((ref) => {
      const market = markets.get(ref.marketId)
      return {
        id: ref.overviewId,
        primary: displayUrl(ref.url),
        mono: true,
        url: ref.url,
        secondary: `Question ${ref.promptPosition} · ${ref.promptLabel} · ${formatStamp(ref.checkedAt)}`,
        target: {
          kind: 'prompt',
          pageId: ref.pageId,
          promptId: ref.promptId,
          marketId: ref.marketId,
          runId: ref.runId
        },
        cells: {
          page: ref.pageLabel,
          market: market ? marketLabel(market) : ref.marketId,
          links: ref.citations
        }
      }
    }),
    note:
      seen.size === 0
        ? `${host} was not among the most cited domains in the latest checks.`
        : 'Links counts the links to this domain inside that overview.',
    scope: {
      pageId: null,
      marketId: null,
      runId: null,
      marketLabel: '',
      checkDateLabel: found.latestCheckAt ? formatStamp(found.latestCheckAt) : '',
      brand: options.brand,
      domain: found.domain
    }
  }
}
