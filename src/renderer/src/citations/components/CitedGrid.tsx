import { useMemo, type JSX } from 'react'
import type { GridSortKey } from '@shared/domain'
import { DrillNumber } from '../../drill'
import { GOOGLE_ONLY, useEngineFilter } from '../../engines/useEngineFilter'
import {
  Chip,
  DomainText,
  EmptyState,
  ListGrid,
  SegmentedControl,
  UrlText,
  type ChipTone,
  type ListColumn,
  type MenuItem
} from '../../ui'
import {
  marketsDrill,
  overviewsDrill,
  pagesDrill,
  questionsDrill,
  type CitedDrillScope
} from '../drills'
import {
  filterWhose,
  pitchQuestions,
  rowName,
  WHOSE_FILTERS,
  whoseCounts,
  whoseText,
  type CitedListRow,
  type CitedView,
  type WhoseFilter
} from '../model'
import { siteColumns } from '../../sites/siteColumns'
import { siteLine } from '../../sites/siteRows'
import type { SourceLine } from '../../sites/sources'
import { CitedQuestions } from './CitedQuestions'

/** Left out first, in order, while the list is narrower than its row. */
const PAGE_DROPS: readonly string[] = ['markets', 'questions']
const DOMAIN_DROPS: readonly string[] = ['markets', 'pages', 'questions', 'website']

const DEFAULT_SORT: readonly GridSortKey[] = [{ key: 'overviews', dir: 'desc' }]

const VIEW_OPTIONS = [
  { value: 'pages' as const, label: 'Pages' },
  { value: 'domains' as const, label: 'Domains' }
]

const WHOSE_TONES: Readonly<Record<CitedListRow['whose'], ChipTone>> = {
  yours: 'fox',
  competitor: 'info',
  other: 'neutral'
}

/**
 * Every page the latest AI Overviews cite, or the same rows by domain, in the one
 * list grid. Questions, Markets, Overviews (and a domain's Pages) open what they
 * count; a row expands to the questions that cited it. Search, the Whose filter,
 * the sort and the open row are the caller's (from the URL).
 */
