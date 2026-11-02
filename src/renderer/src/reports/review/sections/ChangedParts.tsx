import type { JSX } from 'react'
import {
  pathOf,
  percent,
  pointsText,
  sharePercent,
  signedTenths,
  VERDICT_WAIT_DAYS,
  type ClaimItem,
  type MoveList,
  type ReviewReport,
  type SetShare
} from '@shared/report/review'
import { structureChart } from '@shared/report/review'
import { PairedBarsChart } from '../../../ui/chart/ReportCharts'
import { alertsHash } from '../../../shell/routes'
import { formatDay } from '../../../utils/dates'
import { Change, Fig } from '../Figures'
import { ReportPage, ReportText } from '../copyCells'
import { openReportDetail, openReportDrill, questionDetail } from '../drill'
import '../changed.css'

/**
 * The What changed report's own parts (Docs/REPORT-SPEC.md "What changed"): the cover
 * strip, coverage, the four movement lists, the split table, changed pages, answer
 * structure and the one-check panel. Every number opens exactly its list.
 */

export function CoverStrip({ report }: { report: ReviewReport }): JSX.Element {
  const c = report.whatChanged.cover
  return (
    <div className="rv-cover" aria-label="What this report compares">
      <dl className="rv-cover-grid">
        <div>
          <dt>Compared</dt>
          <dd>{c.fromLabel === null ? c.toLabel : `${c.fromLabel} → ${c.toLabel}`}</dd>
        </div>
        <div>
          <dt>Engine</dt>
          <dd>{c.engineLabel}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{c.scopeLabel}</dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>
            <Fig num={c.compared} /> of {c.inScope} compared
          </dd>
        </div>
        <div>
          <dt>AI answers read</dt>
          <dd>
            {c.answersFrom !== null ? (
              <>
                <Fig num={c.answersFrom} /> → <Fig num={c.answersTo} />
              </>
            ) : (
              <Fig num={c.answersTo} />
            )}
          </dd>
        </div>
      </dl>
      <p className="rv-cover-line">{c.line}</p>
    </div>
  )
}

export function WaitingPanel({ report }: { report: ReviewReport }): JSX.Element | null {
  const waiting = report.whatChanged.waiting
  if (waiting === null) return null
  return (
    <section className="rv-panel rv-waiting" aria-labelledby="rv-wait-title">
      <h3 id="rv-wait-title">{waiting.title}</h3>
      <p>{waiting.line}</p>
      <p className="rv-waiting-next">
        {waiting.next ?? 'No check is scheduled yet.'}{' '}
        <a className="rv-link" href={alertsHash('recheck')}>
          {waiting.next === null ? 'Set a check schedule' : 'Change the schedule'}
        </a>
      </p>
    </section>
  )
}

export function CoveragePanel({ report }: { report: ReviewReport }): JSX.Element {
  const cov = report.whatChanged.coverage
  return (
    <section className="rv-panel" aria-labelledby="rv-cov-title">
      <h3 id="rv-cov-title">What this comparison covers</h3>
      <p className="rv-sub">
        <Fig num={cov.compared} /> of {cov.inScope} questions were checked on both dates
        {cov.percent !== null ? ` (${cov.percent}%)` : ''}.{' '}
        {cov.nothingLeftOut
          ? 'Nothing left out.'
          : 'The rest are left out of every number, so both ends count the same questions.'}
      </p>
      {cov.nothingLeftOut ? null : (
        <div className="rv-tiles rv-tiles-3">
          <CountTile label={`New since ${report.fromLabel ?? 'From'}`} num={cov.newSince} />
          <CountTile label="No longer checked" num={cov.noLonger} />
          <CountTile label="Search failed" num={cov.failed} />
        </div>
      )}
    </section>
  )
}

function CountTile({
  label,
  num,
  tone
}: {
  label: string
  num: { n: number; drill: string }
  tone?: 'ok' | 'warn'
}): JSX.Element {
  if (num.n === 0) {
    return (
      <div className="rv-tile">
        <b className="num">0</b>
        <small>{label}</small>
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`rv-tile rv-tile-${tone ?? 'neutral'}`}
      data-rd={num.drill}
      onClick={() => openReportDrill(num.drill)}
    >
      <b className="num">{num.n.toLocaleString('en-US')}</b>
      <small>{label}</small>
    </button>
  )
}

