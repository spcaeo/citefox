import { useEffect, useState, type JSX } from 'react'
import type { DueList, ProjectSchedule } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { alertsHash, pageHash, sectionHash, topicHash } from '../../shell/routes'
import { Panel, UrlText } from '../../ui'
import type { AlertView, AlertsClient } from '../client'
import { wallClock } from '../model'

/** The most pages the Next re-checks box lists before "and N more". */
const NEXT_SHOWN = 6

function dueDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(
    new Date(iso)
  )
}

/**
 * Notifications' right column: what an alert looks like when it arrives, where the
 * exact triggers are set (Alert rules), and where scheduled report emails live.
 */
export function SampleAlertPanel({
  alerts,
  projectName
}: {
  alerts: AlertView
  projectName: string
}): JSX.Element {
  const routes = [
    alerts.desktop ? 'a desktop notification' : null,
    alerts.emailAfterCheck && alerts.emailTo.length > 0
      ? pluralize(alerts.emailTo.length, 'email')
      : null,
    alerts.slackEnabled && alerts.slackWebhookStored ? 'a Slack post' : null
  ].filter((item): item is string => item !== null)
  return (
    <Panel title="What you will get" titleAs="h3" tone="inset" padding={20} className="nt-sample">
      <div className="nt-sample-card" aria-label="Sample alert">
        <p className="nt-sample-from">
          <strong>CiteFox</strong>
          <span className="faint">after the {wallClock('09:00')} check</span>
        </p>
        <p className="nt-sample-title">{projectName}: Pricing, target page no longer cited</p>
        <p className="nt-sample-body">
          Target page no longer cited on 2 questions in United States: “best sms api for small
          business”, “cheap twilio alternative”.
        </p>
      </div>
      <p className="hint">
        {routes.length > 0
          ? `Right now each check sends ${routes.join(', ')}.`
          : 'Right now nothing is sent after a check. Turn on a switch on the left.'}{' '}
        To hear only about the changes that matter, set up{' '}
        <a href={alertsHash('rules')}>Alert rules</a>.
      </p>
      <p className="hint" data-testid="reports-link">
        Scheduled report emails are in <a href={sectionHash('reports')}>Reports</a>.
      </p>
    </Panel>
  )
}

/**
 * Re-check's right column: the pages the next scheduled check will run, soonest
 * first, each with its address (copy and open) and the day it is due.
 */
export function NextRechecksPanel({
  client,
  project,
  timeZone
}: {
  client: AlertsClient
  project: ProjectSchedule
  timeZone: string
}): JSX.Element {
  const key = `${project.projectId}\0${project.nextCheckAt ?? ''}\0${project.pagesDueToday}`
  const [due, setDue] = useState<{ key: string; list: DueList | null } | null>(null)

  useEffect(() => {
    let live = true
    void client.listDue({ projectId: project.projectId }).then((result) => {
      if (live) setDue({ key, list: result.value })
    })
    return () => {
      live = false
    }
  }, [client, project.projectId, key])

  const list = due !== null && due.key === key ? due.list : null
  const pages = list ? [...list.pages].sort((a, b) => a.dueAt.localeCompare(b.dueAt)) : []
  const shown = pages.slice(0, NEXT_SHOWN)

  return (
    <Panel title="Next re-checks" titleAs="h3" tone="inset" padding={20} className="nt-next">
      {project.paused ? (
        <p className="hint">
          Checks are paused for this project. Nothing re-checks until you resume.
        </p>
      ) : due === null || due.key !== key ? (
        <p className="hint" role="status">
          Loading the pages due…
        </p>
      ) : shown.length === 0 ? (
        <p className="hint">
          No page is due at the next check. Each page comes due again on the cadence you pick here.
        </p>
      ) : (
        <>
          <ol className="nt-next-list" data-testid="next-rechecks">
            {shown.map((page) => (
              <li key={`${page.pageId}:${page.dueAt}`}>
                <span className="nt-next-top">
                  <a
                    className="nt-next-name"
                    href={
                      page.url === null ? topicHash(page.pageId) : pageHash(page.pageId, 'results')
                    }
                  >
                    {page.label ?? page.title ?? page.url ?? 'Topic'}
                  </a>
                  <time className="faint num" dateTime={page.dueAt}>
                    {dueDay(page.dueAt, timeZone)}
                  </time>
                </span>
                {page.url ? (
                  <UrlText url={page.url} variant="path" icon={false} />
                ) : (
                  <span className="faint">Topic</span>
                )}
              </li>
            ))}
          </ol>
          {pages.length > shown.length ? (
            <p className="hint">and {pluralize(pages.length - shown.length, 'more page')}</p>
          ) : null}
        </>
      )}
    </Panel>
  )
}
