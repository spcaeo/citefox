import { useState, type JSX } from 'react'
import type { ReportTable } from '@shared/ipc'
import {
  toneChart,
  type ReputationView,
  type ReviewReport,
  type TonePoint
} from '@shared/report/review'
import { copyText } from '../../../components/clipboard'
import { ToolButton } from '../../../ui'
import { BucketColumnsChart } from '../../../ui/chart/ReportCharts'
import { ReportLink, ReportText } from '../copyCells'
import { Fig } from '../Figures'
import { CopyTool } from '../toolParts'
import { openReportDetail, openReportDrill, questionDetail } from '../drill'
import { Fold } from './VisibilitySections'

/**
 * The Reputation tab (Docs/REPORT-SPEC.md "Reputation"), ported from the Full report. It
 * leads with the net sentiment score and the tone split, then what AI says about you (top
 * themes with example claims) and how you are described next to the competitors in the
 * same answers; then wrong claims with a correction, every read answer (collapsed) and
 * the tone per check. Says plainly what it needs when there is nothing to read.
 */

const TONE_WORDS = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' } as const

function netText(value: number | null): string {
  if (value === null) return 'Not enough data'
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
}

function ToneBar({ point }: { point: Omit<TonePoint, 'label' | 'net'> }): JSX.Element {
  const share = (n: number): string =>
    `${point.total === 0 ? 0 : Math.round((n / point.total) * 100)}%`
  return (
    <span className="rv-tone" aria-hidden="true">
      <i className="rv-tone-pos" style={{ width: share(point.positive) }} />
      <i className="rv-tone-neu" style={{ width: share(point.neutral) }} />
      <i className="rv-tone-neg" style={{ width: share(point.negative) }} />
    </span>
  )
}

export function ReputationSection({
  report,
  onCsv
}: {
  report: ReviewReport
  onCsv: (table: ReportTable) => void
}): JSX.Element {
  const r = report.visibility.reputation
  return (
    <div className="rv-stack">
      {r.needs !== null ? <p className="rv-note">{r.needs}</p> : null}
      {r.basis !== '' ? <p className="rv-sub">{r.basis}</p> : null}
      {r.split.length > 0 ? <Score report={report} /> : null}
      {r.themes.length > 0 ? <Themes r={r} /> : null}
      {r.brands.length > 0 ? <Brands r={r} /> : null}
      {r.basis !== '' ? <Claims r={r} onCsv={onCsv} /> : null}
      {r.rows.length > 0 ? <Answers r={r} onCsv={onCsv} /> : null}
      {r.trend.length > 0 ? <Trend r={r} /> : null}
    </div>
  )
}

function Score({ report }: { report: ReviewReport }): JSX.Element {
  const r = report.visibility.reputation
  const tone =
    r.claims.net === null
      ? 'neutral'
      : r.claims.net > 0
        ? 'ok'
        : r.claims.net < 0
          ? 'warn'
          : 'neutral'
  return (
    <div className="rv-grid2">
      <section className="rv-panel" aria-labelledby="rv-net-title">
        <h3 id="rv-net-title">Net sentiment</h3>
        <p className="rv-sub">
          Positive minus negative claims about you, out of all claims, from −100 to +100.
        </p>
        <p className={`rv-net rv-net-${tone} num`}>{netText(r.claims.net)}</p>
        <p className="rv-sub">
          {r.claims.positive} positive, {r.claims.neutral} neutral, {r.claims.negative} negative{' '}
          {r.claims.positive + r.claims.neutral + r.claims.negative === 1 ? 'claim' : 'claims'}.
          {r.claims.net === null ? ' A score needs 5 or more claims.' : ''}
        </p>
      </section>
      <section className="rv-panel" aria-labelledby="rv-tone-title">
        <h3 id="rv-tone-title">Sentiment split</h3>
        <p className="rv-sub">
          Answers that name you, by their tone toward you. Click a bar for its questions.
        </p>
        <BucketColumnsChart {...toneChart(report)} onDrill={openReportDrill} />
      </section>
    </div>
  )
}

