import { useState, type JSX, type ReactNode } from 'react'
import type { ApiKeyProvider } from '@shared/domain'
import { errorText } from '../../components/errorText'
import { KeySteps } from '../../keys/KeySteps'
import { isGuidedKeyProvider } from '../../keys/providerLinks'
import { testAndSave } from '../../keys/testAndSave'
import { parseSearchBudget } from '../../onboarding/validate'
import type { ShellClient } from '../../projects/client'
import {
  Drawer,
  DrawerField,
  DrawerFields,
  DrawerMain,
  DrawerSection,
  SecretField,
  showUndo
} from '../../ui'
import { PROVIDER_LABEL } from './model'
import './pickerDrawers.css'

export interface AddKeyDrawerProps {
  client: ShellClient
  provider: ApiKeyProvider
  /** The open project, for "Only for this project". */
  projectId: string
  onClose: () => void
  /** The new key's id: the drawer closes handing it back. */
  onAdded: (keyId: string) => void
}

const WHAT_FOR: Readonly<Record<ApiKeyProvider, string>> = {
  serpapi: 'Google AI Overviews only',
  cloro: 'Google AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini and Copilot with one key',
  anthropic: 'Claude, billed to that Anthropic account',
  jina: 'Reading pages',
  youtube: 'YouTube citations'
}

/**
 * Add an API key (`?drawer=add-key&key.provider=serpapi`), opened from any key
 * picker's "+ Add a … key…", as the 3-step key card (make an account, copy the
 * key, paste it here). The key is sent once and never shown again: the field
 * clears on send and no message repeats it. "Test and save" tests it before it
 * stays; a key the provider rejects is taken off again (`keys/testAndSave.ts`).
 */
export function AddKeyDrawer({
  client,
  provider,
  projectId,
  onClose,
  onAdded
}: AddKeyDrawerProps): JSX.Element {
  const label = PROVIDER_LABEL[provider]
  const [name, setName] = useState(`${label} key`)
  const [secret, setSecret] = useState('')
  const [shown, setShown] = useState(false)
  const [cap, setCap] = useState('')
  const [onlyHere, setOnlyHere] = useState(false)
  const [busy, setBusy] = useState(false)
  const [secretError, setSecretError] = useState<string | null>(null)
  const [capError, setCapError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const showCap = provider === 'serpapi'

  async function add(): Promise<void> {
    const sent = secret
    if (sent.trim().length === 0) {
      setSecretError(`Paste your ${label} key.`)
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
    setError(null)
    try {
      const outcome = await testAndSave(client, {
        provider,
        name: name.trim() || `${label} key`,
        secret: sent,
        cap: parsedCap,
        projectIds: onlyHere ? [projectId] : []
      })
      if (outcome.kind === 'rejected') {
        setSecretError(outcome.message)
        setBusy(false)
        return
      }
      showUndo({ message: outcome.message, testId: 'add-key-toast' })
      onAdded(outcome.key.id)
    } catch (cause: unknown) {
      setError(errorText(cause, 'Could not save the key.', { secret: sent }))
      setBusy(false)
    }
  }

  const fields: ReactNode = (
    <>
      <DrawerFields>
        <DrawerField
          label="API key"
          hint={`From your ${label} account. Sent once, then kept in the keychain.`}
          error={secretError}
        >
          {(ids) => (
            <span className="pd-secret">
              <SecretField
                kind="key"
                id={ids.id}
                shown={shown}
                onShownChange={setShown}
                aria-describedby={ids.describedBy}
                className="ui-input mono"
                value={secret}
                data-autofocus
                onChange={(event) => {
                  setSecret(event.target.value)
                  setSecretError(null)
                }}
              />
            </span>
          )}
        </DrawerField>
        <DrawerField label="Name" hint="How it shows in pickers and Connections.">
          {(ids) => (
            <input
              id={ids.id}
              aria-describedby={ids.describedBy}
              className="ui-input"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </DrawerField>
        {showCap ? (
          <DrawerField
            label="Monthly cap (searches, optional)"
            hint="Empty means no cap. CiteFox moves to the next key when this one reaches it."
            error={capError}
          >
            {(ids) => (
              <input
                id={ids.id}
                aria-describedby={ids.describedBy}
                className="ui-input mono"
                inputMode="numeric"
                placeholder="No cap"
                value={cap}
                onChange={(event) => {
                  setCap(event.target.value)
                  setCapError(null)
                }}
              />
            )}
          </DrawerField>
        ) : null}
      </DrawerFields>
      <label className="pd-check">
        <input
          type="checkbox"
          checked={onlyHere}
          onChange={(event) => setOnlyHere(event.target.checked)}
        />
        <span>Only for this project. Off: every project can use it.</span>
      </label>
    </>
  )

  const summary = error ? (
    <span className="ui-drawer-error" role="alert">
      {error}
    </span>
  ) : (
    'Kept in this computer’s keychain · CiteFox never shows it again'
  )

  return (
    <Drawer
      id="add-key"
      title={`Add a ${label} key`}
      subtitle={WHAT_FOR[provider]}
      testId="add-key-drawer"
      dirty={secret.length > 0 && !busy}
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      footer={{
        summary,
        primary: {
          label: 'Test and save',
          busy,
          disabled: busy,
          onClick: () => void add()
        }
      }}
    >
      <DrawerMain>
        {isGuidedKeyProvider(provider) ? (
          <DrawerSection title={`Connect ${label} in 3 steps`}>
            <KeySteps provider={provider}>{fields}</KeySteps>
          </DrawerSection>
        ) : (
          <DrawerSection title="The key">{fields}</DrawerSection>
        )}
      </DrawerMain>
    </Drawer>
  )
}
