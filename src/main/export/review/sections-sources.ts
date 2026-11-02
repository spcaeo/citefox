import { rankedBars, splitBar } from '@shared/charts'
import {
  shapeBlocksChart,
  sourceSplitChart,
  type Num,
  type ReplyState,
  type SourceWho
} from '@shared/report/review'
import { esc } from '../html/escape'
import { domainCopy, textCopy, urlCopy } from '../html/copy'
import { table } from '../html/tables'
import { chart, FULL, num, panel, tableCtx, type ViewCtx } from './sections'

/**
 * The downloaded Visibility report's Sources and Answer shape sections, from the same
 * model the app draws (src/shared/report/review/sources.ts, shape.ts). Every table has
 * its CSV button; every count of questions opens those questions.
 */

export const REPLY_WORDS: Readonly<Record<ReplyState, string>> = {
  open: 'Yes, open',
  archived: 'No, archived',
  locked: 'No, locked',
  unchecked: 'Not checked'
}

export const WHO_WORDS: Readonly<Record<SourceWho, string>> = {
  you: 'You',
  competitor: 'Competitor',
  other: 'Other site'
}

const REPLY_CLASS: Readonly<Record<ReplyState, string>> = {
  open: 's-target',
  archived: 's-noaio',
  locked: 's-noaio',
  unchecked: 's-error'
}

function stat(ctx: ViewCtx, value: Num, label: string): string {
  return `<div class="kpi"><p class="kpi-value">${num(ctx, value)}</p><p class="kpi-label">${esc(label)}</p></div>`
}

function link(url: string, text: string | null): string {
  return /^https?:\/\//i.test(url) ? urlCopy(url, text) : textCopy(url)
}

function count(value: number | null): string {
  return value === null ? '—' : esc(value.toLocaleString('en-US'))
}

function none(line: string): string {
  return `<p class="muted rv-p">${esc(line)}</p>`
}

