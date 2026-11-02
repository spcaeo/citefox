import { REPORT_SECTION_COPY } from '@shared/report-copy'
import type { DomainWho } from '../../model/types'
import {
  count,
  emptyBlock,
  grouped,
  h2,
  noun,
  num,
  para,
  pctOf,
  pctText,
  section,
  table,
  type BlockContext,
  type LegendItem,
  type Tone
} from '../blocks'
import { plainTile } from './pages'
import { pluralWord } from '@shared/pluralize'

/** Section 4, Competition: share of voice, most-cited domains, and the leaderboard. */

export const WHO_TEXT: Record<DomainWho, string> = {
  you: 'You',
  competitor: 'Competitor',
  observed: 'Observed'
}

export const WHO_TONE: Record<DomainWho, Tone> = {
  you: 'accent',
  competitor: 'blue',
  observed: 'gray'
}

const SOV_LEGEND: readonly LegendItem[] = [
  { tone: 'accent', label: 'You are cited' },
  { tone: 'blue', label: 'A competitor is cited, you are not' },
  { tone: 'gray', label: 'Someone else only' },
  { tone: 'light', label: 'No cited source' }
]

export function competitionBlocks(context: BlockContext): void {
  const { model, say } = context
  const competition = model.competition
  const copy = REPORT_SECTION_COPY.competition
  section(context, copy.title, copy.description)
  if (competition.empty !== null) {
    emptyBlock(context, competition.empty)
    return
  }
  const rival = competition.rival
  const lead = competition.rivalLead
  context.blocks.push({
    kind: 'kpis',
    tiles: [
      plainTile(
        context,
        'Domains cited',
        grouped(competition.domainsCited),
        'Distinct domains linked by the AI Overviews.'
      ),
      plainTile(
        context,
        'Your reach',
        count(competition.reach),
        'Prompts whose AI Overview cites your domain.',
        `${pctText(competition.reachPct)} of tracked prompts`
      ),
      plainTile(
        context,
        'Most-cited rival',
        rival === null ? '—' : rival.domain,
        rival === null
          ? 'No competitor domain is cited.'
          : 'The competitor cited in the most prompts.',
        rival === null ? null : noun(rival.prompts.n, 'prompt')
      ),
      plainTile(
        context,
        'Their lead',
        lead === null ? '—' : lead > 0 ? `+${grouped(lead)}` : grouped(lead),
        lead === null
          ? 'No rival to compare with.'
          : lead > 0
            ? 'Prompts the rival is cited in beyond yours.'
            : 'Zero or below: you are cited in at least as many prompts.'
      ),
      plainTile(
        context,
        'Gap prompts',
        count(competition.gapPrompts),
        'Prompts where another domain is cited and you are not.'
      )
    ]
  })

  const sov = competition.sov
  h2(context, 'Share of voice')
  para(
    context,
    `Of the ${grouped(sov.total.n)} ${pluralWord(sov.total.n, 'prompt')} with an AI Overview.`,
    'muted'
  )
  const parts = [
    { label: 'You are cited', value: sov.you.n, tone: 'accent' as const },
    { label: 'A competitor is cited, you are not', value: sov.competitor.n, tone: 'blue' as const },
    { label: 'Someone else only', value: sov.others.n, tone: 'gray' as const },
    { label: 'No cited source', value: sov.none.n, tone: 'light' as const }
  ]
  if (context.pdf.charts) {
    context.blocks.push({
      kind: 'stacked',
      scale: 'share',
      legend: SOV_LEGEND,
      rows: [
        {
          label: 'AI Overviews',
          display: grouped(sov.total.n),
          segments: parts.map((part) => ({ tone: part.tone, value: part.value }))
        }
      ]
    })
  }
  table(context, {
    headers: ['Group', 'Prompts', 'Share'],
    rows: parts.map((part) => [
      part.label,
      grouped(part.value),
      pctText(pctOf(part.value, sov.total.n))
    ]),
    widths: [5, 1, 1],
    numeric: [1, 2]
  })

  if (context.pdf.charts && competition.mostCited.length > 0) {
    h2(context, 'Most-cited domains')
    context.blocks.push({
      kind: 'bars',
      rows: competition.mostCited.slice(0, 12).map((item) => ({
        label: say(item.domain),
        value: item.prompts.n,
        display: `${grouped(item.prompts.n)} · ${WHO_TEXT[item.who]}`,
        tone: WHO_TONE[item.who]
      }))
    })
    para(
      context,
      'Prompts whose AI Overview cites the domain. Your domain is highlighted; competitors are in blue.',
      'muted'
    )
  }

  h2(context, 'Citation leaderboard')
  table(context, {
    headers: ['Domain', 'Who', 'Prompts', 'Overlap', 'Gap', 'Avg position', 'Authority'],
    rows: competition.leaderboard.map((row) => [
      row.domain,
      WHO_TEXT[row.who],
      count(row.prompts),
      count(row.overlap),
      count(row.gap),
      num(row.avgPosition),
      String(row.authority)
    ]),
    widths: [3, 1.3, 1, 1, 0.9, 1.2, 2.2],
    numeric: [2, 3, 4, 5, 6],
    meter: { column: 6, values: competition.leaderboard.map((row) => row.authority) }
  })
  para(
    context,
    'Overlap: prompts that cite the domain and you. Gap: prompts that cite the domain and not you.',
    'muted'
  )
  para(context, competition.authorityNote, 'muted')
}
