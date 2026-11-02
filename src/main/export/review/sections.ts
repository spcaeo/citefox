import {
  bucketColumns,
  funnelChart,
  historyStrip,
  pairedBars,
  positionChart,
  rankedBars,
  splitBar,
  type ChartMarkup
} from '@shared/charts'
import {
  groupsChart,
  historyChart,
  LENS_LABELS,
  MOVEMENT_LABELS,
  PAGE_STATUS_LABELS,
  pagesChart,
  percent,
  positionsChart,
  rankedChart,
  REVIEW_LENSES,
  signedTenths,
  speedChart,
  splitChart,
  VERDICT_WAIT_DAYS,
  type Kpi,
  type Num,
  type PageItem,
  type Part,
  type ReviewReport,
  type ReviewSectionId,
  type Step,
  type Tile
} from '@shared/report/review'
import type { RenderContext } from '../html/context'
import { backlinksHtml, deepHtml, lostHtml, roundHtml } from './sections-more'
import {
  changedPagesHtml,
  changedReportHtml,
  namedColumns,
  splitTableHtml,
  structureHtml,
  verdictFooterHtml
} from './sections-changed'
import {
  daysHtml,
  introHtml,
  kindsHtml,
  methodMoreHtml,
  notIndexedMoreHtml,
  roundHeroHtml,
  roundTablesHtml,
  storiesHtml,
  topSitesHtml
} from './sections-impact'
import {
  reputationHtml,
  visibilityPagesHtml,
  visibilityStandingHtml,
  visibilityTopicsHtml
} from './sections-visibility'
import { competitorsHtml, historyLegendHtml, questionTable } from './sections-compete'
import { shapeHtml, sourcesHtml } from './sections-sources'
import {
  h2hHtml,
  pitchCompetitorsHtml,
  pitchPlanHtml,
  summaryHtml,
  writePlanHtml
} from './sections-ready'
import { esc, slugId } from '../html/escape'
import { pageCopy, textCopy } from '../html/copy'
import { table, type Column } from '../html/tables'

/**
 * The downloaded ready report's sections, as HTML strings, from the same report model the
 * app draws (src/shared/report/review). Every number is a drill button the report script
 * opens (`button.drill`), every chart the shared SVG builders' markup.
 */

export interface ViewCtx {
  /** The engine view these sections belong to; prefixes drill and table ids. */
  view: string
  report: ReviewReport
  tables: RenderContext['tables']
}

export { competitorsHtml, questionTable }

export const FULL = 760
export const HALF = 520

export function tableCtx(ctx: ViewCtx): RenderContext {
  return { tables: ctx.tables } as unknown as RenderContext
}

export function chart(markup: ChartMarkup, ctx: ViewCtx): string {
  const svg = markup.svg.replace(/data-drill="([^"]*)"/g, (_m, id: string) => {
    const known = ctx.report.drills[unescape(id)]
    return known?.kind === 'questions' ? `data-drill="${esc(`${ctx.view}|${unescape(id)}`)}"` : ''
  })
  return `<div class="cfc-frame">${svg}</div>`
}

