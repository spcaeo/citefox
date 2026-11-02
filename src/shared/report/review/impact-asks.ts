import { isAnswered, isCitedRow } from '../../metrics/counts'
import type { OutlineLine } from './extras'
import type { ImpactInput } from './impact'
import type {
  ImpactView,
  IndexRow,
  LostMore,
  LostOutcome,
  OpenTopicRow,
  OutlineRow,
  RoundHero
} from './impact-types'
import { plural } from './items'
import type { Num } from './types'

/**
 * The Impact review's client asks (impact-types.ts): Not indexed (fresh vs late, the
 * questions each page was written for), the index check by days live, the questions not
 * cited yet by topic, the Next round hero, and what Lost ground adds per page (still
 * citing, lost by topic, the old vs new outline, outcomes).
 */

/** "Your team", "Client", "Their developer": a step the client's side owns. */
const CLIENT_OWNER = /\b(client|customer|your team|their)\b/i

/** Days live at or under this: Google may simply not have visited yet. */
export const FRESH_DAYS = 3

export function impactAsks(
  input: ImpactInput
): Pick<ImpactView, 'questionsFor' | 'notIndexed' | 'index' | 'openByTopic' | 'round' | 'lost'> {
  const { book } = input
  const waiting = input.pages.filter((page) => page.published && page.indexed === false)
  const fresh = waiting.filter((page) => page.daysLive === null || page.daysLive <= FRESH_DAYS)
  const late = waiting.filter((page) => page.daysLive !== null && page.daysLive > FRESH_DAYS)
  return {
    questionsFor: input.extras.questionsFor ?? {},
    notIndexed: {
      late: book.add('ni:late', {
        title: `Live ${FRESH_DAYS + 1}+ days, not indexed`,
        kind: 'pages',
        ids: late.map((page) => page.url)
      }),
      fresh: book.add('ni:fresh', {
        title: `Live ${FRESH_DAYS} days or less, not indexed yet`,
        kind: 'pages',
        ids: fresh.map((page) => page.url)
      })
    },
    index: indexCheck(input),
    openByTopic: openByTopic(input),
    round: roundHero(input),
    lost: lostMore(input)
  }
}

function indexCheck(input: ImpactInput): ImpactView['index'] {
  const { metrics, book } = input
  const published = input.pages.filter((page) => page.published)
  if (published.length === 0) return { rows: [], line: null }
  const byUrl = new Map(published.map((page) => [page.url, page]))
  const rows: IndexRow[] = metrics.pages.speed
    .filter((bucket) => bucket.pages.n > 0)
    .map((bucket) => {
      const pages = bucket.pages.ids.flatMap((url) => {
        const page = byUrl.get(url)
        return page === undefined ? [] : [page]
      })
      return {
        label: bucket.label,
        pages: book.add(`days:${bucket.id}:pages`, {
          title: `Pages live ${bucket.label}`,
          kind: 'pages',
          ids: bucket.pages.ids
        }),
        indexed: pages.filter((page) => page.indexed === true).length,
        notIndexed: book.add(`days:${bucket.id}:noidx`, {
          title: `Pages live ${bucket.label}, not indexed`,
          kind: 'pages',
          ids: pages.filter((page) => page.indexed === false).map((page) => page.url)
        }),
        unchecked: pages.filter((page) => page.indexed === null).length
      }
    })
  const cited = published.filter((page) => page.now > 0)
  const missing = published.filter((page) => page.indexed === false).length
  const unchecked = published.filter((page) => page.indexed === null).length
  const parts: string[] = []
  if (cited.length > 0 && cited.every((page) => page.indexed !== false)) {
    parts.push(
      cited.length === 1
        ? 'The cited page is indexed.'
        : `All ${cited.length} cited pages are indexed.`
    )
  }
  if (missing > 0) {
    parts.push(
      `${missing} ${plural(missing, 'page is', 'pages are')} not in Google yet, so ${missing === 1 ? 'it' : 'they'} cannot be cited.`
    )
  }
  if (unchecked > 0) {
    parts.push(`${unchecked} ${plural(unchecked, 'page has', 'pages have')} no index check yet.`)
  }
  return { rows, line: parts.length === 0 ? null : parts.join(' ') }
}

