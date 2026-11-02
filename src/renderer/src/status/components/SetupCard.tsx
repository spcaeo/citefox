import { useId, useState, type JSX } from 'react'
import type { ConnectionState } from '@shared/domain'
import type { SetupStatus } from '@shared/ipc'
import { DrillNumber } from '../../drill'
import { drillCount, type ItemDrill } from '../../drill/types'
import { pagesHash } from '../../shell/routes'
import { formatClock, formatDay } from '../../utils/dates'
import {
  gaveUp,
  setupDoneDrill,
  setupFailedDrill,
  setupRunningDrill,
  setupStepLabel,
  setupWaitingDrill
} from '../live/setupDrills'
import type { SetupState } from '../live/useSetupStatus'
import { projectNames } from '../utils/drills'
import { count } from '../utils/model'
import { Button, UrlText } from '../../ui'
import { StatusSection } from './StatusSection'

const MIN_RATE = 1
const MAX_RATE = 200

function setupState(status: SetupStatus): ConnectionState {
  if (status.failed > 0) return 'warning'
  if (status.paused) return 'off'
  return 'ok'
}

/**
 * One count. It opens the pages behind it when the listed pages add up to
 * the runner's number (NFR-14); otherwise it is plain text, never a drawer
 * whose total differs from the number.
 */
function Count({
  label,
  value,
  drill
}: {
  label: string
  value: number
  drill: ItemDrill | null
}): JSX.Element {
  const drills = drill !== null && drillCount(drill) === value && value > 0
  return (
    <div className="st-setup-count">
      {drills && drill ? (
        <DrillNumber
          drill={drill}
          className="st-setup-num"
          label={`${count(value)} ${label.toLowerCase()}: show the pages`}
        />
      ) : (
        <span className="st-setup-num">{count(value)}</span>
      )}
      <span className="faint sts-small">{label}</span>
    </div>
  )
}

/**
 * Background page setup (FR-20.6, SCH-12): waiting, running, done today and
 * failed, why nothing is starting, pause and resume, the pages-an-hour limit,
 * and each failed page with its reason and Retry.
 */
export function SetupCard({ setup }: { setup: SetupState }): JSX.Element | null {
  const rateId = useId()
  const [rate, setRate] = useState<string | null>(null)
  const [rateError, setRateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { status } = setup
  if (!status) return null
  const names = projectNames(setup.projects)
  const failedList = gaveUp(status)
  const shownRate = rate ?? String(status.pagesPerHour)

  async function act(work: () => Promise<void>): Promise<void> {
    setBusy(true)
    await work()
    setBusy(false)
  }

  async function saveRate(): Promise<void> {
    const value = Number(shownRate)
    if (!Number.isInteger(value) || value < MIN_RATE || value > MAX_RATE) {
      setRateError(`Enter a whole number from ${MIN_RATE} to ${MAX_RATE}.`)
      return
    }
    setRateError(null)
    await act(() => setup.setRate(value))
    setRate(null)
  }

  return (
    <StatusSection
      id="st-setup"
      title="Page setup"
      icon="spark"
      state={setupState(status)}
      href={pagesHash({ view: 'tracked' })}
      action="All pages"
    >
      <span className="muted">
        Pages tracked in bulk are set up in the background: read, buyer profile, buyer questions and
        coverage.
      </span>
      <div className="st-setup-counts" role="group" aria-label="Page setup counts">
        <Count
          label="Waiting"
          value={status.waiting}
          drill={setupWaitingDrill(status, setup.settingUp, setup.running, names)}
        />
        <Count
          label="Running"
          value={status.running}
          drill={setupRunningDrill(setup.running, setup.settingUp, names, status.pages?.running)}
        />
        <Count
          label="Done today"
          value={status.doneToday}
          drill={setupDoneDrill(setup.doneSeen, setup.settingUp, names, status.pages?.doneToday)}
        />
        <Count label="Failed" value={status.failed} drill={setupFailedDrill(status, names)} />
      </div>
      <span role="status">
        {status.holdReason
          ? `Nothing is starting: ${status.holdReason}`
          : status.running > 0
            ? `Setting up ${status.running} ${status.running === 1 ? 'page' : 'pages'} now.`
            : 'Free to start the next page.'}
      </span>
      <div className="st-buttons">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void act(() => setup.setPaused(!status.paused))}
        >
          {status.paused ? 'Resume page setup' : 'Pause page setup'}
        </Button>
        {failedList.length > 0 ? (
          <Button size="sm" disabled={busy} onClick={() => void act(() => setup.retry())}>
            Retry all failed
          </Button>
        ) : null}
      </div>
      <div className="st-setup-rate">
        <label className="field-label" htmlFor={rateId}>
          Pages an hour
        </label>
        <input
          id={rateId}
          className="ui-input ui-input-sm num st-rate-input"
          inputMode="numeric"
          value={shownRate}
          aria-invalid={rateError ? true : undefined}
          aria-describedby={rateError ? `${rateId}-error` : `${rateId}-hint`}
          onChange={(event) => setRate(event.target.value)}
        />
        <Button
          size="sm"
          disabled={busy || shownRate === String(status.pagesPerHour)}
          onClick={() => void saveRate()}
        >
          Save
        </Button>
        {rateError ? (
          <span id={`${rateId}-error`} className="st-problem" role="alert">
            {rateError}
          </span>
        ) : (
          <span id={`${rateId}-hint`} className="faint sts-small">
            At most this many pages start each hour ({MIN_RATE}–{MAX_RATE}).
          </span>
        )}
      </div>
      {status.failures.length > 0 ? (
        <ul className="st-keys" aria-label="Pages whose setup stopped">
          {status.failures.map((failure) => (
            <li key={`${failure.projectId}:${failure.pageId}`} className="st-key">
              <div className="st-row">
                <span className="muted">
                  {failure.label ? (
                    <UrlText url={failure.url} label={failure.label} plain />
                  ) : (
                    <UrlText url={failure.url} />
                  )}
                  <span className="faint"> · {failure.projectName}</span>
                </span>
                {failure.retryAt === null ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    aria-label={`Retry ${failure.label ?? failure.url}`}
                    onClick={() =>
                      void act(() =>
                        setup.retry({ projectId: failure.projectId, pageIds: [failure.pageId] })
                      )
                    }
                  >
                    Retry
                  </Button>
                ) : (
                  <span className="faint sts-small">
                    Retries {formatDay(failure.retryAt, { year: false })}{' '}
                    {formatClock(failure.retryAt)}
                  </span>
                )}
              </div>
              <span className="st-problem">
                {setupStepLabel(failure.step)}: {failure.reason}
                {failure.nextStep ? ` ${failure.nextStep}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {setup.error ? (
        <span className="st-problem" role="alert">
          {setup.error}
        </span>
      ) : null}
    </StatusSection>
  )
}