function unescape(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** A clickable number: a drill button for a question list, else plain text. */
export function num(ctx: ViewCtx, value: Num, text?: string): string {
  const shown = esc(text ?? value.n.toLocaleString('en-US'))
  const drill = ctx.report.drills[value.drill]
  if (value.n === 0 || drill === undefined || drill.kind !== 'questions') {
    return `<span class="num rv-plain">${shown}</span>`
  }
  const token = `${ctx.view}|${value.drill}`
  return (
    `<button type="button" class="drill inline" data-drill="${esc(token)}" data-n="${value.n}"` +
    ` data-label="${esc(drill.title)}" aria-label="${esc(`${value.n} — ${drill.title}. Show the questions`)}">${shown}</button>`
  )
}

export function parts(ctx: ViewCtx, list: readonly Part[]): string {
  return list.map((part) => (typeof part === 'string' ? esc(part) : num(ctx, part))).join('')
}

export function panel(title: string, body: string, sub?: string, cls = ''): string {
  return (
    `<div class="card rv-card ${cls}"><h3 class="sub">${esc(title)}</h3>` +
    `${sub ? `<p class="lede">${esc(sub)}</p>` : ''}${body}</div>`
  )
}

function kpiTile(ctx: ViewCtx, kpi: Kpi): string {
  const drill = ctx.report.drills[kpi.drill]
  const value =
    drill === undefined || drill.ids.length === 0
      ? `<span class="num">${esc(kpi.now)}</span>`
      : `<button type="button" class="drill" data-drill="${esc(`${ctx.view}|${kpi.drill}`)}" data-n="${drill.ids.length}" data-label="${esc(drill.title)}">${esc(kpi.now)}</button>`
  const trend =
    kpi.trend === 'up'
      ? ' <span class="rv-up">▲</span>'
      : kpi.trend === 'down'
        ? ' <span class="rv-down">▼</span>'
        : ''
  const was =
    kpi.before !== null && ctx.report.fromLabel !== null
      ? `<p class="kpi-sub">${esc(ctx.report.fromLabel)}: ${esc(kpi.before)}</p>`
      : ''
  const note = kpi.note ? `<p class="kpi-note">${esc(kpi.note)}</p>` : ''
  return `<div class="kpi"><p class="kpi-label">${esc(kpi.label)}</p><p class="kpi-value">${value}${trend}</p>${was}${note}</div>`
}

export function tiles(ctx: ViewCtx, list: readonly Tile[], chipTable?: string): string {
  const cells = list.map((tile) => {
    const tone = tile.tone === 'ok' ? ' rv-ok' : tile.tone === 'warn' ? ' rv-warn' : ''
    let value = `<span class="num">${esc(tile.value)}</span>`
    if (tile.drill !== null) {
      const drill = ctx.report.drills[tile.drill]
      if (drill?.kind === 'questions' && drill.ids.length > 0) {
        value = num(ctx, { n: drill.ids.length, drill: tile.drill }, tile.value)
      } else if (drill?.kind === 'pages' && tile.chip !== undefined && chipTable !== undefined) {
        value = `<button type="button" class="drill" data-seg-table="${esc(slugId(chipTable))}" data-seg-value="${esc(tile.chip === 'all' ? '' : tile.chip)}">${esc(tile.value)}</button>`
      }
    }
    return `<div class="kpi${tone}"><p class="kpi-value">${value}</p><p class="kpi-label">${esc(tile.label)}</p></div>`
  })
  return `<div class="kpis rv-tiles">${cells.join('')}</div>`
}

export function steps(ctx: ViewCtx, list: readonly Step[]): string {
  if (list.length === 0) return '<p class="muted">Nothing to do right now.</p>'
  const open = (step: Step): string => {
    const tab = ctx.report.sections.find((s) => s.id === step.tab && s.empty === undefined)
    return tab === undefined ? '' : ` <a href="#sec-${tab.id}">Open ${esc(tab.title)} →</a>`
  }
  return `<ol class="rv-steps">${list
    .map(
      (step) => `<li><strong>${esc(step.lead)}</strong> ${parts(ctx, step.parts)}${open(step)}</li>`
    )
    .join('')}</ol>`
}

const STATUS_CHIP: Readonly<Record<PageItem['status'], string>> = {
  cited: 's-target',
  notyet: 's-none',
  toonew: 's-noaio',
  lost: 's-none'
}

function pageTable(ctx: ViewCtx, id: string, title: string, rows: readonly PageItem[]): string {
  const { report } = ctx
  const columns: Column<PageItem>[] = [
    {
      header: 'Page',
      kind: 'path',
      html: (row) =>
        `<strong>${esc(row.title ?? row.path)}</strong><br>${pageCopy(row.url, row.path)}`,
      csv: (row) => row.url
    },
    {
      header: 'Kind',
      html: (row) => esc(row.kind === 'new' ? 'New' : row.kind === 'rewrite' ? 'Rewrite' : '—'),
      csv: (row) => row.kind ?? ''
    },
    {
      header: 'Days live',
      kind: 'num',
      html: (row) => esc(row.daysLive ?? '—'),
      csv: (row) => row.daysLive
    },
    {
      header: 'Google index',
      html: (row) =>
        row.indexed === null
          ? '<span class="muted">Not checked</span>'
          : `<span class="chip ${row.indexed ? 's-target' : 's-none'}">${row.indexed ? 'Indexed' : 'Not indexed'}</span>`,
      csv: (row) => (row.indexed === null ? '' : row.indexed ? 'Indexed' : 'Not indexed')
    },
    ...(report.fromLabel !== null
      ? [
          {
            header: `Questions ${report.fromLabel}`,
            kind: 'num' as const,
            html: (row: PageItem) => esc(row.before ?? '—'),
            csv: (row: PageItem) => row.before
          }
        ]
      : []),
    {
      header: report.toLabel,
      kind: 'num',
      html: (row) => `<strong>${row.now}</strong>`,
      csv: (row) => row.now
    },
    {
      header: '#1 spots',
      kind: 'num',
      html: (row) => esc(report.impact.pageStats[row.url]?.first ?? 0),
      csv: (row) => report.impact.pageStats[row.url]?.first ?? 0
    },
    {
      header: 'Avg position',
      kind: 'num',
      html: (row) => esc(report.impact.pageStats[row.url]?.avg?.toFixed(1) ?? '—'),
      csv: (row) => report.impact.pageStats[row.url]?.avg ?? null
    },
    {
      header: 'Status',
      html: (row) =>
        `<span class="chip ${STATUS_CHIP[row.status]}">${esc(PAGE_STATUS_LABELS[row.status])}</span>`,
      csv: (row) => PAGE_STATUS_LABELS[row.status]
    }
  ]
  return table(tableCtx(ctx), {
    id: `${ctx.view}-${id}`,
    title,
    columns,
    rows,
    limit: 25,
    sortable: true,
    filter: rows.length > 10,
    segment: (row) => row.status
  })
}

export function chips(
  wanted: string,
  list: readonly { id: string; label: string; count: number }[]
): string {
  // The table's wrap id is the slug of its id (html/tables.ts).
  const tableId = slugId(wanted)
  return `<div class="seg-bar">${list
    .map(
      (chip) =>
        `<button type="button" class="seg" data-seg-table="${esc(tableId)}" data-seg-value="${esc(chip.id === 'all' ? '' : chip.id)}" aria-pressed="${chip.id === 'all'}">${esc(chip.label)} <span class="seg-n">${chip.count}</span></button>`
    )
    .join('')}</div>`
}

export function verdictHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const v = report.verdict
  const split = splitChart(report)
  const impact = report.kind === 'impact'
  const findings = [...v.findings, ...(impact ? report.impact.proofs : [])]
    .map(
      (finding) =>
        `<li class="vd-finding vd-${finding.tone}"><span class="vd-lead">${esc(finding.lead)}</span> ${parts(ctx, finding.parts)}</li>`
    )
    .join('')
  const head =
    `<div class="card vd-card"><div class="vd-head"><span class="vd-badge vd-${v.badge.tone}">${esc(v.badge.label)}</span>` +
    `<span class="vd-dates">${esc(report.windowLabel)}</span></div>` +
    `<p class="rv-vline">${parts(ctx, v.headline)}</p><ul class="vd-findings">${findings}</ul>` +
    `<div class="kpis">${v.kpis.map((kpi) => kpiTile(ctx, kpi)).join('')}</div></div>`
  const splitHtml =
    v.split !== null && split !== null && (v.split.marketTenths !== 0 || v.split.workTenths !== 0)
      ? panel(
          'Market vs your work',
          chart(splitBar({ ...split, width: FULL, titles: true }), ctx) +
            `<p class="note">Market: ${num(ctx, v.split.newAnswers)} questions got an AI answer for the first time, scored at your old share of ${esc(percent(v.split.rateBefore))}. Your work: your share went ${esc(percent(v.split.rateBefore))} → ${esc(percent(v.split.rateAfter))}. The two parts add up exactly to ${esc(signedTenths(v.split.totalTenths))}.</p>` +
            splitTableHtml(ctx),
          'A question can only cite you if an AI answer shows at all. So a change has two parts: more answers appearing (the market) and you winning more of them (your work).'
        )
      : ''
  const charts =
    report.published.rows.length > 0
      ? `<div class="grid-2">${panel(
          'Where your citations come from',
          chart(pairedBars({ ...groupsChart(report), width: HALF, titles: true }), ctx),
          'Questions citing each group of your pages.'
        )}${panel(
          'How fast new pages get cited',
          chart(bucketColumns({ ...speedChart(report), width: HALF, titles: true }), ctx),
          `Published pages by days live on ${report.toLabel}.`
        )}</div>`
      : ''
  return (
    (impact ? introHtml(ctx) : '') +
    head +
    splitHtml +
    charts +
    (impact ? topSitesHtml(ctx) : '') +
    panel('What we do next', steps(ctx, v.next.slice(0, 4))) +
    verdictFooterHtml(ctx)
  )
}

