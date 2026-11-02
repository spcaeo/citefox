import { useState, type JSX } from 'react'
import { ENGINE_LABEL, type ApiKeyMetadata } from '@shared/domain'
import {
  guessPromptShape,
  MAX_SHAPE_COUNT,
  mixTotal,
  PROMPT_SHAPES,
  type EngineOption,
  type PromptMix,
  type PromptShape,
  type SetupItem
} from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { ClaudeWait, LinkedText, useClaudePause } from '../../components/claudePause'
import { BusyLine, Button, Chip, IconButton } from '../../ui'
import { withList } from '../sections/draftOps'
import { makeItemId, rowKey } from '../sections/merge'
import { stepKicker } from '../setupSteps'
import { StepPage } from '../StepPage'
import { USUAL_SECONDS } from '../usualTimes'
import { effectiveEngines, fitMix, promptCost, searchBalance } from './engineCost'
import { SHAPE_COPY, shapeOf } from './shapeCopy'
import { ShapesRail } from './ShapesRail'
import type { SetupStepProps } from './types'
import type { ShapeExamples } from './useShapeExamples'
import './setup-steps.css'

export interface ShapesStepProps extends SetupStepProps {
  keys: readonly ApiKeyMetadata[]
  engineOptions: readonly EngineOption[]
  examples: ShapeExamples
  /** Null while CiteFox still asks whether Claude can run here. */
  claudeAvailable: boolean | null
}

function units(count: number, serpapi: boolean): string {
  return `${count.toLocaleString('en-US')} ${serpapi ? (count === 1 ? 'search' : 'searches') : count === 1 ? 'credit' : 'credits'}`
}

/** Pasted lines as the user's own prompts, each with the shape it reads as. */
function ownItems(text: string, taken: readonly SetupItem[]): SetupItem[] {
  const seen = new Set(taken.map((item) => rowKey(item.name)))
  const out: SetupItem[] = []
  for (const raw of text.split(/\r?\n/u)) {
    const name = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, '').trim()
    const key = rowKey(name)
    if (name.length < 3 || seen.has(key)) continue
    seen.add(key)
    out.push({
      id: makeItemId(),
      name: name.slice(0, 500),
      detail: guessPromptShape(name),
      url: null,
      tag: null,
      origin: 'user',
      kept: true,
      edited: false,
      fresh: false
    })
  }
  return out
}

/**
 * Step 8, "How do your buyers ask AI?" (owner feedback 2026-10-25): the mix of prompt
 * shapes the first check covers (short searches, questions, situations), each with an
 * example from the user's own site that Claude wrote in the background after step 3,
 * what tracking it shows, and a count. "I have my own list" takes pasted prompts. The
 * credit line compares the first check with what the keys have left, and "Fit to my
 * credits" scales the mix down. Continue (OnboardingApp) writes step 9's prompts.
 */
