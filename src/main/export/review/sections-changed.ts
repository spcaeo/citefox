import { pairedBars } from '@shared/charts'
import {
  pathOf,
  percent,
  pointsText,
  sharePercent,
  signedTenths,
  structureChart,
  VERDICT_WAIT_DAYS,
  type ChangedPageRow,
  type ClaimItem,
  type MoveList,
  type NamedSegment,
  type Num,
  type ReviewLens,
  type SetShare
} from '@shared/report/review'
import { esc } from '../html/escape'
import { pageCopy, textCopy } from '../html/copy'
import { table, type Column } from '../html/tables'
import { chart, FULL, num, panel, tableCtx, tiles, type ViewCtx } from './sections'

/**
 * The downloaded What changed report's own parts, from the same model as the app
 * (src/shared/report/review/changed.ts): the cover strip, the one-check panel, the four
 * movement lists, coverage, the split table, the verdict footer, changed pages, answer
 * structure and the named share per Topics lens.
 */

function stat(ctx: ViewCtx, value: Num, label: string, tone = ''): string {
  return `<div class="kpi${tone}"><p class="kpi-value">${num(ctx, value)}</p><p class="kpi-label">${esc(label)}</p></div>`
}

export function coverHtml(ctx: ViewCtx): string {
  const c = ctx.report.whatChanged.cover
  const cell = (label: string, value: string): string =>
    `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`
  return (
    `<dl class="rv-cover-grid">` +
    cell('Compared', esc(c.fromLabel === null ? c.toLabel : `${c.fromLabel} → ${c.toLabel}`)) +
    cell('Engine', esc(c.engineLabel)) +
    cell('Scope', esc(c.scopeLabel)) +
    cell('Questions', `${num(ctx, c.compared)} of ${c.inScope} compared`) +
    cell(
      'AI answers read',
      c.answersFrom === null
        ? num(ctx, c.answersTo)
        : `${num(ctx, c.answersFrom)} → ${num(ctx, c.answersTo)}`
    ) +
    `</dl><p class="lede">${esc(c.line)}</p>`
  )
}

export function waitingHtml(ctx: ViewCtx): string {
  const w = ctx.report.whatChanged.waiting
  if (w === null) return ''
  return panel(
    w.title,
    `<p class="rv-p">${esc(w.line)}</p><p class="rv-p"><strong>${esc(w.next ?? 'No check is scheduled yet. Set one in CiteFox under Project settings › Check schedule.')}</strong></p>`
  )
}

function listCard(ctx: ViewCtx, list: MoveList): string {
  const items = list.items
    .slice(0, 8)
    .map(
      (item) =>
        `<li>${textCopy(item.text, `<button type="button" class="rv-q rv-rowbtn" data-row="${esc(`${ctx.view}|${item.id}`)}" data-label="${esc(item.text)}">${esc(item.text)}</button>`)}<span class="muted"> · ${esc(item.topic)}</span></li>`
    )
    .join('')
  const more =
    list.items.length > 8
      ? `<p class="muted">And ${list.items.length - 8} more: click the count.</p>`
      : ''
  return (
    `<div class="card rv-move rv-move-${list.tone}"><p class="rv-move-head"><span>${esc(list.label)}</span> <span class="rv-move-n">${num(ctx, list.num)}</span></p>` +
    (items.length === 0 ? '<p class="muted">None.</p>' : `<ul class="rv-move-list">${items}</ul>`) +
    more +
    '</div>'
  )
}

export function coverageHtml(ctx: ViewCtx): string {
  const cov = ctx.report.whatChanged.coverage
  const lead = `${num(ctx, cov.compared)} of ${cov.inScope} questions were checked on both dates${cov.percent === null ? '' : ` (${cov.percent}%)`}. ${cov.nothingLeftOut ? 'Nothing left out.' : 'The rest are left out of every number, so both ends count the same questions.'}`
  const drills = cov.nothingLeftOut
    ? ''
    : `<div class="kpis rv-tiles">${stat(ctx, cov.newSince, `New since ${ctx.report.fromLabel ?? 'From'}`)}${stat(ctx, cov.noLonger, 'No longer checked')}${stat(ctx, cov.failed, 'Search failed')}</div>`
  return panel('What this comparison covers', `<p class="rv-p">${lead}</p>${drills}`)
}

