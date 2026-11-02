import { useMemo, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Drawer, ListGrid, ResultDot, resultBucket, UiIcon } from '../../../ui'
import { drillChips, isDrill, withoutKey, type SearchFilter } from '../model'
import type { ViewEnv } from '../types'
import { searchColumns } from './columns'
import { drillModel } from './drillModel'

/**
 * The searches behind a count (TopicBigDrill), in a drawer over the view it came from
 * (`drawer=search-drill&stage=problem&result=not_cited`), so the Grid, Tree or Pages stays
 * as it was behind it: the "What to do" card, the filter chips (each with ✕), and the
 * filtered list sorted by win odds. Clicking a row opens its question; Get fix brief for
 * these N is the footer's button, and closing returns to the view.
 */
export function SearchesDrawer({
  env,
  filter,
  where,
  sourceName,
  listName,
  onClose
}: {
  env: ViewEnv
  filter: SearchFilter
  /** After "14 of 240 searches": " in Nagios alerts · checked Oct 29, 10:27 AM". */
  where: string
  sourceName?: (id: string) => string
  /** What the list is in, for its accessible name ("Nagios alerts: Problem searches …"). */
  listName: string
  onClose: () => void
}): JSX.Element {
  const model = useMemo(() => drillModel(env, filter), [env, filter])
  const count = model.rows.length
  const chips = drillChips(filter, sourceName, env.words)
  const columns = useMemo(
    () =>
      searchColumns({
        site: env.site,
        source: env.questionsScreen ?? false,
        drop: [
          ...(filter.result ? (['result'] as const) : []),
          ...(filter.stage ? (['stage'] as const) : []),
          ...(filter.kind ? (['type'] as const) : [])
        ],
        citedLabel:
          filter.result === 'not_cited'
            ? 'Cited instead'
            : `Page ${env.words.engine ?? 'Google'} cited`
      }),
    [env.site, env.questionsScreen, env.words.engine, filter]
  )
  const toolbar: ReactNode = (
    <div className="ui-drill-filters">
      {chips.map((chip) => {
        const rest = withoutKey(filter, chip.key)
        const name = `Remove filter ${chip.label}`
        return (
          <span key={chip.key} className="ui-fchip" data-result={chip.result}>
            {chip.result && chip.result !== 'not_checked' ? (
              <ResultDot result={chip.result} />
            ) : null}
            {chip.label}
            {/* The last filter's ✕ is Close: no filter left is the view itself. */}
            {isDrill(rest) ? (
              <a className="ui-fchip-remove" href={env.drillHref(rest)} aria-label={name}>
                <UiIcon name="x" size={14} />
              </a>
            ) : (
              <button type="button" className="ui-fchip-remove" aria-label={name} onClick={onClose}>
                <UiIcon name="x" size={14} />
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
  return (
    <Drawer
      id="search-drill"
      title={model.title}
      subtitle={`${count.toLocaleString('en-US')} of ${model.total.toLocaleString('en-US')} searches${where}`}
      onClose={onClose}
      focusOnOpen="close"
      testId="search-drill"
      footer={{
        cancel: 'Close',
        primary: {
          label: `Get fix brief for ${count === 1 ? 'this one' : `these ${count}`}`,
          disabled: count === 0,
          onClick: () => env.openBrief(model.rows)
        }
      }}
    >
      <div className="tv-stack">
        <p
          className="ui-group-hint-block"
          style={
            filter.result && filter.result !== 'not_checked'
              ? ({ '--hint-colour': resultBucket(filter.result).colour } as CSSProperties)
              : undefined
          }
        >
          <b>What to do:</b> {model.whatToDo}
        </p>
        <ListGrid
          label={`${listName}: ${model.title}`}
          engine={env.engine}
          noun={['search', 'searches']}
          rows={model.rows}
          rowKey={(row) => row.id}
          rowLabel={(row) => `${row.ref} ${row.text}`}
          columns={columns}
          toolbar={toolbar}
          initialSort={[{ key: 'odds', dir: 'desc' }]}
          onActivate={env.openSearch}
          summary={(info) =>
            `${info.matching === info.total ? `Showing all ${info.total}` : `Showing ${info.matching} of ${info.total}`} · Click a search to see Google's answer and the pages it cites`
          }
          empty={<p className="tv-empty">No searches match these filters.</p>}
        />
      </div>
    </Drawer>
  )
}
