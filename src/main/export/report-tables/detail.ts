import type { CoverageLevel, PromptSource } from '@shared/domain'
import type { Cell } from '../cells'
import { STAGE_LABELS } from '../model/overview'
import type { ReportReference, ReportRow, UniverseDimension } from '../model/types'
import {
  CLASSIFICATION_LABELS,
  SOURCE_TYPE_LABELS,
  WHO_LABELS,
  bool,
  date,
  draft,
  emptyTable,
  n,
  num,
  pct,
  share,
  text,
  total,
  withoutFlag,
  type DraftTable,
  type TableContext
} from './build'

/** Tables for Universe, Sources, Answer shape, Content gaps, Prompts and Raw references. */

/** Dimensions that split the rows into disjoint segments, so a totals row adds up. */
const PARTITIONS: ReadonlySet<UniverseDimension['id']> = new Set([
  'stage',
  'funnel',
  'source',
  'page',
  'market'
])

export function universeTables(context: TableContext): DraftTable[] {
  const section = context.model.universe
  if (section.empty !== null) return [emptyTable('universe', section.empty)]
  return section.dimensions.map((dimension) => {
    const sums = PARTITIONS.has(dimension.id)
    const column = (header: string): string | ReturnType<typeof total> =>
      sums ? total(header) : header
    return draft(
      `universe-${dimension.id}`,
      `Universe ${dimension.title.charAt(0).toLowerCase()}${dimension.title.slice(1)}`,
      [
        'Segment',
        column('Prompts'),
        column('AI Overview shown'),
        column('You cited'),
        column('Brand named'),
        'Cited rate'
      ],
      dimension.rows.map((row) => [
        text(dimension.id === 'market' ? context.marketLabel(row.key) : withoutFlag(row.label)),
        n(row.prompts),
        n(row.aio),
        n(row.cited),
        n(row.named),
        pct(row.citedRate)
      ])
    )
  })
}

export function sourcesTables(context: TableContext): DraftTable[] {
  const section = context.model.sources
  if (section.empty !== null) return [emptyTable('sources', section.empty)]
  const tables: DraftTable[] = [
    draft(
      'sources-split',
      'Who Google leans on',
      ['Group', 'Citations', 'Share of citations'],
      [
        [text('Your pages'), num(section.yours), share(section.yours, section.total)],
        [text('Competitors'), num(section.competitor), share(section.competitor, section.total)],
        [text('External'), num(section.external), share(section.external, section.total)],
        [text('All citations'), num(section.total), share(section.total, section.total)],
        [
          text('Gaps to win (citations on answers without your domain)'),
          num(section.gapsToWin),
          share(section.gapsToWin, section.total)
        ]
      ]
    ),
    draft(
      'sources-platforms',
      'Sources by type',
      ['Source type', total('Pages'), total('Citations'), 'Share', 'Prompts'],
      section.platforms.map((platform) => [
        text(platform.label),
        num(platform.pages),
        num(platform.citations),
        pct(platform.share),
        n(platform.prompts)
      ])
    )
  ]
  const youtube = section.youtube
  if (youtube.videos.length > 0) {
    tables.push(
      draft(
        'sources-youtube',
        'YouTube videos',
        ['Video', 'URL', 'Channel', 'Views', 'Published', 'Prompts', 'Citations', 'Gap'],
        youtube.videos.map((video) => [
          text(video.title ?? video.videoId),
          text(video.url),
          text(video.channel),
          num(video.views),
          date(video.publishedAt),
          n(video.prompts),
          num(video.citations),
          n(video.gap)
        ])
      )
    )
  }
  if (youtube.channels.length > 0) {
    tables.push(
      draft(
        'sources-youtube-channels',
        'YouTube channels',
        ['Channel', 'Videos', 'Prompts', 'Citations'],
        youtube.channels.map((channel) => [
          text(channel.channel),
          num(channel.videos),
          n(channel.prompts),
          num(channel.citations)
        ])
      )
    )
  }
  const reddit = section.reddit
  if (reddit.threads.length > 0) {
    tables.push(
      draft(
        'sources-reddit',
        'Reddit threads',
        [
          'Thread',
          'URL',
          'Subreddit',
          'Can we reply?',
          'Upvotes',
          'Comments',
          'Prompts',
          'Citations'
        ],
        reddit.threads.map((thread) => [
          text(thread.title ?? thread.url),
          text(thread.url),
          text(thread.subreddit),
          text(REPLY_LABELS[thread.replyStatus]),
          num(thread.upvotes),
          num(thread.comments),
          n(thread.prompts),
          num(thread.citations)
        ])
      )
    )
  }
  if (reddit.subreddits.length > 0) {
    tables.push(
      draft(
        'sources-subreddits',
        'Subreddits',
        ['Subreddit', 'Threads', 'Prompts', 'Citations'],
        reddit.subreddits.map((sub) => [
          text(sub.name),
          num(sub.threads),
          n(sub.prompts),
          num(sub.citations)
        ])
      )
    )
  }
  if (section.linkedin.length > 0) {
    tables.push(
      draft(
        'sources-linkedin',
        'LinkedIn',
        ['Title', 'URL', 'Kind', 'Prompts', 'Citations'],
        section.linkedin.map((item) => [
          text(item.title ?? item.url),
          text(item.url),
          text(item.kind.charAt(0).toUpperCase() + item.kind.slice(1)),
          n(item.prompts),
          num(item.citations)
        ])
      )
    )
  }
  if (section.influential.length > 0) {
    tables.push(
      draft(
        'sources-influential',
        'Most influential pages',
        ['Page', 'URL', 'Domain', 'Who', 'Prompts', 'Citations', 'Gap'],
        section.influential.map((page) => [
          text(page.title ?? page.url),
          text(page.url),
          text(page.domain),
          text(WHO_LABELS[page.who]),
          n(page.prompts),
          num(page.citations),
          n(page.gap)
        ])
      )
    )
  }
  return tables
}

