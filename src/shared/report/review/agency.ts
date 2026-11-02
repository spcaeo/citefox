import { DEFAULT_LOOP_OWNERS, LOOP_STEPS, type LoopStep } from '../../fix-loop'
import { VERDICT_WAIT_DAYS } from '../../fix-verdict'
import { isAnswered, isCitedRow } from '../../metrics/counts'
import type { PageChangeNote, ReportExtras } from './extras'
import { plural } from './items'
import type { SectionInput } from './sections'
import type { BacklinksView, LostItem, LostView, Num, RoundStepView, RoundView } from './types'
import { lostQuestionsNum } from './verdict'

/**
 * The agency sections of a ready report: Lost ground (a post-mortem per page that lost
 * citations), the backlink ask list, and the next round's five steps with their owners.
 * Each number registers its drill, so its drawer lists exactly that many rows.
 */

export interface AgencyInput extends SectionInput {
  extras: ReportExtras
}

export function lostGroundView(input: AgencyInput): LostView {
  const { metrics, book, toIds } = input
  const byId = new Map(input.questions.map((item) => [item.id, item]))
  const items: LostItem[] = input.pages
    .filter((page) => page.status === 'lost')
    .map((page) => {
      const lost = lostQuestionsNum(metrics, book, toIds, page)
      const ids = book.drills[lost.drill]?.ids ?? []
      const toOwn: string[] = []
      const toOthers: string[] = []
      const noAnswer: string[] = []
      const sites = new Map<string, number>()
      for (const id of ids) {
        const row = metrics.rows[id]
        if (row === undefined || !isAnswered(row)) noAnswer.push(id)
        else if (isCitedRow(row)) toOwn.push(id)
        else toOthers.push(id)
        for (const domain of row?.domains ?? []) sites.set(domain, (sites.get(domain) ?? 0) + 1)
      }
      const add = (key: string, title: string, list: string[]): Num =>
        book.add(`lost:${page.url}:${key}`, {
          title: `${page.path}: ${title}`,
          kind: 'questions',
          ids: list
        })
      const change = input.extras.changes[page.url] ?? null
      const plan: string[] = []
      if (change !== null && (change.sectionsRemoved > 0 || change.sections.length > 0)) {
        plan.push(
          change.sections.length > 0
            ? `Compare the sections that changed (${change.sections.slice(0, 3).join(', ')}) with the version that was cited, and put back what answered these questions.`
            : 'Put back the sections the change removed, then check again.'
        )
      } else {
        plan.push(
          'Open the questions it lost and make sure the page still answers each one plainly.'
        )
      }
      if (toOwn.length > 0) {
        plan.push(
          `${toOwn.length} ${plural(toOwn.length, 'question')} now cite another page of yours: link that page to this one, or merge them.`
        )
      }
      if (toOthers.length > 0) {
        const top = [...sites.entries()].sort((a, b) => b[1] - a[1])[0]
        plan.push(
          top === undefined
            ? `${toOthers.length} ${plural(toOthers.length, 'question')} now cite other sites: read what they say that you don't.`
            : `${toOthers.length} ${plural(toOthers.length, 'question')} now cite other sites, most often ${top[0]}: read what it says that you don't.`
        )
      }
      plan.push(`Check again after ${VERDICT_WAIT_DAYS} days to see if it wins them back.`)
      return {
        page,
        questions: ids.flatMap((id) => {
          const item = byId.get(id)
          return item === undefined ? [] : [item]
        }),
        lost,
        toOwn: add('own', 'now cite another page of yours', toOwn),
        toOthers: add('others', 'now cite other sites', toOthers),
        noAnswer: add('none', 'no AI answer now', noAnswer),
        sites: [...sites.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 6)
          .map(([domain, n]) => ({ domain, n })),
        change,
        changedLabel: change === null ? null : input.ctx.day(change.changedAt),
        plan
      }
    })
  return { items }
}

export function backlinksView(input: AgencyInput): BacklinksView {
  const rows = input.extras.backlinks
  return { rows, first: rows.filter((row) => row.priority === 'first').length }
}

/** "pages to rework" → "page to rework" for one; "questions tracked" likewise. */
function wordsFor(n: number, words: string): string {
  if (n !== 1) return words
  return words.replace(/^(question|page)s\b/, '$1').replace(' need ', ' needs ')
}

