import { SITE_KIND_LABELS } from '@shared/report/site-kinds'
import type { LeaderboardRow, SiteKindRow } from '../../model/types'
import { barList, barSvg, type Tone } from '../charts/bars'
import { shareOfVoice } from '../charts/funnel'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc } from '../escape'
import { decimal, pct, plural, WHO_LABELS } from '../format'
import {
  card,
  drill,
  kpi,
  kpis,
  note,
  opener,
  plainValue,
  sectionShell,
  subHeading,
  whoChip
} from '../parts'
import { table } from '../tables'

const WHO_TONE: Record<LeaderboardRow['who'], Tone> = {
  you: 'blue',
  competitor: 'orange',
  observed: 'gray'
}

/** Section 4: share of voice, most-cited domains and the citation leaderboard. */
export function renderCompetition(ctx: RenderContext): RenderedSection {
  const section = ctx.model.competition
  const subs: SubLink[] = [
    { id: 'cp-sov', title: 'Share of voice' },
    { id: 'cp-domains', title: 'Most-cited domains' },
    { id: 'cp-kinds', title: 'By kind of site' },
    { id: 'cp-leaderboard', title: 'Citation leaderboard' }
  ]
  const hasBefore = section.mostCited.some((item) => item.before !== null)
  const lead =
    section.rivalLead === null
      ? 'no rival cited yet'
      : section.rivalLead > 0
        ? `${plural(section.rivalLead, 'prompt')} ahead of you`
        : section.rivalLead < 0
          ? `you lead by ${plural(-section.rivalLead, 'prompt')}`
          : 'level with you'
  const tiles = kpis([
    kpi({
      label: 'Domains cited',
      value: plainValue(section.domainsCited),
      sub: 'across all AI Overviews'
    }),
    kpi({
      label: 'Your reach',
      value: drill(section.reach, 'Prompts citing you'),
      sub: `${pct(section.reachPct)} of tracked prompts`,
      tone: 'good'
    }),
    kpi({
      label: 'Most-cited rival',
      value:
        section.rival === null
          ? plainValue('—')
          : `${drill(section.rival.prompts, `Prompts citing ${section.rival.domain}`)}`,
      sub: section.rival === null ? 'no competitor cited' : section.rival.domain
    }),
    kpi({
      label: 'Their lead',
      value: plainValue(
        section.rivalLead === null
          ? '—'
          : section.rivalLead > 0
            ? `+${section.rivalLead}`
            : section.rivalLead < 0
              ? `−${-section.rivalLead}`
              : '0'
      ),
      sub: lead
    }),
    kpi({
      label: 'Gap prompts',
      value: drill(section.gapPrompts, 'Gap prompts: others cited, you not'),
      sub: 'others cited, you not',
      tone: 'warn'
    })
  ])

  const sov =
    subHeading(
      'cp-sov',
      'Share of voice',
      'Of the prompts with an AI Overview: cited you, cited a configured competitor but not you, or cited only someone else.'
    ) + card(shareOfVoice(section.sov))

  const domains =
    subHeading(
      'cp-domains',
      'Most-cited domains',
      'The sites AI Overviews link most often, by prompts citing them.'
    ) +
    card(
      (hasBefore ? earlierLegend() : '') +
        barList(
          section.mostCited.map((item) => ({
            labelHtml: `<span class="domain">${esc(item.domain)}</span> ${whoChip(item.who)}`,
            value: item.prompts,
            drillLabel: `Prompts citing ${item.domain}`,
            tone: WHO_TONE[item.who],
            before: item.before,
            ...(item.before === null ? {} : { meta: `was ${item.before}` })
          })),
          'Most-cited domains'
        )
    )

  const kinds =
    subHeading(
      'cp-kinds',
      'Who else is cited, by kind of site',
      'Citations (links) to other sites in the latest full check and the one before it. A saved competitor counts as Competitors; other sites are sorted by a built-in list of well-known sites, else by Claude, once per domain.'
    ) + kindTable(ctx, section.byKind)

  const leaderboard =
    subHeading(
      'cp-leaderboard',
      'Citation leaderboard',
      'Overlap is prompts that cite the domain and you. Gap is prompts that cite the domain and not you.'
    ) +
    table<LeaderboardRow>(ctx, {
      id: 'leaderboard',
      quiet: true,
      title: 'Citation leaderboard',
      rows: section.leaderboard,
      sortable: true,
      filter: true,
      limit: 12,
      columns: [
        {
          header: 'Domain',
          html: (row) =>
            opener(
              `dom:${row.domain}`,
              `<span class="domain">${esc(row.domain)}</span>`,
              `Prompts citing ${row.domain}`
            ),
          csv: (row) => row.domain
        },
        { header: 'Who', html: (row) => whoChip(row.who), csv: (row) => WHO_LABELS[row.who] },
        {
          header: 'Kind of site',
          kind: 'nowrap',
          html: (row) =>
            row.kind === null
              ? '<span class="dash">—</span>'
              : `<span class="kind">${esc(SITE_KIND_LABELS[row.kind])}</span>`,
          csv: (row) => (row.kind === null ? null : SITE_KIND_LABELS[row.kind])
        },
        {
          header: 'Prompts',
          kind: 'num',
          html: (row) => drill(row.prompts, `Prompts citing ${row.domain}`),
          csv: (row) => row.prompts.n
        },
        {
          header: 'Overlap',
          kind: 'num',
          html: (row) =>
            row.overlap === null
              ? '<span class="dash">—</span>'
              : drill(row.overlap, `${row.domain} and you`),
          csv: (row) => row.overlap?.n ?? null
        },
        {
          header: 'Gap',
          kind: 'num',
          html: (row) =>
            row.gap === null
              ? '<span class="dash">—</span>'
              : drill(row.gap, `${row.domain} cited, you not`),
          csv: (row) => row.gap?.n ?? null
        },
        {
          header: 'Avg position',
          kind: 'num',
          html: (row) => esc(decimal(row.avgPosition)),
          csv: (row) => row.avgPosition
        },
        {
          header: 'Authority',
          kind: 'nowrap',
          html: (row) =>
            `<span class="authority"><span class="authority-n">${row.authority}</span>${barSvg(row.authority / 100, WHO_TONE[row.who], `Authority ${row.authority}`, 8)}</span>`,
          csv: (row) => row.authority
        }
      ]
    }) +
    note(section.authorityNote)

  return sectionShell(
    'competition',
    tiles + sov + domains + kinds + leaderboard,
    subs,
    section.empty,
    'Who else AI Overviews cite for your buyer prompts, and where they are cited instead of you.'
  )
}

