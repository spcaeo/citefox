import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { AiCliProvider } from '@shared/domain'
import type { ClaudeCheckupPhase, ClaudeCheckupProgress, ClaudeCheckupRow } from '@shared/ipc'
import {
  aiCliCopy,
  aiModelLabel,
  checkupProvider,
  cliProviderOf,
  type AiCliCopy
} from '../connections/aiProvider'
import { AiPicker } from './AiPicker'
import { Icon, type IconName } from '../components/Icon'
import { useLatest } from '../components/useLatest'
import { loginStatusLabel, type OnboardingCheckupResult } from './claudeLogin'
import type { OnboardingClient } from './client'
import { formatStoredKeyHint } from './hint'
import { claudeReadyExtra, safeClientMessage } from './copy'
import { PanelIcon } from './parts'
import { StepPage } from './StepPage'
import {
  BusyBar,
  BusyLine,
  BusyMark,
  Button,
  Chip,
  LinkButton,
  Panel,
  SecretField,
  type ChipTone,
  type UsualRange
} from '../ui'
import { USUAL_SECONDS } from './usualTimes'

interface RowView {
  phase: ClaudeCheckupPhase
  title: string
  icon: IconName
  state: ClaudeCheckupProgress['state'] | 'idle'
  detail: string
  status: string
}

function initialRows(copy: AiCliCopy): readonly RowView[] {
  return [
    {
      phase: 'binary',
      title: `${copy.program} installed`,
      icon: 'terminal',
      state: 'idle',
      detail: '',
      status: ''
    },
    { phase: 'login', title: 'Logged in', icon: 'user', state: 'idle', detail: '', status: '' },
    {
      phase: 'roundTrip',
      title: 'Test reply',
      icon: 'message',
      state: 'idle',
      detail: '',
      status: ''
    }
  ]
}

/** What a running row says, in plain words, with its usual time when it has one. */
function runningCopy(
  phase: ClaudeCheckupPhase,
  copy: AiCliCopy
): { label: string; usual: UsualRange | null } {
  if (phase === 'binary') return { label: `Checking the ${copy.program} program`, usual: null }
  if (phase === 'login') return { label: 'Checking you’re logged in', usual: null }
  return { label: `Waiting for ${copy.ai}’s reply`, usual: USUAL_SECONDS.claudeReply }
}

function statusFor(state: ClaudeCheckupProgress['state']): string {
  if (state === 'running') return 'Checking…'
  if (state === 'ok') return 'OK'
  if (state === 'skipped') return 'Skipped'
  return 'Needs a step'
}

function rowsFromResult(result: OnboardingCheckupResult): RowView[] {
  return initialRows(aiCliCopy(checkupProvider(result))).map((row) => {
    const source: ClaudeCheckupRow = result.rows[row.phase]
    const state: RowView['state'] = source.state === 'warning' ? 'warning' : source.state
    const status = row.phase === 'login' ? loginStatusLabel(result) : source.statusLabel
    return { ...row, state, detail: source.detail, status }
  })
}

