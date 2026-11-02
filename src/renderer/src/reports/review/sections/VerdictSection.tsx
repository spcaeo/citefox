import type { JSX } from 'react'
import {
  groupsChart,
  percent,
  signedTenths,
  speedChart,
  splitChart,
  type Kpi,
  type ReviewReport,
  type ReviewSectionId,
  type Step
} from '@shared/report/review'
import { BucketColumnsChart, PairedBarsChart, SplitBarChart } from '../../../ui/chart/ReportCharts'
import { Fig, Parts } from '../Figures'
import { openReportDrill } from '../drill'
import { SplitTable, VerdictFooter } from './ChangedParts'
import { IntroPanel, LinkedSteps, TopSitesPanel } from './ImpactParts'

/** A before → now tile: the whole tile opens the questions behind the number. */
export function KpiCard({ kpi, fromLabel }: { kpi: Kpi; fromLabel: string | null }): JSX.Element {
  return (
    <button
      type="button"
      className="rv-kpi"
      data-rd={kpi.drill}
      onClick={() => openReportDrill(kpi.drill)}
    >
      <small>{kpi.label}</small>
      <span className="rv-kpi-big num">
        {kpi.now}
        {kpi.trend === 'up' || kpi.trend === 'down' ? (
          <span
            className={`rv-change rv-change-${(kpi.trend === 'down') === (kpi.lowerIsBetter === true) ? 'up' : 'down'}`}
          >
            {kpi.trend === 'up' ? '▲' : '▼'}
          </span>
        ) : null}
      </span>
      {kpi.before !== null && fromLabel !== null ? (
        <span className="rv-kpi-was num">
          {fromLabel}: {kpi.before}
        </span>
      ) : (
        <span className="rv-kpi-was">&nbsp;</span>
      )}
      {kpi.note ? <span className="rv-kpi-note">{kpi.note}</span> : null}
    </button>
  )
}

export function StepList({ steps }: { steps: readonly Step[] }): JSX.Element {
  if (steps.length === 0) {
    return <p className="rv-muted">Nothing to do right now. Check again after your next check.</p>
  }
  return (
    <ol className="rv-steps">
      {steps.map((step) => (
        <li key={step.lead}>
          <b>{step.lead}</b> <Parts parts={step.parts} />
        </li>
      ))}
    </ol>
  )
}

export function VerdictSection({
  report,
  onSection
}: {
  report: ReviewReport
  onSection?: (id: ReviewSectionId) => void
}): JSX.Element {
  const { verdict } = report
  const split = splitChart(report)
  const impact = report.kind === 'impact'
  const findings = impact ? [...verdict.findings, ...report.impact.proofs] : verdict.findings
  const hasPages = report.published.rows.length > 0
  return (
    <div className="rv-stack">
      {impact ? <IntroPanel report={report} /> : null}
      <section className="rv-panel rv-verdict rv-verdict-wide" aria-label="Verdict">
        <div className="rv-verdict-main">
          <span className={`rv-badge rv-badge-${verdict.badge.tone}`}>{verdict.badge.label}</span>
          <p className="rv-vline">
            <Parts parts={verdict.headline} />
          </p>
          {findings.length > 0 ? (
            <ul className="rv-findings">
              {findings.map((finding) => (
                <li key={finding.lead} className={`rv-finding rv-finding-${finding.tone}`}>
                  <b>{finding.lead}</b> <Parts parts={finding.parts} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="rv-kpis rv-kpis-fit">
          {verdict.kpis.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} fromLabel={report.fromLabel} />
          ))}
        </div>
      </section>

      {verdict.split !== null &&
      split !== null &&
      (verdict.split.marketTenths !== 0 || verdict.split.workTenths !== 0) ? (
        <section className="rv-panel" aria-labelledby="rv-split-title">
          <h3 id="rv-split-title">Market vs your work</h3>
          <p className="rv-sub">
            A question can only cite you if an AI answer shows at all. So a change has two parts:
            more answers appearing (the market) and you winning more of them (your work). The two
            parts add up exactly to {signedTenths(verdict.split.totalTenths)}.
          </p>
          <SplitBarChart {...split} onDrill={openReportDrill} />
          <p className="rv-legend-line">
            <span>
              <i className="rv-sw rv-sw-muted" aria-hidden="true" />
              Market: <Fig num={verdict.split.newAnswers} /> questions got an AI answer for the
              first time, scored at your old share of {percent(verdict.split.rateBefore)}.
            </span>
            <span>
              <i className="rv-sw rv-sw-target" aria-hidden="true" />
              Your work: your share of answers went {percent(verdict.split.rateBefore)} →{' '}
              {percent(verdict.split.rateAfter)}.
            </span>
          </p>
          <SplitTable report={report} />
        </section>
      ) : null}

      {hasPages ? (
        <div className="rv-grid2">
          <section className="rv-panel" aria-labelledby="rv-groups-title">
            <h3 id="rv-groups-title">Where your citations come from</h3>
            <p className="rv-sub">Questions citing each group of your pages. Click a bar.</p>
            <PairedBarsChart {...groupsChart(report)} onDrill={openReportDrill} />
          </section>
          <section className="rv-panel" aria-labelledby="rv-speed-title">
            <h3 id="rv-speed-title">How fast new pages get cited</h3>
            <p className="rv-sub">
              Published pages by days live on {report.toLabel}. Bars show the questions citing them.
            </p>
            <BucketColumnsChart {...speedChart(report)} onDrill={openReportDrill} />
          </section>
        </div>
      ) : null}

      {impact ? <TopSitesPanel report={report} /> : null}

      <section className="rv-panel" aria-labelledby="rv-next-title">
        <h3 id="rv-next-title">What we do next</h3>
        <LinkedSteps
          steps={verdict.next.slice(0, 4)}
          report={report}
          {...(onSection ? { onSection } : {})}
        />
      </section>
      {report.kind === 'changed' ? <VerdictFooter report={report} /> : null}
    </div>
  )
}