function Themes({ r }: { r: ReputationView }): JSX.Element {
  return (
    <section className="rv-panel" aria-labelledby="rv-themes-title">
      <h3 id="rv-themes-title">What AI says about you</h3>
      <p className="rv-sub">The themes of the claims about you, most talked about first.</p>
      <ul className="rv-themes">
        {r.themes.map((theme) => (
          <li key={theme.theme} className="rv-theme">
            <div className="rv-theme-head">
              <b>{theme.theme}</b>
              <ToneBar point={theme} />
              <span className="rv-muted rv-small num">
                {theme.total} {theme.total === 1 ? 'claim' : 'claims'} · net {netText(theme.net)}
              </span>
            </div>
            {theme.examples.map((example) => (
              <p key={example.claim} className="rv-small">
                <span className={`rv-flag rv-flag-${example.tone}`}>
                  {TONE_WORDS[example.tone]}
                </span>{' '}
                <ReportText text={example.claim} label={<q>{example.claim}</q>} />
                {example.question !== null ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="rv-link rv-muted"
                      onClick={() => openReportDetail(questionDetail(example.question?.id ?? ''))}
                    >
                      the answer
                    </button>
                  </>
                ) : null}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Brands({ r }: { r: ReputationView }): JSX.Element {
  return (
    <section className="rv-panel" aria-labelledby="rv-brands-title">
      <h3 id="rv-brands-title">You next to your competitors</h3>
      <p className="rv-sub">
        Brands named in the same read answers: how often, how often first, and the tone of the
        claims about each.
      </p>
      <div className="rv-tbl">
        <table aria-label="You next to your competitors">
          <thead>
            <tr>
              <th>Brand</th>
              <th className="rv-r">Answers naming it</th>
              <th className="rv-r">Named first</th>
              <th>Tone</th>
              <th className="rv-r">Net</th>
            </tr>
          </thead>
          <tbody>
            {r.brands.map((brand) => (
              <tr key={brand.brand}>
                <td>
                  <b>{brand.brand}</b>
                  {brand.own ? <span className="rv-flag">You</span> : null}
                </td>
                <td className="rv-r">
                  <Fig num={brand.answers} />
                </td>
                <td className="rv-r num">{brand.first}</td>
                <td>
                  <ToneBar
                    point={{
                      ...brand,
                      total: brand.positive + brand.neutral + brand.negative
                    }}
                  />
                </td>
                <td className="rv-r num">{netText(brand.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Claims({
  r,
  onCsv
}: {
  r: ReputationView
  onCsv: (table: ReportTable) => void
}): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(id: string, text: string): Promise<void> {
    const ok = await copyText(text)
    setCopied(ok ? id : null)
    if (ok) window.setTimeout(() => setCopied(null), 1800)
  }
  return (
    <section className="rv-panel" aria-labelledby="rv-claims-title">
      <div className="rv-panel-head">
        <div>
          <h3 id="rv-claims-title">Wrong claims worth correcting</h3>
          <p className="rv-sub">
            Claims in the answers that CiteFox AI found wrong, with what to correct and where.
          </p>
        </div>
        {r.issues.length > 0 ? <ToolButton kind="csv" onClick={() => onCsv('claims')} /> : null}
      </div>
      {r.issues.length === 0 ? (
        <p className="rv-muted">CiteFox AI found no wrong claim in these answers.</p>
      ) : (
        <ul className="rv-claims">
          {r.issues.map((issue) => (
            <li key={issue.id} className="rv-claim">
              {issue.question !== null ? (
                <ReportText text={issue.questionText}>
                  <button
                    type="button"
                    className="rv-link rv-small"
                    onClick={() => openReportDetail(questionDetail(issue.question?.id ?? ''))}
                  >
                    {issue.questionText}
                  </button>
                </ReportText>
              ) : (
                <span className="rv-small rv-muted">
                  <ReportText text={issue.questionText} />
                </span>
              )}
              <span>
                <ReportText text={issue.claim} label={<q>{issue.claim}</q>} />
                {!issue.own ? <span className="rv-muted"> ({issue.brand})</span> : null}
              </span>
              <p className="rv-small">
                <b>Problem:</b> {issue.why}
              </p>
              <p className="rv-small">
                <b>Suggested correction:</b> {issue.correction}
              </p>
              {issue.sourceToFix ? (
                <p className="rv-small">
                  <b>Source to fix:</b> <ReportLink url={issue.sourceToFix} />
                </p>
              ) : null}
              <div>
                <CopyTool
                  label="Copy the correction"
                  copied={copied === issue.id}
                  onClick={() => void copy(issue.id, issue.correction)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Answers({
  r,
  onCsv
}: {
  r: ReputationView
  onCsv: (table: ReportTable) => void
}): JSX.Element {
  return (
    <section className="rv-panel" aria-labelledby="rv-answers-title">
      <div className="rv-panel-head">
        <div>
          <h3 id="rv-answers-title">Answer by answer</h3>
          <p className="rv-sub">
            Every read answer that names you, with your rank among the brands.
          </p>
        </div>
        <ToolButton kind="csv" onClick={() => onCsv('answers')} />
      </div>
      <Fold label={`Show ${r.rows.length} ${r.rows.length === 1 ? 'answer' : 'answers'}`}>
        <div className="rv-tbl">
          <table aria-label="Answer by answer">
            <thead>
              <tr>
                <th>Question</th>
                <th>Tone</th>
                <th>Theme</th>
                <th>Rank</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.question.id}>
                  <td>
                    <ReportText text={row.question.text}>
                      <button
                        type="button"
                        className="rv-link"
                        onClick={() => openReportDetail(questionDetail(row.question.id))}
                      >
                        {row.question.text}
                      </button>
                    </ReportText>
                  </td>
                  <td>
                    <span className={`rv-flag rv-flag-${row.tone}`}>{TONE_WORDS[row.tone]}</span>
                  </td>
                  <td>{row.theme ?? '—'}</td>
                  <td>{row.rank}</td>
                  <td className="rv-small">{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Fold>
    </section>
  )
}

function Trend({ r }: { r: ReputationView }): JSX.Element {
  return (
    <section className="rv-panel" aria-labelledby="rv-trend-title">
      <h3 id="rv-trend-title">Tone per check</h3>
      <p className="rv-sub">Claims about you in each check.</p>
      <div className="rv-tbl">
        <table aria-label="Tone per check">
          <thead>
            <tr>
              <th>Check</th>
              <th>Tone</th>
              <th className="rv-r">Positive</th>
              <th className="rv-r">Neutral</th>
              <th className="rv-r">Negative</th>
              <th className="rv-r">Net</th>
            </tr>
          </thead>
          <tbody>
            {r.trend.map((point) => (
              <tr key={point.label}>
                <td>{point.label}</td>
                <td>
                  <ToneBar point={point} />
                </td>
                <td className="rv-r num">{point.positive}</td>
                <td className="rv-r num">{point.neutral}</td>
                <td className="rv-r num">{point.negative}</td>
                <td className="rv-r num">{netText(point.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
