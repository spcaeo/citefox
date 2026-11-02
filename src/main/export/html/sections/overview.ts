import { failedSearchesText, REPORT_DEFINITIONS, REPORT_KPI_LABELS } from '@shared/report-copy'
import { funnelChart, opportunityChart } from '../charts/funnel'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc } from '../escape'
import { pct, plural, shortDate } from '../format'
import {
  card,
  drill,
  kpi,
  kpis,
  note,
  plainValue,
  rowButton,
  sectionShell,
  subHeading
} from '../parts'

/** Section 2: the headline, KPI tiles, the funnel and the opportunity. */
export function renderOverview(ctx: RenderContext): RenderedSection {
  const { overview, cover, markets } = ctx.model
  const subs: SubLink[] = [
    { id: 'ov-funnel', title: 'Where visibility falls away' },
    { id: 'ov-opportunity', title: 'The opportunity' }
  ]
  const scoreChange =
    overview.scoreChange === null || overview.previousCheckAt === null
      ? 'No earlier full check to compare'
      : `${overview.scoreChange > 0 ? '▲ ' : overview.scoreChange < 0 ? '▼ ' : ''}${Math.abs(overview.scoreChange)} since ${shortDate(overview.previousCheckAt, ctx.timeZone)}`
  const tiles = kpis([
    kpi({
      label: REPORT_KPI_LABELS.tracked,
      value: drill(overview.tracked, REPORT_KPI_LABELS.tracked),
      sub:
        markets.length > 1 ? `across ${plural(markets.length, 'market')}` : 'buyer prompts in scope'
    }),
    kpi({
      label: REPORT_KPI_LABELS.aio,
      value: drill(overview.aio, REPORT_KPI_LABELS.aio),
      sub:
        overview.failed.n > 0
          ? `${pct(overview.aioPct)} of tracked · ${failedSearchesText(overview.failed.n)}`
          : `${pct(overview.aioPct)} of tracked`
    }),
    kpi({
      label: REPORT_KPI_LABELS.cited,
      value: drill(overview.cited, REPORT_KPI_LABELS.cited),
      sub: `${pct(overview.citedPct)} of those answers`,
      tone: 'good'
    }),
    kpi({
      label: REPORT_KPI_LABELS.named,
      value: drill(overview.named, REPORT_KPI_LABELS.named),
      sub: 'named in the answer text'
    }),
    kpi({
      label: REPORT_KPI_LABELS.notVisible,
      value: drill(overview.notVisible, REPORT_KPI_LABELS.notVisible),
      sub: 'answer shown, you absent',
      tone: 'warn'
    }),
    kpi({
      label: REPORT_KPI_LABELS.score,
      value:
        overview.score === null
          ? plainValue('—')
          : `${plainValue(overview.score)}<span class="kpi-unit">/100</span>`,
      sub: scoreChange,
      tone: 'accent'
    })
  ])
  const secondary =
    `<p class="kpi-strip">` +
    (cover.scope === 'page'
      ? `<span>${esc(REPORT_KPI_LABELS.pageCited)} ${drill(overview.pageCited, REPORT_KPI_LABELS.pageCited)}</span>`
      : '') +
    `<span>${esc(REPORT_KPI_LABELS.winning)} ${drill(overview.winning, REPORT_KPI_LABELS.winning)}</span>` +
    `<span>${esc(REPORT_KPI_LABELS.wrongPage)} ${drill(overview.wrongPage, REPORT_KPI_LABELS.wrongPage)}</span>` +
    (overview.failed.n > 0
      ? `<span>${drill(overview.failed, 'Searches failed')} ${overview.failed.n === 1 ? 'search failed' : 'searches failed'}</span>`
      : '') +
    '</p>'

  const funnel =
    subHeading(
      'ov-funnel',
      'Where visibility falls away',
      'Each step keeps only the prompts that passed the step before. The biggest drop is where the work is.'
    ) + card(funnelChart(overview.funnel))

  const byPage =
    overview.opportunityByPage.length === 0
      ? ''
      : `<p class="chart-title">By page</p>${opportunityChart(overview.opportunityByPage, 'page')}`
  const opportunity =
    subHeading(
      'ov-opportunity',
      'The opportunity',
      'Prompts with an AI Overview, split by how the answer treats you. The groups with the most answers that leave you out come first.'
    ) +
    card(
      `<p class="chart-title">By intent stage</p>${opportunityChart(overview.opportunityByStage, 'stage')}${byPage}` +
        note(
          `“Already winning” means ${lowerFirst(REPORT_DEFINITIONS.winning)} That is the strongest result an AI Overview can give you.`
        ) +
        note(`“Not visible” means ${lowerFirst(REPORT_DEFINITIONS.notVisible)}`)
    )

  const actions =
    overview.topActions.length === 0
      ? ''
      : subHeading(
          'ov-actions',
          'Where to start',
          'The changes most likely to win an answer, in order.'
        ) +
        `<ol class="actions">${overview.topActions
          .map(
            (action) =>
              `<li><span class="action-rank">${action.rank}</span><div><p class="action-text">${esc(action.text)}</p>` +
              `<p class="action-reason">${esc(action.reason)} ${rowButton(action.rowId, action.text)}</p></div></li>`
          )
          .join('')}</ol>`
  if (actions.length > 0) subs.push({ id: 'ov-actions', title: 'Where to start' })

  const body =
    `<p class="headline">${esc(overview.headline)}</p>${tiles}${secondary}${funnel}${opportunity}${actions}` +
    note(overview.coverageLine, 'coverage')
  return sectionShell(
    'overview',
    body,
    subs,
    null,
    'Where you stand in Google AI Overviews for these buyer prompts. Every count opens the prompts behind it.'
  )
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value[0]?.toLowerCase() + value.slice(1)
}
