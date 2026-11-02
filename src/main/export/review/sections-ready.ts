import { donutChart } from '@shared/charts'
import {
  pathOf,
  sovChart,
  type ContentRow,
  type Kpi,
  type RivalRow,
  type SiteRow
} from '@shared/report/review'
import { domainCopy, pageCopy, textCopy } from '../html/copy'
import { esc } from '../html/escape'
import { table } from '../html/tables'
import { chart, HALF, num, panel, parts, steps, tableCtx, tiles, type ViewCtx } from './sections'
import { opportunityHtml } from './sections-visibility'

/**
 * The short ready reports in the downloaded file (Docs/REPORT-SPEC.md "Short ready
 * reports"): Pitch / audit's Summary, Competitors and Plan, the Content plan, and
 * Head-to-head. Same model as the app (src/shared/report/review/ready.ts). The pitch keeps
 * to short panels and top-ten tables so its PDF stays two or three pages.
 */

function rowButton(ctx: ViewCtx, id: string, text: string): string {
  return textCopy(
    text,
    `<button type="button" class="rv-q rv-rowbtn" data-row="${esc(`${ctx.view}|${id}`)}" data-label="${esc(text)}">${esc(text)}</button>`
  )
}

function kpiCell(ctx: ViewCtx, kpi: Kpi, note: string): string {
  const drill = ctx.report.drills[kpi.drill]
  const value =
    drill === undefined || drill.ids.length === 0
      ? `<span class="num">${esc(kpi.now)}</span>`
      : num(ctx, { n: drill.ids.length, drill: kpi.drill }, kpi.now)
  return `<div class="kpi"><p class="kpi-label">${esc(kpi.label)}</p><p class="kpi-value">${value}</p>${note ? `<p class="kpi-note">${esc(note)}</p>` : ''}</div>`
}

function sitesTable(ctx: ViewCtx, id: string, title: string, rows: readonly SiteRow[]): string {
  return table(tableCtx(ctx), {
    id: `${ctx.view}-${id}`,
    title,
    quiet: true,
    rows,
    limit: 10,
    columns: [
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
      { header: 'Questions', kind: 'num', html: (s) => num(ctx, s.now), csv: (s) => s.now.n },
      {
        header: 'Without you',
        kind: 'num',
        html: (s) => (s.gap === null ? '—' : num(ctx, s.gap)),
        csv: (s) => s.gap?.n ?? null
      }
    ]
  })
}

export function summaryHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const pitch = report.ready.pitch
  return (
    `<p class="rv-vline">${parts(ctx, report.visibility.headline)}</p>` +
    `<div class="kpis">${pitch.kpis.map((kpi, index) => kpiCell(ctx, kpi, pitch.kpiNotes[index] ?? '')).join('')}</div>` +
    `<div class="grid-2">${opportunityHtml(ctx)}${panel(
      'Most cited sites',
      pitch.sites.length > 0
        ? sitesTable(ctx, 'pitch-sites', 'Most cited sites', pitch.sites)
        : '<p class="muted">No site is cited in these AI answers yet.</p>',
      'The five sites the AI answers cite most.'
    )}</div>`
  )
}

/** Pitch / audit's Competitors: tiles, share of voice and the top ten (short for the PDF). */
export function pitchCompetitorsHtml(ctx: ViewCtx): string {
  const c = ctx.report.competition
  if (c.tiles.length === 0) {
    return '<p class="note">No other site is cited in these AI answers yet.</p>'
  }
  const sov =
    c.sov === null
      ? ''
      : panel(
          'Share of voice',
          chart(donutChart({ ...sovChart(ctx.report), width: HALF, titles: true }), ctx),
          'Who wins each AI answer.'
        )
  return (
    tiles(ctx, c.tiles) +
    `<div class="grid-2">${sov}${panel(
      'Top ten cited sites',
      sitesTable(ctx, 'pitch-top', 'Top ten cited sites', c.sites.slice(0, 10))
    )}</div>`
  )
}

export function pitchPlanHtml(ctx: ViewCtx): string {
  return panel(
    'What we’d fix first',
    steps(ctx, ctx.report.ready.pitch.plan),
    'Built from this check. Click a number for its questions.'
  )
}

function planPage(row: ContentRow): string {
  return row.page === null
    ? '<strong>New page</strong>'
    : `${pageCopy(row.page, pathOf(row.page))}<br><span class="muted">${esc(row.pageLabel)}</span>`
}

