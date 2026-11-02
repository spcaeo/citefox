import { rankedBars } from '@shared/charts'
import {
  FRESH_DAYS,
  PAGE_STATUS_LABELS,
  topSitesChart,
  type LostItem,
  type OutlineRow,
  type PageStory,
  type ReportNeeds,
  type ReviewReport,
  type StoryTile
} from '@shared/report/review'
import { esc } from '../html/escape'
import { domainCopy, urlCopy } from '../html/copy'
import { table } from '../html/tables'
import {
  chart,
  chips,
  FULL,
  num,
  panel,
  parts,
  questionTable,
  tableCtx,
  type ViewCtx
} from './sections'

/**
 * The downloaded Impact review's extra parts, from the same model the app draws
 * (src/shared/report/review/impact*.ts): little data, the Verdict intro and top sites,
 * the published-page tables and page stories, and the client asks.
 */

/** "What this report needs", as plain text: the download has no buttons to press. */
export function needsHtml(needs: ReportNeeds): string {
  return (
    `<div class="card rv-card rv-needs" data-testid="report-needs"><h3 class="sub">${esc(needs.title)}</h3><p class="lede">${esc(needs.lead)}</p>` +
    `<ol class="rv-needs-list">${needs.items.map((item) => `<li>${item.done ? '✓ ' : ''}${esc(item.text)}</li>`).join('')}</ol>` +
    `<p class="note">${esc(needs.nextCheck)} In CiteFox: Fixes, Log a fix to log a page; Check now to run a check.</p></div>`
  )
}

/** A tab with nothing to show yet. */
export function emptyHtml(line: string): string {
  return `<p class="note rv-empty">Nothing to show yet. ${esc(line)}</p>`
}

export function introHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const intro = report.impact.intro
  const glance = intro.glance
    .map((item) => `<div><dt>${esc(item.label)}</dt><dd>${parts(ctx, item.value)}</dd></div>`)
    .join('')
  return (
    `<div class="card rv-card rv-intro"><p class="rv-vline">${parts(ctx, intro.lead)}</p>` +
    `<p class="note"><strong>About these results: answers vary.</strong> Ask an AI engine the same question twice and it can cite different pages. Read the trend across many questions, not one answer. A change smaller than ${report.method.noise} ${report.method.noise === 1 ? 'question' : 'questions'} is noise.</p>` +
    `<dl class="rv-glance">${glance}</dl></div>`
  )
}

export function topSitesHtml(ctx: ViewCtx): string {
  const { report } = ctx
  if (report.impact.topSites.length < 2) return ''
  return panel(
    'Most cited sites',
    chart(rankedBars({ ...topSitesChart(report), width: FULL, titles: true }), ctx),
    `The 8 sites AI answers cite most on ${report.toLabel}, you highlighted.`
  )
}

export function kindsHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const rows = report.impact.kinds
  if (rows.length === 0) return ''
  const comparing = report.comparing && report.fromLabel !== null
  return table(tableCtx(ctx), {
    id: `${ctx.view}-kinds`,
    title: 'New pages and rewrites',
    rows,
    columns: [
      { header: 'Kind', html: (r) => `<strong>${esc(r.label)}</strong>`, csv: (r) => r.label },
      { header: 'Pages', kind: 'num', html: (r) => num(ctx, r.pages), csv: (r) => r.pages.n },
      { header: 'Cited now', kind: 'num', html: (r) => num(ctx, r.cited), csv: (r) => r.cited.n },
      ...(comparing
        ? [
            {
              header: `Questions ${report.fromLabel}`,
              kind: 'num' as const,
              html: (r: (typeof rows)[number]) => (r.before ? num(ctx, r.before) : '—'),
              csv: (r: (typeof rows)[number]) => r.before?.n ?? null
            }
          ]
        : []),
      {
        header: `Questions ${report.toLabel}`,
        kind: 'num',
        html: (r) => num(ctx, r.now),
        csv: (r) => r.now.n
      },
      { header: '#1 spots', kind: 'num', html: (r) => num(ctx, r.first), csv: (r) => r.first.n }
    ]
  })
}

export function daysHtml(ctx: ViewCtx): string {
  const rows = ctx.report.impact.days
  if (rows.length === 0) return ''
  return table(tableCtx(ctx), {
    id: `${ctx.view}-days`,
    title: 'By days live',
    rows,
    columns: [
      { header: 'Live', html: (r) => `<strong>${esc(r.label)}</strong>`, csv: (r) => r.label },
      { header: 'Pages', kind: 'num', html: (r) => num(ctx, r.pages), csv: (r) => r.pages.n },
      { header: 'Cited now', kind: 'num', html: (r) => num(ctx, r.cited), csv: (r) => r.cited.n },
      {
        header: 'Questions citing them',
        kind: 'num',
        html: (r) => num(ctx, r.questions),
        csv: (r) => r.questions.n
      },
      { header: '#1 spots', kind: 'num', html: (r) => num(ctx, r.first), csv: (r) => r.first.n },
      {
        header: 'Not indexed',
        kind: 'num',
        html: (r) => num(ctx, r.notIndexed),
        csv: (r) => r.notIndexed.n
      }
    ]
  })
}

