import { useEffect, useId, useState, type JSX } from 'react'
import {
  engineOnProvider,
  INTERVAL_DAYS,
  intervalLabel,
  normaliseEngines,
  type ApiKeyMetadata,
  type EngineId,
  type SearchProvider
} from '@shared/domain'
import type { EngineOption, SetupDraft } from '@shared/ipc'
import { KeySteps } from '../../keys/KeySteps'
import { KEY_GUIDES } from '../../keys/providerLinks'
import { isOutOfSearches } from '../../keys/usage'
import { BusyBar, BusyLine, Button, Chip, SecretField } from '../../ui'
import type { OnboardingClient } from '../client'
import { safeClientMessage } from '../copy'
import type { SetupServices } from '../setupServices'
import { stepKicker } from '../setupSteps'
import { StepPage } from '../StepPage'
import { USUAL_SECONDS } from '../usualTimes'
import {
  checkCost,
  dailyCostNote,
  effectiveEngines,
  engineCredits,
  monthlyLine,
  planFor,
  questionsToPrice
} from './engineCost'
import type { SetupStepProps } from './types'
import { PROVIDER_LOGOS } from '../../keys/providerLogos'
import { EnginesRail } from './EnginesRail'
import { useEngineChoices } from './useEngineChoices'
import './setup-steps.css'

/**
 * Every day … every 90 days (7 is the default). 0 is "on demand only": the project is
 * paused, and checks run when the user presses Check now.
 */
const EVERY_DAYS = [
  ...INTERVAL_DAYS.map((days) => ({ value: days, label: intervalLabel(days) })),
  { value: 0, label: 'On demand only' }
] as const

export interface EnginesStepProps extends SetupStepProps {
  client: Pick<OnboardingClient, 'addKey' | 'replaceKey' | 'testKey'>
  services: SetupServices
  /** The project saved when the user left step 6. Null before that. */
  projectId: string | null
  keys: readonly ApiKeyMetadata[]
  /** A key was added or tested. */
  onKey: (key: ApiKeyMetadata) => void
  /** The engine list with its credits, for step 8's "First check" line. */
  onOptions?: (options: readonly EngineOption[]) => void
}

function keyWorks(key: ApiKeyMetadata | null): boolean {
  return key !== null && key.on && key.state === 'ok'
}

function balance(key: ApiKeyMetadata): string {
  if (key.cloroCredits) return ` · ${key.cloroCredits.remaining.toLocaleString('en-US')} credits`
  const usage = key.serpapiUsage
  if (usage && usage.planLimit !== null) {
    return ` · ${Math.max(0, usage.planLimit - usage.used).toLocaleString('en-US')} searches left`
  }
  return ''
}

/**
 * Step 7, "Which AI answers should CiteFox check?": cloro (Recommended, every engine)
 * or SerpApi (Google AI Overviews only), the key (tested before it is saved), the
 * engines with their credits, "Every 7 days" (or every day … 90 days), and the cost,
 * worked out live as the ticks change. Continue tests a typed key first; OnboardingApp then saves the
 * engines and the schedule.
 */
