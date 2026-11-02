import type { JSX } from 'react'
import { pluralWord } from '@shared/pluralize'
import type { AllPagesData } from '@shared/ipc'
import { DrillButton, DrillFigure, drillCount, type ItemDrill } from '../../drill'
import { NO_VALUE } from '../../projects/copy'
import { searchesLine, usedPercent } from '../../projects/scoreCopy'
import { pagesHash, sectionHash } from '../../shell/routes'
import { KpiStrip, KpiTile } from '../../ui'

/**
 * FR-20.2 as a row of equal v2 KPI tiles: pages found and tracked, searches
 * this month and left, and pages due today. Every number opens what it
 * counts: the page counts filter the list below, searches open Project
 * settings and Connections, and Due today opens the pages the scheduler runs.
 */
export function Tiles({
  data,
  paused,
  due,
  onShowGrid
}: {
  data: AllPagesData | null
  paused: boolean
  /** Pages due today from `schedule:listDue`. Null while loading or when it failed. */
  due: ItemDrill | null
  /** Scrolls to the list after a page-count link filters it. */
  onShowGrid: () => void
}): JSX.Element {
  const found = data?.foundPageCount ?? 0
  const tracked = data?.trackedPageCount ?? 0
  const notTracked = Math.max(0, found - tracked)
  const summary = data?.summary ?? null
  const count = (value: number): string => value.toLocaleString('en-US')
  const dueCount = due ? drillCount(due) : null
  return (
    <KpiStrip className="ap-kpis" label="Summary">
      <KpiTile
        label="Pages found"
        value={
          data ? (
            <a
              href={pagesHash({ view: 'all' })}
              aria-label={`${count(found)} pages: show all pages`}
              onClick={onShowGrid}
            >
              {count(found)}
            </a>
          ) : (
            NO_VALUE
          )
        }
        sub={
          <>
            <a
              className="ap-sub-link"
              href={pagesHash({ view: 'tracked' })}
              aria-label={`${count(tracked)} tracked: show the tracked pages`}
              onClick={onShowGrid}
            >
              {count(tracked)} tracked
            </a>
            {' · '}
            <a
              className="ap-sub-link"
              href={pagesHash({ view: 'untracked' })}
              aria-label={`${count(notTracked)} found, not tracked: show them`}
              onClick={onShowGrid}
            >
              {count(notTracked)} found, not tracked
            </a>
          </>
        }
      />
      <KpiTile
        label="Searches this month"
        value={
          summary ? (
            <a
              href={sectionHash('project-settings')}
              aria-label={`${searchesLine(summary.searchesUsed, summary.searchCap)} searches used this month: open Project settings`}
            >
              {count(summary.searchesUsed)}
            </a>
          ) : (
            NO_VALUE
          )
        }
        suffix={
          summary
            ? summary.searchCap === null
              ? 'no cap'
              : `of ${count(summary.searchCap)}`
            : undefined
        }
        {...(summary
          ? {
              goal: {
                value: usedPercent(summary.searchesUsed, summary.searchCap),
                valueLabel: `${searchesLine(summary.searchesUsed, summary.searchCap)} searches used this month`
              }
            }
          : {})}
        sub={
          summary ? (
            data?.searchesLeft === null || data?.searchesLeft === undefined ? (
              'Searches left: not known yet'
            ) : (
              <a
                className="ap-sub-link"
                href={sectionHash('connections')}
                aria-label={`${count(data.searchesLeft)} left this month: open Connections`}
              >
                {count(data.searchesLeft)} left this month
              </a>
            )
          ) : undefined
        }
      />
      <KpiTile
        label="Due today"
        value={
          paused ? (
            'Paused'
          ) : due && dueCount !== null ? (
            <DrillButton
              drill={due}
              className="drill-num"
              label={`${count(dueCount)} ${pluralWord(dueCount, 'page')} due today: show them`}
            >
              <DrillFigure drill={due} />
            </DrillButton>
          ) : summary ? (
            count(summary.pagesDueToday)
          ) : (
            NO_VALUE
          )
        }
        suffix={
          paused
            ? undefined
            : dueCount !== null
              ? pluralWord(dueCount, 'page')
              : summary
                ? pluralWord(summary.pagesDueToday, 'page')
                : undefined
        }
        sub={
          paused ? (
            'Checks wait until this project resumes'
          ) : due ? (
            <a className="ap-sub-link" href={sectionHash('check')}>
              Check now
            </a>
          ) : undefined
        }
      />
    </KpiStrip>
  )
}
