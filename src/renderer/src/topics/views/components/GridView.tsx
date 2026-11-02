import { useMemo, type JSX } from 'react'
import { Button, Panel, ResultDot, SegmentedControl, UrlText } from '../../../ui'
import {
  bestNextMove,
  pagesView,
  pathOf,
  resultLabel,
  sourceGrid,
  stageGrid,
  filterSearches,
  type Grid,
  type GridRow
} from '../model'
import type { ViewEnv } from '../types'
import { CountLink, TargetPctLink } from './cells'
import { kindFilter, kindMatches } from './kindFilter'

function GridLine({
  row,
  env,
  total
}: {
  row: GridRow
  env: ViewEnv
  total?: boolean
}): JSX.Element {
  const Cell = total ? 'th' : 'td'
  return (
    <tr className={total ? 'tv-grid-all' : undefined}>
      <th scope="row" className="tv-grid-name">
        {row.label}
        {row.hint ? <span className="tv-muted"> {row.hint}</span> : null}
      </th>
      <Cell className="num">
        <CountLink
          count={row.totals.searches}
          filter={row.filter}
          drillHref={env.drillHref}
          label={`${row.label}: open these ${row.totals.searches} searches`}
        />
      </Cell>
      {row.cells.map((cell) => (
        <Cell key={cell.result} className="tv-grid-cell num" data-result={cell.result}>
          <CountLink
            count={cell.count}
            filter={cell.filter}
            drillHref={env.drillHref}
            label={`${row.label} · ${resultLabel(cell.result, env.words)}: open these ${cell.count} searches`}
            className="tv-grid-count"
          />
        </Cell>
      ))}
      <Cell className="num">
        <TargetPctLink
          totals={row.totals}
          filter={row.filter}
          drillHref={env.drillHref}
          label={row.label}
        />
      </Cell>
      <Cell className="num">
        <CountLink
          count={row.totals.needsWork}
          filter={{ ...row.filter, work: true }}
          drillHref={env.drillHref}
          label={`${row.label} · Needs work: open these ${row.totals.needsWork} searches`}
        />
      </Cell>
    </tr>
  )
}

function GridTable({ grid, env, by }: { grid: Grid; env: ViewEnv; by: string }): JSX.Element {
  return (
    <table className="tv-grid">
      <thead>
        <tr>
          <th scope="col">{by}</th>
          <th scope="col" className="num">
            Searches
          </th>
          {grid.results.map((result) => (
            <th key={result} scope="col" className="tv-grid-head num">
              {result === 'not_checked' ? null : <ResultDot result={result} />}
              {resultLabel(result, env.words)}
            </th>
          ))}
          <th scope="col" className="num">
            Target cited
          </th>
          <th scope="col" className="num">
            Needs work
          </th>
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((row) => (
          <GridLine key={row.id} row={row} env={env} />
        ))}
      </tbody>
      <tfoot>
        <GridLine row={grid.all} env={env} total />
      </tfoot>
    </table>
  )
}

/**
 * The Grid view (TopicMatrix): stage × result counts, every number opens its drill;
 * then where your pages are cited, who is cited instead, and the best next move.
 * The Questions screen shows topic × result instead.
 */
export function GridView({ env }: { env: ViewEnv }): JSX.Element {
  const searches = useMemo(
    () => env.searches.filter((search) => kindMatches(search, env.type)),
    [env.searches, env.type]
  )
  const grid = useMemo(
    () => (env.questionsScreen ? sourceGrid(searches) : stageGrid(searches)),
    [searches, env.questionsScreen]
  )
  const pages = useMemo(() => pagesView(searches), [searches])
  const move = bestNextMove(grid, searches)
  const segment = kindFilter(env)
  const own = pages.pages.filter((page) => page.url !== null && page.citedFor > 0).slice(0, 5)
  return (
    <div className="tv-stack">
      <Panel
        title={
          env.questionsScreen ? 'Where you stand, by topic' : 'Where you stand, by buyer stage'
        }
        titleAs="h2"
        actions={
          <>
            {env.engine?.control}
            <SegmentedControl
              size="sm"
              label={segment.label}
              options={segment.options}
              value={segment.value}
              onChange={segment.onChange}
            />
          </>
        }
      >
        <div className="tv-grid-wrap">
          <GridTable grid={grid} env={env} by={env.questionsScreen ? 'Topic or page' : 'Stage'} />
        </div>
      </Panel>
      <div className="tv-cards">
        <Panel title={`Your pages ${env.engineName ?? 'Google'} cites here`} titleAs="h3">
          {own.length === 0 ? (
            <p className="tv-muted">None yet.</p>
          ) : (
            <ul className="tv-card-list">
              {own.map((page) => (
                <li key={page.url}>
                  <UrlText path={pathOf(page.url ?? '')} site={env.site} icon={false} />
                  {page.role === 'target' ? <span className="tv-muted">target</span> : null}
                  <CountLink
                    count={page.citedFor}
                    filter={page.filter}
                    drillHref={env.drillHref}
                    label={`${pathOf(page.url ?? '')}: open these ${page.citedFor} searches`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Cited instead of you" titleAs="h3">
          {pages.sites.length === 0 ? (
            <p className="tv-muted">No other site yet.</p>
          ) : (
            <ul className="tv-card-list">
              {pages.sites.slice(0, 5).map((site) => (
                <li key={site.domain}>
                  <UrlText domain={site.domain} />
                  <CountLink
                    count={site.searches}
                    filter={site.filter}
                    drillHref={env.drillHref}
                    label={`${site.domain}: open these ${site.searches} searches`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Best next move" titleAs="h3" className="tv-next">
          {move ? (
            <>
              <p>
                {move.label} · Not cited: {move.count} {move.count === 1 ? 'search' : 'searches'}
                {move.winAvg === null ? '' : `, average win odds ${move.winAvg}`}. One update to the
                target page can win most of them.
              </p>
              <Button
                size="sm"
                onClick={() => env.openBrief(filterSearches(searches, move.filter))}
              >
                Get fix brief
              </Button>
            </>
          ) : (
            <p className="tv-muted">Nothing needs work right now.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}
