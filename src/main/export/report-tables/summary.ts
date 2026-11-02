import { REPORT_DEFINITIONS, REPORT_KPI_LABELS } from '@shared/report-copy'
import type { Cell } from '../cells'
import type { DeltaList, OpportunityBar } from '../model/types'
import {
  WHO_LABELS,
  bool,
  date,
  draft,
  emptyTable,
  n,
  num,
  pct,
  ratio,
  share,
  text,
  total,
  type DraftTable,
  type TableContext
} from './build'

/** Tables for Overview, Your pages, Competition, Reputation and Trends. */

export function overviewTables(context: TableContext): DraftTable[] {
  const overview = context.model.overview
  const aio = overview.aio.n
  const kpi = (label: string, value: Cell, part: Cell, definition: string): Cell[] => [
    text(label),
    value,
    part,
    text(definition)
  ]
  const previous =
    overview.previousCheckAt === null
      ? 'No earlier full check to compare with.'
      : 'Change since the previous full check.'
  const kpis = draft(
    'overview-kpis',
    'Overview',
    ['Metric', 'Value', 'Share', 'Definition'],
    [
      kpi(
        REPORT_KPI_LABELS.tracked,
        n(overview.tracked),
        { kind: 'blank' },
        REPORT_DEFINITIONS.tracked
      ),
      kpi(
        'Prompts measured',
        num(overview.measured),
        share(overview.measured, overview.tracked.n),
        'Prompts with a finished check. Errors are excluded.'
      ),
      kpi(
        'Searches failed',
        n(overview.failed),
        share(overview.failed.n, overview.tracked.n),
        'Prompts whose latest search failed (status "error" on the Prompts sheet). They count in Prompts tracked, so they lower the AI Overview share.'
      ),
      kpi(
        REPORT_KPI_LABELS.aio,
        n(overview.aio),
        pct(overview.aioPct),
        `${REPORT_DEFINITIONS.aio} Share of all tracked prompts, failed searches included.`
      ),
      kpi(
        REPORT_KPI_LABELS.cited,
        n(overview.cited),
        pct(overview.citedPct),
        `${REPORT_DEFINITIONS.cited} Share of AI Overviews.`
      ),
      kpi(
        REPORT_KPI_LABELS.pageCited,
        n(overview.pageCited),
        share(overview.pageCited.n, aio),
        `${REPORT_DEFINITIONS.pageCited} Share of AI Overviews.`
      ),
      kpi(
        REPORT_KPI_LABELS.named,
        n(overview.named),
        share(overview.named.n, aio),
        `${REPORT_DEFINITIONS.named} Share of AI Overviews.`
      ),
      kpi(
        REPORT_KPI_LABELS.winning,
        n(overview.winning),
        share(overview.winning.n, aio),
        REPORT_DEFINITIONS.winning
      ),
      kpi(
        REPORT_KPI_LABELS.notVisible,
        n(overview.notVisible),
        share(overview.notVisible.n, aio),
        REPORT_DEFINITIONS.notVisible
      ),
      kpi(
        REPORT_KPI_LABELS.wrongPage,
        n(overview.wrongPage),
        share(overview.wrongPage.n, aio),
        REPORT_DEFINITIONS.wrongPage
      ),
      kpi(
        REPORT_KPI_LABELS.score,
        num(overview.score),
        { kind: 'blank' },
        `0–100. ${REPORT_DEFINITIONS.score}`
      ),
      kpi('Score change', num(overview.scoreChange), { kind: 'blank' }, previous),
      [
        text('Previous full check'),
        date(overview.previousCheckAt),
        { kind: 'blank' },
        text(overview.coverageLine)
      ]
    ]
  )
  const tracked = overview.tracked.n
  const funnel = draft(
    'overview-funnel',
    'Where visibility falls away',
    ['Step', 'Prompts', 'Share of tracked', 'Why prompts drop out before this step'],
    overview.funnel.map((step) => [
      text(step.label),
      n(step.count),
      share(step.count.n, tracked),
      text(step.dropReason)
    ])
  )
  const tables = [
    kpis,
    funnel,
    opportunity(
      'overview-opportunity-stage',
      'Opportunity by stage',
      'Stage',
      overview.opportunityByStage
    )
  ]
  if (overview.opportunityByPage.length > 0) {
    tables.push(
      opportunity(
        'overview-opportunity-page',
        'Opportunity by page',
        'Page',
        overview.opportunityByPage
      )
    )
  }
  if (overview.topActions.length > 0) {
    tables.push(
      draft(
        'overview-actions',
        'Top actions',
        ['Rank', 'Action', 'Why', 'Prompt', 'Market'],
        overview.topActions.map((action) => {
          const row = context.row(action.rowId)
          return [
            num(action.rank),
            text(action.text),
            text(action.reason),
            text(row?.text),
            text(row === undefined ? null : context.marketLabel(row.marketId))
          ]
        })
      )
    )
  }
  return tables
}