export function ClaudeScreen({
  client,
  onAnnounce,
  onBack,
  onContinue,
  onChecked,
  onAnthropic,
  continueLabel = 'Continue',
  kicker,
  title,
  lead,
  note,
  after = null
}: {
  client: OnboardingClient
  onAnnounce: (message: string) => void
  onBack: () => void
  onContinue: () => void
  onChecked: (result: OnboardingCheckupResult) => void
  /** Returns an error message, or null when the key was stored. */
  onAnthropic: (secret: string) => Promise<{ error: string | null; hint: string | null }>
  /** Primary label. */
  continueLabel?: string
  /** Onboarding v2: "Step 2 of 8". */
  kicker?: string
  title?: string
  /** Replaces the first paragraph under the heading. */
  lead?: ReactNode
  /** The footer note beside Continue. */
  note?: string
  /** Under the checks: v2's "No Claude? Skip and use your own ChatGPT instead". */
  after?: ReactNode
}): JSX.Element {
  const [provider, setProvider] = useState<AiCliProvider>('claude-code')
  const copy = aiCliCopy(provider)
  const [rows, setRows] = useState<readonly RowView[]>(() => initialRows(copy))
  const [result, setResult] = useState<OnboardingCheckupResult | null>(null)
  const [running, setRunning] = useState(true)
  const [path, setPath] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiMessage, setApiMessage] = useState<string | null>(null)
  const [apiHint, setApiHint] = useState<string | null | undefined>(undefined)
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null)
  const [models, setModels] = useState<{ claudeModel: string | null; codexModel: string | null }>({
    claudeModel: null,
    codexModel: null
  })
  const [pickError, setPickError] = useState<string | null>(null)

  async function applyCheckup(
    binaryPath: string | null,
    chosen: AiCliProvider = provider
  ): Promise<void> {
    setRunning(true)
    try {
      const next = await client.runCheckup({ binaryPath, provider: chosen })
      setResult(next)
      setRows(rowsFromResult(next))
      onChecked(next)
      onAnnounce(`${next.message}${next.nextStep ? ` ${next.nextStep}` : ''}`)
      setRunning(false)
    } catch (error) {
      const message = safeClientMessage(error)
      if (message.includes('superseded')) return
      onAnnounce(message)
      setRunning(false)
    }
  }

  useEffect(() => {
    return client.onCheckupProgress((event) => {
      const title = initialRows(copy).find((row) => row.phase === event.phase)?.title ?? event.phase
      onAnnounce(`${title}: ${statusFor(event.state)}. ${event.detail}`)
      setRows((current) =>
        current.map((row) =>
          row.phase === event.phase
            ? {
                ...row,
                state: event.state,
                detail: event.detail,
                status: statusFor(event.state)
              }
            : row
        )
      )
    })
  }, [client, onAnnounce, copy])

  useEffect(() => {
    let active = true
    void client.getSettings().then(
      (snapshot) => {
        if (!active) return
        // Until the first check answers, show the program Settings chose.
        setProvider((current) =>
          current === 'claude-code' ? cliProviderOf(snapshot.settings.claudeProvider) : current
        )
        setModels({
          claudeModel: snapshot.settings.claudeModel,
          codexModel: snapshot.settings.codexModel ?? null
        })
      },
      () => undefined
    )
    return () => {
      active = false
    }
  }, [client])

  // The first checkup runs once per client. Callbacks are read through refs so a
  // parent re-render does not start another run or call a stale callback.
  const checked = useLatest(onChecked)
  const announce = useLatest(onAnnounce)
  useEffect(() => {
    let active = true
    void client.runCheckup({ binaryPath: null }).then(
      (next) => {
        if (!active) return
        // The first check runs the program Settings chose; the picker follows it.
        setProvider(checkupProvider(next))
        setResult(next)
        setRows(rowsFromResult(next))
        checked.current(next)
        announce.current(`${next.message}${next.nextStep ? ` ${next.nextStep}` : ''}`)
        setRunning(false)
      },
      (error: unknown) => {
        if (!active) return
        const message = safeClientMessage(error)
        if (message.includes('superseded')) return
        announce.current(message)
        setRunning(false)
      }
    )
    return () => {
      active = false
    }
  }, [client, checked, announce])

  const missing = result?.rows.binary.state === 'warning'
  const loggedOut = result?.login === 'logged_out'
  const ready = result?.ready === true
  const readyExtra = result ? claudeReadyExtra(result.message, result.plan) : null
  const otherFailure = result !== null && !ready && !loggedOut && !missing
  const savedHint = apiHint === undefined ? null : formatStoredKeyHint(apiHint)

  /** Saves the choice in Settings, then checks the chosen program. */
  async function pick(next: AiCliProvider): Promise<void> {
    if (next === provider) return
    setProvider(next)
    setPickError(null)
    setResult(null)
    setRows(initialRows(aiCliCopy(next)))
    setPath('')
    try {
      await client.updateSettings({ claudeProvider: next })
    } catch (error) {
      const message = safeClientMessage(error)
      setPickError(message)
      onAnnounce(message)
      return
    }
    onAnnounce(`${aiCliCopy(next).program} chosen. Checking it now.`)
    await applyCheckup(null, next)
  }

  return (
    <StepPage
      {...(kicker ? { kicker } : {})}
      title={title ?? `Check ${copy.program}`}
      sub={
        <>
          {lead ?? (
            <p>
              CiteFox writes buyer profiles, prompts and gap analysis with the AI app already
              installed on this computer, Claude Code or Codex, using your own plan.
            </p>
          )}
          <p className="hint">Model · {aiModelLabel(provider, models)}</p>
        </>
      }
      onBack={onBack}
      note={note ?? `Runs on your ${copy.plan} · no searches`}
      primary={{
        label: continueLabel,
        onClick: () => void continueWithKey(),
        disabled: running
      }}
      railLabel={`About ${copy.program}`}
      rail={
        <Panel title={`How CiteFox uses ${copy.program}`} titleAs="h2">
          {provider === 'codex' ? (
            <p className="hint">
              CiteFox runs <span className="code">codex exec</span> with the shell, file changes,
              plugins and connectors turned off, one question at a time. It never reads or stores
              your ChatGPT sign-in. Your plan covers your own use; for client work or a shared
              computer, use an Anthropic API key instead.
            </p>
          ) : (
            <p className="hint">
              CiteFox runs <span className="code">claude -p</span> with tools turned off, one
              question at a time. It never reads or stores your Claude login. Your plan covers your
              own use; for client work or a shared computer, use an Anthropic API key instead.
            </p>
          )}
          <ApiKeyDisclosure
            apiKey={apiKey}
            apiMessage={apiMessage}
            apiHint={apiHint}
            savedHint={savedHint}
            onChange={(value) => {
              setApiKey(value)
              setApiMessage(null)
            }}
          />
        </Panel>
      }
    >
      <AiPicker value={provider} disabled={running} onChange={(next) => void pick(next)} />
      {pickError ? (
        <p className="field-error" role="alert">
          {pickError}
        </p>
      ) : null}
      <section
        className="ob-card stack ui-busy-host"
        aria-label={`${copy.program} checks`}
        aria-busy={running}
      >
        <BusyBar active={running} />
        <div role="list">
          {rows.map((row) => (
            <CheckRow
              key={row.phase}
              row={row}
              copy={copy}
              checking={running}
              onRecheck={() => void applyCheckup(path.trim() || null)}
            />
          ))}
        </div>

        {ready && result ? (
          <div className="panel-ok" role="status">
            <PanelIcon name="check" tone="ok" />
            <p>
              <span className="tone-ok ob-strong">{result.message}</span>
              {readyExtra ? ` ${readyExtra}` : null}
            </p>
          </div>
        ) : null}

        {loggedOut && result ? (
          <LoggedOutPanel
            copy={copy}
            result={result}
            running={running}
            terminalMessage={terminalMessage}
            onOpen={() => void openTerminal()}
            onRecheck={() => void applyCheckup(path.trim() || null)}
          />
        ) : null}

        {missing && result ? (
          <div className="panel-warn" role="status">
            <div className="inline ob-top">
              <PanelIcon name="warning" tone="warn" />
              <div className="field ob-tight">
                <p className="ob-strong">{result.message}</p>
                <p className="muted">{copy.desktopHint}</p>
                <p className="muted">
                  Or install it: after installing, open Terminal once, run{' '}
                  <span className="code">{copy.loginCommand}</span> and log in. Then check again.
                </p>
              </div>
            </div>
            <LinkButton
              href={copy.installUrl}
              variant="text"
              iconEnd="external"
              className="ob-self-start"
            >
              {copy.installLabel}
            </LinkButton>
            <div className="field">
              <label className="field-label" htmlFor="c-path">
                Path to {copy.binaryName}
              </label>
              <div className="inline">
                <input
                  className="ob-input ob-input-grow ob-code mono"
                  id="c-path"
                  type="text"
                  placeholder={copy.pathPlaceholder}
                  value={path}
                  spellCheck={false}
                  onChange={(event) => setPath(event.target.value)}
                />
                <Button disabled={running} onClick={() => void applyCheckup(path.trim() || null)}>
                  Check again
                </Button>
              </div>
            </div>
            {result.nextStep ? <p className="hint">{result.nextStep}</p> : null}
          </div>
        ) : null}

        {otherFailure && result ? (
          <div className="panel-warn" role="status">
            <div className="inline ob-top">
              <PanelIcon name="warning" tone="warn" />
              <div className="field ob-tight">
                <p className="ob-strong">{result.message}</p>
                {result.nextStep ? <p className="muted">{result.nextStep}</p> : null}
              </div>
            </div>
            <Button
              className="ob-self-start"
              disabled={running}
              onClick={() => void applyCheckup(path.trim() || null)}
            >
              Check again
            </Button>
          </div>
        ) : null}
      </section>
      {after}
    </StepPage>
  )

  async function openTerminal(): Promise<void> {
    try {
      const opened = await client.openTerminal()
      if (!opened.opened) {
        setTerminalMessage(opened.message)
        onAnnounce(opened.message)
      }
    } catch (error) {
      const message = safeClientMessage(error)
      setTerminalMessage(message)
      onAnnounce(message)
    }
  }

  async function continueWithKey(): Promise<void> {
    const secret = apiKey
    if (secret.trim().length === 0) {
      onContinue()
      return
    }
    setApiKey('')
    const outcome = await onAnthropic(secret)
    setApiHint(outcome.hint)
    if (outcome.error) {
      setApiMessage(outcome.error)
      onAnnounce(outcome.error)
      return
    }
    onContinue()
  }
}

