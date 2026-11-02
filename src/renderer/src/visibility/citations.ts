import type { CitationClass, LeaderboardBadge, PageResults, PromptCheckRow } from '@shared/domain'
import { hostFromUrl } from '../m3/model'
import { pluralize } from '@shared/pluralize'

export function linkCountLabel(count: number): string {
  return pluralize(count, 'link')
}

export interface CountItem {
  id: string
  primary: string
  secondary: string
}

export interface CountSegment {
  id: string
  label: string
  count: number
  items: readonly CountItem[]
}

export interface CitationListRow {
  id: string
  promptId: string
  promptPosition: number
  promptLabel: string
  position: number
  domain: string
  /** Shown URL, without the scheme. */
  url: string
  /** The cited URL as Google listed it, opened in the browser. */
  href: string
  classification: CitationClass
  classLabel: string
}

export type LeaderKind = 'You' | 'Tracked' | 'Observed'

export function classLabel(classification: CitationClass): string {
  switch (classification) {
    case 'target':
      return 'This page'
    case 'own':
      return 'Own'
    case 'competitor':
      return 'Competitor'
    case 'other':
      return 'Other'
  }
}

export function leaderKind(badge: LeaderboardBadge): LeaderKind {
  if (badge === 'you') return 'You'
  if (badge === 'tracked') return 'Tracked'
  return 'Observed'
}

export function leaderTypeLabel(kind: LeaderKind): string {
  return kind === 'Tracked' ? 'Tracked competitor' : kind
}

/** Own-domain links. This page + other own pages = the total. Units are links. */
export function linkSegments(results: PageResults): {
  total: number
  thisPage: CountSegment
  otherOwn: CountSegment
} {
  const domain = hostFromUrl(results.scope.pageUrl)
  const thisItems: CountItem[] = []
  const otherItems: CountItem[] = []
  for (const prompt of results.prompts) {
    for (const ref of prompt.references) {
      const item: CountItem = {
        id: ref.id,
        primary: ref.domain,
        secondary: `Question ${prompt.promptPosition} · ${prompt.label} · position ${ref.position}`
      }
      if (ref.classification === 'target') thisItems.push(item)
      else if (ref.classification === 'own') otherItems.push(item)
    }
  }
  return {
    total: thisItems.length + otherItems.length,
    thisPage: {
      id: 'this_page',
      label: 'to this page',
      count: thisItems.length,
      items: thisItems
    },
    otherOwn: {
      id: 'other_own',
      label: `to other ${domain} pages`,
      count: otherItems.length,
      items: otherItems
    }
  }
}

export function ownLinkPromptIds(results: PageResults): readonly string[] {
  return results.prompts
    .filter((row) =>
      row.references.some((ref) => ref.classification === 'target' || ref.classification === 'own')
    )
    .map((row) => row.promptId)
}

export function citationRows(results: PageResults): CitationListRow[] {
  const rows: CitationListRow[] = []
  for (const prompt of results.prompts) {
    for (const ref of prompt.references) {
      rows.push({
        id: ref.id,
        promptId: prompt.promptId,
        promptPosition: prompt.promptPosition,
        promptLabel: prompt.label,
        position: ref.position,
        domain: ref.domain,
        url: ref.normalizedUrl.replace(/^https?:\/\//, ''),
        href: ref.url,
        classification: ref.classification,
        classLabel: classLabel(ref.classification)
      })
    }
  }
  return rows
}

export function filterCitations(
  rows: readonly CitationListRow[],
  query: string,
  classification: CitationClass | 'all'
): CitationListRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (classification !== 'all' && row.classification !== classification) return false
    if (needle.length === 0) return true
    return (
      row.domain.toLowerCase().includes(needle) ||
      row.url.toLowerCase().includes(needle) ||
      row.promptLabel.toLowerCase().includes(needle)
    )
  })
}

export function promptsMatching(results: PageResults, ids: readonly string[]): PromptCheckRow[] {
  const wanted = new Set(ids)
  return results.prompts.filter((row) => wanted.has(row.promptId))
}

/** Synthetic rows for the NFR-12 check. Not a channel payload. */
export function manyCitationRows(count: number): CitationListRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `cite-${index}`,
    promptId: `p-${index}`,
    promptPosition: index + 1,
    promptLabel: `Question ${index + 1}`,
    position: (index % 8) + 1,
    domain: `example${index % 50}.com`,
    url: `example${index % 50}.com/page-${index}`,
    href: `https://example${index % 50}.com/page-${index}`,
    classification: 'other',
    classLabel: 'Other'
  }))
}