export function ShapesStep({
  draft,
  onDraft,
  onBack,
  onContinue,
  busy,
  alert,
  announce,
  keys,
  engineOptions,
  examples,
  claudeAvailable
}: ShapesStepProps): JSX.Element {
  const [pasted, setPasted] = useState('')
  const [ownOpen, setOwnOpen] = useState(false)
  const pause = useClaudePause(Boolean(examples.error), null)
  const { mix } = draft
  const { provider, engines } = draft.search
  const serpapi = provider === 'serpapi'
  const domain = draft.site.domain.trim()
  const brand = draft.lists.brands.find((item) => item.kept)?.name ?? (domain || 'your brand')
  const picked = effectiveEngines(engines, provider)
  const own = draft.lists.questions.filter((item) => item.origin === 'user')
  const total = mixTotal(mix) + own.length
  const perPrompt = promptCost(provider, engines, engineOptions)
  const needed = total * perPrompt
  const balance = searchBalance(keys, provider)
  const short = balance !== null && needed > balance
  const fits = perPrompt > 0 && balance !== null ? Math.floor(balance / perPrompt) : null

  function setCount(shape: PromptShape, count: number): void {
    const next = Math.max(0, Math.min(MAX_SHAPE_COUNT, count))
    onDraft((current) => ({ ...current, mix: { ...current.mix, [shape]: next } }))
  }

  function fitToCredits(): void {
    if (fits === null) return
    const room = Math.max(0, fits - own.length)
    const next: PromptMix = fitMix(mix, room)
    onDraft((current) => ({ ...current, mix: next }))
    announce(`The mix now fits your ${units(balance ?? 0, serpapi)}: ${mixTotal(next)} prompts.`)
  }

  function addOwn(): void {
    const items = ownItems(pasted, draft.lists.questions)
    if (items.length === 0) {
      announce('Nothing new to add: one prompt per line.')
      return
    }
    onDraft((current) => withList(current, 'questions', (now) => [...items, ...now]))
    setPasted('')
    announce(`${pluralize(items.length, 'prompt')} of your own added.`)
  }

  function removeOwn(id: string): void {
    onDraft((current) =>
      withList(current, 'questions', (now) => now.filter((item) => item.id !== id))
    )
  }

  const note =
    total === 0
      ? 'Pick at least one prompt'
      : `${pluralize(total, 'prompt')} × ${pluralize(picked.length, 'answer')} · ${units(needed, serpapi)}`

  return (
    <StepPage
      kicker={stepKicker('shapes')}
      title="How do your buyers ask AI?"
      sub="Buyers ask in three ways, and each shows you something different. Pick the mix for your first check."
      onBack={onBack}
      note={note}
      primary={{
        label: mixTotal(mix) === 0 ? 'Continue with my list' : 'Write my prompts',
        onClick: onContinue,
        disabled: busy || total === 0,
        busy,
        icon: null
      }}
      alert={alert}
      rail={
        <ShapesRail
          domain={domain}
          claude={claudeAvailable}
          examplesBusy={examples.busy}
          hasExamples={draft.lists.examples.length > 0}
        />
      }
      railLabel="Keywords, questions and prompts"
    >
      <section className="panel-ok obs-outcome" aria-labelledby="s8-outcome">
        <h2 className="obs-card-title" id="s8-outcome">
          After your first check, you will know
        </h2>
        <ul className="obs-outcome-list">
          <li>How often AI names {brand}, engine by engine</li>
          <li>Which of your pages it quotes, and which it skips</li>
          <li>Which rivals it recommends instead</li>
          <li>What to fix first to be cited more</li>
        </ul>
      </section>

      <BusyLine
        active={examples.busy}
        label={`Claude is writing examples from ${domain || 'your site'}`}
        usual={USUAL_SECONDS.firstQuestions}
        announce={announce}
        className="osc-hint osc-running"
      />
      {examples.error ? (
        <p className="hint tone-warn" role="status">
          <LinkedText text={examples.error} />{' '}
          {pause ? (
            <ClaudeWait pause={pause} look="link" className="obs-link" />
          ) : (
            <button type="button" className="obs-link" onClick={examples.retry}>
              Try again
            </button>
          )}
        </p>
      ) : null}

      <div className="obs-shapes">
        {PROMPT_SHAPES.map((shape) => {
          const copy = SHAPE_COPY[shape]
          const example = draft.lists.examples.find((item) => item.tag === shape) ?? null
          const count = mix[shape]
          const titleId = `s8-${shape}`
          return (
            <section
              key={shape}
              className={`ob-card obs-shape${count > 0 ? ' on' : ''}`}
              aria-labelledby={titleId}
            >
              <h3 className="obs-card-title" id={titleId}>
                {copy.title}
              </h3>
              <p className="obs-shape-how">{copy.how}</p>
              <p className={`obs-shape-like${example ? '' : ' generic'}`}>
                <span className="obs-shape-label">
                  {example ? `Like, for ${domain || 'you'}` : 'Like'}
                </span>
                <q>{example?.name ?? copy.like}</q>
              </p>
              <p className="obs-shape-outcome">{example?.detail || copy.outcome}</p>
              <div className="obs-shape-best">
                <span className="obs-shape-label">Best seen in</span>
                <span className="obs-chips">
                  {copy.bestIn
                    .filter((engine) => !serpapi || engine === 'google_aio')
                    .map((engine) => (
                      <Chip
                        key={engine}
                        size="sm"
                        tone={picked.includes(engine) ? 'ok' : 'neutral'}
                      >
                        {ENGINE_LABEL[engine]}
                      </Chip>
                    ))}
                </span>
              </div>
              <div
                className="obs-stepper"
                role="group"
                aria-label={`How many ${copy.title.toLowerCase()}`}
              >
                <button
                  type="button"
                  className="ui-icon-btn ui-icon-btn-sm obs-stepper-minus"
                  aria-label={`Fewer ${copy.title.toLowerCase()}`}
                  disabled={count === 0}
                  onClick={() => setCount(shape, count - 1)}
                >
                  <span aria-hidden="true">−</span>
                </button>
                <input
                  className="ob-input obs-stepper-input num"
                  type="number"
                  min={0}
                  max={MAX_SHAPE_COUNT}
                  value={count}
                  aria-label={`Number of ${copy.title.toLowerCase()}`}
                  onChange={(event) => setCount(shape, Number(event.target.value) || 0)}
                />
                <IconButton
                  icon="plus"
                  size="sm"
                  label={`More ${copy.title.toLowerCase()}`}
                  disabled={count >= MAX_SHAPE_COUNT}
                  onClick={() => setCount(shape, count + 1)}
                />
              </div>
            </section>
          )
        })}
      </div>

      <section className="ob-card obs-own" aria-labelledby="s8-own">
        <div className="obs-own-head">
          <h2 className="obs-card-title" id="s8-own">
            I have my own list
          </h2>
          {own.length > 0 ? <Chip size="sm">{pluralize(own.length, 'prompt')}</Chip> : null}
          <span className="obs-grow" />
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={ownOpen}
            onClick={() => setOwnOpen((open) => !open)}
          >
            {ownOpen ? 'Close' : 'Paste prompts'}
          </Button>
        </div>
        <p className="hint">
          Keywords from your SEO tool, questions from sales calls, prompts you already track: one
          per line. They are checked alongside the mix; set the counts above to 0 to check only
          yours.
        </p>
        {ownOpen ? (
          <div className="stack">
            <textarea
              className="ob-input obs-own-text"
              rows={5}
              value={pasted}
              aria-label="Your own prompts, one per line"
              placeholder={'sms api for clinics\nwhat is the best way to text patients?'}
              onChange={(event) => setPasted(event.target.value)}
            />
            <div className="inline">
              <Button size="sm" disabled={pasted.trim().length === 0} onClick={addOwn}>
                Add to my prompts
              </Button>
            </div>
          </div>
        ) : null}
        {own.length > 0 ? (
          <ul className="obs-own-list">
            {own.map((item) => (
              <li key={item.id}>
                <Chip size="sm">{SHAPE_COPY[shapeOf(item)].one}</Chip>
                <span className="obs-own-name">{item.name}</span>
                <IconButton
                  icon="x"
                  size="sm"
                  label={`Remove ${item.name}`}
                  onClick={() => removeOwn(item.id)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {total > 0 && picked.length > 0 ? (
        <div
          className={`${short ? 'panel-warn' : 'panel-ok'} obs-cost`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">{short ? '!' : '≈'}</span>
          <div className="stack">
            <p>
              First check: {pluralize(total, 'prompt')} × {pluralize(picked.length, 'answer')} ={' '}
              <strong>{units(needed, serpapi)}</strong>.{' '}
              {balance === null
                ? `Your ${serpapi ? 'SerpApi' : 'cloro'} key did not report what it has left.`
                : short
                  ? `Your ${serpapi ? 'SerpApi' : 'cloro'} keys have ${units(balance, serpapi)} left, enough for ${pluralize(fits ?? 0, 'prompt')}.`
                  : `Your ${serpapi ? 'SerpApi' : 'cloro'} keys have ${units(balance, serpapi)} left, so it fits.`}
            </p>
            {short ? (
              <div className="inline">
                <Button size="sm" disabled={(fits ?? 0) <= own.length} onClick={fitToCredits}>
                  Fit to my credits
                </Button>
                <Button size="sm" variant="text" onClick={onBack}>
                  Add a key or more credits
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </StepPage>
  )
}
