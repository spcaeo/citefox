import type { ExportRequest } from '@shared/ipc'
import { calendarDay } from './timezone'
import type { ExportCheck, ExportDataset, ExportPage } from './types'

export interface SelectedCheck {
  /** `baseline`, `previous`, `current`, or a UTC calendar date. */
  label: string
  check: ExportCheck
}

export interface PreparedMarket {
  marketId: string
  code: string
  checks: readonly SelectedCheck[]
}

export interface PreparedPage {
  page: ExportPage
  markets: readonly PreparedMarket[]
}

export interface PrepareResult {
  block: { reason: string; nextStep: string } | null
  pages: readonly PreparedPage[]
  /** `{page}` token before filename sanitizing. */
  pageToken: string
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Scope, markets, and checks (FR-22.1).
 * `from` and `to` are calendar dates in `request.timeZone`, inclusive.
 */
export function prepareExport(dataset: ExportDataset, request: ExportRequest): PrepareResult {
  const scoped = pagesForScope(dataset, request)
  if (scoped.block) {
    return { block: scoped.block, pages: [], pageToken: scoped.pageToken }
  }

  const marketIds = unique(request.marketIds)
  const pages = scoped.pages.map((page) => preparePage(page, marketIds, request))
  const rangeEmpty =
    request.checks === 'range' &&
    !pages.some((page) => page.markets.some((market) => market.checks.length > 0))

  return {
    block: rangeEmpty
      ? {
          reason: 'No checks fall in this date range.',
          nextStep: 'Widen the date range or choose Latest.'
        }
      : null,
    pages,
    pageToken: scoped.pageToken
  }
}

export function isCalendarDate(value: string | null): value is string {
  if (value === null || !DATE_PATTERN.test(value)) return false
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function pagesForScope(
  dataset: ExportDataset,
  request: ExportRequest
): { pages: readonly ExportPage[]; pageToken: string; block: PrepareResult['block'] } {
  if (request.scope === 'project') {
    return { pages: dataset.pages, pageToken: 'all-pages', block: null }
  }

  if (request.scope === 'view') {
    if (request.viewId === null || request.viewId.length === 0) {
      return {
        pages: [],
        pageToken: 'view',
        block: { reason: 'Pick a saved view.', nextStep: 'Choose a saved view.' }
      }
    }
    const view = dataset.views.find((item) => item.id === request.viewId)
    if (view === undefined) {
      return {
        pages: [],
        pageToken: 'view',
        block: {
          reason: 'That saved view is not in this project.',
          nextStep: 'Choose a saved view.'
        }
      }
    }
    return {
      pages: pagesById(dataset.pages, view.pageIds),
      pageToken: view.slug,
      block: null
    }
  }

  if (request.pageIds.length === 0) {
    return {
      pages: [],
      pageToken: 'page',
      block: { reason: 'Pick at least one page.', nextStep: 'Choose a page.' }
    }
  }

  const pages = pagesById(dataset.pages, request.pageIds)
  if (pages.length === 0) {
    return {
      pages: [],
      pageToken: 'page',
      block: {
        reason: 'That page is not in this project.',
        nextStep: 'Choose a page in this project.'
      }
    }
  }

  const pageToken = request.scope === 'page' ? (pages[0]?.slug ?? 'page') : `${pages.length}-pages`
  return { pages, pageToken, block: null }
}

function pagesById(pages: readonly ExportPage[], ids: readonly string[]): ExportPage[] {
  const byId = new Map(pages.map((page) => [page.pageId, page]))
  const picked: ExportPage[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const page = byId.get(id)
    if (page !== undefined) picked.push(page)
  }
  return picked
}

function preparePage(
  page: ExportPage,
  marketIds: readonly string[],
  request: ExportRequest
): PreparedPage {
  const byId = new Map(page.markets.map((market) => [market.marketId, market]))
  const markets: PreparedMarket[] = []
  for (const marketId of marketIds) {
    const market = byId.get(marketId)
    if (market === undefined) continue
    const code = market.code.trim().length > 0 ? market.code : market.marketId
    markets.push({
      marketId,
      code,
      checks: selectChecks(market.checks, request)
    })
  }
  return { page, markets }
}

function selectChecks(checks: readonly ExportCheck[], request: ExportRequest): SelectedCheck[] {
  const sorted = [...checks].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt))
  if (request.checks === 'latest') {
    const last = sorted[sorted.length - 1]
    return last === undefined ? [] : [{ label: 'current', check: last }]
  }
  if (request.checks === 'all') return dateLabels(sorted, request.timeZone)
  if (request.checks === 'range') {
    const from = request.from ?? ''
    const to = request.to ?? ''
    return dateLabels(
      sorted.filter((check) => {
        const day = calendarDay(check.finishedAt, request.timeZone)
        return day >= from && day <= to
      }),
      request.timeZone
    )
  }
  return trio(sorted)
}

function trio(sorted: readonly ExportCheck[]): SelectedCheck[] {
  if (sorted.length === 0) return []
  if (sorted.some((check) => check.role !== null)) {
    const selected: SelectedCheck[] = []
    const seen = new Set<ExportCheck>()
    for (const role of ['baseline', 'previous', 'current'] as const) {
      const check = sorted.find((item) => item.role === role)
      if (check === undefined || seen.has(check)) continue
      seen.add(check)
      selected.push({ label: role, check })
    }
    return selected
  }
  const baseline = sorted[0]
  const current = sorted[sorted.length - 1]
  if (baseline === undefined || current === undefined) return []
  if (sorted.length === 1) return [{ label: 'current', check: current }]
  const selected: SelectedCheck[] = [{ label: 'baseline', check: baseline }]
  if (sorted.length >= 3) {
    const previous = sorted[sorted.length - 2]
    if (previous !== undefined && previous !== baseline) {
      selected.push({ label: 'previous', check: previous })
    }
  }
  if (current !== baseline) selected.push({ label: 'current', check: current })
  return selected
}

function dateLabels(checks: readonly ExportCheck[], timeZone: string): SelectedCheck[] {
  const seen = new Map<string, number>()
  return checks.map((check) => {
    const day = calendarDay(check.finishedAt, timeZone)
    const count = (seen.get(day) ?? 0) + 1
    seen.set(day, count)
    return { label: count === 1 ? day : `${day} ${count}`, check }
  })
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
