import { useMemo, type JSX } from 'react'
import type { MetricsResult } from '@shared/metrics'
import {
  CHANGE_TABS,
  changeTabs,
  inChangeTab,
  type ChangeTab,
  type QuestionItem,
  type ReviewReport
} from '@shared/report/review'
import { useQueryChoice } from '../../utils/queryState'
import { engineColumns, knownPagesOf, stripStats } from './drawerModel'
import { QuestionList } from './QuestionList'

/**
 * A question list inside a drawer: the strip (questions, answer shown, cited, brand
 * named, gap), change tabs with counts when two checks are compared, and the table with
 * brand named before → now, one column per engine under All engines and, for a site's
 * list, "You in the same answer".
 */
export function DrawerQuestions({
  report,
  metrics,
  rows,
  label,
  withYou = false,
  tabKey = 'rdt'
}: {
  report: ReviewReport
  metrics: MetricsResult
  rows: readonly QuestionItem[]
  label: string
  withYou?: boolean
  /** The URL key of the change tab: `rdt` in the first drawer, `rdt2` over it. */
  tabKey?: 'rdt' | 'rdt2'
}): JSX.Element {
  const [picked, setTab] = useQueryChoice<ChangeTab>(tabKey, CHANGE_TABS, 'all')
  const tabs = changeTabs(rows)
  // A pasted tab this list does not offer opens All.
  const tab = tabs.some((item) => item.id === picked) ? picked : 'all'
  const shown = tabs.length === 0 ? rows : rows.filter((row) => inChangeTab(row.change, tab))
  const known = useMemo(() => knownPagesOf(report), [report])
  return (
    <>
      <div className="rv-dstats" data-testid="rv-dstats">
        {stripStats(rows).map((stat) => (
          <span key={stat.label}>
            <b className="num">{stat.value}</b> {stat.label}
          </span>
        ))}
      </div>
      {tabs.length > 0 ? (
        <div className="rv-chips" role="group" aria-label="Change" data-testid="rv-dtabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === tab}
              className={item.id === tab ? 'on' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              <em className="num">{item.count}</em>
            </button>
          ))}
        </div>
      ) : null}
      <QuestionList
        rows={shown}
        fromLabel={report.fromLabel}
        toLabel={report.toLabel}
        label={label}
        options={{
          named: true,
          withYou,
          knownPages: known,
          engines: engineColumns(report, metrics, shown)
        }}
      />
    </>
  )
}
