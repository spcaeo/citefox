import { useState, type JSX } from 'react'
import type { ReportTable } from '@shared/ipc'
import {
  LENS_LABELS,
  opportunityChart,
  pointsText,
  sharePercent,
  positionsChart,
  rankedChart,
  REVIEW_LENSES,
  type Num,
  type ReviewLens,
  type ReviewReport,
  type SegmentFlag
} from '@shared/report/review'
import { Button, SegmentedControl, ToolButton } from '../../../ui'
import {
  BucketColumnsChart,
  FunnelChart,
  PositionChart,
  RankedBarsChart
} from '../../../ui/chart/ReportCharts'
import { ReportPage, ReportText } from '../copyCells'
import { Change, Fig, Parts } from '../Figures'
import { openReportDetail, openReportDrill, questionDetail } from '../drill'
import { Tiles } from './ListSections'
import { PagesSection } from './MoreSections'
import '../visibility.css'

/**
 * The Visibility report's own tabs in the app (Docs/REPORT-SPEC.md "Visibility report"):
 * Where you stand, Pages and Topics with their new cards. Reputation is in
 * ReputationSection.tsx. Same model as the download (src/shared/report/review/visibility.ts).
 */

export function VisStandingSection({
  report,
  onWhatChanged,
  onReputation
}: {
  report: ReviewReport
  onWhatChanged: () => void
  onReputation: () => void
}): JSX.Element {
  const { standing, visibility } = report
  const since = visibility.since
  const sentiment = visibility.reputation.standingLine
  return (
    <div className="rv-stack">
      <dl className="rv-facts" aria-label="About this report">
        {visibility.cover.map((fact) => (
          <div key={fact.label} className="rv-fact">
            <dt>{fact.label}</dt>
            <dd>{fact.num ? <Fig num={fact.num}>{fact.value}</Fig> : fact.value}</dd>
          </div>
        ))}
      </dl>
      <p className="rv-headline">
        <Parts parts={visibility.headline} />
      </p>
      {sentiment !== null ? (
        <p className="rv-note rv-sentiment">
          <span>{sentiment}</span>
          <button type="button" className="rv-link" onClick={onReputation}>
            See Reputation
          </button>
        </p>
      ) : null}
      <div className="rv-kpis rv-kpis-6">
        {standing.kpis.map((kpi, index) => (
          <button
            key={kpi.label}
            type="button"
            className="rv-kpi"
            data-rd={kpi.drill}
            onClick={() => openReportDrill(kpi.drill)}
          >
            <small>{kpi.label}</small>
            <span className="rv-kpi-big num">{kpi.now}</span>
            <span className="rv-kpi-was">{visibility.kpiNotes[index] ?? ''}</span>
          </button>
        ))}
      </div>
      {since !== null ? (
        <section className="rv-panel" aria-labelledby="rv-since-title">
          <div className="rv-panel-head">
            <div>
              <h3 id="rv-since-title">Since the previous check, {since.fromLabel}</h3>
              <p className="rv-sub">Questions compared with their own previous check.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={onWhatChanged}>
              What changed
            </Button>
          </div>
          <div className="rv-tiles">
            <SinceTile num={since.gained} label="Started citing you" />
            <SinceTile num={since.lost} label="Stopped citing you" />
            <SinceTile num={since.newlyNamed} label="Newly named" />
            <SinceTile num={since.noLongerNamed} label="No longer named" />
          </div>
        </section>
      ) : null}
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
        <Opportunity report={report} />
      </div>
      <Engines report={report} />
      <div className="rv-grid2">
        <section className="rv-panel" aria-labelledby="rv-pos-title">
          <h3 id="rv-pos-title">Where you sit among the sources</h3>
          <p className="rv-sub">How often your page is source #1, #2, #3 or lower.</p>
          <PositionChart {...positionsChart(report)} onDrill={openReportDrill} />
        </section>
        <section className="rv-panel" aria-labelledby="rv-top-title">
          <h3 id="rv-top-title">Most cited sites</h3>
          <p className="rv-sub">Questions whose AI answer cites each site.</p>
          <RankedBarsChart {...rankedChart(report)} onDrill={openReportDrill} />
        </section>
      </div>
    </div>
  )
}

function SinceTile({ num, label }: { num: Num; label: string }): JSX.Element {
  return (
    <div className="rv-tile">
      <b className="num">
        <Fig num={num} label={label} />
      </b>
      <small>{label}</small>
    </div>
  )
}

