import { useId, useMemo, type JSX } from 'react'
import type { SearchProvider } from '@shared/domain'
import { LoadError } from '../../components/LoadError'
import { CLORO_SIGNUP_URL } from '../../keys/providerLinks'
import { sectionHash } from '../../shell/routes'
import { withHashTab } from '../../shell/useHashTab'
import { Button, Chip, Panel, UiIcon } from '../../ui'
import { SaveStatus, Section } from '../components/bits'
import { useSave } from '../hooks/useSave'
import type { SectionProps } from '../types'
import { EngineRow } from './EngineRow'
import { cloroCreditsLeft } from '../../keys/balances'
import { formatCount } from '../../keys/serpUsage'
import { cloroAnswerRange, cloroPlanName, costLines, serpPerQuestion, skippedLine } from './model'
import { createEnginesSettingsSource, type EnginesSettingsSource } from './source'
import { useTrackForm } from './useTrackForm'
import './track.css'

const CONNECTIONS_CLORO = withHashTab(sectionHash('connections'), 'cloro')

/**
 * Project settings › What to track (Engines board, panel 1): which AI answers the
 * project's checks read, who runs the Google search, and what that costs a check and
 * a month, shown before Save. An engine that needs cloro has no key to run on until
 * one is added in Connections, so its box is off. A topic can choose its own engines
 * in its settings drawer; this is everything else.
 */
export function TrackSection({
  projectId,
  keys,
  source: given
}: {
  projectId: string
  /** Every saved key, for the cloro balance on its card. */
  keys: SectionProps['keys']
  source?: EnginesSettingsSource
}): JSX.Element {
  const source = useMemo(() => given ?? createEnginesSettingsSource(), [given])
  const form = useTrackForm(source, projectId)
  const save = useSave()
  const base = useId()
  const view = form.view

  if (view === null) {
    return (
      <Section id="ps-track" title="What to track">
        {form.loadError ? (
          <LoadError
            title="CiteFox could not load what this project tracks."
            message={form.loadError}
            onRetry={form.reload}
          />
        ) : (
          <p role="status" className="hint">
            Loading engines…
          </p>
        )}
      </Section>
    )
  }

  const plan = cloroPlanName(keys)
  const creditsLeft = cloroCreditsLeft(keys)
  const lines = form.estimate ? costLines(form.estimate, form.engines.length) : null
  const skipped = form.estimate
    ? skippedLine(
        form.estimate.skipped.map(
          (engine) => view.options.find((option) => option.id === engine)?.label ?? engine
        )
      )
    : null
  const noEngine = form.engines.length === 0

  async function onSave(): Promise<void> {
    if (noEngine) {
      save.fail('Pick at least one engine.')
      return
    }
    await save.run(form.save, 'What to track is saved.')
  }

  function providerCard(id: SearchProvider): JSX.Element {
    const picked = form.provider === id
    const ready = id === 'cloro' ? view?.cloroReady : view?.serpapiReady
    const textId = `${base}-${id}-text`
    return (
      <div className={`et-prov${picked ? ' on' : ''}${ready ? '' : ' off'}`}>
        <label className="et-prov-pick">
          <input
            type="radio"
            className="sr-only"
            name={`${base}-provider`}
            checked={picked}
            disabled={!ready && !picked}
            aria-describedby={textId}
            onChange={() => form.setProvider(id)}
          />
          <span className="et-prov-title">
            {id === 'cloro' ? 'cloro' : 'SerpApi'}
            {id === 'cloro' ? (
              <Chip size="sm" tone="ok">
                Recommended
              </Chip>
            ) : null}
          </span>
          <span className="et-prov-text" id={textId}>
            {id === 'cloro' ? (
              <>
                Google AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini and Copilot with one key.
                About {cloroAnswerRange(plan)} per answer.
              </>
            ) : (
              <>
                <strong>Google AI Overviews only.</strong> The other engines need cloro. About{' '}
                {serpPerQuestion(null)} per question (two searches).
              </>
            )}
          </span>
        </label>
        <div className="et-prov-foot">
          {id === 'cloro' ? (
            <a className="et-link" href={CLORO_SIGNUP_URL} target="_blank" rel="noreferrer">
              Get a multi-engine search key
              <UiIcon name="external" size={12} />
            </a>
          ) : null}
          <span className="hint">
            {ready ? (
              id === 'cloro' && creditsLeft !== null ? (
                `Key saved in Keychain · ${formatCount(creditsLeft)} credits left`
              ) : (
                'Key saved in Keychain'
              )
            ) : (
              <>
                No {id === 'cloro' ? 'cloro' : 'SerpApi'} key yet.{' '}
                <a
                  href={
                    id === 'cloro'
                      ? CONNECTIONS_CLORO
                      : withHashTab(sectionHash('connections'), 'serpapi')
                  }
                >
                  Add it in Connections
                </a>
              </>
            )}
          </span>
        </div>
      </div>
    )
  }

  return (
    <Section
      id="ps-track"
      title="What to track"
      intro="Which AI answers CiteFox checks for your questions. Applies to every topic unless a topic chooses its own."
    >
      <Panel title="Search provider" titleAs="h3" padding={16} className="et-panel">
        <div className="et-provs" role="radiogroup" aria-label="Search provider">
          {providerCard('cloro')}
          {providerCard('serpapi')}
        </div>
      </Panel>
      <Panel
        title={
          <>
            Engines <span className="et-head-note">credits for one question in one market</span>
          </>
        }
        titleAs="h3"
        padding={16}
        className="et-panel"
      >
        {view.cloroReady ? null : (
          <p className="et-need" id={`${base}-need`}>
            ChatGPT, Perplexity, Google AI Mode, Gemini and Copilot need a multi-engine search key.{' '}
            <a href={CONNECTIONS_CLORO}>Add one in Connections</a>, or{' '}
            <a className="et-link" href={CLORO_SIGNUP_URL} target="_blank" rel="noreferrer">
              sign up at cloro
              <UiIcon name="external" size={12} />
            </a>
          </p>
        )}
        <ul className="et-list" aria-label="Engines">
          {view.options.map((option) => (
            <EngineRow
              key={option.id}
              option={option}
              picked={form.engines.includes(option.id)}
              provider={form.provider}
              counts={form.counts.get(option.id)}
              needId={view.cloroReady ? undefined : `${base}-need`}
              onToggle={(on) => form.toggle(option.id, on)}
            />
          ))}
        </ul>
        {view.overrides > 0 ? (
          <p className="hint">
            {view.overrides === 1
              ? '1 topic or page chooses its own engines.'
              : `${view.overrides} topics and pages choose their own engines.`}{' '}
            Change one in its settings.
          </p>
        ) : null}
      </Panel>
      <div className="et-foot">
        <div className="et-cost" role="status" aria-live="polite" data-testid="engines-cost">
          {noEngine ? (
            <span className="field-error">Pick at least one engine.</span>
          ) : form.estimateError ? (
            <span className="field-error">{form.estimateError}</span>
          ) : lines ? (
            <>
              <strong>{lines.month}</strong> <span className="hint">· {lines.check}</span>
              {skipped ? <span className="hint et-skipped">{skipped}</span> : null}
            </>
          ) : (
            <span className="hint">Working out the cost…</span>
          )}
        </div>
        <div className="et-foot-actions">
          <Button disabled={!form.dirty || save.state.kind === 'saving'} onClick={form.reset}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={save.state.kind === 'saving'}
            disabled={!form.dirty || save.state.kind === 'saving'}
            onClick={() => void onSave()}
          >
            Save
          </Button>
        </div>
      </div>
      <SaveStatus state={save.state} />
    </Section>
  )
}