export function standingHtml(ctx: ViewCtx): string {
  const { report } = ctx
  return (
    `<div class="kpis">${report.standing.kpis.map((kpi) => kpiTile(ctx, kpi)).join('')}</div>` +
    `<div class="grid-2">${panel(
      'Where visibility falls away',
      chart(
        funnelChart({
          label: 'Where visibility falls away',
          width: HALF,
          titles: true,
          steps: report.standing.funnel.map((step) => ({
            id: step.drill,
            label: step.label,
            value: step.value
          }))
        }),
        ctx
      )
    )}${panel(
      'Where you sit among the sources',
      chart(positionChart({ ...positionsChart(report), width: HALF, titles: true }), ctx)
    )}</div>` +
    panel(
      'Most cited sites',
      chart(rankedBars({ ...rankedChart(report), width: FULL, titles: true }), ctx)
    )
  )
}

export function publishedHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const id = `${ctx.view}-published`
  return (
    tiles(ctx, report.published.tiles, id) +
    `<p class="note"><strong>The ${VERDICT_WAIT_DAYS}-day rule.</strong> AI answers take time to pick up a page. Pages live under ${VERDICT_WAIT_DAYS} days are shown but not judged yet.</p>` +
    `<div class="grid-2">${kindsHtml(ctx)}${daysHtml(ctx)}</div>` +
    chips(id, report.published.chips) +
    pageTable(ctx, 'published', 'Every published page', report.published.rows) +
    storiesHtml(ctx)
  )
}

