import { normalizeUrl } from '../../engine/checks/url'
import type { DrillRegistry } from './drills'
import { scoreOf } from './overview'
import { urlPath, type ScopeData } from './rows'
import type {
  OtherOwnPage,
  OwnPageBar,
  PagesSection,
  ReportPage,
  ReportReference,
  ReportRow,
  TrackedPageRow,
  WrongPageItem
} from './types'

const NOISE =
  /(^|\/)(log-?in|sign-?in|sign-?up|register|account|my-account|cart|checkout|basket|privacy|privacy-policy|terms|terms-of-service|tos|legal|cookies?|cookie-policy|gdpr|imprint|impressum|unsubscribe|wp-login\.php|wp-admin)(\/|$|\?|\.)/i

/** True for login, legal, cart and similar pages that are rarely worth tracking. */
export function isLikelyNoise(url: string): boolean {
  return NOISE.test(urlPath(url))
}

function isOwn(reference: ReportReference): boolean {
  return reference.classification === 'target' || reference.classification === 'own'
}

/** Section 3, Your pages. */
export function buildPagesSection(
  scope: ScopeData,
  trackedPages: readonly ReportPage[],
  drills: DrillRegistry
): { section: PagesSection; otherOwnPages: ReportPage[] } {
  const trackedByUrl = new Map<string, ReportPage>()
  for (const page of trackedPages) {
    trackedByUrl.set(normalizeUrl(page.url) ?? page.url, page)
  }
  const own = scope.references.filter(isOwn)
  const byUrl = new Map<string, ReportReference[]>()
  for (const reference of own) {
    const list = byUrl.get(reference.normalizedUrl)
    if (list === undefined) byUrl.set(reference.normalizedUrl, [reference])
    else list.push(reference)
  }

  const citedPageIds = new Set<string>()
  for (const reference of own) {
    const page = trackedByUrl.get(reference.normalizedUrl)
    if (page !== undefined) citedPageIds.add(page.id)
  }
  for (const row of scope.rows) if (row.pageCited) citedPageIds.add(row.pageId)

  const mostCited: OwnPageBar[] = [...byUrl.entries()]
    .map(([normalized, list]) => {
      const tracked = trackedByUrl.get(normalized)
      const url = tracked?.url ?? list[0]?.url ?? normalized
      return {
        url,
        path: urlPath(url),
        tracked: tracked !== undefined,
        prompts: drills.count(
          `page:${normalized}`,
          list.map((reference) => reference.rowId)
        ),
        citations: list.length
      }
    })
    .sort((left, right) => right.prompts.n - left.prompts.n || left.path.localeCompare(right.path))
    .slice(0, 12)

  const tracked: TrackedPageRow[] = trackedPages.map((page) => {
    const rows = scope.rows.filter((row) => row.pageId === page.id)
    const ids = (predicate: (row: ReportRow) => boolean): string[] =>
      rows.filter(predicate).map((row) => row.id)
    const rowIds = new Set(rows.map((row) => row.id))
    const references = own.filter((reference) => rowIds.has(reference.rowId))
    const lastChecked = rows
      .map((row) => row.checkedAt)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1)
    return {
      pageId: page.id,
      url: page.url,
      path: page.path,
      title: page.title,
      score: scoreOf(rows.map((row) => row.status)),
      prompts: drills.count(
        `dim:page=${page.id}`,
        ids(() => true)
      ),
      aio: drills.count(
        `dim:page=${page.id}:aio`,
        ids((row) => row.aio)
      ),
      pageCited: drills.count(
        `dim:page=${page.id}:page-cited`,
        ids((row) => row.pageCited)
      ),
      ownCited: drills.count(
        `dim:page=${page.id}:cited`,
        ids((row) => row.cited)
      ),
      named: drills.count(
        `dim:page=${page.id}:named`,
        ids((row) => row.named)
      ),
      citationsTarget: references.filter((reference) => reference.classification === 'target')
        .length,
      citationsOtherOwn: references.filter((reference) => reference.classification === 'own')
        .length,
      lastChecked: lastChecked ?? null
    }
  })

  const otherOwn: OtherOwnPage[] = [...byUrl.entries()]
    .filter(
      ([normalized, list]) =>
        !trackedByUrl.has(normalized) && list.some((reference) => reference.untracked)
    )
    .map(([normalized, list]) => {
      const url = list[0]?.url ?? normalized
      return {
        url,
        path: urlPath(url),
        prompts: drills.count(
          `page:${normalized}`,
          list.map((reference) => reference.rowId)
        ),
        citations: list.length,
        likelyNoise: isLikelyNoise(url)
      }
    })
    .sort((left, right) => right.prompts.n - left.prompts.n || left.path.localeCompare(right.path))

  const wrongPage: WrongPageItem[] = scope.rows
    .filter((row) => row.wrongPage)
    .map((row) => ({
      rowId: row.id,
      prompt: row.text,
      citedUrl: row.citedUrl ?? '',
      trackedUrl: trackedPages.find((page) => page.id === row.pageId)?.url ?? '',
      marketId: row.marketId
    }))

  const otherOwnPages: ReportPage[] = otherOwn.map((page) => ({
    id: `own:${normalizeUrl(page.url) ?? page.url}`,
    url: page.url,
    path: page.path,
    title: own.find((reference) => reference.url === page.url)?.title ?? null,
    role: 'other_own'
  }))

  return {
    section: {
      empty:
        scope.rows.length === 0
          ? {
              title: 'Not measured yet',
              message: 'No full check has finished for these pages in this data window.',
              nextStep: 'Run a check to see which of your pages Google cites.'
            }
          : null,
      pagesTracked: trackedPages.length,
      pagesCited: citedPageIds.size,
      pagesNeverCited: trackedPages.filter((page) => !citedPageIds.has(page.id)).length,
      otherOwnCited: otherOwn.length,
      mostCited,
      tracked,
      otherOwn,
      wrongPage
    },
    otherOwnPages
  }
}
