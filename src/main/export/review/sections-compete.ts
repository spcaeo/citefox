import { donutChart, gainersLosers, historyLegendWords, rankedBars } from '@shared/charts'
import { pageKey } from '@shared/metrics'
import {
  moversChart,
  NOT_COMPARED_CHIP,
  pathOf,
  positionMove,
  rankedChart,
  sovChart,
  type SiteKindRow,
  type QuestionItem,
  type SiteRow
} from '@shared/report/review'
import { esc, slugId } from '../html/escape'
import { domainCopy, pageCopy, textCopy } from '../html/copy'
import { table, type Column } from '../html/tables'
import { chart, FULL, HALF, num, panel, tableCtx, tiles, type ViewCtx } from './sections'

/**
 * The parts every ready report shares in the downloaded file (Docs/REPORT-SPEC.md
 * "Competitors", "Questions"): the Competitors tab and the Questions table, from the
 * same report model the app draws.
 */

const RESULT_WORDS: Readonly<Record<string, string>> = {
  target: 'Right page cited',
  other: 'Your other page',
  not_cited: 'Not cited',
  no_answer: 'No AI answer',
  failed: 'Search failed'
}

const RESULT_CLASS: Readonly<Record<string, string>> = {
  target: 's-target',
  other: 's-own',
  not_cited: 's-none',
  no_answer: 's-noaio',
  failed: 's-error'
}

function result(value: string | null): string {
  if (value === null) return '<span class="muted">Not checked</span>'
  return `<span class="chip ${RESULT_CLASS[value] ?? ''}">${esc(RESULT_WORDS[value] ?? value)}</span>`
}

function signed(value: number | null): string {
  if (value === null) return '—'
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
}

function changeCell(value: number | null): string {
  if (value === null) return '<span class="muted">—</span>'
  const tone = value > 0 ? 'rv-up' : value < 0 ? 'rv-down' : 'muted'
  return `<span class="${tone}">${esc(value > 0 ? `▲ ${signed(value)}` : value < 0 ? `▼ ${signed(value)}` : '0')}</span>`
}

function positionText(before: number | null, now: number | null, comparing: boolean): string {
  const at = (value: number | null): string => (value === null ? '—' : `#${value}`)
  return comparing ? `${at(before)} → ${at(now)}` : at(now)
}

function positionHtml(before: number | null, now: number | null, comparing: boolean): string {
  const move = comparing ? positionMove(before, now) : null
  const pill =
    move === null || move.tone === 'flat'
      ? ''
      : ` <span class="chip ${move.tone === 'up' ? 's-target' : 's-none'}">${esc(move.text)}</span>`
  return `${esc(positionText(before, now, comparing))}${pill}`
}

/** A segment chip bar (the table's wrap id is the slug of its id). */
function segChips(
  tableId: string,
  list: readonly { id: string; label: string; count: number }[]
): string {
  const wrap = slugId(tableId)
  return `<div class="seg-bar">${list
    .map(
      (chip) =>
        `<button type="button" class="seg" data-seg-table="${esc(wrap)}" data-seg-value="${esc(chip.id === 'all' ? '' : chip.id)}" aria-pressed="${chip.id === 'all'}">${esc(chip.label)} <span class="seg-n">${chip.count}</span></button>`
    )
    .join('')}</div>`
}

function kindsTable(ctx: ViewCtx, sitesId: string): string {
  const { report } = ctx
  const rows = report.competition.kinds
  const wrap = slugId(sitesId)
  const columns: Column<SiteKindRow>[] = [
    {
      header: 'Kind of site',
      html: (row) =>
        `<button type="button" class="seg rv-kind" data-seg-table="${esc(wrap)}" data-seg-value="${esc(row.kind)}">${esc(row.label)}</button>`,
      csv: (row) => row.label
    },
    { header: 'Sites', kind: 'num', html: (row) => esc(row.sites), csv: (row) => row.sites },
    ...(report.fromLabel !== null
      ? [
          {
            header: `Citations ${report.fromLabel}`,
            kind: 'num' as const,
            html: (row: SiteKindRow) => esc(row.before ?? '—'),
            csv: (row: SiteKindRow) => row.before
          }
        ]
      : []),
    {
      header: `Citations ${report.toLabel}`,
      kind: 'num',
      html: (row) => num(ctx, row.questions, String(row.now)),
      csv: (row) => row.now
    },
    ...(report.fromLabel !== null
      ? [
          {
            header: 'Change',
            kind: 'num' as const,
            html: (row: SiteKindRow) => changeCell(row.change),
            csv: (row: SiteKindRow) => row.change
          }
        ]
      : [])
  ]
  return table(tableCtx(ctx), {
    id: `${ctx.view}-site-kinds`,
    title: 'Who else the AI answers cite',
    columns,
    rows,
    limit: 10,
    quiet: true
  })
}

