import type { JSX } from 'react'
import { DrillButton, DrillNumber } from '../../drill'
import { CITEFOX_USED_LABEL, serpKeysDrill } from '../../keys/serpUsage'
import { readinessText } from '@shared/permissions/readiness'
import { useReadiness } from '../../permissions/useReadiness'
import { KpiStrip, KpiTile } from '../../ui'
import type { StatusData } from '../types'
import { dueDrill, issuesDrill, jobsDrill, projectNames } from '../utils/drills'
import { count, usagePace } from '../utils/model'

/**
 * The four summary tiles (FR-24.1), a row of equal v2 KPI tiles. Every number
 * opens what it counts: searches left opens the keys (their Left column adds
 * up to it), open issues the connections with a warning, the checks tile the
 * running checks and the pages due. The month tile is this month's pace.
 */
export function StatusKpis({ data, now }: { data: StatusData; now: Date }): JSX.Element {
  const names = projectNames(data.projects)
  const keys = data.overview?.keys ?? []
  const left = data.capsule?.searchesLeft ?? null
  const ready = useReadiness(data.capsule ?? null)
  const issues = ready ? issuesDrill(ready, data.overview, keys) : null
  const jobs = data.jobs ? jobsDrill(data.jobs, names) : null
  const due = data.due ? dueDrill(data.due, names) : null
  const pace = data.queue ? usagePace(data.queue, now) : null
  return (
    <KpiStrip className="st-kpis" label="Summary">
      <KpiTile
        className="sts-kpi"
        label="Searches left"
        value={
          left === null ? (
            '—'
          ) : (
            <DrillButton
              drill={serpKeysDrill(keys, { id: 'serp:left', title: 'Searches left' })}
              className="drill-num"
              label={`${count(left)} searches left: show each key`}
              untracked
            >
              {count(left)}
            </DrillButton>
          )
        }
        sub="SerpApi account limits minus used, enabled keys"
      />
      <KpiTile
        className="sts-kpi"
        label="Open issues"
        value={
          issues ? (
            <DrillNumber
              drill={issues}
              label={`${issues.items.length} open ${issues.items.length === 1 ? 'issue' : 'issues'}: show them`}
            />
          ) : (
            '—'
          )
        }
        sub={ready ? readinessText(ready) : 'Required setup steps and connection warnings'}
      />
      <KpiTile
        className="sts-kpi"
        label="Checks running"
        value={
          jobs ? (
            <DrillNumber
              drill={jobs}
              label={`${jobs.items.length} running: show the running checks`}
            />
          ) : data.queue ? (
            String(data.queue.running)
          ) : (
            '—'
          )
        }

        sub={
          <>
            {data.queue ? (
              <>
                {due ? (
                  <DrillButton
                    drill={due}
                    className="m3-link"
                    label={`${data.queue.waiting} waiting in the queue: show the pages due`}
                    untracked
                  >
                    {data.queue.waiting} waiting
                  </DrillButton>
                ) : (
                  `${data.queue.waiting} waiting`
                )}
                {' · '}
              </>
            ) : null}
            {due ? (
              <DrillNumber
                drill={due}
                className="m3-link"
                suffix={due.items.length === 1 ? ' page due' : ' pages due'}
                label={`${due.items.length} ${due.items.length === 1 ? 'page' : 'pages'} due: show them`}
              />
            ) : data.queue ? (
              `${data.queue.pagesDue} ${data.queue.pagesDue === 1 ? 'page' : 'pages'} due`
            ) : (
              'Queue not read'
            )}
          </>
        }
      />
      <KpiTile
        className="sts-kpi"
        label={CITEFOX_USED_LABEL}
        value={pace ? count(pace.used) : '—'}
        suffix={
          pace ? `in ${pace.dayOfMonth} ${pace.dayOfMonth === 1 ? 'day' : 'days'}` : undefined
        }
        sub={
          pace
            ? `About ${count(pace.projected)} by ${pace.monthEnd} at this pace`
            : 'Queue not read'
        }
      />
    </KpiStrip>
  )
}