export const REPLY_LABELS = {
  open: 'Open',
  archived: 'Archived',
  locked: 'Locked',
  unchecked: 'Not checked'
} as const

export function answerShapeTables(context: TableContext): DraftTable[] {
  const section = context.model.answerShape
  if (section.empty !== null) return [emptyTable('answer_shape', section.empty)]
  const groupOf = new Map<string, string>()
  for (const group of section.legend) {
    for (const code of group.codes) groupOf.set(code, group.label)
  }
  const tables: DraftTable[] = [
    draft(
      'answer-shape-blocks',
      'Answer blocks',
      ['Code', 'Block', 'Group', 'Answers', 'Blocks'],
      section.frequency.map((item) => [
        text(item.code),
        text(item.label),
        text(groupOf.get(item.code)),
        n(item.answers),
        num(item.blocks)
      ])
    )
  ]
  if (section.journeys.length > 0) {
    tables.push(
      draft(
        'answer-shape-journeys',
        'Answer journeys',
        ['Journey', 'Steps', 'Prompts'],
        section.journeys.map((journey) => [
          text(journey.fingerprint),
          text(journey.codes.map((code) => `${code} ${section.labels[code]}`).join(' → ')),
          n(journey.prompts)
        ])
      )
    )
  }
  if (section.changes.length > 0) {
    tables.push(
      draft(
        'answer-shape-changes',
        'Changed shape',
        ['Prompt', 'Before', 'After'],
        section.changes.map((change) => [
          text(change.prompt),
          text(change.before),
          text(change.after)
        ])
      )
    )
  }
  return tables
}

export const COVERAGE_LABELS: Record<CoverageLevel, string> = {
  strong: 'Strong',
  partial: 'Partial',
  weak: 'Weak',
  none: 'Not covered'
}

