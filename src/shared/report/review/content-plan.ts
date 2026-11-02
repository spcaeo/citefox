import { cleanHost } from '../../competitor-hosts'
import { isCitedRow } from '../../metrics/counts'
import { pathOf } from './items'
import type { ReadyInput } from './ready'
import type { ContentGroup, ContentPlanView, ContentRow, PlanPageSource } from './ready-types'
import { journeyLabel, journeyOutline, readOf } from './shape'
import { EMPTY_ANSWER_EXTRAS } from './sources-types'
import type { Num, QuestionItem, Tile } from './types'

/**
 * Content plan (Docs/REPORT-SPEC.md "Short ready reports"): one row per question where an
 * AI answer shows and you are not cited, or the wrong page of yours is cited, grouped by
 * topic. Each row names the page to write or fix, the answer's block order to follow,
 * the sites cited instead and a plain-text brief. No AI call: everything is read from
 * the checks, the target pages and the stored answer blocks.
 */

const PAGE_LABELS: Readonly<Record<PlanPageSource, string>> = {
  primary: 'Primary page',
  ai: 'CiteFox AI’s pick',
  new: 'New page'
}

const MAX_SITES = 5

export function contentPlanView(input: ReadyInput): ContentPlanView {
  const { metrics, book, extras } = input
  const answers = extras.answers ?? EMPTY_ANSWER_EXTRAS
  const common = input.report.answerShape.mostCommon
  const aiPages = extras.aiPages ?? {}
  const own = cleanHost(input.ctx.domain)
  const rows: ContentRow[] = []
  for (const id of input.toIds(metrics.now.answered.ids)) {
    const row = metrics.rows[id]
    const question = input.report.questionsById[id]
    if (row === undefined || question === undefined) continue
    const reason = row.result === 'other' ? 'wrongpage' : isCitedRow(row) ? null : 'notcited'
    if (reason === null) continue
    const primary = question.targets[0] ?? null
    const ai = primary === null ? (aiPages[row.questionId] ?? null) : null
    const page = primary ?? ai
    const pageSource: PlanPageSource = primary !== null ? 'primary' : ai !== null ? 'ai' : 'new'
    const read = readOf(input, answers, row)
    const shape =
      read !== null && read !== 'waiting'
        ? { label: journeyLabel(read.codes), outline: journeyOutline(read.codes), own: true }
        : common === null
          ? null
          : { label: common.label, outline: common.outline, own: false }
    const sites = row.domains
      .filter((domain) => {
        const host = cleanHost(domain)
        return own === '' || (host !== own && !host.endsWith(`.${own}`))
      })
      .slice(0, MAX_SITES)
    const base = {
      question,
      reason,
      page,
      pageSource,
      pageLabel: PAGE_LABELS[pageSource],
      shape,
      sites
    } as const
    rows.push({ ...base, brief: briefOf(base, row.citedUrl) })
  }
  const byTopic = new Map<string, ContentRow[]>()
  for (const row of rows) {
    byTopic.set(row.question.topic, [...(byTopic.get(row.question.topic) ?? []), row])
  }
  const groups: ContentGroup[] = [...byTopic]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([topic, list]) => ({
      topic,
      questions: book.add(`cp:topic:${topic}`, {
        title: `${topic}: questions to win`,
        kind: 'questions',
        ids: list.map((row) => row.question.id)
      }),
      // Wrong page first (the quicker fix), then the question order.
      rows: [...list].sort(
        (a, b) => Number(b.reason === 'wrongpage') - Number(a.reason === 'wrongpage')
      )
    }))
  const q = (id: string, title: string, list: readonly ContentRow[], sub?: string): Num =>
    book.add(id, {
      title,
      kind: 'questions',
      ids: list.map((row) => row.question.id),
      ...(sub ? { sub } : {})
    })
  const total = q('cp:all', 'Questions to win: an AI answer shows without the right page', rows)
  const tile = (label: string, num: Num, tone?: Tile['tone']): Tile => ({
    label,
    value: num.n.toLocaleString('en-US'),
    drill: num.drill,
    ...(tone ? { tone } : {})
  })
  const tiles: Tile[] =
    rows.length === 0
      ? []
      : [
          tile('Questions to win', total, 'warn'),
          tile(
            'Not cited',
            q(
              'cp:notcited',
              'An AI answer shows without your pages',
              rows.filter((r) => r.reason === 'notcited')
            )
          ),
          tile(
            'Wrong page cited',
            q(
              'cp:wrongpage',
              'Another page of yours is cited, not the one set',
              rows.filter((r) => r.reason === 'wrongpage')
            )
          ),
          tile(
            'Need a new page',
            q(
              'cp:new',
              'No page of yours is set or picked for these questions',
              rows.filter((r) => r.pageSource === 'new'),
              'Write a new page for each, or set a Primary page if one already fits.'
            )
          )
        ]
  return { tiles, total, groups }
}

/** The plain-text brief: question, page, why, outline in the answer's order, sites to beat. */
function briefOf(row: Omit<ContentRow, 'brief'>, citedUrl: string | null): string {
  const q: QuestionItem = row.question
  const lines = [`Question: ${q.text}`, `Topic: ${q.topic}`]
  lines.push(
    row.page === null
      ? 'Page: New page. Write one that answers this question.'
      : `Page: ${row.page} (${row.pageLabel})`
  )
  lines.push(
    row.reason === 'wrongpage'
      ? `Why: the AI answer cites ${citedUrl === null ? 'another page of yours' : pathOf(citedUrl)}, not the page set for this question.`
      : 'Why: an AI answer shows and cites other sites, not you.'
  )
  if (row.shape !== null) {
    lines.push(
      '',
      row.shape.own
        ? 'Outline (follow the order of this question’s AI answer):'
        : 'Outline (follow the most common order of the AI answers):',
      ...row.shape.outline
    )
  }
  if (row.sites.length > 0) {
    lines.push('', `Sites to beat: ${row.sites.join(', ')}`)
  }
  lines.push('', 'Answer the question in the first two lines, then follow the outline.')
  return lines.join('\n')
}