/** The What changed report's "What changed" section. */
export function changedReportHtml(ctx: ViewCtx): string {
  const { report } = ctx
  if (report.whatChanged.waiting !== null) return waitingHtml(ctx)
  const c = report.changed
  return (
    tiles(ctx, [...c.tiles, ...report.named.tiles]) +
    `<p class="note"><strong>The net hides movement.</strong> ${c.net >= 0 ? '+' : '−'}${Math.abs(c.net)} looks simple, but ${c.moved} questions moved to make it.</p>` +
    panel(
      'Which questions moved',
      `<div class="rv-moves">${report.whatChanged.lists.map((list) => listCard(ctx, list)).join('')}</div>`,
      'Four lists. Click a question for its answers, or a count for the full list.'
    ) +
    sentimentHtml(ctx) +
    coverageHtml(ctx)
  )
}

export function splitTableHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const rows = report.named.splitRows
  if (rows.length === 0) return ''
  const body = rows
    .map(
      (row) =>
        `<tr><td><strong>${esc(row.label)}</strong></td><td class="num">${num(ctx, row.before)}</td><td class="num">${num(ctx, row.after)}</td><td class="num">${esc(row.change > 0 ? `+${row.change}` : row.change < 0 ? `−${Math.abs(row.change)}` : '0')}</td><td class="num">${esc(signedTenths(row.marketTenths))}</td><td class="num">${esc(signedTenths(row.workTenths))}</td><td class="num">${esc(`${percent(row.shareBefore)} → ${percent(row.shareAfter)}`)}</td></tr>`
    )
    .join('')
  return `<div class="scroll"><table class="rv-small-table"><thead><tr><th scope="col"></th><th scope="col" class="num">${esc(report.fromLabel ?? '')}</th><th scope="col" class="num">${esc(report.toLabel)}</th><th scope="col" class="num">Change</th><th scope="col" class="num">From more answers</th><th scope="col" class="num">From your share</th><th scope="col" class="num">Share of answers</th></tr></thead><tbody>${body}</tbody></table></div>`
}

export function verdictFooterHtml(ctx: ViewCtx): string {
  if (ctx.report.kind !== 'changed') return ''
  const cov = ctx.report.whatChanged.coverage
  return `<p class="lede">What the verdict is based on: ${num(ctx, cov.compared)} compared of ${cov.inScope} in scope${cov.percent === null ? '' : ` (${cov.percent}%)`}. Questions checked at one end only are left out.</p>`
}

function setRow(ctx: ViewCtx, set: SetShare): string {
  return `<tr><td><strong>${esc(set.label)}</strong></td><td class="num">${num(ctx, set.questions)}</td><td class="num">${num(ctx, set.citedBefore)}</td><td class="num">${num(ctx, set.citedNow)}</td><td class="num">${esc(`${sharePercent(set.shareBefore)} → ${sharePercent(set.shareNow)}`)}</td></tr>`
}