function opportunity(
  id: string,
  sheetName: string,
  label: string,
  bars: readonly OpportunityBar[]
): DraftTable {
  return draft(
    id,
    sheetName,
    [
      label,
      total('AI Overview shown'),
      total('Not visible'),
      total('Named only'),
      total('Cited only'),
      total('Already winning')
    ],
    bars.map((bar) => [
      text(bar.label),
      n(bar.total),
      n(bar.notVisible),
      n(bar.namedOnly),
      n(bar.citedOnly),
      n(bar.winning)
    ])
  )
}

export function pagesTables(context: TableContext): DraftTable[] {
  const section = context.model.pagesSection
  if (section.empty !== null) return [emptyTable('pages', section.empty)]
  const tables: DraftTable[] = [
    draft(
      'pages-tracked',
      'Your pages',
      [
        'Page',
        'URL',
        'Title',
        'Visibility score',
        'Prompts',
        'AI Overview shown',
        'Page cited',
        'Own domain cited',
        'Brand named',
        'Citations to the page',
        'Citations to other own pages',
        'Last checked'
      ],
      section.tracked.map((page) => [
        text(page.path),
        text(page.url),
        text(page.title),
        num(page.score),
        n(page.prompts),
        n(page.aio),
        n(page.pageCited),
        n(page.ownCited),
        n(page.named),
        num(page.citationsTarget),
        num(page.citationsOtherOwn),
        date(page.lastChecked)
      ])
    )
  ]
  if (section.otherOwn.length > 0) {
    tables.push(
      draft(
        'pages-other-own',
        'Other own pages cited',
        ['Page', 'URL', 'Prompts', 'Citations', 'Likely noise'],
        section.otherOwn.map((page) => [
          text(page.path),
          text(page.url),
          n(page.prompts),
          num(page.citations),
          bool(page.likelyNoise)
        ])
      )
    )
  }
  if (section.wrongPage.length > 0) {
    tables.push(
      draft(
        'pages-wrong-page',
        'Wrong page cited',
        ['Prompt', 'Market', 'Cited own URL', 'Tracked page'],
        section.wrongPage.map((item) => [
          text(item.prompt),
          text(context.marketLabel(item.marketId)),
          text(item.citedUrl),
          text(item.trackedUrl)
        ])
      )
    )
  }
  return tables
}

export function competitionTables(context: TableContext): DraftTable[] {
  const section = context.model.competition
  if (section.empty !== null) return [emptyTable('competition', section.empty)]
  const sov = section.sov
  const whole = sov.total.n
  return [
    draft(
      'competition-share-of-voice',
      'Share of voice',
      ['Group', 'Prompts', 'Share of AI Overviews'],
      [
        [text('You are cited'), n(sov.you), share(sov.you.n, whole)],
        [
          text('A competitor is cited, you are not'),
          n(sov.competitor),
          share(sov.competitor.n, whole)
        ],
        [text('Someone else only'), n(sov.others), share(sov.others.n, whole)],
        [text('No cited source'), n(sov.none), share(sov.none.n, whole)],
        [text('Prompts with an AI Overview'), n(sov.total), share(whole, whole)]
      ]
    ),
    draft(
      'competition-leaderboard',
      'Citation leaderboard',
      [
        'Domain',
        'Who',
        'Prompts',
        'Overlap',
        'Gap',
        'Avg position',
        'Authority',
        'Reach',
        'Prominence',
        'Market coverage'
      ],
      section.leaderboard.map((row) => [
        text(row.domain),
        text(WHO_LABELS[row.who]),
        n(row.prompts),
        n(row.overlap),
        n(row.gap),
        num(row.avgPosition),
        num(row.authority),
        ratio(row.reach),
        ratio(row.prominence),
        ratio(row.marketCoverage)
      ])
    )
  ]
}

