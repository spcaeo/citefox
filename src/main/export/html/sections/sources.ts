import type {
  InfluentialPage,
  PlatformRow,
  RedditReplyStatus,
  RedditThread,
  SourcesSection,
  YoutubeVideo
} from '../../model/types'
import { stackSvg, type StackPart } from '../charts/bars'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc, link } from '../escape'
import { pct, shortDate, whole, WHO_LABELS } from '../format'
import {
  card,
  drill,
  kpi,
  kpis,
  note,
  plainValue,
  sectionShell,
  subHeading,
  whoChip
} from '../parts'
import { table } from '../tables'

const REPLY_LABELS: Record<RedditReplyStatus, string> = {
  open: 'Open',
  archived: 'Archived',
  locked: 'Closed to replies',
  unchecked: 'Not checked'
}

type Channel = SourcesSection['youtube']['channels'][number]
type Subreddit = SourcesSection['reddit']['subreddits'][number]
type LinkedinItem = SourcesSection['linkedin'][number]

/** Section 8: the pages Google leans on. Citations, not prompts. */
export function renderSources(ctx: RenderContext): RenderedSection {
  const section = ctx.model.sources
  const tz = ctx.timeZone
  const subs: SubLink[] = [
    { id: 'src-split', title: 'Who Google leans on' },
    { id: 'src-types', title: 'By source type' },
    { id: 'src-youtube', title: 'YouTube' },
    { id: 'src-reddit', title: 'Reddit' },
    { id: 'src-linkedin', title: 'LinkedIn' },
    { id: 'src-influential', title: 'Most influential pages' }
  ]
  const share = (n: number): string =>
    section.total > 0 ? `${Math.round((n / section.total) * 100)}%` : '—'
  const tiles = kpis([
    kpi({
      label: 'Total citations',
      value: plainValue(section.total),
      sub: 'links across all AI Overviews'
    }),
    kpi({
      label: 'Yours',
      value: plainValue(section.yours),
      sub: `${pct(section.yoursPct)} of citations`,
      tone: 'good'
    }),
    kpi({
      label: 'Competitor',
      value: plainValue(section.competitor),
      sub: `${share(section.competitor)} of citations`
    }),
    kpi({
      label: 'External',
      value: plainValue(section.external),
      sub: `${share(section.external)} of citations`
    }),
    kpi({
      label: 'Gaps to win',
      value: plainValue(section.gapsToWin),
      sub: 'citations on answers without you',
      tone: 'warn'
    })
  ])

  const parts: StackPart[] = [
    { value: { n: section.yours, drill: null }, tone: 'blue', label: 'Yours' },
    { value: { n: section.competitor, drill: null }, tone: 'orange', label: 'Competitor' },
    { value: { n: section.external, drill: null }, tone: 'gray', label: 'External' }
  ]
  const split =
    subHeading('src-split', 'Who Google leans on', 'Every citation, split by whose page it is.') +
    card(
      `<div class="sov">${stackSvg(parts, section.total, 28)}<ul class="sov-legend">${parts
        .map(
          (part) =>
            `<li><span class="swatch t-${part.tone}" aria-hidden="true"></span><span class="sov-label">${esc(part.label)}</span><span class="num">${part.value.n}</span><span class="bar-meta">${share(part.value.n)}</span></li>`
        )
        .join('')}</ul></div>`
    )

  const types =
    subHeading(
      'src-types',
      'By source type',
      'Web pages, videos, threads, posts and review sites. Prompts counts the answers citing each type.'
    ) +
    table<PlatformRow>(ctx, {
      id: 'source-types',
      quiet: true,
      title: 'By source type',
      rows: section.platforms,
      columns: [
        { header: 'Source type', html: (row) => esc(row.label), csv: (row) => row.label },
        { header: 'Pages', kind: 'num', html: (row) => esc(row.pages), csv: (row) => row.pages },
        {
          header: 'Citations',
          kind: 'num',
          html: (row) => esc(row.citations),
          csv: (row) => row.citations
        },
        {
          header: 'Share',
          kind: 'num',
          html: (row) => esc(pct(row.share)),
          csv: (row) => row.share
        },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Prompts citing ${row.label}`),
          csv: (row) => row.prompts.n
        }
      ]
    })

  const youtube =
    subHeading(
      'src-youtube',
      'YouTube',
      'Cited videos, counted once per video however many timestamps are linked.'
    ) +
    table<YoutubeVideo>(ctx, {
      id: 'youtube-videos',
      title: 'YouTube videos',
      rows: section.youtube.videos,
      empty: 'No YouTube videos are cited.',
      columns: [
        {
          header: 'Video',
          kind: 'wide',
          html: (row) => link(row.url, row.title ?? row.videoId),
          csv: (row) => row.url
        },
        { header: 'Channel', html: (row) => esc(row.channel ?? '—'), csv: (row) => row.channel },
        {
          header: 'Views',
          kind: 'num',
          html: (row) => esc(whole(row.views)),
          csv: (row) => row.views
        },
        {
          header: 'Published',
          kind: 'nowrap',
          html: (row) => esc(shortDate(row.publishedAt, tz)),
          csv: (row) => row.publishedAt
        },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Prompts citing ${row.title ?? row.videoId}`),
          csv: (row) => row.prompts.n
        },
        {
          header: 'Citations',
          kind: 'num',
          html: (row) => esc(row.citations),
          csv: (row) => row.citations
        },
        {
          header: 'Gap',
          kind: 'num',
          html: (row) => drill(row.gap, `${row.title ?? row.videoId} cited, you not`),
          csv: (row) => row.gap.n
        }
      ]
    }) +
    (section.youtube.detailsMissing && section.youtube.videos.length > 0
      ? note(
          'Channel, views and publish date need a YouTube Data API key in CiteFox settings, so they show as —.'
        )
      : '') +
    (section.youtube.channels.length === 0
      ? ''
      : table<Channel>(ctx, {
          id: 'youtube-channels',
          title: 'YouTube channels',
          rows: section.youtube.channels,
          columns: [
            { header: 'Channel', html: (row) => esc(row.channel), csv: (row) => row.channel },
            {
              header: 'Videos',
              kind: 'num',
              html: (row) => esc(row.videos),
              csv: (row) => row.videos
            },
            {
              header: 'Prompts',
              kind: 'num',
              html: (row) => drill(row.prompts, `Prompts citing ${row.channel}`),
              csv: (row) => row.prompts.n
            },
            {
              header: 'Citations',
              kind: 'num',
              html: (row) => esc(row.citations),
              csv: (row) => row.citations
            }
          ]
        }))

  const reddit =
    subHeading('src-reddit', 'Reddit', section.reddit.sentence) +
    table<RedditThread>(ctx, {
      id: 'reddit-threads',
      title: 'Reddit threads',
      rows: section.reddit.threads,
      empty: 'No Reddit threads are cited.',
      columns: [
        {
          header: 'Thread',
          kind: 'wide',
          html: (row) => link(row.url, row.title ?? row.url),
          csv: (row) => row.url
        },
        { header: 'Subreddit', html: (row) => esc(row.subreddit), csv: (row) => row.subreddit },
        {
          header: 'Can we reply?',
          html: (row) =>
            `<span class="reply reply-${row.replyStatus}">${REPLY_LABELS[row.replyStatus]}</span>`,
          csv: (row) => REPLY_LABELS[row.replyStatus]
        },
        {
          header: 'Upvotes',
          kind: 'num',
          html: (row) => esc(whole(row.upvotes)),
          csv: (row) => row.upvotes
        },
        {
          header: 'Comments',
          kind: 'num',
          html: (row) => esc(whole(row.comments)),
          csv: (row) => row.comments
        },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Prompts citing ${row.title ?? row.subreddit}`),
          csv: (row) => row.prompts.n
        },
        {
          header: 'Citations',
          kind: 'num',
          html: (row) => esc(row.citations),
          csv: (row) => row.citations
        }
      ]
    }) +
    (section.reddit.subreddits.length === 0
      ? ''
      : table<Subreddit>(ctx, {
          id: 'reddit-subreddits',
          title: 'By subreddit',
          rows: section.reddit.subreddits,
          columns: [
            { header: 'Subreddit', html: (row) => esc(row.name), csv: (row) => row.name },
            {
              header: 'Threads',
              kind: 'num',
              html: (row) => esc(row.threads),
              csv: (row) => row.threads
            },
            {
              header: 'Prompts',
              kind: 'num',
              html: (row) => drill(row.prompts, `Prompts citing ${row.name}`),
              csv: (row) => row.prompts.n
            },
            {
              header: 'Citations',
              kind: 'num',
              html: (row) => esc(row.citations),
              csv: (row) => row.citations
            }
          ]
        }))

  const linkedin =
    subHeading('src-linkedin', 'LinkedIn', 'Posts and articles cited in AI Overviews.') +
    table<LinkedinItem>(ctx, {
      id: 'linkedin',
      quiet: true,
      title: 'LinkedIn posts and articles',
      rows: section.linkedin,
      empty: 'No LinkedIn posts or articles are cited.',
      columns: [
        {
          header: 'Post or article',
          kind: 'wide',
          html: (row) => link(row.url, row.title ?? row.url),
          csv: (row) => row.url
        },
        {
          header: 'Kind',
          html: (row) =>
            esc(row.kind === 'other' ? 'Other' : row.kind === 'post' ? 'Post' : 'Article'),
          csv: (row) => row.kind
        },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Prompts citing ${row.title ?? 'this LinkedIn page'}`),
          csv: (row) => row.prompts.n
        },
        {
          header: 'Citations',
          kind: 'num',
          html: (row) => esc(row.citations),
          csv: (row) => row.citations
        }
      ]
    })

  const influential =
    subHeading(
      'src-influential',
      'Most influential cited pages',
      'Ranked by prompts citing the page, then by citations. Gap is prompts citing the page and not you.'
    ) +
    table<InfluentialPage>(ctx, {
      id: 'influential-pages',
      quiet: true,
      title: 'Most influential cited pages',
      rows: section.influential,
      columns: [
        {
          header: 'Page',
          kind: 'wide',
          html: (row) =>
            `${link(row.url, row.title ?? row.url)}<span class="url">${esc(row.url)}</span>`,
          csv: (row) => row.url
        },
        { header: 'Domain', html: (row) => esc(row.domain), csv: (row) => row.domain },
        { header: 'Who', html: (row) => whoChip(row.who), csv: (row) => WHO_LABELS[row.who] },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Prompts citing ${row.title ?? row.url}`),
          csv: (row) => row.prompts.n
        },
        {
          header: 'Citations',
          kind: 'num',
          html: (row) => esc(row.citations),
          csv: (row) => row.citations
        },
        {
          header: 'Gap',
          kind: 'num',
          html: (row) => drill(row.gap, `${row.title ?? row.url} cited, you not`),
          csv: (row) => row.gap.n
        }
      ]
    })

  return sectionShell(
    'sources',
    note(section.note, 'callout') +
      tiles +
      split +
      types +
      youtube +
      reddit +
      linkedin +
      influential,
    subs,
    section.empty,
    'Who Google leans on when it answers your buyer prompts: your pages, competitors, videos, threads and the wider web.'
  )
}
