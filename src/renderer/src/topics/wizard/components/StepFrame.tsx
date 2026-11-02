import type { JSX, ReactNode } from 'react'
import {
  AssistProgress,
  Stepper,
  useAssistProgress,
  WizardFooter,
  type WizardFooterProps
} from '../../../ui'
import type { TopicWizardStep } from '@shared/domain'
import type { WizardStepDef } from '../types'

/**
 * The wizard layout (Theme "Layouts · Wizard"): a horizontal stepper strip,
 * the step's content, and the sticky footer with Back, a one-line cost note
 * and the screen's one primary action.
 */
export function StepFrame({
  steps,
  current,
  onStep,
  title,
  aside,
  headerEnd,
  footer,
  children,
  saveNote
}: {
  steps: readonly WizardStepDef[] | null
  current: TopicWizardStep | null
  onStep?: (id: TopicWizardStep) => void
  title: string
  /** One line beside or under the title. */
  aside?: ReactNode
  /** Controls at the right of the title row (a depth segment, the topic name). */
  headerEnd?: ReactNode
  footer: WizardFooterProps
  children: ReactNode
  /** "Saving…" / "Draft saved" for screen readers and a quiet hint. */
  saveNote?: string | null
}): JSX.Element {
  // Owner feedback #1: while the primary action runs Claude (Write buyer profile, Write
  // questions, Generate keywords, Match pages), its live steps show under the title.
  const busy = footer.primary?.busy === true
  const progress = useAssistProgress(busy, 'topics:')
  return (
    <div className="tw">
      {steps && current ? (
        <div className="tw-steps">
          <Stepper
            steps={steps}
            current={current}
            {...(onStep ? { onStep: (id) => onStep(id as TopicWizardStep) } : {})}
          />
        </div>
      ) : null}
      <div className="tw-body">
        <div className="tw-head">
          <div className="tw-titles">
            <h1>{title}</h1>
            {aside ? <p className="tw-aside">{aside}</p> : null}
          </div>
          {headerEnd ? <div className="tw-head-end">{headerEnd}</div> : null}
        </div>
        {/* Only once a real step arrived, so a plain save does not flash a panel. */}
        {busy && progress.steps.length > 0 ? (
          <div className="tw-progress">
            <AssistProgress progress={progress} reads="no searches" />
          </div>
        ) : null}
        {children}
        {saveNote ? (
          <p className="sr-only" role="status">
            {saveNote}
          </p>
        ) : null}
      </div>
      <WizardFooter {...footer} />
    </div>
  )
}