export function CitedGrid({
  rows,
  brand = null,
  view,
  whose,
  search,
  sort,
  openId,
  saving,
  drillScope,
  onView,
  onWhose,
  onSearch,
  onSort,
  onOpen,
  onAddCompetitor,
  onPitch
}: {
  /** Every row of the view, before the Whose filter. */
  rows: readonly CitedListRow[]
  /** The project's brand, the name of your own site's row. */
  brand?: string | null
  view: CitedView
  whose: WhoseFilter
  search: string
  sort: readonly GridSortKey[]
  openId: string | null
  /** The row id whose "Add as competitor" is saving. */
  saving: string | null
  drillScope: CitedDrillScope
  onView: (view: CitedView) => void
  onWhose: (whose: WhoseFilter) => void
  onSearch: (value: string) => void
  onSort: (sort: readonly GridSortKey[]) => void
  onOpen: (id: string | null) => void
  onAddCompetitor: (row: CitedListRow) => void
  /** "✦ Draft a pitch" on another site's page, for one question. Pages view only. */
  onPitch?: (row: CitedListRow, question: CitedListRow['questions'][number]) => void
}): JSX.Element {
  const counts = whoseCounts(rows)
  // Cited pages come from Google AI Overview checks only: its logo holds the engine spot.
  const engine = useEngineFilter(GOOGLE_ONLY)
  // A domain row holds several pages; a pitch is about one page, so Pages only.
  const pitchable = useMemo(
    () => (view === 'pages' ? pitchQuestions(rows) : new Map<string, ReadonlySet<string>>()),
    [rows, view]
  )
  const shown = useMemo(() => filterWhose(rows, whose), [rows, whose])
  const expanded = useMemo(() => (openId === null ? [] : [openId]), [openId])
  const domains = view === 'domains'
  // A domain row is a site: its icon, name, website and type, as every list of sites.
  const lines = useMemo(() => new Map(rows.map((row) => [row.id, whoseLine(row)] as const)), [rows])
  const siteCells: ListColumn<CitedListRow>[] = siteColumns<CitedListRow>({
    site: (row) => ({
      domain: row.domain,
      name: row.whose === 'yours' ? brand : row.competitor,
      own: row.whose === 'yours'
    }),
    line: (row) => lines.get(row.id) ?? whoseLine(row),
    nameMinWidth: 160,
    websiteWidth: 184,
    typeWidth: 136
  })
  const columns: ListColumn<CitedListRow>[] = [
    ...(domains
      ? siteCells
      : [
          {
            id: 'name',
            label: 'Cited page',
            width: 'fill' as const,
            minWidth: 240,
            sort: (row: CitedListRow) => rowName(row).toLowerCase(),
            render: (row: CitedListRow) => <NameCell row={row} />
          },
          {
            id: 'whose',
            label: 'Whose',
            width: 136,
            sort: (row: CitedListRow) => whoseText(row).toLowerCase(),
            render: (row: CitedListRow) => (
              <Chip size="sm" tone={WHOSE_TONES[row.whose]}>
                {whoseText(row)}
              </Chip>
            )
          }
        ]),
    ...(domains
      ? [
          {
            id: 'pages',
            label: 'Pages',
            width: 84,
            numeric: true,
            sort: (row: CitedListRow) => row.pages.length,
            render: (row: CitedListRow) => (
              <DrillNumber
                drill={pagesDrill(row, drillScope)}
                label={`${row.pages.length} pages cited on ${row.domain}`}
              />
            )
          }
        ]
      : []),
    {
      id: 'questions',
      label: 'Searches',
      width: 96,
      numeric: true,
      sort: (row) => row.questions.length,
      render: (row) => (
        <DrillNumber
          drill={questionsDrill(row, drillScope)}
          label={`${row.questions.length} searches citing ${rowName(row)}`}
        />
      )
    },
    {
      id: 'markets',
      label: 'Markets',
      width: 88,
      numeric: true,
      sort: (row) => row.marketIds.length,
      render: (row) => (
        <DrillNumber
          drill={marketsDrill(row, drillScope)}
          label={`${row.marketIds.length} markets citing ${rowName(row)}`}
        />
      )
    },
    {
      id: 'overviews',
      label: 'AI Overviews',
      width: 100,
      numeric: true,
      sort: (row) => row.overviews.length,
      render: (row) => (
        <DrillNumber
          drill={overviewsDrill(row, drillScope)}
          label={`${row.overviews.length} AI Overviews citing ${rowName(row)}`}
        />
      )
    }
  ]

  function menu(row: CitedListRow): readonly MenuItem[] {
    if (row.whose !== 'other') return []
    // A known platform (Reddit, YouTube, G2) is where buyers look, never a competitor.
    if ((lines.get(row.id) ?? whoseLine(row)).relation.kind === 'platform') return []
    return [
      {
        id: 'add',
        label: domains ? 'Add as competitor' : `Add ${row.domain} as competitor`,
        icon: 'plus',
        disabled: saving !== null,
        onSelect: () => onAddCompetitor(row)
      }
    ]
  }

  return (
    <ListGrid<CitedListRow>
      // A new view is a new list: its own columns, sort and open row.
      key={view}
      label={domains ? 'Cited domains' : 'Cited pages'}
      noun={domains ? ['domain', 'domains'] : ['page', 'pages']}
      rows={shown}
      rowKey={(row) => row.id}
      rowLabel={rowName}
      columns={columns}
      narrowDrops={domains ? DOMAIN_DROPS : PAGE_DROPS}
      engine={engine.slot}
      sort={sort.length > 0 ? sort : DEFAULT_SORT}
      onSortChange={onSort}
      searchValue={search}
      onSearchChange={onSearch}
      search={{
        text: (row) => `${row.title ?? ''} ${row.url ?? ''} ${row.domain} ${row.competitor ?? ''}`,
        placeholder: domains ? 'Search domains' : 'Search pages'
      }}
      filter={{
        label: 'Whose',
        options: WHOSE_FILTERS.map((item) => ({
          value: item.id,
          label: item.label,
          count: counts[item.id]
        })),
        value: whose,
        onChange: (value) => onWhose(value as WhoseFilter)
      }}
      toolbar={
        <SegmentedControl<CitedView>
          label="Show"
          size="sm"
          options={VIEW_OPTIONS}
          value={view}
          onChange={onView}
        />
      }
      rowMenu={menu}
      renderDetail={(row) => (
        <CitedQuestions
          row={row}
          markets={drillScope.markets}
          {...(onPitch
            ? { pitchable: pitchable.get(row.id), onPitch: (question) => onPitch(row, question) }
            : {})}
        />
      )}
      detailLabel={(row) => `the searches citing ${rowName(row)}`}
      expanded={expanded}
      onExpandedChange={(keys) => onOpen(keys.find((key) => key !== openId) ?? null)}
      onActivate={(row) => onOpen(openId === row.id ? null : row.id)}
      isRowCurrent={(row) => row.id === openId}
      empty={
        <EmptyState
          title="No cited pages yet"
          body="Once a page or topic has a check, the pages its AI Overviews cite show here."
        />
      }
    />
  )
}

/** A domain row's type: yours, a saved competitor, else a platform or neutral site. */
function whoseLine(row: CitedListRow): SourceLine {
  return siteLine({
    key: row.id,
    domain: row.domain,
    classification:
      row.whose === 'yours' ? 'own' : row.whose === 'competitor' ? 'competitor' : 'other',
    competitorId: row.whose === 'competitor' ? row.id : null,
    competitorName: row.competitor
  })
}

function NameCell({ row }: { row: CitedListRow }): JSX.Element {
  const own = row.whose === 'yours'
  if (row.kind === 'domain' || row.url === null) {
    return <DomainText domain={row.domain} own={own} />
  }
  return row.title ? (
    <UrlText url={row.url} label={row.title} plain own={own} />
  ) : (
    <UrlText url={row.url} own={own} />
  )
}