function storyTile(tile: StoryTile, fromLabel: string | null): string {
  const delta =
    tile.delta === null || tile.delta === 0
      ? ''
      : ` <span class="${(tile.lowerIsBetter ? tile.delta < 0 : tile.delta > 0) ? 'rv-up' : 'rv-down'}">${tile.delta > 0 ? '▲' : '▼'} ${esc(Math.abs(tile.delta))}</span>`
  const was =
    tile.before !== null && fromLabel !== null ? ` · ${esc(fromLabel)}: ${esc(tile.before)}` : ''
  return `<div class="kpi"><p class="kpi-value"><span class="num">${esc(tile.now)}</span>${delta}</p><p class="kpi-label">${esc(tile.label)}${was}</p></div>`
}

function storyHtml(ctx: ViewCtx, story: PageStory): string {
  const { report } = ctx
  const { page } = story
  const facts = [
    page.path,
    page.kind === 'new' ? 'New page' : page.kind === 'rewrite' ? 'Rewrite' : 'Your page',
    page.daysLive === null ? null : `${page.daysLive} days live`,
    page.indexed === null ? 'Index not checked' : page.indexed ? 'Indexed' : 'Not indexed',
    PAGE_STATUS_LABELS[page.status]
  ]
    .filter((text): text is string => text !== null)
    .map((text) => esc(text))
    .join(' · ')
  const comparing = story.tiles[0]?.before !== null
  const split = comparing
    ? `<p class="rv-p">${story.split.newly} newly cite it, ${story.split.kept} kept citing it, ${story.split.dropped} dropped it.</p>`
    : ''
  const timeline = `<p class="rv-p"><strong>Dates:</strong> ${story.timeline.map((mark) => `${esc(mark.label)} ${esc(mark.day)}`).join(' · ')}</p>`
  const spread = `<p class="rv-p"><strong>Where it sits among the sources:</strong> ${story.spread.map((b) => `${esc(b.label)} ${b.before !== null ? `${b.before} → ` : ''}${b.now}`).join(' · ')}</p>`
  const sites = story.sites.length
    ? `<p class="rv-p"><strong>Sites cited beside it:</strong> ${story.sites.map((s) => `${domainCopy(s.domain)} (${s.n})`).join(', ')}</p>`
    : ''
  const waiting = story.waiting
    ? `<div class="note"><strong>Why it is not cited yet, and what happens next</strong><ul>${story.waiting.map((r) => `<li><strong>${esc(r.title)}.</strong> ${esc(r.text)}</li>`).join('')}</ul></div>`
    : ''
  const slug = page.path.replace(/[^a-z0-9]+/gi, '-')
  const rows = [
    ...story.tabs.now,
    ...story.tabs.dropped.filter((item) => !story.tabs.now.includes(item))
  ]
  const id = `${ctx.view}-story${slug}`
  const segment = (row: (typeof rows)[number]): string =>
    story.tabs.newly.includes(row)
      ? 'newly'
      : story.tabs.kept.includes(row)
        ? 'kept'
        : story.tabs.dropped.includes(row)
          ? 'dropped'
          : 'now'
  const tabs = comparing
    ? chips(id, [
        { id: 'all', label: 'All', count: rows.length },
        { id: 'newly', label: 'New', count: story.tabs.newly.length },
        { id: 'kept', label: 'Kept', count: story.tabs.kept.length },
        { id: 'dropped', label: 'Dropped', count: story.tabs.dropped.length }
      ])
    : ''
  const questions = rows.length
    ? tabs +
      questionTable(ctx, `story${slug}`, `Questions of ${page.path}`, rows, {
        limit: 15,
        ...(comparing ? { segmentBy: segment } : {})
      })
    : ''
  return (
    `<details class="card rv-card rv-story" data-story="${esc(page.url)}"><summary><strong>${esc(page.title ?? page.path)}</strong> <span class="muted">${facts}</span></summary>` +
    `<div class="kpis rv-tiles">${story.tiles.map((t) => storyTile(t, report.fromLabel)).join('')}</div>` +
    split +
    waiting +
    timeline +
    spread +
    sites +
    questions +
    '</details>'
  )
}

/** Every published page's before → after story, folded. */
export function storiesHtml(ctx: ViewCtx): string {
  const stories = ctx.report.published.rows.flatMap((page) => {
    const story = ctx.report.impact.stories[page.url]
    return story === undefined ? [] : [story]
  })
  if (stories.length === 0) return ''
  return `<h3 class="sub">Each page, before and after</h3><p class="lede">Open a page for its story.</p>${stories.map((story) => storyHtml(ctx, story)).join('')}`
}

