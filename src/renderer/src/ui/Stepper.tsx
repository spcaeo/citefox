import type { JSX } from 'react'
import { stepStates, type StepperStep } from './componentModels'
import { UiIcon } from './UiIcon'

export type { StepperStep }

export interface StepperProps {
  /** Accessible name of the step list. Default "Steps". */
  label?: string
  steps: readonly StepperStep[]
  /** Id of the current step. Steps before it are done, after it are to do. */
  current: string
  /** Makes done steps buttons that go back to that step. */
  onStep?: (id: string) => void
  /**
   * Ids of earlier steps that were passed but not completed. They keep their
   * number with a warn mark and "(not done)" instead of a check.
   */
  incomplete?: readonly string[]
}

/**
 * The wizard stepper (Keywords-Groups.png): horizontal steps joined by lines.
 * Done steps show a check on spruce and, with `onStep`, are buttons; the current
 * step is a fox number with `aria-current="step"`; later steps are outlined.
 * Earlier steps listed in `incomplete` show their number on a warn mark.
 */
export function Stepper({
  label = 'Steps',
  steps,
  current,
  onStep,
  incomplete = []
}: StepperProps): JSX.Element {
  const states = stepStates(steps, current)
  return (
    <ol className="ui-stepper" aria-label={label}>
      {steps.map((step, index) => {
        const passed = states[index] ?? 'todo'
        const state = passed === 'done' && incomplete.includes(step.id) ? 'incomplete' : passed
        const mark = (
          <span className={`ui-step-mark ui-step-${state}`} aria-hidden="true">
            {state === 'done' ? <UiIcon name="check" size={14} /> : index + 1}
          </span>
        )
        const text = (
          <>
            {mark}
            <span className="ui-step-label">{step.label}</span>
            {state === 'done' ? <span className="sr-only"> (done)</span> : null}
            {state === 'incomplete' ? <span className="sr-only"> (not done)</span> : null}
          </>
        )
        return (
          <li
            key={step.id}
            className={`ui-step ui-step-is-${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {passed === 'done' && onStep ? (
              <button type="button" className="ui-step-btn" onClick={() => onStep(step.id)}>
                {text}
              </button>
            ) : (
              <span className="ui-step-btn">{text}</span>
            )}
            {index < steps.length - 1 ? (
              <span
                className={`ui-step-line${state === 'done' ? ' ui-step-line-done' : ''}`}
                aria-hidden="true"
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
