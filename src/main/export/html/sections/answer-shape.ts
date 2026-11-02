import type { AnswerShapeSection, ShapeJourney } from '../../model/types'
import { barList } from '../charts/bars'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc } from '../escape'
import { plural } from '../format'
import {
  card,
  drill,
  kpi,
  kpis,
  note,
  plainValue,
  rowButton,
  sectionShell,
  subHeading
} from '../parts'
import { table } from '../tables'

type ShapeChange = AnswerShapeSection['changes'][number]

/** Section 9: what the overviews are made of, so you know what to write. */
export function renderAnswerShape(ctx: RenderContext): RenderedSection {
  const section = ctx.model.answerShape
  const subs: SubLink[] = [
    { id: 'as-blocks', title: 'What answers are made of' },
    { id: 'as-journeys', title: 'Recurring answer journeys' },
    { id: 'as-changed', title: 'Answers that changed shape' },
    { id: 'as-legend', title: 'Legend' }
  ]
  const label = (code: string): string =>
    section.labels[code as keyof typeof section.labels] ?? code
  const journeyLabel = (journey: ShapeJourney): string =>
    `Answer journey: ${journey.codes.map((code) => label(code)).join(' → ')}`
  const tiles = kpis([
    kpi({
      label: 'Answers analysed',
      value: drill(section.analysed, 'Answers analysed'),
      sub: `${section.notAnalysed.n} not analysed yet`
    }),
    kpi({
      label: 'Block types seen',
      value: plainValue(section.blockTypes),
      sub: 'of 19 in the vocabulary'
    }),
    kpi({
      label: 'Repeating shapes',
      value: plainValue(section.repeatingShapes),
      sub: 'journeys seen more than once'
    }),
    kpi({
      label: 'Most common shape',
      value:
        section.mostCommon === null
          ? plainValue('—')
          : drill(section.mostCommon.prompts, journeyLabel(section.mostCommon)),
      sub: section.mostCommon === null ? 'no repeating shape yet' : section.mostCommon.fingerprint,
      tone: 'accent'
    }),
    kpi({
      label: 'Changed shape',
      value: drill(section.changed, 'Answers that changed shape'),
      sub: 'since the previous check'
    })
  ])
  const pending =
    section.notAnalysed.n > 0
      ? `<p class="note">${drill(section.notAnalysed, 'Answers not analysed yet')} ${section.notAnalysed.n === 1 ? 'answer is not analysed yet. It is' : 'answers are not analysed yet. They are'} classified on the next run, with no new searches.</p>`
      : ''

  const blocks =
    subHeading(
      'as-blocks',
      'What answers are made of',
      'How many answers contain each kind of block. Write the blocks Google keeps using.'
    ) +
    card(
      barList(
        section.frequency.map((item) => ({
          labelHtml: `${esc(item.label)} <span class="code">${esc(item.code)}</span>`,
          value: item.answers,
          drillLabel: `Answers with ${item.label}`,
          tone: 'violet' as const,
          meta: plural(item.blocks, 'block')
        })),
        'Block frequency'
      )
    ) +
    pending

  const journeys =
    subHeading(
      'as-journeys',
      'Recurring answer journeys',
      'The order Google builds its answers in. A journey that repeats is a structure worth matching on your page.'
    ) +
    (section.journeys.length === 0
      ? '<p class="tbl-empty">No answer journeys yet.</p>'
      : `<ol class="journeys">${section.journeys
          .map(
            (journey) =>
              `<li class="journey"><div class="journey-steps">${journey.codes
                .map(
                  (code, index) =>
                    `${index > 0 ? '<span class="arrow" aria-hidden="true">→</span>' : ''}<span class="step"><span class="code">${esc(code)}</span> ${esc(label(code))}</span>`
                )
                .join(
                  ''
                )}</div><p class="journey-count">${drill(journey.prompts, journeyLabel(journey))} ${journey.prompts.n === 1 ? 'prompt follows' : 'prompts follow'} it</p></li>`
          )
          .join('')}</ol>`)

  const changed =
    subHeading(
      'as-changed',
      'Answers that changed shape',
      'Answers whose structure is different from the previous check.'
    ) +
    table<ShapeChange>(ctx, {
      id: 'shape-changes',
      quiet: true,
      title: 'Answers that changed shape',
      rows: section.changes,
      empty: 'No answers changed shape since the previous check.',
      columns: [
        {
          header: 'Prompt',
          kind: 'wide',
          html: (row) => `${esc(row.prompt)} ${rowButton(row.rowId, row.prompt)}`,
          csv: (row) => row.prompt
        },
        {
          header: 'Before',
          kind: 'nowrap',
          html: (row) => `<span class="fingerprint">${esc(row.before)}</span>`,
          csv: (row) => row.before
        },
        {
          header: 'Now',
          kind: 'nowrap',
          html: (row) => `<span class="fingerprint">${esc(row.after)}</span>`,
          csv: (row) => row.after
        }
      ]
    })

  const legend =
    subHeading(
      'as-legend',
      'Legend',
      'Every block of an AI Overview is one of these. The codes are shorthand used above.'
    ) +
    `<div class="shape-legend">${section.legend
      .map(
        (group) =>
          `<div class="legend-group"><p class="legend-title">${esc(group.label)}</p><ul>${group.codes
            .map((code) => `<li><span class="code">${esc(code)}</span> ${esc(label(code))}</li>`)
            .join('')}</ul></div>`
      )
      .join('')}</div>` +
    (section.templateHash === null
      ? ''
      : note(
          `Classified by the answer-shape template ${section.templateHash.slice(0, 8)}, on stored overviews with no new searches.`
        ))

  return sectionShell(
    'answer_shape',
    tiles + blocks + journeys + changed + legend,
    subs,
    section.empty,
    'What the AI Overviews are made of, block by block, so you know what to write rather than only how you are doing.'
  )
}