/** Questions shown on each list card before "Show all". */
const CARD_ROWS = 6

function ListCard({ list }: { list: MoveList }): JSX.Element {
  const shown = list.items.slice(0, CARD_ROWS)
  return (
    <section className={`rv-move rv-move-${list.tone}`} aria-label={list.label}>
      <header className="rv-move-head">
        <span>{list.label}</span>
        <Fig num={list.num} className="rv-move-n" label={list.label} />
      </header>
      {list.items.length === 0 ? (
        <p className="rv-muted rv-small">None.</p>
      ) : (
        <ul className="rv-move-list">
          {shown.map((item) => (
            <li key={item.id}>
              <ReportText text={item.text}>
                <button
                  type="button"
                  className="rv-move-q"
                  onClick={() => openReportDetail(questionDetail(item.id))}
                >
                  {item.text}
                </button>
              </ReportText>
              <span className="rv-muted rv-small">
                {item.topic}
                {item.positionBefore !== null || item.positionNow !== null
                  ? ` · #${item.positionBefore ?? '—'} → #${item.positionNow ?? '—'}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.items.length > CARD_ROWS ? (
        <button
          type="button"
          className="rv-link rv-small"
          onClick={() => openReportDrill(list.num.drill)}
        >
          Show all {list.items.length}
        </button>
      ) : null}
    </section>
  )
}

export function MoveLists({ report }: { report: ReviewReport }): JSX.Element {
  return (
    <section className="rv-panel" aria-labelledby="rv-lists-title">
      <h3 id="rv-lists-title">Which questions moved</h3>
      <p className="rv-sub">
        Four lists. Click a question for its answers, or a count for the full list.
      </p>
      <div className="rv-moves">
        {report.whatChanged.lists.map((list) => (
          <ListCard key={list.id} list={list} />
        ))}
      </div>
    </section>
  )
}

/** Before / After / Change for citing and named, with the market vs your work parts. */
export function SplitTable({ report }: { report: ReviewReport }): JSX.Element | null {
  const rows = report.named.splitRows
  if (rows.length === 0) return null
  return (
    <div className="rv-tbl">
      <table aria-label="Before, after and change">
        <thead>
          <tr>
            <th />
            <th className="rv-r">{report.fromLabel}</th>
            <th className="rv-r">{report.toLabel}</th>
            <th className="rv-r">Change</th>
            <th className="rv-r">From more answers</th>
            <th className="rv-r">From your share</th>
            <th className="rv-r">Share of answers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <b>{row.label}</b>
              </td>
              <td className="rv-r">
                <Fig num={row.before} />
              </td>
              <td className="rv-r">
                <Fig num={row.after} />
              </td>
              <td className="rv-r">
                <Change value={row.change} />
              </td>
              <td className="rv-r num">{signedTenths(row.marketTenths)}</td>
              <td className="rv-r num">{signedTenths(row.workTenths)}</td>
              <td className="rv-r num">
                {percent(row.shareBefore)} → {percent(row.shareAfter)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function VerdictFooter({ report }: { report: ReviewReport }): JSX.Element {
  const cov = report.whatChanged.coverage
  return (
    <p className="rv-muted rv-small">
      What the verdict is based on: <Fig num={cov.compared} /> compared of {cov.inScope} in scope
      {cov.percent !== null ? ` (${cov.percent}%)` : ''}. Questions checked at one end only are left
      out.
    </p>
  )
}

function SetRow({ set }: { set: SetShare }): JSX.Element {
  return (
    <tr>
      <td>
        <b>{set.label}</b>
      </td>
      <td className="rv-r">
        <Fig num={set.questions} />
      </td>
      <td className="rv-r">
        <Fig num={set.citedBefore} />
      </td>
      <td className="rv-r">
        <Fig num={set.citedNow} />
      </td>
      <td className="rv-r num">
        {sharePercent(set.shareBefore)} → <b>{sharePercent(set.shareNow)}</b>
      </td>
    </tr>
  )
}

export function ChangedPagesPanel({ report }: { report: ReviewReport }): JSX.Element {
  const { rows, compare } = report.whatChanged.pages
  return (
    <div className="rv-stack">
      <section className="rv-panel" aria-labelledby="rv-cp-title">
        <h3 id="rv-cp-title">Pages changed in this window</h3>
        <p className="rv-sub">
          Pages published, rewritten or seen changing between {report.fromLabel ?? 'the checks'} and{' '}
          {report.toLabel}. A change under {VERDICT_WAIT_DAYS} days before {report.toLabel} is too
          recent to judge.
        </p>
        {rows.length === 0 ? (
          <p className="rv-muted">
            No page changed in this window. Log a fix, or let CiteFox read your pages, to see one
            here.
          </p>
        ) : (
          <div className="rv-tbl">
            <table aria-label="Pages changed in this window">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Size of change</th>
                  <th className="rv-r">Days before {report.toLabel}</th>
                  <th className="rv-r">Target questions</th>
                  {report.comparing ? <th className="rv-r">Cited {report.fromLabel}</th> : null}
                  <th className="rv-r">Cited {report.toLabel}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.page.url}>
                    <td>
                      <ReportPage
                        url={row.page.url}
                        label={row.page.title ?? pathOf(row.page.url)}
                        plain={row.page.title !== null}
                      />
                      {row.changedAt ? (
                        <span className="rv-muted rv-small"> · {formatDay(row.changedAt)}</span>
                      ) : null}
                    </td>
                    <td className="rv-small">
                      {row.size ?? <span className="rv-muted">Not known</span>}
                    </td>
                    <td className="rv-r num">
                      {row.daysBefore ?? '—'}
                      {row.tooRecent ? <span className="rv-pill">Too recent</span> : null}
                    </td>
                    <td className="rv-r">
                      <Fig num={row.targets} />
                    </td>
                    {report.comparing ? (
                      <td className="rv-r">
                        {row.citedBefore ? <Fig num={row.citedBefore} /> : '—'}
                      </td>
                    ) : null}
                    <td className="rv-r">
                      <Fig num={row.citedNow} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="rv-panel" aria-labelledby="rv-vs-title">
        <h3 id="rv-vs-title">Changed pages&apos; questions vs the rest of the project</h3>
        {compare === null ? (
          <p className="rv-muted">
            This needs a changed page with target questions (Primary or Also OK) checked on both
            dates.
          </p>
        ) : (
          <>
            <p className="rv-sub">
              Share of questions citing you, among questions checked on both dates. A page&apos;s
              questions are the ones it is the Primary or an Also OK page for.
            </p>
            <div className="rv-tbl">
              <table aria-label="Changed pages' questions vs the rest">
                <thead>
                  <tr>
                    <th />
                    <th className="rv-r">Questions</th>
                    <th className="rv-r">Cited {report.fromLabel}</th>
                    <th className="rv-r">Cited {report.toLabel}</th>
                    <th className="rv-r">Cited share</th>
                  </tr>
                </thead>
                <tbody>
                  <SetRow set={compare.changed} />
                  <SetRow set={compare.rest} />
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export function StructurePanel({ report }: { report: ReviewReport }): JSX.Element {
  const s = report.whatChanged.structure
  if (s === null) {
    return (
      <section className="rv-panel" aria-labelledby="rv-struct-title">
        <h3 id="rv-struct-title">Answer structure</h3>
        <p className="rv-muted">
          This appears once CiteFox AI has sorted the AI Overviews of both checks into blocks (Full
          report › Answer shape).
        </p>
      </section>
    )
  }
  return (
    <div className="rv-stack">
      <div className="rv-tiles rv-tiles-3">
        <CountTile label="Answers analysed at both checks" num={s.analysed} />
        <CountTile label="Changed their opening block" num={s.changedOpener} tone="warn" />
        <CountTile label="Changed shape" num={s.changedShape} />
      </div>
      <section className="rv-panel" aria-labelledby="rv-blocks-title">
        <h3 id="rv-blocks-title">Which answer blocks gained ground</h3>
        <p className="rv-sub">
          Answers holding each kind of block on {report.fromLabel} (faint) and {report.toLabel}.
          Write the blocks that gain ground into your pages.
        </p>
        <PairedBarsChart {...structureChart(report)} onDrill={openReportDrill} />
      </section>
      <section className="rv-panel" aria-labelledby="rv-shapes-title">
        <h3 id="rv-shapes-title">Answers that changed shape</h3>
        {s.changes.length === 0 ? (
          <p className="rv-muted">No answer changed shape between these checks.</p>
        ) : (
          <div className="rv-tbl">
            <table aria-label="Answers that changed shape">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>{report.fromLabel}</th>
                  <th>{report.toLabel}</th>
                </tr>
              </thead>
              <tbody>
                {s.changes.map((change) => (
                  <tr
                    key={change.question.id}
                    className="rv-click"
                    tabIndex={0}
                    onClick={() => openReportDetail(questionDetail(change.question.id))}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter')
                        openReportDetail(questionDetail(change.question.id))
                    }}
                  >
                    <td className="rv-q">
                      <ReportText text={change.question.text} inRow />
                      {change.opener ? <span className="rv-pill">New opener</span> : null}
                    </td>
                    <td className="rv-small">{change.before}</td>
                    <td className="rv-small">{change.after}</td>
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

/** The named share of one Topics row: share before → now and its change in points. */
export function NamedCells({
  report,
  lens,
  value
}: {
  report: ReviewReport
  lens: keyof ReviewReport['named']['lenses']
  value: string
}): JSX.Element {
  const seg = report.named.lenses[lens][value]
  return (
    <>
      <td className="rv-r">{seg ? <Fig num={seg.now} /> : '—'}</td>
      {report.comparing ? (
        <td className="rv-r num">
          {sharePercent(seg?.shareBefore ?? null)} → <b>{sharePercent(seg?.shareNow ?? null)}</b>
        </td>
      ) : (
        <td className="rv-r num">
          <b>{sharePercent(seg?.shareNow ?? null)}</b>
        </td>
      )}
      {report.comparing ? <td className="rv-r num">{pointsText(seg?.change ?? null)}</td> : null}
    </>
  )
}

const TONES = [
  ['positive', 'Positive'],
  ['neutral', 'Neutral'],
  ['negative', 'Negative']
] as const

function netText(net: number | null): string {
  return net === null ? 'Not enough data' : `${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net)}`
}

function ClaimList({ items }: { items: readonly ClaimItem[] }): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <ul className="rv-claim-moves">
      {items.slice(0, 5).map((item, index) => (
        <li key={`${item.question.id}-${index}`}>
          <ReportText text={item.sentence} label={<q>{item.sentence}</q>} />{' '}
          <ReportText text={item.question.text}>
            <button
              type="button"
              className="rv-link rv-small"
              onClick={() => openReportDetail(questionDetail(item.question.id))}
            >
              {item.question.text}
            </button>
          </ReportText>
        </li>
      ))}
    </ul>
  )
}

/** How AI talks about you: the tone of claims about the brand, before → now. */
export function SentimentCard({ report }: { report: ReviewReport }): JSX.Element {
  const s = report.whatChanged.sentiment
  return (
    <section className="rv-panel" aria-labelledby="rv-tone-title">
      <h3 id="rv-tone-title">How AI talks about you</h3>
      {s === null ? (
        <p className="rv-muted">
          Not enough data. CiteFox AI reads what AI Overviews say about your brand after each check;
          this fills in once both checks have been read.
        </p>
      ) : (
        <>
          <p className="rv-sub">
            Claims AI Overviews make about your brand, on the questions checked on both dates. Net
            sentiment is positive minus negative, out of every claim; under 5 claims it says Not
            enough data.
          </p>
          <div className="rv-tbl">
            <table aria-label="Tone of claims about you">
              <thead>
                <tr>
                  <th />
                  <th className="rv-r">{report.fromLabel}</th>
                  <th className="rv-r">{report.toLabel}</th>
                </tr>
              </thead>
              <tbody>
                {TONES.map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td className="rv-r num">{s.before[key]}</td>
                    <td className="rv-r num">{s.now[key]}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <b>Net sentiment</b>
                  </td>
                  <td className="rv-r num">{netText(s.before.net)}</td>
                  <td className="rv-r num">
                    <b>{netText(s.now.net)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="rv-tiles rv-tiles-2">
            <CountTile
              label="Questions with a new negative claim"
              num={s.newlyNegative}
              tone="warn"
            />
            <CountTile
              label="Questions whose negative claim is gone"
              num={s.goneNegative}
              tone="ok"
            />
          </div>
          <ClaimList items={s.newlyNegativeClaims} />
          {s.goneNegativeClaims.length > 0 ? (
            <p className="rv-muted rv-small">Gone since {report.fromLabel}:</p>
          ) : null}
          <ClaimList items={s.goneNegativeClaims} />
        </>
      )}
    </section>
  )
}
