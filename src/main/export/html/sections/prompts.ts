import type { ReportRow } from '../../model/types'
import type { RenderContext, RenderedSection } from '../context'
import { esc } from '../escape'
import { marketById, shortDate, SOURCE_LABELS, STAGE_LABELS, STATUS_LABELS } from '../format'
import { drill, opener, sectionShell, statusChip, yesNo } from '../parts'
import { table, type Column } from '../tables'
import { pluralWord } from '@shared/pluralize'

/** Section 11: every prompt, searchable, sortable and downloadable. */
export function renderPrompts(ctx: RenderContext): RenderedSection {
  const { model } = ctx
  const pagePath = new Map(model.pages.map((page) => [page.id, page.path]))
  const measured = (row: ReportRow): boolean | null => (row.status === 'error' ? null : row.aio)
  // Every row is on the same page in page scope, so the page column only appears in project scope.
  const pageColumn: Column<ReportRow>[] =
    model.cover.scope === 'project'
      ? [
          {
            header: 'Page',
            kind: 'path',
            html: (row) => `<span class="path">${esc(pagePath.get(row.pageId) ?? '—')}</span>`,
            csv: (row) => pagePath.get(row.pageId) ?? null
          }
        ]
      : []
  const body =
    `<p class="lede-strong">${drill(model.prompts.all, 'All prompts')} ${pluralWord(model.prompts.all.n, 'prompt')} in this report, one per market. Sort by any column, or filter the table.</p>` +
    table<ReportRow>(ctx, {
      id: 'prompts',
      title: 'All prompts',
      rows: model.rows,
      limit: 15,
      sortable: true,
      filter: true,
      columns: [
        { header: '#', kind: 'num', html: (row) => esc(row.number), csv: (row) => row.number },
        {
          header: 'Prompt',
          kind: 'wide',
          html: (row) =>
            opener(
              `q:${row.id}`,
              `<span class="prompt-text">${esc(row.text)}</span>`,
              `Open the answer for: ${row.text}`
            ),
          csv: (row) => row.text,
          sort: (row) => row.text.toLowerCase()
        },
        ...pageColumn,
        {
          header: 'Stage',
          html: (row) => esc(STAGE_LABELS[row.stage]),
          csv: (row) => STAGE_LABELS[row.stage]
        },
        {
          header: 'Source',
          html: (row) => esc(SOURCE_LABELS[row.source]),
          csv: (row) => SOURCE_LABELS[row.source]
        },
        {
          header: 'Market',
          kind: 'nowrap',
          html: (row) => esc(marketById(model, row.marketId)),
          csv: (row) => marketById(model, row.marketId)
        },
        {
          header: 'Status',
          kind: 'nowrap',
          html: (row) => statusChip(row.status),
          csv: (row) => STATUS_LABELS[row.status]
        },
        {
          header: 'AIO',
          kind: 'center',
          html: (row) => yesNo(measured(row)),
          csv: (row) => yesNoText(measured(row)),
          sort: (row) => sortBool(measured(row))
        },
        {
          header: 'Cited',
          kind: 'center',
          html: (row) => yesNo(row.cited),
          csv: (row) => yesNoText(row.cited),
          sort: (row) => sortBool(row.cited)
        },
        {
          header: 'Page cited',
          kind: 'center',
          html: (row) => yesNo(row.pageCited),
          csv: (row) => yesNoText(row.pageCited),
          sort: (row) => sortBool(row.pageCited)
        },
        {
          header: 'Named',
          kind: 'center',
          html: (row) => yesNo(row.named),
          csv: (row) => yesNoText(row.named),
          sort: (row) => sortBool(row.named)
        },
        {
          header: 'Position',
          kind: 'num',
          html: (row) => esc(row.position ?? '—'),
          csv: (row) => row.position
        },
        {
          header: 'Top cited domains',
          html: (row) => esc(row.topDomains.join(', ') || '—'),
          csv: (row) => row.topDomains.join('; ')
        },
        {
          header: 'Last checked',
          kind: 'nowrap',
          html: (row) => esc(shortDate(row.checkedAt, ctx.timeZone)),
          csv: (row) => row.checkedAt,
          sort: (row) => row.checkedAt
        }
      ]
    })
  return sectionShell(
    'prompts',
    body,
    [],
    model.prompts.empty,
    'Every prompt with its AI Overview result, citations and position.'
  )
}

function yesNoText(value: boolean | null): string {
  if (value === null) return '—'
  return value ? 'Yes' : 'No'
}

function sortBool(value: boolean | null): number {
  if (value === null) return -1
  return value ? 1 : 0
}
