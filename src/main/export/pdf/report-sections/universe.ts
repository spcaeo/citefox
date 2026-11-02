import { REPORT_SECTION_COPY } from '@shared/report-copy'
import {
  count,
  emptyBlock,
  grouped,
  h2,
  noun,
  num,
  para,
  pctText,
  section,
  table,
  type BlockContext
} from '../blocks'
import { WHO_TEXT } from './competition'
import { plainTile } from './pages'

/** Sections 7 and 8, Universe and Sources. */

export function universeBlocks(context: BlockContext): void {
  const universe = context.model.universe
  const copy = REPORT_SECTION_COPY.universe
  section(context, copy.title, copy.description)
  if (universe.empty !== null) {
    emptyBlock(context, universe.empty)
    return
  }
  context.blocks.push({
    kind: 'kpis',
    tiles: [
      plainTile(context, 'Segments', grouped(universe.segments), null),
      plainTile(
        context,
        'Largest segment',
        universe.largest?.label ?? '—',
        null,
        universe.largest === null ? null : noun(universe.largest.prompts, 'prompt')
      ),
      plainTile(
        context,
        'Best performing',
        universe.best?.label ?? '—',
        'Highest cited rate among segments with 5 or more prompts.',
        universe.best === null ? null : `${universe.best.rate}% cited`
      ),
      plainTile(
        context,
        'Weakest',
        universe.weakest?.label ?? '—',
        'Lowest cited rate among segments with 5 or more prompts.',
        universe.weakest === null ? null : `${universe.weakest.rate}% cited`
      )
    ]
  })
  para(
    context,
    'Cited rate is prompts that cite you divided by prompts with an AI Overview.',
    'muted'
  )
  for (const dimension of universe.dimensions) {
    h2(context, dimension.title)
    table(context, {
      headers: ['Segment', 'Prompts', 'AIO shown', 'You cited', 'Brand named', 'Cited rate'],
      rows: dimension.rows.map((row) => [
        dimension.id === 'market' ? context.marketLabel(row.key) : row.label,
        count(row.prompts),
        count(row.aio),
        count(row.cited),
        count(row.named),
        pctText(row.citedRate)
      ]),
      widths: [3.4, 1, 1.1, 1.1, 1.2, 2.6],
      numeric: [1, 2, 3, 4, 5],
      meter: { column: 5, values: dimension.rows.map((row) => row.citedRate) }
    })
  }
}

const REPLY_TEXT = {
  open: 'Open',
  archived: 'Archived',
  locked: 'Locked',
  unchecked: 'Not checked'
} as const

