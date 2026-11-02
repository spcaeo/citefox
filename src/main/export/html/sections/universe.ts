import type { UniverseRow } from '../../model/types'
import { barSvg } from '../charts/bars'
import type { RenderContext, RenderedSection, SubLink } from '../context'
import { esc } from '../escape'
import { pct } from '../format'
import { drill, kpi, kpis, plainValue, sectionShell, subHeading } from '../parts'
import { table } from '../tables'

const DIMENSION_LEDES: Record<string, string> = {
  stage: 'Problem, solution, comparison, objection and trigger prompts.',
  funnel: 'TOFU is problem and trigger, MOFU is solution and comparison, BOFU is objection.',
  source:
    'Where each prompt came from: the title, meta and H1, a trigger event, or an objection or detail.',
  page: 'The tracked page each prompt belongs to.',
  group: 'Groups from your site structure.',
  market: 'Each market this report covers.'
}

/** Section 7: the shape of the prompt set, and how each segment performs. */
export function renderUniverse(ctx: RenderContext): RenderedSection {
  const section = ctx.model.universe
  const subs: SubLink[] = section.dimensions.map((dimension) => ({
    id: `un-${dimension.id}`,
    title: dimension.title
  }))
  const tiles = kpis([
    kpi({
      label: 'Segments',
      value: plainValue(section.segments),
      sub: 'intent stages with prompts'
    }),
    kpi({
      label: 'Largest segment',
      value: plainValue(section.largest?.prompts ?? '—'),
      sub: section.largest === null ? 'no prompts yet' : `${section.largest.label} prompts`
    }),
    kpi({
      label: 'Best performing',
      value: plainValue(section.best === null ? '—' : `${section.best.rate}%`),
      sub:
        section.best === null
          ? 'Not enough data: needs 5 prompts in a segment'
          : `${section.best.label} · cited rate`,
      tone: 'good'
    }),
    kpi({
      label: 'Weakest',
      value: plainValue(section.weakest === null ? '—' : `${section.weakest.rate}%`),
      sub:
        section.weakest === null
          ? 'Not enough data: needs a second segment of 5'
          : `${section.weakest.label} · cited rate`,
      tone: 'warn'
    })
  ])
  const tables = section.dimensions
    .map(
      (dimension) =>
        subHeading(`un-${dimension.id}`, dimension.title, DIMENSION_LEDES[dimension.id]) +
        table<UniverseRow>(ctx, {
          id: `universe-${dimension.id}`,
          quiet: true,
          title: dimension.title,
          rows: dimension.rows,
          columns: [
            { header: 'Segment', html: (row) => esc(row.label), csv: (row) => row.label },
            {
              header: 'Prompts',
              kind: 'num',
              html: (row) => drill(row.prompts, `${row.label} · prompts`),
              csv: (row) => row.prompts.n
            },
            {
              header: 'AIO shown',
              kind: 'num',
              html: (row) => drill(row.aio, `${row.label} · AI Overview shown`),
              csv: (row) => row.aio.n
            },
            {
              header: 'You cited',
              kind: 'num',
              html: (row) => drill(row.cited, `${row.label} · you cited`),
              csv: (row) => row.cited.n
            },
            {
              header: 'Brand named',
              kind: 'num',
              html: (row) => drill(row.named, `${row.label} · brand named`),
              csv: (row) => row.named.n
            },
            {
              header: 'Cited rate',
              kind: 'nowrap',
              html: (row) =>
                `<span class="rate"><span class="rate-n">${esc(pct(row.citedRate))}</span>${barSvg((row.citedRate ?? 0) / 100, 'blue', `Cited rate ${pct(row.citedRate)}`, 8)}</span>`,
              csv: (row) => row.citedRate
            }
          ]
        })
    )
    .join('')
  return sectionShell(
    'universe',
    tiles +
      tables +
      '<p class="note">Cited rate is prompts that cite you ÷ prompts with an AI Overview in that segment.</p>',
    subs,
    section.empty,
    'The shape of the prompt set: which kinds of buyer questions you track, and which ones Google answers with you in them.'
  )
}
