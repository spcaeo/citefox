import { useMemo, type JSX } from 'react'
import type { FixSearch, ProjectSearches } from '@shared/page-fixes'
import { pluralize } from '@shared/pluralize'
import { LoadError } from '../../components/LoadError'
import { DrillButton } from '../../drill'
import { GOOGLE_ONLY, useEngineFilter } from '../../engines/useEngineFilter'
import { useProjectSearches } from '../../fixes/hooks/useProjectSearches'
import { pathOf } from '../../fixes/model'
import type { ProjectFixesSource } from '../../fixes/source'
import { searchesDrill } from '../../fixes/todo/model'
import { openPageFix } from '../../fixes/todo/openPageFix'
import {
  IconButton,
  EmptyState,
  ListGrid,
  ResultChip,
  UrlText,
  type ListColumn,
  type ListTree
} from '../../ui'
import { citationPages, pagesFooter, SECTION_LABEL, SECTIONS, type PagesRow } from './model'
import './pages.css'

/** The words of each line's first cell and its drills. */
function rowTitle(row: PagesRow): string {
  switch (row.kind) {
    case 'target':
    case 'other':
      return pathOf(row.url ?? '')
    case 'new':
      return 'No page yet'
    case 'site':
      return row.domain ?? ''
    case 'noAio':
      return 'No AI Overview'
    case 'notChecked':
      return 'Not checked yet'
  }
}

const NOTE: Partial<Record<PagesRow['kind'], string>> = {
  new: 'not cited, and no page aims at them',
  noAio: 'Google answered without one',
  notChecked: 'the next check answers them'
}

function count(
  searches: readonly FixSearch[],
  row: PagesRow,
  part: 'cited' | 'win',
  projectId: string,
  domain: string
): JSX.Element | string {
  if (searches.length === 0) return '—'
  const title = rowTitle(row)
  const what =
    row.kind === 'site'
      ? `Searches citing ${title} instead of you`
      : part === 'cited'
        ? row.section === 'none'
          ? title
          : `Searches citing ${title}`
        : row.kind === 'new'
          ? 'Searches no page of yours aims at'
          : `Searches ${title} still has to win`
  return (
    <DrillButton
      className="dg-drill num"
      label={`${pluralize(searches.length, 'search', 'searches')}: ${what}`}
      drill={searchesDrill({
        id: `cit-pages:${part}:${row.key}`,
        title: what,
        description:
          part === 'win'
            ? 'Not cited yet, highest win odds first.'
            : 'Every search this line counts, in the latest checks.',
        searches,
        projectId,
        domain
      })}
    >
      {searches.length.toLocaleString('en-US')}
    </DrillButton>
  )
}

/**
 * Citations · Pages (the main view): every search of the project from the
 * pages side. Your pages with the searches each is cited for and still has to
 * win, the sites cited instead of you, and the searches that need no page.
 * Each count opens its searches; each page leads to its fix in What to fix.
 */
export function CitationPages({
  projectId,
  source
}: {
  projectId: string
  source: Pick<ProjectFixesSource, 'fixes:searches'>
}): JSX.Element {
  const searches = useProjectSearches(source, projectId)
  if (searches.error && searches.data === null) {
    return (
      <LoadError
        title="Could not load the searches."
        message={searches.error}
        onRetry={searches.reload}
      />
    )
  }
  if (searches.data === null) {
    return (
      <p role="status" className="muted">
        Loading the pages view…
      </p>
    )
  }
  return <PagesGrid data={searches.data} projectId={projectId} />
}

function PagesGrid({ data, projectId }: { data: ProjectSearches; projectId: string }): JSX.Element {
  const { rows, view } = useMemo(() => citationPages(data.searches), [data.searches])
  const domain = data.domain
  // Google AI Overview checks only: its logo holds the engine spot (audit #4).
  const engine = useEngineFilter(GOOGLE_ONLY)

  const columns: ListColumn<PagesRow>[] = [
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 260,
      sort: (row) => rowTitle(row).toLowerCase(),
      render: (row) => (
        <span className="cpg-name">
          {row.url ? (
            <UrlText url={row.url} label={pathOf(row.url)} site={domain} />
          ) : row.domain ? (
            <UrlText domain={row.domain} />
          ) : (
            <span className="cpg-lead">{rowTitle(row)}</span>
          )}
          {NOTE[row.kind] ? <span className="cpg-note">{NOTE[row.kind]}</span> : null}
        </span>
      )
    },
    {
      id: 'role',
      label: 'Role',
      width: 140,
      sort: (row) => row.kind,
      render: (row) =>
        row.kind === 'target' ? (
          <ResultChip result="cited" label="Target page" />
        ) : row.kind === 'other' ? (
          <ResultChip result="own_page" label="Your other page" />
        ) : row.kind === 'site' ? (
          <ResultChip result="not_cited" label="Other site" />
        ) : row.kind === 'noAio' ? (
          <ResultChip result="no_overview" label="No AI Overview" />
        ) : null
    },
    {
      id: 'cited',
      label: 'Cited for',
      hint: 'Searches whose AI Overview cites it',
      width: 104,
      numeric: true,
      sort: (row) => row.citedFor.length,
      render: (row) => count(row.citedFor, row, 'cited', projectId, domain)
    },
    {
      id: 'win',
      label: 'Still to win',
      hint: 'Searches aimed at it that cite no page of yours yet',
      width: 112,
      numeric: true,
      sort: (row) => row.toWin.length,
      render: (row) => count(row.toWin, row, 'win', projectId, domain)
    },
    {
      id: 'action',
      label: 'Action',
      hideLabel: true,
      width: 48,
      rowAction: true,
      render: (row) =>
        row.fixId === null ? null : (
          <IconButton
            size="sm"
            tip
            icon={row.kind === 'other' ? 'target' : 'file'}
            label={
              row.kind === 'other'
                ? 'Choose owner'
                : row.kind === 'new'
                  ? 'Get page brief'
                  : 'Get fix brief'
            }
            onClick={() => {
              if (row.fixId) openPageFix([row.fixId], { start: true })
            }}
          />
        )
    }
  ]

  const tree: ListTree<PagesRow> = {
    path: (row) => [{ key: row.section, label: SECTION_LABEL[row.section] }],
    order: SECTIONS,
    totalRow: false,
    renderGroup: (group) => <span className="cpg-section">{group.label}</span>
  }

  return (
    <ListGrid
      label="Pages"
      noun={['line', 'lines']}
      rows={rows}
      rowKey={(row) => row.key}
      rowLabel={rowTitle}
      columns={columns}
      urlKey="cpg"
      engine={engine.slot}
      tree={tree}
      search={{
        text: (row) => `${rowTitle(row)} ${row.url ?? ''}`,
        placeholder: 'Search pages and sites'
      }}
      summary={() => pagesFooter(view)}
      footer="always"
      empty={
        <EmptyState
          icon="search"
          title="No searches checked yet"
          body="Once a topic or page is checked, its searches show here by page."
        />
      }
    />
  )
}
