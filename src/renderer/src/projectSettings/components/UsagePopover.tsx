import { useEffect, useState, type JSX } from 'react'
import type { ProjectUsageRow } from '@shared/domain'
import type { ProjectSettingsView } from '@shared/ipc'
import type { AdminClient } from '../../admin/client'
import { DrillPopover, PopoverList } from '../../projects/projectsScreen/components/DrillPopover'
import { searchRows } from '../../projects/projectsScreen/utils/drills'
import { sectionHash } from '../../shell/routes'
import { paceLine, usageLine, usagePercent } from '../utils/model'

/**
 * "Used this month": the bar opens where the searches came from (shared or
 * own key), the cap, the share of the shared keys, and Claude calls.
 */
export function UsagePopover({
  view,
  admin
}: {
  view: ProjectSettingsView
  admin: AdminClient
}): JSX.Element {
  const line = usageLine(view.usage)
  return (
    <div className="field">
      <span className="field-label">Used this month</span>
      <DrillPopover
        className="dpop-block"
        label={`${line} searches used this month: show the breakdown`}
        title="Searches this month"
        subtitle={view.project.name}
        body={(close) => <UsageBody view={view} admin={admin} close={close} />}
        foot={(close) => (
          <a href={sectionHash('connections')} onClick={close}>
            Connections
          </a>
        )}
      >
        <span className="usage">
          <span className="bar" aria-hidden="true">
            <span style={{ width: `${usagePercent(view.usage)}%` }} />
          </span>
          <span className="mono faint">{line}</span>
        </span>
      </DrillPopover>
    </div>
  )
}

function UsageBody({
  view,
  admin,
  close
}: {
  view: ProjectSettingsView
  admin: AdminClient
  close: () => void
}): JSX.Element {
  const [row, setRow] = useState<ProjectUsageRow | null | undefined>(undefined)
  const projectId = view.project.id
  useEffect(() => {
    let live = true
    admin.projectUsage().then(
      (report) => {
        if (live) setRow(report.projects.find((item) => item.projectId === projectId) ?? null)
      },
      () => {
        if (live) setRow(null)
      }
    )
    return () => {
      live = false
    }
  }, [admin, projectId])
  const pace = paceLine(view.usage)
  return (
    <>
      {row === undefined ? <p role="status">Loading usage…</p> : null}
      <PopoverList
        close={close}
        label="Searches this month"
        rows={searchRows(view.usage.used, view.usage.allowance, row ?? undefined)}
      />
      {pace ? <p className="faint">{pace}</p> : null}
    </>
  )
}
