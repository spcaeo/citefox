import type { CitedSiteRow, CompetitorQuestionRef } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { DrillItem, DrillScope, ItemDrill } from '../drill'
import { kindKeyOf, siteUrl, type KindKey } from './model'

/**
 * The drills behind the Competitors numbers: a row's citations (every link), the
 * searches citing it and the searches naming it; every link in scope; the new sites;
 * each kind's sites and links. Each list is the screen's own data, so the drawer total
 * equals the number clicked. Pure.
 */

export interface CompetitorDrillScope {
  marketLabel: string
  brand: string
  domain: string
}

function scopeOf(scope: CompetitorDrillScope): DrillScope {
  return {
    pageId: null,
    marketId: null,
    runId: null,
    marketLabel: scope.marketLabel,
    checkDateLabel: 'Latest checks',
    brand: scope.brand,
    domain: scope.domain
  }
}

function questionItem(item: CompetitorQuestionRef, links: boolean): DrillItem {
  return {
    id: item.id,
    primary: item.promptText,
    secondary: item.pageKind === 'topic' ? `Topic · ${item.pageLabel}` : item.pageLabel,
    target: {
      kind: 'prompt',
      pageId: item.pageId,
      promptId: item.promptId,
      marketId: item.marketId,
      runId: item.runId
    },
    cells: links
      ? { links: item.links, position: item.position === null ? '—' : `#${item.position}` }
      : {}
  }
}

/** Every link to the site in the latest checks (the Citations cell, and Your share). */
export function citationsDrill(row: CitedSiteRow, scope: CompetitorDrillScope): ItemDrill {
  return {
    kind: 'items',
    id: `cmp:citations:${row.id}`,
    title: `Links to ${row.name}`,
    description: `Every link AI Overviews gave to ${row.name} in the latest checks.`,
    noun: ['link', 'links'],
    primaryLabel: 'Link',
    columns: [
      { id: 'question', label: 'Question', width: 'minmax(160px, 1fr)' },
      { id: 'position', label: 'Position', align: 'end', width: 'minmax(72px, 0.3fr)' }
    ],
    items: row.links.map((link) => ({
      id: link.id,
      primary: link.url,
      mono: true,
      url: link.url,
      target: {
        kind: 'prompt',
        pageId: link.pageId,
        promptId: link.promptId,
        marketId: link.marketId,
        runId: link.runId
      },
      cells: { question: link.promptText, position: `#${link.position}` }
    })),
    scope: scopeOf(scope)
  }
}

/** The searches whose latest AI Overview cites the site (the Searches cell). */
export function questionsDrill(row: CitedSiteRow, scope: CompetitorDrillScope): ItemDrill {
  return {
    kind: 'items',
    id: `cmp:questions:${row.id}`,
    title: `Searches citing ${row.name}`,
    description: `Searches whose latest AI Overview links to ${row.name}: ${pluralize(row.citations, 'link')} in all.`,
    noun: ['search', 'searches'],
    primaryLabel: 'Search',
    columns: [
      { id: 'links', label: 'Links', align: 'end', width: 'minmax(64px, 0.3fr)' },
      { id: 'position', label: 'Best', align: 'end', width: 'minmax(64px, 0.3fr)' }
    ],
    items: row.citedQuestions.map((item) => questionItem(item, true)),
    scope: scopeOf(scope)
  }
}

/** The searches whose latest AI Overview names the company in its text (the Named cell). */
export function namedDrill(row: CitedSiteRow, scope: CompetitorDrillScope): ItemDrill {
  return {
    kind: 'items',
    id: `cmp:named:${row.id}`,
    title: `Searches naming ${row.name}`,
    description: `Searches whose latest AI Overview names ${row.name} in its text.`,
    noun: ['search', 'searches'],
    primaryLabel: 'Search',
    items: row.namedQuestions.map((item) => questionItem(item, false)),
    scope: scopeOf(scope)
  }
}

function linkItem(link: CitedSiteRow['links'][number], row: CitedSiteRow): DrillItem {
  return {
    id: link.id,
    primary: link.url,
    mono: true,
    url: link.url,
    secondary: link.promptText,
    target: {
      kind: 'prompt',
      pageId: link.pageId,
      promptId: link.promptId,
      marketId: link.marketId,
      runId: link.runId
    },
    cells: { site: row.kind === 'you' ? 'Your site' : row.name, position: `#${link.position}` },
    group: row.kind === 'you' ? 'you' : row.kind
  }
}

/**
 * The same link can sit under two rows (one answer citing a site counted twice), and
 * the list grid needs one id per row: a repeat gets `#2`, `#3`… (a duplicate key made
 * the links drill loop until React gave up: "Maximum update depth exceeded").
 */
export function uniqueIds(items: readonly DrillItem[]): DrillItem[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const count = (seen.get(item.id) ?? 0) + 1
    seen.set(item.id, count)
    return count === 1 ? item : { ...item, id: `${item.id}#${count}` }
  })
}

