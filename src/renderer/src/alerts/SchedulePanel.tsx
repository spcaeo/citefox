import { useState, type JSX } from 'react'
import {
  intervalLabel,
  type AppSchedule,
  type IntervalDays,
  type ProjectSchedule
} from '@shared/domain'
import type { AppSchedulePatch, UpdateProjectScheduleRequest } from '@shared/ipc'
import { TEST_PROFILE_UNAVAILABLE } from '@shared/permissions'
import { useAppInfo } from '../buildMenu'
import { Icon } from '../components/Icon'
import { describedBy } from '../onboarding/copy'
import { FieldError } from '../onboarding/parts'
import { Switch } from './bits'
import { NextCheckLine, ProjectNote } from './schedule/RecheckNotes'
import { useServerDraft } from './useServerDraft'
import type { AlertsClient } from './client'
import {
  CATCH_UP_HINT,
  CLOSED_HINT,
  PAUSE_HINT,
  clockIssue,
  quietIssue,
  spreadHint,
  wallClock,
  type ProjectScheduleRow
} from './model'

/** Re-check offers these; 60 and 90 show only when a project already has one (import). */
const MAIN_INTERVALS: readonly { days: IntervalDays; hint: string }[] = [
  { days: 1, hint: 'About 30 checks a page each month. Uses the most credits.' },
  { days: 7, hint: 'About 4 checks a page each month. Recommended.' },
  { days: 14, hint: 'About 2 checks a page each month' },
  { days: 30, hint: 'Half the searches of 14 days; slower to spot changes' }
]

const EXTRA_INTERVALS: readonly IntervalDays[] = [60, 90]

/** Re-check and Notifications when there is no open project, or it could not be loaded. */
export function ProjectUnavailable({
  projectId,
  projectName,
  id,
  heading
}: {
  projectId: string | null
  projectName: string
  id: string
  heading: string
}): JSX.Element {
  return (
    <section className="card page-card" aria-labelledby={id}>
      <h2 id={id}>{heading}</h2>
      <p className="muted">
        {projectId
          ? `${projectName}'s re-check schedule and alerts could not be loaded.`
          : 'Open a project to set its re-check schedule and alerts.'}
      </p>
    </section>
  )
}

export function AppScheduleSection({
  app,
  onPatch
}: {
  app: AppSchedule
  onPatch: (patch: AppSchedulePatch) => Promise<void>
}): JSX.Element {
  const [time, setTime] = useServerDraft(app.dailyCheckTime)
  const [timeError, setTimeError] = useState<string | null>(null)
  // A test window has no login item and no background job (main keeps a stand-in only).
  const testProfile = useAppInfo()?.testProfile === true

  return (
    <section id="schedule" className="card page-card" aria-labelledby="schedule-h">
      <h2 id="schedule-h">Schedule</h2>
      <div>
        <div className="switch-row">
          <span className="switch-copy">
            <span id="sw-login-l" className="switch-label">
              Start CiteFox at login and keep it in the tray
            </span>
            {testProfile ? (
              <span id="sw-login-d" className="hint">
                {TEST_PROFILE_UNAVAILABLE}
              </span>
            ) : null}
          </span>
          <Switch
            labelledBy="sw-login-l"
            {...(testProfile ? { describedBy: 'sw-login-d' } : {})}
            on={testProfile ? false : app.startAtLogin}
            disabled={testProfile}
            onToggle={() => void onPatch({ startAtLogin: !app.startAtLogin })}
          />
        </div>
        <div className="switch-row">
          <span id="sw-catch-l" className="switch-label">
            Catch up on missed checks after sleep
          </span>
          <Switch
            labelledBy="sw-catch-l"
            on={app.catchUpAfterSleep}
            onToggle={() => void onPatch({ catchUpAfterSleep: !app.catchUpAfterSleep })}
          />
        </div>
        <div className="switch-row">
          <span className="switch-copy">
            <span id="sw-closed-l" className="switch-label">
              Also check when CiteFox is closed
            </span>
            <span id="sw-closed-d" className="hint">
              {testProfile ? TEST_PROFILE_UNAVAILABLE : CLOSED_HINT}
            </span>
          </span>
          <Switch
            labelledBy="sw-closed-l"
            describedBy="sw-closed-d"
            on={testProfile ? false : app.checkWhenClosed}
            disabled={testProfile}
            onToggle={() => void onPatch({ checkWhenClosed: !app.checkWhenClosed })}
          />
        </div>
        <div className="switch-row">
          <label htmlFor="check-time" className="switch-label">
            Time of day checks start
          </label>
          <input
            id="check-time"
            className="ob-input mono"
            type="time"
            value={time}
            aria-invalid={timeError ? true : undefined}
            aria-describedby={timeError ? 'check-time-error' : undefined}
            onChange={(event) => setTime(event.target.value)}
            onBlur={() => {
              const issue = clockIssue(time, 'the check time')
              setTimeError(issue)
              if (!issue && time !== app.dailyCheckTime) void onPatch({ dailyCheckTime: time })
            }}
          />
        </div>
        {timeError ? <FieldError id="check-time-error">{timeError}</FieldError> : null}
      </div>
    </section>
  )
}