export function reputationTables(context: TableContext): DraftTable[] {
  const section = context.model.reputation
  if (section.empty !== null) return [emptyTable('reputation', section.empty)]
  const all = section.positive.n + section.neutral.n + section.negative.n
  const tables: DraftTable[] = [
    draft(
      'reputation-split',
      'Sentiment split',
      ['Tone', 'Answers', 'Share'],
      [
        [text('Positive'), n(section.positive), share(section.positive.n, all)],
        [text('Neutral'), n(section.neutral), share(section.neutral.n, all)],
        [text('Negative'), n(section.negative), share(section.negative.n, all)],
        [text('Analysed answers that name the brand'), num(section.analysed), { kind: 'blank' }],
        section.net === null
          ? [text('Net sentiment'), text('Not enough data'), { kind: 'blank' }]
          : [text('Net sentiment'), num(section.net), { kind: 'blank' }]
      ]
    )
  ]
  if (section.trend.length > 0) {
    tables.push(
      draft(
        'reputation-trend',
        'Sentiment over time',
        ['Check', 'Positive', 'Neutral', 'Negative'],
        section.trend.map((point) => [
          date(point.at),
          num(point.positive),
          num(point.neutral),
          num(point.negative)
        ])
      )
    )
  }
  if (section.issues.length > 0) {
    tables.push(
      draft(
        'reputation-issues',
        'Factual problems',
        [
          'Prompt',
          'What the overview claims',
          'Why it is wrong',
          'Suggested correction',
          'Source to fix'
        ],
        section.issues.map((issue) => [
          text(issue.prompt),
          text(issue.claim),
          text(issue.whyWrong),
          text(issue.correction),
          text(issue.sourceToFix)
        ])
      )
    )
  }
  if (section.answers.length > 0) {
    tables.push(
      draft(
        'reputation-answers',
        'Answer by answer',
        ['Prompt', 'Tone', 'Theme', 'Rank', 'Why'],
        section.answers.map((answer) => [
          text(answer.prompt),
          text(answer.tone.charAt(0).toUpperCase() + answer.tone.slice(1)),
          text(answer.theme),
          text(answer.rank),
          text(answer.why)
        ])
      )
    )
  }
  return tables
}

/** The four "what changed" lists, in report order. */
export const DELTA_KINDS = [
  { key: 'gained', label: 'Gained citations' },
  { key: 'lost', label: 'Lost citations' },
  { key: 'newlyNamed', label: 'Newly named' },
  { key: 'noLongerNamed', label: 'No longer named' }
] as const

export const NO_CHANGES = 'No changes in this category.'

export function trendsTables(context: TableContext): DraftTable[] {
  const section = context.model.trends
  if (section.empty !== null) return [emptyTable('trends', section.empty)]
  const changes: Cell[][] = []
  for (const kind of DELTA_KINDS) {
    const list: DeltaList = section[kind.key]
    if (list.items.length === 0) {
      changes.push([
        text(kind.label),
        text(NO_CHANGES),
        { kind: 'blank' },
        { kind: 'blank' },
        { kind: 'blank' },
        { kind: 'blank' }
      ])
      continue
    }
    for (const item of list.items) {
      changes.push([
        text(kind.label),
        text(item.prompt),
        text(item.pagePath),
        text(context.marketLabel(item.marketId)),
        text(item.before),
        text(item.after)
      ])
    }
  }
  const tables: DraftTable[] = [
    draft(
      'trends-series',
      'Trends',
      [
        'Check',
        'Prompts checked',
        'AI Overview shown',
        'Own domain cited',
        'Page cited',
        'Brand named',
        'Visibility score',
        'Partial'
      ],
      section.series.map((point) => [
        date(point.at),
        num(point.checked),
        num(point.aio),
        num(point.ownCited),
        num(point.pageCited),
        num(point.named),
        num(point.score),
        bool(point.partial)
      ])
    ),
    draft(
      'trends-changes',
      'Changes since previous check',
      ['Change', 'Prompt', 'Page', 'Market', 'Before', 'After'],
      changes
    )
  ]
  if (section.verdicts.length > 0) {
    tables.push(
      draft(
        'trends-fix-verdicts',
        'Fix verdicts',
        ['Fix', 'Page', 'What changed', 'Went live', 'Verdict', 'Prompts'],
        section.verdicts.map((verdict) => [
          num(verdict.number),
          text(context.pagePath(verdict.pageId)),
          text(verdict.description),
          date(verdict.goLiveAt),
          text(verdict.label),
          n(verdict.prompts)
        ])
      )
    )
  }
  return tables
}
