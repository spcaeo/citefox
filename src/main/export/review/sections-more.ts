import { bucketColumns, pairedBars } from '@shared/charts'
import {
  agreeChart,
  changeLine,
  shapesChart,
  spreadChart,
  type LostItem,
  type Num
} from '@shared/report/review'
import { esc } from '../html/escape'
import { domainCopy, textCopy, urlCopy } from '../html/copy'
import { table } from '../html/tables'
import { chart, FULL, HALF, num, panel, questionTable, tableCtx, type ViewCtx } from './sections'
import { backlinksHowToHtml, lostMoreHtml } from './sections-impact'

/**
 * The downloaded ready report's agency sections and deep dives: Lost ground, Backlinks,
 * the Next round's five steps, and Deep dives. Same model as the app.
 */

function stat(ctx: ViewCtx, value: Num, label: string): string {
  return `<div class="kpi"><p class="kpi-value">${num(ctx, value)}</p><p class="kpi-label">${esc(label)}</p></div>`
}

function lostCard(ctx: ViewCtx, item: LostItem): string {
  const { report } = ctx
  const change = item.change
  const changed = change
    ? `<p class="rv-p"><strong>What changed on the page (${esc(item.changedLabel ?? '')}):</strong> ${esc(changeLine(change))}${change.sections.length ? ` Sections: ${change.sections.map((s) => esc(s)).join(', ')}.` : ''}</p>`
    : '<p class="rv-p muted">CiteFox saw no change on this page in its page history. The answers may have moved to other sources on their own.</p>'
  const sites = item.sites.length
    ? `<p class="rv-p"><strong>Cited instead now:</strong> ${item.sites.map((site) => `${domainCopy(site.domain)} (${site.n})`).join(', ')}</p>`
    : ''
  return panel(
    `Lost ground: ${item.page.path}`,
    `<div class="kpis rv-tiles">${stat(ctx, item.lost, 'Questions lost')}${stat(ctx, item.toOwn, 'Now cite another page of yours')}${stat(ctx, item.toOthers, 'Now cite other sites')}${stat(ctx, item.noAnswer, 'No AI answer now')}</div>` +
      changed +
      sites +
      `<p class="rv-p"><strong>Recovery plan</strong></p><ol class="rv-steps">${item.plan.map((line) => `<li>${esc(line)}</li>`).join('')}</ol>` +
      (lostMoreHtml(ctx, item) ??
        questionTable(
          ctx,
          `lost-${item.page.path}`,
          `Questions ${item.page.path} lost`,
          item.questions
        )),
    `${item.page.kind === 'rewrite' ? 'A change to this page went live' : 'This page'}${item.page.daysLive !== null ? ` ${item.page.daysLive} days ago` : ''}. These questions cited it on ${report.fromLabel ?? 'the earlier check'} and no longer do.`,
    'rv-warn-card'
  )
}

export function lostHtml(ctx: ViewCtx): string {
  const items = ctx.report.lostGround.items
  if (items.length === 0) {
    return `<p class="note">No page lost ground${ctx.report.comparing ? ` between ${esc(ctx.report.fromLabel ?? '')} and ${esc(ctx.report.toLabel)}` : ': pick two checks to compare'}.</p>`
  }
  return items.map((item) => lostCard(ctx, item)).join('')
}

