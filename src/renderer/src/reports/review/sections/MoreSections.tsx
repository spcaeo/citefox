import { useState, type JSX } from 'react'
import {
  LENS_LABELS,
  pagesChart,
  positionsChart,
  rankedChart,
  REVIEW_LENSES,
  type ReviewLens,
  type ReviewReport
} from '@shared/report/review'
import { SegmentedControl, ToolButton } from '../../../ui'
import {
  FunnelChart,
  PairedBarsChart,
  PositionChart,
  RankedBarsChart
} from '../../../ui/chart/ReportCharts'
import { Change, Fig } from '../Figures'
import { CopyTool } from '../toolParts'
import { openReportDrill } from '../drill'
import { KpiCard } from './VerdictSection'
import { MethodExtras, NotIndexedSteps, NotIndexedTable } from './ClientAsks'
import { Tiles } from './ListSections'
import { NamedCells } from './ChangedParts'

export function StandingSection({ report }: { report: ReviewReport }): JSX.Element {
  const { standing } = report
  return (
    <div className="rv-stack">
      <div className="rv-kpis rv-kpis-6">
        {standing.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} fromLabel={null} />
        ))}
      </div>
      <div className="rv-grid2">
        <section className="rv-panel" aria-labelledby="rv-funnel-title">
          <h3 id="rv-funnel-title">Where visibility falls away</h3>
          <p className="rv-sub">From every question tracked to answers that cite and name you.</p>
          <FunnelChart
            label="Where visibility falls away"
            steps={standing.funnel.map((step) => ({
              id: step.drill,
              label: step.label,
              value: step.value
            }))}
            onDrill={openReportDrill}
          />
        </section>
        <section className="rv-panel" aria-labelledby="rv-pos-title">
          <h3 id="rv-pos-title">Where you sit among the sources</h3>
          <p className="rv-sub">How often your page is source #1, #2, #3 or lower.</p>
          <PositionChart {...positionsChart(report)} onDrill={openReportDrill} />
        </section>
      </div>
      <section className="rv-panel" aria-labelledby="rv-top-title">
        <h3 id="rv-top-title">Most cited sites</h3>
        <PositionlessRanked report={report} />
      </section>
    </div>
  )
}

function PositionlessRanked({ report }: { report: ReviewReport }): JSX.Element {
  return <RankedBarsChart {...rankedChart(report)} onDrill={openReportDrill} />
}

export function PagesSection({ report }: { report: ReviewReport }): JSX.Element {
  return (
    <div className="rv-stack">
      <section className="rv-panel" aria-labelledby="rv-pages-title">
        <h3 id="rv-pages-title">Your pages: before and after</h3>
        <p className="rv-sub">
          Questions citing each page
          {report.comparing ? ` on ${report.fromLabel} (faint) and ${report.toLabel}` : ''}. Orange:
          lost ground. Click for the questions.
        </p>
        <PairedBarsChart {...pagesChart(report)} onDrill={openReportDrill} />
      </section>
      {report.lostGround.items.length > 0 ? (
        <p className="rv-note">
          <b>
            {report.lostGround.items.length}{' '}
            {report.lostGround.items.length === 1 ? 'page' : 'pages'} lost ground.
          </b>{' '}
          The Lost ground tab shows what changed on each one and the questions it lost.
        </p>
      ) : null}
    </div>
  )
}

