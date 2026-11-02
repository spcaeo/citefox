import { useId, useState, type JSX, type ReactNode } from 'react'
import { announcement, formatElapsed, usePrefersReducedMotion } from './assistProgressModel'
import { Button } from './Button'
import { UiIcon } from './UiIcon'
import { useNow } from './useBusy'
import type { AssistProgressView, AssistStepView } from './useAssistProgress'

export interface AssistProgressProps {
  progress: AssistProgressView
  /** What the step reads, such as "uses your site, no searches". */
  reads?: string
  /** "about 20 s", shown before the first step arrives. */
  expectedSeconds?: number
  /** Shown while running, only where the call can really be stopped. */
  onCancel?: () => void
  /** Heading while running. Default "Claude is working" (or "Codex is working"). */
  title?: string
  /** The foot line until a Claude step names its connection, such as "about 20 s · no searches". */
  note?: ReactNode
}

function stepSeconds(step: AssistStepView, now: number): number {
  return (step.endedAt ?? now) - step.startedAt
}

function StepIcon({ step }: { step: AssistStepView }): JSX.Element {
  if (step.state === 'running') {
    return (
      <span className="ui-progress-icon is-running" aria-hidden="true">
        {step.kind === 'claude' ? <UiIcon name="sparkle" size={12} /> : <span className="dot" />}
      </span>
    )
  }
  if (step.state === 'failed') {
    return (
      <span className="ui-progress-icon is-failed" aria-hidden="true">
        <UiIcon name="x" size={12} />
      </span>
    )
  }
  if (step.state === 'skipped') {
    return (
      <span className="ui-progress-icon is-skipped" aria-hidden="true">
        <span className="dash" />
      </span>
    )
  }
  return (
    <span className="ui-progress-icon is-done" aria-hidden="true">
      <UiIcon name="check" size={12} />
    </span>
  )
}

function stateWord(state: AssistStepView['state']): string {
  if (state === 'running') return 'in progress'
  if (state === 'failed') return 'failed'
  if (state === 'skipped') return 'skipped'
  return 'done'
}

function StepList({ steps, now }: { steps: readonly AssistStepView[]; now: number }): JSX.Element {
  return (
    <ol className="ui-progress-steps">
      {steps.map((step) => {
        const ms = stepSeconds(step, now)
        // Claude steps always show their time; other steps once they take a second.
        const timed = step.kind === 'claude' || ms >= 1000
        return (
          <li
            key={step.key}
            className="ui-progress-step"
            data-state={step.state}
            data-kind={step.kind}
          >
            <StepIcon step={step} />
            <span className="ui-progress-copy">
              <span className="ui-progress-label">
                {step.label}
                <span className="sr-only"> · {stateWord(step.state)}</span>
              </span>
              {step.detail ? <span className="ui-progress-detail">{step.detail}</span> : null}
            </span>
            {timed ? (
              <span className="ui-progress-secs num" aria-hidden="true">
                {formatElapsed(ms)}
              </span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * "CiteFox AI · on your plan · no searches", or "CiteFox AI · API key …". Never the
 * provider or its model id: users see CiteFox AI whichever AI runs the step (R12).
 */
function connectionLine(progress: AssistProgressView, reads: string | undefined): string | null {
  const claude = progress.claude
  const connection =
    claude === null
      ? null
      : claude.connection === 'anthropic-api'
        ? 'CiteFox AI · API key'
        : 'CiteFox AI · on your plan'
  const parts = [connection, reads ?? null].filter((part): part is string => Boolean(part))
  return parts.length === 0 ? null : parts.join(' · ')
}

/**
 * The live panel of an AI assist or long Claude step (owner feedback #1): each
 * real step as it happens (page reads, the Claude call with a running timer,
 * the answer check, the result), the connection line, and Cancel where the
 * call can be stopped. When the call is over it folds into one summary line
 * that opens the steps again. Announces steps politely; no motion when the
 * system asks for less.
 */
export function AssistProgress({
  progress,
  reads,
  expectedSeconds,
  onCancel,
  title,
  note
}: AssistProgressProps): JSX.Element | null {
  // Users see CiteFox AI whichever AI runs the step (R12).
  const ai = 'CiteFox AI'
  const heading = title ?? `${ai} is working`
  const reduced = usePrefersReducedMotion()
  const running = progress.running
  const now = useNow(running)
  const [open, setOpen] = useState(false)
  const listId = useId()
  const steps = progress.steps
  const spoken = announcement(steps, running)
  const total = progress.startedAt === null ? 0 : (progress.endedAt ?? now) - progress.startedAt
  const line = connectionLine(progress, reads)
  const failed = steps.some((step) => step.state === 'failed') && !running
  // First child in both shapes, keyed, so the live region survives the fold and says "Done".
  const live = (
    <p key="live" className="sr-only" role="status" aria-live="polite">
      {spoken}
    </p>
  )

  if (!running) {
    if (steps.length === 0) return null
    const skipped = steps.filter((step) => step.state === 'skipped').length
    const failedCount = steps.filter((step) => step.state === 'failed').length
    const claudeMs = steps
      .filter((step) => step.kind === 'claude')
      .reduce((sum, step) => sum + stepSeconds(step, now), 0)
    const summary = [
      `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`,
      failedCount > 0 ? `${failedCount} failed` : null,
      skipped > 0 ? `${skipped} skipped` : null,
      formatElapsed(total),
      claudeMs > 0 ? `${ai} ${formatElapsed(claudeMs)}` : null
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <section
        className="ui-progress is-folded"
        data-state={failed ? 'failed' : 'done'}
        data-motion={reduced ? 'reduce' : 'full'}
        aria-label={`What ${ai} did`}
      >
        {live}
        <button
          type="button"
          className="ui-progress-fold"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={failed ? 'ui-progress-icon is-failed' : 'ui-progress-icon is-done'}>
            <UiIcon name={failed ? 'warning' : 'check'} size={12} />
          </span>
          <span className="ui-progress-fold-text num">{summary}</span>
          <span className="ui-progress-fold-cta">{open ? 'Hide steps' : 'Show steps'}</span>
          <UiIcon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
        <div id={listId} hidden={!open}>
          {open ? <StepList steps={steps} now={now} /> : null}
          {open && line ? <p className="ui-progress-foot">{line}</p> : null}
        </div>
      </section>
    )
  }

  const shown: readonly AssistStepView[] =
    steps.length > 0
      ? steps
      : [
          {
            key: 'starting',
            kind: 'work',
            label: 'Starting',
            state: 'running',
            detail: expectedSeconds ? `Usually about ${expectedSeconds} s` : null,
            startedAt: progress.startedAt ?? now,
            endedAt: null
          }
        ]

  return (
    <section
      className="ui-progress"
      data-state="running"
      data-motion={reduced ? 'reduce' : 'full'}
      aria-label={`What ${ai} is doing`}
      aria-busy="true"
    >
      {live}
      <div className="ui-progress-head">
        <span className="ui-progress-mark" aria-hidden="true">
          <UiIcon name="sparkle" size={14} />
        </span>
        <p className="ui-progress-title">{heading}</p>
        <span className="ui-progress-time num" aria-hidden="true">
          {formatElapsed(total)}
          {expectedSeconds ? <span className="faint"> / about {expectedSeconds} s</span> : null}
        </span>
      </div>
      <StepList steps={shown} now={now} />
      {line || note || onCancel ? (
        <div className="ui-progress-foot-row">
          {line || note ? <p className="ui-progress-foot">{line ?? note}</p> : <span />}
          {onCancel ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