export function backlinksHtml(ctx: ViewCtx): string {
  const { rows, first } = ctx.report.backlinks
  const intro = `<p class="note"><strong>Links help AI answers find and trust a page.</strong> Ask partners, directories and your own busiest pages to link here, using the anchor text shown.${first > 0 ? ` Start with the ${first} marked First.` : ''}</p>`
  return (
    intro +
    (rows.length > 0 ? backlinksHowToHtml() : '') +
    table(tableCtx(ctx), {
      id: `${ctx.view}-backlinks`,
      title: 'Backlink ask list',
      rows,
      limit: 25,
      sortable: true,
      empty: 'No page needs links right now.',
      url: (row) => row.url,
      columns: [
        {
          header: 'Priority',
          html: (r) =>
            `<span class="chip ${r.priority === 'first' ? 's-none' : 's-noaio'}">${r.priority === 'first' ? 'First' : 'Next'}</span>`,
          csv: (r) => (r.priority === 'first' ? 'First' : 'Next')
        },
        {
          header: 'Page',
          kind: 'path',
          html: (r) => `<strong>${esc(r.title ?? r.url)}</strong><br>${urlCopy(r.url)}`,
          csv: (r) => r.url
        },
        {
          header: 'Suggested anchor text',
          kind: 'wide',
          html: (r) =>
            `${textCopy(r.anchor, `“${esc(r.anchor)}”`)}${r.anchorSaved ? '' : ' <span class="muted">(suggested)</span>'}`,
          csv: (r) => r.anchor
        },
        { header: 'Why', html: (r) => esc(r.reason), csv: (r) => r.reason },
        {
          header: 'Days live',
          kind: 'num',
          html: (r) => esc(r.daysLive ?? '—'),
          csv: (r) => r.daysLive
        }
      ]
    })
  )
}

export function roundHtml(ctx: ViewCtx): string {
  const round = ctx.report.round
  const cells = round.steps
    .map(
      (step, index) =>
        `<li class="rv-round-step"><span class="rv-round-n">${index + 1}</span><strong>${esc(step.name)}</strong><span class="muted">${esc(step.line)}</span>` +
        `<span class="rv-round-owner">${esc(step.owner)}</span>` +
        (step.count !== null
          ? `<span class="rv-round-count">${num(ctx, step.count)} ${esc(step.countWords)}</span>`
          : '') +
        '</li>'
    )
    .join('')
  return panel(
    'The 5-step cycle',
    `<ol class="rv-round">${cells}</ol>${round.schedule ? `<p class="lede">${esc(round.schedule)}</p>` : ''}`,
    'Each round measures, re-optimises, publishes, gets indexed and builds links. The owner of each step is set on the Fixes screen.'
  )
}

export function deepHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const deep = report.deep
  const shapes = deep.shapes
  const words =
    shapes && shapes.wordsNow !== null
      ? `<p class="note">Average answer length: ${shapes.wordsBefore !== null ? `${shapes.wordsBefore} words on ${esc(report.fromLabel ?? '')} → ` : ''}<strong>${shapes.wordsNow} words</strong> on ${esc(report.toLabel)}. Read from ${shapes.read} stored ${shapes.read === 1 ? 'answer' : 'answers'}.</p>`
      : ''
  const shapePanel = panel(
    'How the shape of answers changed',
    shapes
      ? chart(pairedBars({ ...shapesChart(report), width: HALF, titles: true }), ctx) + words
      : '<p class="muted">No stored answer text to read for these checks.</p>',
    'Answers that use a list, steps or a table, and long answers. Match the shape AI answers use.'
  )
  const spreadPanel = panel(
    'Where you sit among the sources',
    chart(pairedBars({ ...spreadChart(report), width: HALF, titles: true }), ctx),
    report.comparing
      ? `Faint: ${report.fromLabel}. Solid: ${report.toLabel}.`
      : `On ${report.toLabel}.`
  )
  const agree = deep.agree
    ? panel(
        'Do the engines agree?',
        chart(bucketColumns({ ...agreeChart(report), width: FULL, titles: true }), ctx),
        `Each question two or more engines answered, by how many of the ${deep.agree.engines} engines cite you.`
      )
    : panel(
        'Do the engines agree?',
        `<p class="muted">${report.deep.agree === null && ctx.view !== 'all' ? 'Switch to All engines to compare engines.' : 'Only one engine answered these questions.'}</p>`
      )
  return `<div class="grid-2">${shapePanel}${spreadPanel}</div>${agree}`
}
