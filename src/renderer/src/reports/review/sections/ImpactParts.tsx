import type { JSX } from 'react'
import {
  topSitesChart,
  type ReportNeeds,
  type ReviewReport,
  type ReviewSectionId,
  type Step
} from '@shared/report/review'
import { newFixValues } from '../../../fixes/drawer/model'
import { openDrawer } from '../../../shell/drawers'
import { projectSettingsHash } from '../../../shell/routes'
import { Button, LinkButton } from '../../../ui'
import { RankedBarsChart } from '../../../ui/chart/ReportCharts'
import { openReportDrill } from '../drill'
import { Parts } from '../Figures'
import '../impact.css'

/**
 * Little data and the Impact review's extra parts in the app: "What this report needs"
 * with real buttons, the greyed-out tab line, the intro at the top of Verdict, the top
 * sites chart, and next steps that link to their tab.
 */

/** "What this report needs": what is missing, Log a fix, Run a check, and the next check. */
export function NeedsPanel({ needs }: { needs: ReportNeeds }): JSX.Element {
  return (
    <section className="rv-panel rv-needs" aria-labelledby="rv-needs-title">
      <h3 id="rv-needs-title">{needs.title}</h3>
      <p className="rv-sub">{needs.lead}</p>
      <ol className="rv-needs-list">
        {needs.items.map((item) => (
          <li key={item.text} className={item.done ? 'rv-needs-done' : undefined}>
            <span className="rv-needs-mark" aria-hidden="true">
              {item.done ? '✓' : ''}
            </span>
            {item.text}
          </li>
        ))}
      </ol>
      <div className="rv-actions">
        {needs.actions.includes('fix') ? (
          <Button size="sm" icon="plus" onClick={() => openDrawer('fix', newFixValues())}>
            Log a fix
          </Button>
        ) : null}
        {needs.actions.includes('check') ? (
          <Button
            size="sm"
            variant={needs.actions.includes('fix') ? 'secondary' : 'primary'}
            onClick={() => openDrawer('check-now', { 'check.scope': 'tracked' })}
          >
            Run a check
          </Button>
        ) : null}
        {needs.actions.includes('schedule') ? (
          <LinkButton size="sm" variant="secondary" href={projectSettingsHash('schedule')}>
            When the next check runs
          </LinkButton>
        ) : null}
      </div>
      <p className="rv-muted rv-small" data-testid="rv-next-check">
        {needs.nextCheck} Run a check shows how many searches it uses before it starts.
      </p>
    </section>
  )
}

/** A tab with nothing to show yet: one line saying what it needs. */
export function EmptySection({ title, line }: { title: string; line: string }): JSX.Element {
  return (
    <section className="rv-panel rv-empty" aria-label={title} data-empty="true">
      <h3>{title}</h3>
      <p className="rv-muted">Nothing to show yet. {line}</p>
    </section>
  )
}

/** The intro at the top of Verdict: lead line, the answers-vary note, at a glance. */
export function IntroPanel({ report }: { report: ReviewReport }): JSX.Element {
  const { intro } = report.impact
  return (
    <section className="rv-panel rv-intro" aria-label="About this review">
      <div className="rv-intro-main">
        <p className="rv-intro-lead">
          <Parts parts={intro.lead} />
        </p>
        <p className="rv-note rv-intro-note">
          <b>About these results: answers vary.</b> Ask an AI engine the same question twice and it
          can cite different pages. Read the trend across many questions, not one answer. A change
          smaller than {report.method.noise} {report.method.noise === 1 ? 'question' : 'questions'}{' '}
          is noise.
        </p>
      </div>
      <dl className="rv-glance" aria-label="At a glance">
        {intro.glance.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              <Parts parts={item.value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Verdict's top 8 cited sites now. */
export function TopSitesPanel({ report }: { report: ReviewReport }): JSX.Element | null {
  if (report.impact.topSites.length < 2) return null
  return (
    <section className="rv-panel" aria-labelledby="rv-top-title">
      <h3 id="rv-top-title">Most cited sites</h3>
      <p className="rv-sub">
        The 8 sites AI answers cite most on {report.toLabel}, you highlighted.
        {report.comparing && report.fromLabel ? ` The faint bar is ${report.fromLabel}.` : ''}
      </p>
      <RankedBarsChart {...topSitesChart(report)} onDrill={openReportDrill} />
    </section>
  )
}

/** Next steps; each opens the tab its detail is on (when that tab is in the report). */
export function LinkedSteps({
  steps,
  report,
  onSection
}: {
  steps: readonly Step[]
  report: ReviewReport
  onSection?: (id: ReviewSectionId) => void
}): JSX.Element {
  if (steps.length === 0) {
    return <p className="rv-muted">Nothing to do right now. Check again after your next check.</p>
  }
  const shown = new Set(report.sections.filter((s) => s.empty === undefined).map((s) => s.id))
  return (
    <ol className="rv-steps">
      {steps.map((step) => (
        <li key={step.lead}>
          <b>{step.lead}</b> <Parts parts={step.parts} />
          {step.tab !== undefined && shown.has(step.tab) && onSection ? (
            <>
              {' '}
              <button
                type="button"
                className="rv-link rv-step-link"
                onClick={() => onSection(step.tab as ReviewSectionId)}
              >
                Open {report.sections.find((s) => s.id === step.tab)?.title} →
              </button>
            </>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
