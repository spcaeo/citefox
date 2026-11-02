import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { AppSchedule, ProjectSchedule } from '@shared/domain'
import { LoadError } from '../components/LoadError'
import { DrillHost } from '../drill'
import { alertsHash } from '../shell/routes'
import type { AlertsClient, EmailView, Loaded } from './client'
import { EmailSettings } from './EmailSettings'
import { userTimeZone, type ProjectScheduleRow } from './model'
import { NextRechecksPanel } from './schedule/SidePanels'
import { AppScheduleSection, ProjectScheduleSection } from './SchedulePanel'
import { scheduleRows } from './tabs'
import './alerts.css'

/**
 * The schedule and email settings, each in its one home (second monday review
 * #10): Project settings › Schedule shows `ProjectRecheck`, App settings ›
 * Check timing `AppCheckTiming` and App settings › Email accounts
 * `AppEmailAccounts`. Each loads its own values, so the screen that hosts it
 * needs only the alerts client.
 */

/** Loads one value and keeps it; `retry` loads it again. */
function useLoaded<T>(
  load: () => Promise<Loaded<T>>,
  key: string
): {
  value: T | null
  setValue: (value: T) => void
  error: string | null
  setError: (reason: string | null) => void
  loading: boolean
  retry: () => void
} {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${key}\0${attempt}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void load().then((result) => {
      if (cancelled) return
      setValue(result.value)
      setError(result.unavailable?.reason ?? null)
      setLoadedKey(requestKey)
    })
    return () => {
      cancelled = true
    }
    // `load` is a new function each render; the key says when to load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  return {
    value,
    setValue,
    error,
    setError,
    loading: loadedKey !== requestKey,
    retry: () => setAttempt((n) => n + 1)
  }
}

/** Alerts' own styles, and the drill drawer the shell shares (or one of its own in tests). */
function Frame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <DrillHost>
      <div className="alerts al-home">{children}</div>
    </DrillHost>
  )
}

/** Project settings › Schedule: this project's re-check cadence and the pages due next. */
export function ProjectRecheck({
  client,
  projectId,
  projectName,
  projectSchedules = [],
  timeZone,
  now
}: {
  client: AlertsClient
  projectId: string
  projectName: string
  /** The user's projects and their cadence, for the note under the form. */
  projectSchedules?: readonly ProjectScheduleRow[]
  timeZone?: string
  now?: Date
}): JSX.Element {
  const zone = timeZone ?? userTimeZone()
  const loaded = useLoaded<ProjectSchedule>(() => client.getProject({ projectId }), projectId)
  const project = loaded.value

  if (loaded.loading) return <p role="status">Loading the schedule…</p>
  if (project === null) {
    return (
      <LoadError
        title={`Could not load ${projectName}'s schedule.`}
        message={loaded.error ?? 'The schedule is not available right now.'}
        onRetry={loaded.retry}
      />
    )
  }
  return (
    <Frame>
      {loaded.error ? <p role="alert">{loaded.error}</p> : null}
      <div className="al-grid">
        <div className="al-main">
          <ProjectScheduleSection
            client={client}
            project={project}
            projectName={projectName}
            noteRows={scheduleRows(project, projectName, projectSchedules)}
            timeZone={zone}
            now={now ?? new Date()}
            onPatch={async (patch) => {
              const result = await client.updateProject(patch)
              if (result.value) loaded.setValue(result.value)
              loaded.setError(result.unavailable?.reason ?? null)
            }}
          />
        </div>
        <div className="al-rail">
          <NextRechecksPanel client={client} project={project} timeZone={zone} />
          <p className="hint">
            The tray and the background job for every project are in{' '}
            <a href={alertsHash('schedule')}>App settings › General</a>. Who hears about changes
            after a check is set in{' '}
            <a href={alertsHash('notifications')}>Alerts & schedules › Notifications</a>.
          </p>
        </div>
      </div>
    </Frame>
  )
}

/** App settings › General › Check timing: the tray, login start and background job for every project. */
export function AppCheckTiming({ client }: { client: AlertsClient }): JSX.Element {
  const loaded = useLoaded<AppSchedule>(() => client.getApp(), 'app')
  const app = loaded.value

  if (loaded.loading) return <p role="status">Loading check timing…</p>
  if (app === null) {
    return (
      <LoadError
        title="Could not load check timing."
        message={loaded.error ?? 'Check timing is not available right now.'}
        onRetry={loaded.retry}
      />
    )
  }
  return (
    <Frame>
      {loaded.error ? <p role="alert">{loaded.error}</p> : null}
      <AppScheduleSection
        app={app}
        onPatch={async (patch) => {
          const result = await client.updateApp(patch)
          if (result.value) loaded.setValue(result.value)
          loaded.setError(result.unavailable?.reason ?? null)
        }}
      />
    </Frame>
  )
}

/** App settings › Email accounts: how CiteFox sends email, for every project. */
export function AppEmailAccounts({
  client,
  activeProjectId,
  timeZone
}: {
  client: AlertsClient
  activeProjectId: string | null
  timeZone?: string
}): JSX.Element {
  const loaded = useLoaded<EmailView>(() => client.getEmail(), 'email')
  const email = loaded.value

  if (loaded.loading) return <p role="status">Loading email setup…</p>
  if (email === null) {
    return (
      <LoadError
        title="Could not load email setup."
        message={loaded.error ?? 'Email setup is not available right now.'}
        onRetry={loaded.retry}
      />
    )
  }
  return (
    <Frame>
      {loaded.error ? <p role="alert">{loaded.error}</p> : null}
      <EmailSettings
        client={client}
        email={email}
        timeZone={timeZone ?? userTimeZone()}
        activeProjectId={activeProjectId}
        onEmail={loaded.setValue}
        onError={loaded.setError}
      />
    </Frame>
  )
}