function sitesTable(ctx: ViewCtx, id: string): string {
  const { report } = ctx
  const comparing = report.fromLabel !== null
  const columns: Column<SiteRow>[] = [
    { header: '#', kind: 'num', html: (s) => esc(s.rank), csv: (s) => s.rank },
    {
      header: 'Site',
      kind: 'path',
      html: (s) =>
        s.own
          ? `${domainCopy(s.domain, true)} <span class="muted">you</span>`
          : domainCopy(s.domain),
      csv: (s) => s.domain
    },
    { header: 'Kind', html: (s) => esc(s.kindLabel), csv: (s) => s.kindLabel },
    ...(comparing
      ? [
          {
            header: report.fromLabel ?? 'Before',
            kind: 'num' as const,
            html: (s: SiteRow) => (s.before === null ? '—' : num(ctx, s.before)),
            csv: (s: SiteRow) => s.before?.n ?? null
          }
        ]
      : []),
    {
      header: report.toLabel,
      kind: 'num',
      html: (s) => num(ctx, s.now),
      csv: (s) => s.now.n
    },
    ...(comparing
      ? [
          {
            header: 'Change',
            kind: 'num' as const,
            html: (s: SiteRow) => changeCell(s.change),
            csv: (s: SiteRow) => s.change
          }
        ]
      : []),
    {
      header: 'With you',
      kind: 'num',
      html: (s) => (s.withYou === null ? '—' : num(ctx, s.withYou)),
      csv: (s) => s.withYou?.n ?? null
    },
    {
      header: 'Gap',
      kind: 'num',
      html: (s) => (s.gap === null ? '—' : num(ctx, s.gap)),
      csv: (s) => s.gap?.n ?? null
    },
    {
      header: comparing ? 'Avg position before → now' : 'Avg position',
      kind: 'nowrap',
      html: (s) => positionHtml(s.positionBefore, s.positionNow, comparing),
      csv: (s) => positionText(s.positionBefore, s.positionNow, comparing),
      sort: (s) => s.positionNow
    }
  ]
  return table(tableCtx(ctx), {
    id,
    title: 'Every cited site',
    columns,
    rows: report.competition.sites,
    limit: 15,
    sortable: true,
    filter: report.competition.sites.length > 15,
    segment: (s) => s.kind ?? 'you'
  })
}

export function competitorsHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const c = report.competition
  if (c.tiles.length === 0) {
    return '<p class="note">No other site is cited in these AI answers yet. Run a check with AI answers to see who you compete with.</p>'
  }
  const sitesId = `${ctx.view}-sites`
  const kindChips = [
    { id: 'all', label: 'All', count: c.sites.length },
    ...c.kinds.map((row) => ({ id: row.kind, label: row.label, count: row.sites }))
  ]
  const movers = report.comparing
    ? panel(
        'Gained and lost ground',
        chart(gainersLosers({ ...moversChart(report), width: FULL, titles: true }), ctx),
        `Sites cited on more, or fewer, questions than on ${report.fromLabel}.`
      )
    : ''
  const sov =
    c.sov === null
      ? ''
      : panel(
          'Share of voice',
          chart(donutChart({ ...sovChart(report), width: HALF, titles: true }), ctx),
          'Who wins each AI answer: you, a named competitor, or other sites only.'
        )
  return (
    tiles(ctx, c.tiles) +
    `<div class="grid-2">${sov}${panel(
      'Who else the AI answers cite',
      kindsTable(ctx, sitesId),
      'Click a kind to show only those sites below.'
    )}</div>` +
    movers +
    panel(
      `Most cited sites, ${report.toLabel}`,
      chart(rankedBars({ ...rankedChart(report), width: FULL, titles: true }), ctx),
      report.comparing ? `The faint bar is ${report.fromLabel}.` : undefined
    ) +
    segChips(sitesId, kindChips) +
    sitesTable(ctx, sitesId)
  )
}

