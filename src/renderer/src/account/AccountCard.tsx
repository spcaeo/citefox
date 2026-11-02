import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AccountStatus } from '@shared/ipc'
import { Button, Chip, Panel } from '../ui'
import { AccountFields } from './AccountFields'
import { PRIVACY_NOTE } from './accountDraft'
import { ipcAccountClient, type AccountClient } from './client'
import { useAccountForm } from './useAccountForm'
import './account.css'

/**
 * Settings › Data & about › "Your CiteFox account": edit the details and the
 * two email choices sent at Join CiteFox. Hidden in a build without a
 * registration address (nothing is ever sent there).
 */
export function AccountCard({
  client: given
}: {
  /** Tests pass a fake; the app uses the preload bridge. */
  client?: AccountClient | null
}): JSX.Element | null {
  const client = useMemo(() => (given === undefined ? ipcAccountClient() : given), [given])
  const [status, setStatus] = useState<AccountStatus | null>(null)

  useEffect(() => {
    if (!client) return
    let cancelled = false
    client.get().then(
      (next) => {
        if (!cancelled) setStatus(next)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [client])

  if (!client || !status || !status.enabled) return null
  // Remount the form when the saved details arrive, so it starts from them.
  return <AccountForm client={client} status={status} onSaved={setStatus} />
}

function AccountForm({
  client,
  status,
  onSaved
}: {
  client: AccountClient
  status: AccountStatus
  onSaved: (status: AccountStatus) => void
}): JSX.Element {
  const form = useAccountForm(client, status.details)
  const [saved, setSaved] = useState(false)

  return (
    <Panel
      title="Your CiteFox account"
      actions={
        status.waiting ? (
          <Chip tone="warn" dot>
            Not sent yet
          </Chip>
        ) : status.joined ? (
          <Chip tone="ok" dot>
            Joined
          </Chip>
        ) : null
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          setSaved(false)
          void form.submit().then((next) => {
            if (next) {
              onSaved(next)
              setSaved(true)
            }
          })
        }}
      >
        <AccountFields
          draft={form.draft}
          errors={form.errors}
          onChange={(patch) => {
            setSaved(false)
            form.patch(patch)
          }}
          idPrefix="acct"
        />
        <p className="hint acct-note">{PRIVACY_NOTE}</p>
        <div className="acct-foot">
          <Button type="submit" variant="primary" busy={form.busy}>
            Save
          </Button>
          <p role="status" aria-live="polite" className="hint">
            {form.failure ?? (saved ? 'Saved.' : '')}
          </p>
        </div>
      </form>
    </Panel>
  )
}
