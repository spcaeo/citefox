import type { JSX } from 'react'
import type { ProjectUsageReport } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { alertsHash, pagesHash, sectionHash } from '../../../shell/routes'
import { NO_VALUE } from '../../copy'
import type { ProjectFilter } from '../../listModel'
import { glanceNext, glanceSearchLine, sharedKeyUsage, usedPercent } from '../../scoreCopy'
import type { ScoreBoard } from '../../useShellData'
import { nextProjectId } from '../utils/drills'
import { glanceUsageLine } from '../utils/usageCopy'
import { DrillPopover, PopoverList, type PopoverRow } from './DrillPopover'
import type { ProjectDrillActions } from './ProjectDrills'
import { labelWithText } from '../hooks/useTextLabel'
import { KpiStrip, KpiTile } from '../../../ui'
import { CITEFOX_USED_LABEL } from '../../../keys/serpUsage'

function n(value: number): string {
  return value.toLocaleString('en-US')
}

const STATUS_PARTS = [
  { status: 'active', word: 'Active', label: 'active' },
  { status: 'paused', word: 'Paused', label: 'paused' },
  { status: 'archived', word: 'Archived', label: 'archived' }
] as const

/**
 * "All projects at a glance" (FR-10.5): four equal KPI tiles. Every number opens what it counts:
 * the status parts filter the list, Pages tracked lists each project's pages,
 * Searches breaks down by project and key, and Next check opens that
 * project's schedule.
 */
export function GlanceStrip({
  projects,
  scores,
  report,
  actions,
  onFilter,
  onShowUsage
}: {
  projects: readonly ProjectDetail[]
  scores: ScoreBoard
  report: ProjectUsageReport | null
  actions: ProjectDrillActions
  /** Applies a status filter to the list below; null clears search and filters. */
  onFilter: (filter: ProjectFilter | null) => void
  /** Opens the Usage by project tab. */
  onShowUsage: () => void
}): JSX.Element {
  const totals = projects.reduce(
    (sum, project) => ({
      tracked: sum.tracked + project.trackedPageCount,
      found: sum.found + project.foundPageCount
    }),
    { tracked: 0, found: 0 }
  )
  const names = new Map(projects.map((project) => [project.id, project.name]))
  const next = scores.projects ? glanceNext(scores.projects, scores.schedules, names) : null
  const nextId = scores.projects ? nextProjectId(scores.projects, scores.schedules) : null
  const shared = scores.queue ? sharedKeyUsage(scores.queue) : null
  const parts = STATUS_PARTS.map((part) => ({
    ...part,
    count: projects.filter((project) => project.status === part.status).length
  })).filter((part) => part.status === 'active' || part.count > 0)

  const searchTotal = report ? report.sharedUsed + report.dedicatedUsed : 0

  return (
    <KpiStrip className="pj-kpis" label="All projects at a glance">
      <KpiTile
        label="Projects"
        value={
          <button
            type="button"
            className="drill-num glance-count"
            aria-label={`Show all ${n(projects.length)} projects`}
            onClick={() => onFilter(null)}
          >
            {n(projects.length)}
          </button>
        }
        sub={
          <span className="stat-sub">
            {parts.map((part, index) => (
              <span key={part.status}>
                {index > 0 ? ' · ' : ''}
                <button
                  type="button"
                  className="drill-num"
                  aria-label={`Show the ${part.count} ${part.label} projects`}
                  onClick={() => onFilter({ statuses: [part.word], clients: [] })}
                >
                  {part.count} {part.label}
                </button>
              </span>
            ))}
          </span>
        }
      />
      <KpiTile
        label="Pages tracked"
        value={
          <DrillPopover
            className="drill-num glance-count"
            label={`${n(totals.tracked)} pages tracked: show each project`}
            title="Pages tracked"
            subtitle={`${n(totals.tracked)} tracked of ${n(totals.found)} found`}
            body={(close) => (
              <>
                <PopoverList
                  close={close}
                  label="Pages tracked by project"
                  rows={projects.map((project): PopoverRow => ({
                    id: project.id,
                    label: project.name,
                    value: `${n(project.trackedPageCount)} of ${n(project.foundPageCount)}`,
                    detail: project.domain,
                    openLabel: `Open the ${n(project.trackedPageCount)} tracked pages of ${project.name}`,
                    onOpen: () => actions.onGo(project.id, pagesHash({ view: 'tracked' }))
                  }))}
                />
                <p className="dpop-total">
                  <span>All projects</span>
                  <span className="mono">
                    {n(totals.tracked)} of {n(totals.found)}
                  </span>
                </p>
              </>
            )}
          >
            {n(totals.tracked)}
          </DrillPopover>
        }
        sub={<span className="stat-sub">of {n(totals.found)} found</span>}
      />
      <KpiTile
        label={CITEFOX_USED_LABEL}
        value={
          scores.queue || report ? (
            <DrillPopover
              className="drill-num glance-count"
              label={`${CITEFOX_USED_LABEL}: show by project and by key`}
              title={CITEFOX_USED_LABEL}
              subtitle="By project, then by shared key"
              body={(close) => <SearchBreakdown scores={scores} report={report} close={close} />}
              foot={(close) => (
                <>
                  <button
                    type="button"
                    className="dpop-link"
                    onClick={() => {
                      close()
                      onShowUsage()
                    }}
                  >
                    Usage by project
                  </button>
                  <a href={sectionHash('connections')} onClick={close}>
                    Connections
                  </a>
                </>
              )}
            >
              {n(scores.queue ? (shared?.used ?? 0) : searchTotal)}
            </DrillPopover>
          ) : (
            NO_VALUE
          )
        }
        sub={
          scores.queue ? (
            <span className="pj-kpi-usage">
              <span>{glanceSearchLine(scores.queue)}</span>
              <span className="bar" aria-hidden="true">
                <span
                  style={{ width: `${usedPercent(shared?.used ?? 0, shared?.cap ?? null)}%` }}
                />
              </span>
            </span>
          ) : report ? (
            <span>{glanceUsageLine(report)}</span>
          ) : undefined
        }
      />
      <KpiTile
        label="Next check"
        className="pj-kpi-text"
        value={
          next ? (
            nextId ? (
              <a
                href={alertsHash('schedule')}
                aria-label={labelWithText('Next check: open Check timing', next.title)}
                onClick={(event) => {
                  event.preventDefault()
                  actions.onGo(nextId, alertsHash('schedule'))
                }}
              >
                {next.title}
              </a>
            ) : (
              <span>{next.title}</span>
            )
          ) : (
            NO_VALUE
          )
        }
        sub={next ? next.detail : undefined}
      />
    </KpiStrip>
  )
}