const LINK_COLUMNS = [
  { id: 'site', label: 'Site', width: 'minmax(120px, 0.6fr)' },
  { id: 'position', label: 'Position', align: 'end' as const, width: '84px' }
]

/**
 * Every link in scope ("of 150 links" and the share itself): your links first, then
 * saved competitors' and every other site's, so the list is as long as the total.
 */
export function allLinksDrill(
  rows: readonly CitedSiteRow[],
  scope: CompetitorDrillScope
): ItemDrill {
  const ordered = [
    ...rows.filter((row) => row.kind === 'you'),
    ...rows.filter((row) => row.kind !== 'you')
  ]
  return {
    kind: 'items',
    id: 'cmp:links',
    title: 'Links in AI Overviews',
    description: `Every link AI Overviews gave in the latest checks, once per question. Your share is your links ÷ all of them (${scope.domain} first).`,
    noun: ['link', 'links'],
    primaryLabel: 'Link',
    columns: LINK_COLUMNS,
    items: uniqueIds(ordered.flatMap((row) => row.links.map((link) => linkItem(link, row)))),
    summary: [
      { label: 'Your site', group: 'you' },
      { label: 'Competitors', group: 'competitor' },
      { label: 'Other sites', group: 'other' }
    ],
    note: 'Select a link to open its question on that check, or its address to open the page.',
    scope: scopeOf(scope)
  }
}

/** One site as a drill row: its host, its links and questions; it opens its row. */
function siteItem(row: CitedSiteRow, siteHref: (id: string) => string): DrillItem {
  return {
    id: row.id,
    primary: row.domain ?? row.name,
    mono: row.domain !== null,
    url: row.domain === null ? null : siteUrl(row.domain),
    secondary: row.domain !== null && row.domain !== row.name ? row.name : null,
    target: row.kind === 'you' ? null : { kind: 'hash', hash: siteHref(row.id) },
    cells: { citations: row.citations, questions: row.questions }
  }
}

const SITE_COLUMNS = [
  { id: 'citations', label: 'Citations', align: 'end' as const, width: '96px' },
  { id: 'questions', label: 'Searches', align: 'end' as const, width: '96px' }
]

/** The sites first cited in the period ("New sites cited"). */
export function newSitesDrill(
  rows: readonly CitedSiteRow[],
  scope: CompetitorDrillScope,
  period: number,
  siteHref: (id: string) => string
): ItemDrill {
  return {
    kind: 'items',
    id: 'cmp:new',
    title: 'New sites cited',
    description: `Sites the AI Overviews cite now that no check cited ${period} days ago.`,
    noun: ['site', 'sites'],
    primaryLabel: 'Site',
    columns: SITE_COLUMNS,
    items: rows.filter((row) => row.isNew).map((row) => siteItem(row, siteHref)),
    note: 'Select a site to see where it is cited and you are not.',
    scope: scopeOf(scope)
  }
}

/**
 * The sites of one kind in "Who else the AI answers cite" (the Sites cell): every
 * site other than yours of that kind cited in either check, as `kindTable` counts them.
 */
export function kindSitesDrill(
  kind: KindKey,
  label: string,
  rows: readonly CitedSiteRow[],
  scope: CompetitorDrillScope,
  siteHref: (id: string) => string
): ItemDrill {
  return {
    kind: 'items',
    id: `cmp:kind:${kind}:sites`,
    title: `${label}: sites cited`,
    description: `Sites of this type the AI Overviews cite now or cited at the period start.`,
    noun: ['site', 'sites'],
    primaryLabel: 'Site',
    columns: SITE_COLUMNS,
    items: kindSites(kind, rows).map((row) => siteItem(row, siteHref)),
    note: 'Select a site to see where it is cited and you are not.',
    scope: scopeOf(scope)
  }
}

/** Every link to the sites of one kind in the latest checks (the Citations now cell). */
export function kindLinksDrill(
  kind: KindKey,
  label: string,
  rows: readonly CitedSiteRow[],
  scope: CompetitorDrillScope
): ItemDrill {
  return {
    kind: 'items',
    id: `cmp:kind:${kind}:links`,
    title: `${label}: links now`,
    description: 'Every link AI Overviews gave to sites of this type in the latest checks.',
    noun: ['link', 'links'],
    primaryLabel: 'Link',
    columns: LINK_COLUMNS,
    items: uniqueIds(
      kindSites(kind, rows).flatMap((row) => row.links.map((link) => linkItem(link, row)))
    ),
    note: 'Select a link to open its question on that check, or its address to open the page.',
    scope: scopeOf(scope)
  }
}

function kindSites(kind: KindKey, rows: readonly CitedSiteRow[]): CitedSiteRow[] {
  return rows.filter(
    (row) =>
      row.kind !== 'you' &&
      kindKeyOf(row) === kind &&
      (row.citations > 0 || (row.startCitations ?? 0) > 0)
  )
}
