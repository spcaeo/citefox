import { useState, type JSX } from 'react'
import { pathOf, type ContentRow, type ReviewReport, type RivalRow } from '@shared/report/review'
import { copyText } from '../../../components/clipboard'
import { ToolButton } from '../../../ui'
import { ReportLink, ReportPage, ReportSite, ReportText } from '../copyCells'
import { Fig, Parts } from '../Figures'
import { CopyTool } from '../toolParts'
import { openReportDetail, openReportDrill, questionDetail } from '../drill'
import { Tiles } from './ListSections'
import { StepList } from './VerdictSection'
import { Opportunity } from './VisibilitySections'
import '../ready.css'

/**
 * The short ready reports in the app (Docs/REPORT-SPEC.md "Short ready reports"):
 * Pitch / audit's Summary and Plan, the Content plan, and Head-to-head. Same model as
 * the download (src/shared/report/review/ready.ts); every number opens its questions.
 */

function QuestionCell({ id, text }: { id: string; text: string }): JSX.Element {
  return (
    <ReportText text={text}>
      <button
        type="button"
        className="rv-link rv-q"
        onClick={() => openReportDetail(questionDetail(id))}
      >
        {text}
      </button>
    </ReportText>
  )
}

export function SummarySection({ report }: { report: ReviewReport }): JSX.Element {
  const pitch = report.ready.pitch
  return (
    <div className="rv-stack">
      <p className="rv-headline">
        <Parts parts={report.visibility.headline} />
      </p>
      <div className="rv-kpis rv-kpis-4">
        {pitch.kpis.map((kpi, index) => (
          <button
            key={kpi.label}
            type="button"
            className="rv-kpi"
            data-rd={kpi.drill}
            onClick={() => openReportDrill(kpi.drill)}
          >
            <small>{kpi.label}</small>
            <span className="rv-kpi-big num">{kpi.now}</span>
            <span className="rv-kpi-was">{pitch.kpiNotes[index] ?? ''}</span>
          </button>
        ))}
      </div>
      <div className="rv-grid2">
        <Opportunity report={report} />
        <section className="rv-panel" aria-labelledby="rv-pitch-sites">
          <h3 id="rv-pitch-sites">Most cited sites</h3>
          <p className="rv-sub">The five sites the AI answers cite most.</p>
          {pitch.sites.length === 0 ? (
            <p className="rv-muted">No site is cited in these AI answers yet.</p>
          ) : (
            <div className="rv-tbl">
              <table aria-label="Most cited sites">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="rv-r">Questions</th>
                    <th className="rv-r">Without you</th>
                  </tr>
                </thead>
                <tbody>
                  {pitch.sites.map((site) => (
                    <tr key={site.domain}>
                      <td>
                        <ReportSite domain={site.domain} own={site.own} you />
                      </td>
                      <td className="rv-r">
                        <Fig num={site.now} />
                      </td>
                      <td className="rv-r">{site.gap === null ? '—' : <Fig num={site.gap} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export function PitchPlanSection({ report }: { report: ReviewReport }): JSX.Element {
  return (
    <section className="rv-panel" aria-labelledby="rv-pitch-plan">
      <h3 id="rv-pitch-plan">What we’d fix first</h3>
      <p className="rv-sub">Built from this check. Click a number for its questions.</p>
      <StepList steps={report.ready.pitch.plan} />
    </section>
  )
}

function CopyBrief({ row }: { row: ContentRow }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <CopyTool
      label="Copy brief"
      copied={copied}
      onClick={() => {
        void copyText(row.brief).then((ok) => setCopied(ok))
      }}
    />
  )
}

export function WritePlanSection({
  report,
  onCsv
}: {
  report: ReviewReport
  onCsv: () => void
}): JSX.Element {
  const plan = report.ready.content
  return (
    <div className="rv-stack">
      <div className="rv-panel-head">
        <p className="rv-sub">
          Questions where an AI answer shows without the right page of yours, by topic.
        </p>
        <ToolButton kind="csv" onClick={onCsv} />
      </div>
      <Tiles tiles={plan.tiles} />
      {plan.groups.map((group) => (
        <section key={group.topic} className="rv-panel" aria-label={group.topic}>
          <h3>
            {group.topic} · <Fig num={group.questions} />
          </h3>
          <div className="rv-tbl">
            <table aria-label={`Plan: ${group.topic}`}>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Page to write or fix</th>
                  <th>Answer shape</th>
                  <th>Cited instead</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.question.id} data-plan-row={row.reason}>
                    <td>
                      <QuestionCell id={row.question.id} text={row.question.text} />
                      <div className="rv-small rv-muted">
                        {row.reason === 'wrongpage' ? 'Wrong page cited' : 'Not cited'}
                      </div>
                    </td>
                    <td>
                      {row.page === null ? <b>New page</b> : <ReportPage url={row.page} />}
                      {row.page !== null ? (
                        <div className="rv-small rv-muted">{row.pageLabel}</div>
                      ) : null}
                    </td>
                    <td>
                      {row.shape === null ? (
                        <span className="rv-muted">Not read yet</span>
                      ) : (
                        <>
                          {row.shape.label}
                          {row.shape.own ? null : (
                            <div className="rv-small rv-muted">Most common shape</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="rv-small">
                      {row.sites.length === 0 ? '—' : row.sites.join(', ')}
                    </td>
                    <td className="rv-r">
                      <CopyBrief row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

const WINNER: Readonly<Record<RivalRow['winner'], string>> = {
  them: 'Them',
  you: 'You',
  tie: 'Tie'
}

function PositionCell({ cited, value }: { cited: boolean; value: number | null }): JSX.Element {
  if (!cited) return <span className="rv-muted">Not cited</span>
  return <span className="num">{value === null ? 'Cited' : `#${value}`}</span>
}

export function H2hSection({ report }: { report: ReviewReport }): JSX.Element {
  const rival = report.ready.rival
  if (rival.domain === null) {
    return <p className="rv-note">No other business’s site is cited in these AI answers yet.</p>
  }
  return (
    <div className="rv-stack">
      <Tiles tiles={rival.tiles} />
      <section className="rv-panel" aria-labelledby="rv-h2h-rows">
        <h3 id="rv-h2h-rows">You and {rival.domain}, question by question</h3>
        <p className="rv-sub">Their gap first. A lower position is better.</p>
        {rival.rows.length === 0 ? (
          <p className="rv-muted">Neither you nor {rival.domain} is cited in these answers.</p>
        ) : (
          <div className="rv-tbl">
            <table aria-label="Head-to-head">
              <thead>
                <tr>
                  <th>Question</th>
                  <th className="rv-r">{rival.domain}</th>
                  <th className="rv-r">You</th>
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {rival.rows.map((row) => (
                  <tr key={row.question.id}>
                    <td>
                      <QuestionCell id={row.question.id} text={row.question.text} />
                    </td>
                    <td className="rv-r">
                      <PositionCell cited={row.theirsCited} value={row.theirs} />
                    </td>
                    <td className="rv-r">
                      <PositionCell cited={row.yoursCited} value={row.yours} />
                    </td>
                    <td>
                      <span className={`rv-win rv-win-${row.winner}`}>{WINNER[row.winner]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="rv-grid2">
        <section className="rv-panel" aria-labelledby="rv-h2h-brands">
          <h3 id="rv-h2h-brands">How AI describes each brand</h3>
          {rival.brands.length === 0 ? (
            <p className="rv-muted">{rival.brandsNote}</p>
          ) : (
            <div className="rv-tbl">
              <table aria-label="How AI describes each brand">
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th className="rv-r">Answers</th>
                    <th className="rv-r">Named first</th>
                    <th className="rv-r">Positive</th>
                    <th className="rv-r">Neutral</th>
                    <th className="rv-r">Negative</th>
                  </tr>
                </thead>
                <tbody>
                  {rival.brands.map((brand) => (
                    <tr key={brand.brand}>
                      <td>{brand.own ? <b>{brand.brand} (you)</b> : brand.brand}</td>
                      <td className="rv-r">
                        <Fig num={brand.answers} />
                      </td>
                      <td className="rv-r num">{brand.first}</td>
                      <td className="rv-r num">{brand.positive}</td>
                      <td className="rv-r num">{brand.neutral}</td>
                      <td className="rv-r num">{brand.negative}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="rv-panel" aria-labelledby="rv-h2h-pages">
          <h3 id="rv-h2h-pages">Their cited pages</h3>
          {rival.pages.length === 0 ? (
            <p className="rv-muted">{rival.pagesNote}</p>
          ) : (
            <div className="rv-tbl">
              <table aria-label="Their cited pages">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th className="rv-r">Questions</th>
                  </tr>
                </thead>
                <tbody>
                  {rival.pages.map((page) => (
                    <tr key={page.url}>
                      <td>
                        <ReportLink url={page.url} title={page.title ?? pathOf(page.url)} />
                        <div className="rv-small rv-muted">
                          <ReportPage url={page.url} drill={false} />
                        </div>
                      </td>
                      <td className="rv-r">
                        <Fig num={page.questions} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