export function TopicsSection({
  report,
  lens,
  onLens
}: {
  report: ReviewReport
  lens: ReviewLens
  onLens: (lens: ReviewLens) => void
}): JSX.Element {
  const rows = report.topics.lenses[lens]
  return (
    <section className="rv-panel" aria-labelledby="rv-topics-title">
      <div className="rv-panel-head">
        <div>
          <h3 id="rv-topics-title">Results by segment</h3>
          <p className="rv-sub">
            Questions citing your pages. Switch the lens; click a number for its questions.
          </p>
        </div>
        <SegmentedControl
          label="Group questions by"
          size="sm"
          value={lens}
          onChange={onLens}
          options={REVIEW_LENSES.map((value) => ({ value, label: LENS_LABELS[value] }))}
        />
      </div>
      <div className="rv-tbl">
        <table aria-label={`Results by ${LENS_LABELS[lens]}`}>
          <thead>
            <tr>
              <th className="rv-n">#</th>
              <th>{LENS_LABELS[lens]}</th>
              <th className="rv-r">Questions</th>
              {report.comparing ? <th className="rv-r">Cited {report.fromLabel}</th> : null}
              <th className="rv-r">Cited {report.toLabel}</th>
              {report.comparing ? <th className="rv-r">Share {report.fromLabel}</th> : null}
              <th className="rv-r">Share {report.toLabel}</th>
              <th className="rv-r">Answer, not you</th>
              {report.comparing ? <th className="rv-r">Change</th> : null}
              <th className="rv-r">Named</th>
              <th className="rv-r">Named share</th>
              {report.comparing ? <th className="rv-r">Named change</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.value}>
                <td className="rv-n num">{index + 1}</td>
                <td>
                  <b>{row.value}</b>
                </td>
                <td className="rv-r">
                  <Fig num={row.questions} />
                </td>
                {report.comparing ? (
                  <td className="rv-r">{row.before ? <Fig num={row.before} /> : '—'}</td>
                ) : null}
                <td className="rv-r">
                  <Fig num={row.now} />
                </td>
                {report.comparing ? <td className="rv-r num">{share(row.shareBefore)}</td> : null}
                <td className="rv-r num">
                  <b>{share(row.shareNow)}</b>
                </td>
                <td className="rv-r">
                  <Fig num={row.open} />
                </td>
                {report.comparing ? (
                  <td className="rv-r">
                    <Change value={row.change} />
                  </td>
                ) : null}
                <NamedCells report={report} lens={lens} value={row.value} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function share(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

export function NotIndexedSection({
  report,
  onCsv
}: {
  report: ReviewReport
  onCsv: () => void
}): JSX.Element {
  const rows = report.notIndexed.rows
  const [copied, setCopied] = useState(false)
  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(rows.map((row) => row.url).join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="rv-stack">
      <p className="rv-hero-line">
        <b>
          {rows.length} {rows.length === 1 ? 'page is' : 'pages are'} not in Google yet.
        </b>{' '}
        A page Google hasn&apos;t seen can&apos;t be cited.
      </p>
      <Tiles tiles={report.notIndexed.tiles} />
      <NotIndexedSteps report={report} />
      <section className="rv-panel" aria-labelledby="rv-ni-title">
        <div className="rv-panel-head">
          <h3 id="rv-ni-title">Not indexed yet</h3>
          <div className="rv-actions">
            <CopyTool
              label="Copy all URLs"
              copied={copied}
              disabled={rows.length === 0}
              onClick={() => void copyAll()}
            />
            <ToolButton kind="csv" disabled={rows.length === 0} onClick={onCsv} />
          </div>
        </div>
        <NotIndexedTable report={report} />
      </section>
    </div>
  )
}

export function MethodSection({ report }: { report: ReviewReport }): JSX.Element {
  const { method } = report
  return (
    <section className="rv-panel" aria-labelledby="rv-method-title">
      <h3 id="rv-method-title">How we measured</h3>
      <div className="rv-method">
        {method.paragraphs.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <MethodExtras report={report} />
      <div className="rv-tiles rv-tiles-2">
        <button
          type="button"
          className="rv-tile"
          data-rd={method.compared.drill}
          onClick={() => openReportDrill(method.compared.drill)}
        >
          <b className="num">{method.compared.n}</b>
          <small>
            {report.comparing ? 'Questions checked at both ends' : 'Questions measured'}
          </small>
        </button>
        {method.agreement !== null ? (
          <button
            type="button"
            className="rv-tile"
            data-rd={method.agreement.agree.drill}
            onClick={() => openReportDrill(method.agreement?.agree.drill ?? '')}
          >
            <b className="num">{method.agreement.percent}%</b>
            <small>
              Engines agree on cited or not cited ({method.agreement.agree.n} of{' '}
              {method.agreement.pairs.n})
            </small>
          </button>
        ) : null}
      </div>
    </section>
  )
}
