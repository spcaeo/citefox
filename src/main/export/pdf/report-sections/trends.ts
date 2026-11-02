import { REPORT_SECTION_COPY } from '@shared/report-copy'
import type { DeltaList } from '../../model/types'
import {
  emptyBlock,
  grouped,
  h2,
  h3,
  num,
  para,
  pctOf,
  pctText,
  section,
  table,
  yesNo,
  type BlockContext,
  type LegendItem
} from '../blocks'
import { plainTile } from './pages'
import { pluralWord } from '@shared/pluralize'

/** Sections 5 and 6, Reputation and Trends. */

const SENTIMENT_LEGEND: readonly LegendItem[] = [
  { tone: 'aqua', label: 'Positive' },
  { tone: 'gray', label: 'Neutral' },
  { tone: 'accent', label: 'Negative' }
]

export function reputationBlocks(context: BlockContext): void {
  const reputation = context.model.reputation
  const copy = REPORT_SECTION_COPY.reputation
  section(context, copy.title, copy.description)
  if (reputation.empty !== null) {
    emptyBlock(context, reputation.empty)
    return
  }
  const all = reputation.positive.n + reputation.neutral.n + reputation.negative.n
  context.blocks.push({
    kind: 'kpis',
    tiles: [
      plainTile(
        context,
        'Positive',
        grouped(reputation.positive.n),
        null,
        `${pctText(pctOf(reputation.positive.n, all))} of claims`
      ),
      plainTile(
        context,
        'Neutral',
        grouped(reputation.neutral.n),
        null,
        `${pctText(pctOf(reputation.neutral.n, all))} of claims`
      ),
      plainTile(
        context,
        'Negative',
        grouped(reputation.negative.n),
        null,
        `${pctText(pctOf(reputation.negative.n, all))} of claims`
      ),
      plainTile(
        context,
        'Net sentiment',
        reputation.net === null ? 'Not enough data' : String(reputation.net),
        '(positive − negative) ÷ all × 100. Shown from 5 claims.',
        `${grouped(reputation.analysed)} ${pluralWord(reputation.analysed, 'answer')} analysed`
      )
    ]
  })
  if (reputation.trend.length > 0) {
    h2(context, 'Sentiment over time')
    if (context.pdf.charts) {
      context.blocks.push({
        kind: 'stacked',
        scale: 'max',
        legend: SENTIMENT_LEGEND,
        rows: reputation.trend.map((point) => ({
          label: context.shortDate(point.at),
          display: grouped(point.positive + point.neutral + point.negative),
          segments: [
            { tone: 'aqua', value: point.positive },
            { tone: 'gray', value: point.neutral },
            { tone: 'accent', value: point.negative }
          ]
        }))
      })
    } else {
      table(context, {
        headers: ['Check', 'Positive', 'Neutral', 'Negative'],
        rows: reputation.trend.map((point) => [
          context.shortDate(point.at),
          grouped(point.positive),
          grouped(point.neutral),
          grouped(point.negative)
        ]),
        widths: [2, 1, 1, 1],
        numeric: [1, 2, 3]
      })
    }
  }
  h2(context, 'Factual problems worth correcting')
  if (reputation.issues.length === 0) {
    para(context, 'No factual problems found in the answers analysed.', 'body')
  } else {
    table(context, {
      headers: [
        'Prompt',
        'What the overview claims',
        'Why it is wrong',
        'Suggested correction',
        'Source to fix'
      ],
      rows: reputation.issues.map((issue) => [
        issue.prompt,
        issue.claim,
        issue.whyWrong,
        issue.correction,
        issue.sourceToFix ?? '—'
      ]),
      widths: [2.2, 2.4, 2.2, 2.2, 1.6]
    })
  }
  if (reputation.answers.length > 0) {
    h2(context, 'Answer by answer')
    table(context, {
      headers: ['Prompt', 'Tone', 'Theme', 'Rank', 'Why'],
      rows: reputation.answers.map((answer) => [
        answer.prompt,
        answer.tone.charAt(0).toUpperCase() + answer.tone.slice(1),
        answer.theme,
        answer.rank ?? '—',
        answer.why
      ]),
      widths: [3, 1, 1.6, 1.4, 3]
    })
  }
}