export function sourcesHtml(ctx: ViewCtx): string {
  const { sources } = ctx.report
  if (sources.total === 0) {
    return '<p class="note">No AI answer cites a page in this check yet. Sources fill in once a check finds answers with links.</p>'
  }
  const id = (name: string): string => `${ctx.view}-src-${name}`
  const split =
    `<div class="kpis rv-tiles">${stat(ctx, sources.answers, 'Answers that cite a source')}${stat(ctx, sources.citingYou, 'Cite your pages')}${stat(ctx, sources.citingCompetitor, 'Cite a competitor')}${stat(ctx, sources.gaps, 'Gaps to win: answers without you')}</div>` +
    chart(splitBar({ ...sourceSplitChart(ctx.report), width: FULL }), ctx) +
    `<p class="rv-p">${esc(
      `${sources.total} citations: ${sources.yours} to your pages (${sources.yoursShare}%), ${sources.competitor} to competitors, ${sources.other} to other sites. ${sources.gapCitations} sit in answers that do not cite you.`
    )}</p>`
  const types = table(tableCtx(ctx), {
    id: id('types'),
    title: 'By source type',
    rows: sources.types,
    quiet: true,
    columns: [
      { header: 'Source type', html: (r) => esc(r.label), csv: (r) => r.label },
      { header: 'Pages', kind: 'num', html: (r) => count(r.pages), csv: (r) => r.pages },
      {
        header: 'Citations',
        kind: 'num',
        html: (r) => count(r.citations),
        csv: (r) => r.citations
      },
      { header: 'Share', kind: 'num', html: (r) => esc(`${r.share}%`), csv: (r) => r.share },
      {
        header: 'Questions',
        kind: 'num',
        html: (r) => num(ctx, r.questions),
        csv: (r) => r.questions.n
      }
    ]
  })
  const { youtube, reddit, linkedin, influential } = sources
  const channels =
    youtube.channels.length === 0
      ? ''
      : table(tableCtx(ctx), {
          id: id('channels'),
          title: 'By channel',
          rows: youtube.channels,
          columns: [
            { header: 'Channel', html: (r) => esc(r.channel), csv: (r) => r.channel },
            { header: 'Videos', kind: 'num', html: (r) => count(r.videos), csv: (r) => r.videos },
            {
              header: 'Citations',
              kind: 'num',
              html: (r) => count(r.citations),
              csv: (r) => r.citations
            },
            {
              header: 'Questions',
              kind: 'num',
              html: (r) => num(ctx, r.questions),
              csv: (r) => r.questions.n
            }
          ]
        })
  const videos =
    youtube.videos.length === 0
      ? none('No YouTube videos are cited in these answers.')
      : channels +
        table(tableCtx(ctx), {
          id: id('youtube'),
          title: 'Videos',
          rows: youtube.videos,
          sortable: true,
          url: (r) => r.url,
          columns: [
            {
              header: 'Video',
              kind: 'wide',
              html: (r) => link(r.url, r.title),
              csv: (r) => r.title ?? r.url
            },
            { header: 'Channel', html: (r) => esc(r.channel ?? '—'), csv: (r) => r.channel },
            { header: 'Views', kind: 'num', html: (r) => count(r.views), csv: (r) => r.views },
            {
              header: 'Citations',
              kind: 'num',
              html: (r) => count(r.citations),
              csv: (r) => r.citations
            },
            {
              header: 'Questions',
              kind: 'num',
              html: (r) => num(ctx, r.questions),
              csv: (r) => r.questions.n
            },
            { header: 'Gap', kind: 'num', html: (r) => num(ctx, r.gap), csv: (r) => r.gap.n },
            {
              header: 'Posted',
              kind: 'nowrap',
              html: (r) => esc(r.posted ?? '—'),
              csv: (r) => r.publishedAt
            }
          ]
        }) +
        (youtube.detailsMissing
          ? none(
              'Channel, views and posted dates show once CiteFox has fetched them (Communities → Get views).'
            )
          : '')
  const threads =
    reddit.threads.length === 0
      ? none(reddit.sentence)
      : `<p class="rv-p">${esc(reddit.sentence)}</p>` +
        table(tableCtx(ctx), {
          id: id('subreddits'),
          title: 'By subreddit',
          rows: reddit.subreddits,
          columns: [
            { header: 'Subreddit', html: (r) => esc(r.name), csv: (r) => r.name },
            {
              header: 'Threads',
              kind: 'num',
              html: (r) => count(r.threads),
              csv: (r) => r.threads
            },
            {
              header: 'Citations',
              kind: 'num',
              html: (r) => count(r.citations),
              csv: (r) => r.citations
            },
            {
              header: 'Questions',
              kind: 'num',
              html: (r) => num(ctx, r.questions),
              csv: (r) => r.questions.n
            }
          ]
        }) +
        table(tableCtx(ctx), {
          id: id('reddit'),
          title: 'Threads',
          rows: reddit.threads,
          sortable: true,
          url: (r) => r.url,
          columns: [
            {
              header: 'Can we reply?',
              kind: 'nowrap',
              html: (r) =>
                `<span class="chip ${REPLY_CLASS[r.reply]}">${esc(REPLY_WORDS[r.reply])}</span>`,
              csv: (r) => REPLY_WORDS[r.reply]
            },
            {
              header: 'Upvotes',
              kind: 'num',
              html: (r) => count(r.upvotes),
              csv: (r) => r.upvotes
            },
            {
              header: 'Thread',
              kind: 'wide',
              html: (r) => link(r.url, r.title),
              csv: (r) => r.title ?? r.url
            },
            { header: 'Subreddit', html: (r) => esc(r.subreddit), csv: (r) => r.subreddit },
            {
              header: 'Comments',
              kind: 'num',
              html: (r) => count(r.comments),
              csv: (r) => r.comments
            },
            {
              header: 'Questions',
              kind: 'num',
              html: (r) => num(ctx, r.questions),
              csv: (r) => r.questions.n
            },
            { header: 'Gap', kind: 'num', html: (r) => num(ctx, r.gap), csv: (r) => r.gap.n }
          ]
        })
  const linked =
    linkedin.length === 0
      ? none('No LinkedIn pages are cited in these answers.')
      : table(tableCtx(ctx), {
          id: id('linkedin'),
          title: 'LinkedIn pages',
          rows: linkedin,
          quiet: true,
          url: (r) => r.url,
          columns: [
            {
              header: 'Page',
              kind: 'wide',
              html: (r) => link(r.url, r.title),
              csv: (r) => r.title ?? r.url
            },
            { header: 'Kind', html: (r) => esc(kindWord(r.kind)), csv: (r) => kindWord(r.kind) },
            {
              header: 'Citations',
              kind: 'num',
              html: (r) => count(r.citations),
              csv: (r) => r.citations
            },
            {
              header: 'Questions',
              kind: 'num',
              html: (r) => num(ctx, r.questions),
              csv: (r) => r.questions.n
            }
          ]
        })
  const outside =
    influential.length === 0
      ? none('Only your own pages are cited.')
      : table(tableCtx(ctx), {
          id: id('influential'),
          title: 'Most influential outside pages',
          rows: influential,
          quiet: true,
          sortable: true,
          url: (r) => r.url,
          columns: [
            {
              header: 'Page',
              kind: 'wide',
              html: (r) =>
                `${link(r.url, r.title)}<div class="muted">${domainCopy(r.domain)}</div>`,
              csv: (r) => r.url
            },
            { header: 'Whose', html: (r) => esc(WHO_WORDS[r.who]), csv: (r) => WHO_WORDS[r.who] },
            {
              header: 'Questions',
              kind: 'num',
              html: (r) => num(ctx, r.questions),
              csv: (r) => r.questions.n
            },
            {
              header: 'Citations',
              kind: 'num',
              html: (r) => count(r.citations),
              csv: (r) => r.citations
            },
            { header: 'Gap', kind: 'num', html: (r) => num(ctx, r.gap), csv: (r) => r.gap.n }
          ]
        })
  return (
    panel(
      'Who the AI answers lean on',
      split,
      'These are citations, not questions: one answer can cite many pages.'
    ) +
    panel('By source type', types, 'Web pages, videos, threads and posts the answers cite.') +
    panel(
      'YouTube',
      videos,
      'Videos the answers cite. Gap: questions where the video is cited and you are not.'
    ) +
    panel(
      'Reddit',
      threads,
      'Threads the answers cite. Reply where you still can, with real help, not ads.'
    ) +
    panel('LinkedIn', linked) +
    panel(
      'Most influential outside pages',
      outside,
      'Pages cited on the most questions. Gap: questions they win and you do not.'
    )
  )
}

