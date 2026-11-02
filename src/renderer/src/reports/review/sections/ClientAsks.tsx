import { useState, type JSX } from 'react'
import {
  FRESH_DAYS,
  type LostItem,
  type LostOutcome,
  type OutlineRow,
  type ReviewReport
} from '@shared/report/review'
import { ReportLink } from '../copyCells'
import { Fig } from '../Figures'
import { QuestionTable } from '../tables'

/**
 * The Impact review's client asks in the app: what Lost ground adds per page (the old vs
 * new outline, still citing, lost by topic, outcome tabs), the backlink how-to, the Next
 * round hero, the index check by days live, questions not cited yet by topic, Not indexed's
 * "what we do / what your team does", and How we measured's extra checks.
 */

function Outline({ title, rows }: { title: string; rows: readonly OutlineRow[] }): JSX.Element {
  return (
    <div>
      <h4 className="rv-h4">{title}</h4>
      {rows.length === 0 ? (
        <p className="rv-muted">No headings.</p>
      ) : (
        <ol className="rv-outline">
          {rows.map((row, index) => (
            <li
              key={`${index}:${row.text}`}
              className={`rv-outline-${row.mark} rv-outline-h${row.level}`}
            >
              {row.mark === 'dropped' ? <span className="sr-only">Dropped: </span> : null}
              {row.mark === 'added' ? <span className="sr-only">Added: </span> : null}
              {row.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const OUTCOME_WORDS: Readonly<Record<LostOutcome | 'all', string>> = {
  all: 'All',
  own: 'Moved to your other pages',
  others: 'Went to other sites',
  none: 'No AI answer now',
  still: 'Still citing'
}

/** Lost ground's extra parts for one page, under its tiles. */
export function LostMorePanel({
  report,
  item
}: {
  report: ReviewReport
  item: LostItem
}): JSX.Element | null {
  const more = report.impact.lost[item.page.url]
  const [tab, setTab] = useState<LostOutcome | 'all'>('all')
  if (more === undefined) return null
  const still = more.stillIds.flatMap((id) => {
    const q = report.questionsById[id]
    return q === undefined ? [] : [q]
  })
  const every = [...item.questions, ...still]
  const counts = (id: LostOutcome | 'all'): number =>
    id === 'all' ? every.length : every.filter((q) => more.outcomes[q.id] === id).length
  const tabs = (['all', 'own', 'others', 'none', 'still'] as const).filter(
    (id) => id === 'all' || counts(id) > 0
  )
  const rows = tab === 'all' ? every : every.filter((q) => more.outcomes[q.id] === tab)
  return (
    <>
      <p className="rv-p">
        <b>Still citing it:</b> <Fig num={more.stillCiting} label="Still citing it" />{' '}
        {more.stillCiting.n === 1 ? 'question' : 'questions'}.
      </p>
      {more.outline !== null ? (
        <section className="rv-outline-pair" aria-label="Old and new outline">
          <Outline
            title={`Before (${report.fromLabel ?? 'cited version'})`}
            rows={more.outline.before}
          />
          <Outline title={`After (${item.changedLabel ?? 'now'})`} rows={more.outline.after} />
          <p className="rv-legend-line">
            <span>
              <i className="rv-sw rv-sw-not-cited" aria-hidden="true" />
              Dropped in the new version
            </span>
            <span>
              <i className="rv-sw rv-sw-target" aria-hidden="true" />
              New in this version
            </span>
          </p>
        </section>
      ) : null}
      {more.byTopic.length > 0 ? (
        <p className="rv-p">
          <b>Lost by topic:</b>{' '}
          {more.byTopic.map((row, index) => (
            <span key={row.topic}>
              {index > 0 ? ', ' : ''}
              {row.topic} <Fig num={row.num} label={`lost in ${row.topic}`} />
            </span>
          ))}
        </p>
      ) : null}
      <div className="rv-chips" role="group" aria-label="Outcome">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            className={tab === id ? 'on' : undefined}
            onClick={() => setTab(id)}
          >
            {OUTCOME_WORDS[id]}
            <em className="num">{counts(id)}</em>
          </button>
        ))}
      </div>
      <QuestionTable
        rows={rows}
        fromLabel={report.fromLabel}
        toLabel={report.toLabel}
        label={`Questions ${item.page.path} lost`}
      />
    </>
  )
}

/** The backlink ask: why, the 4-point how-to, and "tell us when links go live". */
export function BacklinksHowTo(): JSX.Element {
  return (
    <section className="rv-panel" aria-labelledby="rv-blhow-title">
      <h3 id="rv-blhow-title">How to add the links</h3>
      <ol className="rv-steps">
        <li>
          <b>Link to the exact address.</b> Use the full page address in the list, not the home
          page.
        </li>
        <li>
          <b>Use the anchor text shown.</b> Words that say what the page is about help AI answers
          match it to the question.
        </li>
        <li>
          <b>Start with relevant sites.</b> Partners, directories and industry sites first; a few
          relevant links beat many random ones.
        </li>
        <li>
          <b>Link between your own pages.</b> Add a link from your busiest pages to each page on the
          list.
        </li>
      </ol>
      <p className="rv-note">
        <b>Tell us when links go live.</b> Send the address of each new link, so the next check can
        show what it did.
      </p>
    </section>
  )
}

/** Next round: "The next round has already started" with its badge. */
export function RoundHeroPanel({ report }: { report: ReviewReport }): JSX.Element {
  const hero = report.impact.round
  return (
    <section className="rv-panel rv-hero" aria-label="Next round">
      <div className="rv-hero-top">
        <h3>
          {hero.number > 1 ? 'The next round has already started' : 'The first round has started'}
        </h3>
        {hero.startedLabel !== null ? (
          <span className="rv-badge rv-badge-ok">
            Round {hero.number} started {hero.startedLabel}
          </span>
        ) : null}
      </div>
      <p className="rv-p">{hero.line}</p>
    </section>
  )
}

/** Next round: the index check by days live, and the questions not cited yet by topic. */
export function RoundTables({ report }: { report: ReviewReport }): JSX.Element | null {
  const { index, openByTopic } = report.impact
  if (index.rows.length === 0 && openByTopic.length === 0) return null
  const comparing = report.comparing && report.fromLabel !== null
  return (
    <div className="rv-grid2">
      {index.rows.length > 0 ? (
        <section className="rv-panel" aria-labelledby="rv-idx-title">
          <h3 id="rv-idx-title">Is Google indexing the pages?</h3>
          {index.line ? <p className="rv-sub">{index.line}</p> : null}
          <div className="rv-tbl">
            <table aria-label="Index check by days live">
              <thead>
                <tr>
                  <th>Live</th>
                  <th className="rv-r">Pages</th>
                  <th className="rv-r">Indexed</th>
                  <th className="rv-r">Not indexed</th>
                  <th className="rv-r">Not checked</th>
                </tr>
              </thead>
              <tbody>
                {index.rows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="rv-r">
                      <Fig num={row.pages} />
                    </td>
                    <td className="rv-r num">{row.indexed}</td>
                    <td className="rv-r">
                      <Fig num={row.notIndexed} className={row.notIndexed.n > 0 ? 'rv-bad' : ''} />
                    </td>
                    <td className="rv-r num">{row.unchecked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {openByTopic.length > 0 ? (
        <section className="rv-panel" aria-labelledby="rv-open-title">
          <h3 id="rv-open-title">Questions not cited yet, by topic</h3>
          <p className="rv-sub">
            An AI answer shows, but it does not cite you. The next round goes after these.
          </p>
          <div className="rv-tbl">
            <table aria-label="Not cited yet, by topic">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th className="rv-r">Not cited</th>
                  <th className="rv-r">In topic</th>
                  {comparing ? <th className="rv-r">Cited you before</th> : null}
                </tr>
              </thead>
              <tbody>
                {openByTopic.map((row) => (
                  <tr key={row.topic}>
                    <td>{row.topic}</td>
                    <td className="rv-r">
                      <Fig num={row.open} />
                    </td>
                    <td className="rv-r num">{row.questions}</td>
                    {comparing ? (
                      <td className="rv-r">
                        <Fig num={row.wasCited} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}

/** Not indexed: fresh vs late, and "What we do / What your team does". */
export function NotIndexedSteps({ report }: { report: ReviewReport }): JSX.Element {
  const { late, fresh } = report.impact.notIndexed
  return (
    <>
      <p className="rv-note">
        <Fig num={late} label="live 4+ days, not indexed" />{' '}
        {late.n === 1 ? 'page has' : 'pages have'} been live 4+ days and Google still has not
        indexed {late.n === 1 ? 'it' : 'them'}. <Fig num={fresh} label="live 3 days or less" />{' '}
        {fresh.n === 1 ? 'is' : 'are'} 3 days old or less: Google may simply not have visited yet.
      </p>
      <div className="rv-grid2">
        <section className="rv-panel" aria-labelledby="rv-we-title">
          <h3 id="rv-we-title">What we do</h3>
          <ol className="rv-steps">
            <li>Check each page again at the next check.</li>
            <li>Link to each page from your busiest pages, so Google finds it sooner.</li>
            <li>Rework a page that stays out of Google for 14 days.</li>
          </ol>
        </section>
        <section className="rv-panel rv-client" aria-labelledby="rv-you-title">
          <h3 id="rv-you-title">What your team does</h3>
          <ol className="rv-steps">
            <li>
              In Google Search Console, open <b>URL Inspection</b>, paste each address below, and
              click <b>Request indexing</b>.
            </li>
            <li>
              Make sure each page is in your <b>sitemap</b>, and the sitemap is submitted in Search
              Console (Indexing, Sitemaps).
            </li>
            <li>Check that no page is blocked by robots.txt or a noindex tag.</li>
          </ol>
        </section>
      </div>
    </>
  )
}

/** Not indexed: each page, how long it has waited, and the questions written for it. */
export function NotIndexedTable({ report }: { report: ReviewReport }): JSX.Element {
  const rows = report.notIndexed.rows
  const per = report.impact.questionsFor
  return (
    <div className="rv-tbl">
      <table aria-label="Not indexed yet">
        <thead>
          <tr>
            <th className="rv-n">#</th>
            <th>Page</th>
            <th>Kind</th>
            <th className="rv-r">Days live</th>
            <th>Waiting</th>
            <th className="rv-r">Questions written for it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const late = row.daysLive !== null && row.daysLive > FRESH_DAYS
            return (
              <tr key={row.url} data-row={row.url}>
                <td className="rv-n num">{index + 1}</td>
                <td>
                  <b>{row.title ?? row.path}</b>
                  <div className="rv-muted">
                    <ReportLink url={row.url} />
                  </div>
                </td>
                <td>{row.kind === 'new' ? 'New' : row.kind === 'rewrite' ? 'Rewrite' : '—'}</td>
                <td className="rv-r num">{row.daysLive ?? '—'}</td>
                <td>
                  <span className={`rv-pill rv-pill-${late ? 'down' : 'flat'}`}>
                    {late ? 'Late' : 'Waiting'}
                  </span>
                </td>
                <td className="rv-r num">{per[row.url] ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** How we measured: the clean-before check and the extra definitions. */
export function MethodExtras({ report }: { report: ReviewReport }): JSX.Element | null {
  const { cleanBefore, lines } = report.impact.method
  if (report.kind !== 'impact') return null
  return (
    <div className="rv-method">
      {cleanBefore !== null ? (
        <p
          className={cleanBefore.ok ? 'rv-clean-ok' : 'rv-clean-warn'}
          data-testid="rv-clean-before"
        >
          {cleanBefore.line}
        </p>
      ) : null}
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}
