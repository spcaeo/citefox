import type { JSX } from 'react'
import type { ImportEstimate } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { estimateFormula, estimateNotes, fmt, type EstimateInputs } from '../utils/estimate'

export function CostEstimate({
  inputs,
  estimate,
  error,
  pending
}: {
  inputs: EstimateInputs
  estimate: ImportEstimate | null
  error: string | null
  pending: boolean
}): JSX.Element {
  if (inputs.pages === 0 || inputs.markets === 0) {
    return (
      <div className="imp-est" role="region" aria-label="Cost estimate">
        <h3 className="imp-label">Cost estimate</h3>
        <p className="muted">
          {inputs.markets === 0
            ? 'Tick at least one market to see the cost.'
            : 'Nothing to estimate yet.'}
        </p>
      </div>
    )
  }
  if (!estimate) {
    return (
      <div className="imp-est" role="region" aria-label="Cost estimate">
        <h3 className="imp-label">Cost estimate</h3>
        <p className="muted" role={error ? 'alert' : 'status'}>
          {error ?? 'Working out the cost…'}
        </p>
      </div>
    )
  }
  const notes = estimateNotes(inputs, estimate)
  return (
    <div
      className={notes.over ? 'imp-est over' : 'imp-est'}
      role="region"
      aria-label="Cost estimate"
      aria-busy={pending}
    >
      <h3 className="imp-label">Cost estimate</h3>
      <p>
        <strong>{estimateFormula(inputs, estimate)}</strong>
      </p>
      <p className="muted">
        every {inputs.intervalDays} days ≈ {fmt(estimate.monthlyMin)}–{fmt(estimate.monthlyMax)} a
        month
      </p>
      {estimate.searchesLeft !== null ? (
        <p>
          you have <strong>{fmt(estimate.searchesLeft)}</strong> left this month
          {estimate.monthlyPlan !== null ? ` (of ${fmt(estimate.monthlyPlan)} a month)` : ''}
        </p>
      ) : (
        <p className="muted">
          CiteFox does not know how many searches you have left. Test your search key in Connections
          to see it here.
        </p>
      )}
      {notes.fit ? <p>{notes.fit}</p> : null}
      {notes.over ? <p className="imp-over">{notes.over}</p> : null}
      <p className="muted">
        {inputs.setupPages === 0
          ? 'These pages are already set up, so no AI work is needed before their checks.'
          : `Setting up ${pluralize(inputs.setupPages, 'page')} takes about ${pluralize(estimate.claudeCalls, 'AI call')} (page read summary, buyer profile, questions).`}
      </p>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
