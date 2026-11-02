import type { JSX, ReactNode } from 'react'
import type { ChangeLedger } from '@shared/ipc'
import { DrillButton, DrillFigure } from '../drill'
import { BarFill, EmptyState, Panel } from '../ui'
import { pagesDrill } from './drills'
import { isPageCited, speedBars } from './model'

/**
 * "How fast changes get cited": one bar per days-live bucket over the newest change
 * on each page. The bar's height is the share of those pages cited in their latest
 * check; the bar opens every page in the bucket, cited ones counted in its strip.
 */
export function SpeedChart({
  ledger,
  actions
}: {
  ledger: ChangeLedger
  /** The panel's head actions, such as Pin to Summary. */
  actions?: ReactNode
}): JSX.Element {
  const bars = speedBars(ledger)
  if (bars.every((bar) => bar.rows.length === 0)) {
    return (
      <Panel title="How fast changes get cited" className="chg-speed" actions={actions}>
        <EmptyState
          icon="chart"
          compact
          title="No live changes yet."
          body="Once a logged change has gone live, this shows how soon Google cites those pages."
        />
      </Panel>
    )
  }
  return (
    <Panel title="How fast changes get cited" className="chg-speed" actions={actions}>
      <p className="muted chg-speed-line">
        The newest change on each page, by how long it has been live. Taller bars mean more of those
        pages are cited.
      </p>
      <ul className="chg-bars" aria-label="Share of changed pages cited, by days live">
        {bars.map((bar) => {
          const percent = Math.round(bar.share * 100)
          const drill = pagesDrill(
            ledger,
            bar.rows,
            {
              id: `speed:${bar.id}`,
              title: `Changes live ${bar.label}`,
              description: `${bar.cited.length} of these pages are cited in their latest check.`
            },
            {
              groupOf: (row) => (isPageCited(row) ? 'cited' : 'not_cited'),
              parts: [
                { label: 'Cited', group: 'cited' },
                { label: 'Not cited', group: 'not_cited' }
              ]
            }
          )
          return (
            <li key={bar.id} className="chg-bar-cell">
              <DrillButton drill={drill} className="chg-bar-btn">
                <span className="chg-bar-pct num" aria-hidden="true">
                  {bar.rows.length === 0 ? '—' : `${percent}%`}
                </span>
                <span className="chg-bar-col">
                  <BarFill share={bar.share} orientation="column" />
                </span>
                <span className="chg-bar-label">{bar.label}</span>{' '}
                <span className="chg-bar-sub num">
                  {bar.cited.length} of <DrillFigure drill={drill} />{' '}
                  {bar.rows.length === 1 ? 'page' : 'pages'} cited
                  <span className="sr-only">. Show the pages</span>
                </span>
              </DrillButton>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
