import { barList } from '../charts/bars'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc, link } from '../escape'
import { marketById, plural, shortDate } from '../format'
import {
  card,
  drill,
  kpi,
  kpis,
  note,
  opener,
  plainValue,
  sectionShell,
  subHeading
} from '../parts'
import { table } from '../tables'
import type { OtherOwnPage, TrackedPageRow, WrongPageItem } from '../../model/types'

/** Section 3: which of your pages Google cites, never cites, or cites in place of the tracked page. */
export function renderPages(ctx: RenderContext): RenderedSection {
  const section = ctx.model.pagesSection
  const subs: SubLink[] = [
    { id: 'pg-most-cited', title: 'Most-cited pages' },
    { id: 'pg-tracked', title: 'Tracked pages' },
    { id: 'pg-other', title: 'Other own pages cited' },
    { id: 'pg-wrong', title: 'Wrong page cited' }
  ]
  const tiles = kpis([
    kpi({
      label: 'Pages tracked',
      value: plainValue(section.pagesTracked),
      sub: 'pages CiteFox checks'
    }),
    kpi({
      label: 'Actually cited',
      value: plainValue(section.pagesCited),
      sub:
        section.pagesTracked > 0
          ? `${Math.round((section.pagesCited / section.pagesTracked) * 100)}% of tracked`
          : 'of tracked',
      tone: 'good'
    }),
    kpi({
      label: 'Never cited',
      value: plainValue(section.pagesNeverCited),
      sub: 'tracked but unused by Google',
      tone: 'warn'
    }),
    kpi({
      label: 'Other own pages cited',
      value: plainValue(section.otherOwnCited),
      sub: 'cited but not tracked'
    })
  ])

  const mostCited =
    subHeading(
      'pg-most-cited',
      'Most-cited pages',
      'Your pages that AI Overviews link to, by the prompts that cite them.'
    ) +
    card(
      barList(
        section.mostCited.map((page) => ({
          labelHtml: `<span class="path">${esc(page.path)}</span>${page.tracked ? ' <span class="tag">tracked</span>' : ''}`,
          value: page.prompts,
          drillLabel: `Prompts citing ${page.path}`,
          meta: plural(page.citations, 'citation')
        })),
        'Most-cited own pages'
      )
    )

  const tracked =
    subHeading(
      'pg-tracked',
      'Tracked pages',
      'Each tracked page and how its buyer prompts perform.'
    ) +
    table<TrackedPageRow>(ctx, {
      id: 'tracked-pages',
      url: (row) => row.url,
      quiet: true,
      title: 'Tracked pages',
      rows: section.tracked,
      columns: [
        {
          header: 'Page',
          kind: 'wide',
          html: (row) =>
            `${opener(`p:${row.url}`, `<span class="path">${esc(row.path)}</span>`, `Prompts for ${row.path}`)}<span class="url">${link(row.url)}</span>`,
          csv: (row) => row.url
        },
        {
          header: 'Score',
          kind: 'num',
          html: (row) => esc(row.score ?? '—'),
          csv: (row) => row.score
        },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Prompts on ${row.path}`),
          csv: (row) => row.prompts.n
        },
        {
          header: 'AIO shown',
          kind: 'num',
          html: (row) => drill(row.aio, `AI Overview shown · ${row.path}`),
          csv: (row) => row.aio.n
        },
        {
          header: 'Page cited',
          kind: 'num',
          html: (row) => drill(row.pageCited, `Page cited · ${row.path}`),
          csv: (row) => row.pageCited.n
        },
        {
          header: 'Own domain cited',
          kind: 'num',
          html: (row) => drill(row.ownCited, `Own domain cited · ${row.path}`),
          csv: (row) => row.ownCited.n
        },
        {
          header: 'Named',
          kind: 'num',
          html: (row) => drill(row.named, `Brand named · ${row.path}`),
          csv: (row) => row.named.n
        },
        {
          header: 'Citations (page / other own)',
          kind: 'num',
          html: (row) =>
            `${row.citationsTarget} <span class="muted">/ ${row.citationsOtherOwn}</span>`,
          csv: (row) => `${row.citationsTarget} / ${row.citationsOtherOwn}`
        },
        {
          header: 'Last checked',
          kind: 'nowrap',
          html: (row) => esc(shortDate(row.lastChecked, ctx.timeZone)),
          csv: (row) => row.lastChecked
        }
      ]
    }) +
    note('Citations count links, not prompts: one answer can link the same page more than once.')

  const other =
    subHeading(
      'pg-other',
      'Other own pages cited',
      'Pages on your domain that AI Overviews cite but CiteFox does not track. Track or ignore them in CiteFox.'
    ) +
    table<OtherOwnPage>(ctx, {
      id: 'other-own-pages',
      url: (row) => row.url,
      quiet: true,
      title: 'Other own pages cited',
      rows: section.otherOwn,
      empty: 'No other pages on your domain are cited.',
      columns: [
        {
          header: 'Page',
          kind: 'wide',
          html: (row) =>
            `${opener(`p:${row.url}`, `<span class="path">${esc(row.path)}</span>`, `Prompts for ${row.path}`)}<span class="url">${link(row.url)}</span>`,
          csv: (row) => row.url
        },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Prompts citing ${row.path}`),
          csv: (row) => row.prompts.n
        },
        {
          header: 'Citations',
          kind: 'num',
          html: (row) => esc(row.citations),
          csv: (row) => row.citations
        },
        {
          header: 'Note',
          html: (row) =>
            row.likelyNoise
              ? '<span class="tag">Likely noise (login, legal or cart)</span>'
              : '<span class="muted">Worth a look</span>',
          csv: (row) => (row.likelyNoise ? 'Likely noise' : '')
        }
      ]
    })

  const wrong =
    subHeading(
      'pg-wrong',
      'Wrong page cited',
      'Your domain is cited, but with a different page from the one you track for that prompt.'
    ) +
    table<WrongPageItem>(ctx, {
      id: 'wrong-page',
      quiet: true,
      title: 'Wrong page cited',
      rows: section.wrongPage,
      empty: 'No wrong-page citations: when your domain is cited, it is the tracked page.',
      columns: [
        {
          header: 'Prompt',
          kind: 'wide',
          html: (row) => esc(row.prompt),
          csv: (row) => row.prompt
        },
        {
          header: 'Cited instead',
          kind: 'wide',
          html: (row) => link(row.citedUrl),
          csv: (row) => row.citedUrl
        },
        {
          header: 'Tracked page',
          kind: 'wide',
          html: (row) => link(row.trackedUrl),
          csv: (row) => row.trackedUrl
        },
        {
          header: 'Market',
          kind: 'nowrap',
          html: (row) => esc(marketById(ctx.model, row.marketId)),
          csv: (row) => marketById(ctx.model, row.marketId)
        }
      ]
    })

  return sectionShell(
    'pages',
    tiles + mostCited + tracked + other + wrong,
    subs,
    section.empty,
    'Which of your pages AI Overviews actually lean on. A tracked page that is never cited is the clearest gap this report can show.'
  )
}