export function sourcesBlocks(context: BlockContext): void {
  const sources = context.model.sources
  const copy = REPORT_SECTION_COPY.sources
  section(context, copy.title, copy.description)
  if (sources.empty !== null) {
    emptyBlock(context, sources.empty)
    return
  }
  para(context, sources.note, 'muted')
  context.blocks.push({
    kind: 'kpis',
    tiles: [
      plainTile(context, 'Total citations', grouped(sources.total), null),
      plainTile(
        context,
        'Yours',
        grouped(sources.yours),
        null,
        `${pctText(sources.yoursPct)} of citations`
      ),
      plainTile(context, 'Competitor', grouped(sources.competitor), null),
      plainTile(context, 'External', grouped(sources.external), null),
      plainTile(
        context,
        'Gaps to win',
        grouped(sources.gapsToWin),
        'Citations on answers where your domain is absent.'
      )
    ]
  })
  if (context.pdf.charts && sources.total > 0) {
    h2(context, 'Who Google leans on')
    context.blocks.push({
      kind: 'stacked',
      scale: 'share',
      legend: [
        { tone: 'accent', label: 'Your pages' },
        { tone: 'blue', label: 'Competitors' },
        { tone: 'gray', label: 'External' }
      ],
      rows: [
        {
          label: 'Citations',
          display: grouped(sources.total),
          segments: [
            { tone: 'accent', value: sources.yours },
            { tone: 'blue', value: sources.competitor },
            { tone: 'gray', value: sources.external }
          ]
        }
      ]
    })
  }
  h2(context, 'By source type')
  table(context, {
    headers: ['Source type', 'Pages', 'Citations', 'Share', 'Prompts'],
    rows: sources.platforms.map((platform) => [
      platform.label,
      grouped(platform.pages),
      grouped(platform.citations),
      pctText(platform.share),
      count(platform.prompts)
    ]),
    widths: [3, 1, 1, 1, 1],
    numeric: [1, 2, 3, 4]
  })

  h2(context, 'YouTube')
  const youtube = sources.youtube
  if (youtube.videos.length === 0) {
    para(context, 'No YouTube videos are cited.', 'body')
  } else {
    table(context, {
      headers: ['Video', 'Channel', 'Views', 'Published', 'Prompts', 'Citations', 'Gap'],
      rows: youtube.videos.map((video) => [
        `${video.title ?? video.videoId}\n${video.url}`,
        video.channel ?? '—',
        num(video.views),
        context.shortDate(video.publishedAt),
        count(video.prompts),
        grouped(video.citations),
        count(video.gap)
      ]),
      widths: [4.4, 1.6, 1, 1.3, 1, 1, 0.8],
      numeric: [2, 4, 5, 6]
    })
    if (youtube.detailsMissing) {
      para(
        context,
        'Channel, views and publish date need your YouTube Data API key; they show "—" until it is added.',
        'muted'
      )
    }
    if (youtube.channels.length > 0) {
      table(context, {
        headers: ['Channel', 'Videos', 'Prompts', 'Citations'],
        rows: youtube.channels.map((channel) => [
          channel.channel,
          grouped(channel.videos),
          count(channel.prompts),
          grouped(channel.citations)
        ]),
        widths: [4, 1, 1, 1],
        numeric: [1, 2, 3]
      })
    }
  }

  h2(context, 'Reddit')
  para(context, sources.reddit.sentence, 'body')
  if (sources.reddit.threads.length > 0) {
    table(context, {
      headers: [
        'Thread',
        'Subreddit',
        'Can we reply?',
        'Upvotes',
        'Comments',
        'Prompts',
        'Citations'
      ],
      rows: sources.reddit.threads.map((thread) => [
        `${thread.title ?? thread.url}\n${thread.url}`,
        thread.subreddit,
        REPLY_TEXT[thread.replyStatus],
        num(thread.upvotes),
        num(thread.comments),
        count(thread.prompts),
        grouped(thread.citations)
      ]),
      widths: [4.2, 1.4, 1.3, 1, 1.1, 1, 1],
      numeric: [3, 4, 5, 6]
    })
  }

  h2(context, 'LinkedIn')
  if (sources.linkedin.length === 0) {
    para(context, 'No LinkedIn posts or articles are cited.', 'body')
  } else {
    table(context, {
      headers: ['Post or article', 'Kind', 'Prompts', 'Citations'],
      rows: sources.linkedin.map((item) => [
        `${item.title ?? item.url}\n${item.url}`,
        item.kind.charAt(0).toUpperCase() + item.kind.slice(1),
        count(item.prompts),
        grouped(item.citations)
      ]),
      widths: [5, 1, 1, 1],
      numeric: [2, 3]
    })
  }

  if (sources.influential.length > 0) {
    h2(context, 'Most influential cited pages')
    para(
      context,
      'Ranked by prompts cited, then by citations. Gap: prompts that cite the page and not you.',
      'muted'
    )
    table(context, {
      headers: ['Page', 'Who', 'Prompts', 'Citations', 'Gap'],
      rows: sources.influential.map((page) => [
        `${page.title ?? page.domain}\n${page.url}`,
        WHO_TEXT[page.who],
        count(page.prompts),
        grouped(page.citations),
        count(page.gap)
      ]),
      widths: [6, 1.3, 1, 1, 0.8],
      numeric: [2, 3, 4]
    })
  }
}
