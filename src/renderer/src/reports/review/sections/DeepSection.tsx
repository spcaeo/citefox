import type { JSX } from 'react'
import { agreeChart, shapesChart, spreadChart, type ReviewReport } from '@shared/report/review'
import { BucketColumnsChart, PairedBarsChart } from '../../../ui/chart/ReportCharts'
import { openReportDrill } from '../drill'

/**
 * Deep dives: how the shape of answers changed, where you sit among the sources before
 * and now, and whether the engines agree. Every bar opens the questions it counts.
 */
export function DeepSection({ report }: { report: ReviewReport }): JSX.Element {
  const { shapes, agree } = report.deep
  return (
    <div className="rv-stack">
      <div className="rv-grid2">
        <section className="rv-panel" aria-labelledby="rv-shape-title">
          <h3 id="rv-shape-title">How the shape of answers changed</h3>
          <p className="rv-sub">Lists, steps, tables and long answers: match their shape.</p>
          {shapes ? (
            <>
              <PairedBarsChart {...shapesChart(report)} onDrill={openReportDrill} />
              {shapes.wordsNow !== null ? (
                <p className="rv-muted rv-small">
                  Average answer length:{' '}
                  {shapes.wordsBefore !== null
                    ? `${shapes.wordsBefore} words on ${report.fromLabel} → `
                    : ''}
                  <b>{shapes.wordsNow} words</b> on {report.toLabel}. Read from {shapes.read} stored{' '}
                  {shapes.read === 1 ? 'answer' : 'answers'}.
                </p>
              ) : null}
            </>
          ) : (
            <p className="rv-muted">No stored answer text to read for these checks.</p>
          )}
        </section>
        <section className="rv-panel" aria-labelledby="rv-spread-title">
          <h3 id="rv-spread-title">Where you sit among the sources</h3>
          <p className="rv-sub">
            {report.comparing
              ? `Your position in answers citing you. Faint: ${report.fromLabel}. Solid: ${report.toLabel}.`
              : `Your position in answers citing you, ${report.toLabel}.`}
          </p>
          <PairedBarsChart {...spreadChart(report)} onDrill={openReportDrill} />
        </section>
      </div>
      <section className="rv-panel" aria-labelledby="rv-agree-title">
        <h3 id="rv-agree-title">Do the engines agree?</h3>
        {agree ? (
          <>
            <p className="rv-sub">
              How many of the {agree.engines} engines cite you, per question.
            </p>
            <BucketColumnsChart {...agreeChart(report)} onDrill={openReportDrill} />
          </>
        ) : (
          <p className="rv-muted">
            {report.engine === 'all'
              ? 'Only one engine answered these questions.'
              : 'Pick All engines to compare the engines.'}
          </p>
        )}
      </section>
    </div>
  )
}