export function kindWord(kind: 'post' | 'article' | 'profile' | 'other'): string {
  return kind === 'post'
    ? 'Post'
    : kind === 'article'
      ? 'Article'
      : kind === 'profile'
        ? 'Profile'
        : 'Page'
}

export function shapeHtml(ctx: ViewCtx): string {
  const shape = ctx.report.answerShape
  if (shape.withText === 0) {
    return '<p class="note">No stored answer text to read for this check yet.</p>'
  }
  const legend =
    `<details class="rv-legend"><summary>What each block means</summary>` +
    shape.legend
      .map(
        (group) =>
          `<p class="rv-p"><strong>${esc(group.label)}</strong></p><ul class="rv-steps">${group.items
            .map((item) => `<li><strong>${esc(item.name)}</strong>: ${esc(item.meaning)}</li>`)
            .join('')}</ul>`
      )
      .join('') +
    '</details>'
  if (shape.analysed.n === 0) {
    return (
      `<p class="note">CiteFox AI has not read these answers yet. ${num(ctx, shape.waiting)} ${shape.waiting.n === 1 ? 'answer waits' : 'answers wait'}; they are read after a check.</p>` +
      legend
    )
  }
  const most = shape.mostCommon
  const tiles =
    `<div class="kpis rv-tiles">${stat(ctx, shape.analysed, 'Answers analysed')}` +
    (most
      ? `<div class="kpi"><p class="kpi-value rv-kpi-text">${esc(most.label)}</p><p class="kpi-label">Most common shape (${num(ctx, most.answers)} ${most.answers.n === 1 ? 'answer' : 'answers'})</p></div>`
      : '') +
    (shape.waiting.n > 0 ? stat(ctx, shape.waiting, 'Not read yet') : '') +
    (shape.changed !== null ? stat(ctx, shape.changed, 'Changed shape') : '') +
    '</div>'
  const journeys = table(tableCtx(ctx), {
    id: `${ctx.view}-shape-journeys`,
    title: 'Recurring answer journeys',
    rows: shape.journeys,
    quiet: true,
    columns: [
      { header: 'Journey', kind: 'wide', html: (r) => esc(r.label), csv: (r) => r.label },
      { header: 'Opens with', html: (r) => esc(r.opensWith), csv: (r) => r.opensWith },
      { header: 'Answers', kind: 'num', html: (r) => num(ctx, r.answers), csv: (r) => r.answers.n }
    ]
  })
  const outlines = shape.journeys
    .slice(0, 5)
    .map(
      (journey) =>
        `<details class="rv-legend"><summary>Write a page in this order: ${esc(journey.label)}</summary><ol class="rv-steps">${journey.outline
          .map((line) => `<li>${esc(line.replace(/^\d+\.\s*/, ''))}</li>`)
          .join('')}</ol></details>`
    )
    .join('')
  return (
    tiles +
    panel(
      'What the answers are made of',
      chart(rankedBars({ ...shapeBlocksChart(ctx.report), width: FULL }), ctx),
      'Answers that hold each kind of block. Click a bar for its questions.'
    ) +
    panel(
      'Recurring answer journeys',
      journeys + outlines,
      'The order the blocks come in. Build your page in the order the answers use.'
    ) +
    legend
  )
}

/** Styles for these two sections, on top of the ready report's own. */
export function sourcesCss(): string {
  return `/* Sources and Answer shape */
.rv-legend { margin-top: 12px; padding: 10px 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); font-size: 14px; }
.rv-legend summary { cursor: pointer; font-weight: 600; color: var(--ink); }
.rv-legend[open] summary { margin-bottom: 8px; }
.rv-kpi-text { font-size: 15px; line-height: 21px; }
`
}