export function writePlanHtml(ctx: ViewCtx): string {
  const plan = ctx.report.ready.content
  const groups = plan.groups
    .map((group) =>
      panel(
        `${group.topic} · ${group.questions.n}`,
        table(tableCtx(ctx), {
          id: `${ctx.view}-plan-${group.topic}`,
          title: group.topic,
          quiet: true,
          rows: group.rows,
          limit: 25,
          columns: [
            {
              header: 'Question',
              kind: 'wide',
              html: (r) => rowButton(ctx, r.question.id, r.question.text),
              csv: (r) => r.question.text
            },
            {
              header: 'Why',
              html: (r) =>
                r.reason === 'wrongpage'
                  ? '<span class="chip s-own">Wrong page</span>'
                  : '<span class="chip s-none">Not cited</span>',
              csv: (r) => (r.reason === 'wrongpage' ? 'Wrong page cited' : 'Not cited')
            },
            {
              header: 'Page to write or fix',
              kind: 'path',
              html: (r) => planPage(r),
              csv: (r) => r.page ?? 'New page'
            },
            {
              header: 'Answer shape',
              html: (r) =>
                r.shape === null
                  ? '<span class="muted">Not read yet</span>'
                  : `${esc(r.shape.label)}${r.shape.own ? '' : ' <span class="muted">(most common)</span>'}`,
              csv: (r) => r.shape?.label ?? ''
            },
            {
              header: 'Cited instead',
              html: (r) => (r.sites.length === 0 ? '—' : esc(r.sites.join(', '))),
              csv: (r) => r.sites.join(' | ')
            }
          ]
        }),
        undefined,
        'rv-plan'
      )
    )
    .join('')
  return (
    tiles(ctx, plan.tiles) +
    '<p class="note">One row per question where an AI answer shows without the right page of yours. The app copies a brief for each; the CSV holds them all.</p>' +
    groups
  )
}

function position(cited: boolean, value: number | null): string {
  if (!cited) return '<span class="muted">Not cited</span>'
  return value === null ? 'Cited' : `#${value}`
}

const WINNER: Readonly<Record<RivalRow['winner'], string>> = {
  them: 'Them',
  you: 'You',
  tie: 'Tie'
}

export function h2hHtml(ctx: ViewCtx): string {
  const rival = ctx.report.ready.rival
  if (rival.domain === null) {
    return '<p class="note">No other business’s site is cited in these AI answers yet.</p>'
  }
  const domain = rival.domain
  const rows = table(tableCtx(ctx), {
    id: `${ctx.view}-h2h`,
    title: `You and ${domain}, question by question`,
    rows: rival.rows,
    limit: 25,
    sortable: true,
    columns: [
      {
        header: 'Question',
        kind: 'wide',
        html: (r) => rowButton(ctx, r.question.id, r.question.text),
        csv: (r) => r.question.text
      },
      {
        header: domain,
        kind: 'num',
        html: (r) => position(r.theirsCited, r.theirs),
        csv: (r) => (r.theirsCited ? (r.theirs ?? 'Cited') : '')
      },
      {
        header: 'You',
        kind: 'num',
        html: (r) => position(r.yoursCited, r.yours),
        csv: (r) => (r.yoursCited ? (r.yours ?? 'Cited') : '')
      },
      {
        header: 'Winner',
        html: (r) =>
          `<span class="chip ${r.winner === 'you' ? 's-target' : r.winner === 'them' ? 's-none' : 's-noaio'}">${WINNER[r.winner]}</span>`,
        csv: (r) => WINNER[r.winner]
      }
    ],
    empty: `Neither you nor ${domain} is cited in these answers.`
  })
  const brands =
    rival.brands.length === 0
      ? `<p class="muted">${esc(rival.brandsNote ?? '')}</p>`
      : table(tableCtx(ctx), {
          id: `${ctx.view}-h2h-brands`,
          title: 'How the answers describe each brand',
          quiet: true,
          rows: rival.brands,
          columns: [
            {
              header: 'Brand',
              html: (b) => (b.own ? `<strong>${esc(b.brand)} (you)</strong>` : esc(b.brand)),
              csv: (b) => b.brand
            },
            {
              header: 'Answers naming it',
              kind: 'num',
              html: (b) => num(ctx, b.answers),
              csv: (b) => b.answers.n
            },
            { header: 'Named first', kind: 'num', html: (b) => esc(b.first), csv: (b) => b.first },
            {
              header: 'Positive',
              kind: 'num',
              html: (b) => esc(b.positive),
              csv: (b) => b.positive
            },
            { header: 'Neutral', kind: 'num', html: (b) => esc(b.neutral), csv: (b) => b.neutral },
            {
              header: 'Negative',
              kind: 'num',
              html: (b) => esc(b.negative),
              csv: (b) => b.negative
            }
          ]
        })
  const pages =
    rival.pages.length === 0
      ? `<p class="muted">${esc(rival.pagesNote ?? '')}</p>`
      : table(tableCtx(ctx), {
          id: `${ctx.view}-h2h-pages`,
          title: `Pages of ${domain} the answers cite`,
          quiet: true,
          rows: rival.pages,
          limit: 10,
          url: (p) => p.url,
          columns: [
            {
              header: 'Page',
              kind: 'path',
              html: (p) =>
                `${p.title ? `<strong>${esc(p.title)}</strong><br>` : ''}${pageCopy(p.url, pathOf(p.url))}`,
              csv: (p) => p.url
            },
            {
              header: 'Questions',
              kind: 'num',
              html: (p) => num(ctx, p.questions),
              csv: (p) => p.questions.n
            }
          ]
        })
  return (
    `<p class="lede">You against <strong>${esc(domain)}</strong>.</p>` +
    tiles(ctx, rival.tiles) +
    rows +
    `<div class="grid-2">${panel('How AI describes each brand', brands)}${panel('Their cited pages', pages)}</div>`
  )
}