const TREND_LEGEND: readonly LegendItem[] = [
  { tone: 'gray', label: 'Prompts checked' },
  { tone: 'blue', label: 'AI Overview shown' },
  { tone: 'accent', label: 'Own domain cited' },
  { tone: 'aqua', label: 'Page cited' },
  { tone: 'violet', label: 'Brand named' }
]

const DELTAS = [
  { key: 'gained', label: 'Gained citations' },
  { key: 'lost', label: 'Lost citations' },
  { key: 'newlyNamed', label: 'Newly named' },
  { key: 'noLongerNamed', label: 'No longer named' }
] as const

export function trendsBlocks(context: BlockContext): void {
  const trends = context.model.trends
  const copy = REPORT_SECTION_COPY.trends
  section(context, copy.title, copy.description)
  if (trends.empty !== null) {
    emptyBlock(context, trends.empty)
    return
  }
  h2(context, 'AI Overview results over time')
  const times = trends.series.map((point) => Date.parse(point.at))
  if (context.pdf.charts && trends.series.length > 0) {
    context.blocks.push({
      kind: 'line',
      times,
      partial: trends.series.map((point) => point.partial),
      xLabels: trends.series.map((point) => context.shortDate(point.at)),
      yLabel: 'Prompts',
      series: TREND_LEGEND.map((item, index) => ({
        label: context.say(item.label),
        tone: item.tone,
        values: trends.series.map((point) =>
          index === 0
            ? point.checked
            : index === 1
              ? point.aio
              : index === 2
                ? point.ownCited
                : index === 3
                  ? point.pageCited
                  : point.named
        )
      })),
      markers: trends.fixes.map((fix) => ({
        at: Date.parse(fix.at),
        label: context.say(`Fix ${fix.number}`)
      }))
    })
    para(
      context,
      'Points are spaced by the real time between checks. Partial checks are drawn hollow and kept out of the lines. Dashed lines mark logged fixes.',
      'muted'
    )
  }
  table(context, {
    headers: [
      'Check',
      'Checked',
      'AIO shown',
      'Own domain cited',
      'Page cited',
      'Named',
      'Score',
      'Partial'
    ],
    rows: trends.series.map((point) => [
      context.shortDate(point.at),
      grouped(point.checked),
      grouped(point.aio),
      grouped(point.ownCited),
      grouped(point.pageCited),
      grouped(point.named),
      num(point.score),
      yesNo(point.partial)
    ]),
    widths: [1.8, 1, 1.1, 1.4, 1.1, 1, 1, 1],
    numeric: [1, 2, 3, 4, 5, 6]
  })
  for (const fix of trends.fixes) {
    para(context, `Fix ${fix.number}, ${context.date(fix.at)}: ${fix.description}`, 'muted')
  }

  h2(context, 'What changed since the previous full check')
  if (trends.previousAt !== null && trends.currentAt !== null) {
    para(
      context,
      `From ${context.date(trends.previousAt)} to ${context.date(trends.currentAt)}.`,
      'muted'
    )
  }
  for (const delta of DELTAS) {
    const list: DeltaList = trends[delta.key]
    h3(context, `${delta.label} (${grouped(list.count.n)})`)
    if (list.items.length === 0) {
      para(context, 'No changes in this category.', 'body')
      continue
    }
    table(context, {
      headers: ['Prompt', 'Market', 'Before', 'After'],
      rows: list.items.map((item) => [
        item.prompt,
        context.marketLabel(item.marketId),
        item.before,
        item.after
      ]),
      widths: [5, 1, 1.8, 1.8]
    })
  }

  if (trends.verdicts.length > 0) {
    h2(context, 'Fix verdicts')
    table(context, {
      headers: ['Fix', 'Went live', 'What changed', 'Verdict'],
      rows: trends.verdicts.map((verdict) => [
        `Fix ${verdict.number}`,
        context.shortDate(verdict.goLiveAt),
        verdict.description,
        verdict.label
      ]),
      widths: [0.8, 1.3, 4.5, 2.4]
    })
    para(
      context,
      'A verdict compares the prompts a fix targeted before and after it went live. It shows what changed, not that the fix caused it.',
      'muted'
    )
  }
}