export function Opportunity({ report }: { report: ReviewReport }): JSX.Element {
  const { opportunity } = report.visibility
  return (
    <section className="rv-panel" aria-labelledby="rv-opp-title">
      <h3 id="rv-opp-title">The opportunity</h3>
      <p className="rv-sub">
        Of <Fig num={opportunity.answers} /> questions with an AI answer: where to act.
      </p>
      <BucketColumnsChart {...opportunityChart(report)} onDrill={openReportDrill} />
      <ul className="rv-legend">
        {opportunity.bars.map((bar) => (
          <li key={bar.id}>
            <b>{bar.label}</b> <Fig num={bar.value} label={bar.label} />: {bar.sub}
          </li>
        ))}
      </ul>
      {opportunity.rest > 0 ? (
        <p className="rv-sub">
          {opportunity.rest} more {opportunity.rest === 1 ? 'answer cites' : 'answers cite'} the
          right page without your name, or name you without a link.
        </p>
      ) : null}
    </section>
  )
}

function Engines({ report }: { report: ReviewReport }): JSX.Element | null {
  const { engines } = report.visibility
  if (engines.rows.length === 0) {
    return engines.note === null ? null : <p className="rv-note">{engines.note}</p>
  }
  return (
    <section className="rv-panel" aria-labelledby="rv-eng-title">
      <h3 id="rv-eng-title">By engine</h3>
      <p className="rv-sub">The same questions on each engine. Click a number for its questions.</p>
      <div className="rv-tbl">
        <table aria-label="By engine">
          <thead>
            <tr>
              <th>Engine</th>
              <th className="rv-r">Answer shown</th>
              <th className="rv-r">Cites you</th>
              <th className="rv-r">Right page</th>
              <th className="rv-r">Names you</th>
            </tr>
          </thead>
          <tbody>
            {engines.rows.map((row) => (
              <tr key={row.engine}>
                <td>
                  <b>{row.label}</b>
                </td>
                <td className="rv-r">
                  <Fig num={row.answered} />
                </td>
                <td className="rv-r">
                  <Fig num={row.cited} />
                </td>
                <td className="rv-r">
                  <Fig num={row.right} />
                </td>
                <td className="rv-r">
                  <Fig num={row.named} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function VisPagesSection({
  report,
  onCsv
}: {
  report: ReviewReport
  onCsv: (table: ReportTable) => void
}): JSX.Element {
  const t = report.visibility.targets
  return (
    <div className="rv-stack">
      {t.empty !== null ? (
        <p className="rv-note">{t.empty}</p>
      ) : (
        <>
          <Tiles tiles={t.tiles} />
          <section className="rv-panel" aria-labelledby="rv-tp-title">
            <div className="rv-panel-head">
              <div>
                <h3 id="rv-tp-title">Your target pages</h3>
                <p className="rv-sub">
                  Each Primary and Also OK page, and the questions each engine cites it on.
                </p>
              </div>
              <ToolButton kind="csv" onClick={() => onCsv('targetpages')} />
            </div>
            <div className="rv-tbl">
              <table aria-label="Your target pages">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Role</th>
                    <th className="rv-r">Set for</th>
                    {t.engines.map((engine) => (
                      <th key={engine.id} className="rv-r">
                        {engine.label}
                      </th>
                    ))}
                    <th className="rv-r">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((row) => (
                    <tr key={row.url}>
                      <td>
                        <ReportPage url={row.url} label={row.path} />
                      </td>
                      <td>{row.role}</td>
                      <td className="rv-r">
                        <Fig num={row.questions} />
                      </td>
                      {row.engines.map((cell, index) => (
                        <td key={t.engines[index]?.id ?? index} className="rv-r">
                          <Fig num={cell} />
                        </td>
                      ))}
                      <td className="rv-r">
                        <b>
                          <Fig num={row.total} />
                        </b>
                      </td>
                      <td>
                        {row.notCited ? (
                          <span className="rv-flag rv-flag-warn">Not cited yet</span>
                        ) : (
                          <span className="rv-flag rv-flag-ok">Cited</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <section className="rv-panel" aria-labelledby="rv-op-title">
        <div className="rv-panel-head">
          <div>
            <h3 id="rv-op-title">Other pages of yours being cited</h3>
            <p className="rv-sub">
              Pages of yours that answers cite but that are not set as a target page.
            </p>
          </div>
          {t.others.length > 0 ? (
            <ToolButton kind="csv" onClick={() => onCsv('otherpages')} />
          ) : null}
        </div>
        {t.others.length === 0 ? (
          <p className="rv-muted">Every page of yours that answers cite is a target page.</p>
        ) : (
          <div className="rv-tbl">
            <table aria-label="Other pages of yours being cited">
              <thead>
                <tr>
                  <th>Page</th>
                  <th className="rv-r">Questions</th>
                  <th>Cited on</th>
                </tr>
              </thead>
              <tbody>
                {t.others.map((row) => (
                  <tr key={row.url}>
                    <td>
                      <ReportPage url={row.url} label={row.path} />
                    </td>
                    <td className="rv-r">
                      <Fig num={row.questions} />
                    </td>
                    <td>
                      <ul className="rv-qlist">
                        {row.items.slice(0, 3).map((item) => (
                          <li key={item.id}>
                            <ReportText text={item.text}>
                              <button
                                type="button"
                                className="rv-link"
                                onClick={() => openReportDetail(questionDetail(item.id))}
                              >
                                {item.text}
                              </button>
                            </ReportText>
                          </li>
                        ))}
                        {row.items.length > 3 ? (
                          <li className="rv-muted">+{row.items.length - 3} more</li>
                        ) : null}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <PagesSection report={report} />
    </div>
  )
}

const FLAG_WORDS: Readonly<Record<Exclude<SegmentFlag, null>, string>> = {
  small: 'Few questions',
  within: 'Within noise'
}

export function VisTopicsSection({
  report,
  lens,
  onLens
}: {
  report: ReviewReport
  lens: ReviewLens
  onLens: (lens: ReviewLens) => void
}): JSX.Element {
  const rows = report.topics.lenses[lens]
  const extra = report.visibility.topics
  const more = extra.rows[lens]
  const universe = extra.universe[lens]
  return (
    <div className="rv-stack">
      {universe.length > 0 ? <Tiles tiles={universe} /> : null}
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
                <th className="rv-r">Answer shown</th>
                {report.comparing ? <th className="rv-r">Cited {report.fromLabel}</th> : null}
                <th className="rv-r">Cited {report.toLabel}</th>
                <th className="rv-r">Brand named</th>
                <th className="rv-r">Share {report.toLabel}</th>
                <th className="rv-r">Answer, not you</th>
                {report.comparing ? <th className="rv-r">Change</th> : null}
                {report.comparing ? <th className="rv-r">Named share</th> : null}
                {report.comparing ? <th className="rv-r">Named change</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const add = more[row.value]
                return (
                  <tr key={row.value}>
                    <td className="rv-n num">{index + 1}</td>
                    <td>
                      <b>{row.value}</b>
                      {add?.flag ? (
                        <span className="rv-flag rv-flag-muted">{FLAG_WORDS[add.flag]}</span>
                      ) : null}
                    </td>
                    <td className="rv-r">
                      <Fig num={row.questions} />
                    </td>
                    <td className="rv-r">{add ? <Fig num={add.answered} /> : '—'}</td>
                    {report.comparing ? (
                      <td className="rv-r">{row.before ? <Fig num={row.before} /> : '—'}</td>
                    ) : null}
                    <td className="rv-r">
                      <Fig num={row.now} />
                    </td>
                    <td className="rv-r">{add ? <Fig num={add.named} /> : '—'}</td>
                    <td className="rv-r num">
                      <span className="rv-sharebar" aria-hidden="true">
                        <i style={{ width: `${add?.bar ?? 0}%` }} />
                      </span>{' '}
                      <b>{row.shareNow === null ? '—' : `${Math.round(row.shareNow * 100)}%`}</b>
                    </td>
                    <td className="rv-r">
                      <Fig num={row.open} />
                    </td>
                    {report.comparing ? (
                      <td className="rv-r">
                        <Change value={row.change} />
                      </td>
                    ) : null}
                    {report.comparing ? (
                      <NamedShareCells report={report} lens={lens} value={row.value} />
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="rv-sub">
          The bar is the share of a group&apos;s questions that cite you. Few questions: under{' '}
          {extra.minimum}, so best and weakest leave it out. Within noise: the change is smaller
          than answers vary from search to search.
        </p>
      </section>
    </div>
  )
}

/** A collapsed block: a button that shows or hides what is inside. */
export function Fold({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="rv-fold">
      <Button
        size="sm"
        variant="secondary"
        icon={open ? 'chevron-up' : 'chevron-down'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open ? children : null}
    </div>
  )
}

/** What changed: a group's named share before → now and its change in points. */
function NamedShareCells({
  report,
  lens,
  value
}: {
  report: ReviewReport
  lens: ReviewLens
  value: string
}): JSX.Element {
  const seg = report.named.lenses[lens][value]
  return (
    <>
      <td className="rv-r num">
        {sharePercent(seg?.shareBefore ?? null)} → <b>{sharePercent(seg?.shareNow ?? null)}</b>
      </td>
      <td className="rv-r num">{pointsText(seg?.change ?? null)}</td>
    </>
  )
}
