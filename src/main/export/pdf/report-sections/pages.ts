import { REPORT_SECTION_COPY } from '@shared/report-copy'
import {
  count,
  emptyBlock,
  grouped,
  h2,
  noun,
  num,
  para,
  section,
  table,
  type BlockContext
} from '../blocks'

/** Section 3, Your pages: tracked pages, other own pages cited, and wrong page cited. */

export function pagesBlocks(context: BlockContext): void {
  const { model, say } = context
  const pages = model.pagesSection
  const copy = REPORT_SECTION_COPY.pages
  section(context, copy.title, copy.description)
  if (pages.empty !== null) {
    emptyBlock(context, pages.empty)
    return
  }
  context.blocks.push({
    kind: 'kpis',
    tiles: [
      plainTile(context, 'Pages tracked', grouped(pages.pagesTracked), null),
      plainTile(
        context,
        'Actually cited',
        grouped(pages.pagesCited),
        'Tracked pages linked by at least one AI Overview.'
      ),
      plainTile(
        context,
        'Never cited',
        grouped(pages.pagesNeverCited),
        'Tracked pages no AI Overview links yet.'
      ),
      plainTile(
        context,
        'Other own pages cited',
        grouped(pages.otherOwnCited),
        'Pages on your domain that are cited but not tracked.'
      )
    ]
  })

  if (pages.mostCited.length > 0) {
    h2(context, 'Most-cited own pages')
    const trackedUrls = new Set(pages.tracked.map((page) => page.url))
    if (context.pdf.charts) {
      context.blocks.push({
        kind: 'bars',
        rows: pages.mostCited.slice(0, context.limit).map((page) => ({
          label: say(page.path),
          value: page.prompts.n,
          display: noun(page.prompts.n, 'prompt'),
          tone: page.tracked || trackedUrls.has(page.url) ? 'accent' : 'slate'
        }))
      })
      para(
        context,
        'Prompts whose AI Overview links the page. Tracked pages are highlighted.',
        'muted'
      )
    } else {
      table(context, {
        headers: ['Page', 'Prompts', 'Citations'],
        rows: pages.mostCited.map((page) => [
          page.path,
          count(page.prompts),
          grouped(page.citations)
        ]),
        widths: [6, 1, 1],
        numeric: [1, 2]
      })
    }
  }

  h2(context, 'Tracked pages')
  table(context, {
    headers: [
      'Page',
      'Score',
      'AIO shown',
      'Page cited',
      'Own domain cited',
      'Named',
      'Citations (page / other own)',
      'Last checked'
    ],
    rows: pages.tracked.map((page) => [
      `${page.path}\n${page.url}`,
      num(page.score),
      count(page.aio),
      count(page.pageCited),
      count(page.ownCited),
      count(page.named),
      `${grouped(page.citationsTarget)} / ${grouped(page.citationsOtherOwn)}`,
      context.shortDate(page.lastChecked)
    ]),
    widths: [5, 1, 1.1, 1.1, 1.3, 1.1, 1.7, 1.6],
    numeric: [1, 2, 3, 4, 5, 6]
  })
  para(
    context,
    'Citations count links, not prompts: one answer can link a page more than once.',
    'muted'
  )

  h2(context, 'Other own pages being cited')
  if (pages.otherOwn.length === 0) {
    para(context, 'No other pages on your domain are cited.', 'body')
  } else {
    table(context, {
      headers: ['Page', 'Prompts', 'Citations', 'Note'],
      rows: pages.otherOwn.map((page) => [
        `${page.path}\n${page.url}`,
        count(page.prompts),
        grouped(page.citations),
        page.likelyNoise ? 'Likely noise (login, legal or similar)' : 'Worth tracking'
      ]),
      widths: [6, 1, 1, 3],
      numeric: [1, 2]
    })
  }

  h2(context, 'Wrong page cited')
  if (pages.wrongPage.length === 0) {
    para(context, 'Whenever your domain is cited, it is the tracked page.', 'body')
  } else {
    table(context, {
      headers: ['Prompt', 'Market', 'Cited own URL', 'Tracked page'],
      rows: pages.wrongPage.map((item) => [
        item.prompt,
        context.marketLabel(item.marketId),
        item.citedUrl,
        item.trackedUrl
      ]),
      widths: [4, 1, 3, 3]
    })
  }
}

export function plainTile(
  context: BlockContext,
  label: string,
  value: string,
  definition: string | null,
  detail: string | null = null
): {
  label: string
  value: string
  detail: string | null
  definition: string | null
  accent: boolean
} {
  return {
    label: context.say(label),
    value: context.say(value),
    detail: detail === null ? null : context.say(detail),
    definition: definition === null ? null : context.say(definition),
    accent: false
  }
}