export function changedPagesHtml(ctx: ViewCtx): string {
  const { report } = ctx
  if (report.kind !== 'changed') return ''
  const { rows, compare } = report.whatChanged.pages
  const columns: Column<ChangedPageRow>[] = [
    {
      header: 'Page',
      kind: 'path',
      html: (row) =>
        `<strong>${esc(row.page.title ?? pathOf(row.page.url))}</strong><br>${pageCopy(row.page.url, row.page.path)}`,
      csv: (row) => row.page.url
    },
    {
      header: 'Size of change',
      html: (row) => esc(row.size ?? 'Not known'),
      csv: (row) => row.size ?? ''
    },
    {
      header: `Days before ${report.toLabel}`,
      kind: 'num',
      html: (row) =>
        `${esc(row.daysBefore ?? '—')}${row.tooRecent ? ' <span class="chip s-noaio">Too recent</span>' : ''}`,
      csv: (row) => row.daysBefore
    },
    {
      header: 'Target questions',
      kind: 'num',
      html: (row) => num(ctx, row.targets),
      csv: (row) => row.targets.n
    },
    ...(report.fromLabel !== null
      ? [
          {
            header: `Cited ${report.fromLabel}`,
            kind: 'num' as const,
            html: (row: ChangedPageRow) => (row.citedBefore ? num(ctx, row.citedBefore) : '—'),
            csv: (row: ChangedPageRow) => row.citedBefore?.n ?? null
          }
        ]
      : []),
    {
      header: `Cited ${report.toLabel}`,
      kind: 'num',
      html: (row) => num(ctx, row.citedNow),
      csv: (row) => row.citedNow.n
    }
  ]
  const pages = table(tableCtx(ctx), {
    id: `${ctx.view}-changed-pages`,
    title: 'Pages changed in this window',
    rows,
    columns,
    limit: 25,
    sortable: true,
    empty:
      'No page changed in this window. Log a fix, or let CiteFox read your pages, to see one here.'
  })
  const vs =
    compare === null
      ? '<p class="muted">This needs a changed page with target questions (Primary or Also OK) checked on both dates.</p>'
      : `<div class="scroll"><table class="rv-small-table"><thead><tr><th scope="col"></th><th scope="col" class="num">Questions</th><th scope="col" class="num">Cited ${esc(report.fromLabel ?? '')}</th><th scope="col" class="num">Cited ${esc(report.toLabel)}</th><th scope="col" class="num">Cited share</th></tr></thead><tbody>${setRow(ctx, compare.changed)}${setRow(ctx, compare.rest)}</tbody></table></div>`
  return (
    panel(
      'Pages changed in this window',
      pages,
      `Pages published, rewritten or seen changing between ${report.fromLabel ?? 'the checks'} and ${report.toLabel}. A change under ${VERDICT_WAIT_DAYS} days before ${report.toLabel} is too recent to judge.`
    ) +
    panel(
      "Changed pages' questions vs the rest of the project",
      vs,
      "Share of questions citing you, among questions checked on both dates. A page's questions are the ones it is the Primary or an Also OK page for."
    )
  )
}

export function structureHtml(ctx: ViewCtx): string {
  const { report } = ctx
  if (report.kind !== 'changed') return ''
  const s = report.whatChanged.structure
  if (s === null) {
    return panel(
      'Answer structure',
      '<p class="muted">This appears once CiteFox AI has sorted the AI Overviews of both checks into blocks (Full report › Answer shape).</p>'
    )
  }
  const changes = table(tableCtx(ctx), {
    id: `${ctx.view}-reshaped`,
    title: 'Answers that changed shape',
    rows: s.changes,
    limit: 15,
    empty: 'No answer changed shape between these checks.',
    columns: [
      {
        header: 'Question',
        kind: 'wide',
        html: (c) =>
          `${textCopy(c.question.text, `<button type="button" class="rv-q rv-rowbtn" data-row="${esc(`${ctx.view}|${c.question.id}`)}" data-label="${esc(c.question.text)}">${esc(c.question.text)}</button>`)}${c.opener ? ' <span class="chip s-noaio">New opener</span>' : ''}`,
        csv: (c) => c.question.text
      },
      { header: report.fromLabel ?? 'Before', html: (c) => esc(c.before), csv: (c) => c.before },
      { header: report.toLabel, html: (c) => esc(c.after), csv: (c) => c.after }
    ]
  })
  return (
    `<div class="kpis rv-tiles">${stat(ctx, s.analysed, 'Answers analysed at both checks')}${stat(ctx, s.changedOpener, 'Changed their opening block', ' rv-warn')}${stat(ctx, s.changedShape, 'Changed shape')}</div>` +
    panel(
      'Which answer blocks gained ground',
      chart(pairedBars({ ...structureChart(report), width: FULL, titles: true }), ctx),
      `Answers holding each kind of block on ${report.fromLabel ?? 'the first check'} (faint) and ${report.toLabel}.`
    ) +
    changes
  )
}

