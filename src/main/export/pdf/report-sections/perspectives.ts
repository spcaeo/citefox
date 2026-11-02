import { METHOD_SOURCE, METHOD_TITLE } from '@shared/report/method'
import { NEXT_STEPS_LEDE, NEXT_STEPS_TITLE } from '../../model/recommendations'
import { h2, para, section, table, type BlockContext } from '../blocks'

/**
 * The headline under the cover, "What to do next" and "How this report was made", with
 * the HTML report's words (Docs/REPORT-SPEC.md).
 */

export function headlineBlocks(context: BlockContext): void {
  para(context, context.model.headline, 'lead')
}

export function nextStepsBlocks(context: BlockContext): void {
  const { model } = context
  // Like the verdict in the HTML report, it comes with the overview.
  if (model.recommendations.length === 0 || !model.sections.includes('overview')) return
  section(context, NEXT_STEPS_TITLE, NEXT_STEPS_LEDE)
  model.recommendations.forEach((item, index) => {
    h2(context, `${index + 1}. ${item.doThis}`)
    para(context, `Why: ${item.why}`)
    table(context, {
      headers: ['Question', 'Competitor cited instead', 'Page Google cited instead'],
      rows: item.evidence.map((row) => [
        [
          row.question,
          [
            model.cover.trackedPages > 1 ? row.pagePath : '',
            model.markets.length > 1 ? context.marketLabel(row.marketId) : ''
          ]
            .filter((part) => part !== '')
            .join(' · ')
        ]
          .filter((part) => part !== '')
          .join('\n'),
        row.competitor ?? '—',
        row.citedUrl ?? '—'
      ]),
      widths: [3, 1.4, 2.6],
      size: 8
    })
    if (item.questions.n > item.evidence.length) {
      para(
        context,
        `Showing ${item.evidence.length} of ${item.questions.n} questions; the HTML report lists all of them.`,
        'muted'
      )
    }
  })
}

export function methodBlocks(context: BlockContext): void {
  const { method } = context.model
  section(context, METHOD_TITLE, 'What was searched and when, and how to read the numbers.')
  const window =
    method.windowFrom === null || method.windowTo === null
      ? 'No finished checks in this window'
      : `${context.date(method.windowFrom)} to ${context.date(method.windowTo)}`
  const compared =
    method.previousAt === null
      ? 'No earlier full check yet'
      : `${context.date(method.previousAt)} to ${context.date(method.currentAt)}`
  table(context, {
    headers: ['', ''],
    rows: [
      ['Scope', method.scopeLabel],
      ['Source', METHOD_SOURCE],
      [
        'Prompts searched',
        `${method.questions.n} on Google, for ${method.trackedPages === 1 ? '1 tracked page' : `${method.trackedPages} tracked pages`}`
      ],
      [
        method.marketIds.length === 1 ? 'Market' : 'Markets',
        method.marketIds.map((id) => context.marketLabel(id)).join(', ') || '—'
      ],
      ['Data window', window],
      ['Before vs after', compared]
    ],
    widths: [1.4, 4.6]
  })
  if (method.sampleWarning !== null) para(context, method.sampleWarning)
  for (const text of [method.copy.cited, method.copy.vary, method.copy.partial]) {
    para(context, text, 'muted')
  }
}
