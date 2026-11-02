import { useMemo, type JSX } from 'react'
import { DrillFilters } from '../../drill/page/DrillFilters'
import { drillSummary } from '../../drill/page/model'
import { useDrillFilters } from '../../drill/page/useDrillFilters'
import { GroupHint } from '../GroupHint'
import { ListGrid } from '../listGrid'
import { SEARCH_COLUMNS, SEARCH_TREE, searches, type Search } from '../listGrid/tree/tree.fixtures'
import type { ListColumn, ListTree } from '../listGrid/types'
import { ResultBar } from '../ResultBar'
import { ResultChip } from '../ResultChip'
import {
  countResults,
  isResultBucket,
  resultBucket,
  RESULT_BUCKETS,
  type ResultBucket
} from '../resultTones'
import { useScreenView } from '../useScreenView'
import { ViewTabs } from '../ViewTabs'
import type { ScreenView } from '../viewTabsModel'

/*
 * The shared view parts on one page, for screenshots and as a usage example
 * (not routed in the app): the result bar, the view switcher, the tree grid,
 * the "What to do" line and a drill page. Data is the tree fixture.
 */

const VIEWS: readonly ScreenView[] = ['tree', 'grid', 'list', 'pages', 'progress']
const ROWS = searches(240)
const STAGE_IDS = new Map(ROWS.map((row) => [row.stage.toLowerCase(), row.stage]))

const DRILL_COLUMNS: ListColumn<Search>[] = [
  { id: 'n', label: '#', width: 64, sort: (row) => row.n, render: (row) => `Q${row.n}` },
  {
    id: 'text',
    label: 'Search',
    width: 'fill',
    sort: (row) => row.text,
    copy: (row) => row.text,
    render: (row) => row.text
  },
  {
    id: 'result',
    label: 'Result',
    width: 140,
    sort: (row) => row.result,
    render: (row) => (
      <ResultChip
        result={
          row.result === 'target' ? 'cited' : row.result === 'other_page' ? 'own_page' : row.result
        }
      />
    )
  },
  {
    id: 'odds',
    label: 'Win odds',
    width: 96,
    numeric: true,
    sort: (row) => row.odds,
    render: (row) => row.odds
  }
]

export function ViewsPlayground(): JSX.Element {
  const { view, setView, hrefFor } = useScreenView('playground', VIEWS, 'tree', {
    projectId: 'demo',
    store: null
  })
  const drill = useDrillFilters(['stage', 'result'] as const)
  const counts = useMemo(() => countResults(ROWS, (row) => row.result), [])

  const tree = useMemo<ListTree<Search>>(
    () => ({
      ...SEARCH_TREE,
      renderGroup: (group) => {
        const result = group.depth === 1 && isResultBucket(group.key) ? group.key : null
        const stage = group.path[0]?.toLowerCase() ?? null
        return (
          <span className="ui-lg-tree-label">
            {group.lead}
            {group.label}
            {result ? (
              <>
                <a
                  className="ui-drill-back"
                  href={drill.hrefWith({ stage, result })}
                  data-no-row-open=""
                >
                  Open all {group.rows.length} ›
                </a>
                &nbsp;&nbsp;
                <GroupHint result={result} nextCheckAt="2026-10-30T10:27:00.000Z" />
              </>
            ) : null}
          </span>
        )
      }
    }),
    [drill]
  )

  const stage = drill.values.stage ? (STAGE_IDS.get(drill.values.stage) ?? null) : null
  const result: ResultBucket | null = isResultBucket(drill.values.result)
    ? drill.values.result
    : null
  const drillRows = ROWS.filter(
    (row) => (stage === null || row.stage === stage) && (result === null || row.result === result)
  )

  return (
    <main className="views-playground" style={{ display: 'grid', gap: 16, padding: 24 }}>
      <h1 style={{ margin: 0 }}>Views playground</h1>
      <section className="ui-panel" style={{ padding: '16px 20px' }} aria-label="Topic results">
        <ResultBar
          counts={counts}
          size="header"
          label="240 searches"
          hrefFor={(key) => drill.hrefWith({ result: key, stage: null })}
        />
      </section>
      <section aria-label="Result chips" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ResultChip result="not_cited" />
        <ResultChip result="own_page" />
        <ResultChip result="cited" position={2} />
        <ResultChip result="no_overview" />
        {RESULT_BUCKETS.map((bucket) => (
          <ResultBar
            key={bucket.key}
            counts={{
              ...{ not_cited: 0, other_page: 0, target: 0, no_overview: 0 },
              [bucket.key]: 1
            }}
            label={resultBucket(bucket.key).label}
          />
        ))}
      </section>
      {drill.active ? (
        <>
          <GroupHint
            variant="block"
            {...(result ? { result } : {})}
            text="These buyers describe a broken alert. Add a short troubleshooting section to the target page."
          />
          <ListGrid<Search>
            label="Drilled searches"
            noun={['search', 'searches']}
            rows={drillRows}
            rowKey={(row) => row.id}
            rowLabel={(row) => `Q${row.n}`}
            columns={DRILL_COLUMNS}
            initialSort={[{ key: 'odds', dir: 'desc' }]}
            toolbar={
              <DrillFilters
                chips={[
                  ...(stage
                    ? [
                        {
                          name: 'stage',
                          label: `Stage: ${stage}`,
                          removeHref: drill.hrefWithout('stage')
                        }
                      ]
                    : []),
                  ...(result
                    ? [
                        {
                          name: 'result',
                          label: resultBucket(result).label,
                          result,
                          removeHref: drill.hrefWithout('result')
                        }
                      ]
                    : [])
                ]}
                backHref={drill.allHref}
                total={ROWS.length}
              />
            }
            pageSize="all"
            summary={drillSummary}
            empty={<p>No searches</p>}
          />
        </>
      ) : (
        <>
          <ViewTabs
            views={['list', 'tree', 'grid', 'pages']}
            trailing="progress"
            value={view}
            onChange={setView}
            hrefFor={hrefFor}
          />
          <ListGrid<Search>
            label="Searches"
            noun={['search', 'searches']}
            rows={ROWS}
            rowKey={(row) => row.id}
            rowLabel={(row) => `Q${row.n}`}
            columns={SEARCH_COLUMNS}
            tree={tree}
            urlKey="pg"
            columnsMenu
            search={{ text: (row) => row.text }}
            empty={<p>No searches</p>}
          />
        </>
      )}
    </main>
  )
}