export function changedHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const c = report.changed
  const note = report.comparing
    ? `<p class="note"><strong>The net hides movement.</strong> ${c.net >= 0 ? '+' : '−'}${Math.abs(c.net)} looks simple, but ${c.moved} questions moved to make it. ${num(ctx, c.compared)} questions were checked at both ends${c.excluded.n > 0 ? `; ${num(ctx, c.excluded)} could not be compared` : ''}.</p>`
    : '<p class="note">Only one check so far: nothing to compare yet.</p>'
  const movers = c.movers.length
    ? table(tableCtx(ctx), {
        id: `${ctx.view}-moved`,
        title: 'Every question that moved',
        rows: c.movers,
        limit: 25,
        columns: [
          {
            header: 'Question',
            kind: 'wide',
            html: (m) =>
              `${textCopy(m.question.text, `<button type="button" class="rv-q rv-rowbtn" data-row="${esc(`${ctx.view}|${m.question.id}`)}" data-label="${esc(m.question.text)}">${esc(m.question.text)}</button>`)}`,
            csv: (m) => m.question.text
          },
          { header: 'Topic', html: (m) => esc(m.question.topic), csv: (m) => m.question.topic },
          {
            header: 'History',
            html: (m) => historyStrip({ ...historyChart(m), titles: true }).svg,
            csv: (m) => m.cells.map((cell) => `${cell.date}: ${cell.state}`).join('; ')
          },
          {
            header: 'Change',
            html: (m) =>
              `<span class="chg chg-${m.question.change ?? 'none'}">${esc(MOVEMENT_LABELS[m.question.change ?? 'lost'])}</span>`,
            csv: (m) => (m.question.change ? MOVEMENT_LABELS[m.question.change] : '')
          }
        ]
      })
    : '<p class="muted">No question moved between these checks.</p>'
  return tiles(ctx, c.tiles) + note + (c.movers.length ? historyLegendHtml() : '') + movers
}

export function questionsHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const id = `${ctx.view}-questions`
  return (
    (report.comparing ? chips(id, report.questions.chips) : '') +
    questionTable(ctx, 'questions', 'Every question', report.questions.rows, {
      segment: true,
      funnel: true,
      topics: true
    })
  )
}

export function pagesHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const lost = report.lostGround.items.length
  return (
    panel(
      'Your pages: before and after',
      chart(pairedBars({ ...pagesChart(report), width: FULL, titles: true }), ctx),
      'Questions citing each page. Orange: lost ground.'
    ) +
    (lost > 0
      ? `<p class="note"><strong>${lost} ${lost === 1 ? 'page' : 'pages'} lost ground.</strong> See <a href="#sec-lost">Lost ground</a> for what changed and the questions lost.</p>`
      : '')
  )
}

