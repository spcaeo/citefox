import type { JSX, ReactNode } from 'react'
import { SETUP_STEPS, type SetupDraft, type SetupStep } from '@shared/ipc'
import { BuildChip } from '../buildMenu'
import { FoxMark } from '../components/Icon'
import { ThemeMenu } from '../shell/ThemeMenu'
import { Stepper, type StepperStep } from '../ui'
import type { OnboardingClient } from './client'
import {
  SETUP_STEP_LABELS,
  stepComplete,
  stepHash,
  type SetupProgress,
  type SetupView
} from './setupSteps'

const STEPPER: readonly (StepperStep & { id: SetupStep })[] = SETUP_STEPS.map((id) => ({
  id,
  label: SETUP_STEP_LABELS[id]
}))

/**
 * The setup frame: a top bar with the brand and the
 * build chip (and the Light/Dark/System switch on the right), the 8-step stepper (Site, Claude, Read, Brand, Buyers, Rivals, Engines,
 * Questions) on every step, the step page, and a polite live region that repeats
 * announcements for screen readers. Earlier steps in the stepper go back to that step;
 * later ones are reached with the footer's Continue. An earlier step that lost what it
 * needs (edited after the user moved on) shows "(not done)".
 */
export function SetupChrome({
  view,
  draft,
  progress,
  announcement,
  announcementLog,
  onWelcome,
  onStep,
  client,
  children
}: {
  view: SetupView
  draft: SetupDraft
  progress: SetupProgress
  announcement: string
  announcementLog: readonly string[]
  onWelcome: () => void
  onStep: (step: SetupStep) => void
  /** Saves the theme choice. */
  client: Pick<OnboardingClient, 'updateSettings'>
  children: ReactNode
}): JSX.Element {
  const incomplete = SETUP_STEPS.filter((step) => !stepComplete(step, draft, progress))

  function focusMain(): void {
    document.getElementById('main')?.focus()
  }

  return (
    <div className="onboarding">
      <button type="button" className="skip-link" onClick={focusMain}>
        Skip to main content
      </button>
      <header className="ob-topbar">
        <span className="ob-brand-group">
          <a
            className="ob-brand"
            href={stepHash('welcome')}
            onClick={(event) => {
              event.preventDefault()
              onWelcome()
            }}
          >
            <FoxMark />
            CiteFox
          </a>
          <BuildChip align="start" />
        </span>
        <span className="ob-topbar-end">
          <span className="ob-version">Source-available · © Space-O Technologies</span>
          <ThemeMenu client={client} plain />
        </span>
      </header>
      {view === 'welcome' ? null : (
        <nav className="ob-stepper" aria-label="Setup steps">
          <Stepper
            label="Setup steps"
            steps={STEPPER}
            current={view}
            incomplete={incomplete}
            onStep={(id) => onStep(id as SetupStep)}
          />
        </nav>
      )}
      <main className="ob-screen" id="main" tabIndex={-1}>
        {children}
      </main>
      <p
        className="setup-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-announcements={announcementLog.join('\n')}
      >
        {announcement}
      </p>
    </div>
  )
}
