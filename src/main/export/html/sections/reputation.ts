import type { ReputationSection, SentimentTone } from '../../model/types'
import { sentimentColumns, sentimentDonut } from '../charts/sentiment'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc } from '../escape'
import { card, drill, kpi, kpis, plainValue, rowButton, sectionShell, subHeading } from '../parts'
import { table } from '../tables'

const TONE_LABELS: Record<SentimentTone, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative'
}

type Issue = ReputationSection['issues'][number]
type Answer = ReputationSection['answers'][number]

/** Section 5: brand sentiment in answers that name you, and factual problems worth correcting. */
export function renderReputation(ctx: RenderContext): RenderedSection {
  const section = ctx.model.reputation
  const subs: SubLink[] = [
    { id: 'rp-split', title: 'Sentiment split' },
    { id: 'rp-issues', title: 'Factual problems' },
    { id: 'rp-answers', title: 'Answer by answer' }
  ]
  const claims = section.positive.n + section.neutral.n + section.negative.n
  const net =
    section.net === null ? 'Not enough data' : `${section.net > 0 ? '+' : ''}${section.net}`
  const tiles = kpis([
    kpi({
      label: 'Answers analysed',
      value: plainValue(section.analysed),
      sub: 'AI Overviews that name you'
    }),
    kpi({
      label: 'Positive',
      value: drill(section.positive, 'Positive answers'),
      sub: 'favourable claims',
      tone: 'good'
    }),
    kpi({
      label: 'Neutral',
      value: drill(section.neutral, 'Neutral answers'),
      sub: 'plain mentions'
    }),
    kpi({
      label: 'Negative',
      value: drill(section.negative, 'Negative answers'),
      sub: 'unfavourable claims',
      tone: 'warn'
    }),
    kpi({
      label: 'Net sentiment',
      value: plainValue(net),
      sub:
        section.net === null
          ? `needs 5 claims, ${claims} so far`
          : '(positive − negative) ÷ all × 100',
      tone: 'accent'
    })
  ])
  const split =
    subHeading('rp-split', 'Sentiment split', 'How the answers that name you talk about you.') +
    `<div class="grid-2">${card(sentimentDonut(section))}${card(`<p class="chart-title">Claims per check by tone</p>${sentimentColumns(section, ctx.timeZone)}`)}</div>`

  const issues =
    subHeading(
      'rp-issues',
      'Factual problems worth correcting',
      'Claims in AI Overviews that disagree with your brand facts or your own pages, with the fix to make at the source.'
    ) +
    table<Issue>(ctx, {
      id: 'reputation-issues',
      quiet: true,
      title: 'Factual problems',
      rows: section.issues,
      empty: 'No factual problems found in the answers that name you.',
      columns: [
        {
          header: 'Prompt',
          kind: 'wide',
          html: (row) =>
            row.rowId === null
              ? esc(row.prompt)
              : `${esc(row.prompt)} ${rowButton(row.rowId, row.prompt)}`,
          csv: (row) => row.prompt
        },
        {
          header: 'What the overview claims',
          kind: 'wide',
          html: (row) => `<q>${esc(row.claim)}</q>`,
          csv: (row) => row.claim
        },
        {
          header: 'Why it is wrong',
          kind: 'wide',
          html: (row) => esc(row.whyWrong),
          csv: (row) => row.whyWrong
        },
        {
          header: 'Suggested correction',
          kind: 'wide',
          html: (row) => esc(row.correction),
          csv: (row) => row.correction
        },
        {
          header: 'Source to fix',
          kind: 'wide',
          html: (row) => esc(row.sourceToFix ?? '—'),
          csv: (row) => row.sourceToFix
        }
      ]
    })

  const answers =
    subHeading(
      'rp-answers',
      'Answer by answer',
      'Each analysed answer, its tone, the theme it leans on and where you rank among the brands it names.'
    ) +
    table<Answer>(ctx, {
      id: 'reputation-answers',
      quiet: true,
      title: 'Answer by answer',
      rows: section.answers,
      empty: 'No analysed answers yet.',
      columns: [
        {
          header: 'Prompt',
          kind: 'wide',
          html: (row) => esc(row.prompt),
          csv: (row) => row.prompt
        },
        {
          header: 'Tone',
          html: (row) => `<span class="tone tone-${row.tone}">${TONE_LABELS[row.tone]}</span>`,
          csv: (row) => TONE_LABELS[row.tone]
        },
        { header: 'Theme', html: (row) => esc(row.theme), csv: (row) => row.theme },
        {
          header: 'Rank',
          kind: 'nowrap',
          html: (row) => esc(row.rank ?? '—'),
          csv: (row) => row.rank
        },
        { header: 'Why', kind: 'wide', html: (row) => esc(row.why), csv: (row) => row.why }
      ]
    })

  return sectionShell(
    'reputation',
    tiles + split + issues + answers,
    subs,
    section.empty,
    'What AI Overviews say about your brand when they name it, and the claims worth correcting.'
  )
}
