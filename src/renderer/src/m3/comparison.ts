import type { PageResults } from '@shared/domain'
import { REPORT_KPI_LABELS } from '@shared/report-copy'
import { percent, ownDomain, signed } from './model'

export type ChangeTone = 'up' | 'down' | 'flat'

export interface ComparisonViewRow {
  id: string
  metric: string
  baseline: string
  previous: string
  current: string
  change: string
  tone: ChangeTone
  historyHref: string | null
  sort: {
    metric: string
    baseline: number | null
    previous: number | null
    current: number | null
    change: number | null
  }
}

function toneOf(delta: number | null): ChangeTone {
  if (delta === null || delta === 0) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

/**
 * Average position change, previous minus current: a lower position number is
 * better, so a positive delta is "Moved up" and a negative one "Moved down".
 */
function positionChange(delta: number | null): string {
  if (delta === null) return '—'
  if (delta === 0) return 'No change'
  return `${delta > 0 ? 'Moved up' : 'Moved down'} ${Math.abs(delta).toFixed(1)}`
}

function rateCell(
  cited: number | null,
  aio: number | null
): { text: string; value: number | null } {
  if (cited === null || aio === null) return { text: '—', value: null }
  const value = percent(cited, aio)
  return { text: `${cited} / ${aio} · ${value}%`, value }
}

function column(
  results: PageResults,
  which: 'baseline' | 'previous' | 'current'
): PageResults['comparison'][number] {
  return results.comparison.find((item) => item.which === which) ?? results.comparison[0]
}

export function comparisonViews(results: PageResults, historyHref: string): ComparisonViewRow[] {
  const domain = ownDomain(results)
  const baseline = column(results, 'baseline')
  const previous = column(results, 'previous')
  const current = column(results, 'current')
  const pageBase = rateCell(baseline.pageCited, baseline.aiosShown)
  const pagePrev = rateCell(previous.pageCited, previous.aiosShown)
  const pageNow = rateCell(current.pageCited, current.aiosShown)
  const ownBase = rateCell(baseline.anyOwnPageCited, baseline.aiosShown)
  const ownPrev = rateCell(previous.anyOwnPageCited, previous.aiosShown)
  const ownNow = rateCell(current.anyOwnPageCited, current.aiosShown)
  const aio = (shown: number | null, total: number): { text: string; value: number | null } => {
    if (shown === null) return { text: '—', value: null }
    return { text: `${shown} / ${total}`, value: shown }
  }
  const aioBase = aio(baseline.aiosShown, baseline.promptsChecked)
  const aioPrev = aio(previous.aiosShown, previous.promptsChecked)
  const aioNow = aio(current.aiosShown, current.promptsChecked)
  const positionDelta =
    previous.averagePosition === null || current.averagePosition === null
      ? null
      : Number((previous.averagePosition - current.averagePosition).toFixed(1))

  const numeric = (
    id: string,
    metric: string,
    baseText: string,
    prevText: string,
    nowText: string,
    baseSort: number | null,
    prevSort: number | null,
    nowSort: number | null,
    delta: number | null,
    suffix: string
  ): ComparisonViewRow => ({
    id,
    metric,
    baseline: baseText,
    previous: prevText,
    current: nowText,
    change: delta === null ? '—' : signed(delta, suffix),
    tone: toneOf(delta),
    historyHref: null,
    sort: { metric, baseline: baseSort, previous: prevSort, current: nowSort, change: delta }
  })

  const delta = (now: number | null, prev: number | null): number | null =>
    now === null || prev === null ? null : now - prev

  const yesNo = (value: boolean | null): string => (value === null ? '—' : value ? 'Yes' : 'No')

  return [
    numeric(
      'score',
      REPORT_KPI_LABELS.score,
      baseline.score === null ? '—' : String(baseline.score),
      previous.score === null ? '—' : String(previous.score),
      current.score === null ? '—' : String(current.score),
      baseline.score,
      previous.score,
      current.score,
      delta(current.score, previous.score),
      ''
    ),
    numeric(
      'page_cited',
      `${REPORT_KPI_LABELS.pageCited} (questions, of AI Overviews)`,
      pageBase.text,
      pagePrev.text,
      pageNow.text,
      pageBase.value,
      pagePrev.value,
      pageNow.value,
      pageNow.value === null || pagePrev.value === null ? null : pageNow.value - pagePrev.value,
      ' pts'
    ),
    numeric(
      'own_cited',
      `${REPORT_KPI_LABELS.cited}: any ${domain} page (questions)`,
      ownBase.text,
      ownPrev.text,
      ownNow.text,
      ownBase.value,
      ownPrev.value,
      ownNow.value,
      ownNow.value === null || ownPrev.value === null ? null : ownNow.value - ownPrev.value,
      ' pts'
    ),
    numeric(
      'links_page',
      'Citations: links to this page',
      baseline.linksThisPage === null ? '—' : String(baseline.linksThisPage),
      previous.linksThisPage === null ? '—' : String(previous.linksThisPage),
      current.linksThisPage === null ? '—' : String(current.linksThisPage),
      baseline.linksThisPage,
      previous.linksThisPage,
      current.linksThisPage,
      delta(current.linksThisPage, previous.linksThisPage),
      ''
    ),
    numeric(
      'links_other',
      'Citations: links to other own pages',
      baseline.linksOtherOwn === null ? '—' : String(baseline.linksOtherOwn),
      previous.linksOtherOwn === null ? '—' : String(previous.linksOtherOwn),
      current.linksOtherOwn === null ? '—' : String(current.linksOtherOwn),
      baseline.linksOtherOwn,
      previous.linksOtherOwn,
      current.linksOtherOwn,
      delta(current.linksOtherOwn, previous.linksOtherOwn),
      ''
    ),
    numeric(
      'brand_mentioned',
      'Brand mentioned without a link (questions)',
      baseline.brandMentioned === null ? '—' : String(baseline.brandMentioned),
      previous.brandMentioned === null ? '—' : String(previous.brandMentioned),
      current.brandMentioned === null ? '—' : String(current.brandMentioned),
      baseline.brandMentioned,
      previous.brandMentioned,
      current.brandMentioned,
      delta(current.brandMentioned, previous.brandMentioned),
      ''
    ),
    numeric(
      'aio_shown',
      `${REPORT_KPI_LABELS.aio} (questions)`,
      aioBase.text,
      aioPrev.text,
      aioNow.text,
      aioBase.value,
      aioPrev.value,
      aioNow.value,
      delta(current.aiosShown, previous.aiosShown),
      ''
    ),
    {
      id: 'avg_position',
      metric: 'Average position of this page',
      baseline: baseline.averagePosition === null ? '—' : baseline.averagePosition.toFixed(1),
      previous: previous.averagePosition === null ? '—' : previous.averagePosition.toFixed(1),
      current: current.averagePosition === null ? '—' : current.averagePosition.toFixed(1),
      change: positionChange(positionDelta),
      tone: toneOf(positionDelta),
      historyHref: null,
      sort: {
        metric: 'Average position of this page',
        baseline: baseline.averagePosition,
        previous: previous.averagePosition,
        current: current.averagePosition,
        change: positionDelta
      }
    },
    {
      id: 'content_changed',
      metric: 'Page content changed since previous check',
      baseline: yesNo(baseline.contentChanged),
      previous: yesNo(previous.contentChanged),
      current: yesNo(current.contentChanged),
      change: 'See history',
      tone: 'flat',
      historyHref,
      sort: {
        metric: 'Page content changed since previous check',
        baseline: baseline.contentChanged === null ? null : baseline.contentChanged ? 1 : 0,
        previous: previous.contentChanged === null ? null : previous.contentChanged ? 1 : 0,
        current: current.contentChanged === null ? null : current.contentChanged ? 1 : 0,
        change: null
      }
    }
  ]
}