function earlierLegend(): string {
  return (
    `<ul class="legend"><li><span class="swatch t-gray" aria-hidden="true"></span>Latest full check</li>` +
    `<li><span class="swatch swatch-before" aria-hidden="true"></span>Previous full check (thin bar)</li></ul>`
  )
}

function signed(value: number | null): string {
  if (value === null) return '<span class="dash">—</span>'
  if (value === 0) return '<span class="muted">0</span>'
  return value > 0
    ? `<span class="delta-up">+${value}</span>`
    : `<span class="delta-down">−${-value}</span>`
}

function kindTable(ctx: RenderContext, rows: readonly SiteKindRow[]): string {
  return table<SiteKindRow>(ctx, {
    id: 'site-kinds',
    title: 'Other sites by kind',
    quiet: true,
    rows,
    empty: 'No other site is cited yet.',
    columns: [
      { header: 'Kind of site', html: (row) => esc(row.label), csv: (row) => row.label },
      { header: 'Sites', kind: 'num', html: (row) => esc(row.sites), csv: (row) => row.sites },
      {
        header: 'Citations before',
        kind: 'num',
        html: (row) => (row.before === null ? '<span class="dash">—</span>' : esc(row.before)),
        csv: (row) => row.before
      },
      {
        header: 'Citations now',
        kind: 'num',
        html: (row) => `<span class="num">${esc(row.now)}</span>`,
        csv: (row) => row.now
      },
      {
        header: 'Change',
        kind: 'num',
        html: (row) => signed(row.change),
        csv: (row) => row.change
      },
      {
        header: 'Prompts citing',
        kind: 'num',
        html: (row) => drill(row.prompts, `Prompts citing ${row.label.toLowerCase()}`),
        csv: (row) => row.prompts.n
      }
    ]
  })
}
