import { useEffect, useId, useState, type JSX } from 'react'
import { SETUP_PROGRESS_CHANNEL } from '@shared/ipc'
import type { PagePipeline, PagePipelineStep, PagePipelineStepId } from '@shared/ipc'
import { sectionHash } from '../../shell/routes'
import { AssistProgress, Button, LinkButton, UiIcon, useAssistProgress } from '../../ui'
import { elapsedLabel, panelTitle, retryLabel, waitingLine } from './model'
import './pipeline.css'

const MOVING: ReadonlySet<PagePipeline['state']> = new Set(['queued', 'running'])

export interface SetupPanelProps {
  pipeline: PagePipeline
  /** The step this tab shows once it is done, such as `prompts` on the Prompts tab. */
  waitingFor?: PagePipelineStepId
  busy?: boolean
  error?: string | null
  onStart: () => void
  onStop: () => void
}

/**
 * "Setting up this page" (owner feedback 5): the automatic pipeline's live
 * steps (Read page ✓ · Buyer profile ⟳ · Prompts · Content gaps · Ready), the
 * elapsed time, what Claude is doing now, and the failing step's one action
 * (Retry, Resume, or Fix in Connections). Nothing to press while it works.
 * Under the steps, the shared `AssistProgress` panel (owner feedback 1) shows
 * what is happening right now: the page read, each Claude call with its timer.
 */
export function SetupPanel({
  pipeline,
  waitingFor,
  busy = false,
  error = null,
  onStart,
  onStop
}: SetupPanelProps): JSX.Element {
  const titleId = useId()
  const moving = MOVING.has(pipeline.state)
  const elapsed = useElapsed(pipeline.startedAt, pipeline.state === 'running')
  const action = pipeline.action
  const problem = pipeline.state === 'failed' || pipeline.state === 'retrying'
  const live = useAssistProgress(
    pipeline.state === 'running',
    SETUP_PROGRESS_CHANNEL,
    pipeline.pageId
  )
  return (
    <section
      className="ui-panel psu-panel"
      aria-labelledby={titleId}
      data-state={pipeline.state}
      data-testid="setup-panel"
    >
      <div className="psu-head">
        <div className="psu-titles">
          <p className="psu-eyebrow">Automatic setup · no searches</p>
          <h2 id={titleId} className="psu-title">
            {panelTitle(pipeline.state)}
          </h2>
        </div>
        <div className="psu-side">
          {elapsed !== null ? (
            <span className="psu-elapsed" title="Time since this run started">
              <span className="sr-only">Elapsed </span>
              {elapsed}
            </span>
          ) : null}
          {moving ? (
            <Button variant="ghost" size="sm" onClick={onStop} busy={busy}>
              Stop
            </Button>
          ) : null}
        </div>
      </div>

      <ol className="psu-steps" aria-label="Setup steps">
        {pipeline.steps.map((step, index) => (
          <StepItem
            key={step.id}
            step={step}
            index={index}
            last={index === pipeline.steps.length - 1}
          />
        ))}
      </ol>

      <p className="psu-message" role="status" aria-live="polite">
        {pipeline.message}
      </p>
      {waitingFor !== undefined && moving ? (
        <p className="psu-note">{waitingLine(waitingFor)}</p>
      ) : null}
      {live.steps.length > 0 ? (
        <AssistProgress
          progress={live}
          title="What CiteFox is doing now"
          reads="uses the page, no searches"
        />
      ) : null}

      {problem && pipeline.error !== null && pipeline.error !== pipeline.message ? (
        <p className="psu-problem">
          <UiIcon name="warning" size={16} />
          <span>{pipeline.error}</span>
        </p>
      ) : null}
      {pipeline.state === 'retrying' && pipeline.retryAt !== null ? (
        <p className="psu-note">{retryLabel(pipeline.retryAt, pipeline.attempts)}</p>
      ) : null}
      {error !== null ? (
        <p className="psu-problem" role="alert">
          <UiIcon name="warning" size={16} />
          <span>{error}</span>
        </p>
      ) : null}

      {action !== null ? (
        <div className="psu-actions">
          {action.kind === 'connections' ? (
            <LinkButton variant="primary" href={sectionHash('connections')}>
              {action.label}
            </LinkButton>
          ) : action.kind === 'project_settings' ? (
            <LinkButton variant="primary" href={sectionHash('project-settings')}>
              {action.label}
            </LinkButton>
          ) : (
            <Button
              variant={pipeline.state === 'queued' ? 'secondary' : 'primary'}
              onClick={onStart}
              busy={busy}
            >
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
      <p className="psu-foot">Uses your AI plan. No searches until you start the first check.</p>
    </section>
  )
}

function StepItem({
  step,
  index,
  last
}: {
  step: PagePipelineStep
  index: number
  last: boolean
}): JSX.Element {
  return (
    <li
      className={`psu-step psu-step-${step.state}`}
      aria-current={step.state === 'running' ? 'step' : undefined}
    >
      <span className="psu-mark" aria-hidden="true">
        {step.state === 'done' ? (
          <UiIcon name="check" size={14} />
        ) : step.state === 'running' ? (
          <span className="psu-spin" />
        ) : step.state === 'failed' ? (
          '!'
        ) : (
          index + 1
        )}
      </span>
      <span className="psu-step-text">
        <span className="psu-step-label">{step.label}</span>
        <span className="psu-step-detail">{stepDetail(step)}</span>
      </span>
      <span className="sr-only">{` (${stateWord(step.state)})`}</span>
      {last ? null : <span className="psu-line" aria-hidden="true" />}
    </li>
  )
}

function stepDetail(step: PagePipelineStep): string {
  if (step.detail !== null) return step.detail
  if (step.state === 'running') return 'Working…'
  if (step.state === 'waiting') return 'Waiting'
  if (step.state === 'failed') return 'Stopped'
  return ' '
}

function stateWord(state: PagePipelineStep['state']): string {
  if (state === 'todo') return 'to do'
  if (state === 'running') return 'in progress'
  return state
}

/** Seconds since `startedAt`, ticking while the step runs. */
function useElapsed(startedAt: string | null, ticking: boolean): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  if (startedAt === null || !ticking) return null
  return elapsedLabel(Date.parse(startedAt), now)
}
