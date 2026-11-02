import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import { LOOP_STEPS, OWNER_LABEL_MAX, type LoopStep } from '@shared/fix-loop'
import type { ChangeLedger } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { pagesDrill } from '../../changes/drills'
import { cleanError } from '../../progress/model'
import { DrillNumber } from '../../drill'
import { Button } from '../../ui'
import { cleanOwner, roundCounts, scheduleLine, STEP_COPY } from './model'

const STEP_DRILL_COPY: Record<
  Exclude<LoopStep, 'measure'>,
  { title: string; description: string }
> = {
  reoptimise: {
    title: 'Pages to re-optimise',
    description: 'Pages not cited yet, and pages that lost ground. Each gets fresh content.'
  },
  publish: {
    title: 'Changes to publish and measure',
    description: 'Changes that went live since the last check, or go live later.'
  },
  index: {
    title: 'Pages to get indexed',
    description: 'Changed pages Google has not shown as indexed, or that were never checked.'
  },
  backlinks: {
    title: 'Pages to build backlinks to',
    description: 'The backlink ask list: pages not cited yet, lost ground, or not indexed.'
  }
}

/**
 * "The next round": the five steps of a round in one row (it wraps on narrow
 * windows), each with its count and its owner, then when the next measurement runs.
 * The owner chip renames the step's owner in place (`?owner=<step>`).
 */
export function LoopSteps({
  ledger,
  editing,
  onEdit,
  onSaveOwner
}: {
  ledger: ChangeLedger
  /** The step whose owner is being renamed. */
  editing: LoopStep | null
  onEdit: (step: LoopStep | null) => void
  onSaveOwner: (step: LoopStep, label: string) => Promise<void>
}): JSX.Element {
  const counts = roundCounts(ledger)
  return (
    <section className="ui-panel rnd-lead" aria-labelledby="rnd-lead-h">
      <h2 id="rnd-lead-h" className="rnd-lead-title">
        The next round
      </h2>
      <p className="rnd-lead-line">
        Every page that is not cited yet goes into the next round. Each round measures,
        re-optimises, publishes, gets the page indexed and builds links, until every page is cited.
      </p>
      <ol className="rnd-steps">
        {LOOP_STEPS.map((step, index) => (
          <li key={step} className="rnd-step">
            <span className="rnd-step-n num" aria-hidden="true">
              {index + 1}
            </span>
            <h3 className="rnd-step-name">
              <span className="sr-only">Step {index + 1}: </span>
              {STEP_COPY[step].name}
            </h3>
            <p className="rnd-step-line">{STEP_COPY[step].line}</p>
            <p className="rnd-step-count">
              {step === 'measure' ? (
                <>
                  <span className="num">{pluralize(counts.measure, 'page')}</span>
                  <span className="faint">
                    {' '}
                    · every {pluralize(ledger.schedule.intervalDays, 'day')}
                  </span>
                </>
              ) : (
                <DrillNumber
                  drill={pagesDrill(ledger, counts[step], {
                    id: `round:${step}`,
                    ...STEP_DRILL_COPY[step]
                  })}
                  suffix={counts[step].length === 1 ? ' page' : ' pages'}
                />
              )}
            </p>
            {editing === step ? (
              <OwnerForm
                step={step}
                current={ledger.owners[step]}
                onCancel={() => onEdit(null)}
                onSave={(label) => onSaveOwner(step, label)}
              />
            ) : (
              <button
                type="button"
                className="rnd-owner"
                aria-label={`${STEP_COPY[step].name} is done by ${ledger.owners[step]}. Rename`}
                onClick={() => onEdit(step)}
              >
                {ledger.owners[step]}
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className="muted rnd-next">{scheduleLine(ledger.schedule)}</p>
    </section>
  )
}

/** Inline rename of a step's owner. Empty resets to the default. */
function OwnerForm({
  step,
  current,
  onCancel,
  onSave
}: {
  step: LoopStep
  current: string
  onCancel: () => void
  onSave: (label: string) => Promise<void>
}): JSX.Element {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    ref.current?.select()
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave(cleanOwner(value))
    } catch (cause) {
      setError(cleanError(cause, 'Could not rename the owner.'))
      setBusy(false)
    }
  }

  return (
    <form className="rnd-owner-form" onSubmit={(event) => void submit(event)}>
      <label className="sr-only" htmlFor={id}>
        Who does {STEP_COPY[step].name}?
      </label>
      <input
        ref={ref}
        id={id}
        className="rnd-owner-input"
        value={value}
        maxLength={OWNER_LABEL_MAX}
        placeholder="Leave empty for the default"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      />
      <span className="rnd-owner-actions">
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </span>
      {error ? (
        <span className="rnd-owner-error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  )
}