export function contentGapsTables(context: TableContext): DraftTable[] {
  const section = context.model.contentGaps
  if (section.empty !== null) return [emptyTable('content_gaps', section.empty)]
  const tables: DraftTable[] = []
  const read = section.pageRead
  if (read !== null) {
    const facts: Cell[][] = [
      [text('URL'), text(read.url)],
      [text('Title'), text(read.title)],
      [text('Title length'), num(read.titleLength)],
      [text('Title cut in search results'), bool(read.titleTruncated)],
      [text('Meta description'), text(read.metaDescription)],
      [text('H1'), text(read.h1)],
      [text('Last modified'), date(read.lastModified)],
      [text('Page read'), date(read.readAt)],
      ...read.mismatches.map((mismatch): Cell[] => [text('Mismatch'), text(mismatch)]),
      [text('Coverage summary'), text(section.summary)]
    ]
    tables.push(draft('content-gaps-page-read', 'Page read', ['Field', 'Value'], facts))
  }
  if (section.matrix.length > 0) {
    tables.push(
      draft(
        'content-gaps-matrix',
        'Coverage matrix',
        ['#', 'Prompt', 'Coverage', 'Where covered now', 'Main gap', 'Action'],
        section.matrix.map((row) => [
          num(row.number),
          text(row.prompt),
          text(COVERAGE_LABELS[row.coverage]),
          text(row.whereCovered.join(', ')),
          text(row.mainGap),
          text(row.actionLabel)
        ])
      )
    )
  }
  if (section.oneByOne.length > 0) {
    tables.push(
      draft(
        'content-gaps-one-by-one',
        'One-by-one fixes',
        [
          '#',
          'Prompt',
          "What's there now",
          'What to update',
          'New FAQ',
          'FAQ question',
          'FAQ answer',
          'FAQ words'
        ],
        section.oneByOne.map((item) => [
          num(item.number),
          text(item.prompt),
          text(item.now),
          text(item.update),
          bool(item.newFaq),
          text(item.faq?.question),
          text(item.faq?.answer),
          num(item.faq?.words)
        ])
      )
    )
  }
  if (section.pageWide.length > 0) {
    tables.push(
      draft(
        'content-gaps-page-wide',
        'Page-wide fixes',
        ['Kind', 'Summary', 'Detail'],
        section.pageWide.map((fix) => [
          text(FINDING_LABELS[fix.kind]),
          text(fix.summary),
          text(fix.detail)
        ])
      )
    )
  }
  return tables
}

export const FINDING_LABELS = {
  factual_claim: 'Factual claim',
  missing_promised_section: 'Missing promised section',
  typo: 'Typo',
  title_length: 'Title length',
  title_meta_mismatch: 'Title and meta mismatch',
  other: 'Other'
} as const

export const SOURCE_LABELS: Record<PromptSource, string> = {
  title_meta_h1: 'Title, meta description and H1',
  trigger_event: 'Trigger event',
  objection: 'Objection',
  detail_check: 'Detail check',
  written_by_user: 'Written by you'
}

/** The app's result words (renderer ui/resultTones.ts). */
export const STATUS_LABELS: Record<ReportRow['status'], string> = {
  page_cited: 'Target page',
  other_own_page: 'Your other page',
  brand_mentioned: 'Named, not cited',
  not_cited: 'Not cited',
  no_aio: 'No AI Overview',
  error: 'Check failed'
}

const PROMPT_HEADERS = [
  '#',
  'Prompt',
  'Page',
  'Stage',
  'Funnel',
  'Source',
  'Market',
  'AI Overview',
  'Cited',
  'Page cited',
  'Named',
  'Position',
  'Top cited domains',
  'Last checked',
  'Result',
  'Cited own URL',
  'AI Overview excerpt'
] as const

export function promptsTable(
  context: TableContext,
  rows: readonly ReportRow[],
  id: string,
  sheetName: string
): DraftTable {
  return draft(
    id,
    sheetName,
    PROMPT_HEADERS,
    rows.map((row) => [
      num(row.number),
      text(row.text),
      text(context.pagePath(row.pageId)),
      text(STAGE_LABELS[row.stage]),
      text(row.funnel),
      text(SOURCE_LABELS[row.source]),
      text(context.marketLabel(row.marketId)),
      bool(row.aio),
      bool(row.cited),
      bool(row.pageCited),
      bool(row.named),
      num(row.position),
      text(row.topDomains.join(', ')),
      date(row.checkedAt),
      text(STATUS_LABELS[row.status]),
      text(row.citedUrl),
      text(row.aioExcerpt)
    ])
  )
}

const REFERENCE_HEADERS = [
  'Row',
  '#',
  'Prompt',
  'Market',
  'Position',
  'URL',
  'Domain',
  'Title',
  'Classification',
  'Source type',
  'Own page not tracked'
] as const

export function referencesTable(
  context: TableContext,
  references: readonly ReportReference[],
  id: string,
  sheetName: string
): DraftTable {
  return draft(
    id,
    sheetName,
    REFERENCE_HEADERS,
    references.map((reference) => {
      const row = context.row(reference.rowId)
      return [
        text(reference.rowId),
        num(row?.number),
        text(row?.text),
        text(row === undefined ? null : context.marketLabel(row.marketId)),
        num(reference.position),
        text(reference.url),
        text(reference.domain),
        text(reference.title),
        text(CLASSIFICATION_LABELS[reference.classification]),
        text(SOURCE_TYPE_LABELS[reference.sourceType]),
        bool(reference.untracked)
      ]
    })
  )
}
