import { useState, type JSX } from 'react'
import { errorText } from '../components/errorText'
import { Confirm } from '../ui'
import { UiIcon } from '../ui/UiIcon'
import type { BuildClient, BuildNoticeTone } from './buildClient'
import { testProfileNotice } from './useBuildActions'

/** A refusal or failure, inside the confirm (nothing changed). */
function ConfirmError({ error }: { error: string | null }): JSX.Element | null {
  return error ? (
    <p className="bm-dialog-error" role="alert">
      {error}
    </p>
  ) : null
}

function FactList({
  tone,
  heading,
  items
}: {
  tone: 'removed' | 'kept'
  heading: string
  items: readonly string[]
}): JSX.Element {
  return (
    <div className={`bm-facts bm-facts-${tone}`}>
      <h3>{heading}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <UiIcon name={tone === 'kept' ? 'check' : 'x'} size={14} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const REMOVED = [
  'Projects, pages and questions',
  'Results and history',
  'Settings',
  'Background check and login item'
] as const

/**
 * "Reset CiteFox, keep my keys": what goes and what stays, then
 * `app:resetKeepKeys`. On success the app restarts on the first run; a
 * refusal is shown here and nothing changed.
 */
export function ResetDialog({
  client,
  testProfile,
  onClose
}: {
  client: BuildClient
  testProfile: boolean
  onClose: () => void
}): JSX.Element {
  const [state, setState] = useState<'idle' | 'busy' | 'restarting'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function reset(): Promise<void> {
    setState('busy')
    setError(null)
    try {
      const result = await client.resetKeepKeys()
      if (result.ok) {
        setState('restarting')
        return
      }
      setError(result.message)
    } catch (cause) {
      setError(errorText(cause, 'CiteFox could not reset.'))
    }
    setState('idle')
  }

  return (
    <Confirm
      title={
        testProfile ? 'Reset this test profile, keep its keys?' : 'Reset CiteFox, keep my keys?'
      }
      body={
        <div className="bm-confirm">
          <p>
            {testProfile
              ? 'This test window goes back to the first run. Your real data and keys are not touched.'
              : 'CiteFox goes back to the first run, so you can test it like a new user.'}
          </p>
          <div className="bm-facts-row">
            <FactList tone="removed" heading="Removed" items={REMOVED} />
            <FactList
              tone="kept"
              heading="Kept"
              items={[testProfile ? 'Its API keys' : 'Your API keys', 'Their keychain items']}
            />
          </div>
          <p className="bm-note">A backup of the current data is kept in the data folder.</p>
          {state === 'restarting' ? (
            <p className="bm-note" role="status">
              Restarting…
            </p>
          ) : null}
          <ConfirmError error={error} />
        </div>
      }
      confirmLabel={state === 'restarting' ? 'Restarting…' : 'Reset and restart'}
      busy={state !== 'idle'}
      onCancel={onClose}
      onConfirm={() => void reset()}
    />
  )
}

/**
 * "Start a fresh test profile": clears the test profile's data and its own
 * keys, then opens the test window. The real data and keys are not touched.
 */
export function FreshTestDialog({
  client,
  onClose,
  onDone
}: {
  client: BuildClient
  onClose: () => void
  onDone: (message: string, tone: BuildNoticeTone) => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await client.openTestProfile({ fresh: true })
      if (result.ok) {
        const notice = testProfileNotice(result, true)
        onDone(notice.message, notice.tone)
        return
      }
      setError(result.message)
    } catch (cause) {
      setError(errorText(cause, 'Could not open the test window.'))
    }
    setBusy(false)
  }

  return (
    <Confirm
      title="Start a fresh test profile?"
      body={
        <div className="bm-confirm">
          <p>
            The test window opens like a first install: its data and its own keys are cleared first.
          </p>
          <p className="bm-note">Your real data and keys are not touched.</p>
          <ConfirmError error={error} />
        </div>
      }
      confirmLabel="Clear and open"
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void start()}
    />
  )
}
