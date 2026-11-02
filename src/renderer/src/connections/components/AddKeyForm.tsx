import { useId, useState, type FormEvent, type JSX } from 'react'
import type { ApiKeyMetadata } from '@shared/domain'
import { KeySteps } from '../../keys/KeySteps'
import { KeySecretRow } from '../../keys/KeyEditor'
import type { GuidedKeyProvider } from '../../keys/providerLinks'
import { testAndSave } from '../../keys/testAndSave'
import type { OnboardingClient } from '../../onboarding/client'
import { FieldError } from '../../onboarding/parts'
import { parseSearchBudget } from '../../onboarding/validate'
import { okMessage, warnMessage, type SectionMessage } from '../hooks/useKeyActions'
import { plainError } from '../utils/model'
import { Button } from '../../ui'
import '../connections.css'

/**
 * Adds one key (FR-11.1, FR-11.5, FR-11.6) in the 3-step key card: make an account,
 * copy the key, paste it here. The secret is sent once and the field is cleared.
 * "Test and save" tests the key before it stays: a key the provider rejects is
 * taken off again and the field asks for it once more.
 */
export function AddKeyForm({
  client,
  provider,
  title,
  defaultName,
  showCap,
  canCancel,
  hasAccount = false,
  onAdded,
  onCancel
}: {
  client: OnboardingClient
  provider: GuidedKeyProvider
  title: string
  defaultName: string
  showCap: boolean
  canCancel: boolean
  /** A key of this provider is already saved: step 1 shows as done. */
  hasAccount?: boolean
  onAdded: (key: ApiKeyMetadata, message: SectionMessage) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const nameId = useId()
  const secretId = `${provider}-add-secret`
  const capId = useId()
  const [name, setName] = useState(defaultName)
  const [secret, setSecret] = useState('')
  const [shown, setShown] = useState(false)
  const [cap, setCap] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [capError, setCapError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const sent = secret
    if (sent.trim().length === 0) {
      setError(`Paste your ${title} key.`)
      return
    }
    let parsedCap: number | null = null
    if (showCap) {
      const parsed = parseSearchBudget(cap)
      if ('error' in parsed) {
        setCapError(parsed.error)
        return
      }
      parsedCap = parsed.cap
    }
    setSecret('')
    setShown(false)
    setBusy(true)
    try {
      const outcome = await testAndSave(client, {
        provider,
        name: name.trim() || defaultName,
        secret: sent,
        cap: parsedCap,
        projectIds: []
      })
      if (outcome.kind === 'rejected') {
        setError(outcome.message)
        return
      }
      await onAdded(
        outcome.key,
        outcome.kind === 'saved' ? okMessage(outcome.message) : warnMessage(outcome.message)
      )
    } catch (cause) {
      setError(plainError(cause, sent))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="conn-add field" onSubmit={(event) => void submit(event)}>
      <KeySteps provider={provider} hasAccount={hasAccount}>
        <label className="field-label" htmlFor={secretId}>
          API key
        </label>
        <KeySecretRow
          id={secretId}
          value={secret}
          shown={shown}
          error={error}
          errorId={`${secretId}-error`}
          onToggle={() => setShown((value) => !value)}
          onChange={(value) => {
            setSecret(value)
            setError(null)
          }}
        />
        <label className="field-label" htmlFor={nameId}>
          Name
        </label>
        <input
          id={nameId}
          className="ob-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {showCap ? (
          <>
            <label className="field-label" htmlFor={capId}>
              Monthly cap <span className="optional">(searches)</span>
            </label>
            <input
              id={capId}
              className="ob-input mono"
              inputMode="numeric"
              value={cap}
              aria-invalid={capError ? true : undefined}
              aria-describedby={`${capId}-hint${capError ? ` ${capId}-error` : ''}`}
              onChange={(event) => {
                setCap(event.target.value)
                setCapError(null)
              }}
            />
            <p className="hint" id={`${capId}-hint`}>
              Empty means no cap. CiteFox moves to the next key when this one reaches it.
            </p>
            {capError ? <FieldError id={`${capId}-error`}>{capError}</FieldError> : null}
          </>
        ) : null}
      </KeySteps>
      <div className="actions conn-editor-actions">
        {canCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" variant="primary" busy={busy} disabled={busy}>
          Test and save
        </Button>
      </div>
    </form>
  )
}
