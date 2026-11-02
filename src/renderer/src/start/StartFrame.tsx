import type { JSX, ReactNode } from 'react'
import { START_JOURNEY_STEPS, type StartJourneyStep } from '@shared/site-start'
import { BuildChip } from '../buildMenu'
import { FoxMark } from '../components/Icon'
import { landingHash } from '../shell/routes'
import { SponsorStrip } from '../sponsors'
import { Button, ClaudeStatusLine, DomainText, Stepper } from '../ui'
import './start.css'

/**
 * Focus mode for the first-run journey (Mockups/v2/journey-a): a quiet top bar
 * with the brand, the project, the five-step journey stepper and the searches
 * left; the screen's heading row (with an optional clock and actions on the
 * right); the body; and a sticky footer with one primary action
 * (`StartFooter`, the kit's wizard footer). The body uses onboarding's
 * centred width (`.setup-width`), so setup and the journey line up.
 */
export function StartFrame({
  step,
  projectName,
  domain,
  searchesLeft,
  title,
  subtitle,
  lead,
  aside,
  footer,
  children
}: {
  /** The journey step; none on "How do you want to start?" (before the journey). */
  step?: StartJourneyStep
  projectName: string
  domain: string
  searchesLeft: number | null
  title: ReactNode
  subtitle?: ReactNode
  /** Shown left of the heading (the ready check, the results fox). */
  lead?: ReactNode
  /** Right of the heading: the clock, Pause, Cancel. */
  aside?: ReactNode
  footer: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="sf">
      <div className="sf-header">
        <header className="sf-top">
          <span className="sf-brand-group">
            <a className="sf-brand" href={landingHash()} aria-label="CiteFox, open the dashboard">
              <FoxMark />
              <span>CiteFox</span>
            </a>
            <BuildChip align="start" />
          </span>
          <span className="sf-project">
            {projectName} · {domain ? <DomainText domain={domain} plain /> : null}
          </span>
          <span className="sf-end">
            <ClaudeStatusLine size="sm" setupHref="#/permissions" />
            <p className="sf-capsule num">
              <span className="sf-dot" aria-hidden="true" />
              {searchesLeft === null
                ? 'Searches left unknown'
                : `${searchesLeft.toLocaleString('en-US')} searches left`}
            </p>
          </span>
        </header>
        {/* Its own row under the bar, as in setup: beside the project and status it overlapped. */}
        {step ? (
          <nav className="sf-steps" aria-label="Getting started">
            <Stepper label="Journey steps" steps={START_JOURNEY_STEPS} current={step} />
          </nav>
        ) : null}
      </div>
      <SponsorStrip />
      <main className="sf-main setup-width" id="main" tabIndex={-1}>
        <div className="sf-head">
          {lead ? <div className="sf-lead">{lead}</div> : null}
          <div className="sf-titles">
            <h1>{title}</h1>
            {subtitle ? <p className="sf-sub">{subtitle}</p> : null}
          </div>
          {aside ? <div className="sf-aside">{aside}</div> : null}
        </div>
        {children}
      </main>
      {footer}
    </div>
  )
}

/**
 * The journey's sticky footer, the same bar as the kit's WizardFooter: Back
 * (ghost) on the left, a one-line note and the screen's actions on the right.
 * The Undo toast sits over the footer's middle (edit/edit.css), so it never
 * covers the screen, and the note steps aside while it shows.
 */
export function StartFooter({
  onBack,
  note,
  children
}: {
  /** Shows the ghost Back button when set. */
  onBack?: () => void
  /** One line left of the actions, such as "Next: a starting plan · still 0 searches". */
  note?: ReactNode
  /** The screen's one primary action (a Button or LinkButton). */
  children: ReactNode
}): JSX.Element {
  return (
    <footer className="ui-wizard-foot sf-foot">
      {onBack ? (
        <Button variant="ghost" icon="arrow-left" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <div className="ui-wizard-end">
        {note ? (
          <p className="ui-wizard-note num" role="status">
            <span>{note}</span>
          </p>
        ) : null}
        {children}
      </div>
    </footer>
  )
}

/** The elapsed clock with the time left under it. */
export function StartClock({ clock, note }: { clock: string; note: string }): JSX.Element {
  return (
    <div className="sf-clock" role="timer" aria-label={`${clock} elapsed, ${note}`}>
      <span className="sf-clock-time num">{clock}</span>
      <span className="sf-clock-note">{note}</span>
    </div>
  )
}

/** A thin share bar (decorative; the number beside it carries the value). */
export function ShareBar({
  percent,
  tone = 'spruce'
}: {
  percent: number
  tone?: 'spruce' | 'fox'
}): JSX.Element {
  const width = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <span className={tone === 'fox' ? 'sf-bar sf-bar-fox' : 'sf-bar'} aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </span>
  )
}
