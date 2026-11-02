import {
  failedSearchesText,
  REPORT_DEFINITIONS,
  REPORT_KPI_LABELS,
  REPORT_SECTION_COPY
} from '@shared/report-copy'
import type { OpportunityBar } from '../../model/types'
import {
  count,
  grouped,
  h2,
  para,
  pctOf,
  pctText,
  section,
  signed,
  table,
  type BlockContext,
  type LegendItem
} from '../blocks'

/** Section 2, Overview: headline, KPI tiles, the funnel, the opportunity, top actions. */

export const OPPORTUNITY_LEGEND: readonly LegendItem[] = [
  { tone: 'accent', label: 'Not visible' },
  { tone: 'yellow', label: 'Named only' },
  { tone: 'blue', label: 'Cited only' },
  { tone: 'aqua', label: 'Already winning' }
]

export function overviewBlocks(context: BlockContext): void {
  const { model, say } = context
  const overview = model.overview
  const copy = REPORT_SECTION_COPY.overview
  section(context, copy.title, copy.description)
  para(context, overview.headline, 'lead')

  const aio = overview.aio.n
  const scoreDetail =
    overview.scoreChange === null
      ? 'No earlier full check to compare with'
      : `${signed(overview.scoreChange)} since ${context.date(overview.previousCheckAt)}`
  context.blocks.push({
    kind: 'kpis',
    tiles: [
      tile(context, 'tracked', count(overview.tracked), `${grouped(overview.measured)} measured`),
      tile(
        context,
        'aio',
        count(overview.aio),
        overview.failed.n > 0
          ? `${pctText(overview.aioPct)} of tracked prompts · ${failedSearchesText(overview.failed.n)}`
          : `${pctText(overview.aioPct)} of tracked prompts`
      ),
      tile(
        context,
        'cited',
        count(overview.cited),
        `${pctText(overview.citedPct)} of those answers`
      ),
      tile(
        context,
        'named',
        count(overview.named),
        `${pctText(pctOf(overview.named.n, aio))} of answers`
      ),
      {
        ...tile(
          context,
          'notVisible',
          count(overview.notVisible),
          `${pctText(pctOf(overview.notVisible.n, aio))} of answers`
        ),
        accent: true
      },
      tile(context, 'score', overview.score === null ? '—' : `${overview.score}/100`, scoreDetail)
    ]
  })

  h2(context, 'Where visibility falls away')
  const tracked = overview.tracked.n
  if (context.pdf.charts) {
    context.blocks.push({
      kind: 'bars',
      rows: overview.funnel.map((step, index) => ({
        label: say(step.label),
        value: step.count.n,
        display: `${grouped(step.count.n)} · ${pctText(pctOf(step.count.n, tracked))}`,
        tone: index === 0 ? 'slate' : 'accent'
      }))
    })
    const drops: string[] = []
    overview.funnel.forEach((step, index) => {
      const before = overview.funnel[index - 1]
      if (before === undefined || step.dropReason === null) return
      const lost = before.count.n - step.count.n
      if (lost > 0) drops.push(`${step.label}: ${grouped(lost)} drop out. ${step.dropReason}.`)
    })
    for (const line of drops) para(context, line, 'muted')
  } else {
    table(context, {
      headers: ['Step', 'Prompts', 'Share', 'Why prompts drop out before this step'],
      rows: overview.funnel.map((step) => [
        step.label,
        grouped(step.count.n),
        pctText(pctOf(step.count.n, tracked)),
        step.dropReason ?? '—'
      ]),
      widths: [3, 1, 1, 5],
      numeric: [1, 2]
    })
  }

  h2(context, 'The opportunity')
  para(
    context,
    'Prompts with an AI Overview, by intent stage, largest "not visible" first.',
    'muted'
  )
  opportunity(context, overview.opportunityByStage, 'Stage')
  if (overview.opportunityByPage.length > 0) {
    h2(context, 'The opportunity by page')
    opportunity(context, overview.opportunityByPage, 'Page')
  }
  para(context, `${REPORT_KPI_LABELS.winning}: ${REPORT_DEFINITIONS.winning}`, 'muted')
  para(context, `${REPORT_KPI_LABELS.notVisible}: ${REPORT_DEFINITIONS.notVisible}`, 'muted')
  para(context, overview.coverageLine, 'muted')

  if (overview.topActions.length > 0) {
    h2(context, 'Top actions')
    context.blocks.push({
      kind: 'list',
      items: [...overview.topActions]
        .sort((left, right) => left.rank - right.rank)
        .map((action) => say(`${sentence(action.text)} ${sentence(action.reason)}`))
    })
  }
}

function tile(
  context: BlockContext,
  kpi: keyof typeof REPORT_KPI_LABELS,
  value: string,
  detail: string
): { label: string; value: string; detail: string; definition: string; accent: boolean } {
  return {
    label: context.say(REPORT_KPI_LABELS[kpi]),
    value,
    detail: context.say(detail),
    definition: context.say(REPORT_DEFINITIONS[kpi]),
    accent: false
  }
}

function opportunity(context: BlockContext, bars: readonly OpportunityBar[], label: string): void {
  const sorted = [...bars].sort(
    (left, right) => right.notVisible.n - left.notVisible.n || right.total.n - left.total.n
  )
  if (context.pdf.charts) {
    context.blocks.push({
      kind: 'stacked',
      scale: 'max',
      legend: OPPORTUNITY_LEGEND,
      rows: sorted.map((bar) => ({
        label: context.say(bar.label),
        display: `${grouped(bar.notVisible.n)} of ${grouped(bar.total.n)}`,
        segments: [
          { tone: 'accent', value: bar.notVisible.n },
          { tone: 'yellow', value: bar.namedOnly.n },
          { tone: 'blue', value: bar.citedOnly.n },
          { tone: 'aqua', value: bar.winning.n }
        ]
      }))
    })
    return
  }
  table(context, {
    headers: [label, 'AI Overview', 'Not visible', 'Named only', 'Cited only', 'Already winning'],
    rows: sorted.map((bar) => [
      bar.label,
      count(bar.total),
      count(bar.notVisible),
      count(bar.namedOnly),
      count(bar.citedOnly),
      count(bar.winning)
    ]),
    widths: [3, 1.2, 1.2, 1.2, 1.2, 1.4],
    numeric: [1, 2, 3, 4, 5]
  })
}

function sentence(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}