function openByTopic(input: ImpactInput): OpenTopicRow[] {
  const { metrics, book, toIds } = input
  return metrics.segments.topic
    .filter((row) => row.open.n > 0)
    .sort((a, b) => b.open.n - a.open.n || a.value.localeCompare(b.value))
    .map((row) => {
      const open = book.add(`seg:topic:${row.value}:open`, {
        title: `${row.value}: answer shown, not citing you`,
        kind: 'questions',
        ids: toIds(row.open.ids)
      })
      const was = (book.drills[open.drill]?.ids ?? []).filter((id) => {
        const fromId = metrics.fromOf[id]
        const from = fromId === undefined ? undefined : metrics.rows[fromId]
        return metrics.checks.length >= 2 && from !== undefined && isCitedRow(from)
      })
      return {
        topic: row.value,
        questions: row.questions.n,
        open,
        wasCited: book.add(`open:${row.value}:was`, {
          title: `${row.value}: not citing you now, cited you before`,
          kind: 'questions',
          ids: was
        })
      }
    })
}

function roundHero(input: ImpactInput): RoundHero {
  const checks = input.metrics.checks
  const number = Math.max(1, checks.length)
  const last = checks.at(-1)?.at ?? null
  const startedLabel = last === null ? null : input.ctx.day(last)
  const clientSteps = input.round.steps
    .filter((step) => CLIENT_OWNER.test(step.owner))
    .map((step) => step.step)
  const line =
    checks.length === 0
      ? 'The first round starts with the first check.'
      : checks.length === 1
        ? `The first round has started: the ${startedLabel} check measured where you stand. Now the pages get reworked, published, indexed and linked before the next check.`
        : `The next round has already started with the ${startedLabel} check. Pages not cited yet get reworked, indexed and linked before the next check.`
  return { number, startedLabel, line, clientSteps }
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** The two outlines side by side: headings only one version has are marked. */
export function outlineDiff(
  before: readonly OutlineLine[],
  after: readonly OutlineLine[]
): { before: OutlineRow[]; after: OutlineRow[] } {
  const inAfter = new Set(after.map((line) => norm(line.text)))
  const inBefore = new Set(before.map((line) => norm(line.text)))
  return {
    before: before.map((line) => ({
      ...line,
      mark: inAfter.has(norm(line.text)) ? 'same' : 'dropped'
    })),
    after: after.map((line) => ({
      ...line,
      mark: inBefore.has(norm(line.text)) ? 'same' : 'added'
    }))
  }
}

function lostMore(input: ImpactInput): Record<string, LostMore> {
  const { metrics, book, toIds } = input
  const byId = new Map(input.questions.map((item) => [item.id, item]))
  const out: Record<string, LostMore> = {}
  for (const item of input.lostGround.items) {
    const page = item.page
    const row = metrics.pages.rows.find((entry) => entry.url === page.url)
    const before = new Set(toIds(row?.cited.before?.ids ?? []))
    const after = row?.cited.after?.ids ?? []
    const stillIds = after.filter((id) => before.has(id))
    const stillCiting = book.add(`lost:${page.url}:still`, {
      title: `${page.path}: still citing it`,
      kind: 'questions',
      ids: stillIds
    })
    const lostIds = book.drills[item.lost.drill]?.ids ?? []
    const outcomes: Record<string, LostOutcome> = {}
    const topics = new Map<string, string[]>()
    for (const id of lostIds) {
      const metric = metrics.rows[id]
      outcomes[id] =
        metric === undefined || !isAnswered(metric) ? 'none' : isCitedRow(metric) ? 'own' : 'others'
      const topic = byId.get(id)?.topic ?? 'Not set'
      topics.set(topic, [...(topics.get(topic) ?? []), id])
    }
    for (const id of stillIds) outcomes[id] = 'still'
    const byTopic: { topic: string; num: Num }[] = [...topics.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([topic, ids]) => ({
        topic,
        num: book.add(`lost:${page.url}:topic:${topic}`, {
          title: `${page.path}: lost in ${topic}`,
          kind: 'questions',
          ids
        })
      }))
    const change = item.change
    const outline =
      change?.outlineBefore !== undefined &&
      change.outlineAfter !== undefined &&
      (change.outlineBefore.length > 0 || change.outlineAfter.length > 0)
        ? outlineDiff(change.outlineBefore, change.outlineAfter)
        : null
    out[page.url] = { stillCiting, byTopic, outline, outcomes, stillIds }
  }
  return out
}