export function EnginesStep({
  draft,
  onDraft,
  onBack,
  onContinue,
  busy,
  alert,
  announce,
  client,
  services,
  projectId,
  keys,
  onKey,
  onOptions
}: EnginesStepProps): JSX.Element {
  const groupName = useId()
  const { provider, engines, everyDays } = draft.search
  const providerKeys = keys.filter((key) => key.provider === provider)
  // The key the step speaks about: the first that works, else the first saved.
  const saved = providerKeys.find(keyWorks) ?? providerKeys[0] ?? null
  // With a working key, the field adds another one (checks move on to it when one runs out).
  const adding = keyWorks(saved)
  const [secret, setSecret] = useState('')
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const { options, estimate } = useEngineChoices(services, projectId, provider, engines)
  const picked = effectiveEngines(engines, provider)
  const cost = checkCost({
    provider,
    engines: picked,
    options,
    questions: questionsToPrice(draft),
    everyDays,
    plan: planFor(provider, estimate)
  })
  const guide = KEY_GUIDES[provider]
  const perQuestion = effectiveEngines(engines, 'cloro').reduce(
    (sum, engine) => sum + engineCredits(engine, options),
    0
  )
  const ready = keyWorks(saved) || secret.trim().length > 0
  const dailyNote = dailyCostNote(everyDays)

  useEffect(() => {
    onOptions?.(options)
  }, [options, onOptions])

  function patchSearch(next: Partial<SetupDraft['search']>): void {
    onDraft((current) => ({ ...current, search: { ...current.search, ...next } }))
  }

  function pickProvider(next: SearchProvider): void {
    patchSearch({ provider: next })
    setSecret('')
    setMessage(null)
  }

  function toggle(engine: EngineId, on: boolean): void {
    onDraft((current) => ({
      ...current,
      search: {
        ...current.search,
        engines: normaliseEngines(
          on
            ? [...current.search.engines, engine]
            : current.search.engines.filter((item) => item !== engine)
        )
      }
    }))
  }

  /** Adds (or replaces) and tests the typed key. True when it works. */
  async function testKey(): Promise<boolean> {
    const typed = secret
    if (typed.trim().length === 0) return keyWorks(saved)
    setTesting(true)
    setMessage(null)
    try {
      const meta =
        saved && !adding
          ? await client.replaceKey({ id: saved.id, secret: typed })
          : await client.addKey({
              provider,
              name:
                providerKeys.length === 0 ? guide.name : `${guide.name} ${providerKeys.length + 1}`,
              secret: typed,
              cap: null,
              projectIds: []
            })
      const tested = await client.testKey({ id: meta.id })
      onKey(tested.key)
      const works = tested.key.state === 'ok' || isOutOfSearches(tested)
      setMessage({ text: tested.message, ok: works })
      announce(tested.message)
      return works
    } catch (error) {
      const text = safeClientMessage(error, typed)
      setMessage({ text, ok: false })
      announce(text)
      return false
    } finally {
      // The typed key never stays on screen once tested, whether it worked or not.
      setSecret('')
      setTesting(false)
    }
  }

  async function submit(): Promise<void> {
    if (picked.length === 0) return
    if (await testKey()) onContinue()
  }

  const keyField = (
    <div className="field">
      <label className="field-label" htmlFor="s7-key">
        {adding ? `Add another ${guide.name} key` : `${guide.name} API key`}
      </label>
      <div className="inline">
        <SecretField
          kind="key"
          className="ob-input ob-input-grow mono"
          id="s7-key"
          value={secret}
          placeholder={provider === 'cloro' ? 'sk_live_…' : 'Paste your key'}
          aria-invalid={message && !message.ok ? true : undefined}
          aria-describedby={message ? 's7-key-message' : undefined}
          onChange={(event) => {
            setSecret(event.target.value)
            setMessage(null)
          }}
        />
        <Button
          busy={testing}
          busyLabel="Testing…"
          disabled={secret.trim().length === 0 && !testing}
          onClick={() => void testKey()}
        >
          {adding ? 'Test and add' : 'Test key'}
        </Button>
      </div>
      <BusyLine
        active={testing}
        label={`Testing your ${guide.name} key`}
        usual={USUAL_SECONDS.keyTest}
        announce={announce}
      />
      {adding ? (
        <p className="hint">
          Optional. When one key runs out of credits, CiteFox moves on to the next.
        </p>
      ) : null}
      {message ? (
        <p
          id="s7-key-message"
          className={message.ok ? 'hint tone-ok' : 'field-error'}
          role={message.ok ? 'status' : 'alert'}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  )

  return (
    <StepPage
      kicker={stepKicker('engines')}
      title="Which AI answers should CiteFox check?"
      onSubmit={() => void submit()}
      onBack={onBack}
      note={`${picked.length} ${picked.length === 1 ? 'engine' : 'engines'}`}
      primary={{
        label: 'Continue',
        onClick: () => void submit(),
        disabled: busy || testing || !ready || picked.length === 0,
        busy: busy || testing
      }}
      alert={alert}
      rail={<EnginesRail perQuestion={perQuestion} />}
      railLabel="About cloro and SerpApi"
    >
      <div className="obs-ways obs-ways-2" role="radiogroup" aria-label="Who runs the checks">
        <label className={`obs-way${provider === 'cloro' ? ' on' : ''}`}>
          <input
            type="radio"
            className="sr-only"
            name={groupName}
            checked={provider === 'cloro'}
            onChange={() => pickProvider('cloro')}
          />
          <span className="obs-way-title">
            <img
              className="obs-way-logo"
              src={PROVIDER_LOGOS.cloro}
              alt=""
              width={20}
              height={20}
            />
            cloro{' '}
            <Chip tone="ok" size="sm">
              Recommended
            </Chip>
          </span>
          <span className="obs-way-text">
            Google AI Overview, ChatGPT, Perplexity, AI Mode, Gemini, Copilot.
          </span>
        </label>
        <label className={`obs-way${provider === 'serpapi' ? ' on' : ''}`}>
          <input
            type="radio"
            className="sr-only"
            name={groupName}
            checked={provider === 'serpapi'}
            onChange={() => pickProvider('serpapi')}
          />
          <span className="obs-way-title">
            <img
              className="obs-way-logo"
              src={PROVIDER_LOGOS.serpapi}
              alt=""
              width={20}
              height={20}
            />
            SerpApi
          </span>
          <span className="obs-way-text">Google AI Overviews only.</span>
        </label>
      </div>

      {saved && adding ? (
        <section
          className="ob-card stack ui-busy-host"
          aria-label={`${guide.name} keys`}
          aria-busy={testing || undefined}
        >
          <BusyBar active={testing} />
          <ul className="obs-key-list">
            {providerKeys.map((key) => (
              <li key={key.id} className="obs-key-ok">
                <Chip tone={keyWorks(key) ? 'ok' : 'warn'} size="sm">
                  {keyWorks(key) ? `✓ works${balance(key)}` : 'not working'}
                </Chip>
                <span className="hint">
                  {key.name} · <span className="mono">{key.maskedKey ?? key.hint}</span>
                </span>
              </li>
            ))}
          </ul>
          {keyField}
        </section>
      ) : (
        <section
          className="ob-card ui-busy-host"
          aria-label={`${guide.name} key`}
          aria-busy={testing || undefined}
        >
          <BusyBar active={testing} />
          <KeySteps provider={provider} hasAccount={saved !== null}>
            {keyField}
          </KeySteps>
        </section>
      )}

      <section className="ob-card obs-engines" aria-labelledby="s7-engines-title">
        <div className="obs-engines-head">
          <h2 className="obs-card-title" id="s7-engines-title">
            Engines
          </h2>
          <Chip size="sm">
            {picked.length} of {provider === 'serpapi' ? 1 : options.length}
          </Chip>
          <span className="obs-grow" />
          <label className="hint" htmlFor="s7-every">
            Checks run
          </label>
          <select
            id="s7-every"
            className="ob-input obs-every"
            value={everyDays}
            onChange={(event) => patchSearch({ everyDays: Number(event.target.value) })}
          >
            {EVERY_DAYS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <ul className="obs-engine-list">
          {options.map((option) => {
            const reachable = engineOnProvider(option.id, provider)
            const checked = reachable && engines.includes(option.id)
            return (
              <li key={option.id} className={`obs-engine${reachable ? '' : ' off'}`}>
                <label className="obs-engine-label">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!reachable}
                    onChange={(event) => toggle(option.id, event.target.checked)}
                  />
                  <span>{option.label}</span>
                  {option.id === 'perplexity' ? <Chip size="sm">sometimes unavailable</Chip> : null}
                  {!reachable ? <Chip size="sm">needs cloro</Chip> : null}
                </label>
                <span className="num obs-engine-credits">
                  {provider === 'serpapi'
                    ? reachable
                      ? '1 search'
                      : ''
                    : `${engineCredits(option.id, options)} credits`}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {picked.length > 0 ? (
        <div className="panel-ok obs-cost" role="status" aria-live="polite">
          <span aria-hidden="true">≈</span>
          <p>
            {monthlyLine(cost, everyDays)}. You can press Check now at any time, and set the time of
            day, quiet hours or a pause in Project settings › Schedule.
            {dailyNote ? (
              <>
                {' '}
                <strong>{dailyNote}</strong>
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <p className="field-error" role="alert">
          Tick at least one engine.
        </p>
      )}
    </StepPage>
  )
}
