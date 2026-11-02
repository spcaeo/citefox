import { useState, type FormEvent, type JSX } from 'react'
import type { ApiKeyMetadata, ApiKeyProvider } from '@shared/domain'
import type { KeyTestResult } from '@shared/ipc'
import { Button, SecretField } from '../ui'
import { describedBy, safeClientMessage } from '../onboarding/copy'
import { formatStoredKeyHint } from '../onboarding/hint'
import { FieldError } from '../onboarding/parts'
import { parseSearchBudget } from '../onboarding/validate'
import type { OnboardingClient } from '../onboarding/client'
import {
  capLabel,
  connectionStateLabel,
  keyWarningReason,
  projectsLabel,
  providerTitle,
  warningCopy,
  WORKING_KEY_NOTE,
  type KeyWarningReason
} from './health'

const DEFAULT_NAME: Readonly<Record<ApiKeyProvider, string>> = {
  serpapi: 'SerpApi',
  cloro: 'cloro',
  jina: 'Jina',
  anthropic: 'Anthropic API',
  youtube: 'YouTube'
}

export function KeyEditor({
  client,
  provider,
  saved,
  showBudget = false,
  addLabel,
  onChanged
}: {
  client: OnboardingClient
  provider: ApiKeyProvider
  saved: ApiKeyMetadata | null
  showBudget?: boolean
  addLabel: string
  onChanged: () => Promise<void>
}): JSX.Element {
  const [secret, setSecret] = useState('')
  const [shown, setShown] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [name, setName] = useState(saved?.name ?? DEFAULT_NAME[provider])
  const [budget, setBudget] = useState(
    saved?.cap === null || saved?.cap === undefined ? '' : String(saved.cap)
  )
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [budgetError, setBudgetError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [reason, setReason] = useState<KeyWarningReason | null>(null)
  const hint = saved ? formatStoredKeyHint(saved.hint) : null
  const title = providerTitle(provider)
  // Several keys of one provider can be on screen, so ids carry the key id.
  const idBase = `${provider}-${saved?.id ?? 'new'}`
  const secretId = `${idBase}-secret`
  const errorId = `${idBase}-secret-error`
  const budgetId = `${idBase}-budget`
  const displayReason = saved ? reason : null
  const displayState = saved ? (saved.on ? saved.state : 'off') : 'off'

  function remember(result: KeyTestResult | null, text: string | null): void {
    setMessage(text)
    setReason(result ? keyWarningReason(result) : null)
  }

  async function run(action: () => Promise<void>, sentSecret = ''): Promise<void> {
    setBusy(true)
    setFieldError(null)
    try {
      await action()
      await onChanged()
    } catch (error) {
      const text = safeClientMessage(error, sentSecret)
      setFieldError(text)
      setMessage(text)
    } finally {
      setBusy(false)
    }
  }

  function submitAdd(event: FormEvent): void {
    event.preventDefault()
    const next = secret
    if (next.trim().length === 0) {
      setFieldError(`Paste your ${title} key.`)
      return
    }
    let cap: number | null = null
    if (showBudget) {
      const parsed = parseSearchBudget(budget)
      if ('error' in parsed) {
        setBudgetError(parsed.error)
        return
      }
      cap = parsed.cap
      setBudgetError(null)
    }
    setSecret('')
    setShown(false)
    void run(async () => {
      const added = await client.addKey({
        provider,
        name: name.trim() || DEFAULT_NAME[provider],
        secret: next,
        cap,
        projectIds: []
      })
      if (provider === 'anthropic') {
        remember(
          {
            key: added,
            message: added.state === 'ok' ? 'Key works.' : 'Anthropic rejected this key.',
            reason: added.state === 'warning' ? 'rejected' : null
          },
          added.state === 'warning'
            ? 'Anthropic rejected this key. Check the key and paste it again.'
            : 'Key works.'
        )
      } else {
        setMessage('Key saved. Test it to see if it works.')
        setReason(null)
      }
    }, next)
  }

  return (
    <div className="key-editor">
      {saved ? (
        <div className="key-saved">
          <div className="key-meta">
            <span className="key-name">{saved.name}</span>
            <span className={`st st-${displayState}`}>{connectionStateLabel(displayState)}</span>
            <p className="hint">
              {hint ? (
                <span className="mono">{hint}</span>
              ) : (
                'Saved in the keychain. No hint for a short key.'
              )}
              {' · '}
              {projectsLabel(saved.projectIds)}
              {showBudget ? ` · ${capLabel(saved.cap)}` : ''}
            </p>
          </div>
          <div className="inline key-row">
            <button
              type="button"
              role="switch"
              className={saved.on ? 'switch on' : 'switch'}
              aria-checked={saved.on}
              aria-label={`Use ${saved.name}`}
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  await client.setKeyOn({ id: saved.id, on: !saved.on })
                  setMessage(saved.on ? `${saved.name} is off.` : `${saved.name} is on.`)
                })
              }}
            >
              <span className="knob" />
            </button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const tested = await client.testKey({ id: saved.id })
                  const nextReason = keyWarningReason(tested)
                  setReason(nextReason)
                  setMessage(nextReason ? warningCopy(saved.provider, nextReason) : tested.message)
                })
              }}
            >
              Test
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setReplacing((value) => !value)}>
              Replace key
            </Button>
          </div>
          <form
            className="inline"
            onSubmit={(event) => {
              event.preventDefault()
              const next = name.trim()
              if (!next) {
                setFieldError('Enter a name.')
                return
              }
              void run(async () => {
                await client.renameKey({ id: saved.id, name: next })
                setMessage('Name saved.')
              })
            }}
          >
            <label className="field-label" htmlFor={`${idBase}-name`}>
              Name
            </label>
            <input
              id={`${idBase}-name`}
              className="ob-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={busy}>
              Rename
            </Button>
          </form>
          {replacing ? (
            <form
              className="field"
              onSubmit={(event) => {
                event.preventDefault()
                const next = secret
                if (next.trim().length === 0) {
                  setFieldError(`Paste a new ${title} key.`)
                  return
                }
                setSecret('')
                setShown(false)
                void run(async () => {
                  const replaced = await client.replaceKey({ id: saved.id, secret: next })
                  setReplacing(false)
                  setReason(
                    provider === 'anthropic' && replaced.state === 'warning' ? 'rejected' : null
                  )
                  setMessage(
                    provider === 'anthropic' && replaced.state === 'warning'
                      ? warningCopy('anthropic', 'rejected')
                      : 'Key replaced. Test it to see if it works.'
                  )
                }, next)
              }}
            >
              <label className="field-label" htmlFor={secretId}>
                New {title} key
              </label>
              <KeySecretRow
                id={secretId}
                value={secret}
                shown={shown}
                error={fieldError}
                errorId={errorId}
                onToggle={() => setShown((value) => !value)}
                onChange={(value) => {
                  setSecret(value)
                  setFieldError(null)
                }}
              />
              <Button type="submit" size="sm" disabled={busy}>
                Save new key
              </Button>
            </form>
          ) : null}
          {showBudget ? (
            <form
              className="field"
              onSubmit={(event) => {
                event.preventDefault()
                const parsed = parseSearchBudget(budget)
                if ('error' in parsed) {
                  setBudgetError(parsed.error)
                  return
                }
                setBudgetError(null)
                void run(async () => {
                  await client.setKeyCap({ id: saved.id, cap: parsed.cap })
                  setMessage(
                    parsed.cap === null ? 'Cap cleared. No cap.' : 'Monthly search budget saved.'
                  )
                })
              }}
            >
              <label className="field-label" htmlFor={budgetId}>
                Monthly search budget
              </label>
              <div className="inline key-row">
                <input
                  id={budgetId}
                  className="ob-input mono"
                  inputMode="numeric"
                  value={budget}
                  aria-invalid={budgetError ? true : undefined}
                  aria-describedby={describedBy([
                    `${budgetId}-hint`,
                    budgetError ? `${budgetId}-error` : false
                  ])}
                  onChange={(event) => {
                    setBudget(event.target.value)
                    setBudgetError(null)
                  }}
                />
                <span className="faint">searches</span>
                <Button type="submit" size="sm" disabled={busy}>
                  Save budget
                </Button>
              </div>
              <p className="hint" id={`${budgetId}-hint`}>
                Empty means no cap. CiteFox stops before a check would go over this.
              </p>
              {budgetError ? <FieldError id={`${budgetId}-error`}>{budgetError}</FieldError> : null}
            </form>
          ) : null}
        </div>
      ) : (
        <form className="field" onSubmit={submitAdd}>
          <label className="field-label" htmlFor={`${idBase}-name`}>
            Name
          </label>
          <input
            id={`${idBase}-name`}
            className="ob-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label className="field-label" htmlFor={secretId}>
            API key
          </label>
          <KeySecretRow
            id={secretId}
            value={secret}
            shown={shown}
            error={fieldError}
            errorId={errorId}
            onToggle={() => setShown((value) => !value)}
            onChange={(value) => {
              setSecret(value)
              setFieldError(null)
            }}
          />
          {showBudget ? (
            <>
              <label className="field-label" htmlFor={budgetId}>
                Monthly search budget
              </label>
              <input
                id={budgetId}
                className="ob-input mono"
                inputMode="numeric"
                value={budget}
                aria-invalid={budgetError ? true : undefined}
                aria-describedby={describedBy([
                  `${budgetId}-hint`,
                  budgetError ? `${budgetId}-error` : false
                ])}
                onChange={(event) => {
                  setBudget(event.target.value)
                  setBudgetError(null)
                }}
              />
              <p className="hint" id={`${budgetId}-hint`}>
                Empty means no cap.
              </p>
              {budgetError ? <FieldError id={`${budgetId}-error`}>{budgetError}</FieldError> : null}
            </>
          ) : null}
          <Button type="submit" icon="plus" className="key-add" disabled={busy}>
            {addLabel}
          </Button>
        </form>
      )}
      {message ? (
        <div
          className={
            displayReason === 'out_of_searches' || displayState === 'warning'
              ? 'panel-warn'
              : 'panel-ok'
          }
          role={
            displayReason === 'out_of_searches'
              ? 'status'
              : displayState === 'warning'
                ? 'alert'
                : 'status'
          }
          aria-live="polite"
        >
          <p>{message}</p>
          {displayReason === 'out_of_searches' ? <p>{WORKING_KEY_NOTE}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

/** The key input with a show/hide toggle. The value is cleared by the caller after it is sent. */
export function KeySecretRow({
  id,
  value,
  shown,
  error,
  errorId,
  onToggle,
  onChange
}: {
  id: string
  value: string
  shown: boolean
  error: string | null
  errorId: string
  onToggle: () => void
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <div className="inline key-row">
      <SecretField
        kind="key"
        className="ob-input mono"
        id={id}
        shown={shown}
        onShownChange={onToggle}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy([`${id}-hint`, error ? errorId : false])}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="sr-only" id={`${id}-hint`}>
        The key is sent once and cleared from this field. CiteFox stores it in the system keychain.
      </p>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  )
}