export function topicsHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const group = `${ctx.view}-lens`
  const buttons = REVIEW_LENSES.map(
    (lens, index) =>
      `<button type="button" class="seg" data-switch="${esc(group)}" data-value="${lens}" aria-pressed="${index === 0}">${esc(LENS_LABELS[lens])}</button>`
  ).join('')
  const panels = REVIEW_LENSES.map((lens, index) => {
    const rows = report.topics.lenses[lens]
    const body = table(tableCtx(ctx), {
      id: `${ctx.view}-topics-${lens}`,
      title: `Results by ${LENS_LABELS[lens]}`,
      rows,
      limit: 20,
      sortable: true,
      columns: [
        {
          header: LENS_LABELS[lens],
          html: (r) => `<strong>${esc(r.value)}</strong>`,
          csv: (r) => r.value
        },
        {
          header: 'Questions',
          kind: 'num',
          html: (r) => num(ctx, r.questions),
          csv: (r) => r.questions.n
        },
        ...(report.fromLabel !== null
          ? [
              {
                header: `Cited ${report.fromLabel}`,
                kind: 'num' as const,
                html: (r: (typeof rows)[number]) => (r.before ? num(ctx, r.before) : '—'),
                csv: (r: (typeof rows)[number]) => r.before?.n ?? null
              }
            ]
          : []),
        {
          header: `Cited ${report.toLabel}`,
          kind: 'num',
          html: (r) => num(ctx, r.now),
          csv: (r) => r.now.n
        },
        {
          header: `Share ${report.toLabel}`,
          kind: 'num',
          html: (r) => esc(r.shareNow === null ? '—' : `${Math.round(r.shareNow * 100)}%`),
          csv: (r) => (r.shareNow === null ? null : Math.round(r.shareNow * 100))
        },
        {
          header: 'Answer, not you',
          kind: 'num',
          html: (r) => num(ctx, r.open),
          csv: (r) => r.open.n
        },
        ...(report.fromLabel !== null
          ? [
              {
                header: 'Change',
                kind: 'num' as const,
                html: (r: (typeof rows)[number]) =>
                  esc(r.change === null ? '—' : r.change > 0 ? `+${r.change}` : String(r.change)),
                csv: (r: (typeof rows)[number]) => r.change
              }
            ]
          : []),
        ...namedColumns<(typeof rows)[number]>(ctx, lens)
      ]
    })
    return `<div data-switch-panel="${esc(group)}" data-value="${lens}"${index === 0 ? '' : ' hidden'}>${body}</div>`
  }).join('')
  return `<div class="seg-bar" role="group" aria-label="Group questions by">${buttons}</div>${panels}`
}

export function notIndexedHtml(ctx: ViewCtx): string {
  const { report } = ctx
  return (
    tiles(ctx, report.notIndexed.tiles) +
    notIndexedMoreHtml(ctx) +
    (report.notIndexed.rows.length
      ? `<p class="lede">Addresses to send for indexing:</p><pre class="rv-urls">${report.notIndexed.rows.map((row) => esc(row.url)).join('\n')}</pre>`
      : '')
  )
}

export function nextHtml(ctx: ViewCtx): string {
  const impact = ctx.report.kind === 'impact'
  return (
    (impact ? roundHeroHtml(ctx.report) : '') +
    roundHtml(ctx) +
    (impact ? roundTablesHtml(ctx) : '') +
    panel(
      'What to do first',
      steps(ctx, ctx.report.verdict.next),
      'Each step comes from a finding in this review.'
    )
  )
}

export function methodHtml(ctx: ViewCtx): string {
  const { method } = ctx.report
  const agreement = method.agreement
    ? `<div class="kpi"><p class="kpi-value">${esc(method.agreement.percent)}%</p><p class="kpi-label">Engines agree on cited or not cited (${num(ctx, method.agreement.agree)} of ${num(ctx, method.agreement.pairs)})</p></div>`
    : ''
  return (
    method.paragraphs.map((text) => `<p class="rv-p">${esc(text)}</p>`).join('') +
    methodMoreHtml(ctx.report) +
    `<div class="kpis"><div class="kpi"><p class="kpi-value">${num(ctx, method.compared)}</p><p class="kpi-label">${ctx.report.comparing ? 'Questions checked at both ends' : 'Questions measured'}</p></div>${agreement}</div>`
  )
}

export const SECTION_HTML: Readonly<Record<ReviewSectionId, (ctx: ViewCtx) => string>> = {
  standing: visibilityStandingHtml,
  verdict: verdictHtml,
  published: (ctx) => publishedHtml(ctx) + changedPagesHtml(ctx),
  changed: (ctx) => (ctx.report.kind === 'changed' ? changedReportHtml(ctx) : changedHtml(ctx)),
  questions: questionsHtml,
  competitors: (ctx) =>
    ctx.report.kind === 'pitch' ? pitchCompetitorsHtml(ctx) : competitorsHtml(ctx),
  pages: visibilityPagesHtml,
  topics: visibilityTopicsHtml,
  reputation: reputationHtml,
  notindexed: notIndexedHtml,
  next: nextHtml,
  method: methodHtml,
  lost: lostHtml,
  backlinks: backlinksHtml,
  deep: (ctx) => structureHtml(ctx) + deepHtml(ctx),
  sources: sourcesHtml,
  shape: shapeHtml,
  summary: summaryHtml,
  plan: pitchPlanHtml,
  writeplan: writePlanHtml,
  h2h: h2hHtml
}
