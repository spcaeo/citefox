import { MATCH_STATE_LABEL, type MatchState, type TopicResultRow } from '@shared/domain'
import type { TopicResults } from '@shared/ipc'

/**
 * Pure numbers for the first results moment (Mockups/v2/journey-a/A6-Results.png),
 * read from `topics:results` only. Counts what the overviews showed; it never
 * says a page change caused a citation.
 */

export interface FirstResultsSource {
  position: number
  label: string
  own: boolean
}

export interface FirstResultsWin {
  row: TopicResultRow
  /** True for a cited question; false for the closest miss when nothing is cited yet. */
  cited: boolean
  sources: readonly FirstResultsSource[]
}

export interface FirstResultsFix {
  key: string
  title: string
  detail: string
  /** The target path, or null for "No page yet". */
  target: string | null
  state: MatchState
  chip: string
  promptIds: readonly string[]
}

export interface FirstResultsGlance {
  promptId: string
  number: number
  label: string
  own: boolean
  noAio: boolean
}

export interface FirstResultsModel {
  /** Questions in the check. */
  questions: number
  /** Questions with a result. */
  checked: number
  withAio: number
  cited: number
  /** Cited ÷ overviews shown, whole percent; null when no overview. */
  rate: number | null
  topInstead: { domain: string; count: number } | null
  nextInstead: readonly { domain: string; count: number }[]
  targetPages: number
  targetPagesCited: number
  win: FirstResultsWin | null
  fixes: readonly FirstResultsFix[]
  glance: readonly FirstResultsGlance[]
}

const AIO_STATES: ReadonlySet<string> = new Set([
  'right_page',
  'other_page',
  'not_cited',
  'no_page'
])
const CITED_STATES: ReadonlySet<string> = new Set(['right_page', 'other_page'])
const FIX_ORDER: Readonly<Record<string, number>> = { not_cited: 0, other_page: 1, no_page: 2 }

/** `/pricing` from a URL; the input when it is not a URL. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/u, '') : parsed.pathname
  } catch {
    return url
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '')
  } catch {
    return url
  }
}

/** The overview sources in position order: the own page at its position, then the others. */
export function sourcesOf(row: TopicResultRow): FirstResultsSource[] {
  const others = row.citedInstead.map((domain) => ({ label: domain, own: false }))
  const list: { label: string; own: boolean }[] = [...others]
  if (row.citedOwnUrl !== null) {
    const own = { label: `${hostOf(row.citedOwnUrl)}${pathOf(row.citedOwnUrl)}`, own: true }
    const at = row.position === null ? 0 : Math.min(Math.max(row.position - 1, 0), list.length)
    list.splice(at, 0, own)
  }
  return list.map((source, index) => ({ ...source, position: index + 1 }))
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function questionList(rows: readonly TopicResultRow[]): string {
  const numbers = rows.map((row) => `Q${row.number}`)
  if (numbers.length <= 3) return numbers.join(', ')
  return `${numbers.slice(0, 3).join(', ')} +${numbers.length - 3}`
}

/** Up to three fixes: pages that exist but are not cited first, then wrong pages, then new pages. */
export function firstFixes(rows: readonly TopicResultRow[]): FirstResultsFix[] {
  const groups = new Map<string, TopicResultRow[]>()
  for (const row of rows) {
    if (!(row.state in FIX_ORDER)) continue
    const key =
      row.state === 'no_page' || row.targetUrl === null
        ? `new:${row.promptId}`
        : `${row.state}:${row.targetUrl}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .sort(
      ([, left], [, right]) =>
        right.length - left.length ||
        (FIX_ORDER[left[0]?.state ?? ''] ?? 9) - (FIX_ORDER[right[0]?.state ?? ''] ?? 9) ||
        (left[0]?.number ?? 0) - (right[0]?.number ?? 0)
    )
    .slice(0, 3)
    .map(([key, list]) => {
      const first = list[0] as TopicResultRow
      const state = first.state as MatchState
      const instead = first.citedInstead[0]
      const moves = `Moves ${questionList(list)}`
      const insteadText = instead ? ` · ${instead} cited instead` : ''
      if (state === 'no_page' || first.targetUrl === null) {
        return {
          key,
          title: 'Write a page that answers this question',
          detail: `Q${first.number} has no page to cite${insteadText}`,
          target: null,
          state: 'no_page',
          chip: MATCH_STATE_LABEL.no_page,
          promptIds: list.map((row) => row.promptId)
        }
      }
      const path = pathOf(first.targetUrl)
      return {
        key,
        title:
          state === 'other_page'
            ? `Point ${path} at ${list.length === 1 ? 'this question' : 'these questions'}`
            : `Answer ${list.length === 1 ? 'the question' : 'these questions'} up top on ${path}`,
        detail: `${moves}${insteadText}`,
        target: path,
        state,
        chip: MATCH_STATE_LABEL[state],
        promptIds: list.map((row) => row.promptId)
      }
    })
}

export function firstResultsModel(results: TopicResults): FirstResultsModel {
  const rows = results.rows.filter((row) => row.kind === 'question')
  const checkedRows = rows.filter((row) => row.state !== 'not_checked')
  const aioRows = rows.filter((row) => AIO_STATES.has(row.state))
  const citedRows = rows.filter((row) => CITED_STATES.has(row.state))
  const counts = new Map<string, number>()
  for (const row of aioRows) {
    for (const domain of new Set(row.citedInstead)) {
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
  }
  const instead = [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((left, right) => right.count - left.count || left.domain.localeCompare(right.domain))
  const targets = new Set(rows.map((row) => row.targetUrl).filter((url): url is string => !!url))
  const targetsCited = new Set(
    rows
      .filter((row) => row.state === 'right_page' && row.targetUrl !== null)
      .map((row) => row.targetUrl as string)
  )
  const winRow =
    rows.find((row) => row.state === 'right_page') ??
    rows.find((row) => row.state === 'other_page') ??
    null
  const missRow =
    winRow === null
      ? (rows.find((row) => row.state === 'not_cited') ??
        rows.find((row) => row.state === 'no_page') ??
        null)
      : null
  const winSource = winRow ?? missRow
  return {
    questions: rows.length,
    checked: checkedRows.length,
    withAio: aioRows.length,
    cited: citedRows.length,
    rate: aioRows.length === 0 ? null : Math.round((citedRows.length / aioRows.length) * 100),
    topInstead: instead[0] ?? null,
    nextInstead: instead.slice(1, 4),
    targetPages: targets.size,
    targetPagesCited: targetsCited.size,
    win:
      winSource === null
        ? null
        : { row: winSource, cited: winRow !== null, sources: sourcesOf(winSource) },
    fixes: firstFixes(rows),
    glance: rows.map((row) => ({
      promptId: row.promptId,
      number: row.number,
      own: CITED_STATES.has(row.state),
      noAio: row.state === 'no_aio',
      label: CITED_STATES.has(row.state)
        ? 'You'
        : row.state === 'no_aio'
          ? '—'
          : row.state === 'failed'
            ? 'Failed'
            : row.state === 'not_checked'
              ? 'Not checked'
              : (row.citedInstead[0] ?? '—')
    }))
  }
}

/** The headline, honest when nothing is cited or nothing showed an overview. */
export function firstResultsHeadline(model: FirstResultsModel): string {
  if (model.checked === 0) return 'Your first check has no answers yet.'
  const shown = `Google shows an AI Overview for ${model.withAio} of ${plural(model.checked, 'question', 'questions')}.`
  if (model.withAio === 0) return shown
  if (model.cited === 0) return `${shown} You're not cited yet.`
  return `${shown} You're cited in ${model.cited}.`
}
