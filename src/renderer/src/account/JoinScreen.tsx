import type { JSX } from 'react'
import type { AccountStatus } from '@shared/ipc'
import { Panel, WizardFooter } from '../ui'
import { AccountFields } from './AccountFields'
import { PRIVACY_NOTE } from './accountDraft'
import type { AccountClient } from './client'
import { useAccountForm } from './useAccountForm'
import './account.css'

/**
 * "Join CiteFox": the short step before anything else on first run (and once
 * after an update, for someone who never joined). Free; it lets the owner
 * know who uses CiteFox and send the emails people tick. Offline still lets
 * the person in: main keeps the details and sends them later.
 */
export function JoinScreen({
  client,
  onJoined
}: {
  client: AccountClient
  onJoined: (status: AccountStatus) => void
}): JSX.Element {
  const form = useAccountForm(client, null)

  async function join(): Promise<void> {
    const status = await form.submit()
    if (status) onJoined(status)
  }

  return (
    <div className="ob">
      <div className="ob-page setup-width">
        <form
          className="acct-join"
          aria-labelledby="join-title"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void join()
          }}
        >
          <span className="ob-kicker">Free</span>
          <h1 id="join-title">Join CiteFox</h1>
          <p className="welcome-lead">A few details, then setup starts.</p>
          <Panel>
            <AccountFields
              draft={form.draft}
              errors={form.errors}
              onChange={form.patch}
              idPrefix="join"
            />
            {form.failure ? (
              <p className="field-error" role="alert">
                {form.failure}
              </p>
            ) : null}
          </Panel>
          {/* Enter in a field joins, like the button. */}
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        </form>
      </div>
      <WizardFooter
        note={PRIVACY_NOTE}
        primary={{ label: 'Join and continue', onClick: () => void join(), busy: form.busy }}
      />
    </div>
  )
}