/** The named columns of one Topics lens table. */
export function namedColumns<T extends { value: string }>(
  ctx: ViewCtx,
  lens: ReviewLens
): Column<T>[] {
  const { report } = ctx
  const seg = (row: T): NamedSegment | undefined => report.named.lenses[lens][row.value]
  return [
    {
      header: 'Named',
      kind: 'num',
      html: (row) => {
        const s = seg(row)
        return s ? num(ctx, s.now) : '—'
      },
      csv: (row) => seg(row)?.now.n ?? null
    },
    {
      header: 'Named share',
      kind: 'num',
      html: (row) => {
        const s = seg(row)
        return esc(
          report.comparing
            ? `${sharePercent(s?.shareBefore ?? null)} → ${sharePercent(s?.shareNow ?? null)}`
            : sharePercent(s?.shareNow ?? null)
        )
      },
      csv: (row) => {
        const share = seg(row)?.shareNow ?? null
        return share === null ? null : Math.round(share * 100)
      }
    },
    ...(report.comparing
      ? [
          {
            header: 'Named change',
            kind: 'num' as const,
            html: (row: T) => esc(pointsText(seg(row)?.change ?? null)),
            csv: (row: T) => seg(row)?.change ?? null
          }
        ]
      : [])
  ]
}

function netText(net: number | null): string {
  return net === null ? 'Not enough data' : `${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net)}`
}

function claimList(ctx: ViewCtx, items: readonly ClaimItem[]): string {
  if (items.length === 0) return ''
  return `<ul class="rv-claims">${items
    .slice(0, 5)
    .map(
      (item) =>
        `<li>${textCopy(item.sentence, `<q>${esc(item.sentence)}</q>`)} ${textCopy(item.question.text, `<button type="button" class="rv-rowbtn rv-inline" data-row="${esc(`${ctx.view}|${item.question.id}`)}" data-label="${esc(item.question.text)}">${esc(item.question.text)}</button>`)}</li>`
    )
    .join('')}</ul>`
}

/** How AI talks about you: the tone of claims about the brand, before → now. */
export function sentimentHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const s = report.whatChanged.sentiment
  if (s === null) {
    return panel(
      'How AI talks about you',
      '<p class="muted">Not enough data. CiteFox AI reads what AI Overviews say about your brand after each check; this fills in once both checks have been read.</p>'
    )
  }
  const row = (label: string, a: string | number, b: string | number): string =>
    `<tr><td>${esc(label)}</td><td class="num">${esc(a)}</td><td class="num">${esc(b)}</td></tr>`
  const tone =
    `<div class="scroll"><table class="rv-small-table"><thead><tr><th scope="col"></th><th scope="col" class="num">${esc(report.fromLabel ?? '')}</th><th scope="col" class="num">${esc(report.toLabel)}</th></tr></thead><tbody>` +
    row('Positive', s.before.positive, s.now.positive) +
    row('Neutral', s.before.neutral, s.now.neutral) +
    row('Negative', s.before.negative, s.now.negative) +
    row('Net sentiment', netText(s.before.net), netText(s.now.net)) +
    '</tbody></table></div>'
  return panel(
    'How AI talks about you',
    tone +
      `<div class="kpis rv-tiles">${stat(ctx, s.newlyNegative, 'Questions with a new negative claim', ' rv-warn')}${stat(ctx, s.goneNegative, 'Questions whose negative claim is gone', ' rv-ok')}</div>` +
      claimList(ctx, s.newlyNegativeClaims) +
      (s.goneNegativeClaims.length > 0
        ? `<p class="muted">Gone since ${esc(report.fromLabel ?? 'From')}:</p>`
        : '') +
      claimList(ctx, s.goneNegativeClaims),
    'Claims AI Overviews make about your brand, on the questions checked on both dates. Net sentiment is positive minus negative, out of every claim; under 5 claims it says Not enough data.'
  )
}