function LoggedOutPanel({
  copy,
  result,
  running,
  terminalMessage,
  onOpen,
  onRecheck
}: {
  copy: AiCliCopy
  result: OnboardingCheckupResult
  running: boolean
  terminalMessage: string | null
  onOpen: () => void
  onRecheck: () => void
}): JSX.Element {
  return (
    <div className="panel-warn" role="status">
      <div className="inline ob-top">
        <PanelIcon name="warning" tone="warn" />
        <div className="field ob-tight">
          <p className="ob-strong">{result.message}</p>
          <p className="muted">
            CiteFox never asks for your {copy.provider === 'codex' ? 'ChatGPT' : 'Claude'} password
            or login.
          </p>
        </div>
      </div>
      <ol className="ol-steps">
        <li>
          <span className="ol-num">1</span>
          <span>Open Terminal.</span>
        </li>
        <li>
          <span className="ol-num">2</span>
          <span>
            Run <span className="code">{copy.loginCommand}</span> and follow the login.
          </span>
        </li>
        <li>
          <span className="ol-num">3</span>
          <span>Come back here and check again.</span>
        </li>
      </ol>
      {result.nextStep ? <p className="hint">{result.nextStep}</p> : null}
      <div className="inline">
        <Button onClick={onOpen}>
          <Icon name="terminal" />
          Open Terminal
        </Button>
        <Button disabled={running} onClick={onRecheck}>
          Check again
        </Button>
      </div>
      {terminalMessage ? (
        <p className="field-error" role="alert">
          {terminalMessage}
        </p>
      ) : null}
    </div>
  )
}

