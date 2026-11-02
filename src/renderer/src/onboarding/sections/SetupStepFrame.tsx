import type { JSX, ReactNode } from 'react'
import { SETUP_STEPS } from '@shared/ipc'
import { WizardFooter, type WizardPrimary } from '../../ui'
import './sections.css'

/**
 * One v2 setup step with section cards (mock-up panels 4–8): "STEP 4 OF 8",
 * the question as the heading, a line that says where the answers came from
 * ("✦ FROM YOUR SITE"), the cards in the setup width's 8 of 12 columns, and
 * the sticky footer (Back, a status line, one green primary). The same frame
 * and classes as StepPage, plus the kicker the mock-up shows.
 */
export function SetupStepFrame({
  step,
  title,
  from,
  sub,
  alert,
  onBack,
  note,
  primary,
  headAction,
  children
}: {
  /** 1-based step number. */
  step: number
  title: string
  /** "✦ FROM YOUR SITE". */
  from?: string
  sub: ReactNode
  alert: string | null
  onBack: () => void
  note?: ReactNode
  primary: WizardPrimary
  /** At the right of the heading: Start over this step. */
  headAction?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="ob osc-step">
      <div className="ob-page setup-width">
        <div className="ob-head osc-step-head">
          <div className="osc-step-head-row">
            <div className="osc-step-head-text">
              <p className="osc-kicker">
                Step {step} of {SETUP_STEPS.length}
              </p>
              <h1>{title}</h1>
              <p className="ob-sub">
                {from ? <span className="osc-from">{from}</span> : null} {sub}
              </p>
            </div>
            {headAction}
          </div>
        </div>
        {alert ? (
          <div className="panel-warn ob-alert" role="alert">
            <p>{alert}</p>
          </div>
        ) : null}
        <div className="ob-grid ob-grid-single">
          <div className="ob-main">{children}</div>
        </div>
      </div>
      <WizardFooter onBack={onBack} {...(note ? { note } : {})} primary={primary} />
    </div>
  )
}
