import { NEXT_STEPS_LEDE, NEXT_STEPS_TITLE } from '../../model/recommendations'
import type { RecommendationEvidence, RecommendationModel } from '../../model/types'
import type { RenderContext, RenderedSection } from '../context'
import { esc, link } from '../escape'
import { marketById } from '../format'
import { drill, perspectiveShell } from '../parts'
import { table } from '../tables'

export { NEXT_STEPS_TITLE }

/** "What to do next": Do this / Why and an evidence table per recommendation. */
export function renderNextSteps(ctx: RenderContext): RenderedSection {
  const items = ctx.model.recommendations
    .map((item, index) => recommendationHtml(ctx, item, index + 1))
    .join('')
  return perspectiveShell(
    'next',
    NEXT_STEPS_TITLE,
    NEXT_STEPS_LEDE,
    `<ol class="recs" data-testid="recommendations">${items}</ol>`
  )
}

function recommendationHtml(ctx: RenderContext, item: RecommendationModel, number: number): string {
  const label = `Recommendation ${number}`
  const evidence = table<RecommendationEvidence>(ctx, {
    id: `next-${number}`,
    title: `${label}: evidence`,
    quiet: true,
    rows: item.evidence,
    columns: [
      {
        header: 'Question',
        kind: 'wide',
        html: (row) => {
          const where = whereText(ctx, row)
          return (
            `<span class="prompt-text">${esc(row.question)}</span>` +
            (where === '' ? '' : `<span class="url">${esc(where)}</span>`)
          )
        },
        csv: (row) => row.question
      },
      {
        header: 'Competitor cited instead',
        html: (row) => (row.competitor === null ? dash() : esc(row.competitor)),
        csv: (row) => row.competitor
      },
      {
        header: 'Page Google cited instead',
        kind: 'wide',
        html: (row) =>
          row.citedUrl === null
            ? dash()
            : `${link(row.citedUrl, row.citedTitle ?? row.citedUrl)}${
                row.citedTitle === null ? '' : `<span class="url">${esc(row.citedUrl)}</span>`
              }`,
        csv: (row) => row.citedUrl
      }
    ]
  })
  const shown =
    item.questions.n > item.evidence.length
      ? `<p class="note">Showing ${item.evidence.length} of ${item.questions.n} questions. The number under Why opens all of them.</p>`
      : ''
  return (
    `<li class="rec card" data-kind="${esc(item.kind)}">` +
    `<p class="rec-line"><span class="rec-label">Do this</span><span class="rec-do">${esc(item.doThis)}</span></p>` +
    `<p class="rec-line"><span class="rec-label">Why</span><span class="rec-why">${whyHtml(item, label)}</span></p>` +
    `${evidence}${shown}</li>`
  )
}

/** The Why line with its count as a drill button, so the number opens its questions. */
function whyHtml(item: RecommendationModel, label: string): string {
  const text = esc(item.why)
  const needle = ` ${item.questions.n} `
  const at = text.indexOf(needle)
  if (at < 0) return text
  return (
    text.slice(0, at + 1) +
    drill(item.questions, `${label}: every question`, 'inline') +
    text.slice(at + needle.length - 1)
  )
}

/** The page and market under a question, each only when the report has several. */
function whereText(ctx: RenderContext, row: RecommendationEvidence): string {
  const parts: string[] = []
  if (ctx.model.cover.trackedPages > 1 && row.pagePath !== '') parts.push(row.pagePath)
  if (ctx.model.markets.length > 1) parts.push(marketById(ctx.model, row.marketId))
  return parts.join(' · ')
}

function dash(): string {
  return '<span class="dash">—</span>'
}
