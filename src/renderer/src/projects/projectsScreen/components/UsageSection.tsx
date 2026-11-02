import type { JSX } from 'react'
import type {
  ApiKeyMetadata,
  ProjectSchedule,
  ProjectUsageReport,
  ProjectUsageRow
} from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { alertsHash, landingHash, sectionHash } from '../../../shell/routes'
import { EmptyState, ListGrid, type ListColumn } from '../../../ui'
import { settingsHeading } from '../utils/goTo'
import { SearchesPopover, type ProjectDrillActions } from './ProjectDrills'
import { usageNext } from '../../scoreCopy'
import {
  capCell,
  shareCell,
  sharedKeysSentence,
  sharedTotalCell,
  sourceLabel,
  totalSearches
} from '../utils/usageCopy'
import { labelWithText } from '../hooks/useTextLabel'

function n(value: number): string {
  return value.toLocaleString('en-US')
}

type UsageActions = ProjectDrillActions & { onOpen: (projectId: string) => Promise<void> }

function rowNote(row: ProjectUsageRow): string {
  return [
    sourceLabel(row),
    row.clientName ?? null,
    row.status === 'paused' ? 'Paused' : null,
    row.status === 'archived' ? 'Archived' : null
  ]
    .filter(Boolean)
    .join(' · ')
}

function usageColumns(
  scheduleById: ReadonlyMap<string, ProjectSchedule>,
  projectById: ReadonlyMap<string, ProjectDetail> | undefined,
  actions: UsageActions | undefined
): ListColumn<ProjectUsageRow>[] {
  const go = (row: ProjectUsageRow, hash: string, focusId?: string): void =>
    actions?.onGo(row.projectId, hash, focusId)
  return [
    {
      id: 'project',
      label: 'Project',
      width: 'fill',
      minWidth: 220,
      sort: (row) => row.name.toLowerCase(),
      render: (row) => (
        <span className="pj-name">
          {projectById?.get(row.projectId) && actions ? (
            <a
              className="page-title pj-title"
              href={landingHash()}
              aria-label={`Open ${row.name}`}
              onClick={(event) => {
                event.preventDefault()
                void actions.onOpen(row.projectId)
              }}
            >
              {row.name}
            </a>
          ) : (
            <span className="pj-title">{row.name}</span>
          )}
          <span className="faint pj-note">{rowNote(row)}</span>
        </span>
      )
    },
    {
      id: 'searches',
      label: 'Searches',
      width: 112,
      numeric: true,
      sort: (row) => row.searches,
      render: (row) => {
        const project = projectById?.get(row.projectId)
        return project && actions ? (
          <SearchesPopover
            project={project}
            used={row.searches}
            cap={row.cap}
            usage={row}
            actions={actions}
          >
            {n(row.searches)}
          </SearchesPopover>
        ) : (
          n(row.searches)
        )
      }
    },
    {
      id: 'cap',
      label: 'Cap',
      width: 150,
      numeric: true,
      sort: (row) => row.cap,
      render: (row) =>
        actions ? (
          <a
            href={sectionHash('project-settings')}
            aria-label={`Cap ${capCell(row)}: open search settings for ${row.name}`}
            onClick={(event) => {
              event.preventDefault()
              go(row, sectionHash('project-settings'), settingsHeading('ps-searches'))
            }}
          >
            {capCell(row)}
          </a>
        ) : (
          capCell(row)
        )
    },
    {
      id: 'share',
      label: 'Share of shared keys',
      width: 190,
      sort: (row) => (row.source === 'dedicated' ? null : row.sharePercent),
      render: (row) => (
        <span className="mini">
          <span className="bar usage-bar" aria-hidden="true">
            <span
              style={{ width: `${row.source === 'dedicated' ? 0 : (row.sharePercent ?? 0)}%` }}
            />
          </span>
          <span className="num">{shareCell(row)}</span>
        </span>
      )
    },
    {
      id: 'claude',
      label: 'AI calls',
      width: 180,
      sort: (row) => row.claudeCalls,
      render: (row) => (
        <span className="pj-name">
          <a
            className="num"
            href={sectionHash('connections')}
            aria-label={`${n(row.claudeCalls)} AI calls for ${row.name}: open Connections`}
          >
            {n(row.claudeCalls)}
          </a>
          <span className="faint pj-note">{row.claudeLabel}</span>
        </span>
      )
    },
    {
      id: 'next',
      label: 'Next check',
      width: 150,
      sort: (row) => scheduleById.get(row.projectId)?.nextCheckAt ?? null,
      render: (row) => {
        const text = usageNext(scheduleById.get(row.projectId))
        if (row.status === 'archived') return 'Archived'
        if (!actions) return text
        return (
          <a
            href={alertsHash('schedule')}
            aria-label={labelWithText(`Next check for ${row.name}: open Check timing`, text)}
            onClick={(event) => {
              event.preventDefault()
              go(row, alertsHash('schedule'))
            }}
          >
            {text}
          </a>
        )
      }
    }
  ]
}

/** The All projects total, in the grid's footer line. */
function TotalLine({ report }: { report: ProjectUsageReport }): JSX.Element {
  return (
    <span className="pj-total num">
      All projects:{' '}
      <a
        href={sectionHash('connections')}
        aria-label={`${n(totalSearches(report))} searches in all projects: open Connections`}
      >
        {n(totalSearches(report))}
      </a>{' '}
      searches · shared {sharedTotalCell(report)} ·{' '}
      <a
        href={sectionHash('connections')}
        aria-label={`${n(report.claudeCalls)} AI calls in all projects: open Connections`}
      >
        {n(report.claudeCalls)}
      </a>{' '}
      AI calls
    </span>
  )
}

/**
 * FR-10.6 Usage by project: searches this month, cap, share of the shared keys, Claude
 * calls, and next check. The All projects total sits in the footer line, and the line under
 * the grid says how much shared capacity no project cap has promised.
 */
export function UsageSection({
  report,
  error,
  keys,
  scheduleById,
  projectById,
  actions
}: {
  report: ProjectUsageReport | null
  error: string | null
  keys: readonly ApiKeyMetadata[]
  scheduleById: ReadonlyMap<string, ProjectSchedule>
  /** Rows of known projects drill: name opens it, numbers open their detail. */
  projectById?: ReadonlyMap<string, ProjectDetail>
  actions?: UsageActions
}): JSX.Element {
  const rows = report?.projects ?? []
  return (
    <section className="page-stack pj-usage" aria-labelledby="usage-h">
      <div className="pj-section-head">
        <div>
          <h2 id="usage-h" className="sr-only" tabIndex={-1}>
            Usage by project
          </h2>
          <p className="muted">
            This month so far. Each project draws from the shared keys up to its own cap, unless it
            has a key of its own.
          </p>
        </div>
        <a href={sectionHash('connections')}>Manage shared keys</a>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {report === null ? (
        error ? null : (
          <p role="status" className="muted">
            Loading usage…
          </p>
        )
      ) : (
        <>
          <ListGrid
            label="Usage by project this month"
            noun={['project', 'projects']}
            rows={rows}
            rowKey={(row) => row.projectId}
            rowLabel={(row) => row.name}
            columns={usageColumns(scheduleById, projectById, actions)}
            summary={() => <TotalLine report={report} />}
            empty={<EmptyState icon="inbox" title="No projects yet." />}
          />
          {rows.length > 0 ? (
            <p className="muted usage-note">{sharedKeysSentence(keys, report)}</p>
          ) : null}
        </>
      )}
    </section>
  )
}
