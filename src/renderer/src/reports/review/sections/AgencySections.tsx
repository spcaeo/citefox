import { useState, type JSX } from 'react'
import {
  changeLine,
  type LostItem,
  type ReviewReport,
  type ReviewSectionId
} from '@shared/report/review'
import { copyText } from '../../../components/clipboard'
import { ToolButton } from '../../../ui'
import { ReportLink, ReportPage, ReportSite, ReportText } from '../copyCells'
import { Fig } from '../Figures'
import { CopyTool } from '../toolParts'
import { BacklinksHowTo, LostMorePanel, RoundHeroPanel, RoundTables } from './ClientAsks'
import { LinkedSteps } from './ImpactParts'

/**
 * The agency sections of a ready report in the app: Lost ground (a post-mortem per page),
 * the backlink ask list, and the Next round's five steps with their owners.
 */

function LostCard({ item, report }: { item: LostItem; report: ReviewReport }): JSX.Element {
  const change = item.change
  return (
    <section
      className="rv-panel rv-panel-warn"
      aria-label={`Lost ground: ${item.page.path}`}
      data-lost={item.page.url}
    >
      <h3>
        Lost ground: <ReportPage url={item.page.url} label={item.page.path} />
      </h3>
      <p className="rv-sub">
        {item.page.kind === 'rewrite' ? 'A change to this page went live' : 'This page'}
        {item.page.daysLive !== null ? ` ${item.page.daysLive} days ago` : ''}. These questions
        cited it on {report.fromLabel ?? 'the earlier check'} and no longer do.
      </p>
      <div className="rv-tiles rv-tiles-4">
        <LostTile label="Questions lost" num={item.lost} />
        <LostTile label="Now cite another page of yours" num={item.toOwn} />
        <LostTile label="Now cite other sites" num={item.toOthers} />
        <LostTile label="No AI answer now" num={item.noAnswer} />
      </div>
      <div className="rv-grid2">
        <div>
          <h4 className="rv-h4">What changed on the page</h4>
          {change ? (
            <>
              <p className="rv-p">
                <b>{item.changedLabel}:</b> {changeLine(change)}
              </p>
              {change.sections.length > 0 ? (
                <ul className="rv-list">
                  {change.sections.map((section) => (
                    <li key={section}>{section}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="rv-muted">
              CiteFox saw no change on this page in its page history. The answers may have moved to
              other sources on their own.
            </p>
          )}
          {item.sites.length > 0 ? (
            <p className="rv-p">
              <b>Cited instead now:</b>{' '}
              {item.sites.map((site, index) => (
                <span key={site.domain}>
                  {index > 0 ? ', ' : ''}
                  <ReportSite domain={site.domain} /> ({site.n})
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <div>
          <h4 className="rv-h4">Recovery plan</h4>
          <ol className="rv-steps">
            {item.plan.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      </div>
      <LostMorePanel report={report} item={item} />
    </section>
  )
}

function LostTile({ label, num }: { label: string; num: LostItem['lost'] }): JSX.Element {
  return (
    <div className="rv-tile rv-tile-static">
      <b className="num">
        <Fig num={num} label={label} />
      </b>
      <small>{label}</small>
    </div>
  )
}

export function LostSection({ report }: { report: ReviewReport }): JSX.Element {
  const items = report.lostGround.items
  if (items.length === 0) {
    return (
      <section className="rv-panel" aria-label="Lost ground">
        <h3>Lost ground</h3>
        <p className="rv-muted">
          {report.comparing
            ? `No page lost ground between ${report.fromLabel} and ${report.toLabel}.`
            : 'Pick two checks to compare: lost ground needs a From check.'}
        </p>
      </section>
    )
  }
  return (
    <div className="rv-stack">
      {items.map((item) => (
        <LostCard key={item.page.url} item={item} report={report} />
      ))}
    </div>
  )
}

export function BacklinksSection({
  report,
  onCsv
}: {
  report: ReviewReport
  onCsv: () => void
}): JSX.Element {
  const { rows, first } = report.backlinks
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(text: string, note: string): Promise<void> {
    if (await copyText(text)) {
      setCopied(note)
      window.setTimeout(() => setCopied(null), 1800)
    } else {
      setCopied(null)
    }
  }
  return (
    <div className="rv-stack">
      <p className="rv-note">
        <b>Links help AI answers trust a page.</b>
        {first > 0 ? ` Start with the ${first} marked First.` : ''}
      </p>
      {rows.length > 0 ? <BacklinksHowTo /> : null}
      <section className="rv-panel" aria-labelledby="rv-bl-title">
        <div className="rv-panel-head">
          <h3 id="rv-bl-title">Backlink ask list</h3>
          <div className="rv-actions">
            <CopyTool
              label="Copy all URLs"
              copied={copied !== null && copied.startsWith('All')}
              disabled={rows.length === 0}
              onClick={() =>
                void copy(rows.map((row) => row.url).join('\n'), `All ${rows.length} URLs copied`)
              }
            />
            <CopyTool
              label="Copy with anchor text"
              copied={copied !== null && copied.startsWith('Addresses')}
              disabled={rows.length === 0}
              onClick={() =>
                void copy(
                  rows.map((row) => `${row.url}\t${row.anchor}`).join('\n'),
                  'Addresses and anchor texts copied'
                )
              }
            />
            <ToolButton kind="csv" disabled={rows.length === 0} onClick={onCsv} />
          </div>
        </div>
        {copied ? (
          <p className="rv-saved rv-saved-ok" role="status">
            {copied}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="rv-muted">No page needs links right now.</p>
        ) : (
          <div className="rv-tbl">
            <table aria-label="Backlink ask list">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Page</th>
                  <th>Suggested anchor text</th>
                  <th>Why</th>
                  <th className="rv-r">Days live</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.url}>
                    <td>
                      <span
                        className={`rv-res rv-res-${row.priority === 'first' ? 'lost' : 'kept'}`}
                      >
                        {row.priority === 'first' ? 'First' : 'Next'}
                      </span>
                    </td>
                    <td>
                      <b>{row.title ?? row.url}</b>
                      <br />
                      <ReportLink url={row.url} />
                    </td>
                    <td>
                      <ReportText text={row.anchor} label={`“${row.anchor}”`} />
                      {row.anchorSaved ? '' : <span className="rv-muted"> (suggested)</span>}
                    </td>
                    <td>{row.reason}</td>
                    <td className="rv-r num">{row.daysLive ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export function NextSection({
  report,
  onSection
}: {
  report: ReviewReport
  onSection?: (id: ReviewSectionId) => void
}): JSX.Element {
  const { round } = report
  const client = new Set(report.impact.round.clientSteps)
  return (
    <div className="rv-stack">
      {report.kind === 'impact' ? <RoundHeroPanel report={report} /> : null}
      <section className="rv-panel" aria-labelledby="rv-cycle-title">
        <h3 id="rv-cycle-title">The 5-step cycle</h3>
        <p className="rv-sub">
          Each round measures, re-optimises, publishes, gets indexed and builds links. Owners are
          set on the Fixes screen.
        </p>
        <ol className="rv-round">
          {round.steps.map((step, index) => (
            <li
              key={step.step}
              className={`rv-round-step${client.has(step.step) ? ' rv-round-client' : ''}`}
              data-step={step.step}
            >
              <span className="rv-round-n">{index + 1}</span>
              <b>{step.name}</b>
              <span className="rv-muted rv-small">{step.line}</span>
              <span className="rv-round-owner">
                {step.owner}
                {client.has(step.step) ? (
                  <span className="rv-client-tag"> · your team’s step</span>
                ) : null}
              </span>
              {step.count !== null ? (
                <span className="rv-small">
                  <Fig num={step.count} label={step.countWords} /> {step.countWords}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {round.schedule ? <p className="rv-muted rv-small">{round.schedule}</p> : null}
      </section>
      {report.kind === 'impact' ? <RoundTables report={report} /> : null}
      <section className="rv-panel" aria-labelledby="rv-round-title">
        <h3 id="rv-round-title">What to do first</h3>
        <p className="rv-sub">Each step comes from a finding in this review.</p>
        <LinkedSteps
          steps={report.verdict.next}
          report={report}
          {...(onSection ? { onSection } : {})}
        />
      </section>
    </div>
  )
}