function outline(title: string, rows: readonly OutlineRow[]): string {
  const items = rows
    .map(
      (row) =>
        `<li class="rv-outline-${row.mark} rv-outline-h${row.level}">${row.mark === 'dropped' ? '<span class="sr-only">Dropped: </span>' : row.mark === 'added' ? '<span class="sr-only">Added: </span>' : ''}${esc(row.text)}</li>`
    )
    .join('')
  return `<div><p class="rv-p"><strong>${esc(title)}</strong></p>${rows.length ? `<ol class="rv-outline">${items}</ol>` : '<p class="muted">No headings.</p>'}</div>`
}

const OUTCOMES = [
  ['own', 'Moved to your other pages'],
  ['others', 'Went to other sites'],
  ['none', 'No AI answer now'],
  ['still', 'Still citing']
] as const

/** Lost ground's extras for one page: still citing, outline, lost by topic, outcome tabs. */
export function lostMoreHtml(ctx: ViewCtx, item: LostItem): string | null {
  const { report } = ctx
  const more = report.impact.lost[item.page.url]
  if (more === undefined) return null
  const still = more.stillIds.flatMap((id) => {
    const q = report.questionsById[id]
    return q === undefined ? [] : [q]
  })
  const rows = [...item.questions, ...still]
  const outlineHtml =
    more.outline === null
      ? ''
      : `<div class="grid-2 rv-outline-pair">${outline(`Before (${report.fromLabel ?? 'cited version'})`, more.outline.before)}${outline(`After (${item.changedLabel ?? 'now'})`, more.outline.after)}</div><p class="lede">Struck through in orange: dropped in the new version. Green: new in this version.</p>`
  const topics = more.byTopic.length
    ? `<p class="rv-p"><strong>Lost by topic:</strong> ${more.byTopic.map((row) => `${esc(row.topic)} ${num(ctx, row.num)}`).join(', ')}</p>`
    : ''
  const slug = item.page.path.replace(/[^a-z0-9]+/gi, '-')
  const id = `${ctx.view}-lost${slug}`
  const tabs = chips(id, [
    { id: 'all', label: 'All', count: rows.length },
    ...OUTCOMES.flatMap(([key, label]) => {
      const count = rows.filter((q) => more.outcomes[q.id] === key).length
      return count === 0 ? [] : [{ id: key, label, count }]
    })
  ])
  return (
    `<p class="rv-p"><strong>Still citing it:</strong> ${num(ctx, more.stillCiting)} ${more.stillCiting.n === 1 ? 'question' : 'questions'}.</p>` +
    outlineHtml +
    topics +
    tabs +
    questionTable(ctx, `lost${slug}`, `Questions ${item.page.path} lost`, rows, {
      segmentBy: (row) => more.outcomes[row.id] ?? 'all'
    })
  )
}

export function backlinksHowToHtml(): string {
  return panel(
    'How to add the links',
    '<ol class="rv-steps"><li><strong>Link to the exact address.</strong> Use the full page address in the list, not the home page.</li>' +
      '<li><strong>Use the anchor text shown.</strong> Words that say what the page is about help AI answers match it to the question.</li>' +
      '<li><strong>Start with relevant sites.</strong> Partners, directories and industry sites first; a few relevant links beat many random ones.</li>' +
      '<li><strong>Link between your own pages.</strong> Add a link from your busiest pages to each page on the list.</li></ol>' +
      '<p class="note"><strong>Tell us when links go live.</strong> Send the address of each new link, so the next check can show what it did.</p>'
  )
}

export function roundHeroHtml(report: ReviewReport): string {
  const hero = report.impact.round
  const badge =
    hero.startedLabel !== null
      ? ` <span class="vd-badge vd-ok">Round ${hero.number} started ${esc(hero.startedLabel)}</span>`
      : ''
  return `<div class="card rv-card rv-hero"><h3 class="sub">${hero.number > 1 ? 'The next round has already started' : 'The first round has started'}${badge}</h3><p class="rv-p">${esc(hero.line)}</p></div>`
}

