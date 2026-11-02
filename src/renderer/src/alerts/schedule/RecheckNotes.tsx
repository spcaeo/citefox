import { Fragment, useEffect, useState, type JSX } from 'react'
import type { DueList, ProjectSchedule } from '@shared/domain'
import { projectSettingsLink } from '../../connections/utils/projectLinks'
import { DrillLink, DrillNumber } from '../../drill'
import type { AlertsClient } from '../client'
import { duePagesDrill } from '../drills'
import {
  nextCheckParts,
  PROJECT_NOTE_LEAD,
  projectCadence,
  projectScheduleNote,
  type ProjectScheduleRow
} from '../model'

/**
 * "Next check: Today 09:00 · 14 pages due". Once the due list loads, the count
 * is the list's own length and opens it, so the drawer always matches.
 */
export function NextCheckLine({
  client,
  project,
  projectName,
  now,
  timeZone
}: {
  client: AlertsClient
  project: ProjectSchedule
  projectName: string
  now: Date
  timeZone: string
}): JSX.Element {
  const [due, setDue] = useState<{ key: string; list: DueList } | null>(null)
  const parts = nextCheckParts({
    paused: project.paused,
    intervalDays: project.defaultIntervalDays,
    nextCheckAt: project.nextCheckAt,
    pagesDueToday: project.pagesDueToday,
    now,
    timeZone
  })
  const scheduled = !('text' in parts)
  const key = `${project.projectId}\0${project.nextCheckAt ?? ''}\0${project.pagesDueToday}`

  useEffect(() => {
    if (!scheduled) return
    let cancelled = false
    void client.listDue({ projectId: project.projectId }).then((result) => {
      if (!cancelled && result.value) setDue({ key, list: result.value })
    })
    return () => {
      cancelled = true
    }
  }, [client, project.projectId, key, scheduled])

  if ('text' in parts) {
    return (
      <p>
        <span className="faint">Next check:</span> <strong>{parts.text}</strong>
      </p>
    )
  }
  const list = due && due.key === key ? due.list : null
  const count = list ? list.pages.length : parts.due
  const noun = count === 1 ? 'page' : 'pages'
  return (
    <p>
      <span className="faint">Next check:</span>{' '}
      <strong>
        {parts.when} ·{' '}
        {list ? (
          <DrillNumber
            drill={duePagesDrill(list, projectName)}
            label={`${count} ${noun} due at the next check: list them`}
          />
        ) : (
          count.toLocaleString('en-US')
        )}{' '}
        {noun} due{parts.tail}
      </strong>
    </p>
  )
}

/** The cadence note, with each project's name linking to its settings. */
export function ProjectNote({
  rows,
  activeProjectId
}: {
  rows: readonly ProjectScheduleRow[]
  activeProjectId: string | null
}): JSX.Element {
  if (rows.length === 0) return <>{projectScheduleNote(rows)}</>
  return (
    <>
      {PROJECT_NOTE_LEAD}
      {rows.map((row, index) => {
        const link = projectSettingsLink(
          { id: row.projectId, name: row.name },
          activeProjectId,
          'Schedule'
        )
        return (
          <Fragment key={row.projectId}>
            {index > 0 ? ', ' : null}
            <DrillLink target={link.target} label={link.label}>
              {row.name}
            </DrillLink>{' '}
            {projectCadence(row)}
          </Fragment>
        )
      })}
      .
    </>
  )
}