/**
 * One checkup row. While it runs: a spinning ring, the plain words and a live
 * timer ("Waiting for Claude’s reply · 4 s · usually 5–10 s"). Rows whose turn
 * has not come show a hollow circle; done rows their ✓ chip.
 */
function CheckRow({
  row,
  copy,
  checking,
  onRecheck
}: {
  row: RowView
  copy: AiCliCopy
  /** The checkup is in flight. */
  checking: boolean
  onRecheck: () => void
}): JSX.Element {
  const runningRow = row.state === 'running'
  const waiting = checking && row.state === 'idle'
  const busy = runningCopy(row.phase, copy)
  return (
    <div className="crow" role="listitem" data-state={waiting ? 'waiting' : row.state}>
      <span className="crow-icon">
        <Icon name={row.icon} size="nav" />
      </span>
      <div className="crow-body">
        <p className="ob-strong">
          {row.phase === 'binary' ? `${copy.program} installed` : row.title}
        </p>
        {runningRow ? (
          <BusyLine
            active
            label={busy.label}
            usual={busy.usual}
            mark={false}
            announce={false}
            slowAction={
              row.phase === 'roundTrip' ? (
                <Button size="sm" variant="text" onClick={onRecheck}>
                  Check again
                </Button>
              ) : undefined
            }
          />
        ) : (
          <p className={row.phase === 'binary' && row.state === 'ok' ? 'mono faint' : 'faint'}>
            {waiting ? '' : row.detail}
          </p>
        )}
      </div>
      {runningRow ? (
        <span className="crow-stat">
          <BusyMark state="running" label="Checking" />
        </span>
      ) : waiting ? (
        <span className="crow-stat crow-wait">
          <BusyMark state="waiting" size="sm" />
          Waiting
        </span>
      ) : row.status ? (
        <span className="crow-stat">
          <Chip tone={statTone(row.state)} size="sm">
            <StatusIcon state={row.state} />
            {row.status}
          </Chip>
        </span>
      ) : null}
    </div>
  )
}

function statTone(state: RowView['state']): ChipTone {
  if (state === 'ok') return 'ok'
  if (state === 'warning') return 'warn'
  return 'neutral'
}

function StatusIcon({ state }: { state: RowView['state'] }): JSX.Element | null {
  if (state === 'ok') return <Icon name="check" size="chev" strong />
  if (state === 'warning') return <Icon name="warning" size="chev" />
  if (state === 'skipped') return <Icon name="minus" size="chev" />
  return null
}

function ApiKeyDisclosure({
  apiKey,
  apiMessage,
  apiHint,
  savedHint,
  onChange
}: {
  apiKey: string
  apiMessage: string | null
  apiHint: string | null | undefined
  savedHint: string | null
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <details className="disc">
      <summary>
        <span className="chev">
          <Icon name="chevron-right" />
        </span>
        Use an Anthropic API key instead
      </summary>
      <div className="field disc-body">
        <label className="field-label" htmlFor="c-apikey">
          Anthropic API key
        </label>
        <div className="inline">
          <SecretField
            kind="key"
            className="ob-input ob-input-grow mono"
            id="c-apikey"
            placeholder="sk-ant-…"
            value={apiKey}
            aria-invalid={apiMessage ? true : undefined}
            aria-describedby="c-apikey-hint"
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        <p className="hint" id="c-apikey-hint">
          Billed to your Anthropic account. Saved in your system keychain.
        </p>
        {apiHint !== undefined ? (
          <p className="hint">
            Key saved
            {savedHint ? (
              <>
                {' · '}
                <span className="mono">{savedHint}</span>
              </>
            ) : null}
          </p>
        ) : null}
        {apiMessage ? (
          <p className="field-error" role="alert">
            {apiMessage}
          </p>
        ) : null}
      </div>
    </details>
  )
}
