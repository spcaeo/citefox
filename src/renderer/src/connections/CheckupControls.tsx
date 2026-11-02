import { useEffect, useState, type JSX } from 'react'
import type { AiCliProvider } from '@shared/domain'
import type { ClaudeCheckupPhase, ClaudeCheckupProgress } from '@shared/ipc'
import { Icon } from '../components/Icon'
import { DrillButton } from '../drill'
import { loginStatusLabel, type OnboardingCheckupResult } from '../onboarding/claudeLogin'
import type { OnboardingClient } from '../onboarding/client'
import { safeClientMessage } from '../onboarding/copy'
import { connectionStateLabel, rollUpClaudeState } from '../keys/health'
import { claudeModelLabel } from '../settings/modelLabel'
import { aiCliCopy, aiModelLabel } from './aiProvider'
import { checkupPathPlan } from './utils/checkupPath'
import { checkupDrill } from './utils/drills'
import { Button } from '../ui'

function phaseTitle(phase: ClaudeCheckupPhase, program: string): string {
  if (phase === 'binary') return `${program} installed`
  return phase === 'login' ? 'Logged in' : 'Test reply'
}

function phaseStatus(state: ClaudeCheckupProgress['state']): string {
  if (state === 'running') return 'Checking…'
  if (state === 'ok') return 'OK'
  if (state === 'skipped') return 'Skipped'
  return 'Needs a step'
}

export function CheckupControls({
  client,
  checkup,
  claudeModel,
  codexModel = null,
  provider = 'claude-code',
  onChanged,
  typedPath,
  savedPath
}: {
  client: OnboardingClient
  checkup: OnboardingCheckupResult | null
  claudeModel: string | null
  /** Settings `codexModel`, shown when `provider` is Codex. */
  codexModel?: string | null
  /** The program to check: Claude Code (default) or Codex. */
  provider?: AiCliProvider
  onChanged: () => Promise<void>
  /** The Claude binary path field as typed (Settings). Omitted where there is no field. */
  typedPath?: string
  /** The stored `claudeBinaryPath`. */
  savedPath?: string | null
}): JSX.Element {
  const [running, setRunning] = useState(false)
  const [live, setLive] = useState('')
  const [error, setError] = useState<string | null>(null)
  const copy = aiCliCopy(provider)
  // A checkup of the other program says nothing about this one.
  const shown =
    checkup !== null && (checkup.provider ?? 'claude-code') === provider ? checkup : null
  const pathPlan = checkupPathPlan(typedPath, savedPath, provider)
  const state = rollUpClaudeState(shown)
  const detail = checkupDetail(shown, copy.program)

  useEffect(() => {
    return client.onCheckupProgress((event) => {
      const title = phaseTitle(event.phase, copy.program)
      setLive(`${title}: ${phaseStatus(event.state)}. ${event.detail}`)
    })
  }, [client, copy.program])

  async function run(): Promise<void> {
    if (pathPlan.error !== null) {
      setError(pathPlan.error)
      return
    }
    setRunning(true)
    setError(null)
    setLive(pathPlan.note ? 'Running checkup with the path you typed…' : 'Running checkup…')
    try {
      const result = await client.runCheckup({ binaryPath: pathPlan.binaryPath, provider })
      const unsaved = pathPlan.note ? 'Checked the path you typed; it is not saved yet. ' : ''
      setLive(`${unsaved}${result.message}${result.nextStep ? ` ${result.nextStep}` : ''}`)
      await onChanged()
    } catch (cause) {
      const message = safeClientMessage(cause)
      if (!message.includes('superseded')) setError(message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="conn">
      <span className="conn-icon" aria-hidden="true">
        <Icon name="terminal" size="nav" />
      </span>
      <div className="conn-copy">
        <span className="key-name">{copy.program} on this computer</span>
        <span className="mono faint">{detail}</span>
        <span className="mono faint">
          Model ·{' '}
          {provider === 'codex'
            ? aiModelLabel('codex', { codexModel })
            : claudeModelLabel(claudeModel)}
        </span>
        <span className="faint">Your own {copy.plan}, for your own projects.</span>
      </div>
      {shown ? (
        <DrillButton
          drill={checkupDrill(shown)}
          className={`st st-${state} conn-status-btn`}
          label={`${copy.program}: ${loginStatusLabel(shown)}. Show the checkup`}
          untracked
        >
          {loginStatusLabel(shown)}
        </DrillButton>
      ) : (
        <span className={`st st-${state}`}>{connectionStateLabel(state)}</span>
      )}
      <Button icon="bolt" disabled={running} onClick={() => void run()}>
        Run checkup
      </Button>
      <p className="hint" role="status" aria-live="polite">
        {error ?? (live || pathPlan.note || '')}
      </p>
    </div>
  )
}

function checkupDetail(checkup: OnboardingCheckupResult | null, program: string): string {
  if (!checkup) return 'Not tested yet'
  const parts = [checkup.binaryPath, checkup.version, checkup.plan].filter((part): part is string =>
    Boolean(part)
  )
  return parts.length > 0 ? parts.join(' · ') : program
}