/** The Questions table: target page, results, position, cited through, funnel, intent. */
export function questionTable(
  ctx: ViewCtx,
  id: string,
  title: string,
  rows: readonly QuestionItem[],
  options: {
    segment?: boolean
    funnel?: boolean
    limit?: number
    topics?: boolean
    /** Chips filter by this value instead of the change. */
    segmentBy?: (row: QuestionItem) => string
  } = {}
): string {
  const { report } = ctx
  const comparing = report.fromLabel !== null
  // A page opens its drawer when the report knows it (a page of yours cited at either end).
  const known = new Set(Object.keys(report.pagesByUrl).map(pageKey))
  const pathCell = (url: string | null): string => {
    if (url === null) return '<span class="muted">—</span>'
    if (!known.has(pageKey(url))) return pageCopy(url, pathOf(url))
    return pageCopy(
      url,
      pathOf(url),
      `<button type="button" class="open-btn rv-pathbtn" data-open="${esc(`p:${ctx.view}|${url}`)}">${esc(pathOf(url))}</button>`
    )
  }
  const columns: Column<QuestionItem>[] = [
    {
      header: 'Question',
      kind: 'wide',
      html: (row) =>
        `${textCopy(row.text, `<button type="button" class="rv-q rv-rowbtn" data-row="${esc(`${ctx.view}|${row.id}`)}" data-label="${esc(row.text)}">${esc(row.text)}</button>`)}` +
        (comparing && row.change === null && row.now !== null
          ? ' <span class="chip s-error">Not compared</span>'
          : ''),
      csv: (row) => row.text
    },
    { header: 'Topic', html: (row) => esc(row.topic), csv: (row) => row.topic },
    {
      header: 'Target page',
      kind: 'path',
      html: (row) =>
        row.targets.length === 0
          ? '<span class="muted">Not set</span>'
          : `${pathCell(row.targets[0] ?? null)}${row.targets.length > 1 ? ` <span class="muted">+${row.targets.length - 1}</span>` : ''}`,
      csv: (row) => row.targets.map((url) => pathOf(url)).join(' | ')
    },
    ...(options.funnel
      ? [
          {
            header: 'Funnel',
            html: (row: QuestionItem) => esc(row.funnel ?? '—'),
            csv: (row: QuestionItem) => row.funnel ?? ''
          },
          {
            header: 'Intent',
            html: (row: QuestionItem) => esc(row.intent ?? '—'),
            csv: (row: QuestionItem) => row.intent ?? ''
          }
        ]
      : []),
    ...(comparing
      ? [
          {
            header: report.fromLabel ?? 'Before',
            html: (row: QuestionItem) => result(row.before),
            csv: (row: QuestionItem) => (row.before ? RESULT_WORDS[row.before] : '') ?? ''
          }
        ]
      : []),
    {
      header: report.toLabel,
      html: (row) => result(row.now),
      csv: (row) => (row.now ? RESULT_WORDS[row.now] : '') ?? ''
    },
    {
      header: comparing ? 'Position before → now' : 'Position',
      kind: 'nowrap',
      html: (row) => positionHtml(row.positionBefore, row.positionNow, comparing),
      csv: (row) => positionText(row.positionBefore, row.positionNow, comparing),
      sort: (row) => row.positionNow
    },
    {
      header: 'Cited through',
      kind: 'path',
      html: (row) => pathCell(row.pageNow ?? row.pageBefore),
      csv: (row) => {
        const url = row.pageNow ?? row.pageBefore
        return url === null ? '' : pathOf(url)
      }
    }
  ]
  const topics = [...new Set(rows.map((row) => row.topic))].sort((a, b) => a.localeCompare(b))
  const tableId = `${ctx.view}-${id}`
  const picker =
    options.topics && topics.length > 1
      ? `<label class="tbl-filter rv-topic-pick">Topic <select data-topic-table="${esc(slugId(tableId))}"><option value="">Every topic</option>${topics
          .map((topic) => `<option value="${esc(topic)}">${esc(topic)}</option>`)
          .join('')}</select></label>`
      : ''
  return (
    picker +
    table(tableCtx(ctx), {
      id: tableId,
      title,
      columns,
      rows,
      limit: options.limit ?? 25,
      sortable: true,
      filter: rows.length > 25,
      rowData: (row) => ({ topic: row.topic }),
      ...(options.segmentBy
        ? { segment: options.segmentBy }
        : options.segment
          ? {
              segment: (row: QuestionItem) =>
                row.change ?? (comparing && row.now !== null ? NOT_COMPARED_CHIP : 'none')
            }
          : {})
    })
  )
}

/** The history strip's legend, every state the squares can show. */
export function historyLegendHtml(): string {
  return `<p class="rv-legend">${historyLegendWords()
    .map(
      (item) =>
        `<span><svg width="12" height="12" aria-hidden="true"><rect class="cfc-sq-${item.state}" x="1" y="1" width="10" height="10" rx="3"/></svg> ${esc(item.words)}</span>`
    )
    .join('')}</p>`
}
