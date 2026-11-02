import type { ListColumn } from '../../../ui'
import type { Search } from '../model'
import { BestPageCell, CitedCell, RefCell, ResultCell } from './cells'
import { stageText } from './text'

/**
 * The shared columns of a search list (List view, drill page): number, wording, type,
 * stage, result, page cited or sites instead, win odds. `drop` leaves columns out.
 */
export function searchColumns(options: {
  site: string | null
  drop?: readonly ('type' | 'stage' | 'result' | 'source')[]
  /** Show the topic or page column (Questions screen). */
  source?: boolean
  citedLabel?: string
}): ListColumn<Search>[] {
  const drop = new Set(options.drop ?? [])
  const columns: (ListColumn<Search> | null)[] = [
    {
      id: 'ref',
      label: '#',
      width: 64,
      // "Q6", "K111": technical, so it starts hidden; the Columns menu shows it.
      defaultHidden: true,
      sort: (row) => (row.kind === 'question' ? 0 : 100_000) + row.number,
      render: (row) => <RefCell search={row} />
    },
    {
      id: 'text',
      label: 'Search',
      width: 'fill',
      minWidth: 200,
      sort: (row) => row.text.toLowerCase(),
      copy: (row) => row.text,
      render: (row) => row.text
    },
    options.source && !drop.has('source')
      ? {
          id: 'source',
          label: 'Topic or page',
          width: 180,
          hideWhenSame: true,
          sort: (row) => row.sourceName.toLowerCase(),
          copy: (row) => row.sourceName,
          render: (row) => row.sourceName
        }
      : null,
    drop.has('type')
      ? null
      : {
          id: 'type',
          label: 'Type',
          width: 96,
          hideWhenSame: true,
          sort: (row) => row.kind,
          render: (row) => (row.kind === 'question' ? 'Question' : 'Keyword')
        },
    drop.has('stage')
      ? null
      : {
          id: 'stage',
          label: 'Stage',
          width: 96,
          hideWhenSame: true,
          sort: (row) => row.stage ?? 'zz',
          render: (row) => stageText(row)
        },
    drop.has('result')
      ? null
      : {
          id: 'result',
          label: 'Result',
          width: 148,
          sort: (row) => row.result,
          render: (row) => <ResultCell result={row.result} live={row.live ?? null} />
        },
    {
      id: 'cited',
      label: options.citedLabel ?? 'Page Google cited',
      width: 200,
      sort: (row) => row.pageCited ?? row.citedInstead[0] ?? '',
      render: (row) => <CitedCell search={row} site={options.site} />
    },
    {
      id: 'best',
      label: 'Best page (AI)',
      width: 220,
      hideWhenEmpty: (row) => row.bestPage?.reason ?? null,
      sort: (row) => row.bestPage?.fit ?? -1,
      render: (row) => <BestPageCell search={row} site={options.site} />
    },
    {
      id: 'odds',
      label: 'Win odds',
      width: 88,
      numeric: true,
      hideWhenEmpty: (row) => row.winOdds,
      sort: (row) => row.winOdds,
      render: (row) => (row.winOdds === null ? '—' : row.winOdds)
    }
  ]
  return columns.filter((column): column is ListColumn<Search> => column !== null)
}