export function ProjectScheduleSection({
  client,
  project,
  projectName,
  noteRows,
  timeZone,
  now,
  onPatch
}: {
  client: AlertsClient
  project: ProjectSchedule
  projectName: string
  noteRows: readonly ProjectScheduleRow[]
  timeZone: string
  now: Date
  onPatch: (patch: UpdateProjectScheduleRequest) => Promise<void>
}): JSX.Element {
  const [time, setTime] = useServerDraft(project.dailyCheckTime)
  const [quietFrom, setQuietFrom] = useServerDraft(project.quietFrom ?? '')
  const [quietUntil, setQuietUntil] = useServerDraft(project.quietUntil ?? '')
  const [timeError, setTimeError] = useState<string | null>(null)
  const [quietError, setQuietError] = useState<string | null>(null)

  function saveQuiet(from: string, until: string): void {
    const issue = quietIssue(from, until)
    setQuietError(issue)
    if (issue) return
    const nextFrom = from.trim().length === 0 ? null : from.trim()
    const nextUntil = until.trim().length === 0 ? null : until.trim()
    if (nextFrom === project.quietFrom && nextUntil === project.quietUntil) return
    void onPatch({
      projectId: project.projectId,
      quietFrom: nextFrom,
      quietUntil: nextUntil
    })
  }

  const extra = EXTRA_INTERVALS.includes(project.defaultIntervalDays)
    ? project.defaultIntervalDays
    : null

  return (
    <section id="recheck" className="card page-card" aria-labelledby="recheck-h">
      <h2 id="recheck-h">Re-check</h2>
      <fieldset>
        <legend>Re-check every page</legend>
        <div className="stack-tight">
          {MAIN_INTERVALS.map(({ days, hint }) => (
            <IntervalChoice
              key={days}
              id={`sch-${days}`}
              days={days}
              title={intervalLabel(days)}
              hint={hint}
              checked={project.defaultIntervalDays === days}
              onPick={() =>
                void onPatch({ projectId: project.projectId, defaultIntervalDays: days })
              }
            />
          ))}
          {extra ? (
            <IntervalChoice
              id={`sch-${extra}`}
              days={extra}
              title={`Every ${extra} days`}
              hint="Already set for this project."
              checked
              onPick={() => undefined}
            />
          ) : null}
        </div>
      </fieldset>
      <div className="grid3">
        <div className="field">
          <label className="field-label" htmlFor="sch-time">
            This project&apos;s check time
          </label>
          <input
            id="sch-time"
            className="ob-input mono"
            type="time"
            value={time}
            aria-invalid={timeError ? true : undefined}
            aria-describedby={timeError ? 'sch-time-error' : undefined}
            onChange={(event) => setTime(event.target.value)}
            onBlur={() => {
              const issue = clockIssue(time, 'the check time')
              setTimeError(issue)
              if (!issue && time !== project.dailyCheckTime) {
                void onPatch({ projectId: project.projectId, dailyCheckTime: time })
              }
            }}
          />
          {timeError ? <FieldError id="sch-time-error">{timeError}</FieldError> : null}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sch-q1">
            Quiet hours from
          </label>
          <input
            id="sch-q1"
            className="ob-input mono"
            type="time"
            value={quietFrom}
            aria-invalid={quietError ? true : undefined}
            aria-describedby={describedBy(['quiet-hint', quietError ? 'quiet-error' : false])}
            onChange={(event) => setQuietFrom(event.target.value)}
            onBlur={() => saveQuiet(quietFrom, quietUntil)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sch-q2">
            Quiet hours until
          </label>
          <input
            id="sch-q2"
            className="ob-input mono"
            type="time"
            value={quietUntil}
            aria-invalid={quietError ? true : undefined}
            aria-describedby={describedBy(['quiet-hint', quietError ? 'quiet-error' : false])}
            onChange={(event) => setQuietUntil(event.target.value)}
            onBlur={() => saveQuiet(quietFrom, quietUntil)}
          />
        </div>
      </div>
      <p className="hint" id="quiet-hint">
        A window that passes midnight, such as {wallClock('22:00')} to {wallClock('07:00')}, is
        allowed. Leave both blank to turn quiet hours off.
      </p>
      {quietError ? <FieldError id="quiet-error">{quietError}</FieldError> : null}
      <div>
        <div className="switch-row">
          <span className="switch-copy">
            <span id="sw-spread-l" className="switch-label">
              Spread checks across the day
            </span>
            <span className="hint">
              {spreadHint(project.pagesDueToday, project.dailyCheckTime)}
            </span>
          </span>
          <Switch
            labelledBy="sw-spread-l"
            on={project.spreadAcrossDay}
            onToggle={() =>
              void onPatch({
                projectId: project.projectId,
                spreadAcrossDay: !project.spreadAcrossDay
              })
            }
          />
        </div>
        <div className="switch-row">
          <span className="switch-copy">
            <span id="sw-pcatch-l" className="switch-label">
              Catch up after sleep
            </span>
            <span className="hint">{CATCH_UP_HINT}</span>
          </span>
          <Switch
            labelledBy="sw-pcatch-l"
            on={project.catchUp}
            onToggle={() =>
              void onPatch({ projectId: project.projectId, catchUp: !project.catchUp })
            }
          />
        </div>
        <div className="switch-row">
          <span className="switch-copy">
            <span id="sw-pause-l" className="switch-label">
              Pause all checks for this project
            </span>
            <span className="hint">{PAUSE_HINT}</span>
          </span>
          <Switch
            labelledBy="sw-pause-l"
            on={project.paused}
            onToggle={() => void onPatch({ projectId: project.projectId, paused: !project.paused })}
          />
        </div>
      </div>
      <NextCheckLine
        client={client}
        project={project}
        projectName={projectName}
        now={now}
        timeZone={timeZone}
      />
      <div className="note">
        <Icon name="info" />
        <p className="muted">
          <ProjectNote rows={noteRows} activeProjectId={project.projectId} />
        </p>
      </div>
    </section>
  )
}

function IntervalChoice({
  id,
  days,
  title,
  hint,
  checked,
  onPick
}: {
  id: string
  days: IntervalDays
  title: string
  hint: string
  checked: boolean
  onPick: () => void
}): JSX.Element {
  return (
    <label className={checked ? 'radio on' : 'radio'} htmlFor={id}>
      <input
        id={id}
        type="radio"
        name="every"
        value={String(days)}
        checked={checked}
        onChange={onPick}
      />
      <span className="choice">
        <strong>{title}</strong>
        <span className="faint">{hint}</span>
      </span>
    </label>
  )
}
