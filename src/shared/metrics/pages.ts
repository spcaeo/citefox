import { changeStatus, DAY_BUCKETS, dayBucket, daysLive } from '../fix-loop'
import { targetPageKey } from '../target-page'
import { beforeAfter, type BreakdownInput } from './breakdowns'
import { countOf, countRows, isCitedRow } from './counts'
import type {
  MetricPage,
  MetricRow,
  PageGroupRow,
  PageMetrics,
  PageRow,
  SpeedBucket
} from './types'

/** One page whatever its scheme, `www.` or trailing slash. */
export function pageKey(url: string): string {
  return targetPageKey(url) ?? url
}

function citesPage(row: MetricRow, key: string): boolean {
  return isCitedRow(row) && row.citedUrl !== null && pageKey(row.citedUrl) === key
}

/** One fact per page: the newest go-live when the ledger logs a page more than once. */
function factsByPage(pages: readonly MetricPage[]): Map<string, MetricPage> {
  const out = new Map<string, MetricPage>()
  for (const page of pages) {
    const key = pageKey(page.url)
    const known = out.get(key)
    if (known === undefined || (page.liveSince ?? '') > (known.liveSince ?? '')) out.set(key, page)
  }
  return out
}

/**
 * Your pages before → after: every published page, plus every page of yours an answer
 * cites. `at` is the moment days live are counted to (the `to` end).
 */
export function pageMetrics(
  input: BreakdownInput,
  pages: readonly MetricPage[],
  at: string | null
): PageMetrics {
  const facts = factsByPage(pages)
  const urls = new Map<string, string>()
  for (const [key, page] of facts) urls.set(key, page.url)
  const addCited = (row: MetricRow): void => {
    if (!isCitedRow(row) || row.citedUrl === null) return
    const key = pageKey(row.citedUrl)
    if (!urls.has(key)) urls.set(key, row.citedUrl)
  }
  input.to.forEach(addCited)
  for (const pair of input.compared ?? []) {
    addCited(pair.from)
    addCited(pair.to)
  }
  const rows: PageRow[] = [...urls].map(([key, url]) => {
    const fact = facts.get(key)
    const cited = beforeAfter(input, (row) => citesPage(row, key))
    const liveSince = fact?.liveSince ?? null
    const days = liveSince === null || at === null ? null : daysLive(liveSince, at)
    const lost =
      input.compared?.filter((pair) => citesPage(pair.from, key) && !citesPage(pair.to, key))
        .length ?? 0
    return {
      url,
      title: fact?.title ?? null,
      kind: fact?.kind ?? null,
      liveSince,
      daysLive: days,
      indexed: fact?.indexed ?? null,
      cited,
      change: cited.before === null || cited.after === null ? null : cited.after.n - cited.before.n,
      status: changeStatus({
        daysLive: days,
        citedBefore: cited.before?.n ?? 0,
        citedNow: cited.now.n,
        lost,
        measuredSinceLive:
          input.compared !== null && (liveSince === null || (at !== null && at >= liveSince))
      })
    }
  })
  rows.sort(
    (left, right) =>
      right.cited.now.n - left.cited.now.n ||
      (right.liveSince ?? '').localeCompare(left.liveSince ?? '') ||
      left.url.localeCompare(right.url)
  )
  const published = rows.filter((row) => facts.has(pageKey(row.url)))
  const urlsOf = (list: readonly PageRow[]): ReturnType<typeof countOf> =>
    countOf(list.map((row) => row.url))
  return {
    rows,
    groups: pageGroups(input, facts),
    speed: speedBuckets(input, published),
    published: urlsOf(published),
    newPages: urlsOf(published.filter((row) => row.kind === 'new')),
    rewrites: urlsOf(published.filter((row) => row.kind === 'rewrite')),
    citedNow: urlsOf(published.filter((row) => row.cited.now.n > 0)),
    notCitedYet: urlsOf(published.filter((row) => row.status === 'not_cited')),
    tooNew: urlsOf(published.filter((row) => row.status === 'too_new')),
    lostGround: urlsOf(published.filter((row) => row.status === 'lost')),
    notIndexed: urlsOf(published.filter((row) => row.indexed === false))
  }
}

/** Cited questions by the kind of page cited: new, rewritten, or any other page of yours. */
function pageGroups(input: BreakdownInput, facts: ReadonlyMap<string, MetricPage>): PageGroupRow[] {
  const kindOf = (row: MetricRow): PageGroupRow['kind'] | null => {
    if (!isCitedRow(row) || row.citedUrl === null) return null
    return facts.get(pageKey(row.citedUrl))?.kind ?? 'other'
  }
  return (['new', 'rewrite', 'other'] as const).map((kind) => ({
    kind,
    cited: beforeAfter(input, (row) => kindOf(row) === kind)
  }))
}

/** Published pages by days live (the Fixes screen's buckets), with the questions citing them now. */
function speedBuckets(input: BreakdownInput, published: readonly PageRow[]): SpeedBucket[] {
  return DAY_BUCKETS.map((bucket) => {
    const pages = published.filter((row) => dayBucket(row.daysLive) === bucket.id)
    const keys = new Set(pages.map((row) => pageKey(row.url)))
    return {
      id: bucket.id,
      label: bucket.label,
      pages: countOf(pages.map((row) => row.url)),
      citedPages: countOf(pages.filter((row) => row.cited.now.n > 0).map((row) => row.url)),
      questions: countRows(
        input.to,
        (row) => isCitedRow(row) && row.citedUrl !== null && keys.has(pageKey(row.citedUrl))
      )
    }
  })
}
