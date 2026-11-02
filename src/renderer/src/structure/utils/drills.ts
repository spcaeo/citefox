import type { ClusterSummary, PageStatus, SitemapRecord } from '@shared/domain'
import type { ImportCandidate } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { DrillItem, DrillScope, DrillTarget, ItemDrill } from '../../drill'
import type { PageTabId } from '../../shell/routes'
import { isTrackedStatus, pagePath, sitemapFile } from './model'

/** Site structure drawers are project-wide: no page, market or check in the head. */
export const PROJECT_SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: '',
  brand: '',
  domain: ''
}

/** A page row in a structure drawer. */
export interface DrillPage {
  pageId: string | null
  url: string
  title: string | null
  status: PageStatus | null
  score?: number | null
}

/**
 * Where a page row opens: a tracked page opens its tab in CiteFox; a page
 * with no checks opens in the browser, never an empty Results tab.
 */
export function pageTarget(page: DrillPage, tab: PageTabId = 'results'): DrillTarget | null {
  if (page.pageId !== null && isTrackedStatus(page.status)) {
    return { kind: 'page', pageId: page.pageId, tab }
  }
  return { kind: 'url', url: page.url }
}

function statusLabel(status: PageStatus | null): string {
  if (status === null) return 'Not in CiteFox yet'
  if (status === 'tracked') return 'Tracked'
  if (status === 'setting_up') return 'Setting up'
  if (status === 'paused') return 'Paused'
  if (status === 'removed') return 'Removed'
  return 'Not tracked'
}

function pageItem(page: DrillPage, tab: PageTabId): DrillItem {
  const path = pagePath(page.url)
  return {
    id: page.pageId ?? page.url,
    primary: page.title?.trim() || path,
    secondary: page.title?.trim() ? path : null,
    target: pageTarget(page, tab),
    cells: {
      status: statusLabel(page.status),
      score: page.score === undefined || page.score === null ? '—' : page.score
    },
    group: isTrackedStatus(page.status) ? 'tracked' : 'untracked'
  }
}

/**
 * Pages behind a count (a cluster's pages, a silo's tracked pages, …). One
 * row per page, so the drawer total is the page count that was clicked.
 */
export function pagesDrill(options: {
  id: string
  title: string
  description: string
  pages: readonly DrillPage[]
  /** The tab a tracked page opens on. Scores open Progress. */
  tab?: PageTabId
  note?: string
}): ItemDrill {
  const tab = options.tab ?? 'results'
  const items = options.pages.map((page) => pageItem(page, tab))
  const mixed =
    items.some((item) => item.group === 'tracked') &&
    items.some((item) => item.group === 'untracked')
  return {
    kind: 'items',
    id: options.id,
    title: options.title,
    description: options.description,
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'status', label: 'Status', width: '120px' },
      { id: 'score', label: 'Score', align: 'end', width: '64px' }
    ],
    items,
    ...(mixed
      ? {
          summary: [
            { label: 'Tracked', group: 'tracked' },
            { label: 'Not tracked', group: 'untracked' }
          ]
        }
      : {}),
    note:
      options.note ??
      'Select a tracked page to open it in CiteFox. A page with no checks opens in your browser.',
    scope: PROJECT_SCOPE
  }
}

/**
 * The page scores behind an average: tracked pages with a score, lowest
 * first. Each row opens the page's Progress tab.
 */
export function scoresDrill(options: {
  id: string
  name: string
  average: number | null
  pages: readonly DrillPage[]
}): ItemDrill {
  const scored = options.pages
    .filter(
      (page) => isTrackedStatus(page.status) && page.score !== null && page.score !== undefined
    )
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0))
  return pagesDrill({
    id: options.id,
    title: `Page scores in ${options.name}`,
    description:
      options.average === null
        ? 'No tracked page here has a score yet.'
        : `The average score ${options.average} is the mean of these ${pluralize(scored.length, 'tracked page')} in each page's default market. Lowest first.`,
    pages: scored,
    tab: 'progress',
    note: 'Select a page to open its Progress tab: what changed and why.'
  })
}

/** The prompts behind one cluster theme. Each row opens Prompt detail. */
export function themeDrill(cluster: ClusterSummary, theme: string): ItemDrill | null {
  const found = cluster.themePrompts?.find((entry) => entry.theme === theme)
  if (!found) return null
  return {
    kind: 'items',
    id: `theme:${cluster.id}:${theme}`,
    title: `Questions about “${theme}”`,
    description: `The active questions in ${cluster.name} behind this theme, across its pages.`,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    columns: [{ id: 'page', label: 'Page', width: 'minmax(120px, 0.8fr)' }],
    items: found.prompts.map((prompt) => ({
      id: `${prompt.pageId}:${prompt.promptId}`,
      primary: prompt.label.split('**').join(''),
      secondary: `Question ${prompt.position}`,
      target: { kind: 'prompt', pageId: prompt.pageId, promptId: prompt.promptId },
      cells: { page: prompt.pageLabel }
    })),
    note: 'Select a question to see its AI Overview in the page’s default market.',
    scope: PROJECT_SCOPE
  }
}

/** Child sitemaps of a sitemap index. */
export function childSitemapsDrill(
  record: SitemapRecord,
  all: readonly SitemapRecord[]
): ItemDrill {
  const children = all.filter((item) => item.parentId === record.id)
  return {
    kind: 'items',
    id: `sitemap:${record.id}`,
    title: `Sitemaps in ${sitemapFile(record.url)}`,
    description: 'The sitemaps this index lists. Each opens in your browser.',
    noun: ['sitemap', 'sitemaps'],
    primaryLabel: 'Sitemap',
    columns: [
      { id: 'urls', label: 'URLs', align: 'end', width: '72px' },
      { id: 'included', label: 'Included', width: '84px' }
    ],
    items: children.map((child) => ({
      id: child.id,
      primary: sitemapFile(child.url),
      mono: true,
      url: child.url,
      target: { kind: 'url', url: child.url },
      cells: { urls: child.pageCount, included: child.included ? 'Yes' : 'No' }
    })),
    scope: PROJECT_SCOPE
  }
}

/** A candidate row as a drawer page. */
export function candidatePage(row: ImportCandidate): DrillPage {
  return { pageId: row.pageId, url: row.url, title: row.title, status: row.status }
}

/** True when a page's deepest silo is this silo or one under it. */
export function inSilo(row: ImportCandidate, path: string): boolean {
  if (path === '/') return true
  return (row.siloPath ?? '/').startsWith(path)
}

/**
 * The pages a sitemap lists now. The sitemap's own URL count can include
 * URLs CiteFox no longer keeps (removed pages), so the description says when
 * the two differ.
 */
export function sitemapPagesDrill(
  record: SitemapRecord,
  rows: readonly ImportCandidate[]
): ItemDrill {
  const pages = rows.filter((row) => row.sitemapIds?.includes(record.id)).map(candidatePage)
  const file = sitemapFile(record.url)
  const differs = pages.length !== record.pageCount
  return pagesDrill({
    id: `sitemap:${record.id}`,
    title: `Pages in ${file}`,
    description: differs
      ? `${file} listed ${pluralize(record.pageCount, 'URL')} at its last read. ${pluralize(pages.length, 'page')} of them are in CiteFox now; removed pages are left out.`
      : `Every page ${file} lists.`,
    pages
  })
}
