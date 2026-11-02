import { VERDICT_WAIT_DAYS } from '../../fix-verdict'
import { isCitedRow } from '../../metrics/counts'
import { pageKey } from '../../metrics/pages'
import type { MetricRow } from '../../metrics/types'
import { changeLine } from './agency'
import type { ChangedInput } from './changed'
import type { ChangedPageRow, ChangedPagesView, SetShare } from './changed-types'
import type { PageChangeNote } from './extras'
import { pathOf, plural } from './items'
import { endRows } from './named'
import type { Num, PageItem } from './types'

/**
 * What changed › Pages (Docs/REPORT-SPEC.md "What changed"): the pages changed in the
 * window (published or rewritten in the changes ledger, or a change seen in page
 * history between From and To), with the size of the change, its days before the To
 * check, and its target questions (Primary + Also OK) cited before → now. Then those
 * questions as one set against every other question of the project.
 */

const DAY_MS = 86_400_000

/** A row's target pages, as page keys: its own, or under All engines its engines'. */
export function targetKeysOf(
  targets: Readonly<Record<string, readonly string[]>>,
  row: MetricRow
): Set<string> {
  const own = targets[row.id]
  const lists =
    own !== undefined ? [own] : (row.parts ?? []).map((id) => targets[id] ?? []).filter(Boolean)
  return new Set(lists.flat().map(pageKey))
}

function changeInWindow(
  list: readonly PageChangeNote[] | undefined,
  fromAt: string | null,
  toAt: string | null
): PageChangeNote | null {
  for (const change of list ?? []) {
    if (toAt !== null && change.changedAt > toAt) continue
    if (fromAt !== null && change.changedAt <= fromAt) continue
    return change
  }
  return null
}

function byKey<T>(record: Readonly<Record<string, T>> | undefined): Map<string, T> {
  const out = new Map<string, T>()
  for (const [url, value] of Object.entries(record ?? {})) out.set(pageKey(url), value)
  return out
}

function shareOf(
  input: ChangedInput,
  key: string,
  label: string,
  pairs: readonly { to: MetricRow; from: MetricRow | null }[]
): SetShare {
  const { book } = input
  const ids = pairs.map((pair) => pair.to.id)
  const before = pairs.filter((pair) => pair.from !== null && isCitedRow(pair.from))
  const now = pairs.filter((pair) => isCitedRow(pair.to))
  const add = (suffix: string, title: string, list: readonly string[]): Num =>
    book.add(`chg:${key}:${suffix}`, { title, kind: 'questions', ids: list })
  return {
    label,
    questions: add('all', `${label}: questions checked at both ends`, ids),
    citedBefore: add(
      'b',
      `${label}: citing you, ${input.fromLabel ?? ''}`,
      before.map((p) => p.to.id)
    ),
    citedNow: add(
      'a',
      `${label}: citing you, ${input.toLabel}`,
      now.map((p) => p.to.id)
    ),
    shareBefore: ids.length === 0 ? null : before.length / ids.length,
    shareNow: ids.length === 0 ? null : now.length / ids.length
  }
}

export function changedPagesView(input: ChangedInput): ChangedPagesView {
  const { metrics, book, extras, fromAt, toAt } = input
  const targets = extras.targets ?? {}
  const changes = byKey(extras.pageChanges)
  const edits = byKey(extras.pageEdits)
  const comparing = metrics.comparison !== null
  // Candidate pages: published ones, and any page with a change in the window.
  const known = new Map(input.pages.map((page) => [pageKey(page.url), page]))
  const candidates: PageItem[] = input.pages.filter(
    (page) => page.published || changeInWindow(changes.get(pageKey(page.url)), fromAt, toAt)
  )
  for (const [url, list] of Object.entries(extras.pageChanges ?? {})) {
    const key = pageKey(url)
    if (known.has(key) || changeInWindow(list, fromAt, toAt) === null) continue
    const page: PageItem = {
      url,
      path: pathOf(url),
      title: null,
      kind: null,
      liveSince: null,
      daysLive: null,
      indexed: null,
      before: comparing ? 0 : null,
      now: 0,
      status: 'notyet',
      published: false
    }
    known.set(key, page)
    candidates.push(page)
  }
  const pairs = comparing ? endRows(metrics) : []
  const nowRows = metrics.now.checked.ids.flatMap((id) => {
    const row = metrics.rows[id]
    return row === undefined ? [] : [row]
  })
  const changedIds = new Set<string>()
  const rows: ChangedPageRow[] = candidates.map((page) => {
    const key = pageKey(page.url)
    const change = changeInWindow(changes.get(key), fromAt, toAt)
    const edit = edits.get(key)
    const changedAt = change?.changedAt ?? page.liveSince
    const days =
      changedAt === null || toAt === null
        ? null
        : Math.max(0, Math.floor((Date.parse(toAt) - Date.parse(changedAt)) / DAY_MS))
    const aims = (row: MetricRow): boolean => targetKeysOf(targets, row).has(key)
    const targetIds = nowRows.filter(aims).map((row) => row.id)
    const own = pairs.filter((pair) => aims(pair.to))
    for (const pair of own) changedIds.add(pair.to.id)
    const at = `chg:page:${page.url}`
    const name = page.path
    const targetsNum = book.add(`${at}:targets`, {
      title: `${name}: its target questions`,
      kind: 'questions',
      ids: targetIds,
      sub: 'Questions this page is the Primary or an Also OK page for.'
    })
    const citedNow = book.add(`${at}:a`, {
      title: `${name}: target questions citing you, ${input.toLabel}`,
      kind: 'questions',
      ids: (comparing ? own.map((p) => p.to) : nowRows.filter(aims))
        .filter((row) => isCitedRow(row))
        .map((row) => row.id)
    })
    const citedBefore = comparing
      ? book.add(`${at}:b`, {
          title: `${name}: target questions citing you, ${input.fromLabel ?? ''}`,
          kind: 'questions',
          ids: own.filter((p) => p.from !== null && isCitedRow(p.from)).map((p) => p.to.id)
        })
      : null
    return {
      page,
      size:
        change !== null
          ? changeLine(change)
          : edit !== undefined
            ? `${edit.changes} ${plural(edit.changes, 'edit')} planned with CiteFox AI.`
            : null,
      changedAt,
      daysBefore: days,
      tooRecent: days !== null && days < VERDICT_WAIT_DAYS,
      targets: targetsNum,
      citedBefore,
      citedNow
    }
  })
  rows.sort(
    (a, b) =>
      (a.daysBefore ?? Infinity) - (b.daysBefore ?? Infinity) ||
      a.page.path.localeCompare(b.page.path)
  )
  const compare =
    comparing && changedIds.size > 0
      ? {
          changed: shareOf(
            input,
            'set:changed',
            "Changed pages' questions",
            pairs.filter((pair) => changedIds.has(pair.to.id))
          ),
          rest: shareOf(
            input,
            'set:rest',
            'The rest of the project',
            pairs.filter((pair) => !changedIds.has(pair.to.id))
          )
        }
      : null
  return { rows, compare }
}
