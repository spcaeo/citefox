import { useMemo, type JSX } from 'react'
import type { Market } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { useAiContext } from '../assistant/context/useAiContext'
import { useAddCompetitor } from '../competitors/hooks/useAddCompetitor'
import { LoadError } from '../components/LoadError'
import { openDrawer } from '../shell/drawers'
import { formatSort, parseSort, useQueryState, writeQuery } from '../utils/queryState'
import { CitedGrid } from './components/CitedGrid'
import { useCitedPages } from './hooks/useCitedPages'
import {
  CITED_QUERY,
  listRows,
  rowName,
  viewFrom,
  whoseCounts,
  whoseFrom,
  whoseText,
  type CitedListRow,
  type CitedView,
  type WhoseFilter
} from './model'
import type { CitationsSource } from './source'
import './citations.css'

/**
 * The main part of the project Citations screen: every page Google's AI Overviews
 * cite in the latest check of each tracked page and topic, in each market, and
 * whose it is. Pages or Domains, the Whose filter, search, sort and the open row
 * are all in the URL. Its numbers open drills, so a DrillHost must be above it.
 */
export function CitedPages({
  projectId,
  brand,
  markets,
  source
}: {
  projectId: string
  brand: string
  markets: ReadonlyMap<string, Market>
  source: CitationsSource
}): JSX.Element {
  const state = useCitedPages(source, projectId)
  const adder = useAddCompetitor(source, projectId, null, state.reload)
  const [byValue] = useQueryState(CITED_QUERY.by)
  const [whoseValue] = useQueryState(CITED_QUERY.whose)
  const [search] = useQueryState(CITED_QUERY.search)
  const [sortValue] = useQueryState(CITED_QUERY.sort)
  const [openId] = useQueryState(CITED_QUERY.open)
  const view = viewFrom(byValue)
  const whose = whoseFrom(whoseValue)
  const sort = useMemo(() => parseSort(sortValue), [sortValue])
  const data = state.data
  const rows = useMemo(() => (data ? listRows(data.rows, view) : []), [data, view])
  const open = rows.find((row) => row.id === openId) ?? null
  const counts = whoseCounts(rows)
  useAiContext({
    entities: open ? [aiRef(open)] : [],
    filters: {
      show: view,
      ...(whose === 'all' ? {} : { whose }),
      ...(search ? { search } : {})
    },
    numbers: data
      ? [
          {
            label: view === 'domains' ? 'Domains cited' : 'Pages cited',
            value: String(counts.all)
          },
          { label: 'Yours', value: String(counts.yours) },
          { label: 'Competitors', value: String(counts.competitor) },
          { label: 'Others', value: String(counts.other) },
          { label: 'Searches with an AI Overview', value: String(data.questions) }
        ]
      : []
  })

  function setView(next: CitedView): void {
    // The two views have different columns and rows: start each fresh.
    writeQuery(
      {
        [CITED_QUERY.by]: next === 'pages' ? null : next,
        [CITED_QUERY.sort]: null,
        [CITED_QUERY.open]: null
      },
      'push'
    )
  }

  function add(row: CitedListRow): void {
    void adder.add({ id: row.id, name: row.domain, domain: row.domain })
  }

  if (state.error) {
    return (
      <LoadError
        title="Could not load the cited pages."
        message={state.error}
        onRetry={state.reload}
      />
    )
  }
  if (data === null) {
    return (
      <p role="status" className="muted">
        Loading cited pages…
      </p>
    )
  }
  return (
    <div className="cit-part" aria-busy={state.loading || undefined}>
      {adder.error ? (
        <p className="bridge-alert" role="alert">
          {adder.error}
        </p>
      ) : null}
      <CitedGrid
        rows={rows}
        brand={brand}
        view={view}
        whose={whose}
        search={search ?? ''}
        sort={sort}
        openId={open?.id ?? null}
        saving={adder.saving}
        drillScope={{ brand, domain: data.ownDomain, markets }}
        onView={setView}
        onWhose={(next: WhoseFilter) =>
          writeQuery({ [CITED_QUERY.whose]: next === 'all' ? null : next }, 'push')
        }
        onSearch={(value) => writeQuery({ [CITED_QUERY.search]: value || null })}
        onSort={(next) => writeQuery({ [CITED_QUERY.sort]: formatSort(next) })}
        onOpen={(id) => writeQuery({ [CITED_QUERY.open]: id }, 'push')}
        onAddCompetitor={add}
        onPitch={(row, question) =>
          openDrawer('pitch', {
            'pitch.row': row.id,
            'pitch.page': question.pageId,
            'pitch.prompt': question.promptId
          })
        }
      />
    </div>
  )
}

/** The open row as Ask CiteFox names it. */
function aiRef(row: CitedListRow): { kind: 'domain'; id: string; label: string; detail: string } {
  return {
    kind: 'domain',
    id: row.id,
    label: row.url ?? row.domain,
    detail: `${whoseText(row)} · ${pluralize(row.overviews.length, 'AI Overview')} · ${pluralize(row.questions.length, 'search', 'searches')} · ${rowName(row)}`
  }
}