function SearchBreakdown({
  scores,
  report,
  close
}: {
  scores: ScoreBoard
  report: ProjectUsageReport | null
  close: () => void
}): JSX.Element {
  const byProject: PopoverRow[] = report
    ? report.projects.map((row) => ({
        id: row.projectId,
        label: row.name,
        value: n(row.searches),
        detail: row.source === 'dedicated' ? 'Own key' : 'Shared keys'
      }))
    : (scores.queue?.projects ?? []).map((row) => ({
        id: row.projectId,
        label: row.name,
        value: n(row.used),
        detail: row.dedicatedKeyId === null ? 'Shared keys' : 'Own key'
      }))
  const total = report
    ? report.projects.reduce((sum, row) => sum + row.searches, 0)
    : (scores.queue?.projects ?? []).reduce((sum, row) => sum + row.used, 0)
  const keys: PopoverRow[] = (scores.queue?.keys ?? [])
    .filter((key) => key.provider === 'serpapi')
    .map((key) => ({
      id: key.keyId,
      label: key.name,
      value: key.cap === null ? `${n(key.used)} · no cap` : `${n(key.used)} of ${n(key.cap)}`
    }))
  return (
    <>
      <PopoverList close={close} label="Searches by project" rows={byProject} />
      <p className="dpop-total">
        <span>All projects</span>
        <span className="mono">{n(total)}</span>
      </p>
      {keys.length > 0 ? (
        <PopoverList close={close} label="Searches by search key" rows={keys} />
      ) : null}
    </>
  )
}