const STEP_COPY: Readonly<Record<LoopStep, { name: string; line: string }>> = {
  measure: { name: 'Measure', line: 'CiteFox checks every tracked question' },
  reoptimise: { name: 'Re-optimise', line: 'Fresh content for each page not cited yet' },
  publish: { name: 'Publish', line: 'The new version goes live' },
  index: { name: 'Get indexed', line: 'Google has to find the page first' },
  backlinks: { name: 'Build backlinks', line: 'Links from other sites to the page' }
}

export function roundView(input: AgencyInput): RoundView {
  const { metrics, book, extras, pages } = input
  const owners = new Map(extras.owners.map((item) => [item.step, item.owner]))
  const known = new Set(pages.map((page) => page.url))
  const pagesNum = (id: string, title: string, urls: readonly string[]): Num =>
    book.add(id, { title, kind: 'pages', ids: [...new Set(urls)] })
  const counts: Record<LoopStep, { count: Num | null; words: string }> = {
    measure: {
      count: book.add('now:checked', {
        title: 'Every question checked',
        kind: 'questions',
        ids: metrics.now.checked.ids
      }),
      words: 'questions tracked'
    },
    reoptimise: {
      count: pagesNum(
        'round:reoptimise',
        'Pages to re-optimise',
        pages
          .filter((page) => page.published && (page.status === 'notyet' || page.status === 'lost'))
          .map((page) => page.url)
      ),
      words: 'pages to rework'
    },
    publish: {
      count: pagesNum(
        'round:publish',
        'Pages too new to judge',
        pages.filter((page) => page.published && page.status === 'toonew').map((page) => page.url)
      ),
      words: 'pages waiting to be judged'
    },
    index: {
      count: pagesNum(
        'round:index',
        'Pages Google has not shown as indexed',
        pages.filter((page) => page.published && page.indexed !== true).map((page) => page.url)
      ),
      words: 'pages not shown as indexed'
    },
    backlinks: {
      count: pagesNum(
        'round:backlinks',
        'Pages that need links',
        // Only pages the report knows, so the drawer lists exactly this many.
        extras.backlinks.map((row) => row.url).filter((url) => known.has(url))
      ),
      words: 'pages that need links'
    }
  }
  const steps: RoundStepView[] = LOOP_STEPS.map((step) => ({
    step,
    name: STEP_COPY[step].name,
    line: STEP_COPY[step].line,
    owner: owners.get(step) ?? DEFAULT_LOOP_OWNERS[step],
    count: counts[step].count,
    countWords: wordsFor(counts[step].count?.n ?? 0, counts[step].words)
  }))
  const schedule =
    extras.nextCheckAt === null
      ? null
      : `Next check on ${input.ctx.day(extras.nextCheckAt)}${extras.intervalDays ? `, then every ${extras.intervalDays} ${plural(extras.intervalDays, 'day')}` : ''}.`
  return { steps, schedule }
}

/** "1 section removed, 2 headings reworded, 1,240 → 860 words." One line for a page change. */
export function changeLine(change: PageChangeNote): string {
  const parts: string[] = []
  const n = (count: number, one: string, many: string): string =>
    `${count} ${count === 1 ? one : many}`
  if (change.sectionsAdded > 0)
    parts.push(`${n(change.sectionsAdded, 'new section', 'new sections')}`)
  if (change.sectionsRemoved > 0) {
    parts.push(`${n(change.sectionsRemoved, 'section', 'sections')} removed`)
  }
  if (change.headingsChanged > 0) {
    parts.push(`${n(change.headingsChanged, 'heading', 'headings')} reworded`)
  }
  if (change.textChanged > 0)
    parts.push(`text changed in ${n(change.textChanged, 'place', 'places')}`)
  if (change.wordsBefore !== null && change.wordsAfter !== null) {
    parts.push(
      `${change.wordsBefore.toLocaleString('en-US')} → ${change.wordsAfter.toLocaleString('en-US')} words`
    )
  }
  if (parts.length === 0) return 'Only small changes, such as dates or spacing.'
  const line = parts.join(', ')
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`
}