export function roundTablesHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const { index, openByTopic } = report.impact
  const comparing = report.comparing && report.fromLabel !== null
  const idx = index.rows.length
    ? (index.line ? `<p class="lede">${esc(index.line)}</p>` : '') +
      table(tableCtx(ctx), {
        id: `${ctx.view}-index`,
        title: 'Is Google indexing the pages?',
        rows: index.rows,
        columns: [
          { header: 'Live', html: (r) => esc(r.label), csv: (r) => r.label },
          { header: 'Pages', kind: 'num', html: (r) => num(ctx, r.pages), csv: (r) => r.pages.n },
          { header: 'Indexed', kind: 'num', html: (r) => esc(r.indexed), csv: (r) => r.indexed },
          {
            header: 'Not indexed',
            kind: 'num',
            html: (r) => num(ctx, r.notIndexed),
            csv: (r) => r.notIndexed.n
          },
          {
            header: 'Not checked',
            kind: 'num',
            html: (r) => esc(r.unchecked),
            csv: (r) => r.unchecked
          }
        ]
      })
    : ''
  const open = openByTopic.length
    ? table(tableCtx(ctx), {
        id: `${ctx.view}-open-topics`,
        title: 'Questions not cited yet, by topic',
        rows: openByTopic,
        columns: [
          { header: 'Topic', html: (r) => esc(r.topic), csv: (r) => r.topic },
          { header: 'Not cited', kind: 'num', html: (r) => num(ctx, r.open), csv: (r) => r.open.n },
          {
            header: 'In topic',
            kind: 'num',
            html: (r) => esc(r.questions),
            csv: (r) => r.questions
          },
          ...(comparing
            ? [
                {
                  header: 'Cited you before',
                  kind: 'num' as const,
                  html: (r: (typeof openByTopic)[number]) => num(ctx, r.wasCited),
                  csv: (r: (typeof openByTopic)[number]) => r.wasCited.n
                }
              ]
            : [])
        ]
      })
    : ''
  return idx + open
}

export function notIndexedMoreHtml(ctx: ViewCtx): string {
  const { report } = ctx
  const { late, fresh } = report.impact.notIndexed
  const per = report.impact.questionsFor
  const rows = report.notIndexed.rows
  return (
    `<p class="rv-vline"><strong>${rows.length} ${rows.length === 1 ? 'page is' : 'pages are'} not in Google yet.</strong> A page Google hasn't seen can't be cited.</p>` +
    `<p class="note">${esc(late.n)} ${late.n === 1 ? 'page has' : 'pages have'} been live ${FRESH_DAYS + 1}+ days and Google still has not indexed ${late.n === 1 ? 'it' : 'them'}. ${esc(fresh.n)} ${fresh.n === 1 ? 'is' : 'are'} ${FRESH_DAYS} days old or less: Google may simply not have visited yet.</p>` +
    `<div class="grid-2">${panel(
      'What we do',
      '<ol class="rv-steps"><li>Check each page again at the next check.</li><li>Link to each page from your busiest pages, so Google finds it sooner.</li><li>Rework a page that stays out of Google for 14 days.</li></ol>'
    )}${panel(
      'What your team does',
      '<ol class="rv-steps"><li>In Google Search Console, open <strong>URL Inspection</strong>, paste each address below, and click <strong>Request indexing</strong>.</li><li>Make sure each page is in your <strong>sitemap</strong>, and the sitemap is submitted in Search Console (Indexing, Sitemaps).</li><li>Check that no page is blocked by robots.txt or a noindex tag.</li></ol>'
    )}</div>` +
    table(tableCtx(ctx), {
      id: `${ctx.view}-notindexed`,
      title: 'Not indexed yet',
      rows,
      sortable: true,
      url: (row) => row.url,
      columns: [
        {
          header: 'Page',
          kind: 'path',
          html: (r) => `<strong>${esc(r.title ?? r.path)}</strong><br>${urlCopy(r.url)}`,
          csv: (r) => r.url
        },
        {
          header: 'Kind',
          html: (r) => esc(r.kind === 'new' ? 'New' : r.kind === 'rewrite' ? 'Rewrite' : '—'),
          csv: (r) => r.kind ?? ''
        },
        {
          header: 'Days live',
          kind: 'num',
          html: (r) => esc(r.daysLive ?? '—'),
          csv: (r) => r.daysLive
        },
        {
          header: 'Waiting',
          html: (r) =>
            r.daysLive !== null && r.daysLive > FRESH_DAYS
              ? '<span class="chip s-none">Late</span>'
              : '<span class="chip s-noaio">Waiting</span>',
          csv: (r) => (r.daysLive !== null && r.daysLive > FRESH_DAYS ? 'Late' : 'Waiting')
        },
        {
          header: 'Questions written for it',
          kind: 'num',
          html: (r) => esc(per[r.url] ?? '—'),
          csv: (r) => per[r.url] ?? null
        }
      ]
    })
  )
}

export function methodMoreHtml(report: ReviewReport): string {
  if (report.kind !== 'impact') return ''
  const { cleanBefore, lines } = report.impact.method
  return (
    (cleanBefore === null
      ? ''
      : `<p class="rv-p ${cleanBefore.ok ? 'rv-clean-ok' : 'rv-clean-warn'}" data-testid="clean-before">${esc(cleanBefore.line)}</p>`) +
    lines.map((line) => `<p class="rv-p">${esc(line)}</p>`).join('')
  )
}
