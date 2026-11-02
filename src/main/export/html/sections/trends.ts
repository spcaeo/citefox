import type { DeltaList, FixVerdictKind, FixVerdictModel, TrendPointModel } from '../../model/types'
import { trendLineChart } from '../charts/line'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc } from '../escape'
import { marketById, shortDate } from '../format'
import { card, drill, note, sectionShell, subHeading } from '../parts'
import { table } from '../tables'

const VERDICT_CLASS: Record<FixVerdictKind, string> = {
  worked: 'v-worked',
  partly: 'v-partly',
  no_change: 'v-none',
  pending: 'v-pending'
}

/** Section 6: results over time, what changed since the previous full check, and fix verdicts. */
export function renderTrends(ctx: RenderContext): RenderedSection {
  const section = ctx.model.trends
  const tz = ctx.timeZone
  const subs: SubLink[] = [
    { id: 'tr-over-time', title: 'AI Overview over time' },
    { id: 'tr-changed', title: 'What changed' },
    { id: 'tr-verdicts', title: 'Fix verdicts' }
  ]
  const overTime =
    subHeading(
      'tr-over-time',
      'AI Overview over time',
      'Prompts checked, AI Overviews shown, and how often they cite or name you, check by check.'
    ) +
    card(trendLineChart(section, tz)) +
    table<TrendPointModel>(ctx, {
      id: 'trend-series',
      title: 'Check by check',
      rows: section.series,
      limit: 6,
      columns: [
        {
          header: 'Check',
          kind: 'nowrap',
          html: (row) =>
            `${esc(shortDate(row.at, tz))}${row.partial ? ' <span class="tag">partial</span>' : ''}`,
          csv: (row) => row.at
        },
        {
          header: 'Prompts checked',
          kind: 'num',
          html: (row) => esc(row.checked),
          csv: (row) => row.checked
        },
        { header: 'AIO shown', kind: 'num', html: (row) => esc(row.aio), csv: (row) => row.aio },
        {
          header: 'Domain cited',
          kind: 'num',
          html: (row) => esc(row.ownCited),
          csv: (row) => row.ownCited
        },
        {
          header: 'Page cited',
          kind: 'num',
          html: (row) => esc(row.pageCited),
          csv: (row) => row.pageCited
        },
        {
          header: 'Brand named',
          kind: 'num',
          html: (row) => esc(row.named),
          csv: (row) => row.named
        },
        {
          header: 'Score',
          kind: 'num',
          html: (row) => esc(row.score ?? '—'),
          csv: (row) => row.score
        }
      ]
    })

  const window =
    section.previousAt === null || section.currentAt === null
      ? 'There is no earlier full check to compare with yet.'
      : `Comparing the full check on ${shortDate(section.previousAt, tz)} with ${shortDate(section.currentAt, tz)}.`
  const changed =
    subHeading('tr-changed', 'What changed since the previous full check', window) +
    `<div class="grid-2">${[
      deltaCard(ctx, 'Gained citations', section.gained),
      deltaCard(ctx, 'Lost citations', section.lost),
      deltaCard(ctx, 'Newly named', section.newlyNamed),
      deltaCard(ctx, 'No longer named', section.noLongerNamed)
    ].join('')}</div>`

  const verdicts =
    subHeading(
      'tr-verdicts',
      'Fix verdicts',
      'For each logged fix, what happened to its prompts after it went live.'
    ) +
    table<FixVerdictModel>(ctx, {
      id: 'fix-verdicts',
      quiet: true,
      title: 'Fix verdicts',
      rows: section.verdicts,
      empty:
        'No fixes logged yet. Log a fix in CiteFox when you change a page, and the next checks will show whether it worked.',
      columns: [
        {
          header: 'Fix',
          kind: 'nowrap',
          html: (row) => `Fix ${row.number}`,
          csv: (row) => `Fix ${row.number}`
        },
        {
          header: 'What changed',
          kind: 'wide',
          html: (row) => esc(row.description),
          csv: (row) => row.description
        },
        {
          header: 'Went live',
          kind: 'nowrap',
          html: (row) => esc(shortDate(row.goLiveAt, tz)),
          csv: (row) => row.goLiveAt
        },
        {
          header: 'Verdict',
          html: (row) =>
            `<span class="verdict ${VERDICT_CLASS[row.verdict]}">${esc(row.label)}</span>`,
          csv: (row) => row.label
        },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Fix ${row.number} · prompts`),
          csv: (row) => row.prompts.n
        }
      ]
    }) +
    note(
      'A verdict compares results before and after a fix went live. It shows what changed, not that the fix caused it.'
    )

  return sectionShell(
    'trends',
    overTime + changed + verdicts,
    subs,
    section.empty,
    'How AI Overview results moved over the data window, what changed since the previous full check, and how logged fixes did.'
  )
}

function deltaCard(ctx: RenderContext, title: string, list: DeltaList): string {
  const items =
    list.items.length === 0
      ? '<p class="tbl-empty">No changes in this category.</p>'
      : `<ul class="deltas">${list.items
          .map(
            (item) =>
              `<li><p class="delta-prompt">${esc(item.prompt)}</p><p class="delta-meta"><span class="path">${esc(item.pagePath)}</span> · ${esc(
                marketById(ctx.model, item.marketId)
              )}</p><p class="delta-move"><span class="before">${esc(item.before)}</span><span class="arrow" aria-hidden="true">→</span><span class="sr-only"> to </span><span class="after">${esc(item.after)}</span></p></li>`
          )
          .join('')}</ul>`
  return card(
    `<div class="delta-head"><p class="chart-title">${esc(title)}</p>${drill(list.count, title)}</div>${items}`,
    'delta-card'
  )
}
